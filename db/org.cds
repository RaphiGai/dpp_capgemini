using { managed } from '@sap/cds/common';
using {
  dpp.CountryISO2,
  dpp.GLN,
  dpp.OrgType,
  dpp.UserRole,
  dpp.FacilityType,
  dpp.AuditStatus,
  dpp.EmailAddr
} from './common';

namespace dpp;

entity Organizations : managed {
  key ID             : String(36);
  legal_name         : String(120) not null;
  trade_name         : String(120);
  organization_type  : OrgType;
  country_iso2       : CountryISO2;
  city               : String(80);
  gln                : GLN;
  tenant_id          : String(64) not null;
  is_platform_tenant : Boolean default false;

  facilities         : Association to many Facilities on facilities.organization = $self;
  users              : Association to many Users      on users.organization      = $self;
}

annotate Organizations with @assert.unique : { tenant : [tenant_id] };

entity Facilities : managed {
  key ID          : String(36);
  organization    : Association to Organizations not null;
  name            : String(120) not null;
  facility_type   : FacilityType;
  country_iso2    : CountryISO2;
  region          : String(80);
  gln             : GLN;
  latitude        : Decimal(9, 6);
  longitude       : Decimal(9, 6);
  audit_status    : AuditStatus;
  last_audit_date : Date;
}

entity Users : managed {
  key ID            : String(36);
  email             : EmailAddr not null;
  display_name      : String(120);
  organization      : Association to Organizations not null;
  role              : UserRole not null;
  external_user_id  : String(120);
}

annotate Users with @assert.unique : { email_per_org : [email, organization] };
