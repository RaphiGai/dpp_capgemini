'use strict';

const cds = require('@sap/cds');

function rowsToXlsxBase64(rows, sheetName = 'Sheet1') {
  const xlsx = require('xlsx');
  const sheet = rows.length
    ? xlsx.utils.json_to_sheet(rows)
    : xlsx.utils.aoa_to_sheet([['(no rows)']]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, sheet, sheetName);
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64');
}

module.exports = (srv) => {
  srv.on('exportProducts', async () => {
    const { Products } = cds.entities('dpp');
    const rows = await SELECT.from(Products);
    return { filename: 'products.xlsx', content_base64: rowsToXlsxBase64(rows, 'Products') };
  });

  srv.on('exportBOM', async () => {
    const { ProductBOMs } = cds.entities('dpp');
    const rows = await SELECT.from(ProductBOMs);
    return { filename: 'product-bom.xlsx', content_base64: rowsToXlsxBase64(rows, 'ProductBOMs') };
  });

  srv.on('exportDPP', async (req) => {
    const id = req.data.dppId;
    if (!id) req.reject(400, 'dppId is required.');
    const { DPPs } = cds.entities('dpp');
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);
    return { filename: `dpp-${id}.xlsx`, content_base64: rowsToXlsxBase64([dpp], 'DPP') };
  });

  srv.on('exportDPPs', async (req) => {
    const { DPPs } = cds.entities('dpp');
    const filterIds = (req.data.dppIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    const rows = filterIds.length
      ? await SELECT.from(DPPs).where({ ID: { in: filterIds } })
      : await SELECT.from(DPPs);
    return { filename: 'dpps.xlsx', content_base64: rowsToXlsxBase64(rows, 'DPPs') };
  });

  // Product → Variant → Batch → Item → BOM (Sheet 5 hierarchy)
  srv.on('exportTraceability', async () => {
    const { Products, ProductVariants, Batches, ProductItems, ProductBOMs } = cds.entities('dpp');
    const [products, variants, batches, items, bom] = await Promise.all([
      SELECT.from(Products),
      SELECT.from(ProductVariants),
      SELECT.from(Batches),
      SELECT.from(ProductItems),
      SELECT.from(ProductBOMs)
    ]);
    const xlsx = require('xlsx');
    const wb = xlsx.utils.book_new();
    const addSheet = (rows, name) =>
      xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows.length ? rows : [{ note: 'no rows' }]), name);
    addSheet(products, 'Products');
    addSheet(variants, 'Variants');
    addSheet(batches, 'Batches');
    addSheet(items, 'Items');
    addSheet(bom, 'BOM');
    return {
      filename: 'traceability.xlsx',
      content_base64: xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64')
    };
  });
};
