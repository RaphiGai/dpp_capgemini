'use strict';

const cds = require('@sap/cds');
const { randomUUID } = require('crypto');

const { parseImportBuffer, validateRows, buildTemplateBuffer } = require('../lib/excel-templates');
const { getUserOrg } = require('./auth-helpers');

/**
 * Generic Excel import flow:
 *   1. parse the base64 XLSX into raw row objects
 *   2. validate against the template's column rules
 *   3. INSERT/UPSERT accepted rows into the target entity
 *
 * Returns the report DTO that the OData action exposes back to the caller.
 */
async function runImport(req, { templateName, entityName, base64, beforeInsertHook }) {
  if (!base64) req.reject(400, '`file` (base64-encoded XLSX) is required.');

  let parsed;
  try {
    parsed = parseImportBuffer(base64, templateName);
  } catch (e) {
    req.reject(400, `Could not parse Excel: ${e.message}`);
  }

  const { accepted, errors } = validateRows(parsed, templateName);

  const dbEntity = cds.entities('dpp')[entityName];
  const inserted = [];
  for (const row of accepted) {
    try {
      if (!row.ID) row.ID = randomUUID();
      if (beforeInsertHook) await beforeInsertHook(row, req);
      const exists = await SELECT.one.from(dbEntity).columns(['ID']).where({ ID: row.ID });
      if (exists) {
        await UPDATE(dbEntity).set(row).where({ ID: row.ID });
      } else {
        await INSERT.into(dbEntity).entries(row);
      }
      inserted.push(row.ID);
    } catch (e) {
      errors.push({ row: null, field: row.ID, message: `DB error: ${e.message}` });
    }
  }

  return {
    total: parsed.length,
    imported: inserted.length,
    rejected: parsed.length - inserted.length,
    errors
  };
}

module.exports = (srv) => {
  srv.on('importProducts', async (req) => runImport(req, {
    templateName: 'products',
    entityName: 'Products',
    base64: req.data.file,
    beforeInsertHook: async (row) => {
      if (!row.owning_organization_ID) {
        const org = await getUserOrg(req);
        row.owning_organization_ID = org.ID;
      }
      if (!row.product_type) row.product_type = 'finished';
      if (!row.status) row.status = 'draft';
    }
  }));

  srv.on('importBatches', async (req) => runImport(req, {
    templateName: 'batches',
    entityName: 'Batches',
    base64: req.data.file
  }));

  srv.on('importBOM', async (req) => runImport(req, {
    templateName: 'bom',
    entityName: 'ProductBOMs',
    base64: req.data.file,
    beforeInsertHook: async (row) => {
      if (row.is_mandatory != null && typeof row.is_mandatory === 'string') {
        row.is_mandatory = /^(true|yes|1)$/i.test(row.is_mandatory);
      }
    }
  }));

  srv.on('downloadTemplate', async (req) => {
    const name = req.data.template;
    try {
      const buf = buildTemplateBuffer(name);
      return { filename: `${name}-template.xlsx`, content_base64: buf.toString('base64') };
    } catch (e) {
      req.reject(400, e.message);
    }
  });
};
