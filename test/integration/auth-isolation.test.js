'use strict';

const cds = require('@sap/cds');
const { GET, POST, PATCH, expect } = cds.test().in(__dirname + '/../..');

const alice  = { auth: { username: 'alice.advanced',  password: 'x' } }; // company_advanced, ORG-A
const carol  = { auth: { username: 'carol.user',      password: 'x' } }; // company_user, ORG-A
const dan    = { auth: { username: 'dan.advanced.b',  password: 'x' } }; // company_advanced, ORG-B
const ghost  = { auth: { username: 'ghost.unknown',   password: 'x' } }; // no Users row

const expectStatus = async (promise, status) => {
  try {
    await promise;
    throw new Error(`Expected status ${status}, but request succeeded.`);
  } catch (err) {
    expect(err.response?.status || err.status || err.code).toBe(status);
  }
};

describe('Tenant isolation — read filtering', () => {
  test('alice sees only ORG-A products', async () => {
    const { data } = await GET('/odata/v4/dpp/Products?$select=ID,owning_organization_ID', alice);
    expect(data.value.length).toBeGreaterThan(0);
    expect(data.value.every((p) => p.owning_organization_ID === 'org-greenline')).toBe(true);
  });

  test('dan sees only ORG-B products', async () => {
    const { data } = await GET('/odata/v4/dpp/Products?$select=ID,owning_organization_ID', dan);
    expect(data.value.length).toBeGreaterThan(0);
    expect(data.value.every((p) => p.owning_organization_ID === 'org-fashionista')).toBe(true);
  });

  test('dan reading an ORG-A product by ID gets 404 (silent filter)', async () => {
    await expectStatus(GET("/odata/v4/dpp/Products('prod-tshirt-classic')", dan), 404);
  });
});

describe('Role gating — company_user is read-only', () => {
  test('carol can read products', async () => {
    const { data } = await GET('/odata/v4/dpp/Products', carol);
    expect(Array.isArray(data.value)).toBe(true);
  });

  test('carol cannot CREATE a product (403)', async () => {
    await expectStatus(
      POST('/odata/v4/dpp/Products', { ID: 'prod-test-carol', name: 'Test' }, carol),
      403
    );
  });

  test('carol cannot UPDATE a product (403)', async () => {
    await expectStatus(
      PATCH("/odata/v4/dpp/Products('prod-tshirt-classic')", { name: 'Renamed' }, carol),
      403
    );
  });
});

describe('Unknown / inactive user — hard 403', () => {
  test('ghost.unknown (no Users row) is rejected on any OData call', async () => {
    await expectStatus(GET('/odata/v4/dpp/Products', ghost), 403);
  });
});

describe('Cross-tenant write attempts are blocked', () => {
  test('alice (ORG-A advanced) cannot create a user in ORG-B', async () => {
    await expectStatus(
      POST(
        '/odata/v4/dpp/Users',
        { ID: 'usr-malicious', email: 'attacker@x.example', organization_ID: 'org-fashionista', role: 'company_user' },
        alice
      ),
      403
    );
  });

  test('alice cannot approve dan\'s DPP (cross-tenant action)', async () => {
    await POST(
      "/odata/v4/dpp/DPPs",
      { ID: 'dpp-orgb-test', product_ID: 'prod-tee-fashionista' },
      dan
    ).catch(() => {});

    await expectStatus(
      POST("/odata/v4/dpp/DPPs('dpp-orgb-test')/DPPService.approveDPP", {}, alice),
      403
    );
  });

  test('alice cannot assign owning_organization_ID to a foreign org on CREATE', async () => {
    await expectStatus(
      POST(
        '/odata/v4/dpp/Products',
        { ID: 'prod-cross-tenant', name: 'X', owning_organization_ID: 'org-fashionista' },
        alice
      ),
      403
    );
  });
});
