'use strict';

const { randomUUID } = require('crypto');
const { getUserOrg } = require('./auth-helpers');

// ── Enum sets for validation ───────────────────────────────────────────────
const PRODUCT_TYPES    = new Set(['finished', 'material', 'component', 'packaging']);
const PRODUCT_STATUSES = new Set(['draft', 'published', 'archived']);
const ESPR_STATUSES    = new Set(['draft', 'in_review', 'compliant', 'non_compliant']);
const VARIANT_STATUSES = new Set(['active', 'inactive', 'archived']);
const BATCH_STATUSES   = new Set(['draft', 'approved', 'archived']);
const PARTNER_ROLES    = new Set([
  'supplier', 'manufacturer', 'recycler', 'certification_body',
  'distributor', 'retailer', 'logistics_provider'
]);
const PARTNER_STATUSES = new Set(['active', 'archived']);

// ── Small helpers ──────────────────────────────────────────────────────────

/** 1-indexed row number for user-facing messages */
const rowN = (i) => i + 1;

function str(v) {
  return v !== null && v !== undefined ? String(v).trim() : '';
}

function parseNum(v) {
  if (v === null || v === undefined || str(v) === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function parseRows(raw, req) {
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) req.reject(400, '"rows" must be a JSON array.');
    return rows;
  } catch {
    req.reject(400, '"rows" is not valid JSON.');
  }
}

/**
 * Collect a hard error (blocks this row from being created).
 * Returns false so callers can write: `if (!check(…)) continue;`
 */
function err(issues, i, field, message) {
  issues.push({ row: rowN(i), field, message, severity: 'error' });
}

/** Collect a soft warning (row is still created). */
function warn(issues, i, field, message) {
  issues.push({ row: rowN(i), field, message, severity: 'warning' });
}

function requireField(issues, i, field, value) {
  if (!str(value)) {
    err(issues, i, field, `"${field}" is required.`);
    return false;
  }
  return true;
}

function requireEnum(issues, i, field, value, validSet) {
  const v = str(value);
  if (v && !validSet.has(v)) {
    err(issues, i, field, `"${field}" must be one of: ${[...validSet].join(', ')}.`);
    return false;
  }
  return true;
}

function countHardErrors(issues, fromIdx) {
  return issues.slice(fromIdx).filter((e) => e.severity === 'error').length;
}

// ── Handler factory ────────────────────────────────────────────────────────

