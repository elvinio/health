// ── Income/Tax Chart ──────────────────────────────────────────────────────────
function renderTaxChart() {
  const records = (data.taxRecords || []).slice()
    .sort((a, b) => a.year - b.year)
    .map(r => {
      const income = r.isHistorical
        ? (r.totalIncome || 0)
        : ((r.basicSalary || 0) + (r.bonus || 0) + (r.otherIncome || 0));
      const tax = r.isHistorical
        ? (r.taxPaid || 0)
        : Math.max(0, calcSGTax(Math.max(0, income - (r.cpfEmployee || 0) - (r.reliefs || []).reduce((s, x) => s + (x.amount || 0), 0))) - (r.taxRebate || 0));
      return { year: r.year, income, tax, isHistorical: r.isHistorical };
    })
    .filter(p => p.income > 0 || p.tax > 0);

  if (records.length < 2) return '';

  const COL_W = 64, H = 140, PAD_L = 44, PAD_B = 28, PAD_T = 16, PAD_R = 12;
  const svgW = PAD_L + records.length * COL_W + PAD_R;
  const svgH = H + PAD_T + PAD_B;
  const INCOME_COLOR = 'var(--primary)', TAX_COLOR = '#e74c3c';

  const maxVal = Math.max(...records.map(r => r.income), 1);
  const scale = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const maxY = Math.ceil(maxVal / scale) * scale;
  const xPos = i => PAD_L + i * COL_W + COL_W / 2;
  const yPos = v => PAD_T + H - Math.min(1, v / maxY) * H;

  const ticks = [0, .25, .5, .75, 1].map(f => ({ v: maxY * f, y: yPos(maxY * f) }));
  const grid = ticks.map(({ v, y }) =>
    `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${(svgW - PAD_R).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e8dece" stroke-width="1"/>` +
    `<text x="${(PAD_L - 4).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="8" fill="#7a6a52">${fmtShort(v)}</text>`
  ).join('');

  function makeLine(vals, color, dash) {
    const pts = vals.map((v, i) => [xPos(i), yPos(v)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const extra = dash ? ` stroke-dasharray="${dash}"` : '';
    const dots = pts.map(([cx, cy], i) =>
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.5" fill="${color}" stroke="#fff" stroke-width="1.5"/>` +
      `<text x="${cx.toFixed(1)}" y="${(cy - 9).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="${color}">${fmtShort(vals[i])}</text>`
    ).join('');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"${extra}/>${dots}`;
  }

  const xLabels = records.map((r, i) =>
    `<text x="${xPos(i).toFixed(1)}" y="${svgH - 4}" text-anchor="middle" font-size="9" fill="#7a6a52">${r.year}${!r.isHistorical ? '*' : ''}</text>`
  ).join('');

  const legend = `<div style="display:flex;gap:16px;margin-top:6px;padding:0 4px;font-size:.75rem;color:var(--text)">
    <span style="display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:18px;height:3px;background:var(--primary);border-radius:2px"></span>Income</span>
    <span style="display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:18px;height:3px;background:#e74c3c;border-radius:2px;opacity:.7"></span>Tax Payable</span>
  </div>`;

  return `<div class="chart-wrap">
    <div class="chart-title">Income &amp; Tax Year-over-Year</div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <svg width="${svgW}" height="${svgH}" style="display:block">
        ${grid}
        ${makeLine(records.map(r => r.income), INCOME_COLOR, '')}
        ${makeLine(records.map(r => r.tax), TAX_COLOR, '5 3')}
        ${xLabels}
      </svg>
    </div>
    ${legend}
    <div style="font-size:.72rem;color:var(--muted);margin-top:4px;padding:0 4px">* estimated (not yet filed)</div>
  </div>`;
}

// ── CPF Projection ────────────────────────────────────────────────────────────
// Projects OA and SA separately from age 56 to 65 given state after RA formation at 55.
// FRS scenario: RA funded from SA only (OA untouched).
// ERS scenario: RA funded from SA first, then OA for the shortfall.
function simulateSAOAto65(oa55, sa55, ma55, raTarget, retireAge, annualSalary, topupFromOA) {
  const raFromSA = Math.min(sa55, raTarget);
  const raFromOA = topupFromOA ? Math.min(oa55, Math.max(0, raTarget - raFromSA)) : 0;
  let sa = sa55 - raFromSA;
  let oa = oa55 - raFromOA;
  let ma = ma55;

  for (let age = 56; age <= 65; age++) {
    if (age < retireAge) {
      const alloc = cpfAlloc(age);
      let oaAdd = annualSalary * alloc.oa;
      let maAdd = annualSalary * alloc.ma;
      const newMA = (ma + maAdd) * (1 + CPF_INT_MA);
      if (newMA > CPF_BHS) { oaAdd += (newMA - CPF_BHS); ma = CPF_BHS; } else { ma = newMA; }
      oa = (oa + oaAdd) * (1 + CPF_INT_OA);
      sa = sa * (1 + CPF_INT_SA);
    } else {
      oa = oa * (1 + CPF_INT_OA);
      sa = sa * (1 + CPF_INT_SA);
      ma = ma * (1 + CPF_INT_MA);
    }
  }
  return { sa: Math.round(sa), oa: Math.round(oa), raFromSA: Math.round(raFromSA), raFromOA: Math.round(raFromOA) };
}

function calcCpfProjection() {
  const s = data.cpfSettings || {};
  if (!s.dateOfBirth) return null;
  const dobYear = parseInt(s.dateOfBirth.slice(0, 4));
  if (!dobYear) return null;
  const retireAge = parseInt(s.retirementAge) || 65;
  const monthlySalary = Math.min(parseFloat(s.monthlySalary) || 0, CPF_OW_CAP);
  const annualSalary = monthlySalary * 12;
  const currentYear = new Date().getFullYear();

  const records = (data.cpfRecords || []).slice().sort((a, b) => a.year - b.year);
  const lastRecord = records[records.length - 1];

  let startYear, oa, sa, ma;
  if (lastRecord) {
    startYear = parseInt(lastRecord.year) + 1;
    oa = lastRecord.oaBalance || 0;
    sa = lastRecord.saBalance || 0;
    ma = lastRecord.maBalance || 0;
  } else {
    startYear = currentYear;
    oa = sa = ma = 0;
  }

  const retireYear = dobYear + retireAge;
  const payoutStartYear = dobYear + 65; // CPF LIFE always starts at 65
  const endYear = Math.max(retireYear, payoutStartYear);
  if (startYear > endYear) return null;

  const points = [];
  let ra = 0, raFormed = false;
  let oa55pre = null, sa55pre = null, ma55pre = null;

  for (let y = startYear; y <= endYear; y++) {
    const age = y - dobYear;

    if (age < 55) {
      const alloc = cpfAlloc(age);
      let oaAdd = annualSalary * alloc.oa;
      let saAdd = annualSalary * alloc.sa;
      let maAdd = annualSalary * alloc.ma;

      const newMA = (ma + maAdd) * (1 + CPF_INT_MA);
      if (newMA > CPF_BHS) { saAdd += (newMA - CPF_BHS); ma = CPF_BHS; } else { ma = newMA; }
      sa = (sa + saAdd) * (1 + CPF_INT_SA);
      oa = (oa + oaAdd) * (1 + CPF_INT_OA);

    } else if (!raFormed) {
      // Age 55: last normal contribution year, then RA formation
      const alloc = cpfAlloc(age);
      let oaAdd = annualSalary * alloc.oa;
      let saAdd = annualSalary * alloc.sa;
      let maAdd = annualSalary * alloc.ma;

      const newMA = (ma + maAdd) * (1 + CPF_INT_MA);
      if (newMA > CPF_BHS) { saAdd += (newMA - CPF_BHS); ma = CPF_BHS; } else { ma = newMA; }
      sa = (sa + saAdd) * (1 + CPF_INT_SA);
      oa = (oa + oaAdd) * (1 + CPF_INT_OA);

      oa55pre = oa; sa55pre = sa; ma55pre = ma;
      const transfer = Math.min(sa, CPF_FRS);
      ra = transfer;
      sa -= transfer;
      raFormed = true;

    } else if (age < retireAge) {
      // Post-55: contributions to OA and MA only; SA earns interest on existing balance, RA grows at RA rate
      const alloc = cpfAlloc(age);
      let oaAdd = annualSalary * alloc.oa;
      let maAdd = annualSalary * alloc.ma;

      const newMA = (ma + maAdd) * (1 + CPF_INT_MA);
      if (newMA > CPF_BHS) { oaAdd += (newMA - CPF_BHS); ma = CPF_BHS; } else { ma = newMA; }
      oa = (oa + oaAdd) * (1 + CPF_INT_OA);
      sa = sa * (1 + CPF_INT_SA);
      ra = ra * (1 + CPF_INT_RA);

    } else {
      // At/after retirement: interest only, no contributions
      oa = oa * (1 + CPF_INT_OA);
      sa = sa * (1 + CPF_INT_SA);
      ma = ma * (1 + CPF_INT_MA);
      ra = ra * (1 + CPF_INT_RA);
    }

    points.push({ year: y, age, oa: Math.round(oa), sa: Math.round(sa), ma: Math.round(ma), ra: Math.round(ra) });
  }

  // CPF LIFE always starts at 65; use RA at age 65 for payout calculation
  const pt65 = points.find(p => p.age === 65) || points[points.length - 1] || {};
  const lifeExp = parseFloat(s.lifeExpectancy) || 85;
  const mortalityFactor = parseFloat(s.mortalityFactor) || 1.35;
  const ersGrowthRate = parseFloat(s.ersGrowthRate) || 3.5;
  const factor = cpfLifeMonthlyFactor(lifeExp, mortalityFactor);
  const lifePayout = Math.round((pt65.ra || 0) * factor);
  const yearsToRetire = Math.max(0, payoutStartYear - currentYear); // years until CPF LIFE starts at 65
  const projFRS = Math.round(CPF_FRS * Math.pow(1 + ersGrowthRate / 100, yearsToRetire));
  const projERS = Math.round(CPF_ERS * Math.pow(1 + ersGrowthRate / 100, yearsToRetire));
  const frsRefPayout = Math.round(projFRS * factor);
  const ersRefPayout = Math.round(projERS * factor);
  const ra65 = pt65.ra || 0;

  // SA and OA at 65 for FRS and ERS scenarios (retirement withdrawal amount)
  let frsSA65 = null, frsOA65 = null, ersSA65 = null, ersOA65 = null;
  let frsRaFromSA = null, frsRaFromOA = null, ersRaFromSA = null, ersRaFromOA = null;
  if (oa55pre !== null) {
    const frsRes = simulateSAOAto65(oa55pre, sa55pre, ma55pre, CPF_FRS, retireAge, annualSalary, false);
    const ersRes = simulateSAOAto65(oa55pre, sa55pre, ma55pre, CPF_ERS, retireAge, annualSalary, true);
    frsSA65 = frsRes.sa; frsOA65 = frsRes.oa;
    frsRaFromSA = frsRes.raFromSA; frsRaFromOA = frsRes.raFromOA;
    ersSA65 = ersRes.sa; ersOA65 = ersRes.oa;
    ersRaFromSA = ersRes.raFromSA; ersRaFromOA = ersRes.raFromOA;
  }

  return { points, lifePayout, frsRefPayout, ersRefPayout, projFRS, projERS, yearsToRetire, retireYear, retireAge, dobYear, ra65, frsSA65, frsOA65, ersSA65, ersOA65, frsRaFromSA, frsRaFromOA, ersRaFromSA, ersRaFromOA, oa55pre, sa55pre };
}

function renderCpfChart(proj) {
  const { points } = proj;
  if (points.length < 2) return '';

  const OA_COLOR = '#2980b9', SA_COLOR = '#e67e22', MA_COLOR = '#27ae60', RA_COLOR = '#8e44ad';
  const COL_W = 52, H = 160, PAD_L = 44, PAD_B = 28, PAD_T = 16, PAD_R = 12;
  const svgW = PAD_L + points.length * COL_W + PAD_R;
  const svgH = H + PAD_T + PAD_B;

  const maxVal = Math.max(...points.map(p => Math.max(p.oa, p.sa, p.ma, p.ra)), 1);
  const scale = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const maxY = Math.ceil(maxVal / scale) * scale;
  const xPos = i => PAD_L + i * COL_W + COL_W / 2;
  const yPos = v => PAD_T + H - Math.min(1, v / maxY) * H;

  const ticks = [0, .25, .5, .75, 1].map(f => ({ v: maxY * f, y: yPos(maxY * f) }));
  const grid = ticks.map(({ v, y }) =>
    `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${(svgW - PAD_R).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e8dece" stroke-width="1"/>` +
    `<text x="${(PAD_L - 4).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="8" fill="#7a6a52">${fmtShort(v)}</text>`
  ).join('');

  function line(vals, color, dash) {
    const pts = vals.map((v, i) => [xPos(i), yPos(v)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const da = dash ? ` stroke-dasharray="${dash}"` : '';
    const dots = pts.map(([cx, cy]) =>
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`
    ).join('');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"${da} stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  }

  // Vertical milestone lines at age 55, retirement, and 65 (CPF LIFE start)
  const milestones = points.map((p, i) => {
    const isMilestone = p.age === 55 || p.age === proj.retireAge || p.age === 65;
    if (!isMilestone) return '';
    const x = xPos(i);
    const lbl = p.age === 55 ? 'Age 55' : p.age === 65 ? 'CPF LIFE 65' : `Retire ${p.age}`;
    return `<line x1="${x.toFixed(1)}" y1="${PAD_T}" x2="${x.toFixed(1)}" y2="${(PAD_T + H).toFixed(1)}" stroke="#aaa" stroke-width="1" stroke-dasharray="3 3"/>` +
           `<text x="${x.toFixed(1)}" y="${(PAD_T - 3).toFixed(1)}" text-anchor="middle" font-size="7" fill="#aaa">${lbl}</text>`;
  }).join('');

  // X-axis labels: every 2 years
  const xLabels = points.map((p, i) => {
    if (i % 2 !== 0 && i !== points.length - 1) return '';
    return `<text x="${xPos(i).toFixed(1)}" y="${svgH - 4}" text-anchor="middle" font-size="8" fill="#7a6a52">${p.year}</text>`;
  }).join('');

  const legend = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px;padding:0 4px;font-size:.75rem;color:var(--text)">
    <span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:14px;height:3px;background:${OA_COLOR};border-radius:2px"></span>OA</span>
    <span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:14px;height:3px;background:${SA_COLOR};border-radius:2px"></span>SA</span>
    <span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:14px;height:3px;background:${MA_COLOR};border-radius:2px"></span>MA</span>
    <span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:14px;height:3px;background:${RA_COLOR};border-radius:2px"></span>RA (from 55)</span>
  </div>`;

  return `<div class="chart-wrap">
    <div class="chart-title">CPF Balance Projection</div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <svg width="${svgW}" height="${svgH}" style="display:block">
        ${grid}${milestones}
        ${line(points.map(p => p.oa), OA_COLOR, '')}
        ${line(points.map(p => p.sa), SA_COLOR, '4 3')}
        ${line(points.map(p => p.ma), MA_COLOR, '2 2')}
        ${line(points.map(p => p.ra), RA_COLOR, '')}
        ${xLabels}
      </svg>
    </div>
    ${legend}
    <div style="font-size:.72rem;color:var(--muted);margin-top:4px;padding:0 4px">Rates: OA 2.5% · SA/RA/MA 4% · No contribution after retirement age. BHS cap $${CPF_BHS.toLocaleString()} · FRS $${CPF_FRS.toLocaleString()} · ERS $${CPF_ERS.toLocaleString()}.</div>
  </div>`;
}

function renderCpf() {
  const el = document.getElementById('cpfContent');
  if (!el) return;

  const s = data.cpfSettings || {};
  const records = (data.cpfRecords || []).slice().sort((a, b) => b.year - a.year);
  const proj = calcCpfProjection();

  const hasDOB = !!s.dateOfBirth;
  const dobDisplay = hasDOB
    ? new Date(s.dateOfBirth + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : 'Not set';

  const settingsBar = `<div class="cpf-settings-bar">
    <div>
      <div style="font-size:.95rem;font-weight:700">Projection Settings</div>
      <div class="cpf-settings-bar-meta">DOB: ${dobDisplay} · Retire: ${s.retirementAge || 60} · Salary: ${fmtDollar((s.monthlySalary || 0))} /mo</div>
    </div>
    <button class="btn btn-secondary" style="font-size:.78rem;padding:6px 10px" onclick="openAccountSettings()">Edit</button>
  </div>`;

  const retireAgeVal = s.retirementAge   ?? 60;
  const lifeExp      = s.lifeExpectancy  ?? 85;
  const ersGrowth    = s.ersGrowthRate   ?? 3.5;
  const mortFactor   = s.mortalityFactor ?? 1.35;
  const sliderLblStyle = 'font-size:.8rem;font-weight:700;min-width:3.2em;text-align:right';

  const assumptionsCard = `<div style="background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 16px;margin-bottom:12px">
    <div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">CPF LIFE Assumptions</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 20px">
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:.72rem;color:var(--muted)">Retirement Age</span>
          <span id="cpfRetireAgeVal" style="${sliderLblStyle}">${retireAgeVal} yrs</span>
        </div>
        <input type="range" id="cpfRetireAgeSlider" min="55" max="65" step="1" value="${retireAgeVal}" oninput="updateCpfSlider(this,'cpfRetireAgeVal',' yrs');saveCpfAssumptions()" style="width:100%;accent-color:var(--primary)">
        <div style="display:flex;justify-content:space-between;font-size:.65rem;color:var(--muted);margin-top:1px"><span>55</span><span>65</span></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:.72rem;color:var(--muted)">Life Expectancy</span>
          <span id="cpfLifeExpVal" style="${sliderLblStyle}">${lifeExp} yrs</span>
        </div>
        <input type="range" id="cpfLifeExpSlider" min="82" max="92" step="1" value="${lifeExp}" oninput="updateCpfSlider(this,'cpfLifeExpVal',' yrs');saveCpfAssumptions()" style="width:100%;accent-color:var(--primary)">
        <div style="display:flex;justify-content:space-between;font-size:.65rem;color:var(--muted);margin-top:1px"><span>82</span><span>92</span></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:.72rem;color:var(--muted)">ERS Growth / yr</span>
          <span id="cpfErsGrowthVal" style="${sliderLblStyle}">${ersGrowth}%</span>
        </div>
        <input type="range" id="cpfErsGrowthSlider" min="1" max="5" step="0.5" value="${ersGrowth}" oninput="updateCpfSlider(this,'cpfErsGrowthVal','%');saveCpfAssumptions()" style="width:100%;accent-color:var(--primary)">
        <div style="display:flex;justify-content:space-between;font-size:.65rem;color:var(--muted);margin-top:1px"><span>1%</span><span>5%</span></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:.72rem;color:var(--muted)">Mortality Credit</span>
          <span id="cpfMortFactorVal" style="${sliderLblStyle}">${mortFactor}×</span>
        </div>
        <input type="range" id="cpfMortFactorSlider" min="1" max="1.5" step="0.05" value="${mortFactor}" oninput="updateCpfSlider(this,'cpfMortFactorVal','×');saveCpfAssumptions()" style="width:100%;accent-color:var(--primary)">
        <div style="display:flex;justify-content:space-between;font-size:.65rem;color:var(--muted);margin-top:1px"><span>1.00×</span><span>1.50×</span></div>
      </div>
    </div>
  </div>`;

  const explanationCard = `<details style="background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 16px;margin-bottom:12px">
    <summary style="font-size:.82rem;font-weight:700;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center">
      How CPF LIFE payouts are estimated
      <span class="material-symbols-outlined" style="font-size:1.1rem;opacity:.55;flex-shrink:0">expand_more</span>
    </summary>
    <div style="margin-top:12px;font-size:.82rem;color:var(--text);line-height:1.6;display:flex;flex-direction:column;gap:10px">
      <div><span style="font-weight:700">Life expectancy</span> sets the assumed payout duration. A longer life means the pool must sustain payments for more years, so each monthly amount is lower. Singapore's current average is ~85, but planners often use 88–90 to be conservative. If your life expectancy assumption rises, your projected payout falls.</div>
      <div><span style="font-weight:700">Mortality credits</span> are a bonus unique to life annuities. When a CPF LIFE member passes away before exhausting their premiums, the remainder is redistributed to surviving members as extra monthly income. This is why CPF LIFE pays significantly more than a simple fixed-term drawdown — the multiplier represents that boost (1.0 = no credits / pure annuity, typical CPF LIFE ≈ 1.3–1.4×). As life expectancy rises and fewer members die early, this multiplier shrinks.</div>
      <div><span style="font-weight:700">ERS annual growth</span> projects how much the Enhanced Retirement Sum will grow by the time you retire. CPF has historically raised it ~3–3.5% per year in line with wages. The FRS and ERS reference payouts are shown at their projected values at your retirement age.</div>
      <div style="color:var(--muted);font-size:.78rem;border-top:1px solid var(--border);padding-top:8px;margin-top:2px">These are estimates only. CPF Board's actual actuarial tables are not public. At age 65 the defaults here closely match CPF's 2025 indicative payout ranges. The mortality credit multiplier will decrease if life expectancy continues to improve.</div>
    </div>
  </details>`;

  let milestoneHtml = '';
  if (proj && proj.lifePayout > 0) {
    const frsSubLabel = proj.yearsToRetire > 0
      ? `Projected RA ~${fmtDollar(proj.projFRS)} in ${proj.yearsToRetire} yrs`
      : `RA: ${fmtDollar(CPF_FRS)}`;
    const ersSubLabel = proj.yearsToRetire > 0
      ? `Projected RA ~${fmtDollar(proj.projERS)} in ${proj.yearsToRetire} yrs`
      : `RA: ${fmtDollar(CPF_ERS)}`;
    milestoneHtml = `<div class="cpf-milestone">
      <div class="cpf-milestone-title">Your CPF LIFE payout · from age 65</div>
      <div class="cpf-milestone-value">~${fmtDollar(proj.lifePayout)} / month</div>
      <div class="cpf-milestone-sub">RA at age 65: ${fmtDollar(proj.ra65)} · CPF LIFE estimate</div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:12px">
      <div style="flex:1;background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:12px;border-left:3px solid var(--primary)">
        <div style="font-size:.7rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">FRS Plan</div>
        <div style="font-size:1.15rem;font-weight:800;margin-top:4px">~${fmtDollar(proj.frsRefPayout)} / mo</div>
        <div style="font-size:.78rem;color:var(--muted);margin-top:2px">${frsSubLabel}</div>
        ${proj.oa55pre !== null ? `
          <div style="font-size:.78rem;color:var(--text);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">
            <div style="font-size:.7rem;color:var(--muted);margin-bottom:3px;font-weight:600">BALANCES AT 55</div>
            <div style="display:flex;justify-content:space-between"><span>SA</span><strong>${fmtDollar(proj.sa55pre)}</strong></div>
            <div style="display:flex;justify-content:space-between;margin-top:2px"><span>OA</span><strong>${fmtDollar(proj.oa55pre)}</strong></div>
          </div>
          <div style="font-size:.78rem;color:var(--text);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">
            <div style="font-size:.7rem;color:var(--muted);margin-bottom:3px;font-weight:600">TRANSFERRED → RA</div>
            <div style="display:flex;justify-content:space-between"><span>from SA</span><strong>${fmtDollar(proj.frsRaFromSA)}</strong></div>
            <div style="display:flex;justify-content:space-between;margin-top:2px"><span>from OA</span><strong>—</strong></div>
          </div>` : ''}
        ${proj.frsSA65 !== null ? `
          <div style="font-size:.78rem;color:var(--text);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">
            <div style="font-size:.7rem;color:var(--muted);margin-bottom:3px;font-weight:600">REMAINING AT 65</div>
            <div style="display:flex;justify-content:space-between"><span>SA</span><strong>${fmtDollar(proj.frsSA65)}</strong></div>
            <div style="display:flex;justify-content:space-between;margin-top:2px"><span>OA</span><strong>${fmtDollar(proj.frsOA65)}</strong></div>
          </div>` : ''}
      </div>
      <div style="flex:1;background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:12px;border-left:3px solid var(--primary)">
        <div style="font-size:.7rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">ERS Plan</div>
        <div style="font-size:1.15rem;font-weight:800;margin-top:4px">~${fmtDollar(proj.ersRefPayout)} / mo</div>
        <div style="font-size:.78rem;color:var(--muted);margin-top:2px">${ersSubLabel}</div>
        ${proj.oa55pre !== null ? `
          <div style="font-size:.78rem;color:var(--text);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">
            <div style="font-size:.7rem;color:var(--muted);margin-bottom:3px;font-weight:600">BALANCES AT 55</div>
            <div style="display:flex;justify-content:space-between"><span>SA</span><strong>${fmtDollar(proj.sa55pre)}</strong></div>
            <div style="display:flex;justify-content:space-between;margin-top:2px"><span>OA</span><strong>${fmtDollar(proj.oa55pre)}</strong></div>
          </div>
          <div style="font-size:.78rem;color:var(--text);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">
            <div style="font-size:.7rem;color:var(--muted);margin-bottom:3px;font-weight:600">TRANSFERRED → RA</div>
            <div style="display:flex;justify-content:space-between"><span>from SA</span><strong>${fmtDollar(proj.ersRaFromSA)}</strong></div>
            <div style="display:flex;justify-content:space-between;margin-top:2px"><span>from OA</span><strong>${fmtDollar(proj.ersRaFromOA)}</strong></div>
          </div>` : ''}
        ${proj.ersSA65 !== null ? `
          <div style="font-size:.78rem;color:var(--text);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">
            <div style="font-size:.7rem;color:var(--muted);margin-bottom:3px;font-weight:600">REMAINING AT 65</div>
            <div style="display:flex;justify-content:space-between"><span>SA</span><strong>${fmtDollar(proj.ersSA65)}</strong></div>
            <div style="display:flex;justify-content:space-between;margin-top:2px"><span>OA</span><strong>${fmtDollar(proj.ersOA65)}</strong></div>
          </div>` : ''}
      </div>
    </div>
    ${assumptionsCard}${explanationCard}`;
  }

  let ra55Html = '';
  if (proj) {
    const pt55 = proj.points.find(p => p.age === 55);
    if (pt55) {
      ra55Html = `<div style="background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:12px 16px;margin-bottom:12px">
        <div style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Age 55 Milestone (${pt55.year})</div>
        <div style="font-size:.9rem;margin-top:5px"><span style="font-weight:700">RA formed: ${fmtDollar(pt55.ra)}</span> <span style="color:var(--muted);font-size:.8rem">(SA transferred, up to FRS ${fmtDollar(CPF_FRS)})</span></div>
        <div style="font-size:.82rem;color:var(--muted);margin-top:2px">OA: ${fmtDollar(pt55.oa)} · SA remaining: ${fmtDollar(pt55.sa)}</div>
      </div>`;
    }
  }

  const chart = proj ? renderCpfChart(proj) : '';

  const addBtn = `<div style="display:flex;justify-content:flex-end;margin:8px 0 12px">
    <button class="btn btn-primary" style="font-size:.82rem;padding:7px 14px" onclick="openCpfEntrySheet(null)">+ Add Record</button>
  </div>`;

  let listHtml;
  if (!records.length) {
    listHtml = `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">savings</span></div>No CPF records yet.<br>Tap + to add your yearly balances.</div>`;
  } else {
    listHtml = records.map(r => {
      const total = (r.oaBalance || 0) + (r.saBalance || 0) + (r.maBalance || 0);
      const totalInt = (r.oaInterest || 0) + (r.saInterest || 0) + (r.maInterest || 0);
      return `<div class="cpf-card" onclick="openCpfEntrySheet('${esc(r.id)}')">
        <div class="cpf-card-year">${esc(String(r.year))}</div>
        <div class="cpf-card-meta">
          <span><span class="label">OA</span>${fmtDollar(r.oaBalance || 0)}</span>
          <span><span class="label">SA</span>${fmtDollar(r.saBalance || 0)}</span>
          <span><span class="label">MA</span>${fmtDollar(r.maBalance || 0)}</span>
          <span><span class="label">Interest</span>${fmtDollar(totalInt)}</span>
        </div>
        <div class="cpf-card-total">Total: ${fmtDollar(total)}</div>
      </div>`;
    }).join('');
  }

  el.innerHTML = settingsBar + milestoneHtml + chart + ra55Html +
    `<div class="section-heading">Recorded Balances</div>` + addBtn + listHtml;
}

function updateCpfSlider(el, labelId, suffix) {
  const lbl = document.getElementById(labelId);
  if (lbl) lbl.textContent = el.value + suffix;
}

function saveCpfAssumptions() {
  if (!data.cpfSettings) data.cpfSettings = {};
  const retireAge = parseInt(document.getElementById('cpfRetireAgeSlider')?.value);
  const lifeExp   = parseFloat(document.getElementById('cpfLifeExpSlider')?.value);
  const ersGrowth = parseFloat(document.getElementById('cpfErsGrowthSlider')?.value);
  const mortFactor = parseFloat(document.getElementById('cpfMortFactorSlider')?.value);
  if (!isNaN(retireAge) && retireAge >= 55 && retireAge <= 65) data.cpfSettings.retirementAge = retireAge;
  if (!isNaN(lifeExp) && lifeExp >= 82 && lifeExp <= 92) data.cpfSettings.lifeExpectancy = lifeExp;
  if (!isNaN(ersGrowth) && ersGrowth >= 1 && ersGrowth <= 5) data.cpfSettings.ersGrowthRate = ersGrowth;
  if (!isNaN(mortFactor) && mortFactor >= 1.0 && mortFactor <= 1.5) data.cpfSettings.mortalityFactor = mortFactor;
  saveData(data);
  renderCpf();
}

function openCpfEntrySheet(id) {
  document.getElementById('cpfEntryForm').reset();
  document.getElementById('cpfEntryId').value = '';
  document.getElementById('cpfEntryDeleteBtn').style.display = 'none';
  document.getElementById('cpfEntryYear').value = new Date().getFullYear() - 1;

  if (id) {
    const r = (data.cpfRecords || []).find(x => x.id === id);
    if (!r) return;
    document.getElementById('cpfEntrySheetTitle').textContent = 'Edit CPF Record';
    document.getElementById('cpfEntryId').value = id;
    document.getElementById('cpfEntryYear').value = r.year;
    document.getElementById('cpfOA').value = r.oaBalance || '';
    document.getElementById('cpfSA').value = r.saBalance || '';
    document.getElementById('cpfMA').value = r.maBalance || '';
    document.getElementById('cpfOAInt').value = r.oaInterest || '';
    document.getElementById('cpfSAInt').value = r.saInterest || '';
    document.getElementById('cpfMAInt').value = r.maInterest || '';
    document.getElementById('cpfEntryDeleteBtn').style.display = '';
  } else {
    document.getElementById('cpfEntrySheetTitle').textContent = 'Add CPF Record';
  }
  openSheet('cpfEntrySheet');
  setTimeout(() => document.getElementById('cpfEntryYear').focus(), 350);
}

document.getElementById('cpfEntryForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('cpfEntryId').value;
  const year = parseInt(document.getElementById('cpfEntryYear').value);
  if (!year) return;
  const entry = {
    id: id || uid(), year,
    oaBalance:  parseFloat(document.getElementById('cpfOA').value) || 0,
    saBalance:  parseFloat(document.getElementById('cpfSA').value) || 0,
    maBalance:  parseFloat(document.getElementById('cpfMA').value) || 0,
    oaInterest: parseFloat(document.getElementById('cpfOAInt').value) || 0,
    saInterest: parseFloat(document.getElementById('cpfSAInt').value) || 0,
    maInterest: parseFloat(document.getElementById('cpfMAInt').value) || 0,
    _ts: Date.now()
  };
  if (!data.cpfRecords) data.cpfRecords = [];
  if (id) {
    const idx = data.cpfRecords.findIndex(r => r.id === id);
    if (idx >= 0) data.cpfRecords[idx] = entry; else data.cpfRecords.push(entry);
  } else {
    data.cpfRecords.push(entry);
  }
  saveData(data);
  closeSheet();
  showToast(id ? 'CPF record updated' : 'CPF record added');
  if (currentTaxSubTab === 'cpf') renderCpf();
});

function deleteCpfRecord() {
  const id = document.getElementById('cpfEntryId').value;
  if (!id || !confirm('Delete this CPF record?')) return;
  data._deletedIds.push(id);
  data.cpfRecords = (data.cpfRecords || []).filter(r => r.id !== id);
  saveData(data);
  closeSheet();
  showToast('CPF record deleted');
  if (currentTaxSubTab === 'cpf') renderCpf();
}

// ── Render: Tax Records ───────────────────────────────────────────────────────
function calcEffectiveTax(r) {
  if (r.isHistorical) return r.taxPaid || 0;
  const assessable = (r.basicSalary || 0) + (r.bonus || 0) + (r.otherIncome || 0);
  const totalRelief = (r.cpfEmployee || 0) + (r.reliefs || []).reduce((s, x) => s + (x.amount || 0), 0);
  const chargeable = Math.max(0, assessable - totalRelief);
  return Math.max(0, calcSGTax(chargeable) - (r.taxRebate || 0));
}

function renderTaxRecords() {
  const stripEl = document.getElementById('taxSummaryStrip');
  const listEl = document.getElementById('taxList');
  if (!stripEl || !listEl) return;
  const chartEl = document.getElementById('taxChart');
  if (chartEl) chartEl.innerHTML = renderTaxChart();

  const records = (data.taxRecords || []).slice().sort((a, b) => b.year - a.year);

  const estimated = records.find(r => !r.isHistorical);
  const filed = records.find(r => r.isHistorical);
  let stripHtml = '';
  if (estimated) stripHtml += `<div class="tax-summary-item"><div class="tax-summary-label">YA ${estimated.year + 1} Est. Tax</div><div class="tax-summary-value">${fmtDollar(calcEffectiveTax(estimated))}</div></div>`;
  if (filed) stripHtml += `<div class="tax-summary-item"><div class="tax-summary-label">YA ${filed.year + 1} Filed Tax</div><div class="tax-summary-value">${fmtDollar(filed.taxPaid || 0)}</div></div>`;
  stripEl.innerHTML = stripHtml ? `<div class="tax-summary-strip">${stripHtml}</div>` : '';

  if (!records.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">receipt_long</span></div>No tax records yet.<br>Tap + to add one.</div>';
    return;
  }

  listEl.innerHTML = records.map(r => {
    let assessable, chargeable, taxPayable, taxBeforeRebate, effectiveRate;
    if (r.isHistorical) {
      assessable = r.totalIncome || 0;
      chargeable = Math.max(0, assessable - (r.totalRelief || 0));
      taxPayable = r.taxPaid || 0;
      taxBeforeRebate = taxPayable + (r.taxRebate || 0);
      effectiveRate = assessable > 0 ? (taxPayable / assessable * 100).toFixed(1) : '0.0';
    } else {
      assessable = (r.basicSalary || 0) + (r.bonus || 0) + (r.otherIncome || 0);
      const totalRelief = (r.cpfEmployee || 0) + (r.reliefs || []).reduce((s, x) => s + (x.amount || 0), 0);
      chargeable = Math.max(0, assessable - totalRelief);
      taxBeforeRebate = calcSGTax(chargeable);
      taxPayable = Math.max(0, taxBeforeRebate - (r.taxRebate || 0));
      effectiveRate = assessable > 0 ? (taxPayable / assessable * 100).toFixed(1) : '0.0';
    }
    const badgeClass = r.isHistorical ? ' filed' : '';
    const badgeLabel = r.isHistorical ? 'Filed' : 'Estimate';
    const metaHtml = r.isHistorical
      ? `<span><span class="label">Income:</span>${fmtDollar(assessable)}</span>
         <span><span class="label">Relief:</span>${fmtDollar(r.totalRelief || 0)}</span>
         <span><span class="label">Tax Before Rebate:</span>${fmtDollar(taxBeforeRebate)}</span>
         <span><span class="label">Tax Rebate:</span>${fmtDollar(r.taxRebate || 0)}</span>`
      : `<span><span class="label">Assessable Income:</span>${fmtDollar(assessable)}</span>
         <span><span class="label">Chargeable Income:</span>${fmtDollar(chargeable)}</span>`;
    return `<div class="tax-card" onclick="openTaxSheet('${esc(r.id)}')">
      <div class="tax-card-header">
        <div class="tax-year">YA ${r.year + 1} <span style="font-size:.85rem;font-weight:600;color:var(--muted)">(${r.year} income)</span></div>
        <div class="tax-badge${badgeClass}">${badgeLabel}</div>
      </div>
      <div class="tax-meta">${metaHtml}</div>
      <div class="tax-payable">Tax Payable: ${fmtDollar(taxPayable)} <span style="font-size:.85rem;font-weight:600;color:var(--muted)">(${effectiveRate}% effective)</span></div>
    </div>`;
  }).join('');
}

// ── Tax Sheet ─────────────────────────────────────────────────────────────────
let _taxMode = 'estimate';

function setTaxMode(mode) {
  _taxMode = mode;
  document.getElementById('taxModeEstimate').classList.toggle('active', mode === 'estimate');
  document.getElementById('taxModeFiled').classList.toggle('active', mode === 'historical');
  document.getElementById('taxEstimateSection').style.display = mode === 'estimate' ? '' : 'none';
  document.getElementById('taxHistoricalSection').style.display = mode === 'historical' ? '' : 'none';
  if (mode === 'estimate') updateTaxPreview();
}

function openTaxSheet(id) {
  const form = document.getElementById('taxForm');
  form.reset();
  document.getElementById('taxId').value = '';
  document.getElementById('taxDeleteBtn').style.display = 'none';
  document.getElementById('taxReliefsList').innerHTML = '';
  document.getElementById('taxPreview').style.display = 'none';
  document.getElementById('taxYear').value = new Date().getFullYear();
  setTaxMode('estimate');

  if (id) {
    const r = (data.taxRecords || []).find(x => x.id === id);
    if (!r) return;
    document.getElementById('taxSheetTitle').textContent = 'Edit Year';
    document.getElementById('taxId').value = id;
    document.getElementById('taxYear').value = r.year;
    if (r.isHistorical) {
      setTaxMode('historical');
      document.getElementById('taxTotalIncome').value = r.totalIncome || '';
      document.getElementById('taxTotalRelief').value = r.totalRelief || '';
      document.getElementById('taxRebateHistorical').value = r.taxRebate || '';
      document.getElementById('taxPaid').value = r.taxPaid || '';
    } else {
      setTaxMode('estimate');
      document.getElementById('taxBasicSalary').value = r.basicSalary || '';
      document.getElementById('taxBonus').value = r.bonus || '';
      document.getElementById('taxOtherIncome').value = r.otherIncome || '';
      document.getElementById('taxCpfEmployee').value = r.cpfEmployee || '';
      (r.reliefs || []).forEach(rel => addTaxReliefRow(rel.name, rel.amount));
      document.getElementById('taxRebate').value = r.taxRebate || '';
      updateTaxPreview();
    }
    document.getElementById('taxDeleteBtn').style.display = '';
  } else {
    document.getElementById('taxSheetTitle').textContent = 'Add Year';
  }
  openSheet('taxSheet');
}

let _taxReliefCounter = 0;

function addTaxReliefRow(name, amount) {
  const rowId = 'taxRelief_' + (++_taxReliefCounter);
  const container = document.getElementById('taxReliefsList');
  const div = document.createElement('div');
  div.className = 'tax-relief-row';
  div.id = rowId;
  div.innerHTML = `<input type="text" placeholder="Relief name" value="${esc(name || '')}" oninput="updateTaxPreview()">` +
    `<input type="number" placeholder="0.00" min="0" step="0.01" value="${amount || ''}" class="tax-relief-amount" oninput="updateTaxPreview()">` +
    `<button type="button" class="tax-relief-remove" onclick="removeTaxReliefRow('${rowId}')">×</button>`;
  container.appendChild(div);
  updateTaxPreview();
}

function removeTaxReliefRow(rowId) {
  const el = document.getElementById(rowId);
  if (el) el.remove();
  updateTaxPreview();
}

function updateTaxPreview() {
  const preview = document.getElementById('taxPreview');
  if (!preview) return;
  const salary = parseFloat(document.getElementById('taxBasicSalary').value) || 0;
  const bonus  = parseFloat(document.getElementById('taxBonus').value) || 0;
  const other  = parseFloat(document.getElementById('taxOtherIncome').value) || 0;
  const cpf    = parseFloat(document.getElementById('taxCpfEmployee').value) || 0;
  const rebate = parseFloat(document.getElementById('taxRebate').value) || 0;
  let totalReliefs = 0;
  document.querySelectorAll('#taxReliefsList .tax-relief-row').forEach(row => {
    totalReliefs += parseFloat(row.querySelectorAll('input')[1].value) || 0;
  });
  const assessable  = salary + bonus + other;
  const chargeable  = Math.max(0, assessable - cpf - totalReliefs);
  const taxBefore   = calcSGTax(chargeable);
  const taxPayable  = Math.max(0, taxBefore - rebate);
  if (!(salary || bonus || other || cpf || totalReliefs || rebate)) { preview.style.display = 'none'; return; }
  const effectiveRate = assessable > 0 ? (taxPayable / assessable * 100).toFixed(1) : '0.0';
  preview.style.display = '';
  document.getElementById('pvAssessable').textContent  = fmtDollar(assessable);
  document.getElementById('pvCpf').textContent         = '−' + fmtDollar(cpf);
  document.getElementById('pvReliefs').textContent     = '−' + fmtDollar(totalReliefs);
  document.getElementById('pvChargeable').textContent  = fmtDollar(chargeable);
  document.getElementById('pvTaxBefore').textContent   = fmtDollar(taxBefore);
  document.getElementById('pvRebate').textContent      = '−' + fmtDollar(rebate);
  document.getElementById('pvTaxPayable').textContent  = fmtDollar(taxPayable);
  document.getElementById('pvEffectiveRate').textContent = effectiveRate + '%';
}

document.getElementById('taxForm').addEventListener('submit', e => {
  e.preventDefault();
  const id   = document.getElementById('taxId').value;
  const year = parseInt(document.getElementById('taxYear').value);
  if (!year) return;
  let entry;
  if (_taxMode === 'historical') {
    entry = {
      id: id || uid(), year, isHistorical: true,
      totalIncome:  parseFloat(document.getElementById('taxTotalIncome').value) || 0,
      totalRelief:  parseFloat(document.getElementById('taxTotalRelief').value) || 0,
      taxRebate:    parseFloat(document.getElementById('taxRebateHistorical').value) || 0,
      taxPaid:      parseFloat(document.getElementById('taxPaid').value) || 0,
      _ts: Date.now()
    };
  } else {
    const reliefs = [];
    document.querySelectorAll('#taxReliefsList .tax-relief-row').forEach(row => {
      const inputs = row.querySelectorAll('input');
      const name   = inputs[0] ? inputs[0].value.trim() : '';
      const amount = parseFloat(inputs[1] ? inputs[1].value : 0) || 0;
      if (name || amount) reliefs.push({ id: uid(), name, amount });
    });
    entry = {
      id: id || uid(), year, isHistorical: false,
      basicSalary:  parseFloat(document.getElementById('taxBasicSalary').value) || 0,
      bonus:        parseFloat(document.getElementById('taxBonus').value) || 0,
      otherIncome:  parseFloat(document.getElementById('taxOtherIncome').value) || 0,
      cpfEmployee:  parseFloat(document.getElementById('taxCpfEmployee').value) || 0,
      reliefs,
      taxRebate:    parseFloat(document.getElementById('taxRebate').value) || 0,
      _ts: Date.now()
    };
  }
  if (!data.taxRecords) data.taxRecords = [];
  if (id) {
    const idx = data.taxRecords.findIndex(r => r.id === id);
    if (idx >= 0) data.taxRecords[idx] = entry; else data.taxRecords.push(entry);
  } else {
    data.taxRecords.push(entry);
  }
  saveData(data);
  closeSheet();
  renderAll();
  showToast(id ? 'Tax record updated' : 'Tax record added');
});

function deleteTaxRecord() {
  const id = document.getElementById('taxId').value;
  if (!id) return;
  if (!confirm('Delete this tax record?')) return;
  data._deletedIds.push(id);
  data.taxRecords = (data.taxRecords || []).filter(r => r.id !== id);
  saveData(data);
  closeSheet();
  renderAll();
  showToast('Tax record deleted');
}

