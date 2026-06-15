'use strict';

// DPP version history (US5.9): each publish persists an immutable DPPVersions row
// (frozen snapshot + change_reason + sha256 content_hash); the entity is read-only
// over OData and tenant-isolated.

const cds = require('@sap/cds');

const { GET, POST, PATCH, DELETE, axios } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } }; // ORG-A advanced
const dan = { auth: { username: 'dan.advanced.b', password: 'x' } };    // ORG-B advanced

const DPP = 'dpp-item-tshirt-0001'; // ORG-A, published+public item DPP

const expectStatus = async (promise, status) => {
  try {
    await promise;
    throw new Error(`Expected status ${status}, but the request succeeded.`);
  } catch (err) {
    expect(err.response?.status || err.status || err.code).toBe(status);
  }
};

const publish = (reason) =>
  POST(`/odata/v4/dpp/DPPs('${DPP}')/DPPService.publishDPP`, { change_reason: reason }, alice);

const versionsOf = (cfg = alice) =>
  GET(`/odata/v4/dpp/DPPVersions?$filter=dpp_ID eq '${DPP}'&$orderby=version_number desc`, cfg);

describe('DPP version history', () => {
  test('publishing persists a version row with reason, author and content hash', async () => {
    const r = await publish('Initial test release');
    const version = r.data.current_version;

    const { data } = await versionsOf();
    const row = data.value.find((v) => v.version_number === version);
    expect(row).toBeTruthy();
    expect(row.change_reason).toBe('Initial test release');
    expect(row.changed_by_ID).toBe('usr-alice');
    expect(row.content_hash).toMatch(/^[a-f0-9]{64}$/);

    const snap = JSON.parse(row.snapshot_data);
    expect(snap.dpp.id).toBe(DPP);
    expect(snap.dpp.version).toBe(version);
  });

  test('re-publishing appends a new version with an incremented number', async () => {
    const first = (await publish('Change A')).data.current_version;
    const second = (await publish('Change B')).data.current_version;
    expect(second).toBe(first + 1);

    const { data } = await versionsOf();
    const numbers = data.value.map((v) => v.version_number);
    expect(numbers).toContain(first);
    expect(numbers).toContain(second);
    expect(data.value.find((v) => v.version_number === second).change_reason).toBe('Change B');
  });

  test('DPPVersions is read-only over OData (CREATE/UPDATE/DELETE rejected)', async () => {
    // Ensure at least one row exists, then grab its key.
    await publish('row for read-only test');
    const { data } = await versionsOf();
    const id = data.value[0].ID;

    await expectStatus(
      POST('/odata/v4/dpp/DPPVersions', { ID: 'ver-evil', dpp_ID: DPP, version_number: 99 }, alice),
      403
    );
    await expectStatus(PATCH(`/odata/v4/dpp/DPPVersions('${id}')`, { change_reason: 'tampered' }, alice), 403);
    await expectStatus(DELETE(`/odata/v4/dpp/DPPVersions('${id}')`, alice), 403);
  });

  test('another organization cannot see ORG-A version history', async () => {
    await publish('org-a only');
    const r = await axios.get(`/odata/v4/dpp/DPPVersions?$filter=dpp_ID eq '${DPP}'`, {
      ...dan,
      validateStatus: () => true
    });
    expect(r.status).toBe(200);
    expect((r.data.value ?? []).every((v) => v.dpp_ID !== DPP)).toBe(true);
  });
});
