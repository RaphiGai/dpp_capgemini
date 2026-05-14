using { dpp as db } from '../db/schema';

/**
 * DPPService — primary OData V4 service for company users (admin/editor/viewer).
 *
 * Authorisation is layered:
 *   - `@requires: 'authenticated-user'` blocks anonymous access service-wide.
 *   - Each entity gets `@restrict` rules that combine the role (admin/editor/viewer)
 *     with a `where` clause pinning visibility to the caller's tenant attribute
 *     (`$user.tenant`, populated from the XSUAA token attribute `tenant`).
 *
 * Tenants are modelled as a string column `tenant_id` on `Organizations`. The
 * `where` filters walk the association chain from each entity back to the
 * owning organization.
 */
service DPPService @(
  path     : '/odata/v4/dpp',
  requires : 'authenticated-user'
) {

  // ---- Master data: organisation & facility (tenant-scoped) ----

  @restrict: [
    { grant: 'READ', to: ['admin', 'editor', 'viewer'], where: 'tenant_id = $user.tenant' },
    { grant: ['UPDATE'], to: ['admin'], where: 'tenant_id = $user.tenant' }
  ]
  entity Organizations as projection on db.Organizations;

  @restrict: [
    { grant: 'READ', to: ['admin', 'editor', 'viewer'], where: 'organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['admin'], where: 'organization.tenant_id = $user.tenant' }
  ]
  entity Facilities as projection on db.Facilities;

  @restrict: [
    { grant: 'READ', to: ['admin'], where: 'organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['admin'], where: 'organization.tenant_id = $user.tenant' }
  ]
  entity Users as projection on db.Users;

  // ---- Products (tenant-scoped) ----

  @restrict: [
    { grant: 'READ',                          to: ['admin', 'editor', 'viewer'], where: 'owning_organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'],  to: ['admin', 'editor'],           where: 'owning_organization.tenant_id = $user.tenant' }
  ]
  entity Products as projection on db.Products;

  // ---- DPP core ----

  @restrict: [
    { grant: '*',    to: ['admin', 'editor'], where: 'issuing_organization.tenant_id = $user.tenant' },
    { grant: 'READ', to: ['viewer'],          where: 'issuing_organization.tenant_id = $user.tenant' }
  ]
  entity DPPs as projection on db.DPPs actions {
    @Common.SideEffects: { TargetProperties: ['status', 'published_at', 'qr_token', 'qr_payload_url'] }
    action   publishDPP()         returns DPPs;

    @Common.SideEffects: { TargetProperties: ['status', 'archived_at'] }
    action   archiveDPP()         returns DPPs;

    @Common.SideEffects: { TargetProperties: ['data_hash', 'data_hash_at'] }
    action   anchorOnBlockchain() returns BlockchainAnchors;

    function generateQRCode()     returns { png : LargeString; payload : String };
  };

  // ---- DPP child entities (Composition) ----

  @restrict: [
    { grant: 'READ',                         to: ['admin', 'editor', 'viewer'], where: 'dpp.issuing_organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['admin', 'editor'],           where: 'dpp.issuing_organization.tenant_id = $user.tenant' }
  ]
  entity MaterialComposition     as projection on db.MaterialComposition;

  @restrict: [
    { grant: 'READ',                         to: ['admin', 'editor', 'viewer'], where: 'dpp.issuing_organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['admin', 'editor'],           where: 'dpp.issuing_organization.tenant_id = $user.tenant' }
  ]
  entity ComplianceStatements    as projection on db.ComplianceStatements;

  @restrict: [
    { grant: 'READ',                         to: ['admin', 'editor', 'viewer'], where: 'dpp.issuing_organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['admin', 'editor'],           where: 'dpp.issuing_organization.tenant_id = $user.tenant' }
  ]
  entity Documents               as projection on db.Documents;

  @restrict: [
    { grant: 'READ',                         to: ['admin', 'editor', 'viewer'], where: 'dpp.issuing_organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['admin', 'editor'],           where: 'dpp.issuing_organization.tenant_id = $user.tenant' }
  ]
  entity SubstancesOfConcern     as projection on db.SubstancesOfConcern;

  @restrict: [
    { grant: 'READ',                         to: ['admin', 'editor', 'viewer'], where: 'dpp.issuing_organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['admin', 'editor'],           where: 'dpp.issuing_organization.tenant_id = $user.tenant' }
  ]
  entity CareInstructions        as projection on db.CareInstructions;

  @restrict: [
    { grant: 'READ',                         to: ['admin', 'editor', 'viewer'], where: 'dpp.issuing_organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['admin', 'editor'],           where: 'dpp.issuing_organization.tenant_id = $user.tenant' }
  ]
  entity SustainabilityIndicators as projection on db.SustainabilityIndicators;

  @restrict: [
    { grant: 'READ',                         to: ['admin', 'editor', 'viewer'], where: 'dpp.issuing_organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['admin', 'editor'],           where: 'dpp.issuing_organization.tenant_id = $user.tenant' }
  ]
  entity SupplyChainSteps         as projection on db.SupplyChainSteps;

  @restrict: [
    { grant: 'READ',                         to: ['admin', 'editor', 'viewer'], where: 'dpp.issuing_organization.tenant_id = $user.tenant' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['admin', 'editor'],           where: 'dpp.issuing_organization.tenant_id = $user.tenant' }
  ]
  entity LifecycleEvents          as projection on db.LifecycleEvents;

  // ---- Blockchain anchors (read-only for company users) ----

  @readonly
  @restrict: [
    { grant: 'READ', to: ['admin', 'editor', 'viewer'], where: 'dpp.issuing_organization.tenant_id = $user.tenant' }
  ]
  entity BlockchainAnchors        as projection on db.BlockchainAnchors;
}
