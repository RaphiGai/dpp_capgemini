using { dpp as db } from '../db/schema';

/**
 * DPPService — primary OData V4 service for company users.
 *
 * Roles (from `dpp.UserRole`):
 *   - company_advanced : full CRUD on tenant data, BOM, DPPs + user management
 *                        + import/export of CSV / Excel.
 *   - company_user     : read-only on tenant data + export.
 *   - end_user         : cross-tenant read-only (served by AuthorityService instead).
 *
 * Tenant isolation is enforced via `@restrict.where` clauses that walk back to
 * `owning_organization.tenant_id = $user.tenant`. The role + tenant attribute
 * are resolved by the backend from the `Users` table at request time (see
 * srv/server.js).
 */
service DPPService @(
  path     : '/odata/v4/dpp',
  requires : 'authenticated-user'
) {

  // ---- Named return types ----

  type FileEnvelope : {
    filename       : String;
    content_base64 : LargeString;
  };

  type QRCodeImage : {
    png     : LargeString;
    payload : String;
  };

  type ImportError : {
    row     : Integer;
    field   : String;
    message : String;
  };

  type ImportReport : {
    total    : Integer;
    imported : Integer;
    rejected : Integer;
    errors   : array of ImportError;
  };

  // ---- Company & users ----

  @restrict: [
    { grant: 'READ',   to: ['company_advanced', 'company_user'], where: 'tenant_id = $user.tenant' },
    { grant: 'UPDATE', to: ['company_advanced'],                 where: 'tenant_id = $user.tenant' }
  ]
  entity Organizations as projection on db.Organizations;

  @restrict: [
    { grant: '*', to: ['company_advanced'], where: 'organization.tenant_id = $user.tenant' }
  ]
  entity Users as projection on db.Users;

  // ---- Business partners ----

  @restrict: [
    { grant: 'READ', to: ['company_advanced', 'company_user'], where: 'owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['company_advanced'],                 where: 'owning_organization.tenant_id = $user.tenant' }
  ]
  entity BusinessPartners as projection on db.BusinessPartners;

  @restrict: [
    { grant: 'READ', to: ['company_advanced', 'company_user'], where: 'partner.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['company_advanced'],                 where: 'partner.owning_organization.tenant_id = $user.tenant' }
  ]
  entity BusinessPartnerRoles as projection on db.BusinessPartnerRoles;

  // ---- Products & hierarchy ----

  @restrict: [
    { grant: 'READ', to: ['company_advanced', 'company_user'], where: 'owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['company_advanced'],                 where: 'owning_organization.tenant_id = $user.tenant' }
  ]
  entity Products as projection on db.Products actions {
    @Common.SideEffects: { TargetProperties: ['status'] }
    action archiveProduct() returns Products;
  };

  @restrict: [
    { grant: 'READ', to: ['company_advanced', 'company_user'], where: 'product.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['company_advanced'],                 where: 'product.owning_organization.tenant_id = $user.tenant' }
  ]
  entity ProductVariants as projection on db.ProductVariants;

  @restrict: [
    { grant: 'READ', to: ['company_advanced', 'company_user'], where: 'variant.product.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['company_advanced'],                 where: 'variant.product.owning_organization.tenant_id = $user.tenant' }
  ]
  entity Batches as projection on db.Batches;

  @restrict: [
    { grant: 'READ', to: ['company_advanced', 'company_user'], where: 'batch.variant.product.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['company_advanced'],                 where: 'batch.variant.product.owning_organization.tenant_id = $user.tenant' }
  ]
  entity ProductItems as projection on db.ProductItems;

  @restrict: [
    { grant: 'READ', to: ['company_advanced', 'company_user'], where: 'parent.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['company_advanced'],                 where: 'parent.owning_organization.tenant_id = $user.tenant' }
  ]
  entity ProductBOMs as projection on db.ProductBOMs;

  // ---- Digital Product Passport ----

  @restrict: [
    { grant: 'READ', to: ['company_advanced', 'company_user'], where: 'product.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['company_advanced'],                 where: 'product.owning_organization.tenant_id = $user.tenant' }
  ]
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
    function exportDPPasPDF()                        returns FileEnvelope;
    function generateQRLabel()                       returns FileEnvelope;
  };

  @restrict: [
    { grant: 'READ', to: ['company_advanced', 'company_user'], where: 'dpp.product.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['company_advanced'],                 where: 'dpp.product.owning_organization.tenant_id = $user.tenant' }
  ]
  entity QRCodes as projection on db.QRCodes;

  // ---- Data import & export ----

  @restrict: [ { grant: '*', to: ['company_advanced'] } ]
  action importProducts(file : LargeString) returns ImportReport;

  @restrict: [ { grant: '*', to: ['company_advanced'] } ]
  action importBatches(file : LargeString)  returns ImportReport;

  @restrict: [ { grant: '*', to: ['company_advanced'] } ]
  action importBOM(file : LargeString)      returns ImportReport;

  @restrict: [ { grant: '*', to: ['company_advanced', 'company_user'] } ]
  function downloadTemplate(template : String) returns FileEnvelope;

  @restrict: [ { grant: '*', to: ['company_advanced', 'company_user'] } ]
  function exportProducts()                     returns FileEnvelope;

  @restrict: [ { grant: '*', to: ['company_advanced', 'company_user'] } ]
  function exportBOM()                          returns FileEnvelope;

  @restrict: [ { grant: '*', to: ['company_advanced', 'company_user'] } ]
  function exportDPP(dppId : String)            returns FileEnvelope;

  @restrict: [ { grant: '*', to: ['company_advanced', 'company_user'] } ]
  function exportDPPs(dppIds : String)          returns FileEnvelope;

  @restrict: [ { grant: '*', to: ['company_advanced', 'company_user'] } ]
  function exportTraceability()                 returns FileEnvelope;
}
