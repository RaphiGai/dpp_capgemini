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
    id             : String;
    displayName    : String;
    email          : String;
    role           : String;
    organizationId : String;
    tenantId       : String;
  };

  entity Organizations         as projection on db.Organizations;
  entity Users                 as projection on db.Users;
  entity BusinessPartners      as projection on db.BusinessPartners;
  entity BusinessPartnerRoles  as projection on db.BusinessPartnerRoles;

  entity Products as projection on db.Products actions {
    @Common.SideEffects: { TargetProperties: ['status'] }
    action archiveProduct() returns Products;
  };

  entity ProductVariants       as projection on db.ProductVariants;
  entity Batches               as projection on db.Batches;
  entity ProductBOMs           as projection on db.ProductBOMs;

  entity DPPs as projection on db.DPPs actions {
    @Common.SideEffects: { TargetProperties: ['status', 'approved_at'] }
    action   approveDPP()                            returns DPPs;

    @Common.SideEffects: { TargetProperties: ['status', 'published_at', 'qr_token', 'qr_payload_url', 'public_url', 'current_version'] }
    action   publishDPP(change_reason : String(500)) returns DPPs;

    @Common.SideEffects: { TargetProperties: ['status', 'archived_at'] }
    action   archiveDPP()                            returns DPPs;

    @Common.SideEffects: { TargetProperties: ['qr_token', 'qr_payload_url'] }
    action   regenerateQRToken()                     returns DPPs;

    function generateQRCode()                        returns QRCodeImage;
  };

  entity QRCodes               as projection on db.QRCodes;

  function me() returns MeInfo;
}
