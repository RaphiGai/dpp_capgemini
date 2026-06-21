using { managed } from '@sap/cds/common';
using { dpp.Organizations, dpp.Facilities } from './org';
using { dpp.CountryISO2, dpp.GTIN, dpp.DPPStatus, dpp.Visibility, dpp.Verification,
        dpp.Granularity, dpp.MaterialClass, dpp.ComplianceStandard,
        dpp.DocumentType } from './common';

namespace dpp;

entity Products : managed {
  key ID                : String(20);
  name                  : String(120) not null;
  gtin                  : GTIN;
  category              : String(40);
  owning_organization   : Association to Organizations;
}

entity DPPs : managed {
  key ID                          : String(36);
  product                         : Association to Products;
  issuing_organization            : Association to Organizations;
  facility                        : Association to Facilities;
  gtin                            : GTIN;
  granularity_level               : Granularity;
  batch_lot_number                : String(40);
  serial_number                   : String(40);
  status                          : DPPStatus default 'draft';
  visibility                      : Visibility default 'internal';
  verification_status             : Verification default 'declared';
  manufacturing_country_iso2      : CountryISO2;
  manufacturing_date_from         : Date;
  manufacturing_date_to           : Date;
  placed_on_market_date           : Date;
  published_at                    : Timestamp;
  qr_payload_url                  : String(500);

  materials  : Composition of many MaterialComposition  on materials.dpp  = $self;
  compliance : Composition of many ComplianceStatements on compliance.dpp = $self;
  documents  : Composition of many Documents            on documents.dpp  = $self;
}

entity MaterialComposition {
  key ID               : String(36);
  dpp                  : Association to DPPs;
  material_class       : MaterialClass;
  fiber_name           : String(80);
  percentage           : Decimal(5,2);
  country_of_origin    : CountryISO2;
  recycled_content_pct : Decimal(5,2) default 0;
  verification_status  : Verification default 'declared';
}

entity ComplianceStatements {
  key ID              : String(36);
  dpp                 : Association to DPPs;
  compliance_standard : ComplianceStandard;
  statement_text      : String(500);
  valid_from          : Date;
  valid_until         : Date;
  verification_status : Verification default 'declared';
}

entity Documents {
  key ID         : String(36);
  dpp            : Association to DPPs;
  document_type  : DocumentType;
  title          : String(200);
  file_name      : String(200);
  issuer         : String(120);
  issued_at      : Date;
  visibility     : Visibility default 'internal';
}
