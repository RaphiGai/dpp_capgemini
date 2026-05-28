'use strict';

const cds = require('@sap/cds');
const QRCode = require('qrcode');
const tokens = require('../lib/token');
const { aggregate } = require('../lib/aggregator');

const MAX_DEPTH = 8;

/**
 * Recursively expand the BOM tree of a finished-product variant for consumer
 * display. Each node carries either the inline component description, a
 * reference to an internal sub-DPP, or an external supplier-DPP URL.
 */
async function expandBomTree(variantId, productsById, bomsByParent, depth = 0, visited = new Set()) {
  if (depth > MAX_DEPTH) return [];
  if (visited.has(variantId)) return [];
  visited.add(variantId);

  const edges = bomsByParent.get(variantId) || [];
  const out = [];
  for (const e of edges) {
    const componentProduct = productsById.get(e.component_ID);
    const node = {
      component_ID: e.component_ID,
      name: componentProduct?.name || null,
      product_type: componentProduct?.product_type || null,
      brand: componentProduct?.brand || null,
      category: componentProduct?.category || null,
      fibre_composition: componentProduct?.fibre_composition || null,
      quantity: e.quantity,
      unit: e.unit,
      role: e.component_role,
      sub_dpp: null,
      external_dpp_url: e.external_dpp_url || null,
      components: [],
    };

    if (e.sub_dpp_ID) {
      node.sub_dpp = {
        id: e.sub_dpp_ID,
        public_url: `${process.env.PUBLIC_BASE_URL || ''}/public/dpp/by-id/${e.sub_dpp_ID}`,
      };
      const subVariants = await SELECT.from(cds.entities('dpp').ProductVariants)
        .columns(['ID'])
        .where({ product_ID: e.component_ID });
      for (const sv of subVariants) {
        const subNodes = await expandBomTree(
          sv.ID, productsById, bomsByParent, depth + 1, new Set(visited),
        );
        if (subNodes.length) node.components.push(...subNodes);
      }
    }
    out.push(node);
  }
  return out;
}

function toConsumerDTO(dpp, ctx) {
  let storytelling = [];
  if (dpp.storytelling) {
    try { storytelling = JSON.parse(dpp.storytelling); } catch { storytelling = []; }
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
          country_of_origin: ctx.product.country_of_origin,
          substances_of_concern: ctx.product.substances_of_concern,
          espr_compliance: ctx.product.espr_compliance,
        }
      : null,
    variant: ctx.variant
      ? {
          color: ctx.variant.color,
          size: ctx.variant.size,
          sku: ctx.variant.sku,
          gtin: ctx.variant.gtin,
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
    storytelling,
  };
}

async function loadDPPContext(dpp) {
  const { Products, ProductVariants, Batches, ProductBOMs } = cds.entities('dpp');

  const product = await SELECT.one.from(Products).where({ ID: dpp.product_ID });

  let variant = null;
  let batch = null;
  if (dpp.batch_ID) {
    batch = await SELECT.one.from(Batches).where({ ID: dpp.batch_ID });
    if (batch) variant = await SELECT.one.from(ProductVariants).where({ ID: batch.variant_ID });
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
    materialsTree = await expandBomTree(variant.ID, productsById, bomsByParent);
  } else {
    const variants = await SELECT.from(ProductVariants)
      .columns(['ID']).where({ product_ID: dpp.product_ID });
    for (const v of variants) {
      const nodes = await expandBomTree(v.ID, productsById, bomsByParent);
      if (nodes.length) { materialsTree = nodes; break; }
    }
  }

  const aggregated = await aggregate(dpp.ID);

  return { product, variant, batch, materialsTree, aggregated };
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
