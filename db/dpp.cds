using {
  dpp.identified,
  dpp.DPPStatus,
  dpp.DPPType,
  dpp.Visibility,
  dpp.QRCodeStatus,
  dpp.MarketingLinkType,
  dpp.URL
} from './common';
using { dpp.Products, dpp.ProductVariants, dpp.Batches, dpp.ProductItems } from './product';
using { dpp.audited, dpp.Organizations } from './org';

namespace dpp;

// ----- Digital Product Passport (catalogue Sheet 2 R11) -----
// A DPP always represents a finished product from the perspective of its
// producer. The optional `batch` link narrows the DPP to a concrete production
// batch; otherwise the DPP describes the product on a model/variant level.
entity DPPs : identified, audited {
  product             : Association to Products not null;
  batch               : Association to Batches;
  variant             : Association to ProductVariants;  // which variant this DPP represents
  item                : Association to ProductItems;     // 1:1 for serialized item-level DPPs
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
  aggregated_snapshot : LargeString;  // optional cache of last aggregation; default path computes live
  storytelling        : LargeString;  // optional JSON array of {title, body, media_url, media_type}

  qr_codes        : Composition of many QRCodes           on qr_codes.dpp        = $self;
  marketing_links : Association  to many DPPMarketingLinks on marketing_links.dpp = $self;
}

annotate DPPs with @assert.unique : {
  qrToken     : [qr_token],
  dpp_per_item : [item]   // exactly one DPP per serialized item
};

// ----- QR Code (catalogue Sheet 2 R13) — 1:1 active + history per DPP -----
entity QRCodes : identified {
  dpp          : Association to DPPs not null;
  qr_value     : URL;                          // encoded URL on the physical label
  qr_image_url : URL;                          // optional pointer to a rendered PNG
  status       : QRCodeStatus default 'active';
  created_at   : Timestamp;
  replaced_at  : Timestamp;
}

// ----- Marketing / advertising links shown on the public DPP view -----
// Either attached to a specific DPP (item- or product-level ad, e.g. a care
// product) or org-wide when `dpp` is null (e.g. a "Summer sale" campaign shown
// across all the organisation's published DPPs). Surfaced by srv/handlers/
// public-handler.js, filtered by is_active + the valid_from/valid_to window.
entity DPPMarketingLinks : identified, audited {
  owning_organization : Association to Organizations not null;  // tenant scope
  dpp                 : Association to DPPs;                     // optional; null = all org DPPs
  link_type           : MarketingLinkType default 'advertisement';
  title               : String(200) not null;
  url                 : URL;
  display_order       : Integer default 0;
  is_active           : Boolean default true;
  valid_from          : Date;
  valid_to            : Date;
}
