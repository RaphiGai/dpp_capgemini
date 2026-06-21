'use strict';

const cds = require('@sap/cds');
const { randomUUID, createHash } = require('crypto');
const tokens = require('../lib/token');
const { requireOwningOrg } = require('./auth-helpers');
const { aggregate } = require('../lib/aggregator');

const DPP_OWNER_PATH = 'product.owning_organization_ID';

/**
 * Mandatory-field check used by approveDPP/publishDPP. Returns an array of
 * human-readable error strings — empty means OK to proceed. Replaces the old
 * ValidationWarnings persistence: errors are reported inline via req.reject.
 */
// Friendly labels for the mandatory product fields (no internal column names in user text).
const PRODUCT_FIELD_LABELS = {
  name: 'Name',
  brand: 'Brand',
  category: 'Category',
  fibre_composition: 'Fibre composition'
};

async function checkDPPReady(dpp) {
  const { Products, Batches } = cds.entities('dpp');
  const errors = [];

  if (!dpp.product_ID) {
    errors.push('The DPP must reference a product.');
  } else {
    const product = await SELECT.one.from(Products).where({ ID: dpp.product_ID });
    if (!product) {
      errors.push('The referenced product does not exist.');
    } else {
      for (const f of ['name', 'brand', 'category', 'fibre_composition']) {
        if (!product[f]) errors.push(`Product field "${PRODUCT_FIELD_LABELS[f]}" is required.`);
      }
    }
  }
  if (dpp.batch_ID) {
    const batch = await SELECT.one.from(Batches).where({ ID: dpp.batch_ID });
    if (!batch) errors.push('The referenced batch does not exist.');
  }
  return errors;
}

/**
 * Build a JSON snapshot of the DPP — Product + Variant (via batch) + Batch +
 * BOM edges of the produced variant — for the optional `aggregated_snapshot`
 * cache and the PDF renderer. Aggregated material values are NOT computed here;
 * they are derived live by srv/lib/aggregator on public read.
 */
