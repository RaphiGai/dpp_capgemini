// Admin-Persona: Stammdatenverwaltung (Organizations, Facilities, Products, Users).

import { store, nextId, labelOf } from '../store.js';
import { html, raw, $, $$, ICON, toast, escapeHtml, showModal, confirm, formatDate } from '../ui.js';

// ================== OVERVIEW ==================
export function overview() {
  const s = store.state;
  return `
    <h1 class="text-xl font-bold text-slate-900 mb-1">Verwaltung</h1>
    <p class="text-sm text-slate-600 mb-6">Stammdaten der Plattform pflegen.</p>

    <div class="grid grid-cols-2 gap-4">
      ${overviewTile('Organisationen', s.organizations.length, 'Brands, Hersteller, Lieferanten und Behoerden.', '#/admin/organizations', ICON.building)}
      ${overviewTile('Standorte',      s.facilities.length,    'Werke, Farmen, Lager mit GLN.',                   '#/admin/facilities',    ICON.factory)}
      ${overviewTile('Produkte',       s.products.length,      'Produkt-Stammdaten mit GTIN.',                    '#/admin/products',      ICON.cube)}
      ${overviewTile('Benutzer',       s.users.length,         'Plattform-User und Rollenzuordnung.',             '#/admin/users',         ICON.user)}
    </div>
  `;
}

function overviewTile(title, count, desc, href, icon) {
  return `
    <a href="${href}" class="card-hover bg-white border border-slate-200 rounded-xl p-5 block">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">${icon}</div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-900">${title}</div>
          <div class="text-xs text-slate-500">${desc}</div>
        </div>
        <div class="text-2xl font-bold text-slate-900">${count}</div>
      </div>
    </a>
  `;
}

// ================== ORGANIZATIONS ==================
export function organizations() {
  setTimeout(bindOrgs, 0);
  const rows = store.state.organizations.map(o => `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 font-medium text-slate-900">${escapeHtml(o.legal_name)}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(o.trade_name || '–')}</td>
      <td class="px-4 py-3"><span class="badge bg-slate-100 text-slate-700">${escapeHtml(labelOf('organization_type', o.organization_type))}</span></td>
      <td class="px-4 py-3 text-slate-700">${escapeHtml(o.country_iso2)}</td>
      <td class="px-4 py-3 text-slate-700">${escapeHtml(o.city || '–')}</td>
      <td class="px-4 py-3 font-mono text-xs text-slate-600">${escapeHtml(o.gln || '–')}</td>
      <td class="px-4 py-3">${o.is_platform_tenant ? '<span class="badge bg-emerald-50 text-emerald-700">Tenant</span>' : '<span class="badge bg-slate-100 text-slate-500">Referenziert</span>'}</td>
      <td class="px-4 py-3 text-right space-x-1">
        <button class="btn btn-ghost !text-xs" data-edit-org="${o.id}">${ICON.edit}</button>
        <button class="btn btn-ghost !text-xs text-red-600" data-del-org="${o.id}">${ICON.trash}</button>
      </td>
    </tr>
  `).join('');

  return crudPage({
    title: 'Organisationen',
    desc: 'Mandanten und referenzierte Geschaeftspartner.',
    addBtnId: 'add-org',
    addBtnLabel: 'Organisation hinzufuegen',
    headers: ['Name','Marke','Typ','Land','Stadt','GLN','Mandant',''],
    body: rows
  });
}

function bindOrgs() {
  $('#add-org')?.addEventListener('click', () => editOrgDialog());
  $$('[data-edit-org]').forEach(b => b.addEventListener('click', () => {
    const o = store.state.organizations.find(x => x.id === b.dataset.editOrg);
    editOrgDialog(o);
  }));
  $$('[data-del-org]').forEach(b => b.addEventListener('click', async () => {
    const o = store.state.organizations.find(x => x.id === b.dataset.delOrg);
    const ok = await confirm(`Organisation "${o.legal_name}" loeschen?`, { confirmText: 'Loeschen', danger: true });
    if (ok) { store.deleteOrganization(o.id); toast('Geloescht'); }
  }));
}

