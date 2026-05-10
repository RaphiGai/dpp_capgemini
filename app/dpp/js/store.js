// Lightweight reactive store backed by localStorage.
// Subscribers re-render the current view on any state change.

import { SEED, LOOKUPS } from './data.js';

const STORAGE_KEY = 'dpp-mockup-state-v1';

const defaultState = () => ({
  organizations: structuredClone(SEED.organizations),
  facilities:    structuredClone(SEED.facilities),
  products:      structuredClone(SEED.products),
  users:         structuredClone(SEED.users),
  dpps:          structuredClone(SEED.dpps),
  // UI state
  persona: 'creator',          // creator | admin | consumer | authority
  activeUserId: 'usr-002',     // Miguel Silva (DPP-Editor)
  activeOrganizationId: 'org-001'
});

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not persist state', e);
  }
}

const subscribers = new Set();
let state = load();

export const store = {
  get state() { return state; },
  get lookups() { return LOOKUPS; },

  subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },

  set(partial) {
    state = { ...state, ...partial };
    persist(state);
    subscribers.forEach(fn => fn(state));
  },

  // === ORGANIZATIONS ===
  addOrganization(o)    { state.organizations.push(o);    persist(state); subscribers.forEach(fn => fn(state)); },
  updateOrganization(o) { state.organizations = state.organizations.map(x => x.id === o.id ? { ...x, ...o } : x); persist(state); subscribers.forEach(fn => fn(state)); },
  deleteOrganization(id){ state.organizations = state.organizations.filter(x => x.id !== id); persist(state); subscribers.forEach(fn => fn(state)); },

  // === FACILITIES ===
  addFacility(f)    { state.facilities.push(f);    persist(state); subscribers.forEach(fn => fn(state)); },
  updateFacility(f) { state.facilities = state.facilities.map(x => x.id === f.id ? { ...x, ...f } : x); persist(state); subscribers.forEach(fn => fn(state)); },
  deleteFacility(id){ state.facilities = state.facilities.filter(x => x.id !== id); persist(state); subscribers.forEach(fn => fn(state)); },

  // === PRODUCTS ===
  addProduct(p)    { state.products.push(p);    persist(state); subscribers.forEach(fn => fn(state)); },
  updateProduct(p) { state.products = state.products.map(x => x.id === p.id ? { ...x, ...p } : x); persist(state); subscribers.forEach(fn => fn(state)); },
  deleteProduct(id){ state.products = state.products.filter(x => x.id !== id); persist(state); subscribers.forEach(fn => fn(state)); },

  // === DPPs ===
  addDpp(d)    { state.dpps.push(d);    persist(state); subscribers.forEach(fn => fn(state)); },
  updateDpp(d) { state.dpps = state.dpps.map(x => x.id === d.id ? { ...x, ...d } : x); persist(state); subscribers.forEach(fn => fn(state)); },
  deleteDpp(id){ state.dpps = state.dpps.filter(x => x.id !== id); persist(state); subscribers.forEach(fn => fn(state)); },

  reset() {
    state = defaultState();
    persist(state);
    subscribers.forEach(fn => fn(state));
  }
};

export function nextId(prefix) {
  return `${prefix}-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
}

// Lookup label resolver
export function labelOf(category, value) {
  const list = LOOKUPS[category];
  if (!list) return value;
  const item = list.find(x => x.value === value);
  return item ? item.label : value;
}
