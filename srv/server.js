'use strict';

const cds = require('@sap/cds');
const publicHandler = require('./handlers/public-handler');

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
  '| User             | Role      | Tenant              |',
  '| ---------------- | --------- | ------------------- |',
  '| `alice.admin`    | admin     | ORG-A (Greenline)   |',
  '| `bob.advanced`   | advanced  | ORG-A               |',
  '| `carol.user`     | user      | ORG-A               |',
  '| `dave.viewer`    | viewer    | ORG-A               |',
  '| `dan.advanced.b` | advanced  | ORG-B (Fashionista) |',
  '',
  '`alice.admin` / `bob.advanced` cover most scenarios. `dan.advanced.b` verifies tenant isolation.'
].join('\n');

/**
 * Flatten OData v4 schema variants so each entity is represented by a single
 * schema in the OpenAPI document. CAP emits `Entity`, `Entity-create` and
 * `Entity-update` schemas; the latter two are removed and any `$ref` to them is
 * rewritten to point at the base schema. This makes Swagger UI show one schema
 * per entity (matches the simplification request from the requirements review).
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

/**
 * Inject an HTTP Basic securityScheme into the OpenAPI spec so Swagger UI
 * renders an "Authorize" button, append a mock-user cheat-sheet to the service
 * description, and collapse the per-entity -create/-update schema variants into
 * a single schema. The cds-swagger-ui-express plugin caches the doc per service,
 * so mutating once persists; checks below are idempotent.
 */
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

/**
 * Production variant of the OpenAPI postprocessor: collapses -create/-update
 * variants but does not advertise Basic Auth (approuter handles XSUAA in front).
 */
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

  // OpenAPI / Swagger UI at /$api-docs.
  // In production the approuter terminates XSUAA in front of us, so we don't
  // advertise a Basic-Auth scheme — Swagger UI inherits the session cookie.
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

module.exports = cds.server;
