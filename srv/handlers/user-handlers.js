'use strict';

const cds = require('@sap/cds');
const { randomUUID } = require('crypto');
const { APP_ROLES, requireActiveUser, requireRole } = require('./auth-helpers');
const credentials = require('../lib/credentials');
const passwords = require('../lib/passwords');

/**
 * User-management actions for the app-managed authentication (US1.3 / US1.6).
 *
 * All admin actions (createUser, resetUserPassword, deactivateUser,
 * reactivateUser) are listed in auth-helpers.WRITE_EVENTS, so the central
 * `srv.before('*')` gate in dpp-service.js already enforces `company_advanced`
 * and own-tenant scoping before these run. `changePassword` is deliberately NOT
 * a write event — every active user (incl. read-only company_user) must be able
 * to change their own password.
 *
 * Passwords are never accepted/returned as OData entity properties and are never
 * logged. Temp passwords are generated server-side and returned exactly once.
 */
module.exports = (srv) => {
  // Use the underlying DB entity (full columns incl. password_hash; no OData
  // projection filter). Credential writes must NOT go through the DPPService
  // Users projection, which omits the credential columns by design.
  const { Users } = cds.entities('dpp');

  // ----- createUser: onboard a new user, choose role (read-only vs full) -----
  srv.on('createUser', async (req) => {
    const callerOrgId = await requireActiveUser(req);
    requireRole(req, 'company_advanced');

    const username = (req.data.username || '').trim();
    const email = (req.data.email || '').trim();
    const displayName = (req.data.displayName || '').trim();
    const role = req.data.role;

    if (!username || !email) req.reject(400, 'Username and email are required.');
    if (!APP_ROLES.includes(role)) {
      req.reject(400, 'Invalid role. Please choose a valid user role.');
    }

    // Uniqueness: username is global; email is unique within the caller's org.
    if (await credentials.findByUsername(username)) {
      req.reject(409, 'This username is already taken.');
    }
    const emailClash = await SELECT.one.from(Users)
      .where({ email, organization_ID: callerOrgId });
    if (emailClash) {
      req.reject(409, 'A user with this email address already exists in your organization.');
    }

    const temp = passwords.generateTempPassword();
    const passwordHash = await passwords.hash(temp);
    const userId = randomUUID();

    await INSERT.into(Users).entries({
      ID: userId,
      username,
      email,
      display_name: displayName || username,
      organization_ID: callerOrgId,      // forced into caller's own org
      role,
      external_user_id: username,         // lets resolveAppUserInline match the login principal
      active: true,
      password_hash: passwordHash,
      must_reset_password: true,
      failed_login_count: 0,
    });

    return { userId, username, email, role, tempPassword: temp };
  });

  // ----- resetUserPassword: admin-mediated reset (no email) -----
  srv.on('resetUserPassword', async (req) => {
    const callerOrgId = await requireActiveUser(req);
    requireRole(req, 'company_advanced');

    const target = await credentials.findById(req.data.userId);
    if (!target) req.reject(404, 'User not found.');
    if (target.organization_ID !== callerOrgId) {
      req.reject(403, 'Users can only be managed within your own organization.');
    }

    const temp = await credentials.setTemporaryPassword(target.ID);
    return { userId: target.ID, tempPassword: temp };
  });

  // ----- changePassword: caller changes their OWN password -----
  srv.on('changePassword', async (req) => {
    await requireActiveUser(req);
    const uid = req.user._appUserId;
    if (!uid) req.reject(403, 'Your account is not active. Please contact your administrator.');
    try {
      await credentials.changePassword(uid, req.data.currentPassword, req.data.newPassword);
    } catch (e) {
      req.reject(e.status || 400, e.message);
    }
    return true;
  });

  // ----- deactivateUser: the "remove" path (active=false locks login immediately) -----
  srv.on('deactivateUser', async (req) => {
    const callerOrgId = await requireActiveUser(req);
    requireRole(req, 'company_advanced');

    const target = await credentials.findById(req.data.userId);
    if (!target) req.reject(404, 'User not found.');
    if (target.organization_ID !== callerOrgId) {
      req.reject(403, 'Users can only be managed within your own organization.');
    }
    if (target.ID === req.user._appUserId) {
      req.reject(400, 'You cannot deactivate your own account.');
    }

    // Never remove the last active company_advanced of an organization.
    if (target.role === 'company_advanced' && target.active !== false) {
      const admins = await SELECT.from(Users)
        .columns('ID')
        .where({ organization_ID: callerOrgId, role: 'company_advanced', active: true });
      if (admins.length <= 1) {
        req.reject(400, 'Cannot deactivate the last active company_advanced user of the organization.');
      }
    }

    await UPDATE(Users).set({ active: false }).where({ ID: target.ID });
    return true;
  });

  // ----- reactivateUser -----
  srv.on('reactivateUser', async (req) => {
    const callerOrgId = await requireActiveUser(req);
    requireRole(req, 'company_advanced');

    const target = await credentials.findById(req.data.userId);
    if (!target) req.reject(404, 'User not found.');
    if (target.organization_ID !== callerOrgId) {
      req.reject(403, 'Users can only be managed within your own organization.');
    }

    await UPDATE(Users).set({ active: true, failed_login_count: 0, locked_until: null })
      .where({ ID: target.ID });
    return true;
  });
};
