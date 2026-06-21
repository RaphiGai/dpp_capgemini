'use strict';

const cds = require('@sap/cds');
const { POST, GET, expect } = cds.test().in(__dirname + '/../..');

const aliceAdmin = { auth: { username: 'alice.advanced', password: 'x' } };

describe('QR Code lifecycle (regenerate + history)', () => {
  test('regenerateQRToken mints a new QR and marks previous as replaced', async () => {
    // 1st regenerate — structured, signed token (dpp~…~<nonce>.<sig>); see srv/lib/token.js
    const r1 = await POST('/odata/v4/dpp/DPPs(\'dpp-12345\')/DPPService.regenerateQRToken', {}, aliceAdmin);
    expect(r1.data.qr_token).toMatch(/^dpp~.+\..+/);

    // 2nd regenerate
    const r2 = await POST('/odata/v4/dpp/DPPs(\'dpp-12345\')/DPPService.regenerateQRToken', {}, aliceAdmin);
    expect(r2.data.qr_token).not.toBe(r1.data.qr_token);

    // History: one active + at least one replaced
    const { data } = await GET(
      '/odata/v4/dpp/QRCodes?$filter=dpp_ID eq \'dpp-12345\'&$select=ID,status,qr_value',
      aliceAdmin
    );
    const active = data.value.filter((q) => q.status === 'active');
    const replaced = data.value.filter((q) => q.status === 'replaced');
    expect(active).toHaveLength(1);
    expect(replaced.length).toBeGreaterThanOrEqual(1);
    expect(active[0].qr_value).toBe(r2.data.qr_payload_url);
  });
});
