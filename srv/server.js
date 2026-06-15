'use strict';

require('./lib/secrets').load();

const cds = require('@sap/cds');
const publicHandler = require('./handlers/public-handler');
const authRoutes = require('./handlers/auth-routes');

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
  '| `alice.advanced`  | company_advanced  | ORG-A               |',
  '| `carol.user`      | company_user      | ORG-A               |',
  '| `dan.advanced.b`  | company_advanced  | ORG-B (Fashionista) |',
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
//
// NOTE on RBAC: app-role + tenant resolution against the `Users` table is
// done inline in `srv/handlers/auth-helpers.js#resolveAppUserInline`, invoked
// from the `srv.before('*')` gate in `srv/dpp-service.js`. We previously tried
// to attach the same lookup as an Express middleware via
// `cds.middlewares.before.push(...)` in CAP 9 — that push is silently dropped
// for OData requests, so the inline approach is the only reliable wire-up.
cds.on('bootstrap', (app) => {
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', service: 'dpp-capgemini' }));

  // App-managed login mask + auth endpoints (own auth, replaces XSUAA).
  // Mounted here so they sit OUTSIDE the per-service auth gate, like /public/*.
  authRoutes.register(app);

  // Public consumer endpoints. No authentication; visibility-filtered DTO.
  app.get('/public/dpp/:token', publicHandler.resolveDPPByToken);
  app.get('/public/dpp/:token/qr.png', publicHandler.getQRImage);
  // Streams a single PUBLIC certificate/proof for the consumer DPP (token-gated).
  app.get('/public/dpp/:token/documents/:docId', publicHandler.downloadPublicDocument);

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

  // Generic backstop for unhandled errors thrown by the Express-mounted routes above
  // (healthz, auth, public/*) so a stack trace never leaks to the client. The OData
  // service has its own srv.on('error') net; this only catches the bootstrap routes,
  // since it is registered before CAP mounts its OData routes + error middleware.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    console.error('[express] unhandled error:', err && err.message, err && err.stack);
    res
      .status((err && err.status) || 500)
      .json({ error: { message: 'Something went wrong. Please try again later.' } });
  });
});

module.exports = cds.server;
