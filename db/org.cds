using {
  dpp.identified,
  dpp.CountryISO2,
  dpp.GLN,
  dpp.UserRole,
  dpp.BusinessPartnerRole,
  dpp.EmailAddr,
  dpp.URL
} from './common';

namespace dpp;

// Audit aspect (catalogue: CreatedBy / ChangedBy / CreatedAt / LastChange).
// createdBy/changedBy reference the acting Users row. All four are filled
// automatically by the central handlers in srv/dpp-service.js — never by the
// client. Applied to the eight catalogue business objects (not to Users,
// BusinessPartnerRoles or QRCodes).
aspect audited {
  createdAt  : Timestamp;
  createdBy  : Association to Users;
  lastChange : Timestamp;
  changedBy  : Association to Users;
}

entity Organizations : identified, audited {
  legal_name         : String(120) not null;
  trade_name         : String(120);
  country_iso2       : CountryISO2;
  city               : String(80);
  gln                : GLN;
  website_url        : URL;
  contact_email      : EmailAddr;
  tenant_id          : String(64) not null;
  is_platform_tenant : Boolean default false;

  users              : Association to many Users           on users.organization    = $self;
  partners           : Association to many BusinessPartners on partners.owning_organization = $self;
}

annotate Organizations with @assert.unique : { tenant : [tenant_id] };

entity Users : identified {
  email            : EmailAddr not null;
  display_name     : String(120);
  organization     : Association to Organizations not null;
  role             : UserRole not null;
  external_user_id : String(120);
  active           : Boolean default true;
}

annotate Users with @assert.unique : { email_per_org : [email, organization] };

entity BusinessPartners : identified, audited {
  owning_organization : Association to Organizations not null;
  name                : String(120) not null;
  country_iso2        : CountryISO2;
  city                : String(80);
  address             : String(200);
  contact_person      : String(120);
  contact_email       : EmailAddr;
  identifier          : String(40);   // GLN, Tax-ID, etc.
  archived            : Boolean default false;

  roles : Composition of many BusinessPartnerRoles on roles.partner = $self;
}

entity BusinessPartnerRoles : identified {
  partner : Association to BusinessPartners not null;
  role    : BusinessPartnerRole             not null;
}

annotate BusinessPartnerRoles with @assert.unique : { partner_role : [partner, role] };
