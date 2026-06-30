'use strict';

const { getUserOrg, requireOwningOrg } = require('./auth-helpers');

function rejectCrossOrgWrite(req, fieldValue, callerOrgId) {
  if (fieldValue !== undefined && fieldValue !== callerOrgId) {
    req.reject(403, 'Cannot assign marketing links to a different organization.');
  }
}

function checkValidWindow(req) {
  const { valid_from, valid_to } = req.data;
  if (valid_from && valid_to && valid_from > valid_to) {
    req.reject(400, 'The "valid from" date must not be after the "valid to" date.');
  }
}

// The link target and an external thumbnail must be real web URLs. An uploaded thumbnail
// (image_data) is a base64 data: URL and is intentionally not validated for format here.
function checkUrls(req) {
  const isWeb = (v) => /^https?:\/\//i.test(v);
  if (req.data.url && !isWeb(req.data.url)) {
    req.reject(400, 'The link URL must start with https:// (or http://).');
  }
  if (req.data.image_url && !isWeb(req.data.image_url)) {
    req.reject(400, 'The image URL must start with https:// (or http://).');
  }
}

module.exports = (srv) => {
  const { DPPMarketingLinks } = srv.entities;

  srv.before('CREATE', DPPMarketingLinks, async (req) => {
    if (!req.data.title) req.reject(400, 'A marketing link must have a title.');

    const org = await getUserOrg(req);
    rejectCrossOrgWrite(req, req.data.owning_organization_ID, org.ID);
    if (!req.data.owning_organization_ID) req.data.owning_organization_ID = org.ID;

    // A link may only be attached to one of the caller's own DPPs.
    if (req.data.dpp_ID) {
      await requireOwningOrg(req, 'DPPs', req.data.dpp_ID, 'product.owning_organization_ID');
    }

    checkValidWindow(req);
    checkUrls(req);
  });

  srv.before('UPDATE', DPPMarketingLinks, async (req) => {
    rejectCrossOrgWrite(req, req.data.owning_organization_ID, req.user._appOrgId);
    if (req.data.dpp_ID) {
      await requireOwningOrg(req, 'DPPs', req.data.dpp_ID, 'product.owning_organization_ID');
    }
    checkValidWindow(req);
    checkUrls(req);
  });

  // The central READ filter does not apply to DELETE, so verify ownership explicitly.
  srv.before('DELETE', DPPMarketingLinks, async (req) => {
    const last = req.params && req.params[req.params.length - 1];
    const id = last && typeof last === 'object' ? last.ID : last;
    if (id) await requireOwningOrg(req, 'DPPMarketingLinks', id, 'owning_organization_ID');
  });

  // NOTE: Marketing links are served LIVE on the consumer view (see
  // public-handler.js#overlayLive) and are deliberately decoupled from the DPP
  // version/drift lifecycle — a campaign edit no longer reverts approved/published
  // DPPs to draft. Hence no reevaluateDrift hooks here.
};
