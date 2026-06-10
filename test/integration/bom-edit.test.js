'use strict';

const cds = require('@sap/cds');

const { POST, PATCH } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } };

describe('ProductBOM edit (PATCH)', () => {
  test('internal line PATCH mirrors the BomEditor save payload (incl. ext fields)', async () => {
    const res = await PATCH(
      "/odata/v4/dpp/ProductBOMs('bom-tshirt-cotton')",
      {
        component_ID: 'prod-mat-cotton',
        quantity: 171,
        unit: 'g',
        component_role: 'Main fabric',
        external_dpp_url: null,
        ext_co2_footprint: null,
        ext_recycled_content_pct: null,
        sub_dpp_ID: 'dpp-cotton'
      },
      alice
    );
    expect(res.status).toBe(200);
    expect(res.data.quantity).toBe(171);
  });

  test('switching a line to external persists the supplier footprint values', async () => {
    const res = await PATCH(
      "/odata/v4/dpp/ProductBOMs('bom-tshirt-elastane')",
      {
        component_ID: 'prod-mat-elastane',
        quantity: 9,
        unit: 'g',
        component_role: 'Stretch yarn',
        external_dpp_url: 'https://supplier.example/dpp/elastane-2026',
        ext_co2_footprint: 22.5,
        ext_recycled_content_pct: 3,
        sub_dpp_ID: null
      },
      alice
    );
    expect(res.status).toBe(200);
    expect(Number(res.data.ext_co2_footprint)).toBeCloseTo(22.5, 2);
  });
});

describe('External BOM component without an internal product', () => {
  test('persists free-text name / category / fibre and a null component', async () => {
    const res = await POST(
      '/odata/v4/dpp/ProductBOMs',
      {
        ID: 'test-ext-bom-1',
        parent_ID: 'var-tshirt-blue-l',
        component_ID: null,
        component_name: 'Recycled polyester thread',
        component_category: 'Trim',
        component_fibre_composition: '100% rPET',
        quantity: 3,
        unit: 'g',
        external_dpp_url: 'https://supplier.example/dpp/thread',
        ext_co2_footprint: 5,
        ext_recycled_content_pct: 100,
        is_mandatory: true,
        status: 'active'
      },
      alice
    );
    expect(res.status).toBe(201);
    expect(res.data.component_ID).toBeNull();
    expect(res.data.component_name).toBe('Recycled polyester thread');
  });

  test('a line with neither an internal product nor a name is rejected', async () => {
    await expect(
      POST(
        '/odata/v4/dpp/ProductBOMs',
        { ID: 'test-bad-bom', parent_ID: 'var-tshirt-blue-l', quantity: 1, unit: 'g', status: 'active' },
        alice
      )
    ).rejects.toMatchObject({ response: { status: 400 } });
  });
});

describe('ProductVariant edit (PATCH) — image_url', () => {
  test('saving a variant with the new image_url field succeeds', async () => {
    const res = await PATCH(
      "/odata/v4/dpp/ProductVariants('var-tshirt-blue-m')",
      {
        color: 'Blue',
        size: 'M',
        sku: 'TSHIRT-BLUE-M',
        weight_g: 180,
        image_url: 'https://example.com/tshirt-blue.jpg',
        status: 'active'
      },
      alice
    );
    expect(res.status).toBe(200);
    expect(res.data.image_url).toBe('https://example.com/tshirt-blue.jpg');
  });
});
