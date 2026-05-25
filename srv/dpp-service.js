'use strict';

// CAP auto-loads `srv/<service-name>.js` as the implementation for the matching
// service defined in `srv/<service-name>.cds`. Five handler modules cover the
// strict-catalogue MVP: product defaults & BOM guards → DPP workflow → Excel
// import/export → PDF + QR-label.
const productHandlers = require('./handlers/product-handlers');
const dppHandlers     = require('./handlers/dpp-handlers');
const importHandlers  = require('./handlers/import-handlers');
const exportHandlers  = require('./handlers/export-handlers');
const pdfHandlers     = require('./handlers/pdf-handlers');

module.exports = (srv) => {
  productHandlers(srv);
  dppHandlers(srv);
  importHandlers(srv);
  exportHandlers(srv);
  pdfHandlers(srv);
};
