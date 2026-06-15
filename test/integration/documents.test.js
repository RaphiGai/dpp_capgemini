'use strict';

// Product/batch documentation (certificates & proofs): native CAP media streaming,
// per-document visibility, tenant isolation, RBAC, MIME/size guards, and the
// token-protected public download.

const cds = require('@sap/cds');
const tokens = require('../../srv/lib/token');

const { GET, POST, DELETE, axios } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } }; // ORG-A advanced
const carol = { auth: { username: 'carol.user', password: 'x' } };     // ORG-A read-only
const dan   = { auth: { username: 'dan.advanced.b', password: 'x' } }; // ORG-B advanced

const PRODUCT = 'prod-tshirt-classic'; // ORG-A; behind published item DPP dpp-item-tshirt-0001
const PDF = Buffer.from('%PDF-1.4\nfake test certificate\n%%EOF', 'utf8');

const expectStatus = async (promise, status) => {
  try {
    await promise;
    throw new Error(`Expected status ${status}, but the request succeeded.`);
  } catch (err) {
    expect(err.response?.status || err.status || err.code).toBe(status);
  }
};

const putContent = (id, buf, mime, cfg) =>
  axios.put(`/odata/v4/dpp/Documents('${id}')/content`, buf, {
    headers: { 'Content-Type': mime },
    validateStatus: () => true,
    ...cfg
  });

async function attachToken(dppId) {
  const { DPPs } = cds.entities('dpp');
  const token = tokens.generate();
  await UPDATE(DPPs).set({ qr_token: token }).where({ ID: dppId });
  return token;
}

describe('Documents — create, upload, download', () => {
  test('CREATE applies defaults and stamps audit fields', async () => {
    const r = await POST(
      '/odata/v4/dpp/Documents',
      { ID: 'doc-t1', product_ID: PRODUCT, title: 'GOTS certificate', file_name: 'gots.pdf', mime_type: 'application/pdf', file_size: PDF.length },
      alice
    );
    expect(r.data.doc_type).toBe('certificate');
    expect(r.data.visibility).toBe('internal');
    expect(r.data.createdBy_ID).toBe('usr-alice');
    expect(r.data.createdAt).toBeTruthy();
  });

  test('PUT the binary, then GET it back with the right content type', async () => {
    const put = await putContent('doc-t1', PDF, 'application/pdf', alice);
    expect(put.status).toBeLessThan(300);

    const get = await axios.get('/odata/v4/dpp/Documents(\'doc-t1\')/content', {
      ...alice,
      responseType: 'arraybuffer',
      validateStatus: () => true
    });
    expect(get.status).toBe(200);
    expect(String(get.headers['content-type'])).toContain('application/pdf');
    expect(Buffer.from(get.data)).toEqual(PDF);
  });
});

describe('Documents — validation guards', () => {
  test('exactly one anchor: both product and batch → 400', async () => {
    await expectStatus(
      POST('/odata/v4/dpp/Documents', { ID: 'doc-both', product_ID: PRODUCT, batch_ID: 'batch-tshirt-0001', title: 'X' }, alice),
      400
    );
  });

  test('exactly one anchor: neither product nor batch → 400', async () => {
    await expectStatus(
      POST('/odata/v4/dpp/Documents', { ID: 'doc-none', title: 'X' }, alice),
      400
    );
  });

  test('disallowed MIME type on create → 415', async () => {
    await expectStatus(
      POST('/odata/v4/dpp/Documents', { ID: 'doc-mime', product_ID: PRODUCT, title: 'Zip', mime_type: 'application/zip' }, alice),
      415
    );
  });

  test('oversized declared file_size → 413', async () => {
    await expectStatus(
      POST('/odata/v4/dpp/Documents', { ID: 'doc-big', product_ID: PRODUCT, title: 'Huge', file_size: 21 * 1024 * 1024 }, alice),
      413
    );
  });

  test('a disallowed content type on the media PUT → 415', async () => {
    await POST('/odata/v4/dpp/Documents', { ID: 'doc-putmime', product_ID: PRODUCT, title: 'PutMime' }, alice);
    const put = await putContent('doc-putmime', Buffer.from('MZ'), 'application/x-msdownload', alice);
    expect(put.status).toBe(415);
  });
});

