'use strict';

const cds = require('@sap/cds');
const { GET, POST, expect } = cds.test().in(__dirname + '/../..');

const aliceAdvanced  = { auth: { username: 'alice.advanced',  password: 'x' } };
const carolUser      = { auth: { username: 'carol.user',      password: 'x' } };
const danAdvancedB   = { auth: { username: 'dan.advanced.b',  password: 'x' } };
const eveEndUser     = { auth: { username: 'eve.enduser',     password: 'x' } };

describe('Tenant isolation & role gates (DPPService)', () => {
  test('company_advanced (ORG-A) sees only Greenline products', async () => {
    const { data } = await GET(
      '/odata/v4/dpp/Products?$select=ID,owning_organization_ID',
      aliceAdvanced
    );
    expect(data.value.every((p) => p.owning_organization_ID === 'org-greenline')).toBe(true);
    expect(data.value.length).toBeGreaterThan(0);
  });

  test('company_advanced (ORG-B) sees only Fashionista products', async () => {
    const { data } = await GET(
      '/odata/v4/dpp/Products?$select=ID,owning_organization_ID',
      danAdvancedB
    );
    expect(data.value.every((p) => p.owning_organization_ID === 'org-fashionista')).toBe(true);
  });

  test('dan.advanced.b cannot publish an ORG-A DPP', async () => {
    await expect(
      POST(`/odata/v4/dpp/DPPs('dpp-12345')/DPPService.publishDPP`, {}, danAdvancedB)
    ).rejects.toThrow(/403/);
  });

  test('company_user is read-only on Products (no POST/PATCH/DELETE)', async () => {
    // GET succeeds
    const { data } = await GET(
      '/odata/v4/dpp/Products?$select=ID,owning_organization_ID',
      carolUser
    );
    expect(data.value.length).toBeGreaterThan(0);
    // POST should be forbidden
    await expect(
      POST('/odata/v4/dpp/Products', {
        ID: 'prod-test',
        name: 'Should not be created',
        product_type: 'finished'
      }, carolUser)
    ).rejects.toThrow(/403/);
  });
});

describe('End-user (Authority) cross-tenant read', () => {
  test('eve.enduser sees DPPs across all tenants on AuthorityService', async () => {
    const { data } = await GET(
      '/odata/v4/authority/DPPs?$select=ID,product_ID',
      eveEndUser
    );
    expect(data.value.length).toBeGreaterThan(0);
  });

  test('eve.enduser is forbidden on DPPService (lacks company_* role)', async () => {
    await expect(GET('/odata/v4/dpp/DPPs', eveEndUser)).rejects.toThrow(/403/);
  });
});
