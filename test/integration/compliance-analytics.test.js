'use strict';

// US9.x Compliance analytics: org-wide, tenant-scoped ESPR readiness + documentation-
// evidence completeness payload (JSON string). company_advanced only; company_user → 403;
// ORG-B cannot see ORG-A data. The seed has no Documents, so evidence fixtures are
// inserted here: prod-tshirt-classic gets all 3 expected types (valid) → complete (and its
// batch inherits them → UNION rule); prod-jacket-denim gets one expired cert → expired_only.

const cds = require('@sap/cds');

const { POST } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } }; // ORG-A advanced
const carol = { auth: { username: 'carol.user', password: 'x' } };     // ORG-A read-only
const dan = { auth: { username: 'dan.advanced.b', password: 'x' } };   // ORG-B advanced

const call = (body, who) => POST('/odata/v4/dpp/complianceAnalytics', body || {}, who);
const parse = (res) => JSON.parse(res.data.value);
const EXPECTED = ['certificate', 'test_report', 'declaration_of_conformity'];

beforeAll(async () => {
  const { Documents } = cds.entities('dpp');
  await INSERT.into(Documents).entries([
    { ID: 'doc-test-cert', product_ID: 'prod-tshirt-classic', doc_type: 'certificate', title: 'Test cert', valid_until: null },
    { ID: 'doc-test-tr', product_ID: 'prod-tshirt-classic', doc_type: 'test_report', title: 'Test report', valid_until: '2030-01-01' },
    { ID: 'doc-test-doc', product_ID: 'prod-tshirt-classic', doc_type: 'declaration_of_conformity', title: 'Test DoC', valid_until: '2030-01-01' },
    { ID: 'doc-test-exp', product_ID: 'prod-jacket-denim', doc_type: 'certificate', title: 'Expired cert', valid_until: '2000-01-01' }
  ]);
});

