'use strict';

/**
 * Per-field consumer visibility — enforcement for the public consumer DTO.
 *
 * A `company_advanced` user can mark individual fields 'public' or 'internal' in the
 * edit forms; the choice is stored per entity as a JSON map in `field_visibility`
 * ({ fieldName: 'public' | 'internal' }). This module resolves the effective
 * visibility (stored override → catalogue default) and strips 'internal' fields from
 * the consumer DTO sections built in srv/handlers/public-handler.js.
 *
 * Regulatory-LOCKED fields are ALWAYS public and can never be hidden, even if a stored
 * map says 'internal' — this is the server-side guarantee behind the disabled
 * "Public · required" badge in the UI. The locked set is a reviewable default derived
 * from the project field catalogue's `mandatory` flag + the ESPR / EU textile-labelling
 * context; it is NOT legal advice and must be confirmed with a compliance advisor.
 *
 * KEEP IN SYNC with the frontend catalogue: dpp_frontend/app/src/lib/fieldCatalogue.js
 * (same field keys, default visibility and `locked` flags).
 */

// { vis: default visibility, locked: regulatory-public (never hidden) }
const CATALOGUES = {
  product: {
    name: { vis: 'public', locked: true }, // Tier A — product identification
    brand: { vis: 'public', locked: true }, // Tier B — catalogue-mandatory
    category: { vis: 'public', locked: true }, // Tier B
    model: { vis: 'public', locked: false },
    description: { vis: 'public', locked: false },
    gtin: { vis: 'internal', locked: false },
    fibre_composition: { vis: 'public', locked: true }, // EU Textile Reg 1007/2011
    substances_of_concern: { vis: 'public', locked: true }, // REACH SVHC / SCIP, ESPR
    care_instructions: { vis: 'public', locked: true }, // ESPR lifecycle info
    repair_instructions: { vis: 'public', locked: true }, // ESPR
    disposal_instructions: { vis: 'public', locked: true }, // ESPR
    reuse_instructions: { vis: 'public', locked: false },
    country_of_origin: { vis: 'public', locked: true }, // origin marking
    espr_compliance: { vis: 'public', locked: true },
    durability_score: { vis: 'public', locked: false },
    repairability_score: { vis: 'public', locked: false },
    care_video_url: { vis: 'public', locked: false },
    repair_video_url: { vis: 'public', locked: false },
    disposal_video_url: { vis: 'public', locked: false },
    reuse_video_url: { vis: 'public', locked: false },
    storytelling: { vis: 'public', locked: false },
  },
  variant: {
    color: { vis: 'public', locked: false },
    size: { vis: 'public', locked: false },
    sku: { vis: 'internal', locked: false },
    gtin: { vis: 'internal', locked: false },
    image_url: { vis: 'public', locked: false },
    image_data: { vis: 'public', locked: false },
  },
  batch: {
    batch_number: { vis: 'internal', locked: false },
    production_date: { vis: 'internal', locked: false },
    country_of_origin: { vis: 'public', locked: true }, // Tier B — origin marking
    co2_footprint_kg: { vis: 'public', locked: false },
    recycled_content_pct: { vis: 'public', locked: false },
  },
};

function parseMap(json) {
  if (!json) return {};
  if (typeof json === 'object') return json;
  try {
    const o = JSON.parse(json);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

/**
 * Effective visibility of a single field: locked → always 'public'; otherwise a valid
 * stored override wins; otherwise the catalogue default. Unknown fields default to
 * 'public' (never silently hide something not in the catalogue).
 */
function resolve(kind, field, map) {
  const def = CATALOGUES[kind] && CATALOGUES[kind][field];
  if (!def) return 'public';
  if (def.locked) return 'public';
  const s = map[field];
  return s === 'internal' || s === 'public' ? s : def.vis;
}

/**
 * Return a copy of `section` with every field whose effective visibility is 'internal'
 * removed. `storedJson` is the entity's `field_visibility` column (JSON string or null).
 * Never removes locked fields. Returns the input unchanged when it is null/undefined.
 */
function applyFieldVisibility(section, kind, storedJson) {
  if (!section || typeof section !== 'object') return section;
  const map = parseMap(storedJson);
  const out = {};
  for (const [k, v] of Object.entries(section)) {
    if (resolve(kind, k, map) === 'internal') continue;
    out[k] = v;
  }
  return out;
}

/** True when a field's effective visibility (stored override → catalogue default, locked → public) is public. */
function isFieldPublic(kind, field, storedJson) {
  return resolve(kind, field, parseMap(storedJson)) === 'public';
}

module.exports = { applyFieldVisibility, isFieldPublic, resolve, CATALOGUES };
