// ── Theme ─────────────────────────────────────────────────────────────────────
const THEMES = [
  { id: 'earth',  label: 'Earth',  bg: '#faf6ee', primary: '#8b5e3c' },
  { id: 'navy',   label: 'Navy',   bg: '#f0f4f8', primary: '#1b3a6b' },
  { id: 'pastel', label: 'Pastel', bg: '#fff5f7', primary: '#d4729a' },
];

function applyTheme(id) {
  document.documentElement.className = 'theme-' + id;
  localStorage.setItem('finance:theme', id);
  document.querySelector('meta[name="theme-color"]').content =
    (THEMES.find(t => t.id === id) || THEMES[0]).primary;
  renderThemePicker();
}

function openThemePicker() {
  document.getElementById('mainMenu').classList.remove('open');
  renderThemePicker();
  openSheet('themeSheet');
}

function renderThemePicker() {
  const el = document.getElementById('themeList');
  if (!el) return;
  const current = localStorage.getItem('finance:theme') || 'navy';
  el.innerHTML = THEMES.map(t => `
    <button class="theme-option${t.id === current ? ' active' : ''}"
            onclick="applyTheme('${t.id}')">
      <div class="theme-swatch"
           style="background:linear-gradient(135deg,${t.bg} 50%,${t.primary} 50%)"></div>
      <span>${t.label}</span>
      ${t.id === current ? '<span class="theme-check">✓</span>' : ''}
    </button>
  `).join('');
}

(function() {
  const saved = localStorage.getItem('finance:theme') || 'navy';
  document.documentElement.className = 'theme-' + saved;
  document.querySelector('meta[name="theme-color"]').content =
    (THEMES.find(t => t.id === saved) || THEMES[0]).primary;
})();

const DEFAULT_CATS = ['Grocery', 'Travel', 'Income Tax', 'Allowance'];

// Asset classes for allocation. "Home (own use)" is counted in net worth but
// excluded from investable assets / retirement drawdown (you can't sell the roof
// over your family's head to fund retirement).
const ASSET_CLASSES = ['Cash', 'Equities', 'Bonds', 'Gold', 'Property (rental)', 'Home (own use)', 'Crypto', 'Commodities', 'CPF', 'Other'];
const NON_INVESTABLE_CLASSES = ['Home (own use)'];
function assetClass(a) { return a.class || 'Other'; }
function isInvestable(a) { return !NON_INVESTABLE_CLASSES.includes(assetClass(a)); }

function parseCatEmojis() {
  const map = {};
  (data.expenseCats || '').split(',').forEach(part => {
    const s = part.trim();
    if (!s) return;
    const sp = s.indexOf(' ');
    if (sp < 1) return;
    const emoji = s.slice(0, sp).trim();
    const name = s.slice(sp + 1).trim();
    if (emoji && name) map[name] = emoji;
  });
  return map;
}

function expenseCatDefaults() {
  const names = (data.expenseCats || '').split(',').map(part => {
    const s = part.trim();
    const sp = s.indexOf(' ');
    return sp > 0 ? s.slice(sp + 1).trim() : s;
  }).filter(Boolean);
  return names.length ? names : DEFAULT_CATS;
}

// ── Storage ──────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'finance:v1';
const DRIVE_FILE_KEY = 'finance:driveFileId';
const DRIVE_CLIENT_KEY = 'finance:googleClientId';
const DRIVE_LOGIN_HINT_KEY = 'finance:googleLoginHint';
const HISTORY_KEY = 'finance:v1:history';
const DRIVE_HISTORY_FILE_KEY = 'finance:driveHistoryFileId';
const BUS_API_KEY_STORAGE = 'finance:busApiKey';
const BUS_PROXY_URL_STORAGE = 'finance:busProxyUrl';
const BUS_STOPS = [
  { code: '83121', name: 'Nature Mansions', services: ['15', '150', '155'] },
  { code: '83129', name: 'Ji Xiang Court',  services: ['15', '150'] },
  { code: '92229', name: 'Blk 53',          services: ['150'] },
  { code: '92049', name: 'Parkway Center',  services: ['15'] },
  { code: '92041', name: 'Opp Parkway',     services: ['15'] },
  { code: '82061', name: 'Eunos Station',   services: ['150', '155'] },
];
const BUS_API_URL = 'https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival';
let busPollingInterval = null;