function editOrgDialog(org) {
  const isNew = !org;
  if (isNew) org = { id: nextId('org'), legal_name: '', trade_name: '', organization_type: 'manufacturer', country_iso2: '', city: '', gln: '', is_platform_tenant: false };

  const close = showModal(`
    <form id="org-form" class="p-6 space-y-4">
      <h3 class="text-base font-semibold text-slate-900">${isNew ? 'Organisation hinzufuegen' : 'Organisation bearbeiten'}</h3>
      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2"><label class="label required">Rechtlicher Firmenname</label><input class="input" name="legal_name" value="${escapeHtml(org.legal_name)}" required></div>
        <div><label class="label">Marke / Handelsname</label><input class="input" name="trade_name" value="${escapeHtml(org.trade_name || '')}"></div>
        <div><label class="label required">Typ</label>
          <select class="select" name="organization_type">${store.lookups.organization_type.map(o => `<option value="${o.value}" ${o.value===org.organization_type?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>
        </div>
        <div><label class="label required">Land (ISO-2)</label><input class="input" name="country_iso2" maxlength="2" value="${escapeHtml(org.country_iso2)}" required></div>
        <div><label class="label">Stadt</label><input class="input" name="city" value="${escapeHtml(org.city || '')}"></div>
        <div class="col-span-2"><label class="label">GLN (GS1 Global Location Number)</label><input class="input" name="gln" maxlength="13" value="${escapeHtml(org.gln || '')}"></div>
        <div class="col-span-2"><label class="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="is_platform_tenant" ${org.is_platform_tenant?'checked':''}> Aktiver Mandant der Plattform</label></div>
      </div>
      <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
        <button type="button" class="btn btn-secondary" data-modal-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">${ICON.save}<span>Speichern</span></button>
      </div>
    </form>
  `);

  setTimeout(() => {
    document.getElementById('org-form').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = {
        ...org,
        legal_name: fd.get('legal_name'),
        trade_name: fd.get('trade_name'),
        organization_type: fd.get('organization_type'),
        country_iso2: fd.get('country_iso2').toUpperCase(),
        city: fd.get('city'),
        gln: fd.get('gln'),
        is_platform_tenant: !!fd.get('is_platform_tenant')
      };
      if (isNew) store.addOrganization(data); else store.updateOrganization(data);
      close();
      toast(isNew ? 'Organisation angelegt' : 'Aenderungen gespeichert', 'success');
    });
  }, 0);
}

// ================== FACILITIES ==================
export function facilities() {
  setTimeout(bindFacilities, 0);
  const rows = store.state.facilities.map(f => {
    const org = store.state.organizations.find(o => o.id === f.organization_id);
    return `
      <tr class="hover:bg-slate-50">
        <td class="px-4 py-3 font-medium text-slate-900">${escapeHtml(f.name)}</td>
        <td class="px-4 py-3 text-slate-700">${escapeHtml(org?.trade_name || org?.legal_name || '–')}</td>
        <td class="px-4 py-3 text-slate-700">${escapeHtml(f.facility_type || '–')}</td>
        <td class="px-4 py-3 text-slate-700">${escapeHtml(f.country_iso2)}</td>
        <td class="px-4 py-3 text-slate-700">${escapeHtml(f.region || '–')}</td>
        <td class="px-4 py-3 font-mono text-xs text-slate-600">${escapeHtml(f.gln || '–')}</td>
        <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(f.audit_status || '–')} ${f.last_audit_date ? `<br><span class="text-slate-400">${formatDate(f.last_audit_date)}</span>` : ''}</td>
        <td class="px-4 py-3 text-right space-x-1">
          <button class="btn btn-ghost !text-xs" data-edit-fac="${f.id}">${ICON.edit}</button>
          <button class="btn btn-ghost !text-xs text-red-600" data-del-fac="${f.id}">${ICON.trash}</button>
        </td>
      </tr>
    `;
  }).join('');

  return crudPage({
    title: 'Standorte',
    desc: 'Werke, Farmen, Lager und sonstige Facilities mit GLN.',
    addBtnId: 'add-fac',
    addBtnLabel: 'Standort hinzufuegen',
    headers: ['Name','Organisation','Typ','Land','Region','GLN','Audit',''],
    body: rows
  });
}

function bindFacilities() {
  $('#add-fac')?.addEventListener('click', () => editFacDialog());
  $$('[data-edit-fac]').forEach(b => b.addEventListener('click', () => {
    const f = store.state.facilities.find(x => x.id === b.dataset.editFac);
    editFacDialog(f);
  }));
  $$('[data-del-fac]').forEach(b => b.addEventListener('click', async () => {
    const f = store.state.facilities.find(x => x.id === b.dataset.delFac);
    const ok = await confirm(`Standort "${f.name}" loeschen?`, { confirmText: 'Loeschen', danger: true });
    if (ok) { store.deleteFacility(f.id); toast('Geloescht'); }
  }));
}

function editFacDialog(fac) {
  const isNew = !fac;
  if (isNew) fac = { id: nextId('fac'), organization_id: store.state.organizations[0]?.id || '', name: '', facility_type: '', country_iso2: '', region: '', gln: '', audit_status: '', last_audit_date: '' };

  const close = showModal(`
    <form id="fac-form" class="p-6 space-y-4">
      <h3 class="text-base font-semibold text-slate-900">${isNew ? 'Standort hinzufuegen' : 'Standort bearbeiten'}</h3>
      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2"><label class="label required">Bezeichnung</label><input class="input" name="name" value="${escapeHtml(fac.name)}" required></div>
        <div><label class="label required">Organisation</label>
          <select class="select" name="organization_id">${store.state.organizations.map(o => `<option value="${o.id}" ${o.id===fac.organization_id?'selected':''}>${escapeHtml(o.trade_name || o.legal_name)}</option>`).join('')}</select>
        </div>
        <div><label class="label">Facility-Typ</label><input class="input" name="facility_type" value="${escapeHtml(fac.facility_type)}" placeholder="z.B. garment_factory"></div>
        <div><label class="label required">Land (ISO-2)</label><input class="input" name="country_iso2" maxlength="2" value="${escapeHtml(fac.country_iso2)}" required></div>
        <div><label class="label">Region</label><input class="input" name="region" value="${escapeHtml(fac.region || '')}"></div>
        <div class="col-span-2"><label class="label">GLN</label><input class="input" name="gln" maxlength="13" value="${escapeHtml(fac.gln || '')}"></div>
        <div><label class="label">Audit-Status</label><input class="input" name="audit_status" value="${escapeHtml(fac.audit_status || '')}" placeholder="SMETA / BSCI / SA8000"></div>
        <div><label class="label">Letztes Audit</label><input class="input" type="date" name="last_audit_date" value="${escapeHtml(fac.last_audit_date || '')}"></div>
      </div>
      <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
        <button type="button" class="btn btn-secondary" data-modal-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">${ICON.save}<span>Speichern</span></button>
      </div>
    </form>
  `);

  setTimeout(() => {
    document.getElementById('fac-form').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = { ...fac };
      fd.forEach((v, k) => data[k] = v);
      data.country_iso2 = (data.country_iso2 || '').toUpperCase();
      if (isNew) store.addFacility(data); else store.updateFacility(data);
      close();
      toast(isNew ? 'Standort angelegt' : 'Aenderungen gespeichert', 'success');
    });
  }, 0);
}

// ================== PRODUCTS ==================
export function products() {
  setTimeout(bindProducts, 0);
  const rows = store.state.products.map(p => {
    const org = store.state.organizations.find(o => o.id === p.owning_organization_id);
    const dppCount = store.state.dpps.filter(d => d.product_id === p.id).length;
    return `
      <tr class="hover:bg-slate-50">
        <td class="px-4 py-3 font-medium text-slate-900">${escapeHtml(p.name)}</td>
        <td class="px-4 py-3 font-mono text-xs text-slate-700">${escapeHtml(p.gtin)}</td>
        <td class="px-4 py-3 text-slate-700">${escapeHtml(p.category || '–')}</td>
        <td class="px-4 py-3 text-slate-700">${escapeHtml(org?.trade_name || org?.legal_name || '–')}</td>
        <td class="px-4 py-3 text-slate-600">${dppCount} DPP${dppCount===1?'':'s'}</td>
        <td class="px-4 py-3 text-right space-x-1">
          <button class="btn btn-ghost !text-xs" data-edit-prd="${p.id}">${ICON.edit}</button>
          <button class="btn btn-ghost !text-xs text-red-600" data-del-prd="${p.id}">${ICON.trash}</button>
        </td>
      </tr>
    `;
  }).join('');

  return crudPage({
    title: 'Produkte',
    desc: 'Produkt-Stammdaten auf Modell-/SKU-Ebene.',
    addBtnId: 'add-prd',
    addBtnLabel: 'Produkt hinzufuegen',
    headers: ['Name','GTIN','Kategorie','Organisation','DPPs',''],
    body: rows
  });
}

function bindProducts() {
  $('#add-prd')?.addEventListener('click', () => editProductDialog());
  $$('[data-edit-prd]').forEach(b => b.addEventListener('click', () => {
    const p = store.state.products.find(x => x.id === b.dataset.editPrd);
    editProductDialog(p);
  }));
  $$('[data-del-prd]').forEach(b => b.addEventListener('click', async () => {
    const p = store.state.products.find(x => x.id === b.dataset.delPrd);
    const dpps = store.state.dpps.filter(d => d.product_id === p.id);
    if (dpps.length) {
      toast(`Produkt hat ${dpps.length} DPP(s) — bitte zuerst diese loeschen.`, 'warning', 4000);
      return;
    }
    const ok = await confirm(`Produkt "${p.name}" loeschen?`, { confirmText: 'Loeschen', danger: true });
    if (ok) { store.deleteProduct(p.id); toast('Geloescht'); }
  }));
}

function editProductDialog(prd) {
  const isNew = !prd;
  if (isNew) prd = { id: nextId('prd'), name: '', gtin: '', category: '', owning_organization_id: store.state.organizations.find(o => o.organization_type === 'brand')?.id || store.state.organizations[0]?.id };

  const close = showModal(`
    <form id="prd-form" class="p-6 space-y-4">
      <h3 class="text-base font-semibold text-slate-900">${isNew ? 'Produkt hinzufuegen' : 'Produkt bearbeiten'}</h3>
      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2"><label class="label required">Name</label><input class="input" name="name" value="${escapeHtml(prd.name)}" required></div>
        <div><label class="label required">GTIN (14-stellig)</label><input class="input" name="gtin" maxlength="14" value="${escapeHtml(prd.gtin)}" required pattern="\\d{8,14}"></div>
        <div><label class="label">Kategorie</label><input class="input" name="category" value="${escapeHtml(prd.category || '')}" placeholder="tops / bottoms / accessories"></div>
        <div class="col-span-2"><label class="label required">Eigentuemer-Organisation (Brand)</label>
          <select class="select" name="owning_organization_id">${store.state.organizations.map(o => `<option value="${o.id}" ${o.id===prd.owning_organization_id?'selected':''}>${escapeHtml(o.trade_name || o.legal_name)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
        <button type="button" class="btn btn-secondary" data-modal-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">${ICON.save}<span>Speichern</span></button>
      </div>
    </form>
  `);

  setTimeout(() => {
    document.getElementById('prd-form').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = { ...prd, name: fd.get('name'), gtin: fd.get('gtin'), category: fd.get('category'), owning_organization_id: fd.get('owning_organization_id') };
      if (isNew) store.addProduct(data); else store.updateProduct(data);
      close();
      toast(isNew ? 'Produkt angelegt' : 'Aenderungen gespeichert', 'success');
    });
  }, 0);
}

