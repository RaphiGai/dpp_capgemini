'use strict';

const cds = require('@sap/cds');
const { getUserOrg, requireOwningOrg } = require('./auth-helpers');

function rejectCrossOrgWrite(req, fieldValue, callerOrgId) {
  if (fieldValue !== undefined && fieldValue !== callerOrgId) {
    req.reject(403, 'Cannot assign records to a different organization.');
  }
}

/**
 * Walk the BOM graph downward from `startProductId`: is `targetProductId`
 * reachable as a descendant component? BOMs are anchored at variant level, so
 * each expansion step resolves all variants of the current product and follows
 * their outgoing edges. Used to reject edges that would create a cycle
 * (US4.11).
 */
async function descendantsReach(startProductId, targetProductId, { ProductVariants, ProductBOMs }) {
  const visited = new Set();
  const stack = [startProductId];
  while (stack.length) {
    const cur = stack.pop();
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (cur === targetProductId) return true;
    const variants = await SELECT.from(ProductVariants)
      .columns(['ID'])
      .where({ product_ID: cur });
    if (!variants.length) continue;
    const edges = await SELECT.from(ProductBOMs)
      .columns(['component_ID'])
      .where({ parent_ID: { in: variants.map((v) => v.ID) } });
    for (const e of edges) stack.push(e.component_ID);
  }
  return false;
}

module.exports = (srv) => {
  const {
    Products, ProductVariants,
    ProductBOMs, BusinessPartners, Batches
  } = srv.entities;

  // ----- Tenant defaulting on CREATE + tenant guard on UPDATE -----

  srv.before('CREATE', Products, async (req) => {
    const org = await getUserOrg(req);
    rejectCrossOrgWrite(req, req.data.owning_organization_ID, org.ID);
    if (!req.data.owning_organization_ID) req.data.owning_organization_ID = org.ID;
    if (!req.data.product_type) req.data.product_type = 'finished';
    if (!req.data.status) req.data.status = 'draft';
  });

  srv.before('UPDATE', Products, async (req) => {
    rejectCrossOrgWrite(req, req.data.owning_organization_ID, req.user._appOrgId);
  });

  // ESPR durability / repairability scores are on a 0–10 scale.
  srv.before(['CREATE', 'UPDATE'], Products, (req) => {
    for (const field of ['durability_score', 'repairability_score']) {
      const v = req.data[field];
      if (v != null && (v < 0 || v > 10)) {
        req.reject(400, 'Durability and repairability scores must be between 0 and 10.');
      }
    }
  });

  srv.before('CREATE', BusinessPartners, async (req) => {
    const org = await getUserOrg(req);
    rejectCrossOrgWrite(req, req.data.owning_organization_ID, org.ID);
    if (!req.data.owning_organization_ID) req.data.owning_organization_ID = org.ID;
  });

  srv.before('UPDATE', BusinessPartners, async (req) => {
    rejectCrossOrgWrite(req, req.data.owning_organization_ID, req.user._appOrgId);
  });

  // ----- Status defaults + field validation for hierarchy entities -----

  srv.before(['CREATE', 'UPDATE'], ProductVariants, (req) => {
    if (req.event === 'CREATE' && !req.data.status) req.data.status = 'draft';
    const { weight_g } = req.data;
    if (weight_g != null && weight_g <= 0) {
      req.reject(400, 'Weight must be a positive number (in grams).');
    }
  });

  srv.before(['CREATE', 'UPDATE'], Batches, (req) => {
    const { co2_footprint_kg, recycled_content_pct } = req.data;
    if (co2_footprint_kg != null && co2_footprint_kg < 0) {
      req.reject(400, 'CO₂ footprint cannot be negative.');
    }
    if (recycled_content_pct != null && (recycled_content_pct < 0 || recycled_content_pct > 100)) {
      req.reject(400, 'Recycled content must be between 0 and 100 %.');
    }
  });

  // ----- BOM integrity: self-loop, quantity bounds, acyclic graph (US4.11) -----

  srv.before(['CREATE', 'UPDATE'], ProductBOMs, async (req) => {
    const { parent_ID, component_ID, component_name, quantity, unit,
            ext_co2_footprint, ext_recycled_content_pct } = req.data;

    // A line identifies its component either by an internal product (internal source)
    // or by a free-text name (external supplier component without an internal record).
    if (req.event === 'CREATE' && !component_ID && !component_name) {
      req.reject(400, 'A BOM line needs a component product or an external component name.');
    }

    let parentVariant = null;
    if (parent_ID) {
      const dbEntities = cds.entities('dpp');
      parentVariant = await SELECT.one.from(dbEntities.ProductVariants)
        .columns(['ID', 'product_ID'])
        .where({ ID: parent_ID });
      if (!parentVariant) {
        req.reject(400, 'The selected parent variant does not exist.');
      }
      await requireOwningOrg(req, 'Products', parentVariant.product_ID);
    }

    if (parentVariant && component_ID && parentVariant.product_ID === component_ID) {
      req.reject(400, 'A product cannot reference its own variant as a component.');
    }
    if (unit === '%' && quantity != null && (quantity <= 0 || quantity > 100)) {
      req.reject(400, 'Percentage share must be within (0, 100].');
    }
    if (quantity != null && quantity < 0) {
      req.reject(400, 'BOM quantity must not be negative.');
    }
    if (ext_co2_footprint != null && ext_co2_footprint < 0) {
      req.reject(400, 'CO₂ footprint cannot be negative.');
    }
    if (ext_recycled_content_pct != null && (ext_recycled_content_pct < 0 || ext_recycled_content_pct > 100)) {
      req.reject(400, 'Recycled content must be between 0 and 100 %.');
    }
    if (parentVariant && component_ID) {
      const dbEntities = cds.entities('dpp');
      const wouldCycle = await descendantsReach(
        component_ID, parentVariant.product_ID, dbEntities
      );
      if (wouldCycle) {
        req.reject(409, 'Adding this component would introduce a cycle in the BOM.');
      }
    }
  });

  // ----- Archive action -----

  srv.on('archiveProduct', Products, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    await requireOwningOrg(req, 'Products', id);

    await UPDATE(Products)
      .set({ status: 'archived' })
      .where({ ID: id });

    return SELECT.one.from(Products).where({ ID: id });
  });
};

module.exports.descendantsReach = descendantsReach;
