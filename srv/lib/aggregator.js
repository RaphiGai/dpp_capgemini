'use strict';

const cds = require('@sap/cds');

const MAX_DEPTH = 8;

function toFraction(quantity, unit) {
  if (quantity == null) return 1;
  if (unit === '%') return Number(quantity) / 100;
  return Number(quantity);
}

function weightedSum(self, contributions) {
  let acc = 0;
  let any = false;
  if (self != null) { acc += Number(self); any = true; }
  for (const c of contributions) {
    if (c.value == null) continue;
    acc += Number(c.value) * c.weight;
    any = true;
  }
  return any ? Number(acc.toFixed(6)) : null;
}

function weightedAverage(self, contributions) {
  let num = 0;
  let den = 0;
  if (self != null) { num += Number(self); den += 1; }
  for (const c of contributions) {
    if (c.value == null) continue;
    num += Number(c.value) * c.weight;
    den += c.weight;
  }
  if (den === 0) return null;
  return Number((num / den).toFixed(6));
}

function unionStrings(self, contributions) {
  const set = new Set();
  const push = (raw) => {
    if (!raw) return;
    String(raw).split(/[;,]/).map((s) => s.trim()).filter(Boolean).forEach((s) => set.add(s));
  };
  push(self);
  for (const c of contributions) push(c.value);
  if (set.size === 0) return null;
  return Array.from(set).sort().join('; ');
}

function parseFibres(raw) {
  if (!raw) return {};
  const out = {};
  for (const part of String(raw).split(/[,;]/)) {
    const m = part.trim().match(/^(\d+(?:\.\d+)?)\s*%\s*(.+)$/);
    if (m) {
      const pct = Number(m[1]);
      const name = m[2].trim();
      out[name] = (out[name] || 0) + pct;
    }
  }
  return out;
}

function rollupFibres(self, contributions) {
  const bag = {};
  const addBag = (b, factor) => {
    for (const [k, v] of Object.entries(b)) {
      bag[k] = (bag[k] || 0) + v * factor;
    }
  };
  if (self) addBag(parseFibres(self), 1);
  for (const c of contributions) {
    if (!c.value) continue;
    addBag(parseFibres(c.value), c.weight);
  }
  const entries = Object.entries(bag);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => `${v.toFixed(1)}% ${k}`).join(', ');
}

/**
 * Registry of aggregators. Each entry defines how to extract the "self" value
 * from this DPP's own context (product/batch) and how to combine that with
 * weighted child contributions.
 *
 * Extend at runtime with registerAggregator(name, def).
 */
const aggregators = {
  co2_footprint_kg: {
    selfValue: (ctx) => ctx.batch?.co2_footprint_kg ?? null,
    childValue: (childResult) => childResult.values?.co2_footprint_kg ?? null,
    aggregate: weightedSum,
  },
  recycled_content_pct: {
    selfValue: (ctx) => ctx.batch?.recycled_content_pct ?? null,
    childValue: (childResult) => childResult.values?.recycled_content_pct ?? null,
    aggregate: weightedAverage,
  },
  substances_of_concern: {
    selfValue: (ctx) => ctx.product?.substances_of_concern ?? null,
    childValue: (childResult) => childResult.values?.substances_of_concern ?? null,
    aggregate: unionStrings,
  },
  fibre_composition: {
    selfValue: (ctx) => ctx.product?.fibre_composition ?? null,
    childValue: (childResult) => childResult.values?.fibre_composition ?? null,
    aggregate: rollupFibres,
  },
};

function registerAggregator(name, def) {
  aggregators[name] = def;
}

async function loadDPPContext(dppId) {
  const { DPPs, Products, ProductVariants, Batches, ProductBOMs } = cds.entities('dpp');
  const dpp = await SELECT.one.from(DPPs).where({ ID: dppId });
  if (!dpp) return null;
  const product = await SELECT.one.from(Products).where({ ID: dpp.product_ID });
  const batch = dpp.batch_ID
    ? await SELECT.one.from(Batches).where({ ID: dpp.batch_ID })
    : null;

  let variantIds;
  if (batch) {
    variantIds = [batch.variant_ID];
  } else {
    const variants = await SELECT.from(ProductVariants)
      .columns(['ID'])
      .where({ product_ID: dpp.product_ID });
    variantIds = variants.map((v) => v.ID);
  }

  const boms = variantIds.length
    ? await SELECT.from(ProductBOMs).where({ parent_ID: { in: variantIds } })
    : [];

  return { dpp, product, batch, boms };
}

/**
 * Recursively aggregate a DPP. Returns:
 *   { values: { co2_footprint_kg, recycled_content_pct, ... },
 *     incomplete: boolean,
 *     missing: [{ component_ID?, external_dpp_url?, reason }] }
 */
async function aggregate(dppId, opts = {}) {
  const visited = opts.visited || new Set();
  const depth = opts.depth || 0;

  if (visited.has(dppId)) {
    return { values: {}, incomplete: true, missing: [{ dpp_ID: dppId, reason: 'cycle' }] };
  }
  if (depth > MAX_DEPTH) {
    return { values: {}, incomplete: true, missing: [{ dpp_ID: dppId, reason: 'depth_limit' }] };
  }
  visited.add(dppId);

  const ctx = await loadDPPContext(dppId);
  if (!ctx) {
    return { values: {}, incomplete: true, missing: [{ dpp_ID: dppId, reason: 'not_found' }] };
  }

  const missing = [];
  const childResults = [];

  for (const edge of ctx.boms) {
    const weight = toFraction(edge.quantity, edge.unit);
    if (edge.sub_dpp_ID) {
      const sub = await aggregate(edge.sub_dpp_ID, {
        visited: new Set(visited),
        depth: depth + 1,
      });
      childResults.push({ edge, weight, result: sub });
      if (sub.incomplete) {
        missing.push({
          component_ID: edge.component_ID,
          sub_dpp_ID: edge.sub_dpp_ID,
          reason: 'sub_dpp_incomplete',
        });
      }
    } else if (edge.external_dpp_url) {
      missing.push({
        component_ID: edge.component_ID,
        external_dpp_url: edge.external_dpp_url,
        reason: 'external',
      });
    } else {
      missing.push({
        component_ID: edge.component_ID,
        reason: 'no_sub_dpp',
      });
    }
  }

  const values = {};
  for (const [name, def] of Object.entries(aggregators)) {
    const self = def.selfValue(ctx);
    const contributions = childResults
      .filter(({ result }) => def.childValue(result) != null)
      .map(({ result, weight }) => ({ value: def.childValue(result), weight }));
    values[name] = def.aggregate(self, contributions);
  }

  return {
    values,
    incomplete: missing.length > 0,
    missing,
  };
}

module.exports = {
  aggregate,
  registerAggregator,
  _internals: {
    weightedSum,
    weightedAverage,
    unionStrings,
    rollupFibres,
    parseFibres,
    toFraction,
  },
};
