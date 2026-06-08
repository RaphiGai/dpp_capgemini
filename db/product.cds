using {
  dpp.identified,
  dpp.CountryISO2,
  dpp.GTIN,
  dpp.URL,
  dpp.ProductType,
  dpp.ProductStatus,
  dpp.VariantStatus,
  dpp.BatchStatus,
  dpp.ProductItemStatus,
  dpp.BOMStatus,
  dpp.ESPRComplianceStatus
} from './common';
using { dpp.Organizations, dpp.BusinessPartners, dpp.audited } from './org';
using { dpp.DPPs } from './dpp';

namespace dpp;

// ----- Product master data (catalogue Sheet 2 R6) -----
// Generic product entity: finished product, material, component or packaging.
entity Products : identified, audited {
  owning_organization   : Association to Organizations not null;
  product_type          : ProductType  not null default 'finished';
  name                  : String(120)  not null;
  brand                 : String(120);
  category              : String(60);
  model                 : String(120);
  description           : String(500);
  gtin                  : GTIN;
  fibre_composition     : String(500);
  care_instructions     : String(500);
  repair_instructions   : String(500);
  disposal_instructions : String(500);
  country_of_origin     : CountryISO2;
  substances_of_concern : String(500);                       // catalogue Sheet 3 R37 (Text)
  espr_compliance       : ESPRComplianceStatus default 'draft';
  status                : ProductStatus        default 'draft';

  variants : Association to many ProductVariants on variants.product = $self;
}

annotate Products with @assert.unique : { gtin_per_org : [gtin, owning_organization] };

// ----- Variant level (Sheet 2 R7) -----
entity ProductVariants : identified, audited {
  product  : Association to Products not null;
  color    : String(40);
  size     : String(20);
  sku      : String(40);
  gtin     : GTIN;
  weight_g : Integer;
  status   : VariantStatus default 'active';

  batches : Association to many Batches    on batches.variant = $self;
  bom     : Composition of many ProductBOMs on bom.parent     = $self;
}

annotate ProductVariants with @assert.unique : { sku_per_product : [sku, product] };

// ----- Batch level (Sheet 2 R8) -----
entity Batches : identified, audited {
  variant              : Association to ProductVariants not null;
  batch_number         : String(40);
  production_date      : Date;
  factory              : Association to BusinessPartners;
  supplier             : Association to BusinessPartners;
  country_of_origin    : CountryISO2;
  production_stage     : String(60);
  co2_footprint_kg     : Decimal(10, 3);
  recycled_content_pct : Decimal(5, 2);
  status               : BatchStatus default 'draft';

  items : Association to many ProductItems on items.batch = $self;
}

annotate Batches with @assert.unique : { batch_per_variant : [batch_number, variant] };

// ----- Serialized item level -----
// Individual produced unit within a batch. Each item carries exactly one unique
// DPP (created automatically on insert, see srv/handlers/product-item-handlers.js).
entity ProductItems : identified, audited {
  batch              : Association to Batches not null;
  serial_number      : String(60) not null;                  // manufacturer serial (unique per batch)
  upi                : String(60) not null;                  // Unique Product Identifier (ESPR) — globally unique; resolves the DPP
  manufacturing_date : Date;
  status             : ProductItemStatus default 'active';

  dpp : Association to one DPPs on dpp.item = $self;   // 1:1 reverse navigation
}

annotate ProductItems with @assert.unique : {
  serial_per_batch : [serial_number, batch],
  upi_unique       : [upi]
};

// ----- Bill of Materials (Sheet 2 R10) -----
// BOM is anchored at variant level: a specific variant of a finished product
// consumes a defined set of component products (which may themselves carry an
// own DPP through their own production process).
entity ProductBOMs : identified, audited {
  parent           : Association to ProductVariants not null;
  component        : Association to Products        not null;
  quantity         : Decimal(10, 3);
  unit             : String(8);
  component_role   : String(60);
  is_mandatory     : Boolean default true;
  sub_dpp          : Association to DPPs;   // internal DPP of the component (own data)
  external_dpp_url : URL;                   // alternative: external supplier-hosted DPP link
  status           : BOMStatus default 'active';
}

annotate ProductBOMs with @assert.unique : { edge : [parent, component] };

// ----- Per-batch component sourcing -----
// Which supplier delivered each BOM component for a specific batch. Suppliers can
// differ per production run, so this is recorded per (batch, BOM line) rather than
// on the variant-level BOM. One row per (batch, bom).
entity BatchComponents : identified {
  batch    : Association to Batches     not null;
  bom      : Association to ProductBOMs not null;
  supplier : Association to BusinessPartners;
}

annotate BatchComponents with @assert.unique : { per_batch_bom : [batch, bom] };