module.exports = (srv) => {
  const { Products, ProductVariants, Batches, ProductBOMs, BusinessPartners, BusinessPartnerRoles } = srv.entities;

  // ── importProducts ────────────────────────────────────────────────────────

  srv.on('importProducts', async (req) => {
    const { rows: rawJson, dryRun = false } = req.data;
    const org  = await getUserOrg(req);
    const now  = new Date().toISOString();
    const uid  = req.user._appUserId || null;
    const rows = parseRows(rawJson, req);

    // Pre-load existing product names to detect duplicates (case-insensitive).
    const existing = await SELECT.from(Products)
      .columns(['name'])
      .where({ owning_organization_ID: org.ID });
    const existingNames = new Set(existing.map((p) => p.name?.toLowerCase()));

    // Product category is curated master data (code list dpp.ProductCategories),
    // no longer a free string. Map the imported value to a known code
    // (case-insensitive) and write the foreign key `category_code`.
    const categoryRows = await SELECT.from('dpp.ProductCategories').columns('code');
    const categoryByLower = new Map(
      categoryRows.map((c) => [String(c.code).toLowerCase(), c.code])
    );

    const allIssues = [];
    const toInsert  = [];

    for (let i = 0; i < rows.length; i++) {
      const r         = rows[i];
      const issueBase = allIssues.length;

      requireField(allIssues, i, 'name',                  r.name);
      requireField(allIssues, i, 'brand',                 r.brand);
      requireField(allIssues, i, 'category',              r.category);
      const categoryCode = categoryByLower.get(str(r.category).toLowerCase()) || null;
      if (str(r.category) && !categoryCode)
        err(allIssues, i, 'category',
          `Unknown category "${str(r.category)}". Valid categories: ${[...categoryByLower.values()].join(', ') || '(none configured)'}.`);
      requireField(allIssues, i, 'product_type',          r.product_type);
      requireEnum (allIssues, i, 'product_type',          r.product_type,  PRODUCT_TYPES);
      requireField(allIssues, i, 'status',                r.status);
      requireEnum (allIssues, i, 'status',                r.status,        PRODUCT_STATUSES);
      requireField(allIssues, i, 'country_of_origin',     r.country_of_origin);
      requireField(allIssues, i, 'fibre_composition',     r.fibre_composition);
      requireField(allIssues, i, 'care_instructions',     r.care_instructions);
      requireField(allIssues, i, 'repair_instructions',   r.repair_instructions);
      requireField(allIssues, i, 'disposal_instructions', r.disposal_instructions);
      requireField(allIssues, i, 'substances_of_concern', r.substances_of_concern);
      requireField(allIssues, i, 'espr_compliance',       r.espr_compliance);
      requireEnum (allIssues, i, 'espr_compliance',       r.espr_compliance, ESPR_STATUSES);

      const dur = parseNum(r.durability_score);
      if (dur !== null && (dur < 0 || dur > 10))
        err(allIssues, i, 'durability_score', 'Durability score must be between 0 and 10.');

      const rep = parseNum(r.repairability_score);
      if (rep !== null && (rep < 0 || rep > 10))
        err(allIssues, i, 'repairability_score', 'Repairability score must be between 0 and 10.');

      const name = str(r.name);
      if (name && existingNames.has(name.toLowerCase()))
        err(allIssues, i, 'name', `A product named "${name}" already exists — skipped.`);

      if (countHardErrors(allIssues, issueBase) === 0) {
        toInsert.push({
          ID:                    randomUUID(),
          owning_organization_ID: org.ID,
          name,
          brand:                 str(r.brand),
          category_code:         categoryCode,
          product_type:          str(r.product_type),
          model:                 str(r.model)              || null,
          gtin:                  str(r.gtin)               || null,
          upc:                   str(r.upc)                || null,
          ein:                   str(r.ein)                || null,
          status:                str(r.status),
          country_of_origin:     str(r.country_of_origin).toUpperCase().slice(0, 2),
          description:           str(r.description)        || null,
          fibre_composition:     str(r.fibre_composition),
          care_instructions:     str(r.care_instructions),
          repair_instructions:   str(r.repair_instructions),
          disposal_instructions: str(r.disposal_instructions),
          reuse_instructions:    str(r.reuse_instructions)  || null,
          substances_of_concern: str(r.substances_of_concern),
          espr_compliance:       str(r.espr_compliance),
          durability_score:      dur,
          repairability_score:   rep,
          storytelling:          str(r.storytelling)        || null,
          care_video_url:        str(r.care_video_url)      || null,
          repair_video_url:      str(r.repair_video_url)    || null,
          disposal_video_url:    str(r.disposal_video_url)  || null,
          reuse_video_url:       str(r.reuse_video_url)     || null,
          care_products_url:     str(r.care_products_url)     || null,
          repair_products_url:   str(r.repair_products_url)   || null,
          reuse_products_url:    str(r.reuse_products_url)    || null,
          disposal_products_url: str(r.disposal_products_url) || null,
          createdAt:    now,
          lastChange:   now,
          createdBy_ID: uid,
          changedBy_ID: uid,
        });
      }
    }

    if (!dryRun && toInsert.length > 0) {
      await INSERT.into(Products).entries(toInsert);
    }

    return {
      total:   rows.length,
      created: dryRun ? 0 : toInsert.length,
      skipped: rows.length - toInsert.length,
      errors:  JSON.stringify(allIssues),
    };
  });

  // ── importBatches ─────────────────────────────────────────────────────────

  srv.on('importBatches', async (req) => {
    const { rows: rawJson, dryRun = false } = req.data;
    const org  = await getUserOrg(req);
    const now  = new Date().toISOString();
    const uid  = req.user._appUserId || null;
    const rows = parseRows(rawJson, req);

    // Pre-load products for this org.
    const products = await SELECT.from(Products)
      .columns(['ID', 'name'])
      .where({ owning_organization_ID: org.ID });
    const productByName = new Map(products.map((p) => [p.name?.toLowerCase(), p]));

    // Pre-load variants for these products.
    let variants = [];
    if (products.length) {
      variants = await SELECT.from(ProductVariants)
        .columns(['ID', 'product_ID', 'sku'])
        .where({ product_ID: { in: products.map((p) => p.ID) } });
    }
    const variantKey = (pid, sku) => `${pid}:${sku?.toLowerCase()}`;
    const variantByKey = new Map(variants.map((v) => [variantKey(v.product_ID, v.sku), v]));

    // Pre-load business partners for name → ID lookup.
    const partners = await SELECT.from(BusinessPartners)
      .columns(['ID', 'name'])
      .where({ owning_organization_ID: org.ID });
    const partnerByName = new Map(partners.map((p) => [p.name?.toLowerCase(), p]));

    // Pre-load existing batch numbers to catch duplicates.
    let existingBatches = [];
    if (variants.length) {
      existingBatches = await SELECT.from(Batches)
        .columns(['batch_number', 'variant_ID'])
        .where({ variant_ID: { in: variants.map((v) => v.ID) } });
    }
    const existingBatchKeys = new Set(
      existingBatches.map((b) => `${b.variant_ID}:${b.batch_number?.toLowerCase()}`)
    );

    const allIssues = [];
    const toInsert  = [];

    for (let i = 0; i < rows.length; i++) {
      const r         = rows[i];
      const issueBase = allIssues.length;

      requireField(allIssues, i, 'product_name', r.product_name);
      requireField(allIssues, i, 'variant_sku',  r.variant_sku);
      requireField(allIssues, i, 'batch_number', r.batch_number);

      const productName = str(r.product_name);
      const product     = productByName.get(productName.toLowerCase());
      if (productName && !product)
        err(allIssues, i, 'product_name', `Product "${productName}" not found in your organisation.`);

      const sku     = str(r.variant_sku);
      const variant = product ? variantByKey.get(variantKey(product.ID, sku)) : null;
      if (product && sku && !variant)
        err(allIssues, i, 'variant_sku', `Variant with SKU "${sku}" not found for product "${productName}".`);

      const batchNum = str(r.batch_number);
      if (batchNum.length > 40)
        err(allIssues, i, 'batch_number', 'Batch number must not exceed 40 characters.');
      if (variant && batchNum && existingBatchKeys.has(`${variant.ID}:${batchNum.toLowerCase()}`))
        err(allIssues, i, 'batch_number', `Batch "${batchNum}" already exists for this variant — skipped.`);

      const co2 = parseNum(r.co2_footprint_kg);
      if (co2 !== null && co2 < 0)
        err(allIssues, i, 'co2_footprint_kg', 'CO₂ footprint cannot be negative.');

      const recycled = parseNum(r.recycled_content_pct);
      if (recycled !== null && (recycled < 0 || recycled > 100))
        err(allIssues, i, 'recycled_content_pct', 'Recycled content must be between 0 and 100.');

      const statusVal = str(r.status) || 'draft';
      requireEnum(allIssues, i, 'status', statusVal, BATCH_STATUSES);

      // Factory / supplier — optional; not found is a warning (batch still created).
      const factoryName = str(r.factory_name);
      let factoryId     = null;
      if (factoryName) {
        const bp = partnerByName.get(factoryName.toLowerCase());
        if (!bp) warn(allIssues, i, 'factory_name', `Business partner "${factoryName}" not found — factory not linked.`);
        else factoryId = bp.ID;
      }

      const supplierName = str(r.supplier_name);
      let supplierId     = null;
      if (supplierName) {
        const bp = partnerByName.get(supplierName.toLowerCase());
        if (!bp) warn(allIssues, i, 'supplier_name', `Business partner "${supplierName}" not found — supplier not linked.`);
        else supplierId = bp.ID;
      }

      if (countHardErrors(allIssues, issueBase) === 0 && variant) {
        toInsert.push({
          ID:                  randomUUID(),
          variant_ID:          variant.ID,
          batch_number:        batchNum,
          production_date:     str(r.production_date) || null,
          country_of_origin:   str(r.country_of_origin).toUpperCase().slice(0, 2) || null,
          production_stage:    str(r.production_stage)  || null,
          factory_ID:          factoryId,
          supplier_ID:         supplierId,
          co2_footprint_kg:    co2,
          recycled_content_pct: recycled,
          status:              statusVal,
          createdAt:    now,
          lastChange:   now,
          createdBy_ID: uid,
          changedBy_ID: uid,
        });
      }
    }

    if (!dryRun && toInsert.length > 0) {
      await INSERT.into(Batches).entries(toInsert);
    }

    return {
      total:   rows.length,
      created: dryRun ? 0 : toInsert.length,
      skipped: rows.length - toInsert.length,
      errors:  JSON.stringify(allIssues),
    };
  });

  // ── importBOM ─────────────────────────────────────────────────────────────

  srv.on('importBOM', async (req) => {
    const { rows: rawJson, dryRun = false } = req.data;
    const org  = await getUserOrg(req);
    const now  = new Date().toISOString();
    const uid  = req.user._appUserId || null;
    const rows = parseRows(rawJson, req);

    // Pre-load products + variants for this org.
    const products = await SELECT.from(Products)
      .columns(['ID', 'name'])
      .where({ owning_organization_ID: org.ID });
    const productByName = new Map(products.map((p) => [p.name?.toLowerCase(), p]));

    let variants = [];
    if (products.length) {
      variants = await SELECT.from(ProductVariants)
        .columns(['ID', 'product_ID', 'sku'])
        .where({ product_ID: { in: products.map((p) => p.ID) } });
    }
    const variantKey = (pid, sku) => `${pid}:${sku?.toLowerCase()}`;
    const variantByKey = new Map(variants.map((v) => [variantKey(v.product_ID, v.sku), v]));

    // Pre-load existing BOM edges to detect duplicates.
    let existingEdges = [];
    if (variants.length) {
      existingEdges = await SELECT.from(ProductBOMs)
        .columns(['parent_ID', 'component_ID', 'component_name'])
        .where({ parent_ID: { in: variants.map((v) => v.ID) } });
    }
    const edgeKey = (parentId, compRef) => `${parentId}:${compRef?.toLowerCase()}`;
    const existingEdgeKeys = new Set(
      existingEdges.map((e) => edgeKey(e.parent_ID, e.component_ID || e.component_name || ''))
    );

    const allIssues = [];
    const toInsert  = [];

    for (let i = 0; i < rows.length; i++) {
      const r         = rows[i];
      const issueBase = allIssues.length;

      requireField(allIssues, i, 'parent_product_name', r.parent_product_name);
      requireField(allIssues, i, 'parent_variant_sku',  r.parent_variant_sku);
      requireField(allIssues, i, 'quantity',            r.quantity);
      requireField(allIssues, i, 'unit',                r.unit);

      const parentProductName = str(r.parent_product_name);
      const parentProduct     = productByName.get(parentProductName.toLowerCase());
      if (parentProductName && !parentProduct)
        err(allIssues, i, 'parent_product_name', `Product "${parentProductName}" not found.`);

      const parentSku     = str(r.parent_variant_sku);
      const parentVariant = parentProduct
        ? variantByKey.get(variantKey(parentProduct.ID, parentSku))
        : null;
      if (parentProduct && parentSku && !parentVariant)
        err(allIssues, i, 'parent_variant_sku', `Variant "${parentSku}" not found in product "${parentProductName}".`);

      // Component: look up internal product; fall back to external name if not found.
      const compName    = str(r.component_product_name);
      const compProduct = compName ? productByName.get(compName.toLowerCase()) : null;
      if (compName && !compProduct)
        // Treat as external component name — warn so the user knows it won't link internally.
        warn(allIssues, i, 'component_product_name',
          `Product "${compName}" not found — will be recorded as an external component.`);

      if (!compName && !str(r.external_dpp_url))
        err(allIssues, i, 'component_product_name',
          'Provide a component product name or an external DPP URL.');

      const qty = parseNum(r.quantity);
      if (qty === null) err(allIssues, i, 'quantity', 'Quantity must be a valid number.');
      else if (qty < 0) err(allIssues, i, 'quantity', 'Quantity must not be negative.');

      const co2      = parseNum(r.co2_footprint_kg);
      const recycled = parseNum(r.recycled_content_pct);
      if (co2 !== null && co2 < 0)
        err(allIssues, i, 'co2_footprint_kg', 'CO₂ footprint cannot be negative.');
      if (recycled !== null && (recycled < 0 || recycled > 100))
        err(allIssues, i, 'recycled_content_pct', 'Recycled content must be 0–100.');

      // Duplicate edge check.
      const compRef = compProduct ? compProduct.ID : compName;
      if (parentVariant && compRef) {
        if (existingEdgeKeys.has(edgeKey(parentVariant.ID, compRef)))
          err(allIssues, i, 'component_product_name', 'This BOM edge already exists — skipped.');
      }

      if (countHardErrors(allIssues, issueBase) === 0 && parentVariant) {
        toInsert.push({
          ID:                      randomUUID(),
          parent_ID:               parentVariant.ID,
          component_ID:            compProduct ? compProduct.ID : null,
          component_name:          !compProduct && compName ? compName : null,
          component_role:          str(r.component_role) || null,
          quantity:                qty,
          unit:                    str(r.unit),
          external_dpp_url:        str(r.external_dpp_url) || null,
          ext_co2_footprint:       co2,
          ext_recycled_content_pct: recycled,
          status:                  'active',
          createdAt:    now,
          lastChange:   now,
          createdBy_ID: uid,
          changedBy_ID: uid,
        });
      }
    }

    if (!dryRun && toInsert.length > 0) {
      await INSERT.into(ProductBOMs).entries(toInsert);
    }

    return {
      total:   rows.length,
      created: dryRun ? 0 : toInsert.length,
      skipped: rows.length - toInsert.length,
      errors:  JSON.stringify(allIssues),
    };
  });

  // ── importVariants ────────────────────────────────────────────────────────

  srv.on('importVariants', async (req) => {
    const { rows: rawJson, dryRun = false } = req.data;
    const org  = await getUserOrg(req);
    const now  = new Date().toISOString();
    const uid  = req.user._appUserId || null;
    const rows = parseRows(rawJson, req);

    // Pre-load products for this org.
    const products = await SELECT.from(Products)
      .columns(['ID', 'name'])
      .where({ owning_organization_ID: org.ID });
    const productByName = new Map(products.map((p) => [p.name?.toLowerCase(), p]));

    // Pre-load existing variant SKUs to detect duplicates.
    let existingVariants = [];
    if (products.length) {
      existingVariants = await SELECT.from(ProductVariants)
        .columns(['sku', 'product_ID'])
        .where({ product_ID: { in: products.map((p) => p.ID) } });
    }
    const existingSkuKeys = new Set(
      existingVariants.map((v) => `${v.product_ID}:${v.sku?.toLowerCase()}`)
    );

    const allIssues = [];
    const toInsert  = [];

    for (let i = 0; i < rows.length; i++) {
      const r         = rows[i];
      const issueBase = allIssues.length;

      requireField(allIssues, i, 'product_name', r.product_name);
      requireField(allIssues, i, 'sku',          r.sku);

      const statusVal = str(r.status) || 'active';
      requireEnum(allIssues, i, 'status', statusVal, VARIANT_STATUSES);

      const productName = str(r.product_name);
      const product     = productByName.get(productName.toLowerCase());
      if (productName && !product)
        err(allIssues, i, 'product_name', `Product "${productName}" not found.`);

      const sku     = str(r.sku);
      const weightG = parseNum(r.weight_g);
      if (weightG !== null && weightG <= 0)
        err(allIssues, i, 'weight_g', 'Weight must be a positive number (grams).');

      if (product && sku && existingSkuKeys.has(`${product.ID}:${sku.toLowerCase()}`))
        err(allIssues, i, 'sku', `Variant with SKU "${sku}" already exists for product "${productName}".`);

      if (countHardErrors(allIssues, issueBase) === 0 && product) {
        toInsert.push({
          ID:           randomUUID(),
          product_ID:   product.ID,
          sku,
          color:        str(r.color)  || null,
          size:         str(r.size)   || null,
          gtin:         str(r.gtin)   || null,
          weight_g:     weightG !== null ? Math.round(weightG) : null,
          status:       statusVal,
          createdAt:    now,
          lastChange:   now,
          createdBy_ID: uid,
          changedBy_ID: uid,
        });
      }
    }

    if (!dryRun && toInsert.length > 0) {
      await INSERT.into(ProductVariants).entries(toInsert);
    }

    return {
      total:   rows.length,
      created: dryRun ? 0 : toInsert.length,
      skipped: rows.length - toInsert.length,
      errors:  JSON.stringify(allIssues),
    };
  });

  // ── importBusinessPartners ────────────────────────────────────────────────

  srv.on('importBusinessPartners', async (req) => {
    const { rows: rawJson, dryRun = false } = req.data;
    const org  = await getUserOrg(req);
    const now  = new Date().toISOString();
    const uid  = req.user._appUserId || null;
    const rows = parseRows(rawJson, req);

    // Pre-load existing BP names for duplicate detection.
    const existing = await SELECT.from(BusinessPartners)
      .columns(['name'])
      .where({ owning_organization_ID: org.ID });
    const existingNames = new Set(existing.map((p) => p.name?.toLowerCase()));

    const allIssues = [];
    const toInsert  = []; // [{bp: {...}, roles: string[]}]

    for (let i = 0; i < rows.length; i++) {
      const r         = rows[i];
      const issueBase = allIssues.length;

      requireField(allIssues, i, 'name',         r.name);
      requireField(allIssues, i, 'country_iso2',  r.country_iso2);
      requireField(allIssues, i, 'roles',         r.roles);

      const name = str(r.name);
      if (name && existingNames.has(name.toLowerCase()))
        err(allIssues, i, 'name', `A business partner named "${name}" already exists — skipped.`);

      // Parse and validate comma-separated roles.
      const rawRoles = str(r.roles).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (rawRoles.length === 0)
        err(allIssues, i, 'roles', 'At least one role is required.');
      const badRoles = rawRoles.filter((ro) => !PARTNER_ROLES.has(ro));
      if (badRoles.length > 0)
        err(allIssues, i, 'roles',
          `Unknown role(s): ${badRoles.join(', ')}. Valid: ${[...PARTNER_ROLES].join(', ')}.`);

      const statusVal = str(r.status) || 'active';
      requireEnum(allIssues, i, 'status', statusVal, PARTNER_STATUSES);

      if (countHardErrors(allIssues, issueBase) === 0) {
        toInsert.push({
          bp: {
            ID:                     randomUUID(),
            owning_organization_ID: org.ID,
            name,
            country_iso2:   str(r.country_iso2).toUpperCase().slice(0, 2),
            city:           str(r.city)           || null,
            address:        str(r.address)        || null,
            contact_person: str(r.contact_person) || null,
            contact_email:  str(r.contact_email)  || null,
            identifier:     str(r.identifier)     || null,
            archived:       statusVal === 'archived',
            createdAt:    now,
            lastChange:   now,
            createdBy_ID: uid,
            changedBy_ID: uid,
          },
          roles: rawRoles,
        });
      }
    }

    if (!dryRun && toInsert.length > 0) {
      await INSERT.into(BusinessPartners).entries(toInsert.map((r) => r.bp));
      const roleRows = toInsert.flatMap(({ bp, roles }) =>
        roles.map((role) => ({ ID: randomUUID(), partner_ID: bp.ID, role }))
      );
      if (roleRows.length) await INSERT.into(BusinessPartnerRoles).entries(roleRows);
    }

    return {
      total:   rows.length,
      created: dryRun ? 0 : toInsert.length,
      skipped: rows.length - toInsert.length,
      errors:  JSON.stringify(allIssues),
    };
  });
};
