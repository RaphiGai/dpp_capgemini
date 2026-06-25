'use strict';

// Archive / unarchive lifecycle: archiving freezes a passport (no edits, no
// re-approve/publish/QR-regeneration) while keeping it consumer-visible; a
// company_advanced user can unarchive it back into the active lifecycle. Public
// consumer visibility of archived DPPs is covered in qr-access.test.js.

const cds = require('@sap/cds');

const { GET, POST, PATCH } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } }; // ORG-A advanced
const DPP = 'dpp-item-tshirt-0001'; // ORG-A, published + public item DPP

const expectStatus = async (promise, status) => {
  try {
    await promise;
    throw new Error(`Expected status ${status}, but the request succeeded.`);
  } catch (err) {
    expect(err.response?.status || err.status || err.code).toBe(status);
  }
};

const action = (name, body = {}) =>
  POST(`/odata/v4/dpp/DPPs('${DPP}')/DPPService.${name}`, body, alice);
const readDpp = () => GET(`/odata/v4/dpp/DPPs('${DPP}')`, alice);

describe('DPP archive / unarchive lifecycle', () => {
  test('archiving sets status + archived_at but keeps the record', async () => {
    const r = await action('archiveDPP');
    expect(r.data.status).toBe('archived');
    expect(r.data.archived_at).toBeTruthy();
  });

  test('an archived DPP cannot be edited, published, approved or QR-regenerated', async () => {
    await action('archiveDPP');
    await expectStatus(PATCH(`/odata/v4/dpp/DPPs('${DPP}')`, { visibility: 'internal' }, alice), 400);
    await expectStatus(action('publishDPP', { change_reason: 'x' }), 400);
    await expectStatus(action('approveDPP'), 400);
    await expectStatus(action('regenerateQRToken'), 400);
  });

  test('unarchiving a previously-published DPP restores it to published', async () => {
    await action('archiveDPP');
    const r = await action('unarchiveDPP');
    expect(r.data.status).toBe('published');
    expect(r.data.archived_at).toBeNull();

    // Editing works again once it is back in the active lifecycle.
    const patched = await PATCH(`/odata/v4/dpp/DPPs('${DPP}')`, { visibility: 'public' }, alice);
    expect(patched.status).toBe(200);
  });

  test('unarchiving is idempotent — a non-archived DPP is returned unchanged', async () => {
    await action('unarchiveDPP'); // ensure active
    const r = await action('unarchiveDPP');
    expect(r.data.status).toBe('published');
    const { data } = await readDpp();
    expect(data.status).toBe('published');
  });
});
