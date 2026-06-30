'use strict';

const { createHash } = require('crypto');

/**
 * Deterministic content hashing + field diffing for DPP snapshots (drift detection).
 *
 * The hash must be STABLE across rebuilds of the same underlying data, so we strip
 * volatile fields (capture timestamp, audit columns, surrogate IDs) and the DPP meta
 * that is not "content" (version/status/visibility), then serialize with sorted keys.
 * Both publish (anchor) and the post-edit drift check feed buildSnapshot output through
 * here, so representations stay consistent.
 *
 * Leaf module — imports nothing from handlers (safe from both backend layers).
 */

// Non-content keys dropped wherever they appear: capture/audit timestamps and the
// internal lifecycle `status` of nested product/variant/batch/item rows (archiving or
// publishing a product is its own lifecycle, not DPP content, and must not drift the DPP).
const VOLATILE_KEYS = new Set([
  'captured_at', 'createdAt', 'createdBy', 'lastChange', 'changedBy', 'modifiedAt',
  'last_updated', 'updatedAt', 'status'
]);

function isStrippableKey(key) {
  if (VOLATILE_KEYS.has(key)) return true;
  if (key === 'ID' || key === 'id') return true;
  if (key.endsWith('_ID')) return true;
  return false;
}

function stripDeep(value) {
  if (Array.isArray(value)) return value.map(stripDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (isStrippableKey(k)) continue;
      out[k] = stripDeep(value[k]);
    }
    return out;
  }
  return value;
}

/** Normalize a snapshot for hashing/diffing: strip volatile + surrogate fields. */
function normalizeForHash(snap) {
  const n = stripDeep(snap);
  if (n && n.dpp && typeof n.dpp === 'object') {
    delete n.dpp.version;
    delete n.dpp.status;
    delete n.dpp.visibility;
  }
  // Marketing links are served LIVE (not frozen into the consumer view) and are decoupled
  // from the version/drift lifecycle: a campaign edit must NOT revert an approved/published
  // DPP to draft, nor show as a "pending change". Exclude them from the hash and the diff.
  if (n && typeof n === 'object') delete n.marketing_links;
  return n;
}

/** Deterministic JSON with sorted object keys (arrays keep order). */
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** sha256 hex of the normalized, deterministically-serialized snapshot. */
function contentHash(snap) {
  return createHash('sha256').update(stableStringify(normalizeForHash(snap))).digest('hex');
}

// Friendly labels for the changed-fields display; unknown paths are humanized.
const PATH_LABELS = {
  'product.name': 'Name',
  'product.brand': 'Brand',
  'product.category': 'Category',
  'product.fibre_composition': 'Fibre composition',
  'product.care_instructions': 'Care instructions',
  'product.repair_instructions': 'Repair instructions',
  'product.reuse_instructions': 'Reuse instructions',
  'product.disposal_instructions': 'Disposal instructions',
  'product.country_of_origin': 'Country of origin',
  'product.substances_of_concern': 'Substances of concern',
  'product.espr_compliance': 'ESPR compliance status',
  'product.durability_score': 'Durability score',
  'product.repairability_score': 'Repairability score',
  'product.model': 'Model',
  'product.description': 'Description',
  'product.gtin': 'Product GTIN',
  'variant.color': 'Variant colour',
  'variant.size': 'Variant size',
  'variant.sku': 'Variant SKU',
  'variant.weight_g': 'Variant weight',
  'batch.batch_number': 'Batch number',
  'batch.production_date': 'Production date',
  'batch.country_of_origin': 'Batch country of origin',
  'batch.co2_footprint_kg': 'Batch CO₂ footprint',
  'batch.recycled_content_pct': 'Batch recycled content',
  'batch.factory.name': 'Factory',
  'batch.supplier.name': 'Supplier',
  'aggregated.co2_footprint_kg': 'Aggregated CO₂ footprint',
  'aggregated.recycled_content_pct': 'Aggregated recycled content',
  'storytelling': 'Storytelling',
  'marketing_links': 'Marketing links',
  'documents': 'Documents',
  'bom': 'Bill of materials'
};

function humanize(path) {
  if (PATH_LABELS[path]) return PATH_LABELS[path];
  const seg = path.split('.').pop().replace(/_/g, ' ');
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const short = (v) => {
  if (v == null || v === '') return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
};

function walkDiff(prev, cur, path, out) {
  if (out.length >= 60) return; // cap noise
  if (isObj(prev) && isObj(cur)) {
    for (const k of new Set([...Object.keys(prev), ...Object.keys(cur)])) {
      walkDiff(prev[k], cur[k], path ? `${path}.${k}` : k, out);
    }
    return;
  }
  if (Array.isArray(prev) || Array.isArray(cur)) {
    if (stableStringify(prev ?? []) !== stableStringify(cur ?? [])) {
      const pl = Array.isArray(prev) ? prev.length : 0;
      const cl = Array.isArray(cur) ? cur.length : 0;
      out.push({ path, label: humanize(path), old: `${pl} entr${pl === 1 ? 'y' : 'ies'}`, new: `${cl} entr${cl === 1 ? 'y' : 'ies'}` });
    }
    return;
  }
  if (stableStringify(prev) !== stableStringify(cur)) {
    out.push({ path, label: humanize(path), old: short(prev), new: short(cur) });
  }
}

/**
 * Field-level diff between two snapshots (previous published vs current). Returns
 * `[{ path, label, old, new }]` over normalized content (surrogate/volatile fields
 * already excluded). Used for the "what changed since the live version" display.
 */
function diffNormalized(prevSnap, curSnap) {
  const out = [];
  walkDiff(normalizeForHash(prevSnap || {}), normalizeForHash(curSnap || {}), '', out);
  return out;
}

module.exports = { normalizeForHash, stableStringify, contentHash, diffNormalized };
