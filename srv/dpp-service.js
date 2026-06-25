'use strict';

const authHelpers = require('./handlers/auth-helpers');

const productHandlers     = require('./handlers/product-handlers');
const productItemHandlers = require('./handlers/product-item-handlers');
const dppHandlers         = require('./handlers/dpp-handlers');
const marketingHandlers   = require('./handlers/marketing-handlers');
const documentHandlers    = require('./handlers/document-handlers');
const meHandler           = require('./handlers/me-handler');
const userHandlers        = require('./handlers/user-handlers');
const analyticsHandlers   = require('./handlers/analytics-handlers');
const complianceHandlers  = require('./handlers/compliance-handlers');

/**
 * App-internal RBAC + tenant isolation is enforced here in handlers instead
 * of via `@restrict` because the BTP UCC learn-tenant blocks role-collection
 * assignment in cockpit. See docs/architecture.md §6.
 *
 * Tenant anchor map: where each DPPService entity stores (or can resolve)
 * its owning organization. The Read-filter loop below injects this path
 * into every READ query.
 */
const TENANT_ANCHORS = {
  Organizations:        'ID',
  Users:                'organization_ID',
  BusinessPartners:     'owning_organization_ID',
  BusinessPartnerRoles: 'partner.owning_organization_ID',
  Products:             'owning_organization_ID',
  ProductVariants:      'product.owning_organization_ID',
  Batches:              'variant.product.owning_organization_ID',
  ProductItems:         'batch.variant.product.owning_organization_ID',
  ProductBOMs:          'parent.product.owning_organization_ID',
  BatchComponents:      'batch.variant.product.owning_organization_ID',
  DPPs:                 'product.owning_organization_ID',
  QRCodes:              'dpp.product.owning_organization_ID',
  DPPMarketingLinks:    'owning_organization_ID',
  DPPVersions:          'dpp.product.owning_organization_ID'
};

module.exports = (srv) => {
  // ----- Central error safety net -----
  // Translate unexpected/technical errors into clean, user-facing messages before CAP
  // serializes them. Deliberate `req.reject(4xx, …)` messages and errors explicitly
  // marked `expose` (e.g. from srv/lib/credentials.js) are left untouched; the real cause
  // of any 5xx is logged server-side. The frontend (api/errors.js) is the final display net.
  srv.on('error', (err, req) => {
    if (err.expose === true) return; // intentionally user-facing, already clean
    const status = err.status || err.statusCode || Number(err.code) || 500;
    const raw = `${err.code || ''} ${err.message || ''}`;

    // Raw DB constraint violations would otherwise surface as a technical 500.
    if (/unique|duplicate/i.test(raw)) {
      err.status = 409;
      err.code = '409';
      err.message = 'This entry already exists.';
      return;
    }
    if (/foreign key/i.test(raw)) {
      err.status = 409;
      err.code = '409';
      err.message = 'This action is not possible because related data is affected.';
      return;
    }
    if (status >= 500 && /not[ _]?null|cannot be null/i.test(raw)) {
      err.status = 400;
      err.code = '400';
      err.message = 'Required information is missing. Please check your input.';
      return;
    }

    // Any remaining unexpected server error: log the real cause, show a generic message.
    if (status >= 500) {
      console.error('[dpp] unexpected error:', err.message, err.stack || '');
      err.code = '500';
      err.message = 'Something went wrong on the server. Please try again later.';
    }
  });

  srv.before('*', async (req) => {
    if (req.event === 'READ' && req.path === '$metadata') return;
    await authHelpers.requireActiveUser(req);
    if (authHelpers.isWriteEvent(req)) {
      authHelpers.requireRole(req, 'company_advanced');
    }
  });

  for (const [entity, path] of Object.entries(TENANT_ANCHORS)) {
    srv.before('READ', entity, async (req) => {
      const orgId = await authHelpers.requireActiveUser(req);
      req.query.where(`${path} =`, orgId);
    });
  }

  // Documents anchor on EITHER product or batch (XOR), so a single tenant path can't
  // express the filter — apply an explicit OR. Parenthesized so it composes correctly
  // with any client $filter (which `.where()` appends to with AND).
  srv.before('READ', 'Documents', async (req) => {
    const orgId = await authHelpers.requireActiveUser(req);
    req.query.where(
      '(product.owning_organization_ID =', orgId,
      'or batch.variant.product.owning_organization_ID =', orgId, ')'
    );
  });

  // ----- Audit stamping (catalogue: CreatedBy / ChangedBy / CreatedAt / LastChange) -----
  // The acting user (req.user._appUserId) and timestamps are stamped server-side
  // for the eight catalogue business objects; client-supplied values are ignored.
  const AUDITED = [
    'Organizations', 'BusinessPartners', 'Products', 'ProductVariants',
    'Batches', 'ProductItems', 'ProductBOMs', 'DPPs', 'DPPMarketingLinks',
    'Documents'
  ];
  for (const entity of AUDITED) {
    srv.before('CREATE', entity, async (req) => {
      // Resolve the acting user here: entity-specific before handlers run
      // ahead of the catch-all before('*') gate, so _appUserId may not be set
      // yet. requireActiveUser is idempotent and populates it.
      await authHelpers.requireActiveUser(req);
      const uid = req.user._appUserId || null;
      const now = new Date().toISOString();
      req.data.createdAt = now;
      req.data.lastChange = now;
      req.data.createdBy_ID = uid;
      req.data.changedBy_ID = uid;
    });
    srv.before('UPDATE', entity, async (req) => {
      await authHelpers.requireActiveUser(req);
      req.data.lastChange = new Date().toISOString();
      req.data.changedBy_ID = req.user._appUserId || null;
    });
  }

  // Guard for raw OData CRUD on Users (the supported path for credentials is the
  // createUser / resetUserPassword / changePassword actions). Credential columns
  // are not part of the Users projection, so they cannot be written here anyway.
  // Resolve the caller inline because this entity-specific handler can run ahead
  // of the central before('*') gate, so _appOrgId may not be set yet.
  srv.before(['CREATE', 'UPDATE'], 'Users', async (req) => {
    const callerOrgId = await authHelpers.requireActiveUser(req);
    // Role can be changed via PATCH (promote/demote read-only ↔ full) but must
    // stay a valid app role.
    if (req.data.role !== undefined && !['company_advanced', 'company_user'].includes(req.data.role)) {
      req.reject(400, 'Invalid role. Please choose a valid user role.');
    }
    if (req.data.organization_ID === undefined && req.event === 'CREATE') {
      req.data.organization_ID = callerOrgId;
    } else if (req.data.organization_ID && req.data.organization_ID !== callerOrgId) {
      req.reject(403, 'Users can only be managed within your own organization.');
    }
  });

  srv.before(['CREATE', 'DELETE'], 'Organizations', (req) => {
    req.reject(403, 'Organizations cannot be created or deleted via the application API.');
  });
  srv.before('UPDATE', 'Organizations', (req) => {
    const callerOrgId = req.user._appOrgId;
    if (!callerOrgId) return;
    const targetId = req.data.ID ?? req.params?.[0]?.ID ?? req.params?.[0];
    if (targetId && targetId !== callerOrgId) {
      req.reject(403, 'You can only update your own organization.');
    }
  });

  productHandlers(srv);
  productItemHandlers(srv);
  dppHandlers(srv);
  marketingHandlers(srv);
  documentHandlers(srv);
  meHandler(srv);
  userHandlers(srv);
  analyticsHandlers(srv);
  complianceHandlers(srv);
};
