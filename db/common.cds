namespace dpp;

type CountryISO2 : String(2);
type GTIN        : String(14);
type GLN         : String(13);
type EmailAddr   : String(254);
type URL         : String(500);
type Sha256Hex   : String(64);
type TxHash      : String(66);

type OrgType : String(20) enum {
  brand;
  manufacturer;
  supplier;
  distributor;
  retailer;
  logistics_provider;
  recycler;
  repair_service;
  certifier;
  authority;
}

type DPPStatus : String(12) enum {
  draft;
  published;
  superseded;
  archived;
}

type Visibility : String(16) enum {
  public;
  restricted;
  internal;
  authority_only;
}

type Verification : String(20) enum {
  declared;
  documented;
  third_party_verified;
}

type Granularity : String(8) enum {
  model;
  batch;
}

type MaterialClass : String(20) enum {
  natural_plant;
  natural_animal;
  synthetic;
  regenerated;
  recycled;
  bio_based;
  metal;
  other;
}

type ComplianceStandard : String(30) enum {
  ESPR;
  EU_Textile_Labelling;
  REACH;
  SCIP;
  CSDDD;
  CSRD;
  AGEC_FR;
  GOTS;
  OEKO_TEX;
  BLUESIGN;
  CRADLE_TO_CRADLE;
}

type DocumentType : String(20) enum {
  certificate;
  audit_report;
  test_report;
  declaration;
  safety_sheet;
  care_label;
  repair_manual;
}

type UserRole : String(20) enum {
  admin;
  editor;
  viewer;
  authority;
}

type AnchorStatus : String(12) enum {
  pending;
  anchored;
  failed;
}

type LifecycleEventType : String(20) enum {
  manufactured;
  sold;
  repaired;
  resold;
  refurbished;
  recycled;
  disposed;
}

type SupplyChainTier : String(8) enum {
  tier1;
  tier2;
  tier3;
  tier4;
}

type FacilityType : String(30);
type AuditStatus  : String(30);

// Generic string-id aspect (replacement for @sap/cds/common.cuid, which forces UUID).
// We use human-readable IDs in sample data (e.g. `dpp-001`) and accept upstream
// systems' identifiers as-is.
aspect identified {
  key ID : String(36);
}