function defaultData() {
  return {
    accounts: [
      { id: 'acc1', name: 'Account 1', startingBalance: 0, balance: 0, _updatedAt: 0 },
      { id: 'acc2', name: 'Account 2', startingBalance: 0, balance: 0, _updatedAt: 0 }
    ],
    expenses: [],
    assets: [],
    events: [],
    insurances: [],
    taxRecords: [],
    cpfRecords: [],
    cpfSettings: { dateOfBirth: '' },
    retirementSettings: { inflationRate: 2.5, investmentRate: 5.0, retirementAge: 62, deathAge: 85, monthlyExpenses: 3000, annualSavings: 150000, safeWithdrawalRate: 4.0 },
    _deletedIds: [],
    budgets: {},
    monthlyAgg: {},
    mortgages: [],
    ongoingExpenses: [],
    emailCatMap: [],       // [{ match: string, value: string }]
    emailCatDefault: 'Other',
    netWorthSnapshots: [], // [{ key: 'YYYY-MM-DD', date, liquid, assets, cpf, debt, net, _ts }]
    aiReport: null,        // { markdown, generatedAt, period }
    customAiPrompt: null,  // string | null — user-edited prompt template (null = use default)
    dependents: [],        // [{ id, name, relationship, birthYear, sex, _ts }]
    allocationRatios: {},  // { Equities: 40, Bonds: 20, ... } target allocation %
    medicalVisits: [],     // [{ id, title, person, description, date, amount, paymentType, _ts }]
    notes: [],             // [{ id, title, content, _updatedAt }]
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const d = JSON.parse(raw);
    if (!d.accounts) d.accounts = defaultData().accounts;
    if (!d.expenses) d.expenses = [];
    if (!d.assets) d.assets = [];
    if (!d.events) d.events = [];
    if (!d.insurances) d.insurances = [];
    if (!d.taxRecords) d.taxRecords = [];
    if (!d.cpfRecords) d.cpfRecords = [];
    if (!d.cpfSettings) d.cpfSettings = { dateOfBirth: '' };
    if (d.cpfSettings.lifeExpectancy == null) d.cpfSettings.lifeExpectancy = 85;
    if (d.cpfSettings.ersGrowthRate == null) d.cpfSettings.ersGrowthRate = 3.5;
    if (d.cpfSettings.mortalityFactor == null) d.cpfSettings.mortalityFactor = 1.35;
    if (!d._deletedIds) d._deletedIds = [];
    if (!d.budgets) d.budgets = {};
    if (!d.monthlyAgg) d.monthlyAgg = {};
    if (!d.mortgages) d.mortgages = [];
    if (!d.ongoingExpenses) d.ongoingExpenses = [];
    if (!d.retirementSettings) d.retirementSettings = { inflationRate: 2.5, investmentRate: 5.0, retirementAge: 62, deathAge: 85, monthlyExpenses: 3000 };
    if (d.retirementSettings.inflationRate == null) d.retirementSettings.inflationRate = 2.5;
    if (d.retirementSettings.investmentRate == null) d.retirementSettings.investmentRate = 5.0;
    if (d.retirementSettings.retirementAge == null) d.retirementSettings.retirementAge = 62;
    if (d.retirementSettings.deathAge == null) d.retirementSettings.deathAge = 85;
    if (d.retirementSettings.monthlyExpenses == null) d.retirementSettings.monthlyExpenses = 3000;
    if (d.retirementSettings.annualSavings == null) d.retirementSettings.annualSavings = 150000;
  if (d.retirementSettings.safeWithdrawalRate == null) d.retirementSettings.safeWithdrawalRate = 4.0;
    if (!('expenseCats' in d)) d.expenseCats = '';
    if (!d.emailCatMap) d.emailCatMap = [];
    if (!d.emailCatDefault) d.emailCatDefault = 'Other';
    if (!d.netWorthSnapshots) d.netWorthSnapshots = [];
    if (!('aiReport' in d)) d.aiReport = null;
    if (!('customAiPrompt' in d)) d.customAiPrompt = null;
    if (!d.dependents) d.dependents = [];
    if (!d.allocationRatios) d.allocationRatios = {};
    if (!d.medicalVisits) d.medicalVisits = [];
    if (!d.notes) d.notes = [];
    if (d.expenseCats) d.expenseCats = d.expenseCats.replace(/\bMisc\b/g, 'Income Tax');
    d.expenses.forEach(e => { if (e.cat === 'Misc') e.cat = 'Income Tax'; });
    if (d.budgets && d.budgets['Misc'] !== undefined) {
      if (!d.budgets['Income Tax']) d.budgets['Income Tax'] = d.budgets['Misc'];
      delete d.budgets['Misc'];
    }
    if (d.emailCatMap) d.emailCatMap.forEach(r => { if (r.value === 'Misc') r.value = 'Income Tax'; });
    d.accounts.forEach(a => { if (!a._updatedAt) a._updatedAt = 0; });
    return d;
  } catch { return defaultData(); }
}

