// ── AI Financial Advisor ──────────────────────────────────────────────────────
// Builds a compact, AI-ready summary of the consolidated finances (net worth,
// cash flow, expenses, assets, mortgages, CPF, tax, retirement) that can be fed
// to an AI model — either manually (copy → paste into Claude) or automatically
// (an Apps Script reads finance-elvis-summary.json from Drive, calls the Claude
// API, and writes finance-elvis-report.json back). The resulting markdown report
// is displayed at the top of the Analysis tab.

const AI_SUMMARY_FILENAME = 'finance-elvis-summary.json';
const AI_REPORT_FILENAME = 'finance-elvis-report.json';
const AI_SUMMARY_FILE_KEY = 'finance:driveSummaryFileId';
const AI_REPORT_FILE_KEY = 'finance:driveReportFileId';
const ONGOING_ANNUAL_MULT = { monthly: 12, quarterly: 4, annual: 1, weekly: 52, yearly: 1 };

// ── Period helpers ────────────────────────────────────────────────────────────
function currentQuarter(d) {
  const now = d || new Date();
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return { year: y, q, key: `${y}-Q${q}`, label: `Q${q} ${y}` };
}

function monthQuarterKey(m) {            // m = 'YYYY-MM'
  const mm = parseInt(m.slice(5, 7), 10);
  return `${m.slice(0, 4)}-Q${Math.floor((mm - 1) / 3) + 1}`;
}

function lastNMonthKeys(n) {
  const keys = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    keys.push(d.toISOString().slice(0, 7));
    d.setMonth(d.getMonth() - 1);
  }
  return keys;
}

// ── Building blocks ───────────────────────────────────────────────────────────
function mortgageBalance(m) {
  const bals = (m.entries || []).filter(e => e.type === 'balance').sort((a, b) => b.date.localeCompare(a.date));
  return bals.length ? bals[0].amount : (m.principal || 0);
}

// Current net worth = liquid (accounts) + assets + CPF − mortgage debt.
function computeNetWorth() {
  const liquid = (data.accounts || []).reduce((s, a) => s + (a.balance || 0), 0);
  const assets = (data.assets || []).reduce((s, a) => s + (a.class === 'CPF' ? 0 : currentValue(a)), 0);
  const investableAssets = (data.assets || []).reduce((s, a) => s + (isInvestable(a) && a.class !== 'CPF' ? currentValue(a) : 0), 0);
  const cpf = latestCpfBalances().total;
  const debt = (data.mortgages || []).reduce((s, m) => s + mortgageBalance(m), 0);
  return {
    liquid: Math.round(liquid),
    assets: Math.round(assets),
    investableAssets: Math.round(investableAssets),
    cpf: Math.round(cpf),
    debt: Math.round(debt),
    net: Math.round(liquid + assets + cpf - debt)
  };
}

// Quarter date bounds for a given Date (start inclusive, next-quarter start exclusive).
function quarterBounds(d) {
  const now = d || new Date();
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3) + 1;
  const start = `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
  const nextStart = q === 4 ? `${y + 1}-01-01` : `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  return { start, nextStart };
}

// Persist net-worth snapshots so trends accumulate. Auto-records at most one per
// quarter (on load); the manual "Snapshot now" button (force) captures a point for
// today on demand, so you can build a trend whenever you update balances.
function recordNetWorthSnapshot(force) {
  if (!data.netWorthSnapshots) data.netWorthSnapshots = [];
  const nw = computeNetWorth();
  if (!force && !nw.liquid && !nw.assets && !nw.cpf && !nw.debt) return false;
  const { start, nextStart } = quarterBounds();
  const hasThisQuarter = data.netWorthSnapshots.some(s => s.date >= start && s.date < nextStart);
  if (!force && hasThisQuarter) return false;
  const date = today();
  const existing = data.netWorthSnapshots.find(s => s.date === date);
  const snap = { key: date, date, ...nw, _ts: Date.now() };
  if (existing) Object.assign(existing, snap);
  else data.netWorthSnapshots.push(snap);
  data.netWorthSnapshots.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  saveData(data);
  return true;
}

