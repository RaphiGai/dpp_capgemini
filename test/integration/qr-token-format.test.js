'use strict';

// The QR token a passport carries should embed its product/variant/batch/item +
// creation date (readable business codes) and still resolve publicly.

const cds = require('@sap/cds');
const tokens = require('../../srv/lib/token');

const { POST, axios } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } };

describe('structured QR token end-to-end', () => {
  test('regenerateQRToken issues a structured token that decodes and resolves', async () => {
    // dpp-item-tshirt-0001: published+public item DPP (batch 2026-05-A, serial SN-TSH-0001).
    const r = await POST('/odata/v4/dpp/DPPs(\'dpp-item-tshirt-0001\')/DPPService.regenerateQRToken', {}, alice);
    const token = r.data.qr_token;

    expect(token.startsWith('dpp~')).toBe(true);
    expect(token).toContain('2026-05-A'); // batch number
    expect(token).toContain('SN-TSH-0001'); // serial

    const decoded = tokens.decode(token);
    expect(decoded).toMatchObject({ batch_number: '2026-05-A', serial: 'SN-TSH-0001' });
    expect(decoded.date).toMatch(/^\d{8}$/);

    // The structured token still resolves the public passport.
    const pub = await axios.get(`/public/dpp/${token}`, { validateStatus: () => true });
    expect(pub.status).toBe(200);
    expect(pub.data.identification.serial_number).toBe('SN-TSH-0001');
  });

  test('a legacy random token still resolves (backward compatibility)', async () => {
    const { DPPs } = cds.entities('dpp');
    const legacy = tokens.generate(); // no context → uuid.sig
    await UPDATE(DPPs).set({ qr_token: legacy }).where({ ID: 'dpp-item-jacket-0001' });
    const pub = await axios.get(`/public/dpp/${legacy}`, { validateStatus: () => true });
    expect(pub.status).toBe(200);
  });
});
