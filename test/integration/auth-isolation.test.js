'use strict';

const cds = require('@sap/cds');
const { GET, POST, PATCH, expect } = cds.test().in(__dirname + '/../..');

// Mocked-auth headers for the canonical dev users from .cdsrc.json.
const aliceAdmin   = { auth: { username: 'alice.admin',   password: 'x' } };
const danEditorB   = { auth: { username: 'dan.editor.b',  password: 'x' } };
const eveAuthority = { auth: { username: 'eve.authority', password: 'x' } };

describe('Tenant isolation & role gates (DPPService)', () => {
  test('alice.admin (ORG-A) sees only Greenline DPPs', async () => {
    const { data } = await GET('/odata/v4/dpp/DPPs?$select=ID,issuing_organization_ID', aliceAdmin);
    expect(data.value.every((d) => d.issuing_organization_ID === 'org-greenline')).toBe(true);
    expect(data.value.length).toBeGreaterThan(0);
  });

  test('dan.editor.b (ORG-B) sees only Fashionista DPPs', async () => {
    const { data } = await GET('/odata/v4/dpp/DPPs?$select=ID,issuing_organization_ID', danEditorB);
    expect(data.value.every((d) => d.issuing_organization_ID === 'org-fashionista')).toBe(true);
  });

  test('dan.editor.b cannot publish an ORG-A DPP', async () => {
    await expect(
      POST(`/odata/v4/dpp/DPPs('dpp-001')/DPPService.publishDPP`, {}, danEditorB)
    ).rejects.toThrow(/403/);
  });
});

describe('Authority cross-tenant read', () => {
  test('eve.authority sees DPPs from every organization', async () => {
    const { data } = await GET('/odata/v4/authority/DPPs?$select=ID,issuing_organization_ID', eveAuthority);
    const orgs = new Set(data.value.map((d) => d.issuing_organization_ID));
    expect(orgs.has('org-greenline')).toBe(true);
    expect(orgs.has('org-fashionista')).toBe(true);
  });

  test('eve.authority is forbidden on DPPService (no admin/editor/viewer scope)', async () => {
    await expect(GET('/odata/v4/dpp/DPPs', eveAuthority)).rejects.toThrow(/403/);
  });
});

describe('publishDPP lifecycle', () => {
  test('publishDPP transitions draft → published and mints a QR token', async () => {
    await PATCH(`/odata/v4/dpp/DPPs('dpp-003')`, { visibility: 'public' }, aliceAdmin);
    await POST(`/odata/v4/dpp/DPPs('dpp-003')/DPPService.publishDPP`, {}, aliceAdmin);
    const { data } = await GET(
      `/odata/v4/dpp/DPPs('dpp-003')?$select=status,qr_token,published_at`,
      aliceAdmin
    );
    expect(data.status).toBe('published');
    expect(data.qr_token).toMatch(/^[0-9a-f-]{36}\..+/);
    expect(data.published_at).toBeTruthy();
  });
});