// Manual capture from the AI card.
function snapshotNetWorthNow() {
  recordNetWorthSnapshot(true);
  if (currentTab === 'analysis') renderAnalysis();
  showToast('Net worth snapshot saved: ' + fmtDollar(computeNetWorth().net));
}

// Average monthly spend, savings rate.
function computeCashflow() {
  const months = lastNMonthKeys(12);
  const agg = data.monthlyAgg || {};
  let spendTotal = 0;
  let monthsWithData = 0;
  months.forEach(m => {
    const cats = agg[m];
    if (cats) {
      const total = Object.values(cats).reduce((a, b) => a + b, 0);
      if (total !== 0) monthsWithData++;
      spendTotal += total;
    }
  });
  const avgMonthlyExpense = spendTotal / (monthsWithData || 1);

  // Derive monthly income from the latest tax estimate year (basicSalary + bonus) / 12.
  let taxMonthlyIncome = 0;
  const latestTaxRec = (data.taxRecords || []).slice().sort((a, b) => b.year - a.year)
    .find(r => !r.isHistorical);
  if (latestTaxRec) {
    taxMonthlyIncome = ((latestTaxRec.basicSalary || 0) + (latestTaxRec.bonus || 0)) / 12;
  }

  const savingsRate = taxMonthlyIncome > 0 ? (taxMonthlyIncome - avgMonthlyExpense) / taxMonthlyIncome : null;

  return {
    avgMonthlyExpense: Math.round(avgMonthlyExpense),
    taxMonthlyIncome: Math.round(taxMonthlyIncome),
    savingsRate: savingsRate == null ? null : Math.round(savingsRate * 1000) / 1000,
  };
}

function annualRecurring() {
  return (data.ongoingExpenses || []).reduce((s, o) =>
    s + (o.amount || 0) * (ONGOING_ANNUAL_MULT[o.frequency] || 12), 0);
}

