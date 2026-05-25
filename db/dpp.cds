using {
  dpp.identified,
  dpp.DPPStatus,
  dpp.DPPType,
  dpp.Visibility,
  dpp.Granularity,
  dpp.QRCodeStatus,
  dpp.URL
} from './common';
using { dpp.Products, dpp.ProductItems } from './product';

namespace dpp;

// ----- Digital Product Passport (catalogue Sheet 2 R11) -----
entity DPPs : identified {
  product             : Association to Products     not null;
  item                : Association to ProductItems;
  granularity         : Granularity default 'item';
  dpp_type            : DPPType     default 'product';
  status              : DPPStatus   default 'draft';
  visibility          : Visibility  default 'internal';
  current_version     : Integer     default 1;
  qr_token            : String(128);
  qr_payload_url      : URL;
  public_url          : URL;
  approved_at         : Timestamp;
  published_at        : Timestamp;
  archived_at         : Timestamp;
  valid_from          : Date;
  last_updated        : Timestamp;
  aggregated_snapshot : LargeString;  // JSON snapshot of latest published aggregation (Sheet 3 R85)
  storytelling        : LargeString;  // optional JSON array of {title, body, media_url, media_type}

  qr_codes : Composition of many QRCodes on qr_codes.dpp = $self;
}

annotate DPPs with @assert.unique : { qrToken : [qr_token] };

// ----- QR Code (catalogue Sheet 2 R13) — 1:1 active + history per DPP -----
entity QRCodes : identified {
  dpp          : Association to DPPs not null;
  qr_value     : URL;                          // encoded URL on the physical label
  qr_image_url : URL;                          // optional pointer to a rendered PNG
  status       : QRCodeStatus default 'active';
  created_at   : Timestamp;
  replaced_at  : Timestamp;
}
