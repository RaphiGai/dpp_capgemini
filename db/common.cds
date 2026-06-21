namespace dpp;

type CountryISO2  : String(2);
type GTIN         : String(14);
type GLN          : String(13);

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
  item;
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
  CSDDD;
  CSRD;
  AGEC_FR;
  GOTS;
  OEKO_TEX;
}

type DocumentType : String(20) enum {
  certificate;
  audit_report;
  test_report;
  declaration;
  safety_sheet;
}

type UserRole : String(20) enum {
  admin;
  dpp_editor;
  authority;
}

type FacilityType : String(30);
type AuditStatus  : String(30);
