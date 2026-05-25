'use strict';

const cds = require('@sap/cds');
const publicHandler = require('./handlers/public-handler');

/**
 * App-internal RBAC: identity comes from XSUAA (or mocked-auth in dev), but
 * the role + tenant attribute are looked up from the `Users` table by
 * `external_user_id` (preferred) or `email`. This lets us manage users via
 * the app itself instead of relying on XSUAA Role Collection assignments
 * in the BTP cockpit.
 *
 * The lookup is wired on every served service via `srv.before('*')` — it
 * runs after CAP's auth middleware (so req.user.id is populated) and before
 * the @restrict check. If the looked-up user is inactive or missing, we
 * leave req.user untouched so @restrict will deny the request.
 */

const ROLE_LOOKUP_CACHE = new Map();
const ROLE_LOOKUP_TTL_MS = 30 * 1000;

function cacheGet(key) {
  const entry = ROLE_LOOKUP_CACHE.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    ROLE_LOOKUP_CACHE.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  ROLE_LOOKUP_CACHE.set(key, { value, expires: Date.now() + ROLE_LOOKUP_TTL_MS });
}

async function lookupAppUser(userId) {
  if (!userId) return null;
  const cached = cacheGet(userId);
  if (cached) return cached;

  const { Users, Organizations } = cds.entities('dpp');
  // Try external_user_id first (XSUAA `sub` is usually the user id without domain),
  // then fall back to email (some IdPs emit only the email).
  let user = await SELECT.one.from(Users).where({ external_user_id: userId });
  if (!user) user = await SELECT.one.from(Users).where({ email: userId });
  if (!user || user.active === false) {
    cacheSet(userId, null);
    return null;
  }

  let tenantId = null;
  if (user.organization_ID) {
    const org = await SELECT.one.from(Organizations).where({ ID: user.organization_ID });
    tenantId = org?.tenant_id || null;
  }
  const result = { role: user.role, tenantId, displayName: user.display_name };
  cacheSet(userId, result);
  return result;
}

function applyAppRoleToUser(user, lookup) {
  if (!user || !lookup) return;
  // CAP looks at user._roles for role-checks; offer both object + array shapes.
  user._roles = { [lookup.role]: 1 };
  user.roles = [lookup.role];
  const originalIs = typeof user.is === 'function' ? user.is.bind(user) : () => false;
  user.is = (role) => role === lookup.role || originalIs(role);
  user.has = user.is;
  user.attr = user.attr || {};
  if (lookup.tenantId && !user.attr.tenant) {
    // XSUAA attributes are typically arrays; CAP also accepts plain strings.
    user.attr.tenant = lookup.tenantId;
  }
}

// Swagger UI is loaded lazily so test environments without the dev-only
// dependency installed can still boot.
let swaggerUi = null;
try {
  swaggerUi = require('cds-swagger-ui-express');
} catch {
  // optional — warned on bootstrap if missing
}

const MOCK_USERS_NOTE = [
  '### Test credentials (mocked auth, dev only)',
  '',
  'Click **Authorize** above and use any of the following — password is always `x`.',
  '',
  '| User              | App role          | Tenant              |',
  '| ----------------- | ----------------- | ------------------- |',
  '| `kka_learn_235`   | company_advanced  | ORG-A (Greenline)   |',
  '| `alice.advanced`  | company_advanced  | ORG-A               |',
  '| `carol.user`      | company_user      | ORG-A               |',
  '| `dan.advanced.b`  | company_advanced  | ORG-B (Fashionista) |',
  '| `eve.enduser`     | end_user          | — (cross-tenant)    |',
  '',
  'Roles are resolved by the backend from the `Users` table — these mock users mirror the seeded DB rows.'
].join('\n');

/**
 * Flatten OData v4 schema variants so each entity is represented by a single
 * schema in the OpenAPI document. CAP emits `Entity`, `Entity-create` and
 * `Entity-update` schemas; the latter two are removed and any `$ref` to them is
 * rewritten to point at the base schema.
 */
