'use strict';

const cds = require('@sap/cds');
const QRCode = require('qrcode');
const tokens = require('../lib/token');
const { aggregate, firstItemDpp } = require('../lib/aggregator');

const MAX_DEPTH = 8;

/**
 * Recursively expand the BOM tree of a finished-product variant for consumer
 * display. Each node carries either the inline component description, a
 * reference to an internal sub-DPP, or an external supplier-DPP URL.
 *
 * The linked sub-DPP honours per-batch sourcing (BatchComponents `overrides`,
 * keyed by BOM line ID): the consumed component batch's passport = the DPP of its
 * first item. With several sourced batches, the first published+public one is the
 * representative link. Without an override, the variant-level default applies.
 * Only published+public passports are linked. `overrides` apply only at the top
 * level (the finished good's batch) → an empty map is passed to recursion.
 */
async function expandBomTree(variantId, productsById, bomsByParent, overrides = new Map(), depth = 0, visited = new Set()) {
  if (depth > MAX_DEPTH) return [];
  if (visited.has(variantId)) return [];
  visited.add(variantId);

  const { DPPs, ProductVariants } = cds.entities('dpp');
  const isPublic = (d) => d && d.status === 'published' && d.visibility === 'public' && d.qr_token;
  const loadDpp = (id) =>
    SELECT.one.from(DPPs).columns(['ID', 'qr_token', 'status', 'visibility']).where({ ID: id });

  const edges = bomsByParent.get(variantId) || [];
  const out = [];
  for (const e of edges) {
    const componentProduct = productsById.get(e.component_ID);
    const node = {
      component_ID: e.component_ID,
      // Fall back to the line's free-text fields for external components (no internal product).
      name: componentProduct?.name || e.component_name || null,
      product_type: componentProduct?.product_type || null,
      brand: componentProduct?.brand || null,
      category: componentProduct?.category || e.component_category || null,
      fibre_composition: componentProduct?.fibre_composition || e.component_fibre_composition || null,
      quantity: e.quantity,
      unit: e.unit,
      role: e.component_role,
      sub_dpp: null,
      external_dpp_url: e.external_dpp_url || null,
      components: [],
    };

    // Resolve the passport to link: per-batch sourcing first (representative =
    // first published+public consumed batch), else the variant-level default. Rows
    // that resolve to nothing (e.g. external-only batch-number rows) fall through.
    const candidateIds = [];
    for (const bc of overrides.get(e.ID) || []) {
      const id = bc.component_batch_ID ? await firstItemDpp(bc.component_batch_ID) : (bc.sub_dpp_ID || null);
      if (id) candidateIds.push(id);
    }
    if (!candidateIds.length && e.sub_dpp_ID) candidateIds.push(e.sub_dpp_ID);

    let subDpp = null;
    for (const id of candidateIds) {
      const d = await loadDpp(id);
      if (isPublic(d)) { subDpp = d; break; }
    }
    if (subDpp) {
      node.sub_dpp = {
        id: subDpp.ID,
        qr_token: subDpp.qr_token,
        public_url: `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${subDpp.qr_token}`,
      };
    }

    // Recurse into the internal component's own composition (no batch context here).
    if (e.component_ID) {
      const subVariants = await SELECT.from(ProductVariants)
        .columns(['ID'])
        .where({ product_ID: e.component_ID });
      for (const sv of subVariants) {
        const subNodes = await expandBomTree(
          sv.ID, productsById, bomsByParent, new Map(), depth + 1, new Set(visited),
        );
        if (subNodes.length) node.components.push(...subNodes);
      }
    }
    out.push(node);
  }
  return out;
}

