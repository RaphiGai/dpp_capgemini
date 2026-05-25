'use strict';

const cds = require('@sap/cds');
const { renderDPPasPDF, renderQRLabel } = require('../lib/pdf-renderer');
const { buildSnapshot } = require('./dpp-handlers');

module.exports = (srv) => {
  const { DPPs } = srv.entities;

  // ----- exportDPPasPDF: returns base64 PDF (US7.17) -----
  srv.on('exportDPPasPDF', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);

    const snapshot = dpp.aggregated_snapshot
      ? JSON.parse(dpp.aggregated_snapshot)
      : await buildSnapshot(dpp);

    const pdfBuf = await renderDPPasPDF(snapshot);
    return { filename: `dpp-${id}.pdf`, content_base64: pdfBuf.toString('base64') };
  });

  // ----- generateQRLabel: printable PDF label (US6.13) -----
  srv.on('generateQRLabel', DPPs, async (req) => {
    const id = req.params[req.params.length - 1].ID;
    const { Products, ProductItems } = cds.entities('dpp');
    const dpp = await SELECT.one.from(DPPs).where({ ID: id });
    if (!dpp) req.reject(404, `DPP '${id}' not found.`);
    if (!dpp.qr_payload_url) req.reject(409, `DPP '${id}' has no QR payload URL — publish it first.`);

    const product = await SELECT.one.from(Products).where({ ID: dpp.product_ID });
    const item    = dpp.item_ID ? await SELECT.one.from(ProductItems).where({ ID: dpp.item_ID }) : null;

    const pdfBuf = await renderQRLabel({
      productName:   product?.name || 'Product',
      brand:         product?.brand,
      model:         product?.model,
      serialNumber:  item?.serial_number,
      upi:           item?.upi,
      qrPayloadUrl:  dpp.qr_payload_url
    });
    return { filename: `qr-label-${id}.pdf`, content_base64: pdfBuf.toString('base64') };
  });
};
