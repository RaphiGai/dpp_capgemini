'use strict';

const { createHash } = require('crypto');
const { canonicalize } = require('./canonical-json');

function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Project a DPP record onto the whitelist of fields that participate in the
 * on-chain proof. Operational columns (timestamps, modifiers, tokens, anchor
 * audit) are deliberately excluded so re-anchoring after a non-substantive
 * edit doesn't churn the hash.
 *
 * Changing this whitelist is a breaking change for downstream verifiers.
 */
function projectForHash(dpp, children = {}) {
  return {
    id: dpp.ID,
    granularity_level: dpp.granularity_level,
    batch_lot_number: dpp.batch_lot_number || null,
    verification_status: dpp.verification_status,
    visibility: dpp.visibility,
    gtin: dpp.gtin || null,
    product_ID: dpp.product_ID || null,
    issuing_organization_ID: dpp.issuing_organization_ID || null,
    facility_ID: dpp.facility_ID || null,
    manufacturing_country_iso2: dpp.manufacturing_country_iso2 || null,
    manufacturing_date_from: dpp.manufacturing_date_from || null,
    manufacturing_date_to: dpp.manufacturing_date_to || null,
    placed_on_market_date: dpp.placed_on_market_date || null,
    materials: (children.materials || [])
      .map((m) => ({
        material_class: m.material_class,
        fiber_name: m.fiber_name,
        percentage: Number(m.percentage),
        country_of_origin: m.country_of_origin || null,
        recycled_content_pct: Number(m.recycled_content_pct || 0)
      }))
      .sort((a, b) => (a.fiber_name || '').localeCompare(b.fiber_name || '')),
    compliance: (children.compliance || [])
      .map((c) => ({
        standard: c.compliance_standard,
        valid_from: c.valid_from || null,
        valid_until: c.valid_until || null,
        verification_status: c.verification_status
      }))
      .sort((a, b) => (a.standard || '').localeCompare(b.standard || '')),
    documents: (children.documents || [])
      .map((d) => ({
        document_type: d.document_type,
        title: d.title,
        sha256: d.sha256 || null
      }))
      .sort((a, b) => (a.sha256 || '').localeCompare(b.sha256 || '')),
    substances: (children.substances || [])
      .map((s) => ({
        substance_name: s.substance_name,
        cas_number: s.cas_number || null,
        concentration_pct: s.concentration_pct === undefined || s.concentration_pct === null
          ? null
          : Number(s.concentration_pct)
      }))
      .sort((a, b) => (a.substance_name || '').localeCompare(b.substance_name || ''))
  };
}

function hashDPPSnapshot(dpp, children) {
  return sha256Hex(canonicalize(projectForHash(dpp, children)));
}

module.exports = { sha256Hex, hashDPPSnapshot, projectForHash };