function toConsumerDTO(dpp, ctx) {
  // Storytelling is a product-level property (shown in the consumer story).
  let storytelling = [];
  if (ctx.product?.storytelling) {
    try { storytelling = JSON.parse(ctx.product.storytelling); } catch { storytelling = []; }
  }
  return {
    id: dpp.ID,
    status: dpp.status,
    version: dpp.current_version,
    valid_from: dpp.valid_from,
    last_updated: dpp.last_updated,
    qr_code: dpp.qr_token
      ? { id: dpp.qr_token, value: dpp.qr_payload_url }
      : null,
    product: ctx.product
      ? {
          name: ctx.product.name,
          brand: ctx.product.brand,
          category: ctx.product.category,
          model: ctx.product.model,
          description: ctx.product.description,
          fibre_composition: ctx.product.fibre_composition,
          care_instructions: ctx.product.care_instructions,
          repair_instructions: ctx.product.repair_instructions,
          disposal_instructions: ctx.product.disposal_instructions,
          reuse_instructions: ctx.product.reuse_instructions,
          durability_score: ctx.product.durability_score,
          repairability_score: ctx.product.repairability_score,
          care_video_url: ctx.product.care_video_url,
          repair_video_url: ctx.product.repair_video_url,
          disposal_video_url: ctx.product.disposal_video_url,
          reuse_video_url: ctx.product.reuse_video_url,
          country_of_origin: ctx.product.country_of_origin,
          substances_of_concern: ctx.product.substances_of_concern,
          espr_compliance: ctx.product.espr_compliance,
          storytelling,
        }
      : null,
    variant: ctx.variant
      ? {
          color: ctx.variant.color,
          size: ctx.variant.size,
          sku: ctx.variant.sku,
          gtin: ctx.variant.gtin,
          image_url: ctx.variant.image_url,
          image_data: ctx.variant.image_data,
        }
      : null,
    batch: ctx.batch
      ? {
          batch_number: ctx.batch.batch_number,
          production_date: ctx.batch.production_date,
          country_of_origin: ctx.batch.country_of_origin,
          co2_footprint_kg: ctx.batch.co2_footprint_kg,
          recycled_content_pct: ctx.batch.recycled_content_pct,
        }
      : null,
    materials: ctx.materialsTree,
    aggregated: ctx.aggregated,
    marketing: ctx.marketing || [],
    documents: ctx.documents || [],
    // Identification & traceability shown on the consumer view (US6.11).
    identification: {
      dpp_id: dpp.ID,
      product_id: dpp.product_ID,
      batch_number: ctx.batch?.batch_number ?? null,
      serial_number: ctx.item?.serial_number ?? null,
      upi: ctx.item?.upi ?? null,
    },
  };
}

/**
 * Active, currently-valid marketing/advertising links for the consumer view:
 * either attached to this DPP or org-wide (dpp_ID null) within the same
 * organisation. Filtered by is_active + the valid_from/valid_to window and
 * sorted by display_order.
 */
async function loadMarketingLinks(owningOrgId, dppId) {
  if (!owningOrgId) return [];
  const { DPPMarketingLinks } = cds.entities('dpp');
  const links = await SELECT.from(DPPMarketingLinks)
    .where({ owning_organization_ID: owningOrgId, is_active: true });
  const today = new Date().toISOString().slice(0, 10);
  return links
    .filter((l) => l.dpp_ID == null || l.dpp_ID === dppId)
    .filter((l) => (!l.valid_from || l.valid_from <= today) && (!l.valid_to || l.valid_to >= today))
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((l) => ({
      link_type: l.link_type,
      title: l.title,
      url: l.url,
      display_order: l.display_order,
      valid_from: l.valid_from,
      valid_to: l.valid_to,
    }));
}

/**
 * Public certificates & proofs for the consumer view: only `public` documents
 * attached to this DPP's product, plus those on its batch (if any). Returns
 * metadata + a token-protected download URL — never the binary itself.
 */
async function loadPublicDocuments(dpp) {
  const { Documents } = cds.entities('dpp');
  const cols = ['ID', 'doc_type', 'title', 'issuer', 'issue_date', 'valid_until', 'file_name', 'mime_type', 'file_size'];
  // Two AND-only queries (product, then batch) avoid mixed AND/OR where ambiguity.
  let rows = await SELECT.from(Documents).columns(cols)
    .where({ visibility: 'public', product_ID: dpp.product_ID });
  if (dpp.batch_ID) {
    const batchRows = await SELECT.from(Documents).columns(cols)
      .where({ visibility: 'public', batch_ID: dpp.batch_ID });
    rows = rows.concat(batchRows);
  }
  const base = process.env.PUBLIC_BASE_URL || '';
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
    download_url: `${base}/public/dpp/${dpp.qr_token}/documents/${d.ID}`,
  }));
}

async function loadDPPContext(dpp) {
  const { Products, ProductVariants, Batches, ProductItems, ProductBOMs, BatchComponents } = cds.entities('dpp');

  const product = await SELECT.one.from(Products).where({ ID: dpp.product_ID });

  // Serialized item-level DPP: load the item for its serial number / UPI (US6.11).
  const item = dpp.item_ID
    ? await SELECT.one.from(ProductItems).where({ ID: dpp.item_ID })
    : null;

  let variant = null;
  let batch = null;
  if (dpp.batch_ID) {
    batch = await SELECT.one.from(Batches).where({ ID: dpp.batch_ID });
    if (batch) variant = await SELECT.one.from(ProductVariants).where({ ID: batch.variant_ID });
  }

  // Per-batch component sourcing → BOM line ID → list of consumed-component rows.
  // Mirrors srv/lib/aggregator.js; drives the linked sub-passport in the tree.
  const overrides = new Map();
  if (batch) {
    const bcs = await SELECT.from(BatchComponents).where({ batch_ID: batch.ID });
    for (const bc of bcs) {
      if (!overrides.has(bc.bom_ID)) overrides.set(bc.bom_ID, []);
      overrides.get(bc.bom_ID).push(bc);
    }
  }

  const owningOrgId = product?.owning_organization_ID;
  const [allProducts, allBoms] = await Promise.all([
    owningOrgId
      ? SELECT.from(Products).where({ owning_organization_ID: owningOrgId })
      : SELECT.from(Products),
    SELECT.from(ProductBOMs),
  ]);
  const productsById = new Map(allProducts.map((p) => [p.ID, p]));
  const bomsByParent = new Map();
  for (const e of allBoms) {
    if (!bomsByParent.has(e.parent_ID)) bomsByParent.set(e.parent_ID, []);
    bomsByParent.get(e.parent_ID).push(e);
  }

  let materialsTree = [];
  if (variant) {
    materialsTree = await expandBomTree(variant.ID, productsById, bomsByParent, overrides);
  } else {
    const variants = await SELECT.from(ProductVariants)
      .columns(['ID']).where({ product_ID: dpp.product_ID });
    for (const v of variants) {
      const nodes = await expandBomTree(v.ID, productsById, bomsByParent, overrides);
      if (nodes.length) { materialsTree = nodes; break; }
    }
  }

  const aggregated = await aggregate(dpp.ID);
  const marketing = await loadMarketingLinks(owningOrgId, dpp.ID);
  const documents = await loadPublicDocuments(dpp);

  return { product, variant, batch, item, materialsTree, aggregated, marketing, documents };
}

