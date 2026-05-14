'use strict';

jest.mock('../../srv/lib/blockchain', () => require('../helpers/mock-blockchain'));

const cds = require('@sap/cds');
const mockChain = require('../helpers/mock-blockchain');
const outbox = require('../../srv/lib/outbox');

const { GET, POST, PATCH, expect } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.admin', password: 'x' } };

describe('publish → outbox → anchor flow', () => {
  beforeEach(() => {
    mockChain.reset();
  });

  test('publishDPP enqueues a pending anchor; worker anchors it', async () => {
    // make dpp-003 public so it survives the consumer-filter later
    await PATCH(`/odata/v4/dpp/DPPs('dpp-003')`, { visibility: 'public' }, alice);
    await POST(`/odata/v4/dpp/DPPs('dpp-003')/DPPService.publishDPP`, {}, alice);

    const { data: pending } = await GET(
      `/odata/v4/dpp/BlockchainAnchors?$filter=dpp_ID eq 'dpp-003'&$select=status,version,data_hash`,
      alice
    );
    expect(pending.value.length).toBeGreaterThan(0);
    expect(pending.value[0].status).toBe('pending');

    const result = await outbox.processPendingAnchors();
    expect(result.anchored).toBeGreaterThan(0);

    const { data: after } = await GET(
      `/odata/v4/dpp/BlockchainAnchors?$filter=dpp_ID eq 'dpp-003'&$select=status,tx_hash,attempts`,
      alice
    );
    expect(after.value[0].status).toBe('anchored');
    expect(after.value[0].tx_hash).toMatch(/^0x[a-f0-9]+$/);
    expect(after.value[0].attempts).toBe(1);
  });

  // TODO: this exercises retry/backoff state but is sensitive to shared DB
  // state between tests. Re-enable once we add per-test DB isolation.
  test.skip('worker retries on transient failure and eventually succeeds', async () => {
    mockChain.failNext(1);
    await POST(`/odata/v4/dpp/DPPs('dpp-003')/DPPService.anchorOnBlockchain`, {}, alice);

    // first run: fails (and schedules a backoff)
    let r = await outbox.processPendingAnchors();
    expect(r.failed).toBe(0);

    // simulate backoff window elapsed
    const db = await cds.connect.to('db');
    const { BlockchainAnchors } = db.entities('dpp');
    await UPDATE(BlockchainAnchors).set({ next_attempt_at: null }).where({ status: 'pending' });

    // second run: succeeds (mock now returns a tx)
    r = await outbox.processPendingAnchors();
    expect(r.anchored).toBeGreaterThan(0);

    const { data } = await GET(
      `/odata/v4/dpp/BlockchainAnchors?$filter=dpp_ID eq 'dpp-003' and status eq 'anchored'&$select=tx_hash,attempts`,
      alice
    );
    const newest = data.value[data.value.length - 1];
    expect(newest.attempts).toBe(2);
    expect(newest.tx_hash).toMatch(/^0x[a-f0-9]+$/);
  });
});
