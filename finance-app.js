// ── Analysis sub-tab state ────────────────────────────────────────────────────
let currentAnalysisSubTab = 'ai';

function switchAnalysisSubTab(tab) {
  currentAnalysisSubTab = tab;
  document.querySelectorAll('.analysis-sub-tab').forEach(b => {
    b.classList.toggle('active', b.id === 'analysisSubTab-' + tab);
  });
  ['ai', 'expense', 'power'].forEach(t => {
    const el = document.getElementById('analysisSubContent-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.getElementById('fabBtn').style.display = tab === 'power' ? '' : 'none';
  renderAnalysis();
}

// ── Category chart helpers ────────────────────────────────────────────────────
const CAT_COLORS = {
  Food: '#e67e22', Transport: '#3498db', Shopping: '#9b59b6',
  Health: '#27ae60', Entertainment: '#e74c3c', Bills: '#f39c12', Other: '#7f8c8d'
};
const EXTRA_COLORS = ['#1abc9c','#e91e63','#607d8b','#ff5722','#795548','#673ab7'];

const _hiddenCats = new Set();
let _chartData = null;

function toggleChartCat(cat) {
  if (_hiddenCats.has(cat)) _hiddenCats.delete(cat);
  else _hiddenCats.add(cat);
  const el = document.getElementById('categoryChart');
  if (el && _chartData) el.innerHTML = renderCategoryChart(_chartData.byMonth, _chartData.months, _chartData.allCats);
}

function catColor(cat, idx) {
  return CAT_COLORS[cat] || EXTRA_COLORS[idx % EXTRA_COLORS.length];
}

function fmtShort(n) {
  if (n >= 10000) return '$' + (n / 1000).toFixed(0) + 'k';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
  return '$' + Math.round(n);
}

// ── Shared SVG line-chart builder ─────────────────────────────────────────────
// Returns an <svg> string. Callers wrap it in a .chart-wrap div with title/legend.
//
// series: [{ values[], color, dash?, strokeWidth?, dotR?, valueLabels? }]
// milestones: [{ index, label }] — vertical reference lines (CPF chart)
// area: CSS color for semi-transparent fill under first series (net-worth chart)
// overlayFn: (xPos, yPos, svgW) => svgString — injected before series lines
//   (used for budget dashed lines in the category chart)
// yMin / yMax: explicit axis bounds; yMax is auto ceil-to-scale when omitted
// xLabelSize: font-size for x-axis labels (default 8; pass 9 for year-label charts)
function lineChart({
  colW = 64, height = 160, padL = 44, padB = 28, padT = 8, padR = 12,
  xLabels = [],
  series = [],
  yMin = 0, yMax,
  yFmt,
  xLabelSize = 8,
  milestones = [],
  area = null,
  overlayFn = null,
}) {
  const fmt = yFmt || fmtShort;
  const n = xLabels.length;
  const svgW = padL + n * colW + padR;
  const svgH = height + padT + padB;

  let lo = yMin;
  let hi = yMax;
  if (hi == null) {
    const allVals = series.flatMap(s => s.values);
    const rawMax = allVals.length ? Math.max(...allVals, 1) : 1;
    const scale = Math.pow(10, Math.floor(Math.log10(rawMax)));
    hi = Math.ceil(rawMax / scale) * scale;
  }
  const range = (hi - lo) || 1;

  const xPos = i => padL + i * colW + colW / 2;
  const yPos = v => padT + height - Math.min(1, Math.max(0, (v - lo) / range)) * height;

  const grid = [0, .25, .5, .75, 1].map(f => {
    const v = lo + range * f, y = yPos(v);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(svgW - padR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>` +
           `<text x="${(padL - 4).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="8" fill="var(--muted)">${fmt(v)}</text>`;
  }).join('');

  const xAxis = xLabels.map((lbl, i) =>
    `<text x="${xPos(i).toFixed(1)}" y="${svgH - 4}" text-anchor="middle" font-size="${xLabelSize}" fill="var(--muted)">${lbl}</text>`
  ).join('');

  const milestoneLines = milestones.map(({ index, label }) => {
    const x = xPos(index);
    return `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${(padT + height).toFixed(1)}" stroke="#aaa" stroke-width="1" stroke-dasharray="3 3"/>` +
           `<text x="${x.toFixed(1)}" y="${(padT - 3).toFixed(1)}" text-anchor="middle" font-size="7" fill="#aaa">${label}</text>`;
  }).join('');

  let areaPath = '';
  if (area && series.length && series[0].values.length > 1) {
    const pts = series[0].values.map((v, i) => [xPos(i), yPos(v)]);
    areaPath = `<path d="M${pts[0][0].toFixed(1)},${yPos(lo).toFixed(1)} ${pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${pts[pts.length - 1][0].toFixed(1)},${yPos(lo).toFixed(1)} Z" fill="${area}" opacity="0.08"/>`;
  }

  const seriesLines = series.map(({ values, color, dash = '', strokeWidth = 2.5, dotR = 3.5, valueLabels = false }) => {
    const pts = values.map((v, i) => [xPos(i), yPos(v)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
    const dots = pts.map(([cx, cy], i) =>
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${dotR}" fill="${color}" stroke="#fff" stroke-width="1.5"/>` +
      (valueLabels ? `<text x="${cx.toFixed(1)}" y="${(cy - 9).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="${color}">${fmt(values[i])}</text>` : '')
    ).join('');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"${dashAttr} stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  }).join('');

  const extras = overlayFn ? overlayFn(xPos, yPos, svgW) : '';

  return `<svg width="${svgW}" height="${svgH}" style="display:block">${grid}${milestoneLines}${extras}${areaPath}${seriesLines}${xAxis}</svg>`;
}

function renderCategoryChart(byMonth, months, allCats) {
  if (!months.length) return '';
  const budgets = data.budgets || {};
  const TOTAL_COLOR = '#2c3e50';
  const totalHidden = _hiddenCats.has('Total');

  const monthlyTotals = months.map(m => allCats.reduce((s, cat) => s + ((byMonth[m] && byMonth[m][cat]) || 0), 0));

  let maxVal = 0;
  allCats.forEach(cat => {
    if (_hiddenCats.has(cat)) return;
    months.forEach(m => { maxVal = Math.max(maxVal, (byMonth[m] && byMonth[m][cat]) || 0); });
    const b = budgets[cat]; if (b > 0) maxVal = Math.max(maxVal, b);
  });
  if (!totalHidden) monthlyTotals.forEach(v => { maxVal = Math.max(maxVal, v); });
  if (maxVal === 0) maxVal = 100;
  const scale = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const yMax = Math.ceil(maxVal / scale) * scale;

  const xLabels = months.map(m =>
    new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  );

  const series = allCats
    .map((cat, ci) => _hiddenCats.has(cat) ? null : {
      values: months.map(m => (byMonth[m] && byMonth[m][cat]) || 0),
      color: catColor(cat, ci),
      strokeWidth: 2,
    })
    .filter(Boolean);
  if (!totalHidden) series.push({ values: monthlyTotals, color: TOTAL_COLOR });

  const overlayFn = (_, yPos, svgW) => allCats.map((cat, ci) => {
    if (_hiddenCats.has(cat)) return '';
    const b = budgets[cat];
    if (!b || b <= 0 || b > yMax) return '';
    const y = yPos(b);
    return `<line x1="44" y1="${y.toFixed(1)}" x2="${svgW - 12}" y2="${y.toFixed(1)}" stroke="${catColor(cat, ci)}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.5"/>`;
  }).join('');

  const svg = lineChart({ height: 160, padT: 8, xLabels, series, yMax, overlayFn });

  const legend = allCats.map((cat, ci) => {
    const b = budgets[cat];
    const budgetTag = b > 0 ? ` <span style="color:var(--muted);font-weight:400">(${fmtCurrency(b)})</span>` : '';
    const hidden = _hiddenCats.has(cat);
    const itemStyle = `cursor:pointer;user-select:none;${hidden ? 'opacity:0.35;' : ''}`;
    const nameStyle = hidden ? 'text-decoration:line-through' : '';
    return `<div class="legend-item" style="${itemStyle}" data-cat="${esc(cat)}" onclick="toggleChartCat(this.dataset.cat)"><div class="legend-dot" style="background:${catColor(cat, ci)}"></div><span style="${nameStyle}">${esc(cat)}${budgetTag}</span></div>`;
  }).join('');

  const totalHid = _hiddenCats.has('Total');
  const totalLegendItem = `<div class="legend-item" style="cursor:pointer;user-select:none;${totalHid ? 'opacity:0.35;' : ''}" data-cat="Total" onclick="toggleChartCat(this.dataset.cat)"><div class="legend-dot" style="background:${TOTAL_COLOR}"></div><span style="${totalHid ? 'text-decoration:line-through' : ''}">Total</span></div>`;

  return `<div class="chart-wrap">
    <div class="chart-title">Monthly Trend by Category</div>
    <div class="scroll-x">${svg}</div>
    <div class="chart-legend">${legend}${totalLegendItem}</div>
  </div>`;
}

// ── Render: Analysis ─────────────────────────────────────────────────────────
function renderYearlyChart() {
  const years = getExpenseYears().slice().reverse(); // ascending
  if (!years.length) return '';
  const curYear = String(new Date().getFullYear());
  const cutoff = new Date().toISOString().slice(0, 10);
  const totals = years.map(y => {
    if (y === curYear)
      return data.expenses.filter(e => e.cat !== 'TopUp' && e.date <= cutoff).reduce((s, e) => s + expSgd(e), 0);
    return Object.entries(data.monthlyAgg)
      .filter(([m]) => m.startsWith(y + '-'))
      .reduce((s, [, cats]) => s + Object.values(cats).reduce((a, b) => a + b, 0), 0);
  });

  const xLabels = years.map(y => `${y}${y === curYear ? '*' : ''}`);
  const svg = lineChart({
    height: 140, xLabelSize: 9, xLabels,
    series: [{ values: totals, color: 'var(--primary)', dotR: 4, valueLabels: true }],
  });

  return `<div class="chart-wrap">
    <div class="chart-title">Yearly Total Spending</div>
    <div class="scroll-x">${svg}</div>
    <div style="font-size:.72rem;color:var(--muted);margin-top:4px;padding:0 4px">* current year to date</div>
  </div>`;
}

function renderYearBudgetSummary() {
  const budgets = data.budgets || {};
  if (!Object.keys(budgets).length) return '';
  const curYear = String(new Date().getFullYear());
  const monthsElapsed = new Date().getMonth() + 1;
  const actualByCat = {};
  Object.entries(data.monthlyAgg || {}).forEach(([month, cats]) => {
    if (!month.startsWith(curYear + '-')) return;
    Object.entries(cats).forEach(([cat, amt]) => {
      actualByCat[cat] = (actualByCat[cat] || 0) + amt;
    });
  });
  const entries = Object.entries(budgets).filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]);
  const fullYearTotal = entries.reduce((s, [, b]) => s + b * 12, 0);
  let totalExpected = 0, totalActual = 0;
  const hb = 'border-bottom:1px solid var(--border)';
  const hs = `text-align:right;font-size:.8rem;color:var(--muted);font-weight:600;padding:4px 0 6px`;
  const headerCells = `
    <span style="padding:4px 0 6px;${hb}"></span>
    <span style="${hs};${hb}">Spending</span>
    <span style="${hs};${hb}">Budget</span>
    <span style="${hs};${hb}">Over/Under</span>`;
  const rowCells = entries.map(([cat, monthlyBudget]) => {
    const expected = monthlyBudget * monthsElapsed;
    const actual = actualByCat[cat] || 0;
    totalExpected += expected;
    totalActual += actual;
    const diff = actual - expected;
    const over = diff > 0;
    const diffStr = `${diff >= 0 ? '+' : ''}${fmtDollar(diff)}`;
    const b = 'border-top:1px solid var(--border)';
    return `
      <span style="font-size:.9rem;padding:6px 0;${b}">${esc(cat)}</span>
      <span style="text-align:right;font-size:.8rem;padding:6px 0;${b}">${fmtDollar(actual)}</span>
      <span style="text-align:right;font-size:.8rem;padding:6px 0;color:var(--muted);${b}">${fmtDollar(expected)}</span>
      <span style="text-align:right;font-size:.8rem;padding:6px 0;font-weight:700;color:${over ? 'var(--red)' : 'var(--green)'};${b}">${diffStr}</span>`;
  }).join('');
  const totalDiff = totalActual - totalExpected;
  const totalOver = totalDiff > 0;
  const totalDiffStr = `${totalDiff >= 0 ? '+' : ''}${fmtDollar(totalDiff)}`;
  const tb = 'border-top:2px solid var(--border)';
  const totalCells = `
    <span style="font-size:.9rem;font-weight:700;padding:8px 0;${tb}">Total</span>
    <span style="text-align:right;font-size:.8rem;font-weight:700;padding:8px 0;${tb}">${fmtDollar(totalActual)}</span>
    <span style="text-align:right;font-size:.8rem;font-weight:700;padding:8px 0;color:var(--muted);${tb}">${fmtDollar(totalExpected)}</span>
    <span style="text-align:right;font-size:.8rem;font-weight:700;padding:8px 0;color:${totalOver ? 'var(--red)' : 'var(--green)'};${tb}">${totalDiffStr}</span>`;
  return `<div class="card" style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
      <span style="font-weight:700;font-size:1rem">${curYear} Budget (${monthsElapsed} mo)</span>
      <span style="font-size:.85rem;color:var(--muted)">Full year: ${fmtDollar(fullYearTotal)}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr repeat(3,auto);gap:0 16px;align-items:center">
      ${headerCells}${rowCells}${totalCells}
    </div>
  </div>`;
}

// ── Render: Asset & Mortgage Trend Chart ─────────────────────────────────────
function renderAssetMortgageChart() {
  const assets = data.assets || [];
  const mortgages = data.mortgages || [];
  if (!assets.length && !mortgages.length) return '';

  const monthSet = new Set();
  assets.forEach(a => (a.history || []).forEach(h => monthSet.add(h.date.slice(0, 7))));
  mortgages.forEach(m => {
    if (m.startDate) monthSet.add(m.startDate.slice(0, 7));
    (m.entries || []).filter(e => e.type === 'balance').forEach(e => monthSet.add(e.date.slice(0, 7)));
  });
  if (!monthSet.size) return '';

  const months = [...monthSet].sort();

  const assetTotals = months.map(month => {
    const cutoff = month + '-31';
    return assets.reduce((sum, a) => {
      const units = a.units != null ? a.units : 1;
      const relevant = (a.history || []).filter(h => h.date <= cutoff).sort((x, y) => y.date.localeCompare(x.date));
      return sum + (relevant.length ? relevant[0].value * units : 0);
    }, 0);
  });

  const mortgageTotals = months.map(month => {
    const cutoff = month + '-31';
    return mortgages.reduce((sum, m) => {
      const balanceEntries = (m.entries || []).filter(e => e.type === 'balance' && e.date <= cutoff).sort((x, y) => y.date.localeCompare(x.date));
      if (balanceEntries.length) return sum + balanceEntries[0].amount;
      if (m.startDate && m.startDate.slice(0, 7) <= month) return sum + (m.principal || 0);
      return sum;
    }, 0);
  });

  const hasAsset = assetTotals.some(v => v > 0);
  const hasMortgage = mortgageTotals.some(v => v > 0);
  if (!hasAsset && !hasMortgage) return '';

  const ASSET_COLOR = '#27ae60';
  const MORTGAGE_COLOR = '#e74c3c';

  const xLabels = months.map(m => new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' }));
  const series = [];
  if (hasAsset) series.push({ values: assetTotals, color: ASSET_COLOR });
  if (hasMortgage) series.push({ values: mortgageTotals, color: MORTGAGE_COLOR, strokeWidth: 2, dash: '5 3' });

  const svg = lineChart({ xLabels, series });

  const legend = `<div class="chart-legend">
    ${hasAsset ? `<div class="legend-item"><div class="legend-dot" style="background:${ASSET_COLOR}"></div><span>Total Assets</span></div>` : ''}
    ${hasMortgage ? `<div class="legend-item"><div class="legend-dot" style="background:${MORTGAGE_COLOR}"></div><span>Mortgage Balance</span></div>` : ''}
  </div>`;

  return `<div class="chart-wrap">
    <div class="chart-title">Asset &amp; Mortgage Trend</div>
    <div class="scroll-x">${svg}</div>
    ${legend}
  </div>`;
}

// ── Power (utility) sub-tab ───────────────────────────────────────────────────
const POWER_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function renderPower() {
  const el = document.getElementById('powerContent');
  if (!el) return;

  const records = [...(historyData.powerRecords || [])].sort((a, b) =>
    a.year !== b.year ? b.year - a.year : b.month - a.month
  );

  if (!records.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">bolt</span></div>No power records yet. Tap + to add.</div>';
    return;
  }

  const chartRecs = [...records].reverse().slice(-12);
  const elecColor = '#ff9800', waterColor = '#2196f3';
  const maxCost = Math.max(...chartRecs.map(r =>
    (r.elecUsage || 0) * (r.elecUnitCost || 0) + (r.waterUsage || 0) * (r.waterUnitCost || 0)
  ), 1);

  const COL_W = 52, H = 120, PAD_L = 46, PAD_B = 28, PAD_T = 8, PAD_R = 8;
  const svgW = Math.max(320, PAD_L + chartRecs.length * COL_W + PAD_R);
  const svgH = H + PAD_B + PAD_T;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const y = PAD_T + H - (i / 4) * H;
    const v = (i / 4) * maxCost;
    grid += `<line x1="${PAD_L}" x2="${svgW - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`;
    grid += `<text x="${PAD_L - 4}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">$${v < 10 ? v.toFixed(0) : Math.round(v)}</text>`;
  }

  let bars = '';
  chartRecs.forEach((r, i) => {
    const ec = (r.elecUsage || 0) * (r.elecUnitCost || 0);
    const wc = (r.waterUsage || 0) * (r.waterUnitCost || 0);
    const total = ec + wc;
    const bx = PAD_L + i * COL_W + COL_W * 0.2;
    const bw = COL_W * 0.6;
    if (total > 0) {
      const eh = (ec / maxCost) * H, wh = (wc / maxCost) * H;
      const wy = PAD_T + H - wh, ey = wy - eh;
      if (wh > 0.5) bars += `<rect x="${bx.toFixed(1)}" y="${wy.toFixed(1)}" width="${bw.toFixed(1)}" height="${wh.toFixed(1)}" fill="${waterColor}" rx="2"/>`;
      if (eh > 0.5) bars += `<rect x="${bx.toFixed(1)}" y="${ey.toFixed(1)}" width="${bw.toFixed(1)}" height="${eh.toFixed(1)}" fill="${elecColor}" rx="2"/>`;
    }
    const lbl = POWER_MONTHS[r.month - 1] + '\'' + String(r.year).slice(2);
    bars += `<text x="${(PAD_L + i * COL_W + COL_W / 2).toFixed(1)}" y="${(svgH - 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)">${lbl}</text>`;
  });

  const chart = `<div class="chart-wrap">
    <div class="chart-title">Monthly Utility Costs</div>
    <div class="scroll-x">
      <svg width="${svgW}" height="${svgH}" style="display:block">${grid}${bars}</svg>
    </div>
    <div style="display:flex;gap:16px;margin-top:8px">
      <span style="display:flex;align-items:center;gap:5px;font-size:.78rem;color:var(--muted)"><span style="width:10px;height:10px;background:${elecColor};border-radius:2px;display:inline-block"></span>Electricity</span>
      <span style="display:flex;align-items:center;gap:5px;font-size:.78rem;color:var(--muted)"><span style="width:10px;height:10px;background:${waterColor};border-radius:2px;display:inline-block"></span>Water</span>
    </div>
  </div>`;

  const latest = records[0];
  const le = (latest.elecUsage || 0) * (latest.elecUnitCost || 0);
  const lw = (latest.waterUsage || 0) * (latest.waterUnitCost || 0);
  const kpi = (label, value) =>
    `<div style="flex:1;min-width:90px">
      <div style="font-size:.72rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em">${label}</div>
      <div style="font-size:1rem;font-weight:800;color:var(--primary);margin-top:2px">${value}</div>
    </div>`;
  const kpiStrip = `<div style="display:flex;flex-wrap:wrap;gap:10px 14px;margin-bottom:14px;background:var(--card);padding:12px;border-radius:var(--radius);box-shadow:var(--shadow)">
    ${kpi(POWER_MONTHS[latest.month - 1] + ' ' + latest.year, fmtCurrency(le + lw))}
    ${kpi('Electricity', (latest.elecUsage || 0) + ' kWh')}
    ${kpi('Water', (latest.waterUsage || 0) + ' m³')}
  </div>`;

  const rows = records.map(r => {
    const ec = (r.elecUsage || 0) * (r.elecUnitCost || 0);
    const wc = (r.waterUsage || 0) * (r.waterUnitCost || 0);
    const mLabel = POWER_MONTHS[r.month - 1] + ' ' + r.year;
    return `<div class="card" style="cursor:pointer" onclick="openPowerSheet('${esc(r.id)}')">
      <div class="row-between">
        <div style="font-weight:700">${esc(mLabel)}</div>
        <div style="font-weight:800;font-size:1.05rem;color:var(--primary)">${fmtCurrency(ec + wc)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div style="font-size:.85rem">
          <div style="color:var(--muted);font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.03em">Electricity</div>
          <div>${r.elecUsage || 0} kWh @ $${r.elecUnitCost || 0}/kWh</div>
          <div style="font-weight:700;color:var(--primary)">${fmtCurrency(ec)}</div>
        </div>
        <div style="font-size:.85rem">
          <div style="color:var(--muted);font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.03em">Water</div>
          <div>${r.waterUsage || 0} m³ @ $${r.waterUnitCost || 0}/m³</div>
          <div style="font-weight:700;color:var(--primary)">${fmtCurrency(wc)}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = chart + kpiStrip + rows;
}

function openPowerSheet(id) {
  const rec = id ? (historyData.powerRecords || []).find(r => r.id === id) : null;
  document.getElementById('powerSheetTitle').textContent = id ? 'Edit Power Record' : 'Add Power Record';
  document.getElementById('powerId').value = id || '';
  const now = new Date();
  document.getElementById('powerYear').value = rec ? rec.year : now.getFullYear();
  document.getElementById('powerMonth').value = rec ? rec.month : now.getMonth() + 1;
  document.getElementById('powerElecUsage').value = rec ? rec.elecUsage : '';
  document.getElementById('powerElecUnitCost').value = rec ? rec.elecUnitCost : '';
  document.getElementById('powerWaterUsage').value = rec ? rec.waterUsage : '';
  document.getElementById('powerWaterUnitCost').value = rec ? rec.waterUnitCost : '';
  document.getElementById('powerDeleteBtn').style.display = id ? '' : 'none';
  openSheet('powerSheet');
}

function deletePowerRecord() {
  const id = document.getElementById('powerId').value;
  if (!id || !confirm('Delete this power record?')) return;
  historyData.powerRecords = (historyData.powerRecords || []).filter(r => r.id !== id);
  if (!data._deletedIds) data._deletedIds = [];
  if (!data._deletedIds.includes(id)) data._deletedIds.push(id);
  saveHistory(historyData);
  saveData(data);
  closeSheet();
  renderPower();
  showToast('Deleted');
}

document.getElementById('powerForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('powerId').value;
  const year = parseInt(document.getElementById('powerYear').value, 10);
  const month = parseInt(document.getElementById('powerMonth').value, 10);
  if (!year || !month) return;
  const entry = {
    id: id || uid(), year, month,
    elecUsage: parseFloat(document.getElementById('powerElecUsage').value) || 0,
    elecUnitCost: parseFloat(document.getElementById('powerElecUnitCost').value) || 0,
    waterUsage: parseFloat(document.getElementById('powerWaterUsage').value) || 0,
    waterUnitCost: parseFloat(document.getElementById('powerWaterUnitCost').value) || 0,
    _ts: Date.now()
  };
  if (!historyData.powerRecords) historyData.powerRecords = [];
  if (id) {
    const idx = historyData.powerRecords.findIndex(r => r.id === id);
    if (idx >= 0) historyData.powerRecords[idx] = entry; else historyData.powerRecords.push(entry);
  } else {
    historyData.powerRecords.push(entry);
  }
  saveHistory(historyData);
  saveData(data);
  closeSheet();
  showToast(id ? 'Power record updated' : 'Power record added');
  renderPower();
});

function renderAnalysis() {
  if (currentAnalysisSubTab === 'ai') {
    const el = document.getElementById('aiAnalysisList');
    if (el) el.innerHTML = (typeof renderAiReport === 'function') ? renderAiReport() : '';
    return;
  }

  if (currentAnalysisSubTab === 'power') {
    renderPower();
    return;
  }

  // Expense analysis sub-tab
  const el = document.getElementById('analysisList');
  const allYears = getExpenseYears();

  const yearPillsHtml = `<div class="filter-pills" style="margin-bottom:16px">${
    allYears.map(y =>
      `<button class="filter-pill${analysisYears.has(y) ? ' active' : ''}" onclick="toggleAnalysisYear('${y}')">${y}</button>`
    ).join('')
  }</div>`;

  const byMonth = {};
  Object.entries(data.monthlyAgg || {}).forEach(([month, cats]) => {
    if (!analysisYears.has(month.slice(0, 4))) return;
    const filtered = {};
    Object.entries(cats).forEach(([cat, amt]) => { filtered[cat] = amt; });
    if (Object.keys(filtered).length) byMonth[month] = filtered;
  });

  const assetMortgageChart = `<div id="assetMortgageChart">${renderAssetMortgageChart()}</div>`;

  if (!Object.keys(byMonth).length) {
    el.innerHTML = yearPillsHtml + assetMortgageChart + '<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">bar_chart</span></div>No expense data yet.</div>';
    return;
  }

  const months = Object.keys(byMonth).sort();
  const allCats = [...new Set(Object.values(byMonth).flatMap(cats => Object.keys(cats)))].sort();
  const budgets = data.budgets || {};
  const totalBudget = Object.values(budgets).reduce((s, v) => s + v, 0);

  _chartData = { byMonth, months, allCats };
  const chart = `<div id="categoryChart">${renderCategoryChart(byMonth, months, allCats)}</div>`;

  const cards = [...months].reverse().map(month => {
    const cats = byMonth[month];
    const total = Object.values(cats).reduce((s, v) => s + v, 0);
    const label = new Date(month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const rows = Object.entries(cats).sort((a, b) => b[1] - a[1]);

    let budgetBadge = '';
    if (totalBudget > 0) {
      const diff = Math.round(total - totalBudget);
      const over = diff > 0;
      budgetBadge = `<span class="${over ? 'over-budget' : 'under-budget'}">${diff >= 0 ? '+' : ''}${fmtDollar(diff)}</span>`;
    }

    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
          <div style="font-weight:700;font-size:1rem">${label}</div>
          <div style="display:flex;align-items:center;gap:8px">
            ${budgetBadge}
            <div style="font-weight:800;font-size:1.05rem;color:var(--primary)">${fmtDollar(total)}</div>
          </div>
        </div>
        ${rows.map(([cat, amt]) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid var(--border)">
            <span style="font-size:.9rem">${esc(cat)}</span>
            <span style="font-weight:600;font-size:.9rem">${fmtDollar(amt)}</span>
          </div>`).join('')}
      </div>`;
  }).join('');

  const yearlyChart = `<div id="yearlyChart">${renderYearlyChart()}</div>`;
  const budgetSummary = renderYearBudgetSummary();
  el.innerHTML = yearPillsHtml + assetMortgageChart + chart + yearlyChart + budgetSummary + cards;
}

// ── Render all ────────────────────────────────────────────────────────────────
// Only renders the active tab — invisible tabs are rendered on first visit.
function renderAll() {
  document.getElementById('fabBtn').style.display =
    ((currentTab === 'analysis' && currentAnalysisSubTab !== 'power') || (currentTab === 'tax' && currentTaxSubTab === 'retirement')) ? 'none' : '';

  try {
    if (currentTab === 'events') {
      renderEventList();
    } else if (currentTab === 'expenses') {
      renderAccountFilterPills();
      renderYearFilterPills();
      renderExpenseList();
      if (currentExpSubTab === 'recurring') renderOngoingListInline();
      else if (currentExpSubTab === 'mortgage') renderMortgageListInline();
    } else if (currentTab === 'analysis') {
      renderAnalysis();
    } else if (currentTab === 'insurance') {
      if (currentInsSubTab === 'medical') renderMedical();
      else renderInsurances();
    } else if (currentTab === 'tax') {
      renderTaxRecords();
      if (currentTaxSubTab === 'cpf') renderCpf();
      else if (currentTaxSubTab === 'assets') renderAssetsSubTab();
      else if (currentTaxSubTab === 'retirement') renderRetirement();
    } else if (currentTab === 'wiki') {
      renderWiki();
    }
  } catch (err) {
    console.error('[renderAll] tab=' + currentTab, err);
    showToast('Render error — check console');
  }
}

// ── XSS-safe escape ───────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/`/g, '&#96;');
}

// ── DMY Date Widget ───────────────────────────────────────────────────────────
function makeDmyWidget(dateInput) {
  const orig = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  const wrap = document.createElement('div');
  wrap.className = 'dmy-wrap';
  dateInput.parentNode.insertBefore(wrap, dateInput);
  wrap.appendChild(dateInput);
  dateInput.type = 'hidden';
  dateInput.required = false;

  const display = document.createElement('div');
  display.className = 'dmy-display';
  display.innerHTML =
    '<span class="dmy-d" data-i="0"></span>' +
    '<span class="dmy-d" data-i="1"></span>' +
    '<span class="dmy-sep">/</span>' +
    '<span class="dmy-d" data-i="2"></span>' +
    '<span class="dmy-d" data-i="3"></span>' +
    '<span class="dmy-sep">/</span>' +
    '<span class="dmy-d" data-i="4"></span>' +
    '<span class="dmy-d" data-i="5"></span>' +
    '<span class="dmy-d" data-i="6"></span>' +
    '<span class="dmy-d" data-i="7"></span>';

  const cap = document.createElement('input');
  cap.className = 'dmy-cap';
  cap.type = 'text';
  cap.inputMode = 'numeric';
  cap.autocomplete = 'off';
  cap.setAttribute('aria-hidden', 'true');

  wrap.insertBefore(display, dateInput);
  wrap.insertBefore(cap, dateInput);

  const dEls = display.querySelectorAll('.dmy-d');
  let digs = [], tmpl = [], cur = 0, focused = false, syncing = false, kdHandled = false;

  function todayDigs() {
    const n = new Date();
    return [...String(n.getDate()).padStart(2, '0'),
            ...String(n.getMonth() + 1).padStart(2, '0'),
            ...String(n.getFullYear())];
  }

  function fromIso(s) {
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-');
      return [...d, ...m, ...y];
    }
    return todayDigs();
  }

  function toIso() {
    if (digs.length < 8) return '';
    const dd = digs[0] + digs[1], mm = digs[2] + digs[3], yy = digs.slice(4).join('');
    const d = +dd, m = +mm, y = +yy;
    return (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900) ? `${yy}-${mm}-${dd}` : '';
  }

  function render() {
    dEls.forEach((el, i) => {
      el.textContent = digs[i] ?? '_';
      el.classList.toggle('dmy-cur', focused && i === cur);
    });
    const iso = toIso();
    if (iso) { syncing = true; orig.set.call(dateInput, iso); syncing = false; }
  }

  function load(iso) {
    digs = fromIso(iso); tmpl = [...digs]; cur = 0;
  }

  function fire() {
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    dateInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  load(orig.get.call(dateInput));
  render();

  const parentForm = dateInput.closest('form');
  if (parentForm) {
    parentForm.addEventListener('reset', () => { load(null); render(); });
  }

  Object.defineProperty(dateInput, 'value', {
    get() { return orig.get.call(dateInput); },
    set(v) { if (!syncing) { load(v); render(); } },
    configurable: true
  });

  display.addEventListener('click', () => cap.focus());
  display.addEventListener('touchend', e => { e.preventDefault(); cap.focus(); });

  cap.addEventListener('focus', () => {
    focused = true; cur = 0; cap.value = '';
    display.classList.add('focused'); render();
  });
  cap.addEventListener('blur', () => {
    focused = false; display.classList.remove('focused'); render();
  });

  cap.addEventListener('keydown', e => {
    kdHandled = false;
    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault(); kdHandled = true;
      if (cur < 8) { digs[cur] = e.key; cur++; render(); fire(); }
    } else if (e.key === 'Backspace') {
      e.preventDefault(); kdHandled = true;
      if (cur > 0) { cur--; digs[cur] = tmpl[cur]; render(); }
    }
  });

  cap.addEventListener('input', () => {
    if (kdHandled) { kdHandled = false; cap.value = ''; return; }
    const v = cap.value.replace(/\D/g, '');
    cap.value = '';
    if (!v) return;
    for (const ch of v) if (cur < 8) { digs[cur] = ch; cur++; }
    render(); fire();
  });
}

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: '/health/finance.html' });
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (busPollingInterval)    { clearInterval(busPollingInterval);    busPollingInterval    = null; }
    if (busMapPollingInterval) { clearInterval(busMapPollingInterval); busMapPollingInterval = null; }
    if (rainPollingInterval)   { clearInterval(rainPollingInterval);   rainPollingInterval   = null; }
    if (rainAnimTimer)         rainToggleAnim(); // stops the loop and resets the play icon
    stopLocationTracking();
  } else if (currentTab === 'events') {
    if (eventViewMode === 'bus' && !busPollingInterval) {
      renderBusPanel();
      busPollingInterval = setInterval(renderBusPanel, 60000);
    } else if (eventViewMode === 'busmap' && !busMapPollingInterval) {
      startLocationTracking();
      refreshBusMapMarkers();
      busMapPollingInterval = setInterval(refreshBusMapMarkers, 30000);
    } else if (eventViewMode === 'rain' && !rainPollingInterval) {
      startLocationTracking();
      refreshRainFrames();
      rainPollingInterval = setInterval(refreshRainFrames, 300000);
    }
  }
});

document.querySelectorAll('input[type="date"]').forEach(makeDmyWidget);
renderAll();
if (balanceHidden) document.getElementById('balanceToggleBtn').innerHTML = '<span class="material-symbols-outlined">visibility</span> Show Balances';
updateDriveSyncBtn();
scheduleEventReminders();
maybeAutoSync();
if (new URLSearchParams(location.search).get('add') === '1') {
  history.replaceState(null, '', location.pathname);
  setTimeout(() => openExpenseSheet(), 100);
}
if (new URLSearchParams(location.search).get('addevent') === '1') {
  history.replaceState(null, '', location.pathname);
  setTimeout(() => openEventSheet(null), 100);
}

async function refreshPwaCache() {
  document.getElementById('mainMenu').classList.remove('open');
  showToast('Clearing cache…');
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.unregister();
    }
    showToast('Cache cleared — reloading…');
    setTimeout(() => {
      const url = new URL(location.href);
      url.searchParams.set('_cb', Date.now());
      location.replace(url.toString());
    }, 800);
  } catch (e) {
    showToast('Error clearing cache: ' + e.message);
  }
}
