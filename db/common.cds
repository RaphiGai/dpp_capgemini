namespace dpp;

type CountryISO2 : String(2);
type GTIN        : String(14);
type GLN         : String(13);
type EmailAddr   : String(254);
type URL         : String(500);

type ProductType : String(12) enum {
  finished;
  material;
  component;
  packaging;
}

type ProductStatus : String(12) enum {
  draft;
  approved;
  published;
  archived;
}

type VariantStatus : String(10) enum {
  active;
  inactive;
  archived;
}

type BatchStatus : String(12) enum {
  draft;
  approved;
  archived;
}

type ProductItemStatus : String(12) enum {
  active;
  sold;
  returned;
  recycled;
  archived;
}

type BOMStatus : String(12) enum {
  active;
  archived;
}

type DPPStatus : String(12) enum {
  draft;
  in_review;
  approved;
  published;
  archived;
}

type DPPType : String(12) enum {
  product;
  material;
  item;
}

type Visibility : String(8) enum {
  internal;
  public;
}

type QRCodeStatus : String(10) enum {
  active;
  invalid;
  replaced;
}

type ESPRComplianceStatus : String(16) enum {
  draft;
  in_review;
  compliant;
  non_compliant;
}

type MarketingLinkType : String(20) enum {
  advertisement;
  product_info;
  care_product;
  promotion;
  related_product;
  other;
}

type UserRole : String(20) enum {
  company_advanced;
  company_user;
}

type BusinessPartnerRole : String(24) enum {
  supplier;
  manufacturer;
  recycler;
  certification_body;
  distributor;
  retailer;
  logistics_provider;
}

// Generic string-id aspect (replacement for @sap/cds/common.cuid, which forces UUID).
// Allows human-readable IDs in sample data (e.g. `prod-001`) and accepts upstream
// systems' identifiers as-is.
aspect identified {
  key ID : String(36);
}
