// Creator-Persona: DPP-Dashboard, Wizard, Detail.

import { store, nextId, labelOf } from '../store.js';
import { html, raw, $, $$, ICON, toast, formatDate, formatDateTime,
         statusBadge, visibilityBadge, verificationBadge, escapeHtml, confirm } from '../ui.js';
import { navigate } from '../router.js';

// ================== DASHBOARD ==================
export function dashboard() {
  const s = store.state;
  const myOrgId = s.activeOrganizationId;
  const myDpps = s.dpps.filter(d => d.issuing_organization_id === myOrgId)
                       .sort((a,b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

  const draftCount     = myDpps.filter(d => d.status === 'draft').length;
  const publishedCount = myDpps.filter(d => d.status === 'published').length;

  const rows = myDpps.map(d => dppRow(d, s)).join('');

  setTimeout(bindDashboard, 0);

  return `
    <div class="flex items-end justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-slate-900">Meine DPPs</h1>
        <p class="text-sm text-slate-600 mt-1">Digital Product Passports der Organisation <strong>${escapeHtml(orgName(myOrgId))}</strong></p>
      </div>
      <a href="#/creator/dpp/new" class="btn btn-primary">${ICON.plus}<span>Neuen DPP anlegen</span></a>
    </div>

    <div class="grid grid-cols-3 gap-4 mb-6">
      ${kpiCard('Gesamt',           myDpps.length, 'bg-slate-100 text-slate-700')}
      ${kpiCard('Veroeffentlicht',  publishedCount, 'bg-emerald-50 text-emerald-700')}
      ${kpiCard('Entwurf',          draftCount, 'bg-amber-50 text-amber-700')}
    </div>

    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="text-left px-4 py-3">DPP-ID</th>
            <th class="text-left px-4 py-3">Produkt</th>
            <th class="text-left px-4 py-3">Granularitaet</th>
            <th class="text-left px-4 py-3">Charge / Serial</th>
            <th class="text-left px-4 py-3">Status</th>
            <th class="text-left px-4 py-3">Sichtbarkeit</th>
            <th class="text-left px-4 py-3">Geaendert</th>
            <th class="text-right px-4 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${rows || `<tr><td colspan="8" class="px-4 py-12 text-center text-slate-500">Noch keine DPPs vorhanden. <a href="#/creator/dpp/new" class="text-brand-700 underline">Ersten DPP anlegen</a>.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function dppRow(d, s) {
  const product = s.products.find(p => p.id === d.product_id);
  return `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 font-mono text-xs text-slate-700">${escapeHtml(d.id)}</td>
      <td class="px-4 py-3 font-medium text-slate-900">${escapeHtml(product?.name || '–')}</td>
      <td class="px-4 py-3 text-slate-700">${escapeHtml(labelOf('granularity_level', d.granularity_level))}</td>
      <td class="px-4 py-3 font-mono text-xs text-slate-600">${escapeHtml(d.batch_lot_number || d.serial_number || '–')}</td>
      <td class="px-4 py-3">${raw(statusBadge(d.status)).value}</td>
      <td class="px-4 py-3">${raw(visibilityBadge(d.visibility)).value}</td>
      <td class="px-4 py-3 text-xs text-slate-500">${formatDateTime(d.updated_at)}</td>
      <td class="px-4 py-3 text-right space-x-1">
        <a href="#/creator/dpp/${d.id}" class="btn btn-ghost !text-xs">Ansehen</a>
        <a href="#/creator/dpp/${d.id}/edit" class="btn btn-secondary !text-xs">${ICON.edit}<span>Bearbeiten</span></a>
      </td>
    </tr>
  `;
}

function kpiCard(label, value, classes) {
  return `
    <div class="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
      <div>
        <div class="text-xs uppercase tracking-wider text-slate-500 font-semibold">${label}</div>
        <div class="text-2xl font-bold text-slate-900 mt-1">${value}</div>
      </div>
      <div class="w-10 h-10 rounded-lg ${classes} flex items-center justify-center">${ICON.cube}</div>
    </div>
  `;
}

function orgName(id) {
  const org = store.state.organizations.find(o => o.id === id);
  return org?.trade_name || org?.legal_name || id;
}

function bindDashboard() {
  // No-op for now — clicks handled via href
}

// ================== WIZARD (NEU / BEARBEITEN) ==================

// Wizard state held in module scope (resets on each page load).
let wizardState = null;
let wizardStep = 1;
const TOTAL_STEPS = 6;

function initWizard(ctxParams) {
  if (ctxParams.id) {
    const existing = store.state.dpps.find(d => d.id === ctxParams.id);
    if (existing) {
      wizardState = structuredClone(existing);
      return;
    }
  }
  // New DPP draft
  wizardState = {
    id: nextId('dpp'),
    product_id: store.state.products[0]?.id || '',
    issuing_organization_id: store.state.activeOrganizationId,
    facility_id: '',
    granularity_level: 'batch',
    gtin: '',
    batch_lot_number: '',
    serial_number: '',
    status: 'draft',
    visibility: 'public',
    manufacturing_country_iso2: 'DE',
    manufacturing_date_from: '',
    manufacturing_date_to: '',
    placed_on_market_date: '',
    verification_status: 'declared',
    qr_payload_url: '',
    created_at: new Date().toISOString(),
    created_by: store.state.activeUserId,
    updated_at: new Date().toISOString(),
    published_at: '',
    material_composition: [],
    compliance_statements: [],
    documents: []
  };
}

export function wizard(ctx) {
  const isEdit = !!ctx.id;
  const queryStep = parseInt(ctx.query?.step) || 1;

  if (!wizardState || wizardState.id !== (ctx.id || wizardState?.id) || wizardState.id !== ctx.id && !ctx.id && wizardStep === 1) {
    initWizard(ctx);
    wizardStep = 1;
  }
  // If url has ?step= use it
  if (queryStep >= 1 && queryStep <= TOTAL_STEPS) wizardStep = queryStep;

  setTimeout(bindWizard, 0);

  return `
    <div class="flex items-center gap-2 mb-2 text-sm text-slate-500">
      <a href="#/creator" class="hover:underline">Meine DPPs</a>
      <span>/</span>
      <span>${isEdit ? 'DPP bearbeiten' : 'Neuen DPP anlegen'}</span>
    </div>
    <h1 class="text-xl font-bold text-slate-900 mb-1">${isEdit ? `DPP <span class="font-mono text-base text-slate-500">${escapeHtml(wizardState.id)}</span>` : 'Neuen DPP anlegen'}</h1>
    <p class="text-sm text-slate-600 mb-6">Folgen Sie den Schritten. Sie koennen jederzeit als Entwurf zwischenspeichern.</p>

    ${stepper(wizardStep)}

    <div class="mt-6 bg-white border border-slate-200 rounded-xl p-6">
      ${renderStep(wizardStep)}
    </div>

    <div class="mt-4 flex items-center justify-between">
      <button id="wiz-cancel" class="btn btn-ghost">Abbrechen</button>
      <div class="flex items-center gap-2">
        <button id="wiz-save-draft" class="btn btn-secondary">${ICON.save}<span>Entwurf speichern</span></button>
        ${wizardStep > 1 ? `<button id="wiz-prev" class="btn btn-secondary">${ICON.back}<span>Zurueck</span></button>` : ''}
        ${wizardStep < TOTAL_STEPS
          ? `<button id="wiz-next" class="btn btn-primary"><span>Weiter</span>${ICON.next}</button>`
          : `<button id="wiz-publish" class="btn btn-primary">${ICON.save}<span>${isEdit && wizardState.status === 'published' ? 'Aktualisieren' : 'Veroeffentlichen'}</span></button>`
        }
      </div>
    </div>
  `;
}

function stepper(active) {
  const titles = [
    'Produkt &amp; ID',
    'Granularitaet &amp; Herstellung',
    'Materialzusammensetzung',
    'Compliance',
    'Dokumente',
    'Pruefung &amp; Freigabe'
  ];
  return `
    <ol class="flex items-center gap-2 overflow-x-auto pb-2">
      ${titles.map((t, i) => {
        const n = i + 1;
        const cls = n === active ? 'step-active' : (n < active ? 'step-done' : 'step-pending');
        return `
          <li class="flex items-center gap-2">
            <button data-step-jump="${n}" class="step-dot border w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center ${cls}">${n}</button>
            <span class="text-xs ${n === active ? 'text-brand-700 font-medium' : 'text-slate-500'} hidden sm:inline whitespace-nowrap">${t}</span>
            ${n < titles.length ? '<span class="w-6 h-px bg-slate-200"></span>' : ''}
          </li>`;
      }).join('')}
    </ol>
  `;
}

function renderStep(step) {
  switch (step) {
    case 1: return stepProduct();
    case 2: return stepManufacturing();
    case 3: return stepMaterial();
    case 4: return stepCompliance();
    case 5: return stepDocuments();
    case 6: return stepReview();
  }
  return '';
}

// --- Step 1: Produkt & GS1 ---
function stepProduct() {
  const s = store.state;
  const products = s.products.filter(p => p.owning_organization_id === s.activeOrganizationId);

  return `
    <h2 class="text-base font-semibold text-slate-900 mb-1">Produkt &amp; GS1-Identifikation</h2>
    <p class="text-sm text-slate-500 mb-6">Welches Produkt liegt diesem DPP zugrunde? Welche GS1-Identifier gelten?</p>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label required">Produkt</label>
        <select id="f-product" class="select">
          ${products.map(p => `<option value="${p.id}" ${p.id === wizardState.product_id ? 'selected' : ''}>${escapeHtml(p.name)} (GTIN ${escapeHtml(p.gtin)})</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="label required">GTIN (auto aus Produkt)</label>
        <input id="f-gtin" class="input" value="${escapeHtml(wizardState.gtin || products.find(p=>p.id===wizardState.product_id)?.gtin || '')}">
      </div>
      <div>
        <label class="label">Charge / Lot-Nummer</label>
        <input id="f-batch" class="input" value="${escapeHtml(wizardState.batch_lot_number)}" placeholder="z.B. B2026-A0142">
      </div>
      <div>
        <label class="label">Seriennummer (Item-Level)</label>
        <input id="f-serial" class="input" value="${escapeHtml(wizardState.serial_number)}" placeholder="optional">
      </div>
    </div>
  `;
}

// --- Step 2: Granularity & Manufacturing ---
function stepManufacturing() {
  const s = store.state;
  const orgFacilities = s.facilities.filter(f => f.organization_id === s.activeOrganizationId
                                              || f.organization_id === wizardState.issuing_organization_id);
  // Also include facilities of all platform tenants for demo
  const allFacilities = s.facilities;

  return `
    <h2 class="text-base font-semibold text-slate-900 mb-1">Granularitaet &amp; Herstellung</h2>
    <p class="text-sm text-slate-500 mb-6">Auf welcher Ebene wird der DPP gefuehrt? Wo und wann wurde produziert?</p>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label required">Granularitaet</label>
        <select id="f-granularity" class="select">
          ${store.lookups.granularity_level.map(o => `<option value="${o.value}" ${o.value === wizardState.granularity_level ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="label required">Sichtbarkeit</label>
        <select id="f-visibility" class="select">
          ${store.lookups.visibility.map(o => `<option value="${o.value}" ${o.value === wizardState.visibility ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="label">Produzierender Standort</label>
        <select id="f-facility" class="select">
          <option value="">(keiner)</option>
          ${allFacilities.map(f => `<option value="${f.id}" ${f.id === wizardState.facility_id ? 'selected' : ''}>${escapeHtml(f.name)} (${escapeHtml(f.country_iso2)})</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="label">Herstellungsland (ISO-2)</label>
        <input id="f-country" class="input" maxlength="2" value="${escapeHtml(wizardState.manufacturing_country_iso2)}" placeholder="z.B. DE">
      </div>
      <div>
        <label class="label">Produktion von</label>
        <input id="f-mfg-from" type="date" class="input" value="${escapeHtml(wizardState.manufacturing_date_from)}">
      </div>
      <div>
        <label class="label">Produktion bis</label>
        <input id="f-mfg-to" type="date" class="input" value="${escapeHtml(wizardState.manufacturing_date_to)}">
      </div>
      <div>
        <label class="label">Inverkehrbringen am</label>
        <input id="f-market-date" type="date" class="input" value="${escapeHtml(wizardState.placed_on_market_date)}">
      </div>
      <div>
        <label class="label">Verifikationsstatus (Datenbasis)</label>
        <select id="f-verification" class="select">
          ${store.lookups.verification_status.map(o => `<option value="${o.value}" ${o.value === wizardState.verification_status ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </div>
    </div>
  `;
}

// --- Step 3: Material ---
function stepMaterial() {
  const sum = wizardState.material_composition.reduce((a, m) => a + (Number(m.percentage) || 0), 0);
  const sumColor = sum === 100 ? 'text-emerald-600' : (sum > 100 ? 'text-red-600' : 'text-amber-600');
  return `
    <div class="flex items-end justify-between mb-4">
      <div>
        <h2 class="text-base font-semibold text-slate-900 mb-1">Materialzusammensetzung</h2>
        <p class="text-sm text-slate-500">Faserkomposition mass-bezogen. Summe sollte 100% ergeben.</p>
      </div>
      <button id="add-material" class="btn btn-secondary">${ICON.plus}<span>Material hinzufuegen</span></button>
    </div>

    <div class="space-y-3">
      ${wizardState.material_composition.length === 0 ? '<p class="text-sm text-slate-500 italic">Noch keine Materialien hinzugefuegt.</p>' : ''}
      ${wizardState.material_composition.map(m => materialRow(m)).join('')}
    </div>

    <div class="mt-4 flex items-center justify-end gap-2 text-sm">
      <span class="text-slate-500">Summe:</span>
      <span class="font-semibold ${sumColor}">${sum.toFixed(1)} %</span>
    </div>
  `;
}

function materialRow(m) {
  const cls = store.lookups.material_class;
  const verif = store.lookups.verification_status;
  return `
    <div class="grid grid-cols-12 gap-2 items-end p-3 border border-slate-200 rounded-lg" data-mat-id="${m.id}">
      <div class="col-span-3"><label class="label">Klasse</label>
        <select class="select mat-class">${cls.map(o => `<option value="${o.value}" ${o.value===m.material_class?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>
      </div>
      <div class="col-span-3"><label class="label">Faser / Material</label>
        <input class="input mat-name" value="${escapeHtml(m.fiber_name)}" placeholder="z.B. Cotton">
      </div>
      <div class="col-span-2"><label class="label">Anteil %</label>
        <input class="input mat-pct" type="number" min="0" max="100" step="0.1" value="${m.percentage}">
      </div>
      <div class="col-span-1"><label class="label">Land</label>
        <input class="input mat-country" maxlength="2" value="${escapeHtml(m.country_of_origin || '')}">
      </div>
      <div class="col-span-2"><label class="label">Verifikation</label>
        <select class="select mat-verif">${verif.map(o => `<option value="${o.value}" ${o.value===m.verification_status?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>
      </div>
      <div class="col-span-1 text-right"><button class="btn btn-ghost mat-del" title="Entfernen">${ICON.trash}</button></div>
    </div>
  `;
}

// --- Step 4: Compliance ---
function stepCompliance() {
  const verif = store.lookups.verification_status;
  const std = store.lookups.compliance_standard;
  return `
    <div class="flex items-end justify-between mb-4">
      <div>
        <h2 class="text-base font-semibold text-slate-900 mb-1">Compliance-Statements</h2>
        <p class="text-sm text-slate-500">Welche Vorschriften und freiwilligen Standards werden erfuellt?</p>
      </div>
      <button id="add-compliance" class="btn btn-secondary">${ICON.plus}<span>Statement hinzufuegen</span></button>
    </div>

    <div class="space-y-3">
      ${wizardState.compliance_statements.length === 0 ? '<p class="text-sm text-slate-500 italic">Noch keine Statements hinzugefuegt.</p>' : ''}
      ${wizardState.compliance_statements.map(c => `
        <div class="border border-slate-200 rounded-lg p-3 grid grid-cols-12 gap-2 items-end" data-cmp-id="${c.id}">
          <div class="col-span-3"><label class="label">Standard</label>
            <select class="select cmp-std">${std.map(o => `<option value="${o.value}" ${o.value===c.compliance_standard?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>
          </div>
          <div class="col-span-4"><label class="label">Aussage</label>
            <input class="input cmp-text" value="${escapeHtml(c.statement_text)}">
          </div>
          <div class="col-span-2"><label class="label">Gueltig von</label>
            <input class="input cmp-from" type="date" value="${escapeHtml(c.valid_from || '')}">
          </div>
          <div class="col-span-2"><label class="label">Gueltig bis</label>
            <input class="input cmp-until" type="date" value="${escapeHtml(c.valid_until || '')}">
          </div>
          <div class="col-span-1 text-right"><button class="btn btn-ghost cmp-del" title="Entfernen">${ICON.trash}</button></div>
          <div class="col-span-12 -mt-1"><label class="label">Verifikation</label>
            <select class="select cmp-verif !w-auto inline-block">${verif.map(o => `<option value="${o.value}" ${o.value===c.verification_status?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// --- Step 5: Documents ---
function stepDocuments() {
  const types = store.lookups.document_type;
  const vis = store.lookups.visibility;
  return `
    <div class="flex items-end justify-between mb-4">
      <div>
        <h2 class="text-base font-semibold text-slate-900 mb-1">Dokumente</h2>
        <p class="text-sm text-slate-500">Zertifikate, Audit-Berichte, Erklaerungen. Im Mockup: Datei-Auswahl simuliert; nur Dateiname wird gespeichert.</p>
      </div>
      <button id="add-doc" class="btn btn-secondary">${ICON.plus}<span>Dokument hinzufuegen</span></button>
    </div>

    <div class="space-y-3">
      ${wizardState.documents.length === 0 ? '<p class="text-sm text-slate-500 italic">Noch keine Dokumente angehaengt.</p>' : ''}
      ${wizardState.documents.map(d => `
        <div class="border border-slate-200 rounded-lg p-3 grid grid-cols-12 gap-2 items-end" data-doc-id="${d.id}">
          <div class="col-span-2"><label class="label">Typ</label>
            <select class="select doc-type">${types.map(o => `<option value="${o.value}" ${o.value===d.document_type?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>
          </div>
          <div class="col-span-3"><label class="label">Titel</label>
            <input class="input doc-title" value="${escapeHtml(d.title)}">
          </div>
          <div class="col-span-3"><label class="label">Dateiname</label>
            <input class="input doc-file" value="${escapeHtml(d.file_name)}" placeholder="zertifikat.pdf">
          </div>
          <div class="col-span-2"><label class="label">Aussteller</label>
            <input class="input doc-issuer" value="${escapeHtml(d.issuer || '')}">
          </div>
          <div class="col-span-1"><label class="label">Datum</label>
            <input class="input doc-issued" type="date" value="${escapeHtml(d.issued_at || '')}">
          </div>
          <div class="col-span-1 text-right"><button class="btn btn-ghost doc-del" title="Entfernen">${ICON.trash}</button></div>
          <div class="col-span-12 -mt-1"><label class="label">Sichtbarkeit</label>
            <select class="select doc-vis !w-auto inline-block">${vis.map(o => `<option value="${o.value}" ${o.value===d.visibility?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// --- Step 6: Review ---
function stepReview() {
  const s = store.state;
  const product = s.products.find(p => p.id === wizardState.product_id);
  const facility = s.facilities.find(f => f.id === wizardState.facility_id);
  const matSum = wizardState.material_composition.reduce((a,m) => a + Number(m.percentage||0), 0);

  return `
    <h2 class="text-base font-semibold text-slate-900 mb-1">Pruefung &amp; Freigabe</h2>
    <p class="text-sm text-slate-500 mb-6">Pruefen Sie die Zusammenfassung. Mit "Veroeffentlichen" wird der DPP fuer die ausgewaehlte Sichtbarkeit aktiv geschaltet und ein QR-Code-Stub erzeugt.</p>

    <div class="grid grid-cols-2 gap-6">
      <div class="space-y-4">
        ${reviewBlock('Produkt &amp; Identifikation', [
          ['Produkt',          product?.name || '–'],
          ['GTIN',             wizardState.gtin],
          ['Granularitaet',    labelOf('granularity_level', wizardState.granularity_level)],
          ['Charge',           wizardState.batch_lot_number || '–'],
          ['Seriennummer',     wizardState.serial_number || '–']
        ])}

        ${reviewBlock('Herstellung', [
          ['Standort',         facility?.name || '–'],
          ['Land',             wizardState.manufacturing_country_iso2 || '–'],
          ['Produktion von',   formatDate(wizardState.manufacturing_date_from)],
          ['Produktion bis',   formatDate(wizardState.manufacturing_date_to)],
          ['Marktbringen',     formatDate(wizardState.placed_on_market_date)],
          ['Verifikation',     labelOf('verification_status', wizardState.verification_status)]
        ])}
      </div>

      <div class="space-y-4">
        <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Zusammenfassung</div>
          <ul class="space-y-2 text-sm">
            <li class="flex justify-between"><span>Materialien</span><strong>${wizardState.material_composition.length} (Summe ${matSum.toFixed(1)}%)</strong></li>
            <li class="flex justify-between"><span>Compliance-Statements</span><strong>${wizardState.compliance_statements.length}</strong></li>
            <li class="flex justify-between"><span>Dokumente</span><strong>${wizardState.documents.length}</strong></li>
            <li class="flex justify-between"><span>Sichtbarkeit</span><strong>${labelOf('visibility', wizardState.visibility)}</strong></li>
          </ul>
        </div>

        ${matSum !== 100 ? `<div class="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs"><strong>Hinweis:</strong> Die Materialsumme betraegt ${matSum.toFixed(1)}%. Fuer eine vollstaendige Faserkomposition sollten 100% erreicht werden.</div>` : ''}

        ${wizardState.compliance_statements.length === 0 ? `<div class="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs"><strong>Hinweis:</strong> Keine Compliance-Statements eingetragen. Fuer ESPR-Konformitaet sind diese in der Regel verpflichtend.</div>` : ''}
      </div>
    </div>
  `;
}

function reviewBlock(title, rows) {
  return `
    <div class="bg-white border border-slate-200 rounded-lg p-4">
      <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">${title}</div>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        ${rows.map(([k,v]) => `<dt class="text-slate-500">${k}</dt><dd class="font-medium text-slate-900">${escapeHtml(v || '–')}</dd>`).join('')}
      </dl>
    </div>
  `;
}

// === Wizard bindings ===
function bindWizard() {
  // Step jump
  $$('[data-step-jump]').forEach(b => b.addEventListener('click', () => {
    captureFormToState();
    wizardStep = parseInt(b.dataset.stepJump);
    rerender();
  }));

  $('#wiz-cancel')?.addEventListener('click', async () => {
    const ok = await confirm('Aenderungen verwerfen und zur Liste zurueck?');
    if (ok) { wizardState = null; navigate('/creator'); }
  });

  $('#wiz-prev')?.addEventListener('click', () => { captureFormToState(); wizardStep--; rerender(); });
  $('#wiz-next')?.addEventListener('click', () => { captureFormToState(); wizardStep++; rerender(); });
  $('#wiz-save-draft')?.addEventListener('click', () => {
    captureFormToState();
    wizardState.status = 'draft';
    saveDpp();
    toast('Als Entwurf gespeichert', 'success');
  });
  $('#wiz-publish')?.addEventListener('click', () => {
    captureFormToState();
    wizardState.status = 'published';
    if (!wizardState.published_at) wizardState.published_at = new Date().toISOString();
    if (!wizardState.qr_payload_url) wizardState.qr_payload_url = `https://dpp.example/p/${wizardState.id}`;
    saveDpp();
    toast('DPP veroeffentlicht', 'success');
    navigate('/creator/dpp/' + wizardState.id);
  });

  // Step-specific dynamic add buttons
  $('#add-material')?.addEventListener('click', () => {
    captureFormToState();
    wizardState.material_composition.push({
      id: nextId('mat'),
      material_class: 'natural_plant',
      fiber_name: '',
      percentage: 0,
      country_of_origin: '',
      recycled_content_pct: 0,
      verification_status: 'declared'
    });
    rerender();
  });
  $$('.mat-del').forEach(b => b.addEventListener('click', e => {
    captureFormToState();
    const id = b.closest('[data-mat-id]').dataset.matId;
    wizardState.material_composition = wizardState.material_composition.filter(m => m.id !== id);
    rerender();
  }));

  $('#add-compliance')?.addEventListener('click', () => {
    captureFormToState();
    wizardState.compliance_statements.push({
      id: nextId('cmp'),
      compliance_standard: 'ESPR',
      statement_text: '',
      valid_from: '',
      valid_until: '',
      verification_status: 'declared'
    });
    rerender();
  });
  $$('.cmp-del').forEach(b => b.addEventListener('click', () => {
    captureFormToState();
    const id = b.closest('[data-cmp-id]').dataset.cmpId;
    wizardState.compliance_statements = wizardState.compliance_statements.filter(c => c.id !== id);
    rerender();
  }));

  $('#add-doc')?.addEventListener('click', () => {
    captureFormToState();
    wizardState.documents.push({
      id: nextId('doc'),
      document_type: 'certificate',
      title: '',
      file_name: '',
      issuer: '',
      issued_at: '',
      visibility: 'public'
    });
    rerender();
  });
  $$('.doc-del').forEach(b => b.addEventListener('click', () => {
    captureFormToState();
    const id = b.closest('[data-doc-id]').dataset.docId;
    wizardState.documents = wizardState.documents.filter(d => d.id !== id);
    rerender();
  }));

  // Auto-fill GTIN when product changes
  $('#f-product')?.addEventListener('change', e => {
    const p = store.state.products.find(x => x.id === e.target.value);
    if (p && $('#f-gtin')) $('#f-gtin').value = p.gtin || '';
  });
}

function captureFormToState() {
  const get = sel => $(sel)?.value;

  if (wizardStep === 1) {
    wizardState.product_id        = get('#f-product')   ?? wizardState.product_id;
    wizardState.gtin              = get('#f-gtin')      ?? wizardState.gtin;
    wizardState.batch_lot_number  = get('#f-batch')     ?? wizardState.batch_lot_number;
    wizardState.serial_number     = get('#f-serial')    ?? wizardState.serial_number;
  }
  if (wizardStep === 2) {
    wizardState.granularity_level         = get('#f-granularity')  ?? wizardState.granularity_level;
    wizardState.visibility                = get('#f-visibility')   ?? wizardState.visibility;
    wizardState.facility_id               = get('#f-facility')     ?? wizardState.facility_id;
    wizardState.manufacturing_country_iso2= get('#f-country')      ?? wizardState.manufacturing_country_iso2;
    wizardState.manufacturing_date_from   = get('#f-mfg-from')     ?? wizardState.manufacturing_date_from;
    wizardState.manufacturing_date_to     = get('#f-mfg-to')       ?? wizardState.manufacturing_date_to;
    wizardState.placed_on_market_date     = get('#f-market-date')  ?? wizardState.placed_on_market_date;
    wizardState.verification_status       = get('#f-verification') ?? wizardState.verification_status;
  }
  if (wizardStep === 3) {
    $$('[data-mat-id]').forEach(row => {
      const id = row.dataset.matId;
      const m = wizardState.material_composition.find(x => x.id === id);
      if (!m) return;
      m.material_class       = row.querySelector('.mat-class').value;
      m.fiber_name           = row.querySelector('.mat-name').value;
      m.percentage           = Number(row.querySelector('.mat-pct').value) || 0;
      m.country_of_origin    = row.querySelector('.mat-country').value;
      m.verification_status  = row.querySelector('.mat-verif').value;
    });
  }
  if (wizardStep === 4) {
    $$('[data-cmp-id]').forEach(row => {
      const id = row.dataset.cmpId;
      const c = wizardState.compliance_statements.find(x => x.id === id);
      if (!c) return;
      c.compliance_standard = row.querySelector('.cmp-std').value;
      c.statement_text      = row.querySelector('.cmp-text').value;
      c.valid_from          = row.querySelector('.cmp-from').value;
      c.valid_until         = row.querySelector('.cmp-until').value;
      c.verification_status = row.querySelector('.cmp-verif').value;
    });
  }
  if (wizardStep === 5) {
    $$('[data-doc-id]').forEach(row => {
      const id = row.dataset.docId;
      const d = wizardState.documents.find(x => x.id === id);
      if (!d) return;
      d.document_type = row.querySelector('.doc-type').value;
      d.title         = row.querySelector('.doc-title').value;
      d.file_name     = row.querySelector('.doc-file').value;
      d.issuer        = row.querySelector('.doc-issuer').value;
      d.issued_at     = row.querySelector('.doc-issued').value;
      d.visibility    = row.querySelector('.doc-vis').value;
    });
  }
  wizardState.updated_at = new Date().toISOString();
}

function rerender() {
  const main = $('main [data-view]');
  if (!main) return;
  main.innerHTML = wizard({ id: store.state.dpps.find(d => d.id === wizardState.id) ? wizardState.id : null,
                            query: { step: wizardStep } });
  bindWizard();
}

function saveDpp() {
  const exists = store.state.dpps.find(d => d.id === wizardState.id);
  if (exists) store.updateDpp(wizardState);
  else store.addDpp(wizardState);
}

// ================== DETAIL ==================
export function detail(ctx) {
  const dpp = store.state.dpps.find(d => d.id === ctx.id);
  if (!dpp) return `<div class="text-slate-500">DPP nicht gefunden.</div>`;

  const product = store.state.products.find(p => p.id === dpp.product_id);
  const facility = store.state.facilities.find(f => f.id === dpp.facility_id);
  const matSum = dpp.material_composition.reduce((a,m) => a + Number(m.percentage||0), 0);

  return `
    <div class="flex items-center gap-2 mb-2 text-sm text-slate-500">
      <a href="#/creator" class="hover:underline">Meine DPPs</a>
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
          <span class="text-xs text-slate-500">Version 1 &middot; geaendert ${formatDateTime(dpp.updated_at)}</span>
        </div>
      </div>
      <div class="space-x-1">
        <a href="#/consumer/dpp/${dpp.id}" class="btn btn-secondary">${ICON.qr}<span>Konsumenten-Sicht</span></a>
        <a href="#/creator/dpp/${dpp.id}/edit" class="btn btn-primary">${ICON.edit}<span>Bearbeiten</span></a>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-6">
      <div class="col-span-2 space-y-6">
        ${detailBlock('Produkt &amp; Identifikation', [
          ['Produkt', product?.name],
          ['GTIN', dpp.gtin],
          ['Granularitaet', labelOf('granularity_level', dpp.granularity_level)],
          ['Charge', dpp.batch_lot_number],
          ['Seriennummer', dpp.serial_number]
        ])}

        ${detailBlock('Herstellung', [
          ['Standort', facility ? `${facility.name} (${facility.country_iso2})` : null],
          ['Land', dpp.manufacturing_country_iso2],
          ['Produktion von', formatDate(dpp.manufacturing_date_from)],
          ['Produktion bis', formatDate(dpp.manufacturing_date_to)],
          ['Marktbringen', formatDate(dpp.placed_on_market_date)]
        ])}

        ${detailListBlock('Materialzusammensetzung', dpp.material_composition,
          m => `<div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div class="flex items-center gap-3">
                    <span class="badge bg-slate-100 text-slate-700">${escapeHtml(labelOf('material_class', m.material_class))}</span>
                    <span class="font-medium text-slate-900">${escapeHtml(m.fiber_name)}</span>
                    <span class="text-xs text-slate-500">${escapeHtml(m.country_of_origin)}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    ${raw(verificationBadge(m.verification_status)).value}
                    <span class="font-semibold text-slate-900">${m.percentage}%</span>
                  </div>
                </div>`,
          dpp.material_composition.length ? `Summe: <strong>${matSum.toFixed(1)}%</strong>` : ''
        )}

        ${detailListBlock('Compliance-Statements', dpp.compliance_statements,
          c => `<div class="py-2 border-b border-slate-100 last:border-0">
                  <div class="flex items-center justify-between">
                    <span class="badge bg-blue-50 text-blue-700">${escapeHtml(labelOf('compliance_standard', c.compliance_standard))}</span>
                    ${raw(verificationBadge(c.verification_status)).value}
                  </div>
                  <p class="mt-1.5 text-sm text-slate-700">${escapeHtml(c.statement_text)}</p>
                  <p class="mt-1 text-xs text-slate-500">Gueltig: ${formatDate(c.valid_from)} – ${formatDate(c.valid_until) || 'unbefristet'}</p>
                </div>`)}

        ${detailListBlock('Dokumente', dpp.documents,
          d => `<div class="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                  <div class="w-8 h-8 rounded bg-slate-100 text-slate-600 flex items-center justify-center">${ICON.doc}</div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-slate-900 truncate">${escapeHtml(d.title)}</div>
                    <div class="text-xs text-slate-500">${escapeHtml(labelOf('document_type', d.document_type))} &middot; ${escapeHtml(d.issuer || '–')} &middot; ${formatDate(d.issued_at)}</div>
                  </div>
                  ${raw(visibilityBadge(d.visibility)).value}
                  <span class="text-xs font-mono text-slate-400">${escapeHtml(d.file_name)}</span>
                </div>`)}
      </div>

      <aside class="col-span-1 space-y-4">
        <div class="bg-white border border-slate-200 rounded-xl p-4">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500">QR-Code</div>
          <div class="mt-3 aspect-square bg-slate-100 rounded-lg flex items-center justify-center text-slate-400">
            ${dpp.qr_payload_url ? qrPlaceholder(dpp.qr_payload_url) : '<span class="text-xs">Erst nach Veroeffentlichung</span>'}
          </div>
          ${dpp.qr_payload_url ? `<div class="mt-2 text-xs font-mono text-slate-600 break-all">${escapeHtml(dpp.qr_payload_url)}</div>` : ''}
        </div>

        <div class="bg-white border border-slate-200 rounded-xl p-4 text-sm">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Audit</div>
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

function qrPlaceholder(text) {
  // Tiny SVG that visually evokes a QR code
  return `<svg viewBox="0 0 100 100" class="w-3/4 h-3/4 text-slate-700"><rect x="5" y="5" width="20" height="20" fill="currentColor"/><rect x="75" y="5" width="20" height="20" fill="currentColor"/><rect x="5" y="75" width="20" height="20" fill="currentColor"/>${
    Array.from({length: 60}).map(() => `<rect x="${30 + Math.floor(Math.random()*40)}" y="${30 + Math.floor(Math.random()*40)}" width="3" height="3" fill="currentColor"/>`).join('')
  }</svg>`;
}

function detailBlock(title, rows) {
  return `
    <div class="bg-white border border-slate-200 rounded-xl p-5">
      <h3 class="text-sm font-semibold text-slate-900 mb-4">${title}</h3>
      <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        ${rows.filter(([_, v]) => v != null && v !== '').map(([k,v]) => `<dt class="text-slate-500">${k}</dt><dd class="font-medium text-slate-900">${escapeHtml(v)}</dd>`).join('')}
      </dl>
    </div>
  `;
}

function detailListBlock(title, items, itemFn, footer) {
  return `
    <div class="bg-white border border-slate-200 rounded-xl p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-slate-900">${title}</h3>
        <span class="text-xs text-slate-500">${items.length} ${items.length === 1 ? 'Eintrag' : 'Eintraege'}</span>
      </div>
      ${items.length ? items.map(itemFn).join('') : '<div class="text-sm text-slate-500 italic">Keine Eintraege.</div>'}
      ${footer ? `<div class="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 text-right">${footer}</div>` : ''}
    </div>
  `;
}
