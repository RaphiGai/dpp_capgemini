'use strict';

// Per-field consumer visibility (company_advanced): fields marked 'internal' drop out of
// the public consumer DTO; regulatory-locked fields always stay; hiding a BOM component
// removes it from the materials tree without changing the CO2 rollup. Writes are gated to
// company_advanced. Tokens are minted at runtime (env secret differs from the seed secret).

const cds = require('@sap/cds');
const tokens = require('../../srv/lib/token');

// Use the jest global `expect` (the cds-test expect lacks toBeCloseTo).
const { PATCH, axios } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } }; // company_advanced
const carol = { auth: { username: 'carol.user', password: 'x' } }; // company_user (read-only)

async function attachToken(dppId) {
  const { DPPs } = cds.entities('dpp');
  const token = tokens.generate();
  await UPDATE(DPPs).set({ qr_token: token }).where({ ID: dppId });
  return token;
}

const getPublic = (token) => axios.get(`/public/dpp/${token}`, { validateStatus: () => true });

// Keep tests order-independent — clear everything this suite writes.
async function reset() {
  const { Products, ProductVariants, Batches, ProductBOMs } = cds.entities('dpp');
  await UPDATE(Products).set({ field_visibility: null }).where({ ID: 'prod-tshirt-classic' });
  await UPDATE(ProductVariants).set({ field_visibility: null }).where({ ID: 'var-tshirt-blue-m' });
  await UPDATE(Batches).set({ field_visibility: null }).where({ ID: 'batch-2026-05-A' });
  await UPDATE(ProductBOMs).set({ visibility: 'public' }).where({ parent_ID: 'var-tshirt-blue-m' });
}

beforeEach(reset);

describe('Defaults follow the field catalogue', () => {
  test('internal-default fields hidden; public/locked fields shown', async () => {
    const token = await attachToken('dpp-12345');
    const { status, data } = await getPublic(token);
    expect(status).toBe(200);

    // variant: sku/gtin default internal → omitted; colour public → present
    expect(data.variant).not.toHaveProperty('sku');
    expect(data.variant).not.toHaveProperty('gtin');
    expect(data.variant.color).toBe('Blue');

    // batch: number/date default internal → omitted; country_of_origin locked → present
    expect(data.batch).not.toHaveProperty('batch_number');
    expect(data.batch).not.toHaveProperty('production_date');
    expect(data.batch.country_of_origin).toBe('PT');

    // product locked fields always present
    expect(data.product.name).toBe('Classic T-Shirt');
    expect(data.product.fibre_composition).toBeTruthy();
  });
});

describe('Per-field overrides', () => {
  test('a public field set internal is hidden', async () => {
    const { Products } = cds.entities('dpp');
    await UPDATE(Products)
      .set({ field_visibility: JSON.stringify({ model: 'internal', description: 'internal' }) })
      .where({ ID: 'prod-tshirt-classic' });
    const { data } = await getPublic(await attachToken('dpp-12345'));
    expect(data.product).not.toHaveProperty('model');
    expect(data.product).not.toHaveProperty('description');
    expect(data.product.name).toBe('Classic T-Shirt');
  });

  test('a locked field cannot be hidden even if the map says internal', async () => {
    const { Products } = cds.entities('dpp');
    await UPDATE(Products)
      .set({
        field_visibility: JSON.stringify({
          name: 'internal',
          fibre_composition: 'internal',
          country_of_origin: 'internal'
        })
      })
      .where({ ID: 'prod-tshirt-classic' });
    const { data } = await getPublic(await attachToken('dpp-12345'));
    expect(data.product.name).toBe('Classic T-Shirt');
    expect(data.product.fibre_composition).toBeTruthy();
    expect(data.product.country_of_origin).toBeTruthy();
  });

  test('an internal-default field can be revealed (sku → public)', async () => {
    const { ProductVariants } = cds.entities('dpp');
    await UPDATE(ProductVariants)
      .set({ field_visibility: JSON.stringify({ sku: 'public' }) })
      .where({ ID: 'var-tshirt-blue-m' });
    const { data } = await getPublic(await attachToken('dpp-12345'));
    expect(data.variant.sku).toBe('TSHIRT-BLUE-M');
  });
});

describe('OData write path (company_advanced) end-to-end', () => {
  test('PATCH field_visibility persists and hides the field in the consumer view', async () => {
    // Real OData PATCH (not a direct UPDATE) — proves the write path persists the column.
    await PATCH(
      "/odata/v4/dpp/Products('prod-tshirt-classic')",
      { field_visibility: JSON.stringify({ description: 'internal' }) },
      alice
    );
    const { data } = await getPublic(await attachToken('dpp-12345'));
    expect(data.product).not.toHaveProperty('description');
    expect(data.product.name).toBe('Classic T-Shirt'); // locked field stays
  });
});

describe('Identification block derives from source fields', () => {
  test('batch_number follows the batch field setting; product_id always public', async () => {
    // Default: batch_number internal → hidden from the identification block.
    let data = (await getPublic(await attachToken('dpp-12345'))).data;
    expect(data.identification.batch_number).toBeNull();
    expect(data.identification.product_id).toBe('prod-tshirt-classic');

    // Set the batch's batch_number public → it appears in identification.
    const { Batches } = cds.entities('dpp');
    await UPDATE(Batches)
      .set({ field_visibility: JSON.stringify({ batch_number: 'public' }) })
      .where({ ID: 'batch-2026-05-A' });
    data = (await getPublic(await attachToken('dpp-12345'))).data;
    expect(data.identification.batch_number).toBe('2026-05-A');
  });
});

describe('BOM component visibility — display only', () => {
  test('hiding a component removes it from the tree but not from the CO2 rollup', async () => {
    const { ProductBOMs } = cds.entities('dpp');
    const token = await attachToken('dpp-12345');

    const before = (await getPublic(token)).data;
    expect(before.materials.find((m) => m.component_ID === 'prod-mat-cotton')).toBeDefined();
    const co2Before = Number(before.aggregated.values.co2_footprint_kg);

    await UPDATE(ProductBOMs).set({ visibility: 'internal' }).where({ ID: 'bom-tshirt-cotton' });

    const after = (await getPublic(token)).data;
    expect(after.materials.find((m) => m.component_ID === 'prod-mat-cotton')).toBeUndefined();
    expect(Number(after.aggregated.values.co2_footprint_kg)).toBeCloseTo(co2Before, 5);
  });
});

describe('Role gating', () => {
  test('a company_user cannot write field_visibility (403)', async () => {
    let status = 0;
    try {
      await PATCH("/odata/v4/dpp/Products('prod-tshirt-classic')", { field_visibility: '{}' }, carol);
    } catch (err) {
      status = err.response?.status || err.status || err.code;
    }
    expect(status).toBe(403);
  });
});
