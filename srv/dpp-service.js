'use strict';

const cds = require('@sap/cds');
const authHelpers = require('./handlers/auth-helpers');

const productHandlers     = require('./handlers/product-handlers');
const productItemHandlers = require('./handlers/product-item-handlers');
const dppHandlers         = require('./handlers/dpp-handlers');
const marketingHandlers   = require('./handlers/marketing-handlers');
const meHandler           = require('./handlers/me-handler');

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
  DPPs:                 'product.owning_organization_ID',
  QRCodes:              'dpp.product.owning_organization_ID',
  DPPMarketingLinks:    'owning_organization_ID'
};

module.exports = (srv) => {
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

  // ----- Audit stamping (catalogue: CreatedBy / ChangedBy / CreatedAt / LastChange) -----
  // The acting user (req.user._appUserId) and timestamps are stamped server-side
  // for the eight catalogue business objects; client-supplied values are ignored.
  const AUDITED = [
    'Organizations', 'BusinessPartners', 'Products', 'ProductVariants',
    'Batches', 'ProductItems', 'ProductBOMs', 'DPPs', 'DPPMarketingLinks'
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

  srv.before(['CREATE', 'UPDATE'], 'Users', (req) => {
    const callerOrgId = req.user._appOrgId;
    if (!callerOrgId) return;
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
  meHandler(srv);
};
