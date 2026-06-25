'use strict';

const cds = require('@sap/cds');
const { requireActiveUser, requireRole } = require('./auth-helpers');

/**
 * Compliance analytics (US9.x). One unbound action `complianceAnalytics` returning an
 * org-wide, tenant-scoped JSON payload (ESPR readiness + documentation-evidence
 * completeness + the integrity cross-check). company_advanced only.
 *
 * The product is the unit of compliance. Two engines:
 *  1) ESPR readiness — from the operator-set Products.espr_compliance (a SELF-DECLARED
 *     flag, not derived from documents).
 *  2) Evidence completeness — derived purely from Documents metadata (doc_type +
 *     valid_until + product_ID/batch_ID). A product is "documentation complete" when it
 *     has at least one NON-EXPIRED document for EACH expected type
 *     {certificate, test_report, declaration_of_conformity}. Validity = valid_until IS
 *     NULL OR valid_until >= today; `today` is the server date, echoed in the payload so
 *     the expiry cut is transparent (it does NOT move with the dateTo filter).
 *  3) `declared_not_evidenced` cross-checks (1) against (2): products that assert ESPR
 *     compliance the evidence does not yet substantiate — the headline audit-risk signal.
 *
 * Read-only: intentionally NOT in auth-helpers.WRITE_EVENTS, no @restrict, no
 * TENANT_ANCHORS entry — the handler's own requireRole is the sole gate. Documents has
 * no owning_organization column, so tenant safety is transitive: documents are ONLY ever
 * loaded via { product_ID|batch_ID: { in: <org-scoped ids> } } — never an unscoped SELECT.
 * Per org/DSGVO rules the payload emits only IDs, names, catalogue labels, doc_type,
 * counts and dates — never a Document title/issuer/file_name or any createdBy/changedBy.
 *
 * No BOM/CO₂ rollup here (compliance is documentation-centric), so this is strictly
 * lighter than analytics-handlers.js: a handful of bounded IN-list SELECTs, metadata
 * columns only (the LargeBinary `content` stream is never read).
 */

const EXPECTED = ['certificate', 'test_report', 'declaration_of_conformity'];
const ALL_DOC_TYPES = ['certificate', 'test_report', 'declaration_of_conformity', 'safety_data_sheet', 'manual', 'other'];

const num = (v) => (v == null || v === '' ? null : Number(v));
const r3 = (v) => (v == null ? null : Number(Number(v).toFixed(3)));
const avg = (xs) => {
  const v = xs.filter((x) => x != null).map(Number);
  return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)) : null;
};
const pct = (part, total, d = 1) => (total ? Number(((100 * part) / total).toFixed(d)) : null);
const day = (v) => (v == null ? null : String(v).slice(0, 10));
const variantLabel = (v) => (v ? [v.color, v.size].filter(Boolean).join(' / ') || v.sku || v.ID : null);
const maxDate = (arr) => {
  const xs = arr.filter(Boolean).map(day).filter(Boolean);
  return xs.length ? xs.sort()[xs.length - 1] : null;
};

function emptyPayload(dateFrom, dateTo, today) {
  return {
    range: { from: dateFrom || null, to: dateTo || null },
    today,
    expected_doc_types: EXPECTED,
    kpis: {
      products: 0, published_dpps: 0,
      espr_ready_pct: null, espr_blocking: 0, non_compliant: 0, in_review: 0, draft: 0,
      docs_complete_pct: null, avg_docs_score: null,
      products_no_docs: 0, products_expired_only: 0,
      docs_expiring_soon: 0, docs_expired: 0, declared_not_evidenced: 0,
      doc_coverage_certs_pct: null, doc_coverage_test_pct: null, doc_coverage_doc_pct: null
    },
    espr_distribution: { compliant: 0, in_review: 0, non_compliant: 0, draft: 0 },
    evidence_distribution: { complete: 0, partial: 0, expired_only: 0, none: 0 },
    type_coverage: { certificate: 0, test_report: 0, declaration_of_conformity: 0, safety_data_sheet: 0, manual: 0, other: 0 },
    time_series: [],
    by_product: [],
    by_batch: []
  };
}