// ================== USERS (read-only display) ==================
export function users() {
  const rows = store.state.users.map(u => {
    const org = store.state.organizations.find(o => o.id === u.organization_id);
    return `
      <tr class="hover:bg-slate-50">
        <td class="px-4 py-3 font-medium text-slate-900">${escapeHtml(u.display_name)}</td>
        <td class="px-4 py-3 text-slate-700">${escapeHtml(u.email)}</td>
        <td class="px-4 py-3 text-slate-700">${escapeHtml(org?.trade_name || org?.legal_name || '–')}</td>
        <td class="px-4 py-3"><span class="badge bg-blue-50 text-blue-700">${escapeHtml(u.role)}</span></td>
      </tr>`;
  }).join('');

  return `
    <h1 class="text-xl font-bold text-slate-900 mb-1">Benutzer</h1>
    <p class="text-sm text-slate-600 mb-6">Plattform-User mit Rollenzuordnung. Bearbeitung im Mockup deaktiviert &mdash; Anlage erfolgt im Identity Provider.</p>

    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="text-left px-4 py-3">Name</th>
            <th class="text-left px-4 py-3">E-Mail</th>
            <th class="text-left px-4 py-3">Organisation</th>
            <th class="text-left px-4 py-3">Rolle</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">${rows}</tbody>
      </table>
    </div>
  `;
}

// === CRUD-Page-Layout ===
function crudPage({ title, desc, addBtnId, addBtnLabel, headers, body }) {
  return `
    <div class="flex items-end justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-slate-900">${title}</h1>
        <p class="text-sm text-slate-600 mt-1">${desc}</p>
      </div>
      <button id="${addBtnId}" class="btn btn-primary">${ICON.plus}<span>${addBtnLabel}</span></button>
    </div>

    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>${headers.map(h => `<th class="text-left px-4 py-3">${h}</th>`).join('')}</tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${body || `<tr><td colspan="${headers.length}" class="px-4 py-12 text-center text-slate-500">Keine Eintraege.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}
