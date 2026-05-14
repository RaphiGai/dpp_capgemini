'use strict';

const cds = require('@sap/cds');
const QRCode = require('qrcode');
const tokens = require('../lib/token');

/**
 * Filter sequences down to publicly visible rows. The visibility column lives
 * on every consumer-facing child entity. Authority-only and internal rows are
 * stripped from the response.
 */
function publicOnly(arr) {
  if (!arr) return [];
  return arr.filter((row) => row?.visibility === 'public');
}

/**
 * Build the Consumer-DTO. Only `visibility=public` content is exposed and the
 * payload deliberately omits operational fields (tenant, hash audit, anchor
 * attempt counters).
 */
function toConsumerDTO(dpp, children) {
  return {
    id: dpp.ID,
    status: dpp.status,
    granularity: dpp.granularity_level,
    batch: dpp.batch_lot_number || null,
    verification_status: dpp.verification_status,
    manufacturing: {
      country: dpp.manufacturing_country_iso2,
      from: dpp.manufacturing_date_from,
      to: dpp.manufacturing_date_to,
      placed_on_market: dpp.placed_on_market_date
    },
    product: dpp.product
      ? {
          name: dpp.product.name,
          brand: dpp.product.brand,
          gtin: dpp.product.gtin,
          category: dpp.product.category,
          description: dpp.product.description
        }
      : null,
    materials: publicOnly(children.materials).map((m) => ({
      class: m.material_class,
      fiber: m.fiber_name,
      percentage: m.percentage,
      country_of_origin: m.country_of_origin,
      recycled_content_pct: m.recycled_content_pct,
      verification_status: m.verification_status
    })),
    compliance: publicOnly(children.compliance).map((c) => ({
      standard: c.compliance_standard,
      statement: c.statement_text,
      valid_from: c.valid_from,
      valid_until: c.valid_until,
      verification_status: c.verification_status
    })),
    care: publicOnly(children.care).map((c) => ({
      language: c.language,
      washing: c.washing,
      drying: c.drying,
      ironing: c.ironing,
      bleaching: c.bleaching,
      professional: c.professional,
      repair: c.repair_info,
      disposal: c.disposal_info
    })),
    substances: publicOnly(children.substances).map((s) => ({
      name: s.substance_name,
      cas: s.cas_number,
      ec: s.ec_number,
      concentration_pct: s.concentration_pct
    })),
    sustainability: children.sustainability && children.sustainability.visibility === 'public'
      ? {
          co2_kg: children.sustainability.co2_footprint_kg,
          co2_methodology: children.sustainability.co2_methodology,
          water_l: children.sustainability.water_usage_l,
          energy_kwh: children.sustainability.energy_usage_kwh,
          recycled_content: children.sustainability.recycled_content_overall,
          durability_score: children.sustainability.durability_score,
          repairability_score: children.sustainability.repairability_score
        }
      : null,
    lifecycle: publicOnly(children.lifecycle).map((e) => ({
      type: e.event_type,
      date: e.event_date,
      notes: e.notes
    })),
    blockchain: (children.anchors || []).map((a) => ({
      network: a.network,
      chain_id: a.chain_id,
      tx_hash: a.tx_hash,
      block_number: a.block_number,
      version: a.version,
      anchored_at: a.anchored_at,
      status: a.status
    }))
  };
}

async function loadDPPByToken(token) {
  if (!tokens.verify(token)) return null;
  const { DPPs, MaterialComposition, ComplianceStatements, CareInstructions,
    SubstancesOfConcern, SustainabilityIndicators, LifecycleEvents,
    BlockchainAnchors, Products } = cds.entities('dpp');

  const dpp = await SELECT.one.from(DPPs).where({ qr_token: token });
  if (!dpp) return null;
  if (dpp.status !== 'published') return null;
  if (dpp.visibility === 'internal' || dpp.visibility === 'authority_only') return null;

  const [product, materials, compliance, care, substances, sustainability, lifecycle, anchors] =
    await Promise.all([
      SELECT.one.from(Products).where({ ID: dpp.product_ID }),
      SELECT.from(MaterialComposition).where({ dpp_ID: dpp.ID }),
      SELECT.from(ComplianceStatements).where({ dpp_ID: dpp.ID }),
      SELECT.from(CareInstructions).where({ dpp_ID: dpp.ID }),
      SELECT.from(SubstancesOfConcern).where({ dpp_ID: dpp.ID }),
      SELECT.one.from(SustainabilityIndicators).where({ dpp_ID: dpp.ID }),
      SELECT.from(LifecycleEvents).where({ dpp_ID: dpp.ID }),
      SELECT.from(BlockchainAnchors).where({ dpp_ID: dpp.ID, status: 'anchored' })
    ]);

  return toConsumerDTO({ ...dpp, product }, {
    materials,
    compliance,
    care,
    substances,
    sustainability,
    lifecycle,
    anchors
  });
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