// ── The consolidated summary object ───────────────────────────────────────────
function buildAiSummary() {
  const period = currentQuarter();
  const agg = data.monthlyAgg || {};

  // Expense totals per quarter (last 8 quarters).
  const quarterTotals = {};
  Object.entries(agg).forEach(([m, cats]) => {
    const qk = monthQuarterKey(m);
    quarterTotals[qk] = (quarterTotals[qk] || 0) + Object.values(cats).reduce((a, b) => a + b, 0);
  });
  const recentQuarters = {};
  Object.keys(quarterTotals).sort().slice(-8).forEach(k => { recentQuarters[k] = Math.round(quarterTotals[k]); });

  // Category breakdown — this quarter and year-to-date.
  const catThisQuarter = {}, catYTD = {};
  const yr = String(period.year);
  Object.entries(agg).forEach(([m, cats]) => {
    Object.entries(cats).forEach(([cat, amt]) => {
      if (monthQuarterKey(m) === period.key) catThisQuarter[cat] = Math.round((catThisQuarter[cat] || 0) + amt);
      if (m.startsWith(yr + '-')) catYTD[cat] = Math.round((catYTD[cat] || 0) + amt);
    });
  });

  // Budget vs actual YTD.
  const budgets = data.budgets || {};
  const monthsElapsed = new Date().getMonth() + 1;
  const budgetVsActual = Object.entries(budgets).filter(([, b]) => b > 0).map(([cat, monthly]) => ({
    cat, budgetYTD: Math.round(monthly * monthsElapsed), actualYTD: catYTD[cat] || 0
  }));

  // Assets with class + allocation share.
  const assetSum = (data.assets || []).reduce((s, a) => s + currentValue(a), 0);
  const investableSum = (data.assets || []).reduce((s, a) => s + (isInvestable(a) ? currentValue(a) : 0), 0);
  const assetTotal = assetSum || 1;
  const assets = (data.assets || []).map(a => {
    const v = currentValue(a);
    return { name: a.name, class: assetClass(a), value: Math.round(v), share: Math.round((v / assetTotal) * 1000) / 10 };
  }).sort((x, y) => y.value - x.value);
  const byClass = {};
  (data.assets || []).forEach(a => { const c = assetClass(a); byClass[c] = Math.round((byClass[c] || 0) + currentValue(a)); });

  // Mortgages.
  const mortgages = (data.mortgages || []).map(m => ({
    name: m.name,
    balance: Math.round(mortgageBalance(m)),
    principal: Math.round(m.principal || 0),
    interestRate: m.interestRate || 0,
    monthlyInstallment: typeof mortgageMonthlyInstallment === 'function' ? Math.round(mortgageMonthlyInstallment(m)) : null,
    tenorYears: m.tenorYears || null
  }));

  // Latest income-tax estimate — including gross annual income and relief items.
  let tax = null;
  const taxRecs = (data.taxRecords || []).slice().sort((a, b) => b.year - a.year);
  const currentEstimateRec = taxRecs.find(r => !r.isHistorical);
  if (taxRecs.length && typeof calcEffectiveTax === 'function') {
    const r = taxRecs[0];
    try {
      const annualIncome = r.isHistorical
        ? (r.totalIncome || 0)
        : (r.basicSalary || 0) + (r.bonus || 0) + (r.otherIncome || 0);
      const reliefItems = [];
      if (!r.isHistorical) {
        if (r.cpfEmployee) reliefItems.push({ name: 'CPF Employee Contribution', amount: Math.round(r.cpfEmployee) });
        (r.reliefs || []).forEach(rel => { if (rel.name || rel.amount) reliefItems.push({ name: rel.name || '', amount: Math.round(rel.amount || 0) }); });
      }
      const totalRelief = reliefItems.reduce((s, x) => s + x.amount, 0);
      tax = {
        year: r.year,
        annualIncome: Math.round(annualIncome),
        totalRelief: totalRelief || undefined,
        reliefItems: reliefItems.length ? reliefItems : undefined,
        taxRebate: r.taxRebate || undefined,
        estimatedTaxPayable: Math.round(calcEffectiveTax(r))
      };
    } catch (e) { /* ignore */ }
  }

  // Retirement drawdown.
  let retirement = null;
  try {
    const rp = calcRetirementPlan();
    retirement = {
      currentAge: rp.currentAge,
      retireAge: data.retirementSettings.retirementAge,
      deathAge: data.retirementSettings.deathAge,
      currentAssets: Math.round(rp.currentAssets),
      projectedPortfolioAtRetirement: Math.round(rp.retirementPortfolio),
      sustainableMonthlyWithdrawalToday: Math.round((rp.W_real || 0) / 12),
      cpfAnnualPayout: Math.round(rp.cpfAnnualPayout || 0),
      avgMonthlyExpensesAccumulation: Math.round(computeCashflow().avgMonthlyExpense || data.retirementSettings.monthlyExpenses || 0),
      investmentRate: data.retirementSettings.investmentRate,
      inflationRate: data.retirementSettings.inflationRate
    };
  } catch (e) { /* ignore */ }

  // Household / dependents.
  const yrNow = new Date().getFullYear();
  const household = {
    dependents: (data.dependents || []).map(d => ({
      relationship: d.relationship || 'Other',
      age: d.birthYear ? yrNow - d.birthYear : null,
      sex: d.sex || null
    }))
  };

  // Insurance overview.
  const insByCategory = {};
  let insAnnual = 0;
  const insPolicies = (data.insurances || []).map(i => {
    const mult = i.paymentFrequency === 'annual' ? 1 : i.paymentFrequency === 'quarterly' ? 4 : 12;
    const annual = Math.round((parseFloat(i.paymentAmount) || 0) * mult);
    insAnnual += annual;
    const cat = i.category || 'Other';
    insByCategory[cat] = (insByCategory[cat] || 0) + annual;
    return { name: i.name, category: cat, personInsured: i.personInsured || '', annualPremium: annual, details: i.details || '' };
  });

  return {
    _schema: 1,
    currency: 'SGD',
    generatedAt: new Date().toISOString(),
    period: period.key,
    cashflow: computeCashflow(),
    insurance: {
      totalAnnualPremium: Math.round(insAnnual),
      byCategory: insByCategory,
      policies: insPolicies
    },
    expenses: {
      thisQuarterByCategory: catThisQuarter,
      ytdByCategory: catYTD,
      quarterTotals: recentQuarters,
      budgetVsActualYTD: budgetVsActual
    },
    household,
    assets: { total: Math.round(assetSum), investable: Math.round(investableSum), byClass, allocationTargets: data.allocationRatios || {}, holdings: assets },
    mortgages,
    tax,
    retirement
  };
}

