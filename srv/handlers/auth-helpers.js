'use strict';

const cds = require('@sap/cds');

const APP_ROLES = ['company_advanced', 'company_user'];

const WRITE_EVENTS = new Set([
  'CREATE', 'UPDATE', 'DELETE', 'UPSERT',
  'approveDPP', 'publishDPP', 'archiveDPP', 'regenerateQRToken',
  'archiveProduct',
  'importProducts', 'importBatches', 'importBOM',
  // User management — company_advanced only. NOTE: 'changePassword' is
  // intentionally NOT listed: every active user (incl. read-only company_user)
  // must be able to change their own password (forced first-login flow).
  'createUser', 'resetUserPassword', 'deactivateUser', 'reactivateUser'
]);

/**
 * Pull the tenant attribute that XSUAA placed into the user token.
 * For mocked users in dev this maps to `users[*].attr.tenant` in .cdsrc.json.
 * Returns `null` when no tenant claim is present on the token.
 */
function getTenant(req) {
  const attr = req.user?.attr?.tenant;
  if (!attr) return null;
  return Array.isArray(attr) ? attr[0] : attr;
}

function requireTenant(req) {
  const tenantId = getTenant(req);
  if (!tenantId) {
    req.reject(403, 'Your session is invalid. Please sign in again.');
  }
  return tenantId;
}

/**
 * Resolve the caller's app role from the patched req.user._roles. The role is
 * projected by srv/server.js → rbacMiddleware after a DB lookup against the
 * Users table; if the user has no active Users row, no role is set.
 */
function getAppRole(req) {
  const user = req.user;
  if (!user) return null;
  if (typeof user.is === 'function') {
    for (const r of APP_ROLES) {
      if (user.is(r)) return r;
    }
  }
  const roles = user._roles;
  if (roles) {
    for (const r of APP_ROLES) {
      if (roles[r]) return r;
    }
  }
  return null;
}

/**
 * Resolve the caller's owning organization (cached per request via the cds tx).
 */
async function getUserOrg(req) {
  // Entity-specific before-handlers (e.g. CREATE Products/BusinessPartners) run
  // ahead of the central before('*') gate, and the XSUAA token carries no tenant
  // claim — so resolve the user here to inject req.user.attr.tenant first. Idempotent.
  await resolveAppUserInline(req);
  const tenantId = requireTenant(req);
  const { Organizations } = cds.entities('dpp');
  const org = await SELECT.one.from(Organizations).where({ tenant_id: tenantId });
  if (!org) {
    console.warn(`[auth] no organization found for tenant '${tenantId}'`);
    req.reject(403, 'Your account is not assigned to an organization. Please contact your administrator.');
  }
  return org;
}

/**
 * Resolve the calling identity against the `Users` table and inject the
 * matching role + tenant into req.user. Inline in this gate because the
 * Express middleware we registered in srv/server.js does not reliably fire
 * on every OData request under CAP 9. Idempotent — caches via _appOrgId.
 */
async function resolveAppUserInline(req) {
  if (req.user._appOrgId) return; // already resolved on this request
  const candidates = [req.user?.id, req.user?.email].filter(Boolean);
  if (!candidates.length) return;

  const { Users, Organizations } = cds.entities('dpp');
  let userRow = null;
  for (const c of candidates) {
    userRow = await SELECT.one.from(Users).where({ external_user_id: c });
    if (userRow) break;
    userRow = await SELECT.one.from(Users).where({ username: c });
    if (userRow) break;
    userRow = await SELECT.one.from(Users).where({ email: c });
    if (userRow) break;
  }
  if (!userRow || userRow.active === false) {
    console.warn(`[auth] no active Users row for ${JSON.stringify(candidates)}`);
    return;
  }

  const org = userRow.organization_ID
    ? await SELECT.one.from(Organizations).where({ ID: userRow.organization_ID })
    : null;
  if (!org) {
    console.warn(`[auth] user '${userRow.email}' has no org`);
    return;
  }

  req.user._roles = { [userRow.role]: 1 };
  req.user.roles = [userRow.role];
  const originalIs = typeof req.user.is === 'function' ? req.user.is.bind(req.user) : () => false;
  req.user.is = (r) => r === userRow.role || originalIs(r);
  req.user.has = req.user.is;
  req.user.attr = req.user.attr || {};
  req.user.attr.tenant = org.tenant_id;
  req.user._appOrgId = org.ID;
  req.user._appUserId = userRow.ID;   // acting Users row — used to stamp audit fields
}

/**
 * Hard-fail gate used at the start of every OData request. First tries the
 * inline DB lookup (above), then enforces that a role + tenant ended up on
 * req.user. Caches `req.user._appOrgId` for later use in per-entity read
 * filters and CREATE/UPDATE guards.
 */
async function requireActiveUser(req) {
  await resolveAppUserInline(req);

  const role = getAppRole(req);
  const tenant = getTenant(req);
  if (!role || !tenant) {
    req.reject(403, 'Your account is not active. Please contact your administrator.');
  }
  if (req.user._appOrgId) return req.user._appOrgId;
  const org = await getUserOrg(req);
  req.user._appOrgId = org.ID;
  return org.ID;
}

function requireRole(req, ...roles) {
  const role = getAppRole(req);
  if (!roles.includes(role)) {
    console.warn(`[auth] insufficient role '${role}' — requires one of: ${roles.join(', ')}`);
    req.reject(403, "You don't have permission to perform this action.");
  }
}

function isWriteEvent(req) {
  return WRITE_EVENTS.has(req.event);
}

/**
 * Verify the entity instance referenced by `id` belongs to the caller's
 * organization, with optional association-path lookup (e.g. for DPPs the
 * tenant anchor is `product.owning_organization_ID`). Used by bound actions.
 *
 * @param {object} req       — the CAP request
 * @param {string} entityName  — short name as registered on cds.entities('dpp')
 * @param {string} id        — instance ID (string PK)
 * @param {string} ownerPath — dot-path to the owning_organization_ID, default 'owning_organization_ID'
 */
async function requireOwningOrg(req, entityName, id, ownerPath = 'owning_organization_ID') {
  const callerOrgId = await requireActiveUser(req);
  const entity = cds.entities('dpp')[entityName];
  if (!entity) {
    console.error(`[auth] requireOwningOrg called with unknown entity '${entityName}'`);
    req.reject(500, 'An internal error occurred.');
  }
  const row = await SELECT.one
    .from(entity)
    .columns(`${ownerPath} as ownerOrgId`)
    .where({ ID: id });
  if (!row) req.reject(404, 'The requested item could not be found.');
  if (row.ownerOrgId !== callerOrgId) {
    console.warn(`[auth] ${entityName} '${id}' belongs to a different organization`);
    req.reject(403, "You don't have permission to access this item.");
  }
}

module.exports = {
  APP_ROLES,
  getTenant,
  requireTenant,
  getAppRole,
  getUserOrg,
  requireActiveUser,
  requireRole,
  isWriteEvent,
  requireOwningOrg
};
