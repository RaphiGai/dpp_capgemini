using {
  dpp.identified,
  dpp.CountryISO2,
  dpp.GLN,
  dpp.UserRole,
  dpp.AppearanceTheme,
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
  // Per-user UI colour theme (self-service via the updateProfile action). green | blue | purple.
  appearance_theme : AppearanceTheme default 'green';

  // ---- App-managed credentials (own auth, replaces XSUAA) ----
  // The login layer authenticates `username` + password against `password_hash`.
  // Credential/security fields are NEVER exposed through the OData projection
  // (see srv/dpp-service.cds) and are only written via the user-management
  // actions in srv/handlers/user-handlers.js — never via raw CRUD.
  username            : String(60) not null;   // global login handle
  password_hash       : String(255);           // bcrypt; null = cannot log in yet
  must_reset_password : Boolean default true;   // forces a change on first login
  password_updated_at : Timestamp;
  failed_login_count  : Integer default 0;     // brute-force counter (login layer)
  locked_until        : Timestamp;             // lockout window (login layer)
  // Self-service password reset: single-use, time-limited token (sha256 hash stored,
  // never the plaintext). Set on request, cleared on consume. Not exposed via OData.
  reset_token_hash    : String(64);
  reset_token_expires : Timestamp;
}

annotate Users with @assert.unique : { email_per_org : [email, organization] };
// Separate block — username must be unique DB-wide so login resolves to one row.
annotate Users with @assert.unique : { username : [username] };

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
