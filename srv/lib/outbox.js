'use strict';

const cds = require('@sap/cds');
const blockchain = require('./blockchain');
const { hashDPPSnapshot } = require('./hash');

/**
 * Outbox / async anchor worker.
 *
 * Public surface:
 *   - enqueueAnchor({ dpp, children, document? }) — invoked from the publish
 *     handler. Synchronously inserts a `BlockchainAnchors` row with
 *     status='pending'. The actual on-chain transaction is deferred to
 *     processPendingAnchors() so request latency is not bound to block time.
 *   - processPendingAnchors() — walks all pending rows, attempts to anchor
 *     them, updates status on success/failure. Idempotent.
 *   - startWorker() — registers a periodic `cds.spawn`. Safe no-op when
 *     BLOCKCHAIN_ENABLED is false.
 */

function nowIso() {
  return new Date().toISOString();
}

async function computeSnapshotHash(_db, dpp) {
  const {
    MaterialComposition,
    ComplianceStatements,
    Documents,
    SubstancesOfConcern
  } = cds.entities('dpp');
  const [materials, compliance, documents, substances] = await Promise.all([
    SELECT.from(MaterialComposition).where({ dpp_ID: dpp.ID }),
    SELECT.from(ComplianceStatements).where({ dpp_ID: dpp.ID }),
    SELECT.from(Documents).where({ dpp_ID: dpp.ID }),
    SELECT.from(SubstancesOfConcern).where({ dpp_ID: dpp.ID })
  ]);
  return hashDPPSnapshot(dpp, { materials, compliance, documents, substances });
}

/**
 * Insert (or top-up) a pending anchor row for the given DPP. Used by the
 * publishDPP / anchorOnBlockchain actions. The current DB transaction is
 * reused so the anchor row is rolled back if the surrounding logic fails.
 */
async function enqueueAnchor({ dppId, dataHash, documentId = null }) {
  const { BlockchainAnchors, DPPs } = cds.entities('dpp');

  // Determine next version. Done in JS rather than SQL aggregate to keep the
  // query portable across SQLite and HANA without bumping into cqn4sql quirks.
  const existing = await SELECT.from(BlockchainAnchors)
    .columns('version')
    .where({ dpp_ID: dppId });
  const version = existing.reduce((m, r) => Math.max(m, r.version || 0), 0) + 1;

  const row = {
    ID: require('crypto').randomUUID(),
    dpp_ID: dppId,
    document_ID: documentId,
    data_hash: dataHash,
    network: process.env.BLOCKCHAIN_NETWORK || 'polygon-amoy',
    chain_id: Number(process.env.BLOCKCHAIN_CHAIN_ID || 80002),
    status: 'pending',
    attempts: 0,
    version
  };
  await INSERT.into(BlockchainAnchors).entries(row);

  // Persist the snapshot hash on the DPP for quick visibility.
  await UPDATE(DPPs).set({ data_hash: dataHash, data_hash_at: nowIso() }).where({ ID: dppId });

  return row;
}

async function processPendingAnchors() {
  if (!blockchain.isEnabled()) return { processed: 0, anchored: 0, failed: 0 };

  const client = blockchain.getClient();
  if (!client) return { processed: 0, anchored: 0, failed: 0 };

  await cds.connect.to('db');
  const { BlockchainAnchors } = cds.entities('dpp');
  const maxAttempts = Number(process.env.BLOCKCHAIN_RETRY_MAX || 5);
  const backoffMs = Number(process.env.BLOCKCHAIN_RETRY_BACKOFF_MS || 10000);

  const pending = await SELECT.from(BlockchainAnchors).where({ status: 'pending' });
  const result = { processed: pending.length, anchored: 0, failed: 0 };

  for (const row of pending) {
    if (row.next_attempt_at && new Date(row.next_attempt_at).getTime() > Date.now()) {
      continue;
    }
    try {
      const receipt = row.document_ID
        ? await client.addDocumentHash(row.dpp_ID, row.data_hash)
        : await client.anchorDPP(row.dpp_ID, row.data_hash);

      await UPDATE(BlockchainAnchors).set({
        status: 'anchored',
        tx_hash: receipt.txHash,
        block_number: receipt.blockNumber || null,
        contract_address: receipt.contractAddress,
        anchored_at: nowIso(),
        error_message: null,
        attempts: row.attempts + 1
      }).where({ ID: row.ID });
      result.anchored++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const failed = attempts >= maxAttempts;
      await UPDATE(BlockchainAnchors).set({
        status: failed ? 'failed' : 'pending',
        attempts,
        next_attempt_at: failed
          ? null
          : new Date(Date.now() + backoffMs * Math.pow(2, attempts - 1)).toISOString(),
        error_message: String(err.message || err).slice(0, 500)
      }).where({ ID: row.ID });
      if (failed) result.failed++;
    }
  }
  return result;
}

let workerHandle = null;

function startWorker() {
  if (workerHandle || !blockchain.isEnabled()) return;
  const intervalMs = Number(process.env.BLOCKCHAIN_WORKER_INTERVAL_MS || 30000);
  workerHandle = cds.spawn({ every: intervalMs }, async () => {
    try {
      await processPendingAnchors();
    } catch (err) {
      console.error('outbox worker tick failed:', err);
    }
  });
}

function stopWorker() {
  if (workerHandle && typeof workerHandle.cancel === 'function') workerHandle.cancel();
  workerHandle = null;
}

module.exports = {
  enqueueAnchor,
  processPendingAnchors,
  computeSnapshotHash,
  startWorker,
  stopWorker
};
