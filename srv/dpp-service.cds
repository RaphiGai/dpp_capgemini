using { dpp as db } from '../db/schema';

/**
 * DPPService — primary OData V4 service for company users.
 *
 * NOTE (May 2026): Authorization is enforced programmatically in the service
 * handlers (`srv/dpp-service.js` + `srv/handlers/auth-helpers.js`), NOT via
 * `@restrict`. The service-level `requires: 'authenticated-user'` is only the
 * "logged-in yes/no" gate; the actual app role (`company_advanced` /
 * `company_user`) and the tenant scoping are resolved from the DB Users table
 * and applied in `srv.before(*)` handlers. This sidesteps a CAP 9 middleware-
 * timing issue where app-resolved roles arrived too late for `@restrict`.
 */
service DPPService @(
  path     : '/odata/v4/dpp',
  requires : 'authenticated-user'
) {

  type QRCodeImage : {
    png     : LargeString;
    payload : String;
  };

  type MeInfo : {
    id               : String;
    displayName      : String;
    email            : String;
    role             : String;
    organizationId   : String;
    tenantId         : String;
    mustResetPassword: Boolean;
    appearanceTheme  : String;
  };

  // Results of the user-management actions. Temp passwords are returned ONCE to
  // the calling company_advanced and are never persisted in plaintext.
  type NewUserResult      : { userId : String; username : String; email : String; role : String; tempPassword : String; };
  type TempPasswordResult : { userId : String; tempPassword : String; };

  // Live-aggregated footprint for the pre-publication review (computed by srv/lib/aggregator).
  type AggregatedFootprint : {
    co2_footprint_kg      : Decimal(14, 6);
    recycled_content_pct  : Decimal(14, 6);
    incomplete            : Boolean;
    missing               : LargeString;   // JSON array of unresolved component edges
    breakdown             : LargeString;   // JSON: { own_co2_kg, components:[{name,co2_kg,recycled_pct,mass_kg,...}] }
  };

  entity Organizations         as projection on db.Organizations;

  // Credential/security fields (password_hash, password_updated_at,
  // failed_login_count, locked_until) are deliberately NOT projected — they can
  // be neither read nor written via OData. `username` + `must_reset_password`
  // are exposed for the admin UI; `must_reset_password` is read-only (only the
  // user-management actions flip it).
  entity Users as projection on db.Users {
    ID, email, display_name, organization, role, external_user_id, active,
    username, must_reset_password
  };
  annotate Users with { must_reset_password @readonly; }

  entity BusinessPartners      as projection on db.BusinessPartners;
  entity BusinessPartnerRoles  as projection on db.BusinessPartnerRoles;

  entity Products as projection on db.Products actions {
    @Common.SideEffects: { TargetProperties: ['status'] }
    action archiveProduct() returns Products;
  };

  entity ProductVariants       as projection on db.ProductVariants;
  entity Batches               as projection on db.Batches;
  entity ProductItems          as projection on db.ProductItems;
  entity ProductBOMs           as projection on db.ProductBOMs;
  entity BatchComponents       as projection on db.BatchComponents;

  // Certificates & proofs at product/batch level. The @Core.Media* annotations
  // propagate from the DB entity, so OData exposes Documents(ID)/content for
  // streaming download (GET) and upload (PUT). See srv/handlers/document-handlers.js.
  entity Documents             as projection on db.Documents;

  entity DPPs as projection on db.DPPs actions {
    @Common.SideEffects: { TargetProperties: ['status', 'approved_at'] }
    action   approveDPP()                            returns DPPs;

    @Common.SideEffects: { TargetProperties: ['status', 'published_at', 'qr_token', 'qr_payload_url', 'public_url', 'current_version'] }
    action   publishDPP(change_reason : String(500)) returns DPPs;

    @Common.SideEffects: { TargetProperties: ['status', 'archived_at'] }
    action   archiveDPP()                            returns DPPs;

    @Common.SideEffects: { TargetProperties: ['status', 'archived_at'] }
    action   unarchiveDPP()                          returns DPPs;

    @Common.SideEffects: { TargetProperties: ['current_version', 'last_updated'] }
    action   createDPPVersion(change_reason : String(500)) returns DPPs;

    @Common.SideEffects: { TargetProperties: ['qr_token', 'qr_payload_url'] }
    action   regenerateQRToken()                     returns DPPs;

    function generateQRCode()                        returns QRCodeImage;

    // Live aggregation across the BOM tree for review before publishing.
    function aggregatedFootprint()                   returns AggregatedFootprint;
  };

  entity QRCodes               as projection on db.QRCodes;
  entity DPPMarketingLinks     as projection on db.DPPMarketingLinks;

  // Immutable audit trail of published versions (US5.9). Read-only: writes are
  // rejected in srv/handlers/dpp-handlers.js; rows are inserted server-side on publish.
  entity DPPVersions           as projection on db.DPPVersions;

  function me() returns MeInfo;

  // ----- User management (own auth) — see srv/handlers/user-handlers.js -----
  // createUser / resetUserPassword / deactivateUser / reactivateUser are
  // company_advanced-only (enforced via auth-helpers.WRITE_EVENTS + the
  // before('*') gate). changePassword and updateProfile are callable by any active
  // user on their OWN account (NOT write events), so read-only company_user can both
  // complete the forced first-login change and maintain their own name/email.
  action createUser(username : String(60), email : db.EmailAddr, displayName : String(120), role : db.UserRole) returns NewUserResult;
  action resetUserPassword(userId : String) returns TempPasswordResult;
  action changePassword(currentPassword : String, newPassword : String) returns Boolean;
  action updateProfile(displayName : String(120), email : db.EmailAddr, appearanceTheme : String(20)) returns Boolean;
  action deactivateUser(userId : String) returns Boolean;
  action reactivateUser(userId : String) returns Boolean;

  // ----- Sustainability analytics (US9.6) — see srv/handlers/analytics-handlers.js -----
  // Org-wide, tenant-scoped KPI/breakdown payload as a JSON string. company_advanced-only
  // (enforced in the handler). Modelled as a read-only action (vs a function) only so the
  // optional date/criteria parameters travel in a JSON body; it performs no writes and is
  // intentionally NOT in auth-helpers.WRITE_EVENTS.
  action sustainabilityAnalytics(
    dateFrom    : Date,
    dateTo      : Date,
    productType : String(20),
    esprStatus  : String(20)
  ) returns LargeString;

  // ----- Compliance analytics (US9.x) — see srv/handlers/compliance-handlers.js -----
  // ESPR readiness + documentation-evidence completeness + the declared-not-evidenced
  // integrity cross-check, as a JSON string. company_advanced-only, read-only (same
  // contract as sustainabilityAnalytics: NOT in auth-helpers.WRITE_EVENTS).
  action complianceAnalytics(
    dateFrom    : Date,
    dateTo      : Date,
    productType : String(20),
    esprStatus  : String(20)
  ) returns LargeString;
}
