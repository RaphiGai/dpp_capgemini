'use strict';

const cds = require('@sap/cds');
const { GET, POST, DELETE, expect } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } }; // usr-alice, ORG-A (org-greenline)
const dan   = { auth: { username: 'dan.advanced.b', password: 'x' } }; // ORG-B (org-fashionista)

const expectStatus = async (promise, status) => {
  try {
    await promise;
    throw new Error(`Expected status ${status}, but request succeeded.`);
  } catch (err) {
    expect(err.response?.status || err.status || err.code).toBe(status);
  }
};

describe('DPP marketing links', () => {
  test('CREATE org-wide link (no dpp) defaults org + stamps audit fields', async () => {
    const r = await POST(
      '/odata/v4/dpp/DPPMarketingLinks',
      { ID: 'ml-test-org', link_type: 'promotion', title: 'Test campaign', display_order: 5 },
      alice
    );
    expect(r.data.owning_organization_ID).toBe('org-greenline');
    expect(r.data.dpp_ID).toBeNull();
    expect(r.data.createdBy_ID).toBe('usr-alice');
    expect(r.data.createdAt).toBeTruthy();
  });

  test('CREATE DPP-specific link is accepted for an own DPP', async () => {
    const r = await POST(
      '/odata/v4/dpp/DPPMarketingLinks',
      { ID: 'ml-test-specific', dpp_ID: 'dpp-12345', link_type: 'care_product', title: 'Care kit' },
      alice
    );
    expect(r.data.dpp_ID).toBe('dpp-12345');
    expect(r.data.owning_organization_ID).toBe('org-greenline');
  });

  test('a title is required', async () => {
    await expectStatus(
      POST('/odata/v4/dpp/DPPMarketingLinks', { ID: 'ml-test-notitle', link_type: 'other' }, alice),
      400
    );
  });

  // Seed qr_tokens are placeholders; mint a verifiable token (the seed DPPs are
  // already published+public, regenerateQRToken keeps that and always mints fresh).
  const freshToken = async (dppId) => {
    const r = await POST(`/odata/v4/dpp/DPPs('${dppId}')/DPPService.regenerateQRToken`, {}, alice);
    return r.data.qr_token;
  };

  test('public view exposes org-wide + DPP-specific links, sorted and validity-filtered', async () => {
    // item DPP: gets the org-wide summer promo AND its item-specific care link
    const tokenItem = await freshToken('dpp-item-tshirt-0001');
    const { data: itemView } = await GET(`/public/dpp/${tokenItem}`);
    expect(Array.isArray(itemView.marketing)).toBe(true);
    const itemTitles = itemView.marketing.map((m) => m.title);
    expect(itemTitles).toContain('Sommerrabatt: -20% auf die neue Kollektion');
    expect(itemTitles).toContain('Empfohlenes Pflegemittel für dieses Shirt');
    // sorted ascending by display_order
    const orders = itemView.marketing.map((m) => m.display_order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));

    // a different published DPP of the same org: org-wide promo yes, the item-specific link no
    const tokenProd = await freshToken('dpp-12345');
    const { data: prodView } = await GET(`/public/dpp/${tokenProd}`);
    const prodTitles = prodView.marketing.map((m) => m.title);
    expect(prodTitles).toContain('Sommerrabatt: -20% auf die neue Kollektion');
    expect(prodTitles).not.toContain('Empfohlenes Pflegemittel für dieses Shirt');
  });

  test('inactive links never reach the public view', async () => {
    await POST(
      '/odata/v4/dpp/DPPMarketingLinks',
      { ID: 'ml-test-inactive', link_type: 'advertisement', title: 'Hidden ad', is_active: false },
      alice
    );
    const tokenProd = await freshToken('dpp-12345');
    const { data } = await GET(`/public/dpp/${tokenProd}`);
    expect(data.marketing.map((m) => m.title)).not.toContain('Hidden ad');
  });

  test('tenant isolation: another org cannot see or attach to ORG-A links', async () => {
    const { data } = await GET('/odata/v4/dpp/DPPMarketingLinks?$select=ID', dan);
    expect(data.value.every((m) => m.ID !== 'ml-summer-2026')).toBe(true);

    await expectStatus(
      POST(
        '/odata/v4/dpp/DPPMarketingLinks',
        { ID: 'ml-evil', dpp_ID: 'dpp-12345', link_type: 'promotion', title: 'X' },
        dan
      ),
      403
    );

    // ...nor delete an ORG-A link (the READ filter does not cover DELETE).
    await expectStatus(DELETE("/odata/v4/dpp/DPPMarketingLinks('ml-summer-2026')", dan), 403);
  });
});
