using { dpp as db } from '../db/schema';

/**
 * AuthorityService — cross-tenant read-only view for end-users
 * (market-surveillance authorities, external auditors, regulators).
 *
 * No tenant `where` clause: an end_user can read DPPs and supporting data
 * from every organisation. Document binary content is excluded — large
 * media is fetched via a separate signed download URL when needed.
 */
service AuthorityService @(
  path     : '/odata/v4/authority',
  requires : 'end_user'
) {
  @readonly entity Organizations         as projection on db.Organizations;
  @readonly entity BusinessPartners      as projection on db.BusinessPartners;
  @readonly entity Products              as projection on db.Products;
  @readonly entity ProductVariants       as projection on db.ProductVariants;
  @readonly entity Batches               as projection on db.Batches;
  @readonly entity ProductItems          as projection on db.ProductItems;
  @readonly entity ProductBOMs           as projection on db.ProductBOMs;
  @readonly entity DPPs                  as projection on db.DPPs;
  @readonly entity QRCodes               as projection on db.QRCodes;
}
