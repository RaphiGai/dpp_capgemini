'use strict';

const cds = require('@sap/cds');
const { getUserOrg } = require('./auth-helpers');

/**
 * Walk the BOM graph downward from `startId`: is `targetId` reachable as a
 * descendant? Used to reject edges that would create a cycle (US4.11).
 */
async function descendantsReach(startId, targetId, ProductBOMs) {
  const visited = new Set();
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop();
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (cur === targetId) return true;
    const rows = await SELECT.from(ProductBOMs)
      .columns(['component_ID'])
      .where({ parent_ID: cur });
    for (const r of rows) stack.push(r.component_ID);
  }
  return false;
}

module.exports = (srv) => {
  const {
    Products, ProductVariants, Batches, ProductItems,
    ProductBOMs, BusinessPartners
  } = srv.entities;

  // ----- Tenant defaulting on CREATE -----

  srv.before('CREATE', Products, async (req) => {
    if (!req.data.owning_organization_ID) {
      const org = await getUserOrg(req);
      req.data.owning_organization_ID = org.ID;
    }
    if (!req.data.product_type) req.data.product_type = 'finished';
    if (!req.data.status) req.data.status = 'draft';
  });

  srv.before('CREATE', BusinessPartners, async (req) => {
    if (!req.data.owning_organization_ID) {
      const org = await getUserOrg(req);
      req.data.owning_organization_ID = org.ID;
    }
  });

  // ----- Status defaults for hierarchy entities -----

  srv.before('CREATE', ProductVariants, (req) => {
    if (!req.data.status) req.data.status = 'draft';
  });

  srv.before('CREATE', ProductItems, (req) => {
    if (!req.data.item_status) req.data.item_status = 'active';
    if (!req.data.created_date) req.data.created_date = new Date().toISOString().slice(0, 10);
  });

  // ----- BOM integrity: self-loop, quantity bounds, acyclic graph (US4.11) -----

  srv.before(['CREATE', 'UPDATE'], ProductBOMs, async (req) => {
    const { parent_ID, component_ID, quantity, unit } = req.data;

    if (parent_ID && component_ID && parent_ID === component_ID) {
      req.reject(400, 'A product cannot reference itself as a component.');
    }
    if (unit === '%' && quantity != null && (quantity <= 0 || quantity > 100)) {
      req.reject(400, 'Percentage share must be within (0, 100].');
    }
    if (quantity != null && quantity < 0) {
      req.reject(400, 'BOM quantity must not be negative.');
    }
    if (parent_ID && component_ID) {
      const dbEntities = cds.entities('dpp');
      const wouldCycle = await descendantsReach(
        component_ID, parent_ID, dbEntities.ProductBOMs
      );
      if (wouldCycle) {
        req.reject(409, 'Adding this component would introduce a cycle in the BOM.');
      }
    }
  });

  // ----- Archive action -----

  srv.on('archiveProduct', Products, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    const product = await SELECT.one.from(Products).where({ ID: id });
    if (!product) req.reject(404, `Product '${id}' not found.`);

    await UPDATE(Products)
      .set({ status: 'archived' })
      .where({ ID: id });

    return SELECT.one.from(Products).where({ ID: id });
  });
};

module.exports.descendantsReach = descendantsReach;
