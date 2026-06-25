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
 * All marketing links shown for a DPP at snapshot time: those attached to the
 * DPP plus org-wide ones (dpp_ID null), within the owning org. Unlike the public
 * consumer view, this keeps inactive/out-of-window links too (with is_active +
 * validity preserved) so the read-only version view can reproduce the full state.
 */
async function snapshotMarketingLinks(owningOrgId, dppId) {
  if (!owningOrgId) return [];
  const { DPPMarketingLinks } = cds.entities('dpp');
  const links = await SELECT.from(DPPMarketingLinks).where({ owning_organization_ID: owningOrgId });
  return links
    .filter((l) => l.dpp_ID == null || l.dpp_ID === dppId)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((l) => ({
      link_type: l.link_type,
      title: l.title,
      url: l.url,
      is_active: l.is_active,
      display_order: l.display_order,
      valid_from: l.valid_from,
      valid_to: l.valid_to,
      dpp_ID: l.dpp_ID,
    }));
}

/**
 * Document metadata (never binary content) for the DPP's product and batch —
 * all visibilities, since this snapshot reproduces the internal company view.
 */
async function snapshotDocuments(dpp) {
  const { Documents } = cds.entities('dpp');
  const cols = ['ID', 'doc_type', 'title', 'issuer', 'issue_date', 'valid_until', 'file_name', 'mime_type', 'file_size', 'visibility'];
  let rows = await SELECT.from(Documents).columns(cols).where({ product_ID: dpp.product_ID });
  if (dpp.batch_ID) {
    const batchRows = await SELECT.from(Documents).columns(cols).where({ batch_ID: dpp.batch_ID });
    rows = rows.concat(batchRows);
  }
  return rows.map((d) => ({
    id: d.ID,
    doc_type: d.doc_type,
    title: d.title,
    issuer: d.issuer,
    issue_date: d.issue_date,
    valid_until: d.valid_until,
    file_name: d.file_name,
    mime_type: d.mime_type,
    file_size: d.file_size,
    visibility: d.visibility,
  }));
}

/**
 * Footprint values rolled up across the BOM tree at snapshot time, with the
 * component breakdown and internal component names resolved (mirrors the
 * aggregatedFootprint action). Frozen into the snapshot so the read-only version
 * view shows the figures as they were, not a later live recomputation.
 */
async function snapshotAggregated(dppId) {
  const result = await aggregate(dppId);
  const bd = result.breakdown || { own_co2_kg: null, components: [] };
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
    co2_footprint_kg: result.values?.co2_footprint_kg ?? null,
    recycled_content_pct: result.values?.recycled_content_pct ?? null,
    incomplete: result.incomplete ?? false,
    missing: result.missing ?? [],
    breakdown: { own_co2_kg: bd.own_co2_kg, components },
  };
}

/**
 * Build a comprehensive JSON snapshot of the DPP — Product + Variant (via batch) +
 * Batch + Item + BOM edges PLUS storytelling, marketing links, document metadata
 * and the rolled-up footprint — frozen at this point in time. Used for the
 * `aggregated_snapshot` cache, the PDF renderer, and DPPVersions rows (publish and
 * manual versions). The read-only version view in the UI is reconstructed from this.
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

  // Resolve factory/supplier names so the read-only version view renders the batch
  // identically to the live view (which $expands these associations).
  if (batch) {
    const { BusinessPartners } = cds.entities('dpp');
    const [factory, supplier] = await Promise.all([
      batch.factory_ID ? SELECT.one.from(BusinessPartners).columns('ID', 'name').where({ ID: batch.factory_ID }) : null,
      batch.supplier_ID ? SELECT.one.from(BusinessPartners).columns('ID', 'name').where({ ID: batch.supplier_ID }) : null
    ]);
    batch.factory = factory;
    batch.supplier = supplier;
  }

  const owningOrgId = product?.owning_organization_ID;
  const [marketing_links, documents, aggregated] = await Promise.all([
    snapshotMarketingLinks(owningOrgId, dpp.ID),
    snapshotDocuments(dpp),
    snapshotAggregated(dpp.ID)
  ]);

  return {
    captured_at: new Date().toISOString(),
    dpp: {
      id: dpp.ID,
      dpp_type: dpp.dpp_type,
      status: dpp.status,
      visibility: dpp.visibility,
      version: dpp.current_version,
      valid_from: dpp.valid_from
    },
    product,
    variant,
    batch,
    item,
    bom: boms,
    storytelling: dpp.storytelling ?? null,
    marketing_links,
    documents,
    aggregated
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

/**
 * Next version number for a DPP = max(highest existing DPPVersions.version_number,
 * floor) + 1. Shared by publishDPP (floor 0 → clean "v1 first" semantics) and the
 * manual createDPPVersion action (floor = current_version → a manual version always
 * advances the counter). One monotonic, collision-free sequence per DPP.
 */
