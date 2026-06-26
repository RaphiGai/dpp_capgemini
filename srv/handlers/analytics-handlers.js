'use strict';

const cds = require('@sap/cds');
const { requireActiveUser, requireRole } = require('./auth-helpers');
const { aggregate } = require('../lib/aggregator');

/**
 * Sustainability analytics (US9.6). One unbound action `sustainabilityAnalytics` that
 * returns an org-wide, tenant-scoped JSON payload (KPIs + per product/variant/batch
 * breakdowns + monthly time series + ESPR distribution). company_advanced only.
 *
 * The CO₂/recycled figures are the **cradle-to-gate rollup** computed by reusing
 * srv/lib/aggregator.js#aggregate per DPP (the semantically correct footprint — a raw
 * sum of batch.co2_footprint_kg is NOT valid because its unit basis differs per BOM
 * line). The batch's own recorded values are also returned at batch level, clearly
 * labelled. Bounded by the number of DPPs; for very large orgs cache via the existing
 * DPPs.aggregated_snapshot. The action mechanics (vs a function) just simplify params;
 * it is read-only and not in auth-helpers.WRITE_EVENTS.
 */

const num = (v) => (v == null || v === '' ? null : Number(v));
const r3 = (v) => (v == null ? null : Number(Number(v).toFixed(3)));
const avg = (xs) => {
  const v = xs.filter((x) => x != null).map(Number);
  return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)) : null;
};
const sum = (xs) => {
  const v = xs.filter((x) => x != null).map(Number);
  return v.length ? Number(v.reduce((a, b) => a + b, 0).toFixed(3)) : null;
};
const variantLabel = (v) =>
  v ? [v.color, v.size].filter(Boolean).join(' / ') || v.sku || v.ID : null;

function emptyPayload(dateFrom, dateTo) {
  return {
    range: { from: dateFrom || null, to: dateTo || null },
    kpis: {
      passports: 0, products: 0, variants: 0, batches: 0,
      total_co2_kg: null, avg_co2_kg: null, avg_recycled_pct: null,
      avg_durability: null, avg_repairability: null, espr_compliant_pct: null, incomplete: 0,
    },
    espr_distribution: { compliant: 0, in_review: 0, non_compliant: 0, draft: 0 },
    time_series: [],
    by_product: [], by_variant: [], by_batch: [],
  };
}

