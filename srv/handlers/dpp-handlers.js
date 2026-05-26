'use strict';

const cds = require('@sap/cds');
const { randomUUID } = require('crypto');
const tokens = require('../lib/token');
const { requireOwningOrg } = require('./auth-helpers');

const DPP_OWNER_PATH = 'product.owning_organization_ID';

/**
 * Mandatory-field check used by approveDPP/publishDPP. Returns an array of
 * human-readable error strings — empty means OK to proceed. Replaces the old
 * ValidationWarnings persistence: errors are reported inline via req.reject.
 */
async function checkDPPReady(dpp) {
  const { Products, ProductItems } = cds.entities('dpp');
  const errors = [];

  if (!dpp.product_ID) {
    errors.push('DPP must reference a product.');
  } else {
    const product = await SELECT.one.from(Products).where({ ID: dpp.product_ID });
    if (!product) {
      errors.push(`Referenced product '${dpp.product_ID}' does not exist.`);
    } else {
      for (const f of ['name', 'brand', 'category', 'fibre_composition']) {
        if (!product[f]) errors.push(`Product field '${f}' is required.`);
      }
    }
  }
  if (dpp.granularity === 'item' && !dpp.item_ID) {
    errors.push('Item-level DPP requires a linked ProductItem.');
  }
  if (dpp.item_ID) {
    const item = await SELECT.one.from(ProductItems).where({ ID: dpp.item_ID });
    if (!item) errors.push(`Referenced ProductItem '${dpp.item_ID}' does not exist.`);
    else if (!item.upi) errors.push('ProductItem must have a Unique Product Identity (UPI).');
  }
  return errors;
}

/**
 * Build a JSON snapshot of the full aggregated DPP — Product + Variant + Batch +
 * Item + BOM — for `DPPs.aggregated_snapshot` and the PDF renderer.
 */
async function buildSnapshot(dpp) {
  const { Products, ProductVariants, Batches, ProductItems, ProductBOMs } = cds.entities('dpp');

  const [product, item, bom] = await Promise.all([
    SELECT.one.from(Products).where({ ID: dpp.product_ID }),
    dpp.item_ID ? SELECT.one.from(ProductItems).where({ ID: dpp.item_ID }) : null,
    SELECT.from(ProductBOMs).where({ parent_ID: dpp.product_ID })
  ]);

  let variant = null;
  let batch = null;
  if (item) {
    batch = await SELECT.one.from(Batches).where({ ID: item.batch_ID });
    if (batch) variant = await SELECT.one.from(ProductVariants).where({ ID: batch.variant_ID });
  }

  return {
    captured_at: new Date().toISOString(),
    dpp: {
      id: dpp.ID,
      granularity: dpp.granularity,
      dpp_type: dpp.dpp_type,
      visibility: dpp.visibility,
      version: dpp.current_version
    },
    product,
    variant,
    batch,
    item,
    bom
  };
}

/**
 * Mark every currently-active QRCodes row for this DPP as replaced, then insert
 * a new active row. Keeps the most-recent QR uniquely `active`.
 */
async function rotateActiveQRCode(dppId, qrValue, qrImageUrl) {
  const { QRCodes } = cds.entities('dpp');
  const now = new Date().toISOString();
  await UPDATE(QRCodes)
    .set({ status: 'replaced', replaced_at: now })
    .where({ dpp_ID: dppId, status: 'active' });
  await INSERT.into(QRCodes).entries({
    ID: randomUUID(),
    dpp_ID: dppId,
    qr_value: qrValue,
    qr_image_url: qrImageUrl,
    status: 'active',
    created_at: now
  });
}

