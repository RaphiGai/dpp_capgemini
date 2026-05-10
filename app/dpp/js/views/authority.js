// Authority-Persona: Marktaufsicht. Sieht ALLE Daten inkl. internal/restricted.

import { store, labelOf } from '../store.js';
import { html, raw, $, ICON, escapeHtml, formatDate, formatDateTime,
         statusBadge, visibilityBadge, verificationBadge } from '../ui.js';

// ============ DASHBOARD ============
export function dashboard() {
  const s = store.state;
  const dpps = [...s.dpps].sort((a,b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  const total = dpps.length;
  const published = dpps.filter(d => d.status === 'published').length;
  const drafts = dpps.filter(d => d.status === 'draft').length;
  const declared = dpps.filter(d => d.verification_status === 'declared').length;

  const rows = dpps.map(d => {
    const p = s.products.find(x => x.id === d.product_id);
    const o = s.organizations.find(x => x.id === d.issuing_organization_id);
    const cmpStandards = (d.compliance_statements || []).map(c => labelOf('compliance_standard', c.compliance_standard)).join(', ');
    return `
      <tr class="hover:bg-slate-50">
        <td class="px-4 py-3 font-mono text-xs text-slate-700">${escapeHtml(d.id)}</td>
        <td class="px-4 py-3 font-medium text-slate-900">${escapeHtml(p?.name || '–')}</td>
        <td class="px-4 py-3 text-slate-700">${escapeHtml(o?.trade_name || o?.legal_name || '–')}</td>
        <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(d.gtin)}<br>${escapeHtml(d.batch_lot_number || d.serial_number || '')}</td>
        <td class="px-4 py-3">${raw(statusBadge(d.status)).value}</td>
        <td class="px-4 py-3">${raw(verificationBadge(d.verification_status)).value}</td>
        <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(cmpStandards) || '<span class="italic text-slate-400">keine</span>'}</td>
        <td class="px-4 py-3 text-right">
          <a href="#/authority/dpp/${d.id}" class="btn btn-secondary !text-xs">Pruefen</a>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="flex items-end justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-slate-900">Marktaufsicht</h1>
        <p class="text-sm text-slate-600 mt-1">Behoerdenseitiger Zugriff auf alle DPPs des Subaccounts.</p>
      </div>
      <div class="text-xs text-slate-500 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-md">
        <strong>Hinweis:</strong> In der echten Anwendung greift die Behoerde nur auf gewaehrte DPPs zu (siehe <code>dpp_authority_grant</code>).
      </div>
    </div>

    <div class="grid grid-cols-4 gap-4 mb-6">
      ${kpi('Gesamt-DPPs', total, 'bg-slate-100 text-slate-700')}
      ${kpi('Veroeffentlicht', published, 'bg-emerald-50 text-emerald-700')}
      ${kpi('Entwuerfe', drafts, 'bg-amber-50 text-amber-700')}
      ${kpi('Nur selbsterklaert', declared, 'bg-red-50 text-red-700')}
    </div>

    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="text-left px-4 py-3">DPP-ID</th>
            <th class="text-left px-4 py-3">Produkt</th>
            <th class="text-left px-4 py-3">Hersteller</th>
            <th class="text-left px-4 py-3">GTIN / Charge</th>
            <th class="text-left px-4 py-3">Status</th>
            <th class="text-left px-4 py-3">Verifikation</th>
            <th class="text-left px-4 py-3">Compliance</th>
            <th></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">${rows || `<tr><td colspan="8" class="px-4 py-12 text-center text-slate-500">Keine DPPs.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function kpi(label, value, classes) {
  return `
    <div class="bg-white border border-slate-200 rounded-xl p-4">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg ${classes} flex items-center justify-center">${ICON.shield}</div>
        <div>
          <div class="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">${label}</div>
          <div class="text-xl font-bold text-slate-900">${value}</div>
        </div>
      </div>
    </div>
  `;
}

// ============ DETAIL ============
export function detail(ctx) {
  const dpp = store.state.dpps.find(d => d.id === ctx.id);
  if (!dpp) return `<div class="text-slate-500">DPP nicht gefunden.</div>`;

  const product = store.state.products.find(p => p.id === dpp.product_id);
  const org     = store.state.organizations.find(o => o.id === dpp.issuing_organization_id);
  const facility= store.state.facilities.find(f => f.id === dpp.facility_id);

  return `
    <div class="flex items-center gap-2 mb-2 text-sm text-slate-500">
      <a href="#/authority" class="hover:underline">Marktaufsicht</a>
      <span>/</span>
      <span class="font-mono">${escapeHtml(dpp.id)}</span>
    </div>

    <div class="flex items-end justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-slate-900">${escapeHtml(product?.name || '–')}</h1>
        <div class="flex items-center gap-2 mt-2">
          ${raw(statusBadge(dpp.status)).value}
          ${raw(visibilityBadge(dpp.visibility)).value}
          ${raw(verificationBadge(dpp.verification_status)).value}
          <span class="text-xs text-slate-500">${escapeHtml(org?.trade_name || org?.legal_name || '')}</span>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-6">
      <div class="col-span-2 space-y-4">
        ${block('Produkt &amp; Identifikation', `
          ${kv('DPP-ID', dpp.id, 'mono')}
          ${kv('Produkt', product?.name)}
          ${kv('GTIN', dpp.gtin, 'mono')}
          ${kv('Granularitaet', labelOf('granularity_level', dpp.granularity_level))}
          ${kv('Charge', dpp.batch_lot_number)}
          ${kv('Seriennummer', dpp.serial_number)}
        `)}

        ${block('Hersteller &amp; Standort', `
          ${kv('Inverkehrbringer', org?.legal_name)}
          ${kv('Marke', org?.trade_name)}
          ${kv('GLN Hersteller', org?.gln, 'mono')}
          ${kv('Standort', facility?.name)}
          ${kv('GLN Standort', facility?.gln, 'mono')}
          ${kv('Audit-Status', facility?.audit_status)}
          ${kv('Letztes Audit', formatDate(facility?.last_audit_date))}
          ${kv('Land', dpp.manufacturing_country_iso2)}
          ${kv('Produktion', `${formatDate(dpp.manufacturing_date_from)} – ${formatDate(dpp.manufacturing_date_to)}`)}
          ${kv('In Verkehr seit', formatDate(dpp.placed_on_market_date))}
        `)}

        ${block('Materialzusammensetzung', dpp.material_composition.length === 0 ? '<div class="text-slate-500 italic text-sm">Keine.</div>' : `
          <table class="w-full text-sm">
            <thead class="text-xs uppercase text-slate-500">
              <tr><th class="text-left py-1">Material</th><th class="text-left py-1">Klasse</th><th class="text-left py-1">Land</th><th class="text-right py-1">Anteil</th><th class="text-left py-1 pl-3">Verifikation</th></tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${dpp.material_composition.map(m => `
                <tr>
                  <td class="py-2 font-medium text-slate-900">${escapeHtml(m.fiber_name)}</td>
                  <td class="py-2 text-slate-600">${escapeHtml(labelOf('material_class', m.material_class))}</td>
                  <td class="py-2 text-slate-600">${escapeHtml(m.country_of_origin || '–')}</td>
                  <td class="py-2 text-right font-semibold text-slate-900">${m.percentage}%</td>
                  <td class="py-2 pl-3">${raw(verificationBadge(m.verification_status)).value}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `)}

        ${block('Compliance-Statements', dpp.compliance_statements.length === 0 ? '<div class="text-slate-500 italic text-sm">Keine.</div>' : `
          <div class="space-y-3">
            ${dpp.compliance_statements.map(c => `
              <div class="border border-slate-200 rounded-lg p-3">
                <div class="flex items-center justify-between gap-2">
                  <span class="badge bg-blue-50 text-blue-700">${escapeHtml(labelOf('compliance_standard', c.compliance_standard))}</span>
                  ${raw(verificationBadge(c.verification_status)).value}
                </div>
                <p class="text-sm text-slate-700 mt-2">${escapeHtml(c.statement_text)}</p>
                <p class="text-xs text-slate-500 mt-1">Gueltig: ${formatDate(c.valid_from)} – ${formatDate(c.valid_until) || 'unbefristet'}</p>
              </div>
            `).join('')}
          </div>
        `)}

        ${block('Belegdokumente (alle Sichtbarkeiten)', dpp.documents.length === 0 ? '<div class="text-slate-500 italic text-sm">Keine.</div>' : `
          <div class="space-y-2">
            ${dpp.documents.map(d => `
              <div class="flex items-center gap-3 p-2.5 bg-slate-50 rounded-lg">
                <div class="w-8 h-8 rounded bg-white text-slate-600 flex items-center justify-center border border-slate-200">${ICON.doc}</div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-slate-900">${escapeHtml(d.title)}</div>
                  <div class="text-xs text-slate-500">${escapeHtml(labelOf('document_type', d.document_type))} &middot; ${escapeHtml(d.issuer || '–')} &middot; ${formatDate(d.issued_at)}</div>
                </div>
                ${raw(visibilityBadge(d.visibility)).value}
                <span class="text-xs font-mono text-slate-500">${escapeHtml(d.file_name)}</span>
              </div>
            `).join('')}
          </div>
        `)}
      </div>

      <aside class="col-span-1 space-y-4">
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
          <div class="flex items-center gap-2 text-amber-800 font-semibold mb-1.5">${ICON.shield}<span>Behoerden-Pruefkriterien</span></div>
          <ul class="space-y-1 text-xs text-amber-900">
            ${checkItem('GS1-Identifier vorhanden', !!dpp.gtin)}
            ${checkItem('Hersteller mit GLN', !!org?.gln)}
            ${checkItem('Standort mit GLN', !!facility?.gln)}
            ${checkItem('Material 100%', dpp.material_composition.reduce((a,m)=>a+Number(m.percentage||0),0) === 100)}
            ${checkItem('ESPR-Statement vorhanden', dpp.compliance_statements.some(c => c.compliance_standard === 'ESPR'))}
            ${checkItem('REACH-Statement vorhanden', dpp.compliance_statements.some(c => c.compliance_standard === 'REACH'))}
            ${checkItem('Konformitaetserklaerung', dpp.documents.some(d => d.document_type === 'declaration'))}
            ${checkItem('Drittstellen-verifizierte Inhalte', dpp.compliance_statements.some(c => c.verification_status === 'third_party_verified') || dpp.material_composition.some(m => m.verification_status === 'third_party_verified'))}
          </ul>
        </div>

        <div class="bg-white border border-slate-200 rounded-xl p-4 text-sm">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Audit-Trail</div>
          <dl class="space-y-1.5">
            <div class="flex justify-between"><dt class="text-slate-500">Angelegt</dt><dd class="font-medium">${formatDateTime(dpp.created_at)}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">Geaendert</dt><dd class="font-medium">${formatDateTime(dpp.updated_at)}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">Veroeffentlicht</dt><dd class="font-medium">${formatDateTime(dpp.published_at)}</dd></div>
          </dl>
        </div>
      </aside>
    </div>
  `;
}

function block(title, contentHtml) {
  return `
    <div class="bg-white border border-slate-200 rounded-xl p-5">
      <h3 class="text-sm font-semibold text-slate-900 mb-4">${title}</h3>
      ${contentHtml}
    </div>
  `;
}

function kv(label, value, mod = '') {
  if (value == null || value === '') return '';
  const cls = mod === 'mono' ? 'font-mono text-xs' : 'text-sm';
  return `
    <div class="grid grid-cols-2 gap-x-6 gap-y-2 mb-2 last:mb-0">
      <div class="text-sm text-slate-500">${label}</div>
      <div class="${cls} font-medium text-slate-900">${escapeHtml(value)}</div>
    </div>
  `;
}

function checkItem(label, ok) {
  return `<li class="flex items-center gap-1.5"><span class="${ok ? 'text-emerald-600' : 'text-red-500'}">${ok ? '&#10003;' : '&#10007;'}</span><span class="${ok ? '' : 'text-amber-900/70 line-through'}">${label}</span></li>`;
}
