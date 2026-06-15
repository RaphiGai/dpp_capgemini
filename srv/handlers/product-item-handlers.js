'use strict';

const cds = require('@sap/cds');
const { randomUUID } = require('crypto');
const tokens = require('../lib/token');
const { requireOwningOrg } = require('./auth-helpers');
const { rotateActiveQRCode } = require('./dpp-handlers');

const BATCH_OWNER_PATH = 'variant.product.owning_organization_ID';

/**
 * Resolve the batch → variant → product chain for a serialized item, so the
 * auto-created DPP can carry direct product/variant/batch references.
 */
async function resolveChain(batchId) {
  const { Batches, ProductVariants } = cds.entities('dpp');
  const batch = await SELECT.one.from(Batches).columns(['ID', 'variant_ID']).where({ ID: batchId });
  if (!batch) return null;
  const variant = await SELECT.one.from(ProductVariants)
    .columns(['ID', 'product_ID']).where({ ID: batch.variant_ID });
  if (!variant) return null;
  return { batch_ID: batch.ID, variant_ID: variant.ID, product_ID: variant.product_ID };
}

module.exports = (srv) => {
  const { ProductItems } = srv.entities;

  // ----- Defaults + tenant guard on CREATE -----

  srv.before('CREATE', ProductItems, async (req) => {
    if (!req.data.batch_ID) req.reject(400, 'An item must be assigned to a batch.');
    if (!req.data.serial_number) req.reject(400, 'An item must have a serial number.');
    await requireOwningOrg(req, 'Batches', req.data.batch_ID, BATCH_OWNER_PATH);
    if (!req.data.status) req.data.status = 'active';
    // Unique Product Identifier (ESPR). A caller may pass a standardised UPI
    // (e.g. GS1 / GTIN+serial); otherwise mint a globally unique one.
    if (!req.data.upi) req.data.upi = `UPI-${randomUUID()}`;
  });

  // ----- Auto-create the unique item-level DPP + active QR on CREATE -----

  srv.after('CREATE', ProductItems, async (item, req) => {
    const chain = await resolveChain(item.batch_ID);
    if (!chain) {
      console.warn(`[product-item] cannot resolve product chain for batch '${item.batch_ID}'`);
      req.reject(400, 'This item cannot be linked to its product. Please check the batch assignment.');
    }

    const { DPPs } = cds.entities('dpp');
    const dppId = randomUUID();
    const now = new Date().toISOString();
    const uid = req.user._appUserId || null;
    const qrToken = tokens.generate();
    const base = process.env.PUBLIC_BASE_URL || '';
    const payloadUrl = `${base}/public/dpp/${qrToken}`;
    const qrImageUrl = `${base}/public/dpp/${qrToken}/qr.png`;

    await INSERT.into(DPPs).entries({
      ID: dppId,
      product_ID: chain.product_ID,
      variant_ID: chain.variant_ID,
      batch_ID: chain.batch_ID,
      item_ID: item.ID,
      dpp_type: 'item',
      status: 'draft',
      visibility: 'internal',
      current_version: 1,
      qr_token: qrToken,
      qr_payload_url: payloadUrl,
      last_updated: now,
      createdAt: now,
      lastChange: now,
      createdBy_ID: uid,
      changedBy_ID: uid
    });

    // Immediately give the item a scannable, stable QR (public resolution still
    // requires the DPP to be published). Keeps the "always a unique DPP + QR"
    // guarantee for every serialized item.
    await rotateActiveQRCode(dppId, payloadUrl, qrImageUrl);
  });
};
