'use strict';

const cds = require('@sap/cds');
const { GET, POST, expect } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } }; // company_advanced, ORG-A (org-greenline)
const dan   = { auth: { username: 'dan.advanced.b', password: 'x' } }; // company_advanced, ORG-B (org-fashionista)

const expectStatus = async (promise, status) => {
  try {
    await promise;
    throw new Error(`Expected status ${status}, but request succeeded.`);
  } catch (err) {
    expect(err.response?.status || err.status || err.code).toBe(status);
  }
};

describe('ProductItems — serialized item-level DPP', () => {
  test('creating an item auto-creates exactly one unique item DPP with an active QR', async () => {
    await POST(
      '/odata/v4/dpp/ProductItems',
      { ID: 'pi-test-9001', batch_ID: 'batch-2026-05-A', serial_number: 'SN-TEST-9001' },
      alice
    );

    // Exactly one DPP, type 'item', resolving the full product/variant/batch chain.
    const { data: dpps } = await GET(
      `/odata/v4/dpp/DPPs?$filter=item_ID eq 'pi-test-9001'`
        + `&$select=ID,dpp_type,product_ID,variant_ID,batch_ID,item_ID,qr_token`,
      alice
    );
    expect(dpps.value).toHaveLength(1);
    const dpp = dpps.value[0];
    expect(dpp.dpp_type).toBe('item');
    expect(dpp.product_ID).toBe('prod-tshirt-classic');
    expect(dpp.variant_ID).toBe('var-tshirt-blue-m');
    expect(dpp.batch_ID).toBe('batch-2026-05-A');
    expect(dpp.qr_token).toBeTruthy();

    // The item navigates back to its DPP (1:1) and got an auto-minted UPI.
    const { data: item } = await GET(`/odata/v4/dpp/ProductItems('pi-test-9001')?$expand=dpp`, alice);
    expect(item.dpp.ID).toBe(dpp.ID);
    expect(item.upi).toMatch(/^UPI-/);

    // A scannable, active QR exists immediately.
    const { data: qrs } = await GET(
      `/odata/v4/dpp/QRCodes?$filter=dpp_ID eq '${dpp.ID}'&$select=status`,
      alice
    );
    expect(qrs.value.filter((q) => q.status === 'active')).toHaveLength(1);
  });

  test('a second DPP for the same item is rejected (unique DPP per item)', async () => {
    // The @assert.unique { item } constraint must block a second DPP on the same
    // item; SQLite surfaces this as a 5xx, OData/@assert as 4xx — either way the
    // write must NOT succeed.
    await expect(
      POST(
        '/odata/v4/dpp/DPPs',
        { ID: 'dpp-dup-item', product_ID: 'prod-tshirt-classic', item_ID: 'pi-test-9001' },
        alice
      )
    ).rejects.toThrow();
  });

  test('a client-supplied UPI is kept and must be globally unique', async () => {
    await POST(
      '/odata/v4/dpp/ProductItems',
      { ID: 'pi-test-9100', batch_ID: 'batch-2026-05-A', serial_number: 'SN-9100', upi: 'UPI-EXPLICIT-9100' },
      alice
    );
    const { data } = await GET("/odata/v4/dpp/ProductItems('pi-test-9100')?$select=upi", alice);
    expect(data.upi).toBe('UPI-EXPLICIT-9100');

    // reusing the same UPI on another item must be rejected
    await expect(
      POST(
        '/odata/v4/dpp/ProductItems',
        { ID: 'pi-test-9101', batch_ID: 'batch-2026-05-A', serial_number: 'SN-9101', upi: 'UPI-EXPLICIT-9100' },
        alice
      )
    ).rejects.toThrow();
  });

  test('a foreign tenant cannot create items on another org\'s batch', async () => {
    await expectStatus(
      POST(
        '/odata/v4/dpp/ProductItems',
        { ID: 'pi-test-evil', batch_ID: 'batch-2026-05-A', serial_number: 'SN-EVIL' },
        dan
      ),
      403
    );
  });

  test('tenant read filter hides another org\'s items', async () => {
    const { data } = await GET(`/odata/v4/dpp/ProductItems?$select=ID`, dan);
    expect(data.value.every((i) => i.ID !== 'pi-test-9001')).toBe(true);
  });
});