async function nextVersionNumber(dppId, floor = 0) {
  const { DPPVersions } = cds.entities('dpp');
  const rows = await SELECT.from(DPPVersions).columns('version_number').where({ dpp_ID: dppId });
  const max = rows.reduce((m, r) => Math.max(m, r.version_number || 0), 0);
  return Math.max(max, floor) + 1;
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

  srv.before('UPDATE', DPPs, async (req) => {
    req.data.last_updated = new Date().toISOString();

    // An archived DPP is frozen: it stays consumer-visible but cannot be edited.
    // Lifecycle actions (archive/unarchive) write via the DB-level entity and so
    // bypass this OData gate; only direct client PATCHes are checked here. The key
    // arrives as a bound param on PATCH — programmatic .where() updates carry none.
    const key = req.params && req.params[req.params.length - 1];
    const id = key && typeof key === 'object' ? key.ID : key;
    if (id) {
      const current = await SELECT.one.from(DPPs).columns('status').where({ ID: id });
      if (current && current.status === 'archived') {
        req.reject(400, 'This DPP is archived and cannot be modified. Unarchive it first.');
      }
    }
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
    // Draw from the shared per-DPP version sequence so publish and manual versions
    // never collide (see nextVersionNumber).
    const nextVersion = await nextVersionNumber(id);
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

  // ----- Action: unarchiveDPP (company_advanced only) -----
  // Brings a frozen passport back into the active lifecycle. The restored status
  // is the furthest stage it had reached before archiving (published › approved ›
  // draft), inferred from the lifecycle timestamps — re-publishing is not required
  // for a previously-published DPP. Writes via the DB-level entity so it bypasses
  // the archived-edit gate in before('UPDATE', DPPs).
  srv.on('unarchiveDPP', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, 'DPP not found.');
    if (dpp.status !== 'archived') return dpp; // idempotent: nothing to do

    const restoredStatus = dpp.published_at ? 'published' : (dpp.approved_at ? 'approved' : 'draft');
    await UPDATE(cds.entities('dpp').DPPs)
      .set({ status: restoredStatus, archived_at: null, last_updated: new Date().toISOString() })
      .where({ ID: id });

    return SELECT.one.from(DPPs).where({ ID: id });
  });

  // ----- Action: createDPPVersion (manual snapshot, company_advanced only) -----
  // Captures a comprehensive, frozen snapshot of the DPP's current state as a new
  // DPPVersions row and advances current_version (a manual version counts as a new
  // version, like publish). Retrieved read-only later via the UI version picker.
  srv.on('createDPPVersion', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    const changeReason = req.data.change_reason || null;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, 'DPP not found.');
    if (dpp.status === 'archived') {
      req.reject(400, 'This DPP is archived and cannot be versioned. Unarchive it first.');
    }

    const now = new Date().toISOString();
    // floor = current_version so a manual version always advances the counter.
    const nextVersion = await nextVersionNumber(id, dpp.current_version);

    // Advance the version counter first so the snapshot records the new number.
    await UPDATE(DPPs).set({ current_version: nextVersion, last_updated: now }).where({ ID: id });

    const updated = await SELECT.one.from(DPPs).where({ ID: id });
    const snapshotJson = JSON.stringify(await buildSnapshot(updated));

    // Append the immutable version row via the DB-level entity (bypasses the
    // read-only OData gate), mirroring publishDPP.
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

    return SELECT.one.from(DPPs).where({ ID: id });
  });

  // ----- Action: regenerateQRToken (US6.14) -----

  srv.on('regenerateQRToken', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'DPPs', id, DPP_OWNER_PATH);
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, 'DPP not found.');
    if (dpp.status === 'archived') req.reject(400, 'This DPP is archived and cannot be modified. Unarchive it first.');

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
