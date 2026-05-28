'use strict';

const cds = require('@sap/cds');
const tokens = require('../../srv/lib/token');

const { GET, axios } = cds.test().in(__dirname + '/../..');

const aliceAdmin = { auth: { username: 'alice.advanced', password: 'x' } };

describe('Product BOM (Products + ProductBOMs)', () => {
  test('alice.advanced can read Products including materials', async () => {
    const { data } = await GET(
      '/odata/v4/dpp/Products?$select=ID,name,product_type,owning_organization_ID',
      aliceAdmin
    );
    expect(data.value.length).toBeGreaterThan(0);
    const types = new Set(data.value.map((p) => p.product_type));
    expect(types.has('finished')).toBe(true);
    expect(types.has('material')).toBe(true);
  });

  test('Classic T-Shirt variant BOM links to cotton and elastane components', async () => {
    const { data } = await GET(
      "/odata/v4/dpp/ProductBOMs?$filter=parent_ID eq 'var-tshirt-blue-m'",
      aliceAdmin
    );
    const components = new Set(data.value.map((b) => b.component_ID));
    expect(components).toEqual(new Set(['prod-mat-cotton', 'prod-mat-elastane']));
    const totalPct = data.value.reduce((sum, b) => sum + Number(b.quantity), 0);
    expect(Math.abs(totalPct - 100)).toBeLessThan(0.01);
  });
});

describe('Public consumer DTO with recursive BOM tree', () => {
  test('seeded batch-level DPP exposes nested BOM + aggregation via QR token', async () => {
    const token = tokens.generate();
    const { DPPs } = cds.entities('dpp');
    await UPDATE(DPPs).set({ qr_token: token }).where({ ID: 'dpp-12345' });

    const { data } = await axios.get(`/public/dpp/${token}`);

    expect(data.product.name).toBe('Classic T-Shirt');
    expect(data.variant.color).toBe('Blue');
    expect(data.batch.batch_number).toBe('2026-05-A');
    expect(Array.isArray(data.materials)).toBe(true);

    const cotton = data.materials.find((m) => m.name === 'Organic Cotton Fabric');
    expect(cotton).toBeDefined();
    expect(Number(cotton.quantity)).toBe(95);
    expect(cotton.unit).toBe('%');
    expect(cotton.role).toBe('Main fabric');
    expect(cotton.sub_dpp).toMatchObject({ id: 'dpp-cotton' });

    const elastane = data.materials.find((m) => m.name === 'Elastane Yarn');
    expect(elastane).toBeDefined();
    expect(elastane.external_dpp_url).toMatch(/^https?:\/\//);
    expect(elastane.sub_dpp).toBeNull();

    expect(data.aggregated).toBeDefined();
    expect(data.aggregated.incomplete).toBe(true);
    expect(typeof data.aggregated.values.co2_footprint_kg).toBe('number');
  });
});
