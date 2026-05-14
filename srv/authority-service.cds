using { dpp as db } from '../db/schema';

/**
 * AuthorityService — cross-tenant read-only view for market-surveillance authorities.
 *
 * Authority users hold the `authority` scope but no `tenant` attribute, so no
 * tenant `where` clause is applied: an authority can see every DPP from every
 * organisation, including entries with `visibility=authority_only`.
 *
 * Document binary content is excluded — authorities can download via a separate
 * signed-URL endpoint (TBD) so that large media doesn't pollute the OData stream.
 */
service AuthorityService @(
  path     : '/odata/v4/authority',
  requires : 'authority'
) {
  @readonly entity Organizations         as projection on db.Organizations;
  @readonly entity Facilities            as projection on db.Facilities;
  @readonly entity Products              as projection on db.Products;
  @readonly entity DPPs                  as projection on db.DPPs;
  @readonly entity MaterialComposition   as projection on db.MaterialComposition;
  @readonly entity ComplianceStatements  as projection on db.ComplianceStatements;
  @readonly entity Documents             as projection on db.Documents excluding { content };
  @readonly entity SubstancesOfConcern   as projection on db.SubstancesOfConcern;
  @readonly entity CareInstructions      as projection on db.CareInstructions;
  @readonly entity SustainabilityIndicators as projection on db.SustainabilityIndicators;
  @readonly entity SupplyChainSteps      as projection on db.SupplyChainSteps;
  @readonly entity LifecycleEvents       as projection on db.LifecycleEvents;
  @readonly entity BlockchainAnchors     as projection on db.BlockchainAnchors;
}
