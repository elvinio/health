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

const DEFAULT_CATS = ['Grocery', 'Travel'];

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
    cpfSettings: { dateOfBirth: '', retirementAge: 60, monthlySalary: 0 },
    retirementSettings: { inflationRate: 2.5, investmentRate: 5.0, retirementAge: 62, deathAge: 85, monthlyExpenses: 3000 },
    _deletedIds: [],
    budgets: {},
    monthlyAgg: {},
    mortgages: [],
    ongoingExpenses: [],
    emailCatMap: [],       // [{ match: string, value: string }]
    emailCatDefault: 'Other',
    emailEventParsers: [], // [{ name, subjectContains, title, date, time?, tags? }]
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
    if (!d.cpfSettings) d.cpfSettings = { dateOfBirth: '', retirementAge: 60, monthlySalary: 0 };
    if (d.cpfSettings.retirementAge == null) d.cpfSettings.retirementAge = 60;
    if (d.cpfSettings.monthlySalary == null) d.cpfSettings.monthlySalary = 0;
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
    if (!('expenseCats' in d)) d.expenseCats = '';
    if (!d.emailCatMap) d.emailCatMap = [];
    if (!d.emailCatDefault) d.emailCatDefault = 'Other';
    if (!d.emailEventParsers) d.emailEventParsers = [];
    d.accounts.forEach(a => { if (!a._updatedAt) a._updatedAt = 0; });
    return d;
  } catch { return defaultData(); }
}

function saveData(d) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return { expenses: [] };
    const d = JSON.parse(raw);
    if (!Array.isArray(d.expenses)) d.expenses = [];
    return d;
  } catch { return { expenses: [] }; }
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
    if (e.cat === 'TopUp') return;
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
  const past = data.expenses.filter(e => !e.date.startsWith(curYear + '-'));
  if (!past.length) return;
  const existingIds = new Set(historyData.expenses.map(e => e.id));
  past.forEach(e => { if (!existingIds.has(e.id)) historyData.expenses.push(e); });
  data.expenses = data.expenses.filter(e => e.date.startsWith(curYear + '-'));
  saveHistory(historyData);
  saveData(data);
}

migrateExpenses();
recalcBalances(data, allExpenses());
recalcMonthlyAgg(data, allExpenses());

// ── Utilities ────────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function today() {
  return new Date().toISOString().slice(0, 10);
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
  const brackets = [
    [20000, 0], [10000, 0.02], [10000, 0.035], [40000, 0.07],
    [40000, 0.115], [40000, 0.15], [40000, 0.18], [40000, 0.19],
    [40000, 0.195], [40000, 0.20], [Infinity, 0.22]
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
  [35,  0.23, 0.06,  0.08],
  [45,  0.21, 0.07,  0.09],
  [50,  0.19, 0.07,  0.11],
  [55,  0.15, 0.095, 0.125],
  [60,  0.14, 0,     0.14],   // SA contributions stop after 55
  [65,  0.10, 0,     0.09],
  [70,  0.01, 0,     0.13],
  [999, 0.01, 0,     0.115],
];
const CPF_INT_OA = 0.025, CPF_INT_SA = 0.04, CPF_INT_RA = 0.04, CPF_INT_MA = 0.04;
const CPF_BHS = 75500;    // Basic Healthcare Sum (MA cap)
const CPF_FRS = 220400;   // Full Retirement Sum 2026
const CPF_ERS = Math.round(CPF_FRS * 1.5); // Enhanced Retirement Sum = 1.5× FRS
const CPF_OW_CAP = 6800;  // Ordinary Wage monthly ceiling

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
  });
});

// ── Menu ─────────────────────────────────────────────────────────────────────
document.getElementById('menuBtn').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('mainMenu').classList.toggle('open');
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
  if (currentTab === 'events') openEventSheet(null);
  else if (currentTab === 'expenses') openExpenseSheet(null);
  else if (currentTab === 'insurance') openInsuranceSheet(null);
  else if (currentTab === 'tax') {
    if (currentTaxSubTab === 'cpf') openCpfEntrySheet(null);
    else if (currentTaxSubTab === 'assets') openAssetSheet(null);
    else if (currentTaxSubTab === 'retirement') { /* no-op */ }
    else openTaxSheet(null);
  }
  else openAssetSheet(null);
});