function saveData(d) {
  if (Array.isArray(d._deletedIds) && d._deletedIds.length > 500) {
    d._deletedIds = d._deletedIds.slice(-500);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return { expenses: [], powerRecords: [] };
    const d = JSON.parse(raw);
    if (!Array.isArray(d.expenses)) d.expenses = [];
    if (!Array.isArray(d.powerRecords)) d.powerRecords = [];
    d.expenses.forEach(e => { if (e.cat === 'Misc') e.cat = 'Income Tax'; });
    return d;
  } catch { return { expenses: [], powerRecords: [] }; }
}

function saveHistory(h) {
  h._updatedAt = Date.now();
  data.historyUpdatedAt = h._updatedAt;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}

function recalcBalances(d, expenses) {
  const exps = expenses !== undefined ? expenses : d.expenses;
  d.accounts.forEach(acc => {
    const net = exps
      .filter(e => e.ac === acc.id)
      .reduce((s, e) => s + (e.cat === 'TopUp' ? -e.amount : e.amount), 0);
    acc.balance = acc.startingBalance - net;
  });
}

function recalcMonthlyAgg(d, expenses) {
  const exps = expenses !== undefined ? expenses : d.expenses;
  d.monthlyAgg = {};
  exps.forEach(e => {
    if (!e.date || !e.cat || e.cat === 'TopUp') return;
    const m = e.date.slice(0, 7);
    if (!d.monthlyAgg[m]) d.monthlyAgg[m] = {};
    d.monthlyAgg[m][e.cat] = (d.monthlyAgg[m][e.cat] || 0) + e.amount;
  });
}

let data = loadData();
let historyData = loadHistory();

function allExpenses() {
  return [...historyData.expenses, ...data.expenses];
}

function migrateExpenses() {
  const curYear = String(new Date().getFullYear());
  const past = data.expenses.filter(e => e.date && !e.date.startsWith(curYear + '-'));
  if (!past.length) return;
  const existingIds = new Set(historyData.expenses.map(e => e.id));
  past.forEach(e => { if (!existingIds.has(e.id)) historyData.expenses.push(e); });
  data.expenses = data.expenses.filter(e => e.date && e.date.startsWith(curYear + '-'));
  saveHistory(historyData);
  saveData(data);
}

migrateExpenses();
recalcBalances(data, allExpenses());
recalcMonthlyAgg(data, allExpenses());

// ── Utilities ────────────────────────────────────────────────────────────────
function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Local YYYY-MM-DD for a Date (avoids the UTC shift that toISOString() introduces,
// which can mis-bucket entries by a day near midnight in timezones like SGT/UTC+8).
function localDateStr(d) {
  const dt = d || new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function today() {
  return localDateStr();
}

function fmt(n) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtCurrency(n) {
  return (n < 0 ? '-' : '') + '$' + fmt(Math.abs(n));
}

function fmtDollar(n) {
  const r = Math.round(n);
  return (r < 0 ? '-' : '') + '$' + new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(r));
}

function showToast(msg, dur = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), dur);
}

// ── Singapore Income Tax ──────────────────────────────────────────────────────
function calcSGTax(chargeableIncome) {
  if (chargeableIncome <= 0) return 0;
  // IRAS resident rates, YA 2024 onwards. Bands: [width, marginalRate].
  // First $320k taper, then $320k–$500k @ 22%, $500k–$1M @ 23%, >$1M @ 24%.
  const brackets = [
    [20000, 0], [10000, 0.02], [10000, 0.035], [40000, 0.07],
    [40000, 0.115], [40000, 0.15], [40000, 0.18], [40000, 0.19],
    [40000, 0.195], [40000, 0.20], [180000, 0.22], [500000, 0.23],
    [Infinity, 0.24]
  ];
  let remaining = chargeableIncome, tax = 0;
  for (const [band, rate] of brackets) {
    if (remaining <= 0) break;
    tax += Math.min(remaining, band) * rate;
    remaining -= Math.min(remaining, band);
  }
  return tax;
}

