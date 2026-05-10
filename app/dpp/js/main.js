// Bootstrap: Layout (Sidebar + Topbar), Persona-Switching, Route-Registry.

import { store } from './store.js';
import { defineRoute, navigate, render, onRender, currentPath } from './router.js';
import { html, raw, $, ICON, toast, confirm } from './ui.js';

import * as creator   from './views/creator.js';
import * as admin     from './views/admin.js';
import * as consumer  from './views/consumer.js';
import * as authority from './views/authority.js';

// === ROUTES ===
defineRoute('/',                          () => homeView());

// Creator (DPP-Ersteller)
defineRoute('/creator',                   creator.dashboard);
defineRoute('/creator/dpp/new',           creator.wizard);
defineRoute('/creator/dpp/:id/edit',      creator.wizard);
defineRoute('/creator/dpp/:id',           creator.detail);

// Admin (Verwaltung)
defineRoute('/admin',                     admin.overview);
defineRoute('/admin/organizations',       admin.organizations);
defineRoute('/admin/facilities',          admin.facilities);
defineRoute('/admin/products',            admin.products);
defineRoute('/admin/users',               admin.users);

// Consumer (oeffentliche QR-Ansicht)
defineRoute('/consumer',                  consumer.list);
defineRoute('/consumer/dpp/:id',          consumer.detail);

// Authority (Marktaufsicht)
defineRoute('/authority',                 authority.dashboard);
defineRoute('/authority/dpp/:id',         authority.detail);

// === RENDER PIPELINE ===
onRender((route, ctx) => {
  document.getElementById('app').innerHTML = layoutShell(route.view(ctx));
  bindLayout();
});

store.subscribe(() => render());

// === LAYOUT ===
function layoutShell(viewHtml) {
  const persona = store.state.persona;
  const personaInfo = {
    creator:   { label: 'DPP-Ersteller',      desc: 'Brand / Hersteller' },
    admin:     { label: 'Verwaltung',         desc: 'Stammdaten & Rollen' },
    consumer:  { label: 'Konsument',          desc: 'Oeffentliche QR-Sicht' },
    authority: { label: 'Behoerde',           desc: 'Marktaufsicht / Audit' }
  }[persona];

  return `
    <header class="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div class="flex items-center h-14 px-4 gap-4">
        <a href="#/" class="flex items-center gap-2 group">
          <div class="w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">DPP</div>
          <div class="leading-tight">
            <div class="font-semibold text-slate-900 text-sm">DPP-Plattform</div>
            <div class="text-[11px] text-slate-500">Mockup &middot; Klick-Demo</div>
          </div>
        </a>

        <div class="ml-auto flex items-center gap-3">
          <div class="hidden md:flex items-center gap-2 text-xs">
            <span class="text-slate-500">Persona:</span>
            <select id="persona-switcher" class="select !py-1 !px-2 !text-xs !w-auto">
              <option value="creator"   ${persona==='creator'?'selected':''}>DPP-Ersteller</option>
              <option value="admin"     ${persona==='admin'?'selected':''}>Verwaltung</option>
              <option value="consumer"  ${persona==='consumer'?'selected':''}>Konsument</option>
              <option value="authority" ${persona==='authority'?'selected':''}>Behoerde</option>
            </select>
          </div>

          <button id="reset-data" class="btn btn-ghost !text-xs" title="Mockdata zuruecksetzen">${ICON.refresh}<span class="hidden md:inline">Reset</span></button>
        </div>
      </div>
    </header>

    <div class="flex flex-1 min-h-0">
      <aside class="w-60 bg-white border-r border-slate-200 flex-shrink-0 hidden md:block">
        <div class="px-4 py-4 border-b border-slate-100">
          <div class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Aktive Sicht</div>
          <div class="mt-1 font-semibold text-slate-900 text-sm">${personaInfo.label}</div>
          <div class="text-xs text-slate-500">${personaInfo.desc}</div>
        </div>
        <nav class="p-2 space-y-0.5 text-sm">
          ${navItems(persona)}
        </nav>
      </aside>

      <main class="flex-1 min-w-0 overflow-x-hidden">
        <div data-view class="p-6 max-w-[1400px] mx-auto">
          ${viewHtml}
        </div>
      </main>
    </div>
  `;
}