module.exports = (srv) => {
  srv.on('sustainabilityAnalytics', async (req) => {
    const orgId = await requireActiveUser(req);
    requireRole(req, 'company_advanced');

    const dateFrom = req.data.dateFrom || null;       // 'YYYY-MM-DD' or null
    const dateTo = req.data.dateTo || null;
    const productType = req.data.productType || null;
    const esprStatus = req.data.esprStatus || null;

    const { Products, ProductVariants, Batches, DPPs } = cds.entities('dpp');

    const products = await SELECT.from(Products).where({ owning_organization_ID: orgId });
    if (!products.length) return JSON.stringify(emptyPayload(dateFrom, dateTo));
    const productIds = products.map((p) => p.ID);
    const pById = Object.fromEntries(products.map((p) => [p.ID, p]));

    const variants = await SELECT.from(ProductVariants).where({ product_ID: { in: productIds } });
    const vById = Object.fromEntries(variants.map((v) => [v.ID, v]));
    const variantIds = variants.map((v) => v.ID);

    const batches = variantIds.length
      ? await SELECT.from(Batches).where({ variant_ID: { in: variantIds } })
      : [];
    const bById = Object.fromEntries(batches.map((b) => [b.ID, b]));

    const dpps = await SELECT.from(DPPs).where({ product_ID: { in: productIds } });

    // Build one enriched, date/criteria-filtered row per DPP, with the rolled-up footprint.
    const rows = [];
    for (const d of dpps) {
      const p = pById[d.product_ID];
      if (!p) continue;
      if (productType && p.product_type !== productType) continue;
      if (esprStatus && p.espr_compliance !== esprStatus) continue;

      const b = d.batch_ID ? bById[d.batch_ID] : null;
      const v = d.variant_ID ? vById[d.variant_ID] : b ? vById[b.variant_ID] : null;

      // Time axis: batch production date → else DPP published/created date.
      const date =
        (b && b.production_date) ||
        (d.published_at ? String(d.published_at).slice(0, 10) : null) ||
        (d.createdAt ? String(d.createdAt).slice(0, 10) : null);
      if (dateFrom && (!date || date < dateFrom)) continue;
      if (dateTo && (!date || date > dateTo)) continue;

      let agg;
      try {
        agg = await aggregate(d.ID);
      } catch {
        agg = { values: {}, incomplete: true };
      }

      rows.push({
        dpp_id: d.ID,
        status: d.status,
        dpp_type: d.dpp_type,
        date: date || null,
        month: date ? date.slice(0, 7) : null,
        product_id: p.ID,
        product_name: p.name,
        product_type: p.product_type,
        espr_compliance: p.espr_compliance || 'draft',
        durability_score: num(p.durability_score),
        repairability_score: num(p.repairability_score),
        variant_id: v ? v.ID : null,
        variant_label: variantLabel(v),
        batch_id: b ? b.ID : null,
        batch_number: b ? b.batch_number : null,
        co2_kg: r3(agg.values && agg.values.co2_footprint_kg),
        recycled_pct: r3(agg.values && agg.values.recycled_content_pct),
        batch_co2_kg: r3(b && b.co2_footprint_kg),
        batch_recycled_pct: r3(b && b.recycled_content_pct),
        incomplete: !!agg.incomplete,
      });
    }

    // ---- KPIs (distinct products for product-level metrics) ----
    const productRowsMap = new Map();
    for (const row of rows) {
      if (!productRowsMap.has(row.product_id)) productRowsMap.set(row.product_id, []);
      productRowsMap.get(row.product_id).push(row);
    }
    const distinctProducts = [...productRowsMap.keys()].map((id) => pById[id]);
    const espr_distribution = { compliant: 0, in_review: 0, non_compliant: 0, draft: 0 };
    for (const p of distinctProducts) {
      const k = p.espr_compliance || 'draft';
      if (espr_distribution[k] != null) espr_distribution[k] += 1;
    }
    const kpis = {
      passports: rows.length,
      products: distinctProducts.length,
      variants: new Set(rows.map((r) => r.variant_id).filter(Boolean)).size,
      batches: new Set(rows.map((r) => r.batch_id).filter(Boolean)).size,
      total_co2_kg: sum(rows.map((r) => r.co2_kg)),
      avg_co2_kg: avg(rows.map((r) => r.co2_kg)),
      avg_recycled_pct: avg(rows.map((r) => r.recycled_pct)),
      avg_durability: avg(distinctProducts.map((p) => num(p.durability_score))),
      avg_repairability: avg(distinctProducts.map((p) => num(p.repairability_score))),
      espr_compliant_pct: distinctProducts.length
        ? Number(((espr_distribution.compliant / distinctProducts.length) * 100).toFixed(1))
        : null,
      incomplete: rows.filter((r) => r.incomplete).length,
    };

    // ---- Breakdowns ----
    const by_product = [...productRowsMap.entries()].map(([id, rs]) => {
      const p = pById[id];
      return {
        product_id: id,
        name: p.name,
        product_type: p.product_type,
        espr_compliance: p.espr_compliance || 'draft',
        durability_score: num(p.durability_score),
        repairability_score: num(p.repairability_score),
        passports: rs.length,
        co2_kg: avg(rs.map((r) => r.co2_kg)),
        recycled_pct: avg(rs.map((r) => r.recycled_pct)),
        incomplete: rs.some((r) => r.incomplete),
      };
    });

    const variantRowsMap = new Map();
    for (const row of rows.filter((r) => r.variant_id)) {
      if (!variantRowsMap.has(row.variant_id)) variantRowsMap.set(row.variant_id, []);
      variantRowsMap.get(row.variant_id).push(row);
    }
    const by_variant = [...variantRowsMap.entries()].map(([id, rs]) => ({
      variant_id: id,
      label: rs[0].variant_label,
      product_id: rs[0].product_id,
      product_name: rs[0].product_name,
      passports: rs.length,
      co2_kg: avg(rs.map((r) => r.co2_kg)),
      recycled_pct: avg(rs.map((r) => r.recycled_pct)),
    }));

    const by_batch = rows
      .filter((r) => r.batch_id)
      .map((r) => ({
        batch_id: r.batch_id,
        batch_number: r.batch_number,
        product_id: r.product_id,
        product_name: r.product_name,
        variant_label: r.variant_label,
        production_date: r.date,
        status: r.status,
        co2_kg: r.co2_kg,
        recycled_pct: r.recycled_pct,
        batch_co2_kg: r.batch_co2_kg,
        batch_recycled_pct: r.batch_recycled_pct,
      }));

    // ---- Monthly time series ----
    const monthMap = new Map();
    for (const row of rows.filter((r) => r.month)) {
      if (!monthMap.has(row.month)) monthMap.set(row.month, []);
      monthMap.get(row.month).push(row);
    }
    const time_series = [...monthMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, rs]) => ({
        month,
        passports: rs.length,
        avg_co2_kg: avg(rs.map((r) => r.co2_kg)),
        avg_recycled_pct: avg(rs.map((r) => r.recycled_pct)),
      }));

    return JSON.stringify({
      range: { from: dateFrom, to: dateTo },
      kpis,
      espr_distribution,
      time_series,
      by_product,
      by_variant,
      by_batch,
    });
  });
};
