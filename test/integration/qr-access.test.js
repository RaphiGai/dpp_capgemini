'use strict';

// Public QR/DPP access guarantees (US6.6, US6.8, US6.9, US6.10, US6.11, US6.12, US6.14).
// Seed tokens were signed with a different secret than the test environment, so each
// test mints a fresh, validly-signed token and attaches it to the target DPP first
// (same approach as seed-display.test.js).

const cds = require('@sap/cds');
const tokens = require('../../srv/lib/token');

const { POST, axios } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } };

async function attachToken(dppId) {
  const { DPPs } = cds.entities('dpp');
  const token = tokens.generate();
  await UPDATE(DPPs).set({ qr_token: token }).where({ ID: dppId });
  return token;
}

// Never throw on non-2xx — assert on the status code directly.
const getPublic = (token) => axios.get(`/public/dpp/${token}`, { validateStatus: () => true });

describe('US6.6 — QR token authenticity', () => {
  test('a malformed token is rejected (404)', async () => {
    expect((await getPublic('not-a-real-token')).status).toBe(404);
  });

  test('a tampered signature is rejected (404)', async () => {
    const valid = tokens.generate();
    const tampered = valid.slice(0, -1) + (valid.endsWith('A') ? 'B' : 'A');
    expect((await getPublic(tampered)).status).toBe(404);
  });

  test('a correctly-signed but unknown token is rejected (404)', async () => {
    // Valid HMAC signature, but no DPP carries this token.
    expect((await getPublic(tokens.generate())).status).toBe(404);
  });
});

describe('US6.12 — published + public and archived + public DPPs are accessible', () => {
  test('a valid token on a draft/internal DPP returns 404', async () => {
    const token = await attachToken('dpp-item-tshirt-0002'); // seeded draft + internal
    expect((await getPublic(token)).status).toBe(404);
  });

  test('an archived but public DPP stays consumer-visible (200)', async () => {
    // Archiving freezes the passport but keeps it reachable: labels already in
    // circulation must keep resolving. box-0001 is seeded published + public.
    const { DPPs } = cds.entities('dpp');
    const token = await attachToken('dpp-item-box-0001');
    await UPDATE(DPPs).set({ status: 'archived' }).where({ ID: 'dpp-item-box-0001' });
    const { status, data } = await getPublic(token);
    expect(status).toBe(200);
    expect(data.identification.dpp_id).toBe('dpp-item-box-0001');
  });

  test('an archived + internal DPP is still gated by visibility (404)', async () => {
    const { DPPs } = cds.entities('dpp');
    const token = await attachToken('dpp-item-jacket-0001'); // seeded published + public
    await UPDATE(DPPs)
      .set({ status: 'archived', visibility: 'internal' })
      .where({ ID: 'dpp-item-jacket-0001' });
    expect((await getPublic(token)).status).toBe(404);
    // Restore so the later US6.14 test (which reuses jacket-0001) still passes.
    await UPDATE(DPPs)
      .set({ status: 'published', visibility: 'public' })
      .where({ ID: 'dpp-item-jacket-0001' });
  });
});

describe('US6.11 — identification & traceability on the consumer DTO', () => {
  test('a published item DPP exposes product/batch/serial/UPI/DPP identifiers', async () => {
    // The identification batch number follows the batch's field-visibility setting
    // (default 'internal'); make it public so this traceability check sees it.
    const { Batches } = cds.entities('dpp');
    await UPDATE(Batches)
      .set({ field_visibility: JSON.stringify({ batch_number: 'public' }) })
      .where({ ID: 'batch-2026-05-A' });

    const token = await attachToken('dpp-item-tshirt-0001'); // published + public, serialized
    const { status, data } = await getPublic(token);
    expect(status).toBe(200);
    expect(data.identification).toMatchObject({
      dpp_id: 'dpp-item-tshirt-0001',
      product_id: 'prod-tshirt-classic',
      batch_number: '2026-05-A',
      serial_number: 'SN-TSH-0001',
      upi: 'UPI-TSH-0001'
    });
  });
});

describe('US6.8 / US6.9 / US6.10 — persistent token, latest version, direct link', () => {
  test('re-publishing keeps the token, bumps the version, link opens the latest', async () => {
    const token = await attachToken('dpp-item-tshirt-0001'); // already published + public

    const p1 = await POST(
      `/odata/v4/dpp/DPPs('dpp-item-tshirt-0001')/DPPService.publishDPP`,
      { change_reason: 'r1' },
      alice
    );
    const v1 = p1.data.current_version;
    expect(p1.data.qr_token).toBe(token); // token persists across versions (US6.8)
    expect(p1.data.public_url).toMatch(/\/public\/dpp\//); // functional direct link (US6.10)

    const p2 = await POST(
      `/odata/v4/dpp/DPPs('dpp-item-tshirt-0001')/DPPService.publishDPP`,
      { change_reason: 'r2' },
      alice
    );
    expect(p2.data.qr_token).toBe(token);
    expect(p2.data.current_version).toBe(v1 + 1); // version advances (US6.9)

    const { status, data } = await getPublic(token);
    expect(status).toBe(200);
    expect(data.version).toBe(v1 + 1); // the same token opens the latest version
  });
});

describe('US6.14 — regenerating a QR invalidates the old label, keeps the same DPP', () => {
  test('old token stops working; new token opens the same item DPP', async () => {
    const oldToken = await attachToken('dpp-item-jacket-0001'); // published + public item DPP
    expect((await getPublic(oldToken)).status).toBe(200);

    const r = await POST(
      `/odata/v4/dpp/DPPs('dpp-item-jacket-0001')/DPPService.regenerateQRToken`,
      {},
      alice
    );
    const newToken = r.data.qr_token;
    expect(newToken).not.toBe(oldToken);
    expect(r.data.public_url).toMatch(/\/public\/dpp\//);

    expect((await getPublic(oldToken)).status).toBe(404); // damaged/old label is dead
    const opened = await getPublic(newToken);
    expect(opened.status).toBe(200);
    // Still the same Product Item DPP behind the new token.
    expect(opened.data.identification.dpp_id).toBe('dpp-item-jacket-0001');
    expect(opened.data.identification.serial_number).toBe('SN-JKT-0001');
  });
});
