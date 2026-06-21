using { managed } from '@sap/cds/common';
using { dpp.CountryISO2, dpp.GLN, dpp.OrgType, dpp.UserRole,
        dpp.FacilityType, dpp.AuditStatus } from './common';

namespace dpp;

entity Organizations : managed {
  key ID             : String(20);
  legal_name         : String(120) not null;
  trade_name         : String(120);
  organization_type  : OrgType;
  country_iso2       : CountryISO2;
  city               : String(80);
  gln                : GLN;
  is_platform_tenant : Boolean default false;

  facilities : Association to many Facilities on facilities.organization = $self;
  users      : Association to many Users      on users.organization      = $self;
}

entity Facilities : managed {
  key ID           : String(20);
  organization     : Association to Organizations;
  name             : String(120) not null;
  facility_type    : FacilityType;
  country_iso2     : CountryISO2;
  region           : String(80);
  gln              : GLN;
  latitude         : Decimal(9,6);
  longitude        : Decimal(9,6);
  audit_status     : AuditStatus;
  last_audit_date  : Date;
}

entity Users : managed {
  key ID         : String(20);
  email          : String(120) not null;
  display_name   : String(120);
  organization   : Association to Organizations;
  role           : UserRole;
}