function collapseSchemaVariants(spec) {
  if (!spec?.components?.schemas) return;
  const schemas = spec.components.schemas;
  const variants = Object.keys(schemas).filter((n) => n.endsWith('-create') || n.endsWith('-update'));
  if (!variants.length) return;

  const rewriteMap = new Map();
  for (const name of variants) {
    const base = name.replace(/-(create|update)$/, '');
    if (schemas[base]) rewriteMap.set(name, base);
  }

  const rewriteRef = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(rewriteRef);
      return;
    }
    for (const k of Object.keys(obj)) {
      if (k === '$ref' && typeof obj[k] === 'string') {
        for (const [variant, base] of rewriteMap) {
          if (obj[k].endsWith('/' + variant)) {
            obj[k] = obj[k].replace('/' + variant, '/' + base);
          }
        }
      } else {
        rewriteRef(obj[k]);
      }
    }
  };

  rewriteRef(spec);
  for (const name of rewriteMap.keys()) delete schemas[name];
}

function injectBasicAuthScheme(req, res, next) {
  if (!req.path.includes('/$api-docs') || !req.path.endsWith('/openapi.json')) {
    return next();
  }
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && body.openapi) {
      body.components = body.components || {};
      body.components.securitySchemes = body.components.securitySchemes || {};
      body.components.securitySchemes.basicAuth = { type: 'http', scheme: 'basic' };
      body.security = [{ basicAuth: [] }];
      body.info = body.info || {};
      const existing = body.info.description || '';
      if (!existing.includes('Test credentials')) {
        body.info.description = existing
          ? `${existing}\n\n---\n\n${MOCK_USERS_NOTE}`
          : MOCK_USERS_NOTE;
      }
      collapseSchemaVariants(body);
    }
    return origJson(body);
  };
  next();
}

function postprocessOpenApiProd(req, res, next) {
  if (!req.path.includes('/$api-docs') || !req.path.endsWith('/openapi.json')) {
    return next();
  }
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && body.openapi) {
      collapseSchemaVariants(body);
    }
    return origJson(body);
  };
  next();
}

// Express mounts that must live outside of CAP's auth middleware (e.g. the
// public consumer endpoint) are wired here on the `bootstrap` event.
cds.on('bootstrap', (app) => {
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', service: 'dpp-capgemini' }));

  // Public consumer endpoints. No authentication; visibility-filtered DTO.
  app.get('/public/dpp/:token', publicHandler.resolveDPPByToken);
  app.get('/public/dpp/:token/qr.png', publicHandler.getQRImage);

  if (swaggerUi) {
    if (process.env.NODE_ENV !== 'production') {
      app.use(injectBasicAuthScheme);
    } else {
      app.use(postprocessOpenApiProd);
    }
    app.use(swaggerUi());
  } else if (process.env.NODE_ENV !== 'test') {
    console.warn('cds-swagger-ui-express not installed — /swagger is disabled');
  }
});

// After every Application Service is registered, wire the per-request user
// lookup. We attach it only to our public-facing services (DPPService,
// AuthorityService) so the internal DB queries lookupAppUser makes don't
// recurse through this hook.
const APP_SERVICES = ['DPPService', 'AuthorityService'];

cds.on('served', (services) => {
  for (const srv of Object.values(services)) {
    if (!srv || !APP_SERVICES.includes(srv.name)) continue;
    if (typeof srv.before !== 'function') continue;
    srv.before('*', async (req) => {
      if (!req.user || !req.user.id) return;
      // If a mocked-auth role is already attached (dev), trust it.
      if (Array.isArray(req.user.roles) && req.user.roles.length > 0) return;
      try {
        const lookup = await lookupAppUser(req.user.id);
        if (lookup) {
          applyAppRoleToUser(req.user, lookup);
          if (cds.context && cds.context.user) applyAppRoleToUser(cds.context.user, lookup);
        } else {
          console.warn(`[rbac] no Users row for '${req.user.id}' — request will be denied by @restrict`);
        }
      } catch (err) {
        console.error('[rbac] user lookup failed:', err.message);
      }
    });
  }
});

module.exports = cds.server;
