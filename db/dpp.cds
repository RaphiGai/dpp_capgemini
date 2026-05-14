using { managed } from '@sap/cds/common';
using { dpp.identified } from './common';
using { dpp.Organizations, dpp.Facilities } from './org';
using {
  dpp.CountryISO2,
  dpp.GTIN,
  dpp.DPPStatus,
  dpp.Visibility,
  dpp.Verification,
  dpp.Granularity,
  dpp.MaterialClass,
  dpp.ComplianceStandard,
  dpp.DocumentType,
  dpp.LifecycleEventType,
  dpp.SupplyChainTier,
  dpp.URL,
  dpp.Sha256Hex
} from './common';

namespace dpp;

// ----- Product master data (model level) -----

entity Products : identified, managed {
  name                : String(120) not null;
  gtin                : GTIN;
  category            : String(40);
  brand               : String(120);
  description         : String(500);
  owning_organization : Association to Organizations not null;

  dpps                : Association to many DPPs on dpps.product = $self;
}

annotate Products with @assert.unique : { gtin_per_org : [gtin, owning_organization] };

// ----- Digital Product Passport (model or batch granularity) -----

entity DPPs : identified, managed {
  product                    : Association to Products      not null;
  issuing_organization       : Association to Organizations not null;
  facility                   : Association to Facilities;
  gtin                       : GTIN;
  granularity_level          : Granularity   not null default 'model';
  batch_lot_number           : String(40);
  status                     : DPPStatus     not null default 'draft';
  visibility                 : Visibility    not null default 'internal';
  verification_status        : Verification  not null default 'declared';
  manufacturing_country_iso2 : CountryISO2;
  manufacturing_date_from    : Date;
  manufacturing_date_to      : Date;
  placed_on_market_date      : Date;
  published_at               : Timestamp;
  archived_at                : Timestamp;
  qr_token                   : String(128);
  qr_payload_url             : URL;
  data_hash                  : Sha256Hex;
  data_hash_at               : Timestamp;

  materials      : Composition of many MaterialComposition       on materials.dpp      = $self;
  compliance     : Composition of many ComplianceStatements      on compliance.dpp     = $self;
  documents      : Composition of many Documents                 on documents.dpp      = $self;
  substances     : Composition of many SubstancesOfConcern       on substances.dpp     = $self;
  care           : Composition of many CareInstructions          on care.dpp           = $self;
  sustainability : Composition of one  SustainabilityIndicators  on sustainability.dpp = $self;
  supplychain    : Composition of many SupplyChainSteps          on supplychain.dpp    = $self;
  lifecycle      : Composition of many LifecycleEvents           on lifecycle.dpp      = $self;

  // BlockchainAnchors live in db/blockchain.cds. We do NOT add a backref Association
  // here to avoid a circular `using` between dpp.cds and blockchain.cds. The service
  // layer exposes anchors via its own entity projection (filterable by dpp_ID).
}

annotate DPPs with @assert.unique : {
  qrToken         : [qr_token],
  batchPerProduct : [product, batch_lot_number]
};

// ----- Composition children (lifecycle bound to a DPP) -----

entity MaterialComposition : identified {
  dpp                  : Association to DPPs not null;
  material_class       : MaterialClass        not null;
  fiber_name           : String(80)           not null;
  percentage           : Decimal(5, 2)        not null;
  country_of_origin    : CountryISO2;
  recycled_content_pct : Decimal(5, 2) default 0;
  verification_status  : Verification default 'declared';
  visibility           : Visibility   default 'public';
}

entity ComplianceStatements : identified, managed {
  dpp                 : Association to DPPs not null;
  compliance_standard : ComplianceStandard   not null;
  statement_text      : String(500);
  valid_from          : Date;
  valid_until         : Date;
  verification_status : Verification default 'declared';
  evidence_document   : Association to Documents;
  visibility          : Visibility   default 'public';
}

entity Documents : identified, managed {
  dpp           : Association to DPPs not null;
  document_type : DocumentType         not null;
  title         : String(200)          not null;
  file_name     : String(200);
  mime_type     : String(80);
  size_bytes    : Integer64;
  sha256        : Sha256Hex;
  storage_url   : URL;
  content       : LargeBinary @Core.MediaType : mime_type;
  issuer        : String(120);
  issued_at     : Date;
  visibility    : Visibility default 'restricted';
}

entity SubstancesOfConcern : identified {
  dpp               : Association to DPPs not null;
  cas_number        : String(20);
  ec_number         : String(20);
  substance_name    : String(200) not null;
  concentration_pct : Decimal(7, 4);
  scip_reference    : String(80);
  visibility        : Visibility default 'public';
}

entity CareInstructions : identified {
  dpp           : Association to DPPs not null;
  language      : String(8) not null default 'en';
  washing       : String(200);
  drying        : String(200);
  ironing       : String(200);
  bleaching     : String(200);
  professional  : String(200);
  repair_info   : String(500);
  disposal_info : String(500);
  visibility    : Visibility default 'public';
}

entity SustainabilityIndicators : identified {
  dpp                      : Association to DPPs not null;
  co2_footprint_kg         : Decimal(10, 3);
  co2_methodology          : String(80);
  water_usage_l            : Decimal(12, 2);
  energy_usage_kwh         : Decimal(12, 2);
  recycled_content_overall : Decimal(5, 2);
  durability_score         : Decimal(3, 1);
  repairability_score      : Decimal(3, 1);
  visibility               : Visibility default 'public';
}

entity SupplyChainSteps : identified {
  dpp          : Association to DPPs not null;
  tier         : SupplyChainTier      not null;
  step_name    : String(120)          not null;
  facility     : Association to Facilities;
  organization : Association to Organizations;
  country_iso2 : CountryISO2;
  start_date   : Date;
  end_date     : Date;
  visibility   : Visibility default 'restricted';
}

entity LifecycleEvents : identified, managed {
  dpp        : Association to DPPs not null;
  event_type : LifecycleEventType   not null;
  event_date : Timestamp            not null;
  actor      : Association to Organizations;
  notes      : String(500);
  visibility : Visibility default 'public';
}
