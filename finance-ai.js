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
  const assets = (data.assets || []).reduce((s, a) => s + currentValue(a), 0);
  const investableAssets = (data.assets || []).reduce((s, a) => s + (isInvestable(a) ? currentValue(a) : 0), 0);
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
  months.forEach(m => {
    const cats = agg[m];
    if (cats) spendTotal += Object.values(cats).reduce((a, b) => a + b, 0);
  });
  const avgMonthlyExpense = spendTotal / 12;

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

  // CPF projection highlights.
  let cpf = null;
  try {
    const p = calcCpfProjection();
    if (p) cpf = {
      retireAge: p.retireAge,
      ra65: p.ra65,
      monthlyLifePayout: p.lifePayout,
      frsRefMonthlyPayout: p.frsRefPayout,
      ersRefMonthlyPayout: p.ersRefPayout,
      projFRS: p.projFRS,
      projERS: p.projERS,
      yearsToPayout: p.yearsToRetire
    };
  } catch (e) { /* no DOB set */ }

  // Latest income-tax estimate — including gross annual income.
  let tax = null;
  const taxRecs = (data.taxRecords || []).slice().sort((a, b) => b.year - a.year);
  if (taxRecs.length && typeof calcEffectiveTax === 'function') {
    const r = taxRecs[0];
    try {
      const annualIncome = r.isHistorical
        ? (r.totalIncome || 0)
        : (r.basicSalary || 0) + (r.bonus || 0) + (r.otherIncome || 0);
      tax = { year: r.year, annualIncome: Math.round(annualIncome), estimatedTaxPayable: Math.round(calcEffectiveTax(r)) };
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
    return { name: i.name, category: cat, personInsured: i.personInsured || '', annualPremium: annual };
  });

  return {
    _schema: 1,
    currency: 'SGD',
    generatedAt: new Date().toISOString(),
    period: period.key,
    cashflow: computeCashflow(),
    annualRecurringExpenses: Math.round(annualRecurring()),
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
    cpf,
    tax,
    retirement
  };
}

// ── The instruction prompt for the AI ─────────────────────────────────────────
function aiReportPrompt() {
  const { label } = currentQuarter();
  return `You are a Singapore-based personal financial advisor. Below is a JSON snapshot of my consolidated finances for ${label} (all amounts in SGD). Write me a concise quarterly review in GitHub-flavoured Markdown with these sections:

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

Be specific and quantitative, reference the actual numbers, and keep it under ~700 words. Respond with ONLY the Markdown report (no preamble).

\`\`\`json
${JSON.stringify(buildAiSummary(), null, 2)}
\`\`\``;
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
  let html = '', list = null, para = [];
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
  lines.forEach(raw => {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); return; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); flushList();
      const lvl = Math.min(6, m[1].length);
      html += `<h${lvl}>${inline(m[2])}</h${lvl}>`;
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushPara(); flushList(); html += '<hr>';
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') { flushList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\d+\.\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') { flushList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(m[1])}</li>`;
    } else {
      flushList();
      para.push(line);
    }
  });
  flushPara(); flushList();
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
    ${kpi('Recurring', fmtDollar(annualRecurring()) + '/yr', `<span style="color:var(--muted)">${(data.ongoingExpenses || []).length} items</span>`)}
  </div>`;
}

// Net-worth trend from the persisted snapshots (auto quarterly + manual captures).
function renderNetWorthChart() {
  const snaps = (data.netWorthSnapshots || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!snaps.length) return '';
  const single = snaps.length < 2;
  const short = n => (typeof fmtShort === 'function') ? fmtShort(Math.abs(n)) : '$' + Math.round(n);
  const dateLbl = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

  const COL_W = 64, H = 150, PAD_L = 44, PAD_B = 28, PAD_T = 10, PAD_R = 12;
  const svgW = PAD_L + snaps.length * COL_W + PAD_R;
  const svgH = H + PAD_T + PAD_B;
  const vals = snaps.map(s => s.net);
  const lo = Math.min(0, ...vals), hi = Math.max(...vals, 1);
  const range = (hi - lo) || 1;
  const xPos = i => PAD_L + i * COL_W + COL_W / 2;
  const yPos = v => PAD_T + H - ((v - lo) / range) * H;

  const ticks = [0, .25, .5, .75, 1].map(f => ({ v: lo + range * f, y: yPos(lo + range * f) }));
  const grid = ticks.map(({ v, y }) =>
    `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${(svgW - PAD_R).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e8dece" stroke-width="1"/>` +
    `<text x="${(PAD_L - 4).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="8" fill="#7a6a52">${short(v)}</text>`
  ).join('');
  const pts = vals.map((v, i) => [xPos(i), yPos(v)]);
  const area = single ? '' : `M${pts[0][0].toFixed(1)},${yPos(lo).toFixed(1)} ` +
    pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') +
    ` L${pts[pts.length - 1][0].toFixed(1)},${yPos(lo).toFixed(1)} Z`;
  const path = single ? '' : pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const dots = pts.map(([cx, cy], i) =>
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.5" fill="var(--primary)" stroke="#fff" stroke-width="1.5"/>` +
    `<text x="${cx.toFixed(1)}" y="${(cy - 8).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="var(--primary)">${short(vals[i])}</text>`
  ).join('');
  const xLabels = snaps.map((s, i) =>
    `<text x="${xPos(i).toFixed(1)}" y="${svgH - 4}" text-anchor="middle" font-size="8" fill="#7a6a52">${dateLbl(s.date)}</text>`
  ).join('');
  const hint = single ? `<div style="font-size:.72rem;color:var(--muted);margin-top:4px;padding:0 4px">Tap “Snapshot now” over time to build the trend.</div>` : '';

  return `<div class="chart-wrap" style="margin-top:14px;margin-bottom:0">
    <div class="chart-title">Net Worth Trend</div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <svg width="${svgW}" height="${svgH}" style="display:block">
        ${grid}
        <path d="${area}" fill="var(--primary)" opacity="0.08"/>
        <path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}${xLabels}
      </svg>
    </div>
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
         No AI report yet. Export the summary, get a report from Claude, then paste it back or fetch it from Drive.
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
      <button class="btn btn-primary" style="flex:1" onclick="copyAiSummary()">📋 Copy summary</button>
      <button class="btn btn-secondary" style="flex:1" onclick="openAiReportPaste()">✍️ Paste report</button>
    </div>
    <div class="btn-row" style="flex-wrap:wrap">
      <button class="btn btn-secondary" style="flex:1" onclick="pushSummaryToDrive()">☁ Summary → Drive</button>
      <button class="btn btn-secondary" style="flex:1" onclick="fetchAiReportFromDrive()">⬇ Fetch report</button>
    </div>
    ${reportHtml}
  </div>`;
}

// Record the quarterly net-worth snapshot on load.
try { recordNetWorthSnapshot(); } catch (e) { /* ignore */ }