async function buildSnapshot(dpp) {
  const { Products, ProductVariants, Batches, ProductItems, ProductBOMs } = cds.entities('dpp');

  const [product, batch, item] = await Promise.all([
    SELECT.one.from(Products).where({ ID: dpp.product_ID }),
    dpp.batch_ID ? SELECT.one.from(Batches).where({ ID: dpp.batch_ID }) : null,
    dpp.item_ID ? SELECT.one.from(ProductItems).where({ ID: dpp.item_ID }) : null
  ]);

  // Variant precedence: explicit dpp.variant link → via batch → none.
  let variant = null;
  if (dpp.variant_ID) {
    variant = await SELECT.one.from(ProductVariants).where({ ID: dpp.variant_ID });
  } else if (batch) {
    variant = await SELECT.one.from(ProductVariants).where({ ID: batch.variant_ID });
  }

  let boms = [];
  if (variant) {
    boms = await SELECT.from(ProductBOMs).where({ parent_ID: variant.ID });
  } else {
    const variants = await SELECT.from(ProductVariants)
      .columns(['ID']).where({ product_ID: dpp.product_ID });
    if (variants.length) {
      boms = await SELECT.from(ProductBOMs)
        .where({ parent_ID: { in: variants.map((v) => v.ID) } });
    }
  }

  return {
    captured_at: new Date().toISOString(),
    dpp: {
      id: dpp.ID,
      dpp_type: dpp.dpp_type,
      visibility: dpp.visibility,
      version: dpp.current_version
    },
    product,
    variant,
    batch,
    item,
    bom: boms
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

/**
 * Load the readable business codes for a DPP (product GTIN, variant SKU, batch number,
 * item serial/UPI, creation date) used to build a structured QR token (see srv/lib/token.js).
 */
async function tokenContextFor(dpp) {
  const { Products, ProductVariants, Batches, ProductItems } = cds.entities('dpp');
  const [product, batch, item] = await Promise.all([
    dpp.product_ID ? SELECT.one.from(Products).columns('gtin').where({ ID: dpp.product_ID }) : null,
    dpp.batch_ID ? SELECT.one.from(Batches).columns('batch_number', 'variant_ID').where({ ID: dpp.batch_ID }) : null,
    dpp.item_ID ? SELECT.one.from(ProductItems).columns('serial_number', 'upi').where({ ID: dpp.item_ID }) : null
  ]);
  const variantId = dpp.variant_ID || (batch && batch.variant_ID);
  const variant = variantId
    ? await SELECT.one.from(ProductVariants).columns('sku').where({ ID: variantId })
    : null;
  return {
    gtin: product && product.gtin,
    sku: variant && variant.sku,
    batch_number: batch && batch.batch_number,
    serial: item ? item.serial_number || item.upi : null,
    date: dpp.createdAt || new Date().toISOString()
  };
}

module.exports = (srv) => {
  const { DPPs } = srv.entities;

  // ----- DPPVersions: immutable audit trail (US5.9) -----
  // Reject every OData write; rows are inserted server-side on publish (see publishDPP),
  // which targets the DB entity and therefore bypasses this gate.
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'DPPVersions', (req) => {
    req.reject(403, 'DPP versions are immutable and cannot be modified.');
  });

  // ----- Defaults on CREATE -----

  srv.before('CREATE', DPPs, async (req) => {
    if (req.data.product_ID) {
      await requireOwningOrg(req, 'Products', req.data.product_ID);
    }
    if (!req.data.status) req.data.status = 'draft';
    if (!req.data.visibility) req.data.visibility = 'internal';
    if (!req.data.dpp_type) req.data.dpp_type = 'product';
    if (!req.data.current_version) req.data.current_version = 1;
    req.data.last_updated = new Date().toISOString();
  });

  srv.before('UPDATE', DPPs, (req) => {
    req.data.last_updated = new Date().toISOString();
  });

  // ----- Action: approveDPP (draft → approved) -----

  srv.on('approveDPP', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, 'DPP not found.');

    if (dpp.status === 'archived') req.reject(400, 'This DPP is archived.');
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
    const changeReason = req.data.change_reason || null;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, 'DPP not found.');
    if (dpp.status === 'archived') req.reject(400, 'This DPP is archived and cannot be published.');

    const errors = await checkDPPReady(dpp);
    if (errors.length) req.reject(400, `DPP cannot be published: ${errors.join(' | ')}`);

    const now = new Date().toISOString();
    const previouslyPublished = dpp.status === 'published';
    const nextVersion = previouslyPublished ? dpp.current_version + 1 : dpp.current_version;
    const qrToken = dpp.qr_token || tokens.generate(await tokenContextFor(dpp));
    const payloadUrl = `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${qrToken}`;
    // Shareable direct link (US6.10): token-based, identical to the QR target so a
    // browser opening it gets the consumer SPA shell (see router/approuter.js).
    const publicUrl = payloadUrl;

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
    const snapshotJson = JSON.stringify(await buildSnapshot(draft));
    await UPDATE(DPPs)
      .set({ aggregated_snapshot: snapshotJson })
      .where({ ID: id });

    // US5.9 — append an immutable version record: the frozen snapshot, the change
    // reason and a content hash for tamper evidence. Inserted on the DB entity so it
    // bypasses the read-only OData gate below.
    const { DPPVersions } = cds.entities('dpp');
    await INSERT.into(DPPVersions).entries({
      ID: randomUUID(),
      dpp_ID: id,
      version_number: nextVersion,
      snapshot_date: now,
      change_reason: changeReason,
      changed_by_ID: req.user._appUserId || null,
      snapshot_data: snapshotJson,
      content_hash: createHash('sha256').update(snapshotJson).digest('hex')
    });

    const qrImageUrl = `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${qrToken}/qr.png`;
    await rotateActiveQRCode(id, payloadUrl, qrImageUrl);

    return SELECT.one.from(DPPs).where({ ID: id });
  });

  // ----- Action: archiveDPP -----

  srv.on('archiveDPP', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, 'DPP not found.');

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
    if (!dpp) req.reject(404, 'DPP not found.');

    const qrToken = tokens.generate(await tokenContextFor(dpp));
    const payloadUrl = `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${qrToken}`;
    const qrImageUrl = `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${qrToken}/qr.png`;
    // Keep the shareable direct link in sync with the rotated token (US6.10/US6.14).
    await UPDATE(DPPs)
      .set({ qr_token: qrToken, qr_payload_url: payloadUrl, public_url: payloadUrl })
      .where({ ID: id });

    await rotateActiveQRCode(id, payloadUrl, qrImageUrl);

    return SELECT.one.from(DPPs).where({ ID: id });
  });

  // ----- Function: generateQRCode (returns base64 PNG) -----

  srv.on('generateQRCode', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, 'DPP not found.');
    if (!dpp.qr_token) req.reject(409, 'This DPP has no QR code yet. Please publish it first.');

    // Always anchor the scan target to the current PUBLIC_BASE_URL + token. The
    // stored qr_payload_url is denormalized and can be host-less (seed data ships
    // a relative `/public/dpp/<token>`, which a phone scanner shows as raw text)
    // or stale across environments (dev :5173 vs prod domain). The token is the
    // canonical key; PUBLIC_BASE_URL is the per-environment source of truth.
    const base = process.env.PUBLIC_BASE_URL || '';
    const payload = `${base}/public/dpp/${dpp.qr_token}`;

    const QRCode = require('qrcode');
    const pngBuffer = await QRCode.toBuffer(payload, { type: 'png', margin: 1, scale: 6 });
    return { png: pngBuffer.toString('base64'), payload };
  });

  // ----- Function: aggregatedFootprint (live BOM rollup for pre-publish review) -----

  srv.on('aggregatedFootprint', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, 'DPP not found.');

    const result = await aggregate(id);
    const bd = result.breakdown || { own_co2_kg: null, components: [] };

    // Resolve internal component names for the breakdown display.
    const { Products } = cds.entities('dpp');
    const ids = [...new Set(bd.components.map((c) => c.component_ID).filter(Boolean))];
    const prods = ids.length
      ? await SELECT.from(Products).columns('ID', 'name').where({ ID: { in: ids } })
      : [];
    const nameById = Object.fromEntries(prods.map((p) => [p.ID, p.name]));
    const components = bd.components.map((c) => ({
      name: c.component_ID ? (nameById[c.component_ID] ?? c.component_ID) : (c.component_name ?? '—'),
      source: c.source,
      unit: c.unit,
      quantity: c.quantity,
      co2_kg: c.co2_kg,
      recycled_pct: c.recycled_pct,
      mass_kg: c.mass_kg,
    }));

    return {
      co2_footprint_kg:      result.values?.co2_footprint_kg ?? null,
      recycled_content_pct:  result.values?.recycled_content_pct ?? null,
      incomplete:            result.incomplete ?? false,
      missing:               JSON.stringify(result.missing ?? []),
      breakdown:             JSON.stringify({ own_co2_kg: bd.own_co2_kg, components })
    };
  });
};

module.exports.buildSnapshot = buildSnapshot;
module.exports.rotateActiveQRCode = rotateActiveQRCode;