module.exports = (srv) => {
  const { DPPs } = srv.entities;

  // ----- Defaults on CREATE -----

  srv.before('CREATE', DPPs, async (req) => {
    if (req.data.product_ID) {
      await requireOwningOrg(req, 'Products', req.data.product_ID);
    }
    if (!req.data.status) req.data.status = 'draft';
    if (!req.data.visibility) req.data.visibility = 'internal';
    if (!req.data.granularity) req.data.granularity = req.data.item_ID ? 'item' : 'model';
    if (!req.data.dpp_type) req.data.dpp_type = 'product';
    if (!req.data.current_version) req.data.current_version = 1;
    req.data.last_updated = new Date().toISOString();
  });

  srv.before('UPDATE', DPPs, (req) => {
    req.data.last_updated = new Date().toISOString();
  });

  // ----- Link Item ↔ DPP after CREATE -----

  srv.after('CREATE', DPPs, async (dpp) => {
    if (dpp.item_ID) {
      await UPDATE(cds.entities('dpp').ProductItems)
        .set({ dpp_ID: dpp.ID })
        .where({ ID: dpp.item_ID });
    }
  });

  // ----- Action: approveDPP (draft → approved) -----

  srv.on('approveDPP', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);

    if (dpp.status === 'archived') req.reject(400, `DPP '${id}' is archived.`);
    if (dpp.status !== 'draft' && dpp.status !== 'in_review') return dpp;

    const errors = await checkDPPReady(dpp);
    if (errors.length) req.reject(400, `DPP cannot be approved: ${errors.join(' | ')}`);

    await UPDATE(DPPs)
      .set({ status: 'approved', approved_at: new Date().toISOString() })
      .where({ ID: id });

    return SELECT.one.from(DPPs).where({ ID: id });
  });

  // ----- Action: publishDPP (approved → published, snapshot + QR) -----

  srv.on('publishDPP', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);
    if (dpp.status === 'archived') req.reject(400, `DPP '${id}' is archived and cannot be published.`);

    const errors = await checkDPPReady(dpp);
    if (errors.length) req.reject(400, `DPP cannot be published: ${errors.join(' | ')}`);

    const now = new Date().toISOString();
    const previouslyPublished = dpp.status === 'published';
    const nextVersion = previouslyPublished ? dpp.current_version + 1 : dpp.current_version;
    const qrToken = dpp.qr_token || tokens.generate();
    const payloadUrl = `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${qrToken}`;
    const publicUrl = `${process.env.PUBLIC_BASE_URL || ''}/dpp/${id}`;

    await UPDATE(DPPs).set({
      status: 'published',
      published_at: now,
      qr_token: qrToken,
      qr_payload_url: payloadUrl,
      public_url: publicUrl,
      current_version: nextVersion,
      last_updated: now
    }).where({ ID: id });

    const draft = await SELECT.one.from(DPPs).where({ ID: id });
    const snapshot = await buildSnapshot(draft);
    await UPDATE(DPPs)
      .set({ aggregated_snapshot: JSON.stringify(snapshot) })
      .where({ ID: id });

    const qrImageUrl = `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${qrToken}/qr.png`;
    await rotateActiveQRCode(id, payloadUrl, qrImageUrl);

    return SELECT.one.from(DPPs).where({ ID: id });
  });

  // ----- Action: archiveDPP -----

  srv.on('archiveDPP', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);

    await UPDATE(DPPs)
      .set({ status: 'archived', archived_at: new Date().toISOString() })
      .where({ ID: id });

    return SELECT.one.from(DPPs).where({ ID: id });
  });

  // ----- Action: regenerateQRToken (US6.14) -----

  srv.on('regenerateQRToken', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);

    const qrToken = tokens.generate();
    const payloadUrl = `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${qrToken}`;
    const qrImageUrl = `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${qrToken}/qr.png`;
    await UPDATE(DPPs)
      .set({ qr_token: qrToken, qr_payload_url: payloadUrl })
      .where({ ID: id });

    await rotateActiveQRCode(id, payloadUrl, qrImageUrl);

    return SELECT.one.from(DPPs).where({ ID: id });
  });

  // ----- Function: generateQRCode (returns base64 PNG) -----

  srv.on('generateQRCode', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);
    if (!dpp.qr_token) req.reject(409, `DPP '${id}' has no QR token. Publish it first.`);

    const payload = dpp.qr_payload_url ||
      `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${dpp.qr_token}`;

    const QRCode = require('qrcode');
    const pngBuffer = await QRCode.toBuffer(payload, { type: 'png', margin: 1, scale: 6 });
    return { png: pngBuffer.toString('base64'), payload };
  });
};

module.exports.buildSnapshot = buildSnapshot;
