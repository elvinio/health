'use strict';

// Minimal test harness for the Finance PWA's pure logic.
//
// The app ships as plain <script src> files that share one global scope and
// have no module exports, so we can't `require()` them directly. Instead we
// concatenate the files that hold the pure logic, run them once inside a Node
// `vm` sandbox with lightweight browser stubs, and expose the functions (plus
// accessors for the global `data` / `historyData`) through a footer object.
//
// Only the files needed by the tested functions are loaded; finance-app.js and
// the other UI-only files are skipped (their bottom-of-file init would run DOM
// rendering and service-worker registration on load).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// Browser-coupled top-level code (mostly `getElementById(id).addEventListener`)
// runs when each file loads. A self-returning, callable Proxy lets every such
// chain (`.addEventListener(...)`, `.classList.add(...)`, `.style.x = ...`)
// no-op without throwing.
function domStub() {
  const handler = {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive || prop === Symbol.iterator) return undefined;
      if (prop === 'length') return 0;
      return el;
    },
    set() { return true; },
    apply() { return el; },
  };
  const el = new Proxy(function () {}, handler);
  return el;
}

const documentStub = {
  getElementById: () => domStub(),
  querySelector: () => domStub(),
  querySelectorAll: () => [],
  createElement: () => domStub(),
  addEventListener: () => {},
  body: domStub(),
  documentElement: domStub(),
};

// In-memory localStorage so save* calls are harmless and round-trip if needed.
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

// Files holding the pure logic under test, in browser load order. Order only
// matters for top-level executed statements (finance-core sets up `data`);
// function declarations are hoisted across the combined script.
const FILES = [
  'finance-core.js',
  'finance-investments.js',
  'finance-insurance.js',
  'finance-tax.js',
  'finance-drive.js',
];

// Names re-exported to tests. Setters let a test install fixture data before
// calling functions that read the global `data` / `historyData`.
const FOOTER = `
globalThis.__finance = {
  calcSGTax, calcCpfProjection, calcRetirementPlan, mergeData, getOngoingDueInfo,
  localDateStr, recalcBalances, recalcMonthlyAgg, defaultData, allExpenses,
  mergeHistoryData: (typeof mergeHistoryData !== 'undefined') ? mergeHistoryData : undefined,
  mergeWikiData: (typeof mergeWikiData !== 'undefined') ? mergeWikiData : undefined,
  setData: (v) => { data = v; },
  getData: () => data,
  setHistory: (v) => { historyData = v; },
  getHistory: () => historyData,
};
`;

function loadFinance() {
  const header = 'var window = (typeof window !== "undefined") ? window : globalThis;\n';
  const source = header
    + FILES.map((f) => `\n//# file: ${f}\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
    + FOOTER;

  const sandbox = {
    console,
    document: documentStub,
    localStorage: makeLocalStorage(),
    navigator: { serviceWorker: { register: () => Promise.resolve() }, onLine: true },
    location: { href: '', search: '', reload: () => {} },
    crypto: globalThis.crypto,
    fetch: () => Promise.reject(new Error('fetch disabled in tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    alert: () => {}, confirm: () => true, prompt: () => null,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'finance-bundle.js' });
  return context.__finance;
}

module.exports = { loadFinance };