function navItems(persona) {
  const sections = {
    creator: [
      { path: '/creator',         label: 'Meine DPPs',          icon: ICON.dashboard },
      { path: '/creator/dpp/new', label: 'Neuen DPP anlegen',   icon: ICON.plus    }
    ],
    admin: [
      { path: '/admin',                 label: 'Uebersicht',     icon: ICON.dashboard },
      { path: '/admin/organizations',   label: 'Organisationen', icon: ICON.building },
      { path: '/admin/facilities',      label: 'Standorte',      icon: ICON.factory  },
      { path: '/admin/products',        label: 'Produkte',       icon: ICON.cube     },
      { path: '/admin/users',           label: 'Benutzer',       icon: ICON.user     }
    ],
    consumer: [
      { path: '/consumer', label: 'DPPs entdecken', icon: ICON.qr }
    ],
    authority: [
      { path: '/authority', label: 'Marktaufsicht', icon: ICON.shield }
    ]
  };
  const cur = currentPath();
  return (sections[persona] || []).map(item => {
    const active = cur === item.path || (cur.startsWith(item.path) && item.path !== '/' + persona);
    return `
      <a href="#${item.path}" class="flex items-center gap-2.5 px-3 py-2 rounded-lg ${active ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-700 hover:bg-slate-100'}">
        ${item.icon}
        <span>${item.label}</span>
      </a>
    `;
  }).join('');
}

function bindLayout() {
  const sw = $('#persona-switcher');
  if (sw) {
    sw.addEventListener('change', e => {
      const persona = e.target.value;
      store.set({ persona });
      const home = { creator: '/creator', admin: '/admin', consumer: '/consumer', authority: '/authority' }[persona];
      navigate(home);
    });
  }
  const reset = $('#reset-data');
  if (reset) {
    reset.addEventListener('click', async () => {
      const ok = await confirm('Alle Mockdaten zuruecksetzen?', { confirmText: 'Zuruecksetzen', danger: true });
      if (ok) {
        store.reset();
        toast('Mockdata zuruckgesetzt', 'success');
        navigate('/');
      }
    });
  }
}

// === HOME / Persona Picker ===
function homeView() {
  return `
    <div class="max-w-3xl mx-auto py-12">
      <h1 class="text-2xl font-bold text-slate-900 mb-2">Willkommen zur DPP-Mockup-Plattform</h1>
      <p class="text-slate-600 mb-8">
        Das ist eine Klick-Demo des Digital Product Passport. Waehlen Sie eine Persona, um die jeweilige Sicht zu erkunden.
        Aenderungen werden im Browser-Speicher gehalten – ein <em>Reset</em> stellt die Anfangsdaten wieder her.
      </p>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${personaCard('creator',   'DPP-Ersteller',  'Brand / Hersteller', 'DPPs anlegen, Materialien pflegen, Compliance-Dokumente verwalten und veroeffentlichen.', '#/creator', ICON.cube)}
        ${personaCard('admin',     'Verwaltung',     'Stammdaten & Rollen', 'Organisationen, Standorte, Produkte und Benutzer der Plattform pflegen.', '#/admin', ICON.building)}
        ${personaCard('consumer',  'Konsument',      'Oeffentliche QR-Ansicht', 'Sehen, was Konsumenten beim Scannen des Produkt-QR-Codes ueber den DPP erfahren.', '#/consumer', ICON.qr)}
        ${personaCard('authority', 'Behoerde',       'Marktaufsicht', 'Vertiefte Sicht mit Compliance-Statements, Audit-Trail und Verifikationsnachweis.', '#/authority', ICON.shield)}
      </div>

      <div class="mt-10 text-xs text-slate-500">
        <strong>Hinweis:</strong> Diese Mockup-Anwendung verarbeitet keine echten Daten. Alle GTINs, GLNs, Personen- und Firmennamen sind Beispieldaten.
      </div>
    </div>
  `;
}

function personaCard(persona, title, subtitle, body, href, icon) {
  return `
    <a href="${href}" data-persona="${persona}" class="card-hover group bg-white border border-slate-200 rounded-xl p-5 block">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">${icon}</div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-900">${title}</div>
          <div class="text-xs text-slate-500">${subtitle}</div>
        </div>
      </div>
      <p class="mt-3 text-sm text-slate-600 leading-relaxed">${body}</p>
      <div class="mt-3 text-xs font-medium text-brand-700 group-hover:underline">Zur Sicht &rarr;</div>
    </a>
  `;
}

// Click-handler for persona-card to switch persona before navigation
document.addEventListener('click', e => {
  const card = e.target.closest('[data-persona]');
  if (card) {
    const p = card.dataset.persona;
    if (store.state.persona !== p) {
      store.set({ persona: p });
    }
  }
});
