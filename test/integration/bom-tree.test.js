'use strict';

const cds = require('@sap/cds');
const tokens = require('../../srv/lib/token');

const { GET, axios } = cds.test().in(__dirname + '/../..');

const aliceAdmin = { auth: { username: 'alice.admin', password: 'x' } };

describe('Product BOM (Products + ProductBOMs)', () => {
  test('alice.admin can read tenant-scoped Products including materials', async () => {
    const { data } = await GET(
      '/odata/v4/dpp/Products?$select=ID,name,product_type,owning_organization_ID',
      aliceAdmin
    );
    expect(data.value.length).toBeGreaterThan(0);
    expect(data.value.every((p) => p.owning_organization_ID === 'org-greenline')).toBe(true);
    const types = new Set(data.value.map((p) => p.product_type));
    expect(types.has('finished')).toBe(true);
    expect(types.has('material')).toBe(true);
  });

  test('alice.admin cannot see Fashionista products', async () => {
    const { data } = await GET('/odata/v4/dpp/Products', aliceAdmin);
    expect(data.value.some((p) => p.owning_organization_ID === 'org-fashionista')).toBe(false);
  });

  test('Classic T-Shirt BOM links to cotton and elastane materials', async () => {
    const { data } = await GET(
      "/odata/v4/dpp/ProductBOMs?$filter=parent_ID eq 'prod-tshirt-classic'",
      aliceAdmin
    );
    const components = new Set(data.value.map((b) => b.component_ID));
    expect(components).toEqual(new Set(['prod-mat-cotton', 'prod-mat-elastane']));
    const totalPct = data.value.reduce((sum, b) => sum + Number(b.quantity), 0);
    expect(Math.abs(totalPct - 100)).toBeLessThan(0.01);
  });
});

describe('Public consumer DTO with recursive BOM tree', () => {
  test('seeded item-level DPP exposes nested BOM via QR token', async () => {
    // Mint a real HMAC-signed token and stamp it onto the seeded DPP.
    const token = tokens.generate();
    const { DPPs } = cds.entities('dpp');
    await UPDATE(DPPs).set({ qr_token: token }).where({ ID: 'dpp-12345' });

    const { data } = await axios.get(`/public/dpp/${token}`);

    expect(data.product.name).toBe('Classic T-Shirt');
    expect(data.item.upi).toBe('UPI-12345');
    expect(data.variant.color).toBe('Blue');
    expect(data.batch.batch_number).toBe('2026-05-A');
    expect(Array.isArray(data.materials)).toBe(true);

    const cotton = data.materials.find((m) => m.name === 'Organic Cotton Fabric');
    expect(cotton).toBeDefined();
    expect(Number(cotton.quantity)).toBe(95);
    expect(cotton.unit).toBe('%');
    expect(cotton.role).toBe('Main fabric');
  });
});
