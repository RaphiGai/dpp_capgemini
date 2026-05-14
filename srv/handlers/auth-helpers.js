'use strict';

const cds = require('@sap/cds');

/**
 * Pull the tenant attribute that XSUAA placed into the user token.
 * For mocked users in dev this maps to `users[*].attr.tenant` in .cdsrc.json.
 * Returns `null` when the role doesn't carry a tenant (e.g. `authority`).
 */
function getTenant(req) {
  const attr = req.user?.attr?.tenant;
  if (!attr) return null;
  return Array.isArray(attr) ? attr[0] : attr;
}

function requireTenant(req) {
  const tenantId = getTenant(req);
  if (!tenantId) {
    req.reject(403, 'Missing tenant claim on user token.');
  }
  return tenantId;
}

/**
 * Resolve the caller's owning organization (cached per request via the cds tx).
 */
async function getUserOrg(req) {
  const tenantId = requireTenant(req);
  const { Organizations } = cds.entities('dpp');
  const org = await SELECT.one.from(Organizations).where({ tenant_id: tenantId });
  if (!org) {
    req.reject(403, `No organization found for tenant '${tenantId}'.`);
  }
  return org;
}

module.exports = {
  getTenant,
  requireTenant,
  getUserOrg
};
