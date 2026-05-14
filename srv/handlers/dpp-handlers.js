'use strict';

const cds = require('@sap/cds');
const { getUserOrg } = require('./auth-helpers');
const tokens = require('../lib/token');
const outbox = require('../lib/outbox');

/**
 * Register handlers on DPPService.
 * Phase-2 scope: tenant defaults + status transitions + stub blockchain action.
 * The real anchor flow is wired in Phase 11 — for now `anchorOnBlockchain`
 * just records a 'pending' row so callers can observe the outbox lifecycle.
 */
module.exports = (srv) => {
  const { DPPs, Products, Documents, BlockchainAnchors } = srv.entities;

  // ----- Defaults on CREATE -----

  srv.before('CREATE', Products, async (req) => {
    if (!req.data.owning_organization_ID) {
      const org = await getUserOrg(req);
      req.data.owning_organization_ID = org.ID;
    }
  });

  srv.before('CREATE', DPPs, async (req) => {
    if (!req.data.issuing_organization_ID) {
      const org = await getUserOrg(req);
      req.data.issuing_organization_ID = org.ID;
    }
    if (!req.data.status) req.data.status = 'draft';
    if (!req.data.visibility) req.data.visibility = 'internal';
    if (!req.data.granularity_level) req.data.granularity_level = 'model';
  });

  // ----- Document upload: compute SHA-256 on the way in -----

  srv.before(['CREATE', 'UPDATE'], Documents, async (req) => {
    if (req.data.content instanceof Buffer) {
      const { sha256Hex } = require('../lib/hash');
      req.data.sha256 = sha256Hex(req.data.content);
      req.data.size_bytes = req.data.content.length;
    }
  });

  // ----- Action: publishDPP -----

  srv.on('publishDPP', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);

    if (dpp.status === 'archived') {
      req.reject(400, `DPP '${id}' is archived and cannot be published.`);
    }
    if (dpp.status === 'published') {
      // Idempotent — return current state without rewriting timestamps.
      return dpp;
    }

    const now = new Date().toISOString();
    const qrToken = tokens.generate();

    await UPDATE(DPPs).set({
      status: 'published',
      published_at: now,
      qr_token: qrToken,
      qr_payload_url: `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${qrToken}`
    }).where({ ID: id });

    // Compute snapshot hash and enqueue an anchor row — the worker picks it up.
    const fresh = await SELECT.one.from(DPPs).where({ ID: id });
    const dataHash = await outbox.computeSnapshotHash(null, fresh);
    await outbox.enqueueAnchor({ dppId: id, dataHash });

    return SELECT.one.from(DPPs).where({ ID: id });
  });

  // ----- Action: archiveDPP -----

  srv.on('archiveDPP', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);

    await UPDATE(DPPs)
      .set({ status: 'archived', archived_at: new Date().toISOString() })
      .where({ ID: id });

    return SELECT.one.from(DPPs).where({ ID: id });
  });

  // ----- Action: anchorOnBlockchain -----

  srv.on('anchorOnBlockchain', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);

    const dataHash = await outbox.computeSnapshotHash(null, dpp);
    const row = await outbox.enqueueAnchor({ dppId: id, dataHash });

    return SELECT.one.from(BlockchainAnchors).where({ ID: row.ID });
  });

  // ----- Function: generateQRCode -----

  srv.on('generateQRCode', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);
    if (!dpp.qr_token) req.reject(409, `DPP '${id}' has no QR token. Publish it first.`);

    const payload = dpp.qr_payload_url ||
      `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${dpp.qr_token}`;

    // Real PNG generation lives in Phase 7. For now we return only the payload
    // so the frontend already gets a stable shape.
    return { png: '', payload };
  });
};
