'use strict';

const cds = require('@sap/cds');
const authHelpers = require('./handlers/auth-helpers');

const productHandlers = require('./handlers/product-handlers');
const dppHandlers     = require('./handlers/dpp-handlers');
const meHandler       = require('./handlers/me-handler');

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
  ProductBOMs:          'parent.owning_organization_ID',
  DPPs:                 'product.owning_organization_ID',
  QRCodes:              'dpp.product.owning_organization_ID'
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
  dppHandlers(srv);
  meHandler(srv);
};