// ── The instruction prompt for the AI ─────────────────────────────────────────
const DEFAULT_AI_PROMPT = `You are a Singapore-based personal financial advisor. Below is a JSON snapshot of my consolidated finances for {period} (all amounts in SGD). Write me a concise quarterly review in GitHub-flavoured Markdown with these sections:

1. **Executive summary** — 2-3 sentences on overall financial health.
2. **Cash flow & savings** — assess my savings rate (use annualIncome from the tax field as gross income) and spending vs budget.
3. **Spending** — notable categories, trends across quarters, and any recurring/subscription costs worth reviewing.
4. **Mortgage & debt** — payoff trajectory and whether prepayment makes sense.
5. **Asset allocation** — comment on diversification across asset classes (note: my own-home is excluded from investable assets since I can't sell it).
6. **CPF & retirement readiness** — progress toward FRS/ERS, projected CPF LIFE payout, and whether my sustainable retirement withdrawal (based on investable assets) covers my target expenses.
7. **Family & protection** — given my dependents (ages/sex in the data), comment on insurance coverage adequacy, education planning, and any Singapore tax reliefs I may be eligible for.
8. **Tax** — brief note on my income-tax position and relief opportunities.
9. **Action items** — 3 to 5 specific, prioritised next steps.
10. **Risks & gaps** — anything missing from the data I should start tracking.

Be specific and quantitative, reference the actual numbers, and keep it under ~700 words. Respond with ONLY the Markdown report (no preamble).`;

function aiReportPrompt() {
  const { label } = currentQuarter();
  const template = (data.customAiPrompt && data.customAiPrompt.trim()) || DEFAULT_AI_PROMPT;
  const promptText = template.replace(/\{period\}/g, label);
  return `${promptText}

\`\`\`json
${JSON.stringify(buildAiSummary(), null, 2)}
\`\`\``;
}

// ── Custom prompt modal ───────────────────────────────────────────────────────
function openCustomPromptSheet() {
  document.getElementById('customPromptText').value =
    (data.customAiPrompt && data.customAiPrompt.trim()) || DEFAULT_AI_PROMPT;
  openSheet('customPromptSheet');
}

function resetCustomPrompt() {
  document.getElementById('customPromptText').value = DEFAULT_AI_PROMPT;
}

function saveCustomPrompt() {
  const val = document.getElementById('customPromptText').value.trim();
  data.customAiPrompt = val || null;
  data._customAiPromptTs = Date.now();
  saveData(data);
  closeSheet();
  showToast('Prompt saved');
}

// ── Manual path: copy / download summary ──────────────────────────────────────
function copyAiSummary() {
  const text = aiReportPrompt();
  navigator.clipboard.writeText(text)
    .then(() => showToast('Prompt + summary copied — paste into Claude'))
    .catch(() => { downloadAiSummary(); });
}