module.exports = (srv) => {
  srv.on('complianceAnalytics', async (req) => {
    const orgId = await requireActiveUser(req);
    requireRole(req, 'company_advanced');

    const dateFrom = req.data.dateFrom || null;
    const dateTo = req.data.dateTo || null;
    const productType = req.data.productType || null;
    const esprStatus = req.data.esprStatus || null;

    const TODAY = new Date().toISOString().slice(0, 10);
    const PLUS90 = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 90);
      return d.toISOString().slice(0, 10);
    })();

    const { Products, ProductVariants, Batches, DPPs, Documents } = cds.entities('dpp');

    const products = await SELECT.from(Products).where({ owning_organization_ID: orgId });
    if (!products.length) return JSON.stringify(emptyPayload(dateFrom, dateTo, TODAY));
    const productIds = products.map((p) => p.ID);
    const pById = Object.fromEntries(products.map((p) => [p.ID, p]));

    const variants = await SELECT.from(ProductVariants).where({ product_ID: { in: productIds } });
    const vById = Object.fromEntries(variants.map((v) => [v.ID, v]));
    const variantIds = variants.map((v) => v.ID);

    const batches = variantIds.length
      ? await SELECT.from(Batches).where({ variant_ID: { in: variantIds } })
      : [];
    const bById = Object.fromEntries(batches.map((b) => [b.ID, b]));
    const batchIds = batches.map((b) => b.ID);

    const dpps = await SELECT.from(DPPs).where({ product_ID: { in: productIds } });

    // Documents — metadata columns ONLY (never the LargeBinary content stream). Tenant
    // safety is transitive via the org-scoped product/batch IN-lists.
    const productDocs = await SELECT.from(Documents)
      .columns('ID', 'product_ID', 'batch_ID', 'doc_type', 'valid_until')
      .where({ product_ID: { in: productIds } });
    const batchDocs = batchIds.length
      ? await SELECT.from(Documents)
          .columns('ID', 'product_ID', 'batch_ID', 'doc_type', 'valid_until')
          .where({ batch_ID: { in: batchIds } })
      : [];

    // Grouping maps.
    const docsByProduct = new Map();
    for (const d of productDocs) {
      if (!docsByProduct.has(d.product_ID)) docsByProduct.set(d.product_ID, []);
      docsByProduct.get(d.product_ID).push(d);
    }
    const docsByBatch = new Map();
    for (const d of batchDocs) {
      if (!docsByBatch.has(d.batch_ID)) docsByBatch.set(d.batch_ID, []);
      docsByBatch.get(d.batch_ID).push(d);
    }
    const productToBatches = new Map();
    const batchesByProduct = new Map();
    for (const b of batches) {
      const v = vById[b.variant_ID];
      const pid = v ? v.product_ID : null;
      if (!pid) continue;
      if (!productToBatches.has(pid)) productToBatches.set(pid, []);
      productToBatches.get(pid).push(b.ID);
      if (!batchesByProduct.has(pid)) batchesByProduct.set(pid, []);
      batchesByProduct.get(pid).push(b);
    }
    const dppsByProduct = new Map();
    for (const d of dpps) {
      if (!dppsByProduct.has(d.product_ID)) dppsByProduct.set(d.product_ID, []);
      dppsByProduct.get(d.product_ID).push(d);
    }

    const nonExpired = (doc) => doc.valid_until == null || day(doc.valid_until) >= TODAY;
    const isExpired = (doc) => doc.valid_until != null && day(doc.valid_until) < TODAY;
    const isExpiringSoon = (doc) =>
      doc.valid_until != null && day(doc.valid_until) >= TODAY && day(doc.valid_until) <= PLUS90;

    // Evidence over an effective document set against the expected-type set.
    const evidenceOf = (effectiveDocs) => {
      const validDocs = effectiveDocs.filter(nonExpired);
      const covered = EXPECTED.filter((t) => validDocs.some((d) => d.doc_type === t));
      const missing = EXPECTED.filter((t) => !covered.includes(t));
      const score = r3(covered.length / EXPECTED.length);
      const cls =
        effectiveDocs.length === 0
          ? 'none'
          : validDocs.length === 0
            ? 'expired_only'
            : score === 1
              ? 'complete'
              : 'partial';
      return { validDocs, covered, missing, score, cls, complete: score === 1 };
    };

    // ---- Per-product rows (the product census) ----
    const by_product = [];
    for (const p of products) {
      if (productType && p.product_type !== productType) continue;
      if (esprStatus && (p.espr_compliance || 'draft') !== esprStatus) continue;

      const prodBatches = batchesByProduct.get(p.ID) || [];
      const prodDpps = dppsByProduct.get(p.ID) || [];
      const date =
        maxDate(prodBatches.map((b) => b.production_date)) ||
        maxDate(prodDpps.map((d) => d.published_at)) ||
        maxDate(prodDpps.map((d) => d.createdAt)) ||
        day(p.createdAt);

      if (dateFrom && (!date || date < dateFrom)) continue;
      if (dateTo && (!date || date > dateTo)) continue;

      const ownDocs = docsByProduct.get(p.ID) || [];
      const inheritedDocs = (productToBatches.get(p.ID) || []).flatMap((bid) => docsByBatch.get(bid) || []);
      const effectiveDocs = ownDocs.concat(inheritedDocs);
      const ev = evidenceOf(effectiveDocs);

      const hasType = (t) => ev.validDocs.some((d) => d.doc_type === t);
      const expiredOnlyType = (t) => !hasType(t) && effectiveDocs.some((d) => d.doc_type === t);

      const published = prodDpps.some((d) => d.status === 'published');
      const declared_not_evidenced = p.espr_compliance === 'compliant' && ev.score < 1;
      const risk_flag = declared_not_evidenced
        ? 'Declared, not evidenced'
        : p.espr_compliance === 'non_compliant'
          ? 'Non-compliant'
          : !ev.complete
            ? 'Incomplete'
            : 'OK';

      by_product.push({
        product_id: p.ID,
        name: p.name,
        product_type: p.product_type,
        espr_compliance: p.espr_compliance || 'draft',
        _date: date,
        doc_count: effectiveDocs.length,
        valid_doc_count: ev.validDocs.length,
        expired_doc_count: effectiveDocs.filter(isExpired).length,
        expiring_doc_count: effectiveDocs.filter(isExpiringSoon).length,
        has_certificate: hasType('certificate'),
        certificate_expired_only: expiredOnlyType('certificate'),
        has_test_report: hasType('test_report'),
        test_report_expired_only: expiredOnlyType('test_report'),
        has_doc: hasType('declaration_of_conformity'),
        doc_expired_only: expiredOnlyType('declaration_of_conformity'),
        covered_types: ev.covered.length,
        missing_types: ev.missing,
        evidence_score: ev.score,
        evidence_complete: ev.complete,
        evidence_class: ev.cls,
        published,
        declared_not_evidenced,
        risk_flag
      });
    }

    // ---- Per-batch rows (documentation view; UNION own batch docs + parent product docs) ----
    const by_batch = [];
    for (const b of batches) {
      const v = vById[b.variant_ID];
      const p = v ? pById[v.product_ID] : null;
      if (!p) continue;
      if (productType && p.product_type !== productType) continue;
      if (esprStatus && (p.espr_compliance || 'draft') !== esprStatus) continue;
      const date = day(b.production_date);
      if (dateFrom && (!date || date < dateFrom)) continue;
      if (dateTo && (!date || date > dateTo)) continue;

      const ownDocs = docsByBatch.get(b.ID) || [];
      const inheritedDocs = docsByProduct.get(p.ID) || [];
      const effectiveDocs = ownDocs.concat(inheritedDocs);
      const ev = evidenceOf(effectiveDocs);

      by_batch.push({
        batch_id: b.ID,
        batch_number: b.batch_number,
        product_id: p.ID,
        product_name: p.name,
        variant_id: v.ID,
        variant_label: variantLabel(v),
        production_date: date,
        status: b.status,
        country_of_origin_set: !!(b.country_of_origin && String(b.country_of_origin).trim()),
        batch_doc_count: ownDocs.length,
        product_doc_count: inheritedDocs.length,
        covered_types: ev.covered.length,
        missing_types: ev.missing,
        evidence_score: ev.score,
        evidence_complete: ev.complete
      });
    }

    // ---- KPIs + distributions over the in-scope product census ----
    const total = by_product.length;
    const espr_distribution = { compliant: 0, in_review: 0, non_compliant: 0, draft: 0 };
    const evidence_distribution = { complete: 0, partial: 0, expired_only: 0, none: 0 };
    const type_coverage = { certificate: 0, test_report: 0, declaration_of_conformity: 0, safety_data_sheet: 0, manual: 0, other: 0 };

    for (const row of by_product) {
      const k = row.espr_compliance;
      if (espr_distribution[k] != null) espr_distribution[k] += 1;
      evidence_distribution[row.evidence_class] += 1;
    }
    // type_coverage: products with >=1 non-expired doc of each type (all 6 types, for completeness).
    for (const p of by_product) {
      const ownDocs = docsByProduct.get(p.product_id) || [];
      const inheritedDocs = (productToBatches.get(p.product_id) || []).flatMap((bid) => docsByBatch.get(bid) || []);
      const validDocs = ownDocs.concat(inheritedDocs).filter(nonExpired);
      for (const t of ALL_DOC_TYPES) if (validDocs.some((d) => d.doc_type === t)) type_coverage[t] += 1;
    }

    const completeCount = by_product.filter((r) => r.evidence_complete).length;
    // Count published passports of IN-SCOPE products only — every other KPI is census-scoped
    // (filtered by productType/esprStatus/date), so this must be too, else a productType filter
    // would still report published DPPs of excluded products (published_dpps > products).
    const inScopeProductIds = new Set(by_product.map((r) => r.product_id));
    const published_dpps = dpps.filter((d) => d.status === 'published' && inScopeProductIds.has(d.product_ID)).length;

    const kpis = {
      products: total,
      published_dpps,
      espr_ready_pct: pct(espr_distribution.compliant, total, 1),
      espr_blocking: total - espr_distribution.compliant,
      non_compliant: espr_distribution.non_compliant,
      in_review: espr_distribution.in_review,
      draft: espr_distribution.draft,
      docs_complete_pct: pct(completeCount, total, 1),
      avg_docs_score: avg(by_product.map((r) => r.evidence_score)),
      products_no_docs: evidence_distribution.none,
      products_expired_only: evidence_distribution.expired_only,
      docs_expiring_soon: by_product.reduce((s, r) => s + r.expiring_doc_count, 0),
      docs_expired: by_product.reduce((s, r) => s + r.expired_doc_count, 0),
      declared_not_evidenced: by_product.filter((r) => r.declared_not_evidenced).length,
      doc_coverage_certs_pct: pct(by_product.filter((r) => r.has_certificate).length, total, 1),
      doc_coverage_test_pct: pct(by_product.filter((r) => r.has_test_report).length, total, 1),
      doc_coverage_doc_pct: pct(by_product.filter((r) => r.has_doc).length, total, 1)
    };

    // ---- Monthly time series over the product census ----
    const monthMap = new Map();
    for (const row of by_product) {
      const month = row._date ? row._date.slice(0, 7) : null;
      if (!month) continue;
      if (!monthMap.has(month)) monthMap.set(month, []);
      monthMap.get(month).push(row);
    }
    const time_series = [...monthMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, rs]) => {
        const compliant = rs.filter((r) => r.espr_compliance === 'compliant').length;
        return {
          month,
          products: rs.length,
          compliant,
          compliant_pct: pct(compliant, rs.length, 1),
          avg_docs_score_pct: r3((avg(rs.map((r) => r.evidence_score)) || 0) * 100)
        };
      });

    // Drop the internal _date helper before serializing.
    for (const row of by_product) delete row._date;

    return JSON.stringify({
      range: { from: dateFrom, to: dateTo },
      today: TODAY,
      expected_doc_types: EXPECTED,
      kpis,
      espr_distribution,
      evidence_distribution,
      type_coverage,
      time_series,
      by_product,
      by_batch
    });
  });
};
