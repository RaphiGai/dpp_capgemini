// Hash-based router. Routes are functions that return HTML strings.
// Example route entry: { path: '/dpp/:id', view: ctx => '<div>...</div>', persona: 'creator' }

const routes = [];
let currentCtx = null;

export function defineRoute(path, view, options = {}) {
  routes.push({ path, view, ...options });
}

export function navigate(path) {
  if (location.hash !== '#' + path) {
    location.hash = '#' + path;
  } else {
    // Same hash → trigger anyway
    render();
  }
}

export function currentPath() {
  return (location.hash || '#/').slice(1) || '/';
}

function matchRoute(path) {
  for (const r of routes) {
    const params = {};
    const partsR = r.path.split('/').filter(Boolean);
    const partsP = path.split('?')[0].split('/').filter(Boolean);
    if (partsR.length !== partsP.length) continue;
    let ok = true;
    for (let i = 0; i < partsR.length; i++) {
      if (partsR[i].startsWith(':')) {
        params[partsR[i].slice(1)] = decodeURIComponent(partsP[i]);
      } else if (partsR[i] !== partsP[i]) {
        ok = false; break;
      }
    }
    if (ok) {
      const query = {};
      const q = path.split('?')[1];
      if (q) q.split('&').forEach(kv => {
        const [k, v] = kv.split('=');
        query[k] = decodeURIComponent(v || '');
      });
      return { route: r, params, query };
    }
  }
  return null;
}

let renderCallback = null;

export function onRender(cb) { renderCallback = cb; }

export function render() {
  const path = currentPath();
  const match = matchRoute(path);
  if (!match) {
    document.getElementById('app').innerHTML = `
      <div class="flex items-center justify-center h-screen text-slate-500">
        Route nicht gefunden: ${path}
      </div>`;
    return;
  }
  currentCtx = { ...match.params, query: match.query, path };
  if (renderCallback) renderCallback(match.route, currentCtx);
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

export function ctx() { return currentCtx; }