// ── CPF Singapore Constants ───────────────────────────────────────────────────
// Source: CPF Board official rates (2024)
const CPF_CONTRIB = [
  // [maxAge exclusive, employeeRate, employerRate]
  [55,  0.20, 0.17],
  [60,  0.13, 0.15],
  [65,  0.075, 0.115],
  [70,  0.05, 0.09],
  [999, 0.05, 0.075],
];
const CPF_ALLOC = [
  // [maxAge exclusive, OA% of salary, SA% of salary, MA% of salary]
  // SA fractions within total 37%: age 35-45 → 0.1891, age 46-50 → 0.2162, age 51-55 → 0.3108
  [35,  0.23,  0.06,  0.08 ],  // age < 35
  [46,  0.21,  0.07,  0.09 ],  // age 35-45: SA 7%   (0.1891 × 37%)
  [51,  0.19,  0.08,  0.10 ],  // age 46-50: SA 8%   (0.2162 × 37%)
  [56,  0.15,  0.115, 0.105],  // age 51-55: SA 11.5% (0.3108 × 37%)
  [60,  0.14,  0,     0.14 ],  // SA contributions stop after 55
  [65,  0.10,  0,     0.09 ],
  [70,  0.01,  0,     0.13 ],
  [999, 0.01,  0,     0.115],
];
const CPF_INT_OA = 0.025, CPF_INT_SA = 0.04, CPF_INT_RA = 0.04, CPF_INT_MA = 0.04;
const CPF_BHS = 75500;    // Basic Healthcare Sum (MA cap)
const CPF_FRS = 220400;   // Full Retirement Sum 2026
const CPF_ERS = Math.round(CPF_FRS * 1.5); // Enhanced Retirement Sum = 1.5× FRS
const CPF_OW_CAP = 8000;  // Ordinary Wage monthly ceiling (2026)

// CPF LIFE monthly payout factor per $1 of RA. Payout always starts at age 65.
// Uses annuity formula (4% annual) with configurable life expectancy and mortality-credit multiplier.
function cpfLifeMonthlyFactor(lifeExp, mortalityFactor) {
  const r = 0.04 / 12;
  const n = Math.max(60, (lifeExp - 65) * 12);
  return (r / (1 - Math.pow(1 + r, -n))) * mortalityFactor;
}

function cpfContrib(age) {
  for (const [max, emp, er] of CPF_CONTRIB) if (age < max) return { emp, er };
  return { emp: 0.05, er: 0.075 };
}
function cpfAlloc(age) {
  for (const [max, oa, sa, ma] of CPF_ALLOC) if (age < max) return { oa, sa, ma };
  return { oa: 0.01, sa: 0, ma: 0.115 };
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
let currentTab = 'events';

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + currentTab));
    renderAll();
    if (currentTab === 'tax') maybeShowTaxPin();
  });
});

// ── Menu ─────────────────────────────────────────────────────────────────────
document.getElementById('menuBtn').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('mainMenu').classList.toggle('open');
  caches.keys().then(keys => {
    const v = keys.find(k => k.startsWith('finance-v')) || 'uncached';
    document.getElementById('swVersionLabel').textContent = v;
  }).catch(() => {});
});
document.addEventListener('click', () => document.getElementById('mainMenu').classList.remove('open'));

// ── Bottom Sheet helpers ──────────────────────────────────────────────────────
let activeSheet = null;

function openSheet(id) {
  closeSheet();
  activeSheet = document.getElementById(id);
  document.getElementById('backdrop').classList.add('open');
  activeSheet.classList.add('open');
}

function closeSheet() {
  if (activeSheet) {
    activeSheet.classList.remove('open');
    activeSheet = null;
  }
  document.getElementById('backdrop').classList.remove('open');
}

document.getElementById('backdrop').addEventListener('click', closeSheet);

// ── FAB ──────────────────────────────────────────────────────────────────────
document.getElementById('fabBtn').addEventListener('click', () => {
  if (currentTab === 'events') {
    if (eventViewMode === 'notes') openNoteSheet(null);
    else openEventSheet(null);
  }
  else if (currentTab === 'expenses') openExpenseSheet(null);
  else if (currentTab === 'insurance') {
    if (currentInsSubTab === 'medical') openMedicalSheet(null);
    else openInsuranceSheet(null);
  }
  else if (currentTab === 'analysis') {
    if (currentAnalysisSubTab === 'power') openPowerSheet(null);
  }
  else if (currentTab === 'tax') {
    if (currentTaxSubTab === 'cpf') openCpfEntrySheet(null);
    else if (currentTaxSubTab === 'assets') openAssetSheet(null);
    else if (currentTaxSubTab === 'retirement') { /* no-op */ }
    else openTaxSheet(null);
  }
});

