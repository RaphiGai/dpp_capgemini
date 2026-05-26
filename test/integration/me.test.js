'use strict';

const cds = require('@sap/cds');
const { GET, expect } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } };
const carol = { auth: { username: 'carol.user',     password: 'x' } };
const dan   = { auth: { username: 'dan.advanced.b', password: 'x' } };
const ghost = { auth: { username: 'ghost.unknown',  password: 'x' } };

const expect403 = async (promise) => {
  try {
    await promise;
    throw new Error('Expected 403');
  } catch (err) {
    expect(err.response?.status || err.status).toBe(403);
  }
};

describe('GET /odata/v4/dpp/me()', () => {
  test('returns identity, role and org for company_advanced user', async () => {
    const { data } = await GET('/odata/v4/dpp/me()', alice);
    expect(data).toMatchObject({
      id:             'alice.advanced',
      displayName:    'Alice Advanced',
      email:          'alice.advanced@greenline.example',
      role:           'company_advanced',
      organizationId: 'org-greenline',
      tenantId:       'ORG-A'
    });
  });

  test('returns company_user role for reader account', async () => {
    const { data } = await GET('/odata/v4/dpp/me()', carol);
    expect(data.role).toBe('company_user');
    expect(data.organizationId).toBe('org-greenline');
  });

  test('returns correct org for ORG-B user', async () => {
    const { data } = await GET('/odata/v4/dpp/me()', dan);
    expect(data.organizationId).toBe('org-fashionista');
    expect(data.tenantId).toBe('ORG-B');
  });

  test('rejects user without a Users row with 403', async () => {
    await expect403(GET('/odata/v4/dpp/me()', ghost));
  });
});
