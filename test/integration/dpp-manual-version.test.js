'use strict';

// Manual DPP versions (createDPPVersion): a company_advanced user snapshots the
// full current DPP state on demand. Each manual version advances current_version
// and shares the per-DPP version sequence with publishDPP (no collisions). The
// snapshot is comprehensive (product/variant/batch/item/bom + storytelling,
// marketing links, documents, aggregated footprint).

const cds = require('@sap/cds');

const { GET, POST } = cds.test().in(__dirname + '/../..');

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

const createVersion = (reason, dpp = DPP, cfg = alice) =>
  POST(`/odata/v4/dpp/DPPs('${dpp}')/DPPService.createDPPVersion`, { change_reason: reason }, cfg);
const publish = (reason) =>
  POST(`/odata/v4/dpp/DPPs('${DPP}')/DPPService.publishDPP`, { change_reason: reason }, alice);
const readDpp = (dpp = DPP) => GET(`/odata/v4/dpp/DPPs('${dpp}')`, alice);
const versionsOf = (dpp = DPP) =>
  GET(`/odata/v4/dpp/DPPVersions?$filter=dpp_ID eq '${dpp}'&$orderby=version_number desc`, alice);

describe('Manual DPP versions (createDPPVersion)', () => {
  test('records a version row, advances current_version and hashes the snapshot', async () => {
    const before = (await readDpp()).data.current_version;
    const r = await createVersion('Manual checkpoint');
    const after = r.data.current_version;
    expect(after).toBe(before + 1);

    const { data } = await versionsOf();
    const row = data.value.find((v) => v.version_number === after);
    expect(row).toBeTruthy();
    expect(row.change_reason).toBe('Manual checkpoint');
    expect(row.changed_by_ID).toBe('usr-alice');
    expect(row.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('the snapshot is comprehensive (all info on the DPP)', async () => {
    const r = await createVersion('Comprehensive snapshot');
    const version = r.data.current_version;
    const { data } = await versionsOf();
    const row = data.value.find((v) => v.version_number === version);
    const snap = JSON.parse(row.snapshot_data);

    expect(snap.dpp.id).toBe(DPP);
    expect(snap.dpp.version).toBe(version);
    expect(snap.product).toBeTruthy();
    // Comprehensive extensions beyond product/variant/batch/item/bom:
    expect(snap).toHaveProperty('storytelling');
    expect(Array.isArray(snap.marketing_links)).toBe(true);
    expect(Array.isArray(snap.documents)).toBe(true);
    expect(snap.aggregated).toBeTruthy();
    expect(snap.aggregated).toHaveProperty('co2_footprint_kg');
    expect(snap.aggregated.breakdown).toHaveProperty('components');
  });

  test('consecutive manual versions get sequential, unique numbers', async () => {
    const a = (await createVersion('seq A')).data.current_version;
    const b = (await createVersion('seq B')).data.current_version;
    expect(b).toBe(a + 1);

    const numbers = (await versionsOf()).data.value.map((v) => v.version_number);
    expect(new Set(numbers).size).toBe(numbers.length); // all unique
  });

  test('publishing after manual versions continues the same sequence (no collision)', async () => {
    const manual = (await createVersion('before publish')).data.current_version;
    const published = (await publish('publish after manual')).data.current_version;
    expect(published).toBe(manual + 1);

    const numbers = (await versionsOf()).data.value.map((v) => v.version_number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toContain(published);
  });

  test('an archived DPP cannot be versioned (400)', async () => {
    const BOX = 'dpp-item-box-0001'; // ORG-A, published + public
    await POST(`/odata/v4/dpp/DPPs('${BOX}')/DPPService.archiveDPP`, {}, alice);
    await expectStatus(createVersion('nope', BOX), 400);
  });
});
