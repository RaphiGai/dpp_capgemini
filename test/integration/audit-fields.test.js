'use strict';

const cds = require('@sap/cds');
const { GET, POST, PATCH, expect } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } }; // usr-alice, ORG-A

describe('Audit fields — CreatedBy / ChangedBy / CreatedAt / LastChange', () => {
  test('CREATE stamps all four audit fields with the acting user', async () => {
    const r = await POST('/odata/v4/dpp/Products', { ID: 'prod-audit-1', name: 'Audit Test' }, alice);
    expect(r.data.createdBy_ID).toBe('usr-alice');
    expect(r.data.changedBy_ID).toBe('usr-alice');
    expect(r.data.createdAt).toBeTruthy();
    expect(r.data.lastChange).toBeTruthy();
  });

  test('client-supplied audit values are ignored (stamped server-side)', async () => {
    const r = await POST(
      '/odata/v4/dpp/Products',
      { ID: 'prod-audit-2', name: 'X', createdBy_ID: 'usr-dan', changedBy_ID: 'usr-dan' },
      alice
    );
    expect(r.data.createdBy_ID).toBe('usr-alice');
    expect(r.data.changedBy_ID).toBe('usr-alice');
  });

  test('UPDATE bumps lastChange + changedBy and preserves createdBy', async () => {
    const before = await GET("/odata/v4/dpp/Products('prod-audit-1')", alice);
    await PATCH("/odata/v4/dpp/Products('prod-audit-1')", { brand: 'NewBrand' }, alice);
    const after = await GET("/odata/v4/dpp/Products('prod-audit-1')", alice);

    expect(after.data.createdBy_ID).toBe('usr-alice');
    expect(after.data.changedBy_ID).toBe('usr-alice');
    expect(new Date(after.data.lastChange).getTime())
      .toBeGreaterThanOrEqual(new Date(before.data.lastChange).getTime());
  });

  test('auto-created item DPP also carries audit fields', async () => {
    await POST(
      '/odata/v4/dpp/ProductItems',
      { ID: 'pi-audit-1', batch_ID: 'batch-2026-05-A', serial_number: 'SN-AUDIT-1' },
      alice
    );
    const { data } = await GET(
      `/odata/v4/dpp/DPPs?$filter=item_ID eq 'pi-audit-1'&$select=ID,createdBy_ID,createdAt`,
      alice
    );
    expect(data.value).toHaveLength(1);
    expect(data.value[0].createdBy_ID).toBe('usr-alice');
    expect(data.value[0].createdAt).toBeTruthy();
  });
});
