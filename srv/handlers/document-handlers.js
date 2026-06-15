'use strict';

const cds = require('@sap/cds');
const { requireOwningOrg } = require('./auth-helpers');

// Mirrors the frontend allowlist + limit (DocumentManager). Fixed per the
// approved plan: PDF, PNG, JPEG, max 20 MB.
const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const MAX_BYTES = 20 * 1024 * 1024;

// Batch tenant anchor — same path the central read filter / product-item handler use.
const BATCH_OWNER_PATH = 'variant.product.owning_organization_ID';

/** Pull the instance key from a CAP request's params (last segment), object or scalar. */
function keyFromReq(req) {
  const last = req.params && req.params[req.params.length - 1];
  if (last == null) return null;
  return typeof last === 'object' ? last.ID : last;
}

/** Verify the document referenced by `id` belongs to the caller's organization. */
async function guardExistingOwner(req, id) {
  const { Documents } = cds.entities('dpp');
  const row = await SELECT.one.from(Documents).columns('product_ID', 'batch_ID').where({ ID: id });
  if (!row) req.reject(404, 'Document not found.');
  if (row.product_ID) await requireOwningOrg(req, 'Products', row.product_ID);
  else if (row.batch_ID) await requireOwningOrg(req, 'Batches', row.batch_ID, BATCH_OWNER_PATH);
}

/** Verify any product/batch target named in req.data is owned by the caller. */
async function guardTargetOwner(req) {
  if (req.data.product_ID) await requireOwningOrg(req, 'Products', req.data.product_ID);
  if (req.data.batch_ID) await requireOwningOrg(req, 'Batches', req.data.batch_ID, BATCH_OWNER_PATH);
}

module.exports = (srv) => {
  const { Documents } = srv.entities;

  // CREATE: exactly one anchor (product XOR batch), owned by the caller, with defaults.
  srv.before('CREATE', Documents, async (req) => {
    const { product_ID, batch_ID } = req.data;
    if (!!product_ID === !!batch_ID) {
      req.reject(400, 'A document must reference exactly one product OR one batch.');
    }
    await guardTargetOwner(req);
    if (!req.data.doc_type) req.data.doc_type = 'certificate';
    if (req.data.visibility === undefined) req.data.visibility = 'internal';
  });

  // UPDATE: covers metadata PATCH AND the media-stream PUT (which CAP routes here as
  // an UPDATE on Documents(ID)). Guard the existing owner, plus any new target if the
  // document is being re-pointed to a different product/batch.
  srv.before('UPDATE', Documents, async (req) => {
    const id = keyFromReq(req);
    if (id) await guardExistingOwner(req, id);
    await guardTargetOwner(req);
  });

  // MIME + size validation. On a metadata write the MIME comes from req.data.mime_type;
  // on the media-stream PUT (which CAP does NOT surface in req.data) it comes from the
  // request Content-Type. Content-Length additionally caps the raw upload bytes.
  srv.before(['CREATE', 'UPDATE'], Documents, (req) => {
    const httpReq = (req.http && req.http.req) || (req._ && req._.req) || null;
    const url = httpReq ? (httpReq.originalUrl || httpReq.url || '') : '';
    const isMediaPut = httpReq && httpReq.method === 'PUT' && /\/content(\/\$value)?(\?.*)?$/i.test(url);

    const rawMime = isMediaPut
      ? (httpReq.headers['content-type'] || '')
      : (req.data.mime_type || '');
    const mime = String(rawMime).split(';')[0].trim().toLowerCase();
    if (mime && !ALLOWED_MIME.has(mime)) {
      req.reject(415, 'Unsupported file type. Allowed: PDF, PNG, JPEG.');
    }

    const declared = Number(req.data.file_size);
    if (declared && declared > MAX_BYTES) {
      req.reject(413, 'File too large (max 20 MB).');
    }
    const len = Number((req.headers && req.headers['content-length']) || (httpReq && httpReq.headers['content-length']));
    if (len && len > MAX_BYTES) {
      req.reject(413, 'File too large (max 20 MB).');
    }
  });

  // DELETE: the central read OR-filter does not apply to DELETE, so guard explicitly.
  // Removing the row drops the BLOB with it.
  srv.before('DELETE', Documents, async (req) => {
    const id = keyFromReq(req);
    if (id) await guardExistingOwner(req, id);
  });
};
