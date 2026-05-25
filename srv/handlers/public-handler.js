'use strict';

const cds = require('@sap/cds');
const QRCode = require('qrcode');
const tokens = require('../lib/token');

/**
 * Recursively expand a BOM tree starting from `productId`. Component DPPs that
 * are linked become reference entries (id + public_url) instead of being inlined.
 */
async function expandBomTree(productId, share, unit, role, productsById, bomsByParent, depth = 0, visited = new Set()) {
  if (depth > 8) return null;
  if (visited.has(productId)) return null;
  visited.add(productId);

  const p = productsById.get(productId);
  if (!p) return null;

  const childEdges = bomsByParent.get(productId) || [];
  const components = [];
  for (const e of childEdges) {
    const sub = await expandBomTree(
      e.component_ID, e.quantity, e.unit, e.component_role,
      productsById, bomsByParent, depth + 1, new Set(visited)
    );
    if (sub) {
      if (e.linked_dpp_ID) {
        sub.linked_dpp = {
          id: e.linked_dpp_ID,
          public_url: `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/by-id/${e.linked_dpp_ID}`
        };
      }
      components.push(sub);
    }
  }

  return {
    name: p.name,
    product_type: p.product_type,
    brand: p.brand,
    category: p.category,
    fibre_composition: p.fibre_composition,
    quantity: share,
    unit,
    role,
    components
  };
}

function toConsumerDTO(dpp, ctx) {
  let storytelling = [];
  if (dpp.storytelling) {
    try { storytelling = JSON.parse(dpp.storytelling); } catch (_) { storytelling = []; }
  }
  return {
    id: dpp.ID,
    status: dpp.status,
    version: dpp.current_version,
    granularity: dpp.granularity,
    valid_from: dpp.valid_from,
    last_updated: dpp.last_updated,
    item: ctx.item
      ? {
          serial_number: ctx.item.serial_number,
          upi: ctx.item.upi,
          item_status: ctx.item.item_status,
          qr_code: dpp.qr_token
            ? { id: dpp.qr_token, value: dpp.qr_payload_url }
            : null
        }
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
          country_of_origin: ctx.product.country_of_origin,
          substances_of_concern: ctx.product.substances_of_concern,
          espr_compliance: ctx.product.espr_compliance
        }
      : null,
    variant: ctx.variant
      ? {
          color: ctx.variant.color,
          size: ctx.variant.size,
          sku: ctx.variant.sku,
          gtin: ctx.variant.gtin
        }
      : null,
    batch: ctx.batch
      ? {
          batch_number: ctx.batch.batch_number,
          production_date: ctx.batch.production_date,
          country_of_origin: ctx.batch.country_of_origin,
          co2_footprint_kg: ctx.batch.co2_footprint_kg,
          recycled_content_pct: ctx.batch.recycled_content_pct
        }
      : null,
    materials: ctx.materialsTree,
    storytelling
  };
}

async function loadDPPContext(dpp) {
  const { Products, ProductVariants, Batches, ProductItems, ProductBOMs } = cds.entities('dpp');

  const [product, item] = await Promise.all([
    SELECT.one.from(Products).where({ ID: dpp.product_ID }),
    dpp.item_ID ? SELECT.one.from(ProductItems).where({ ID: dpp.item_ID }) : null
  ]);

  let variant = null;
  let batch = null;
  if (item) {
    batch = await SELECT.one.from(Batches).where({ ID: item.batch_ID });
    if (batch) variant = await SELECT.one.from(ProductVariants).where({ ID: batch.variant_ID });
  }

  const owningOrgId = product?.owning_organization_ID;
  const [allProducts, allBoms] = await Promise.all([
    owningOrgId
      ? SELECT.from(Products).where({ owning_organization_ID: owningOrgId })
      : SELECT.from(Products),
    SELECT.from(ProductBOMs)
  ]);
  const productsById = new Map(allProducts.map((p) => [p.ID, p]));
  const bomsByParent = new Map();
  for (const e of allBoms) {
    if (!bomsByParent.has(e.parent_ID)) bomsByParent.set(e.parent_ID, []);
    bomsByParent.get(e.parent_ID).push(e);
  }
  const rootBom = await expandBomTree(dpp.product_ID, null, null, null, productsById, bomsByParent);
  const materialsTree = rootBom?.components || [];

  return { product, variant, batch, item, materialsTree };
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

module.exports = { resolveDPPByToken, getQRImage, loadDPPByToken };
