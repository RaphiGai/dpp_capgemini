// Consumer-Persona: oeffentliche QR-Ansicht. Zeigt nur 'public' und ausgewaehlte Daten.

import { store, labelOf } from '../store.js';
import { html, raw, $, ICON, escapeHtml, formatDate, verificationBadge } from '../ui.js';

// ============ LIST (Demo: Auswahl der gescannten DPPs) ============
export function list() {
  const publicDpps = store.state.dpps.filter(d => d.status === 'published' && d.visibility === 'public');

  return `
    <div class="max-w-4xl mx-auto py-8">
      <h1 class="text-xl font-bold text-slate-900 mb-1">QR-Code gescannt</h1>
      <p class="text-sm text-slate-600 mb-6">In der echten Anwendung gelangt der Konsument durch Scan eines QR-Codes auf die DPP-Detailseite. Hier zur Demo eine Liste oeffentlich sichtbarer DPPs.</p>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${publicDpps.map(d => {
          const p = store.state.products.find(x => x.id === d.product_id);
          const org = store.state.organizations.find(x => x.id === d.issuing_organization_id);
          return `
            <a href="#/consumer/dpp/${d.id}" class="card-hover bg-white border border-slate-200 rounded-xl p-5 block">
              <div class="flex items-start gap-3">
                <div class="w-12 h-12 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">${ICON.qr}</div>
                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-slate-900">${escapeHtml(p?.name || '–')}</div>
                  <div class="text-xs text-slate-500">${escapeHtml(org?.trade_name || org?.legal_name)} &middot; Charge ${escapeHtml(d.batch_lot_number || '–')}</div>
                </div>
              </div>
            </a>
          `;
        }).join('') || '<div class="col-span-2 text-slate-500 italic">Keine oeffentlichen DPPs vorhanden.</div>'}
      </div>
    </div>
  `;
}

// ============ DETAIL (Konsumenten-Sicht) ============
export function detail(ctx) {
  const dpp = store.state.dpps.find(d => d.id === ctx.id);
  if (!dpp) return `<div class="text-slate-500">DPP nicht gefunden.</div>`;

  if (dpp.status !== 'published' || dpp.visibility !== 'public') {
    return `
      <div class="max-w-2xl mx-auto py-12 text-center">
        <div class="w-16 h-16 mx-auto rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mb-4">!</div>
        <h2 class="text-lg font-semibold text-slate-900">Dieser DPP ist nicht oeffentlich verfuegbar</h2>
        <p class="text-sm text-slate-600 mt-2">Status: ${escapeHtml(labelOf('dpp_status', dpp.status))} &middot; Sichtbarkeit: ${escapeHtml(labelOf('visibility', dpp.visibility))}</p>
      </div>
    `;
  }

  const product  = store.state.products.find(p => p.id === dpp.product_id);
  const org      = store.state.organizations.find(o => o.id === dpp.issuing_organization_id);
  const facility = store.state.facilities.find(f => f.id === dpp.facility_id);

  // Public docs only
  const publicDocs = dpp.documents.filter(d => d.visibility === 'public');

  return `
    <div class="max-w-3xl mx-auto py-6">
      <div class="bg-gradient-to-br from-brand-700 to-brand-800 text-white rounded-2xl p-6 mb-6 shadow-lg">
        <div class="flex items-start gap-4">
          <div class="w-16 h-16 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center text-white">${ICON.cube}</div>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-semibold tracking-wider uppercase opacity-80">Digital Product Passport</div>
            <h1 class="text-2xl font-bold mt-1">${escapeHtml(product?.name || '–')}</h1>
            <p class="text-sm opacity-90 mt-1">${escapeHtml(org?.trade_name || org?.legal_name)} &middot; Charge ${escapeHtml(dpp.batch_lot_number || '–')}</p>
          </div>
        </div>
      </div>

      <section class="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        <h2 class="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <span class="w-1.5 h-5 rounded-full bg-brand-500"></span> Materialien
        </h2>
        ${dpp.material_composition.length === 0 ? '<p class="text-sm text-slate-500 italic">Keine Daten.</p>' : `
          <div class="space-y-2">
            ${dpp.material_composition.map(m => `
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="w-8 h-2 bg-brand-100 rounded-full overflow-hidden">
                    <div class="h-full bg-brand-500" style="width:${Math.min(100, m.percentage)}%"></div>
                  </div>
                  <span class="font-medium text-slate-900">${escapeHtml(m.fiber_name)}</span>
                  <span class="text-xs text-slate-500">${escapeHtml(labelOf('material_class', m.material_class))}</span>
                  ${m.country_of_origin ? `<span class="text-xs text-slate-400">${escapeHtml(m.country_of_origin)}</span>` : ''}
                </div>
                <div class="font-semibold text-slate-900">${m.percentage}%</div>
              </div>
            `).join('')}
          </div>
        `}
      </section>

      <section class="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        <h2 class="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <span class="w-1.5 h-5 rounded-full bg-brand-500"></span> Herkunft &amp; Herstellung
        </h2>
        <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <dt class="text-slate-500">Hersteller</dt>
          <dd class="font-medium text-slate-900">${escapeHtml(org?.trade_name || org?.legal_name || '–')}</dd>
          <dt class="text-slate-500">Standort</dt>
          <dd class="font-medium text-slate-900">${escapeHtml(facility ? `${facility.name} (${facility.country_iso2})` : dpp.manufacturing_country_iso2 || '–')}</dd>
          <dt class="text-slate-500">Produktionszeitraum</dt>
          <dd class="font-medium text-slate-900">${formatDate(dpp.manufacturing_date_from)} – ${formatDate(dpp.manufacturing_date_to)}</dd>
          <dt class="text-slate-500">In Verkehr seit</dt>
          <dd class="font-medium text-slate-900">${formatDate(dpp.placed_on_market_date)}</dd>
        </dl>
      </section>

      <section class="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        <h2 class="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <span class="w-1.5 h-5 rounded-full bg-brand-500"></span> Compliance
        </h2>
        ${dpp.compliance_statements.length === 0 ? '<p class="text-sm text-slate-500 italic">Keine Compliance-Angaben.</p>' : `
          <div class="space-y-3">
            ${dpp.compliance_statements.map(c => `
              <div class="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
                <div class="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0">${ICON.shield}</div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-slate-900 text-sm">${escapeHtml(labelOf('compliance_standard', c.compliance_standard))}</span>
                    ${raw(verificationBadge(c.verification_status)).value}
                  </div>
                  <p class="text-sm text-slate-600 mt-0.5">${escapeHtml(c.statement_text)}</p>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </section>

      ${publicDocs.length ? `
        <section class="bg-white border border-slate-200 rounded-xl p-5 mb-4">
          <h2 class="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <span class="w-1.5 h-5 rounded-full bg-brand-500"></span> Belegdokumente
          </h2>
          <div class="space-y-2">
            ${publicDocs.map(d => `
              <a href="#" class="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50">
                <div class="w-8 h-8 rounded bg-slate-100 text-slate-600 flex items-center justify-center">${ICON.doc}</div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-slate-900">${escapeHtml(d.title)}</div>
                  <div class="text-xs text-slate-500">${escapeHtml(d.issuer || '–')} &middot; ${formatDate(d.issued_at)}</div>
                </div>
              </a>
            `).join('')}
          </div>
        </section>
      ` : ''}

      <div class="text-xs text-slate-500 text-center mt-6">
        DPP-ID <span class="font-mono">${escapeHtml(dpp.id)}</span> &middot; veroeffentlicht am ${formatDate(dpp.published_at)}
      </div>
    </div>
  `;
}
