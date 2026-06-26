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
    const components = new Set(data.value.map((b) => b.component_ID).filter(Boolean));
    expect(components.has('prod-mat-cotton')).toBe(true);
    expect(components.has('prod-mat-elastane')).toBe(true);
    const totalMassG = data.value
      .filter((b) => b.unit === 'g')
      .reduce((sum, b) => sum + Number(b.quantity), 0);
    expect(totalMassG).toBeCloseTo(180, 1);   // 171 g cotton + 9 g elastane (pcs packaging excluded)
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
    // batch_number defaults to 'internal' (hidden from both the batch section and the
    // identification block, which now follows the batch field setting); product_id is
    // always exposed in identification.
    expect(data.identification.product_id).toBe('prod-tshirt-classic');
    expect(Array.isArray(data.materials)).toBe(true);

    // Storytelling is a product-level property, parsed into an array for the consumer.
    expect(Array.isArray(data.product.storytelling)).toBe(true);
    expect(data.product.storytelling.length).toBeGreaterThan(0);
    expect(data.product.storytelling[0].title).toBeTruthy();
    // Colour-correct image comes from the variant.
    expect(data.variant.image_url).toMatch(/^https?:\/\//);

    const cotton = data.materials.find((m) => m.name === 'Organic Cotton Fabric');
    expect(cotton).toBeDefined();
    expect(Number(cotton.quantity)).toBe(171);
    expect(cotton.unit).toBe('g');
    expect(cotton.role).toBe('Main fabric');
    expect(cotton.sub_dpp).toMatchObject({ id: 'dpp-cotton' });

    const elastane = data.materials.find((m) => m.name === 'Elastane Yarn');
    expect(elastane).toBeDefined();
    expect(elastane.external_dpp_url).toMatch(/^https?:\/\//);
    expect(elastane.sub_dpp).toBeNull();

    expect(data.aggregated).toBeDefined();
    // Cotton via internal DPP + elastane via external supplier values → fully resolved.
    expect(data.aggregated.incomplete).toBe(false);

    // CO2 = 2.4 (cut&sew/unit) + 15.0×0.171 (cotton) + 20.0×0.009 (elastane) + 0.01×1 (polybag) = 5.155.
    expect(data.aggregated.values.co2_footprint_kg).toBeCloseTo(5.155, 2);
    // Recycled = mass-weighted average: (15×0.171 + 0×0.009) / 0.180 = 14.25 % (pcs polybag adds no mass basis).
    expect(data.aggregated.values.recycled_content_pct).toBeCloseTo(14.25, 2);
  });
});