function downloadAiSummary() {
  const blob = new Blob([JSON.stringify(buildAiSummary(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = AI_SUMMARY_FILENAME;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Summary downloaded');
}

// ── Manual path: paste the report back ────────────────────────────────────────
function openAiReportPaste() {
  document.getElementById('aiReportText').value = (data.aiReport && data.aiReport.markdown) || '';
  openSheet('aiReportSheet');
}

function saveAiReportPaste() {
  const md = document.getElementById('aiReportText').value.trim();
  if (!md) { showToast('Paste the report first'); return; }
  data.aiReport = { markdown: md, generatedAt: new Date().toISOString(), period: currentQuarter().key };
  data._aiReportTs = Date.now();
  saveData(data);
  closeSheet();
  if (currentTab === 'analysis') renderAnalysis();
  showToast('Report saved');
}

function clearAiReport() {
  if (!confirm('Remove the saved AI report?')) return;
  data.aiReport = null;
  data._aiReportTs = Date.now();
  saveData(data);
  if (currentTab === 'analysis') renderAnalysis();
  showToast('Report removed');
}

// ── Drive path: find a file by name, push summary, pull report ─────────────────
async function findDriveFileIdByName(token, name) {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const json = await resp.json();
  return (json.files && json.files[0]) ? json.files[0].id : null;
}

async function pushSummaryToDrive() {
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  if (!clientId) { showToast('Connect Google Drive first'); return; }
  showToast('Uploading summary…');
  try {
    const token = await getAccessToken(clientId);
    let fileId = localStorage.getItem(AI_SUMMARY_FILE_KEY) || await findDriveFileIdByName(token, AI_SUMMARY_FILENAME);
    await uploadFileToDrive(token, fileId, buildAiSummary(), AI_SUMMARY_FILENAME, AI_SUMMARY_FILE_KEY);
    showToast('Summary saved to Drive — your Apps Script can read it');
  } catch (e) {
    showToast('Upload failed: ' + e.message);
  }
}

async function fetchAiReportFromDrive() {
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  if (!clientId) { showToast('Connect Google Drive first'); return; }
  showToast('Fetching report…');
  try {
    const token = await getAccessToken(clientId);
    const fileId = localStorage.getItem(AI_REPORT_FILE_KEY) || await findDriveFileIdByName(token, AI_REPORT_FILENAME);
    if (!fileId) { showToast('No report on Drive yet'); return; }
    localStorage.setItem(AI_REPORT_FILE_KEY, fileId);
    const report = await downloadFromDrive(token, fileId);
    const md = typeof report === 'string' ? report : (report.markdown || report.report || '');
    if (!md) { showToast('Report file has no markdown'); return; }
    data.aiReport = { markdown: md, generatedAt: report.generatedAt || new Date().toISOString(), period: report.period || currentQuarter().key };
    data._aiReportTs = Date.now();
    saveData(data);
    if (currentTab === 'analysis') renderAnalysis();
    showToast('Report loaded');
  } catch (e) {
    showToast('Fetch failed: ' + e.message);
  }
}

// ── Minimal, XSS-safe Markdown → HTML (report is untrusted) ────────────────────
function renderMarkdownLite(md) {
  const inline = t => esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = String(md).replace(/\r/g, '').split('\n');
  let html = '', list = null, para = [], tableRows = [];
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
  const isTableRow = l => /^\|.+\|$/.test(l);
  const isSepRow = l => l.replace(/^\||\|$/g, '').split('|').every(c => /^[\s:|-]+$/.test(c) && /[-]/.test(c));
  const parseCells = l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const flushTable = () => {
    if (!tableRows.length) return;
    const sepIdx = tableRows.findIndex(r => isSepRow(r));
    const headRows = sepIdx > 0 ? tableRows.slice(0, sepIdx) : [];
    const bodyRows = sepIdx >= 0 ? tableRows.slice(sepIdx + 1) : tableRows;
    let t = '<table><thead>';
    headRows.forEach(r => { t += '<tr>' + parseCells(r).map(c => `<th>${inline(c)}</th>`).join('') + '</tr>'; });
    t += '</thead><tbody>';
    bodyRows.forEach(r => { t += '<tr>' + parseCells(r).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'; });
    t += '</tbody></table>';
    html += t;
    tableRows = [];
  };
  lines.forEach(raw => {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); flushTable(); return; }
    let m;
    if (isTableRow(line)) {
      flushPara(); flushList();
      tableRows.push(line);
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); flushList(); flushTable();
      const lvl = Math.min(6, m[1].length);
      html += `<h${lvl}>${inline(m[2])}</h${lvl}>`;
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushPara(); flushList(); flushTable(); html += '<hr>';
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      flushPara(); flushTable();
      if (list !== 'ul') { flushList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\d+\.\s+(.*)$/))) {
      flushPara(); flushTable();
      if (list !== 'ol') { flushList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(m[1])}</li>`;
    } else {
      flushList(); flushTable();
      para.push(line);
    }
  });
  flushPara(); flushList(); flushTable();
  return html;
}

// ── Render the AI section at the top of the Analysis tab ──────────────────────
function fmtPct(n) { return n == null ? '—' : Math.round(n * 100) + '%'; }

function renderAiKpis() {
  const nw = computeNetWorth();
  const cf = computeCashflow();
  const { start: qStart } = quarterBounds();
  const prev = (data.netWorthSnapshots || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .reverse().find(s => (s.date || '') < qStart);
  const delta = prev ? nw.net - prev.net : null;
  const deltaStr = delta == null ? '' :
    `<span style="font-size:.8rem;font-weight:700;color:${delta >= 0 ? 'var(--green)' : 'var(--red)'}">${delta >= 0 ? '▲' : '▼'} ${fmtDollar(Math.abs(delta))} QoQ</span>`;
  const kpi = (label, value, sub) =>
    `<div style="flex:1;min-width:128px">
       <div style="font-size:.72rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em">${label}</div>
       <div style="font-size:1.15rem;font-weight:800;color:var(--primary);margin-top:2px">${value}</div>
       <div style="font-size:.75rem;margin-top:1px">${sub || ''}</div>
     </div>`;
  return `<div style="display:flex;flex-wrap:wrap;gap:14px 18px;margin-bottom:14px">
    ${kpi('Net Worth', fmtDollar(nw.net), deltaStr)}
    ${kpi('Savings Rate', fmtPct(cf.savingsRate), `<span style="color:var(--muted)">${fmtDollar(cf.avgMonthlyExpense)}/mo spend</span>`)}
  </div>`;
}

// Net-worth trend from the persisted snapshots (auto quarterly + manual captures).
function renderNetWorthChart() {
  const snaps = (data.netWorthSnapshots || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!snaps.length) return '';
  const vals = snaps.map(s => s.net);
  const lo = Math.min(0, ...vals), hi = Math.max(...vals, 1);
  const dateLbl = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

  const xLabels = snaps.map(s => dateLbl(s.date));
  const svg = lineChart({
    height: 150, padT: 10, xLabels,
    series: [{ values: vals, color: 'var(--primary)', valueLabels: true }],
    yMin: lo, yMax: hi,
    yFmt: v => fmtShort(Math.abs(v)),
    area: 'var(--primary)',
  });

  const hint = snaps.length < 2 ? `<div style=”font-size:.72rem;color:var(--muted);margin-top:4px;padding:0 4px”>Tap “Snapshot now” over time to build the trend.</div>` : '';

  return `<div class=”chart-wrap” style=”margin-top:14px;margin-bottom:0”>
    <div class=”chart-title”>Net Worth Trend</div>
    <div class=”scroll-x”>${svg}</div>
    ${hint}
  </div>`;
}

function renderAiReport() {
  const r = data.aiReport;
  const when = r && r.generatedAt ? new Date(r.generatedAt).toLocaleDateString() : null;
  const reportHtml = r && r.markdown
    ? `<div class="ai-report">${renderMarkdownLite(r.markdown)}</div>
       <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
         <span style="font-size:.75rem;color:var(--muted)">${r.period || ''}${when ? ' · ' + when : ''}</span>
         <button class="btn-link" onclick="clearAiReport()" style="background:none;border:none;color:var(--muted);font-size:.78rem;cursor:pointer">Clear</button>
       </div>`
    : `<div style="font-size:.85rem;color:var(--muted);padding:4px 0 10px">
         No AI report yet. Copy the summary, get a report from Claude, then paste it back.
       </div>`;
  return `<div class="card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <span style="font-size:1.2rem">🤖</span>
      <span style="font-weight:800;font-size:1.05rem">AI Financial Advisor</span>
    </div>
    ${renderAiKpis()}
    ${renderNetWorthChart()}
    <div style="text-align:right;margin:10px 0 2px">
      <button class="btn btn-secondary" style="font-size:.78rem;padding:6px 12px" onclick="snapshotNetWorthNow()">📸 Snapshot now</button>
    </div>
    <div class="btn-row" style="flex-wrap:wrap">
      <button class="btn btn-secondary" style="flex:1;font-size:.78rem" onclick="openCustomPromptSheet()">✏️ Prompt</button>
      <button class="btn btn-primary" style="flex:1" onclick="copyAiSummary()">📋 Copy</button>
      <button class="btn btn-secondary" style="flex:1" onclick="openAiReportPaste()">✍️ Paste</button>
    </div>
    ${reportHtml}
  </div>`;
}

// Record the quarterly net-worth snapshot on load.
try { recordNetWorthSnapshot(); } catch (e) { /* ignore */ }