describe('Documents — RBAC + tenant isolation', () => {
  test('a read-only company_user cannot create documents → 403', async () => {
    await expectStatus(
      POST('/odata/v4/dpp/Documents', { ID: 'doc-carol', product_ID: PRODUCT, title: 'Nope' }, carol),
      403
    );
  });

  test('another org cannot attach to ORG-A products → 403', async () => {
    await expectStatus(
      POST('/odata/v4/dpp/Documents', { ID: 'doc-evil', product_ID: PRODUCT, title: 'Evil' }, dan),
      403
    );
  });

  test('another org never sees ORG-A documents in the list', async () => {
    const { data } = await GET('/odata/v4/dpp/Documents?$select=ID', dan);
    expect(data.value.every((d) => d.ID !== 'doc-t1')).toBe(true);
  });

  test('another org cannot delete an ORG-A document', async () => {
    await expectStatus(DELETE('/odata/v4/dpp/Documents(\'doc-t1\')', dan), 403);
  });
});

describe('Documents — public consumer access', () => {
  test('only public documents are listed and downloadable on the consumer DPP', async () => {
    // One public + one internal document on the same product.
    await POST('/odata/v4/dpp/Documents', { ID: 'doc-pub', product_ID: PRODUCT, title: 'Public cert', visibility: 'public', file_name: 'pub.pdf', mime_type: 'application/pdf', file_size: PDF.length }, alice);
    await putContent('doc-pub', PDF, 'application/pdf', alice);
    await POST('/odata/v4/dpp/Documents', { ID: 'doc-int', product_ID: PRODUCT, title: 'Internal cert', visibility: 'internal', file_name: 'int.pdf', mime_type: 'application/pdf', file_size: PDF.length }, alice);
    await putContent('doc-int', PDF, 'application/pdf', alice);

    const token = await attachToken('dpp-item-tshirt-0001');
    const { data } = await GET(`/public/dpp/${token}`);
    const titles = (data.documents ?? []).map((d) => d.title);
    expect(titles).toContain('Public cert');
    expect(titles).not.toContain('Internal cert');

    const pub = data.documents.find((d) => d.title === 'Public cert');
    expect(pub.download_url).toContain(`/public/dpp/${token}/documents/doc-pub`);

    // download_url is absolute (PUBLIC_BASE_URL); hit its path on the test server.
    const dlPath = pub.download_url.replace(/^https?:\/\/[^/]+/, '');
    const dl = await axios.get(dlPath, { responseType: 'arraybuffer', validateStatus: () => true });
    expect(dl.status).toBe(200);
    expect(String(dl.headers['content-type'])).toContain('application/pdf');
    expect(Buffer.from(dl.data)).toEqual(PDF);
  });

  test('an internal document is not downloadable via the public route → 404', async () => {
    const token = await attachToken('dpp-item-tshirt-0001');
    const r = await axios.get(`/public/dpp/${token}/documents/doc-int`, { validateStatus: () => true });
    expect(r.status).toBe(404);
  });

  test('a public document cannot be fetched through an unrelated DPP token → 404', async () => {
    const token = await attachToken('dpp-item-jacket-0001'); // different product
    const r = await axios.get(`/public/dpp/${token}/documents/doc-pub`, { validateStatus: () => true });
    expect(r.status).toBe(404);
  });
});

describe('Documents — delete', () => {
  test('the owner can delete their document', async () => {
    await POST('/odata/v4/dpp/Documents', { ID: 'doc-del', product_ID: PRODUCT, title: 'To delete' }, alice);
    const r = await DELETE('/odata/v4/dpp/Documents(\'doc-del\')', alice);
    expect(r.status).toBeLessThan(300);
  });
});