async function loadDPPByToken(token) {
  if (!tokens.verify(token)) return null;
  const { DPPs } = cds.entities('dpp');

  const dpp = await SELECT.one.from(DPPs).where({ qr_token: token });
  if (!dpp) return null;
  if (dpp.status !== 'published') return null;
  if (dpp.visibility !== 'public') return null;

  const ctx = await loadDPPContext(dpp);
  return toConsumerDTO(dpp, ctx);
}

async function resolveDPPByToken(req, res) {
  try {
    const dto = await loadDPPByToken(req.params.token);
    if (!dto) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(dto);
  } catch (err) {
    req.app?.locals?.logger?.error?.(err) || console.error('public-handler error', err);
    res.status(500).json({ error: 'internal_error' });
  }
}

/**
 * Token-protected download of a PUBLIC document for the consumer DPP. Consumers
 * have no login, so this streams the media outside the OData auth gate. Three hard
 * checks: valid token → published+public DPP; document is `public`; and the document
 * belongs to the same product/batch the token resolves to (no cross-DPP leak).
 */
async function downloadPublicDocument(req, res) {
  try {
    const { token, docId } = req.params;
    if (!tokens.verify(token)) return res.status(404).end();
    const { DPPs, Documents } = cds.entities('dpp');

    const dpp = await SELECT.one.from(DPPs)
      .columns('ID', 'product_ID', 'batch_ID', 'status', 'visibility', 'qr_token')
      .where({ qr_token: token });
    if (!dpp || dpp.status !== 'published' || dpp.visibility !== 'public') return res.status(404).end();

    const doc = await SELECT.one.from(Documents)
      .columns('ID', 'product_ID', 'batch_ID', 'visibility', 'file_name', 'mime_type')
      .where({ ID: docId });
    if (!doc || doc.visibility !== 'public') return res.status(404).end();

    // The document must belong to the same product/batch the token resolves to.
    const okProduct = doc.product_ID && doc.product_ID === dpp.product_ID;
    const okBatch = doc.batch_ID && dpp.batch_ID && doc.batch_ID === dpp.batch_ID;
    if (!okProduct && !okBatch) return res.status(404).end();

    // @cap-js returns an explicitly-selected media column as a Readable stream.
    const row = await SELECT.one.from(Documents).columns('content').where({ ID: doc.ID });
    const content = row && row.content;
    if (content == null) return res.status(404).end();

    res.set('Content-Type', doc.mime_type || 'application/octet-stream');
    // Force a download (the consumer expects to save the certificate, not view it inline).
    res.set('Content-Disposition', `attachment; filename="${String(doc.file_name || 'document').replace(/"/g, '')}"`);
    res.set('Cache-Control', 'public, max-age=300');

    if (typeof content.pipe === 'function') {
      content.on('error', (err) => {
        console.error('public document stream error', err);
        if (!res.headersSent) res.status(500).end();
      });
      content.pipe(res);
    } else if (Buffer.isBuffer(content)) {
      res.end(content);
    } else {
      res.end(Buffer.from(String(content), 'base64')); // defensive: non-stream driver
    }
  } catch (err) {
    console.error('public document download error', err);
    if (!res.headersSent) res.status(500).end();
  }
}

async function getQRImage(req, res) {
  try {
    if (!tokens.verify(req.params.token)) return res.status(404).end();
    const url = `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/${req.params.token}`;
    const png = await QRCode.toBuffer(url, { type: 'png', margin: 1, scale: 6 });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    console.error('qr-image error', err);
    res.status(500).end();
  }
}

module.exports = { resolveDPPByToken, getQRImage, loadDPPByToken, downloadPublicDocument };
