using { dpp as db } from '../db/schema';

/**
 * DPPService — primary OData V4 service for company users.
 *
 * Roles (from `dpp.UserRole`):
 *   - admin    : full CRUD on tenant data + user management.
 *   - advanced : full CRUD on products / BOM / DPPs (US3.x, US4.x, US5.x).
 *   - user     : READ tenant data + CREATE/UPDATE on ProductItems and DPPs (US3.8, US6.1).
 *   - viewer   : READ-only.
 *
 * Tenant isolation is enforced via `@restrict.where` clauses that walk back to
 * `owning_organization.tenant_id = $user.tenant`.
 */
service DPPService @(
  path     : '/odata/v4/dpp',
  requires : 'authenticated-user'
) {

  // ---- Named return types (avoid anonymous `returns { ... }` blocks) ----

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
    { grant: 'READ',   to: ['admin', 'advanced', 'user', 'viewer'], where: 'tenant_id = $user.tenant' },
    { grant: 'UPDATE', to: ['admin'],                                 where: 'tenant_id = $user.tenant' }
  ]
  entity Organizations as projection on db.Organizations;

  @restrict: [
    { grant: 'READ', to: ['admin', 'advanced'], where: 'organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['admin'],             where: 'organization.tenant_id = $user.tenant' }
  ]
  entity Users as projection on db.Users;

  // ---- Business partners ----

  @restrict: [
    { grant: 'READ', to: ['admin', 'advanced', 'user', 'viewer'], where: 'owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['admin', 'advanced'],                   where: 'owning_organization.tenant_id = $user.tenant' }
  ]
  entity BusinessPartners as projection on db.BusinessPartners;

  @restrict: [
    { grant: 'READ', to: ['admin', 'advanced', 'user', 'viewer'], where: 'partner.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['admin', 'advanced'],                   where: 'partner.owning_organization.tenant_id = $user.tenant' }
  ]
  entity BusinessPartnerRoles as projection on db.BusinessPartnerRoles;

  // ---- Products & hierarchy ----

  @restrict: [
    { grant: 'READ', to: ['admin', 'advanced', 'user', 'viewer'], where: 'owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['admin', 'advanced'],                    where: 'owning_organization.tenant_id = $user.tenant' }
  ]
  entity Products as projection on db.Products actions {
    @Common.SideEffects: { TargetProperties: ['status'] }
    action archiveProduct() returns Products;
  };

  @restrict: [
    { grant: 'READ', to: ['admin', 'advanced', 'user', 'viewer'], where: 'product.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['admin', 'advanced'],                    where: 'product.owning_organization.tenant_id = $user.tenant' }
  ]
  entity ProductVariants as projection on db.ProductVariants;

  @restrict: [
    { grant: 'READ', to: ['admin', 'advanced', 'user', 'viewer'], where: 'variant.product.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['admin', 'advanced'],                    where: 'variant.product.owning_organization.tenant_id = $user.tenant' }
  ]
  entity Batches as projection on db.Batches;

  @restrict: [
    { grant: 'READ',               to: ['admin', 'advanced', 'user', 'viewer'], where: 'batch.variant.product.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',                  to: ['admin', 'advanced'],                    where: 'batch.variant.product.owning_organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE'], to: ['user'],                                 where: 'batch.variant.product.owning_organization.tenant_id = $user.tenant' }
  ]
  entity ProductItems as projection on db.ProductItems;

  @restrict: [
    { grant: 'READ', to: ['admin', 'advanced', 'user', 'viewer'], where: 'parent.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['admin', 'advanced'],                    where: 'parent.owning_organization.tenant_id = $user.tenant' }
  ]
  entity ProductBOMs as projection on db.ProductBOMs;

  // ---- Digital Product Passport ----

  @restrict: [
    { grant: 'READ',               to: ['admin', 'advanced', 'user', 'viewer'], where: 'product.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',                  to: ['admin', 'advanced'],                    where: 'product.owning_organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE'], to: ['user'],                                 where: 'product.owning_organization.tenant_id = $user.tenant' }
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
    { grant: 'READ', to: ['admin', 'advanced', 'user', 'viewer'], where: 'dpp.product.owning_organization.tenant_id = $user.tenant' },
    { grant: '*',    to: ['admin', 'advanced'],                    where: 'dpp.product.owning_organization.tenant_id = $user.tenant' }
  ]
  entity QRCodes as projection on db.QRCodes;

  // ---- Data import & export (Epic 7) ----

  @restrict: [ { grant: '*', to: ['admin', 'advanced'] } ]
  action importProducts(file : LargeString) returns ImportReport;

  @restrict: [ { grant: '*', to: ['admin', 'advanced'] } ]
  action importBatches(file : LargeString)  returns ImportReport;

  @restrict: [ { grant: '*', to: ['admin', 'advanced'] } ]
  action importBOM(file : LargeString)      returns ImportReport;

  @restrict: [ { grant: '*', to: ['admin', 'advanced', 'user', 'viewer'] } ]
  function downloadTemplate(template : String) returns FileEnvelope;

  @restrict: [ { grant: '*', to: ['admin', 'advanced', 'user', 'viewer'] } ]
  function exportProducts()                     returns FileEnvelope;

  @restrict: [ { grant: '*', to: ['admin', 'advanced', 'user', 'viewer'] } ]
  function exportBOM()                          returns FileEnvelope;

  @restrict: [ { grant: '*', to: ['admin', 'advanced', 'user', 'viewer'] } ]
  function exportDPP(dppId : String)            returns FileEnvelope;

  @restrict: [ { grant: '*', to: ['admin', 'advanced', 'user', 'viewer'] } ]
  function exportDPPs(dppIds : String)          returns FileEnvelope;

  @restrict: [ { grant: '*', to: ['admin', 'advanced', 'user', 'viewer'] } ]
  function exportTraceability()                 returns FileEnvelope;
}
