'use strict';

// US9.6 Sustainability analytics: one org-wide, tenant-scoped KPI/breakdown
// payload (JSON string) computed server-side by reusing the BOM aggregator per
// DPP. company_advanced only; company_user → 403; ORG-B cannot see ORG-A data.

const cds = require('@sap/cds');

const { POST } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } }; // ORG-A advanced
const carol = { auth: { username: 'carol.user', password: 'x' } };     // ORG-A read-only
const dan = { auth: { username: 'dan.advanced.b', password: 'x' } };   // ORG-B advanced

const call = (body, who) => POST('/odata/v4/dpp/sustainabilityAnalytics', body || {}, who);
const parse = (res) => JSON.parse(res.data.value);

describe('Sustainability analytics (US9.6)', () => {
  test('advanced user gets KPIs + breakdowns for the org', async () => {
    const res = await call({}, alice);
    expect(res.status).toBe(200);
    const data = parse(res);

    expect(data.kpis).toBeDefined();
    expect(data.kpis.products).toBeGreaterThan(0);
    expect(data.kpis.passports).toBeGreaterThan(0);
    expect(Array.isArray(data.by_product)).toBe(true);
    expect(Array.isArray(data.by_variant)).toBe(true);
    expect(Array.isArray(data.by_batch)).toBe(true);
    expect(Array.isArray(data.time_series)).toBe(true);
    expect(data.espr_distribution).toMatchObject({
      compliant: expect.any(Number),
      in_review: expect.any(Number),
      non_compliant: expect.any(Number),
      draft: expect.any(Number)
    });

    // KPI/breakdown consistency + the cradle-to-gate rollup actually computed.
    expect(data.kpis.products).toBe(data.by_product.length);
    expect(data.by_product.some((p) => typeof p.co2_kg === 'number')).toBe(true);
  });

  test('a far-future date window yields an empty result set', async () => {
    const res = await call({ dateFrom: '2999-01-01', dateTo: '2999-12-31' }, alice);
    expect(res.status).toBe(200);
    const data = parse(res);
    expect(data.kpis.passports).toBe(0);
    expect(data.by_product).toHaveLength(0);
    expect(data.by_batch).toHaveLength(0);
    expect(data.range).toEqual({ from: '2999-01-01', to: '2999-12-31' });
  });

  test('a date window narrows the set vs unbounded', async () => {
    const all = parse(await call({}, alice));
    const narrowed = parse(await call({ dateFrom: '1900-01-01', dateTo: '2000-01-01' }, alice));
    expect(narrowed.kpis.passports).toBeLessThanOrEqual(all.kpis.passports);
  });

  test('a productType filter only returns products of that type', async () => {
    const res = await call({ productType: 'material' }, alice);
    expect(res.status).toBe(200);
    const data = parse(res);
    for (const p of data.by_product) expect(p.product_type).toBe('material');
  });

  test('company_user is forbidden (403)', async () => {
    const res = await POST(
      '/odata/v4/dpp/sustainabilityAnalytics',
      {},
      { ...carol, validateStatus: () => true }
    );
    expect(res.status).toBe(403);
  });

  test('tenant isolation: ORG-B advanced does not see ORG-A products', async () => {
    const a = parse(await call({}, alice));
    const b = parse(await call({}, dan));
    const aIds = new Set(a.by_product.map((p) => p.product_id));
    for (const p of b.by_product) expect(aIds.has(p.product_id)).toBe(false);
  });
});