describe('Compliance analytics (US9.x)', () => {
  test('advanced user gets the full compliance payload', async () => {
    const res = await call({}, alice);
    expect(res.status).toBe(200);
    const data = parse(res);

    expect(data.kpis).toBeDefined();
    expect(data.kpis.products).toBeGreaterThan(0);
    expect(Array.isArray(data.by_product)).toBe(true);
    expect(Array.isArray(data.by_batch)).toBe(true);
    expect(Array.isArray(data.time_series)).toBe(true);
    expect(data.espr_distribution).toMatchObject({
      compliant: expect.any(Number), in_review: expect.any(Number), non_compliant: expect.any(Number), draft: expect.any(Number)
    });
    expect(data.evidence_distribution).toMatchObject({
      complete: expect.any(Number), partial: expect.any(Number), expired_only: expect.any(Number), none: expect.any(Number)
    });
    expect(data.expected_doc_types).toEqual(EXPECTED);
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('KPI / distribution consistency', async () => {
    const data = parse(await call({}, alice));
    const e = data.espr_distribution;
    expect(e.compliant + e.in_review + e.non_compliant + e.draft).toBe(data.kpis.products);
    expect(data.kpis.espr_blocking).toBe(data.kpis.products - e.compliant);
    expect(data.kpis.products).toBe(data.by_product.length);
    const ev = data.evidence_distribution;
    expect(ev.complete + ev.partial + ev.expired_only + ev.none).toBe(data.kpis.products);
  });

  test('evidence scores are bounded and self-consistent', async () => {
    const data = parse(await call({}, alice));
    for (const r of data.by_product) {
      expect([0, 0.333, 0.667, 1]).toContain(r.evidence_score);
      expect(r.evidence_complete).toBe(r.evidence_score === 1);
      expect(r.covered_types + r.missing_types.length).toBe(3);
      if (r.declared_not_evidenced) {
        expect(r.espr_compliance).toBe('compliant');
        expect(r.evidence_score).toBeLessThan(1);
        expect(r.risk_flag).toBe('Declared, not evidenced');
      }
    }
  });

  test('coverage math identities hold', async () => {
    const data = parse(await call({}, alice));
    const n = data.kpis.products;
    const round1 = (part) => Number(((100 * part) / n).toFixed(1));
    expect(data.kpis.doc_coverage_doc_pct).toBe(round1(data.by_product.filter((r) => r.has_doc).length));
    expect(data.kpis.doc_coverage_certs_pct).toBe(round1(data.by_product.filter((r) => r.has_certificate).length));
    expect(data.kpis.docs_complete_pct).toBe(round1(data.by_product.filter((r) => r.evidence_complete).length));
  });

  test('a product with all 3 valid expected types is complete (null valid_until counts as valid)', async () => {
    const data = parse(await call({}, alice));
    const p = data.by_product.find((r) => r.product_id === 'prod-tshirt-classic');
    expect(p).toBeTruthy();
    expect(p.evidence_complete).toBe(true);
    expect(p.evidence_score).toBe(1);
    expect(p.covered_types).toBe(3);
    expect(p.has_certificate).toBe(true);
    expect(p.evidence_class).toBe('complete');
    expect(p.declared_not_evidenced).toBe(false); // it is compliant AND complete
  });

  test('a product whose only doc is expired is classified expired_only', async () => {
    const data = parse(await call({}, alice));
    const p = data.by_product.find((r) => r.product_id === 'prod-jacket-denim');
    expect(p).toBeTruthy();
    expect(p.evidence_class).toBe('expired_only');
    expect(p.has_certificate).toBe(false);
    expect(p.certificate_expired_only).toBe(true);
    expect(p.valid_doc_count).toBe(0);
    expect(p.expired_doc_count).toBe(1);
  });

  test('batch evidence unions the parent product docs (own batch docs empty → still complete)', async () => {
    const data = parse(await call({}, alice));
    const b = data.by_batch.find((r) => r.batch_id === 'batch-2026-05-A');
    expect(b).toBeTruthy();
    expect(b.batch_doc_count).toBe(0);
    expect(b.product_doc_count).toBe(3);
    expect(b.evidence_complete).toBe(true);
  });

  test('esprStatus filter narrows to that status only', async () => {
    const data = parse(await call({ esprStatus: 'in_review' }, alice));
    expect(data.by_product.length).toBeGreaterThan(0);
    for (const r of data.by_product) expect(r.espr_compliance).toBe('in_review');
    expect(data.espr_distribution.compliant).toBe(0);
    expect(data.kpis.declared_not_evidenced).toBe(0); // cross-check only fires on 'compliant'
  });

  test('productType filter returns only that type', async () => {
    const data = parse(await call({ productType: 'finished' }, alice));
    for (const r of data.by_product) expect(r.product_type).toBe('finished');
  });

  test('published_dpps is census-scoped (respects the productType filter)', async () => {
    const all = parse(await call({}, alice)).kpis.published_dpps;
    const pkg = parse(await call({ productType: 'packaging' }, alice)).kpis.published_dpps;
    // Packaging is a strict subset of the org, so its published-passport count must be
    // smaller than the org-wide count. (Before the census-scoping fix they were equal.)
    expect(pkg).toBeLessThan(all);
  });

  test('a far-future window yields an empty census but a valid today', async () => {
    const data = parse(await call({ dateFrom: '2999-01-01', dateTo: '2999-12-31' }, alice));
    expect(data.kpis.products).toBe(0);
    expect(data.by_product).toHaveLength(0);
    expect(data.by_batch).toHaveLength(0);
    expect(data.kpis.espr_ready_pct).toBeNull();
    expect(data.range).toEqual({ from: '2999-01-01', to: '2999-12-31' });
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('a narrow past window does not widen the census', async () => {
    const all = parse(await call({}, alice));
    const narrowed = parse(await call({ dateFrom: '1900-01-01', dateTo: '2000-01-01' }, alice));
    expect(narrowed.kpis.products).toBeLessThanOrEqual(all.kpis.products);
  });

  test('company_user is forbidden (403)', async () => {
    const res = await POST('/odata/v4/dpp/complianceAnalytics', {}, { ...carol, validateStatus: () => true });
    expect(res.status).toBe(403);
  });

  test('tenant isolation: ORG-A and ORG-B never see each other', async () => {
    const a = parse(await call({}, alice));
    const b = parse(await call({}, dan));
    const aProd = new Set(a.by_product.map((p) => p.product_id));
    for (const p of b.by_product) expect(aProd.has(p.product_id)).toBe(false);
    const aBatch = new Set(a.by_batch.map((r) => r.batch_id));
    for (const r of b.by_batch) expect(aBatch.has(r.batch_id)).toBe(false);
  });
});
