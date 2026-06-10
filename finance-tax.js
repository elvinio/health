// ── Tax PIN ───────────────────────────────────────────────────────────────────
let taxPinUnlocked = false;
let taxPinBuffer = '';

function maybeShowTaxPin() {
  const pin = localStorage.getItem('finance:taxPin');
  if (!pin || taxPinUnlocked) return;
  taxPinBuffer = '';
  renderTaxPinDots();
  document.getElementById('taxPinError').textContent = '';
  document.getElementById('taxPinOverlay').style.display = '';
}

function taxPinKey(k) {
  const pin = localStorage.getItem('finance:taxPin') || '';
  if (k === 'back') {
    taxPinBuffer = taxPinBuffer.slice(0, -1);
    renderTaxPinDots();
    document.getElementById('taxPinError').textContent = '';
    return;
  }
  if (taxPinBuffer.length >= pin.length) return;
  taxPinBuffer += k;
  renderTaxPinDots();
  if (taxPinBuffer.length === pin.length) setTimeout(taxPinVerify, 80);
}

function taxPinVerify() {
  const pin = localStorage.getItem('finance:taxPin') || '';
  if (taxPinBuffer === pin) {
    taxPinUnlocked = true;
    document.getElementById('taxPinOverlay').style.display = 'none';
  } else {
    document.getElementById('taxPinError').textContent = 'Incorrect PIN';
    const pad = document.getElementById('taxPinPad');
    pad.classList.remove('tax-pin-shake');
    void pad.offsetWidth;
    pad.classList.add('tax-pin-shake');
    taxPinBuffer = '';
    setTimeout(renderTaxPinDots, 400);
  }
}

function renderTaxPinDots() {
  const pin = localStorage.getItem('finance:taxPin') || '';
  const filled = taxPinBuffer.length;
  document.getElementById('taxPinDots').innerHTML = Array.from({ length: pin.length }, (_, i) =>
    `<div class="tax-pin-dot${i < filled ? ' filled' : ''}"></div>`
  ).join('');
}

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

  const INCOME_COLOR = 'var(--primary)', TAX_COLOR = '#e74c3c';

  // Y-axis scaled to income (tax is always smaller, so it plots correctly within the range).
  const rawMax = Math.max(...records.map(r => r.income), 1);
  const scale = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const yMax = Math.ceil(rawMax / scale) * scale;

  const xLabels = records.map(r => `${r.year}${!r.isHistorical ? '*' : ''}`);
  const svg = lineChart({
    height: 140, padT: 16, xLabelSize: 9, xLabels, yMax,
    series: [
      { values: records.map(r => r.income), color: INCOME_COLOR, valueLabels: true },
      { values: records.map(r => r.tax), color: TAX_COLOR, dash: '5 3', valueLabels: true },
    ],
  });

  const legend = `<div style="display:flex;gap:16px;margin-top:6px;padding:0 4px;font-size:.75rem;color:var(--text)">
    <span style="display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:18px;height:3px;background:var(--primary);border-radius:2px"></span>Income</span>
    <span style="display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:18px;height:3px;background:#e74c3c;border-radius:2px;opacity:.7"></span>Tax Payable</span>
  </div>`;

  return `<div class="chart-wrap">
    <div class="chart-title">Income &amp; Tax Year-over-Year</div>
    <div class="scroll-x">${svg}</div>
    ${legend}
    <div style="font-size:.72rem;color:var(--muted);margin-top:4px;padding:0 4px">* estimated (not yet filed)</div>
  </div>`;
}

// ── CPF Projection ────────────────────────────────────────────────────────────
// Projects OA and SA separately from age 56 to 65 given state after RA formation at 55.
// FRS scenario: RA funded from SA only (OA untouched).
// ERS scenario: RA funded from SA first, then OA for the shortfall.
function simulateSAOAtoRetire(oa55, sa55, ma55, raTarget, retireAge, annualSalary, topupFromOA, annualMortgage) {
  const raFromSA = Math.min(sa55, raTarget);
  const raFromOA = topupFromOA ? Math.min(oa55, Math.max(0, raTarget - raFromSA)) : 0;
  // SA remainder (after RA transfer) merges into OA; SA account closes
  let oa = oa55 - raFromOA + (sa55 - raFromSA);
  let ma = ma55;

  for (let age = 56; age <= retireAge; age++) {
    if (age < retireAge) {
      const alloc = cpfAlloc(age);
      let oaAdd = annualSalary * alloc.oa;
      let maAdd = annualSalary * alloc.ma;
      const newMA = (ma + maAdd) * (1 + CPF_INT_MA);
      if (newMA > CPF_BHS) { oaAdd += (newMA - CPF_BHS); ma = CPF_BHS; } else { ma = newMA; }
      oa = (oa + oaAdd) * (1 + CPF_INT_OA);
    } else {
      oa = oa * (1 + CPF_INT_OA);
    }
    if (annualMortgage > 0 && age < 65) oa = Math.max(0, oa - annualMortgage);
  }
  return { oa: Math.round(oa), raFromSA: Math.round(raFromSA), raFromOA: Math.round(raFromOA) };
}


// Projects SA to age 55 for 'husband' or 'wife' using the same logic as the CPF tab SA table.
// Returns { rows, topupType, topupAmount, dobYear } or null if DOB not set.
function calcSaProjectionRows(person) {
  const s = data.cpfSettings || {};
  const dobStr = person === 'husband' ? s.dateOfBirth : s.spouseDob;
  if (!dobStr) return null;
  const dobYear = parseInt(dobStr.slice(0, 4));
  if (!dobYear) return null;

  const ersGrowthRate = parseFloat(s.ersGrowthRate) || 3.5;
  const ERS_2026 = 440800;
  const annualSalary = 102000;
  const currentYear = new Date().getFullYear();

  const personRecords = (data.cpfRecords || [])
    .filter(r => (r.forPerson || 'husband') === person)
    .slice().sort((a, b) => a.year - b.year);
  const lastRecord = personRecords[personRecords.length - 1];

  const topupType = lastRecord?.topupType || 'employment';
  const topupAmount = parseFloat(lastRecord?.topupAmount) || 0;

  let startYear = lastRecord ? parseInt(lastRecord.year) + 1 : currentYear;
  let sa = lastRecord ? (lastRecord.saBalance || 0) : 0;

  const rows = [];
  for (let year = startYear; year <= dobYear + 55; year++) {
    const age = year - dobYear;
    if (age > 55) break;
    const ersThisYear = Math.round(ERS_2026 * Math.pow(1 + ersGrowthRate / 100, year - 2026));
    let saContrib;
    if (topupType === 'self') {
      const cap = ersThisYear / 2;
      const applied = Math.max(0, Math.min(topupAmount, cap - sa));
      sa = (sa + applied) * (1 + CPF_INT_SA);
      saContrib = Math.round(applied);
    } else {
      const alloc = cpfAlloc(age);
      saContrib = Math.round(annualSalary * alloc.sa);
      sa = (sa + saContrib) * (1 + CPF_INT_SA);
    }
    rows.push({ age, saContrib, sa: Math.round(sa), ers: ersThisYear });
  }

  return { rows, topupType, topupAmount, dobYear };
}

function renderSaProjectionTables() {
  const s = data.cpfSettings || {};
  const ersGrowthRate = parseFloat(s.ersGrowthRate) || 3.5;

  function tableForPerson(person) {
    const proj = calcSaProjectionRows(person);
    if (!proj || !proj.rows.length) return '';
    const { rows, topupType, topupAmount } = proj;

    const last = rows[rows.length - 1];

    const isSelf = topupType === 'self';
    const ref55  = isSelf ? Math.round(last.ers / 2) : last.ers;
    const leftover = last.sa - ref55;
    const leftoverColor = leftover >= 0 ? 'var(--green,#27ae60)' : 'var(--red,#e74c3c)';
    const colHeader = isSelf ? 'Cap (ERS/2)' : 'ERS';
    const footLabel = isSelf ? 'SA at 55 − ERS/2 at 55' : 'SA at 55 − ERS at 55';
    const label     = person === 'husband' ? 'Husband' : 'Wife';
    const modeLabel = isSelf ? 'self top-up' : 'max contribution';
    const footnote  = isSelf
      ? `Self top-up $${topupAmount.toLocaleString()}/yr · capped when SA ≥ ERS/2 · SA interest 4% · ERS grows at ${ersGrowthRate}%/yr from $440,800 (2026 base)`
      : `Annual cap $102,000 · contribution = $102,000 × 37% × SA ratio · SA interest 4% · ERS grows at ${ersGrowthRate}%/yr from $440,800 (2026 base)<br>SA ratio within 37%: age 35–45 → 18.91% · age 46–50 → 21.62% · age 51–55 → 31.08%`;

    return `<div style="background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 16px;margin-bottom:12px;overflow-x:auto">
      <div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">SA Balance to Age 55 — ${label} (${modeLabel})</div>
      <table style="width:100%;border-collapse:collapse;font-size:.8rem">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th class="th-l">Age</th>
            <th class="th-r">${isSelf ? 'Topup' : 'Contribution'}</th>
            <th class="th-r">SA Balance</th>
            <th class="th-r">${colHeader}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:4px 6px">${r.age}</td>
            <td style="text-align:right;padding:4px 6px">${fmtDollar(r.saContrib)}</td>
            <td style="text-align:right;padding:4px 6px;font-weight:600">${fmtDollar(r.sa)}</td>
            <td style="text-align:right;padding:4px 6px;color:var(--muted)">${fmtDollar(isSelf ? Math.round(r.ers / 2) : r.ers)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border);font-weight:700">
            <td colspan="2" style="padding:6px 6px;font-size:.78rem">${footLabel}</td>
            <td style="text-align:right;padding:6px 6px;color:${leftoverColor}">${fmtDollar(leftover)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <div style="font-size:.7rem;color:var(--muted);margin-top:6px">${footnote}</div>
    </div>`;
  }

  return tableForPerson('husband') + tableForPerson('wife');
}

function renderSrsProjectionTable() {
  const SRS_CONTRIB = 15300;
  const SRS_GROWTH  = 0.04;

  function tableForPerson(person) {
    const s = data.cpfSettings || {};
    const dobStr = person === 'husband' ? s.dateOfBirth : s.spouseDob;
    if (!dobStr) return '';
    const dobYear = parseInt(dobStr.slice(0, 4));
    if (!dobYear) return '';

    const personRecords = (data.cpfRecords || [])
      .filter(r => (r.forPerson || 'husband') === person)
      .slice().sort((a, b) => a.year - b.year);
    const lastRecord = personRecords[personRecords.length - 1];
    if (!lastRecord || !lastRecord.srsBalance) return '';

    let srs = lastRecord.srsBalance;
    const startYear = parseInt(lastRecord.year) + 1;
    const endYear = dobYear + 62;

    const rows = [];
    let transitionAge = null;
    for (let year = startYear; year <= endYear; year++) {
      const age = year - dobYear;
      const contrib = age <= 55 ? SRS_CONTRIB : 0;
      if (contrib === 0 && transitionAge === null && rows.some(r => r.contrib > 0)) transitionAge = age;
      srs = Math.round((srs + contrib) * (1 + SRS_GROWTH));
      rows.push({ age, contrib, srs });
    }
    if (!rows.length) return '';

    const label = person === 'husband' ? 'Husband' : 'Wife';
    const finalBalance = rows[rows.length - 1].srs;

    return `<div style="background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 16px;margin-bottom:12px;overflow-x:auto">
      <div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">SRS Balance to Age 62 — ${label}</div>
      <table style="width:100%;border-collapse:collapse;font-size:.8rem">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th class="th-l">Age</th>
            <th class="th-r">Contribution</th>
            <th class="th-r">SRS Balance</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr style="border-bottom:1px solid var(--border)${r.age === transitionAge ? ';border-top:2px solid var(--border)' : ''}">
            <td style="padding:4px 6px">${r.age}</td>
            <td style="text-align:right;padding:4px 6px;color:${r.contrib ? 'inherit' : 'var(--muted)'}">${r.contrib ? fmtDollar(r.contrib) : '—'}</td>
            <td style="text-align:right;padding:4px 6px;font-weight:600">${fmtDollar(r.srs)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border);font-weight:700">
            <td colspan="2" style="padding:6px 6px;font-size:.78rem">SRS at age 62</td>
            <td style="text-align:right;padding:6px 6px;color:var(--green)">${fmtDollar(finalBalance)}</td>
          </tr>
        </tfoot>
      </table>
      <div style="font-size:.7rem;color:var(--muted);margin-top:6px">Annual contribution $15,300 · Growth 4%/yr · Contributions stop at 55 · Balance grows until 62</div>
    </div>`;
  }

  return tableForPerson('husband') + tableForPerson('wife');
}

function renderCpf() {
  const el = document.getElementById('cpfContent');
  if (!el) return;

  const s = data.cpfSettings || {};
  const records = (data.cpfRecords || []).slice().sort((a, b) => b.year - a.year);

  const hasDOB = !!s.dateOfBirth;
  const dobDisplay = hasDOB
    ? new Date(s.dateOfBirth + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : 'Not set';

  const settingsBar = `<div class="cpf-settings-bar">
    <div>
      <div style="font-size:.95rem;font-weight:700">Projection Settings</div>
      <div class="cpf-settings-bar-meta">DOB: ${dobDisplay}</div>
    </div>
    <button class="btn btn-secondary" style="font-size:.78rem;padding:6px 10px" onclick="openAccountSettings()">Edit</button>
  </div>`;

  const retireAgeVal = s.retirementAge   ?? 60;
  const lifeExp      = s.lifeExpectancy  ?? 85;
  const ersGrowth    = s.ersGrowthRate   ?? 3.5;
  const mortFactor   = s.mortalityFactor ?? 1.35;
  const mortgage     = s.monthlyMortgage ?? 3000;
  const sliderLblStyle = 'font-size:.8rem;font-weight:700;min-width:3.2em;text-align:right';

  const assumptionsCard = `<div style="background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 16px;margin-bottom:12px">
    <div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">CPF LIFE Assumptions</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 20px">
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:.72rem;color:var(--muted)">Retirement Age</span>
          <span id="cpfRetireAgeVal" style="${sliderLblStyle}">${retireAgeVal} yrs</span>
        </div>
        <input type="range" id="cpfRetireAgeSlider" min="55" max="65" step="1" value="${retireAgeVal}" oninput="updateCpfSlider(this,'cpfRetireAgeVal',' yrs')" onchange="saveCpfAssumptions()" style="width:100%;accent-color:var(--primary)">
        <div class="slider-labels"><span>55</span><span>65</span></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:.72rem;color:var(--muted)">Life Expectancy</span>
          <span id="cpfLifeExpVal" style="${sliderLblStyle}">${lifeExp} yrs</span>
        </div>
        <input type="range" id="cpfLifeExpSlider" min="82" max="92" step="1" value="${lifeExp}" oninput="updateCpfSlider(this,'cpfLifeExpVal',' yrs')" onchange="saveCpfAssumptions()" style="width:100%;accent-color:var(--primary)">
        <div class="slider-labels"><span>82</span><span>92</span></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:.72rem;color:var(--muted)">ERS Growth / yr</span>
          <span id="cpfErsGrowthVal" style="${sliderLblStyle}">${ersGrowth}%</span>
        </div>
        <input type="range" id="cpfErsGrowthSlider" min="1" max="5" step="0.5" value="${ersGrowth}" oninput="updateCpfSlider(this,'cpfErsGrowthVal','%')" onchange="saveCpfAssumptions()" style="width:100%;accent-color:var(--primary)">
        <div class="slider-labels"><span>1%</span><span>5%</span></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:.72rem;color:var(--muted)">Mortality Credit</span>
          <span id="cpfMortFactorVal" style="${sliderLblStyle}">${mortFactor}×</span>
        </div>
        <input type="range" id="cpfMortFactorSlider" min="1" max="1.5" step="0.05" value="${mortFactor}" oninput="updateCpfSlider(this,'cpfMortFactorVal','×')" onchange="saveCpfAssumptions()" style="width:100%;accent-color:var(--primary)">
        <div class="slider-labels"><span>1.00×</span><span>1.50×</span></div>
      </div>
      <div style="grid-column:span 2">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:.72rem;color:var(--muted)">Monthly Mortgage (OA deduction until 65)</span>
          <span id="cpfMortgageVal" style="${sliderLblStyle}">$${Number(mortgage).toLocaleString()}</span>
        </div>
        <input type="range" id="cpfMortgageSlider" min="3000" max="5000" step="100" value="${mortgage}" oninput="updateCpfSlider(this,'cpfMortgageVal','','$')" onchange="saveCpfAssumptions()" style="width:100%;accent-color:var(--primary)">
        <div class="slider-labels"><span>$3,000</span><span>$5,000</span></div>
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

  const srsHtml = renderSrsProjectionTable();
  const milestoneHtml = hasDOB
    ? `${assumptionsCard}${explanationCard}${renderSaProjectionTables()}${srsHtml}`
    : srsHtml;

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
        <div class="cpf-card-year">${esc(String(r.year))} <span style="font-size:.72rem;color:var(--muted);font-weight:400">· ${r.forPerson === 'wife' ? 'Wife' : 'Husband'}</span></div>
        <div class="cpf-card-meta">
          <span><span class="label">OA</span>${fmtDollar(r.oaBalance || 0)}</span>
          <span><span class="label">SA</span>${fmtDollar(r.saBalance || 0)}</span>
          <span><span class="label">MA</span>${fmtDollar(r.maBalance || 0)}</span>
          ${r.srsBalance ? `<span><span class="label">SRS</span>${fmtDollar(r.srsBalance)}</span>` : ''}
          <span><span class="label">Interest</span>${fmtDollar(totalInt)}</span>
        </div>
        <div class="cpf-card-total">Total: ${fmtDollar(total)}</div>
      </div>`;
    }).join('');
  }

  el.innerHTML = settingsBar + milestoneHtml +
    `<div class="section-heading">Recorded Balances</div>` + addBtn + listHtml;
}

function updateCpfSlider(el, labelId, suffix, prefix) {
  const lbl = document.getElementById(labelId);
  if (lbl) lbl.textContent = (prefix || '') + Number(el.value).toLocaleString() + suffix;
}

function saveCpfAssumptions() {
  if (!data.cpfSettings) data.cpfSettings = {};
  const retireAge = parseInt(document.getElementById('cpfRetireAgeSlider')?.value);
  const lifeExp   = parseFloat(document.getElementById('cpfLifeExpSlider')?.value);
  const ersGrowth = parseFloat(document.getElementById('cpfErsGrowthSlider')?.value);
  const mortFactor = parseFloat(document.getElementById('cpfMortFactorSlider')?.value);
  const mortgage  = parseFloat(document.getElementById('cpfMortgageSlider')?.value);
  if (!isNaN(retireAge) && retireAge >= 55 && retireAge <= 65) data.cpfSettings.retirementAge = retireAge;
  if (!isNaN(lifeExp) && lifeExp >= 82 && lifeExp <= 92) data.cpfSettings.lifeExpectancy = lifeExp;
  if (!isNaN(ersGrowth) && ersGrowth >= 1 && ersGrowth <= 5) data.cpfSettings.ersGrowthRate = ersGrowth;
  if (!isNaN(mortFactor) && mortFactor >= 1.0 && mortFactor <= 1.5) data.cpfSettings.mortalityFactor = mortFactor;
  if (!isNaN(mortgage) && mortgage >= 3000 && mortgage <= 5000) data.cpfSettings.monthlyMortgage = mortgage;
  saveData(data);
  renderCpf();
}

function toggleCpfTopupAmount() {
  const isSelf = document.getElementById('cpfTopupType').value === 'self';
  document.getElementById('cpfTopupAmountField').style.display = isSelf ? '' : 'none';
}

function openCpfEntrySheet(id) {
  document.getElementById('cpfEntryForm').reset();
  document.getElementById('cpfEntryId').value = '';
  document.getElementById('cpfEntryDeleteBtn').style.display = 'none';
  document.getElementById('cpfEntryFor').value = 'husband';
  document.getElementById('cpfEntryYear').value = new Date().getFullYear() - 1;
  document.getElementById('cpfTopupType').value = 'employment';
  document.getElementById('cpfTopupAmountField').style.display = 'none';

  if (id) {
    const r = (data.cpfRecords || []).find(x => x.id === id);
    if (!r) return;
    document.getElementById('cpfEntrySheetTitle').textContent = 'Edit CPF Record';
    document.getElementById('cpfEntryId').value = id;
    document.getElementById('cpfEntryFor').value = r.forPerson || 'husband';
    document.getElementById('cpfEntryYear').value = r.year;
    document.getElementById('cpfTopupType').value = r.topupType || 'employment';
    document.getElementById('cpfTopupAmount').value = r.topupAmount || '';
    document.getElementById('cpfTopupAmountField').style.display = r.topupType === 'self' ? '' : 'none';
    document.getElementById('cpfOA').value = r.oaBalance || '';
    document.getElementById('cpfSA').value = r.saBalance || '';
    document.getElementById('cpfMA').value = r.maBalance || '';
    document.getElementById('cpfSRS').value = r.srsBalance || '';
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
  const topupType = document.getElementById('cpfTopupType').value || 'employment';
  const entry = {
    id: id || uid(), year,
    forPerson:   document.getElementById('cpfEntryFor').value || 'husband',
    topupType,
    topupAmount: topupType === 'self' ? (parseFloat(document.getElementById('cpfTopupAmount').value) || 0) : 0,
    oaBalance:  parseFloat(document.getElementById('cpfOA').value) || 0,
    saBalance:  parseFloat(document.getElementById('cpfSA').value) || 0,
    maBalance:  parseFloat(document.getElementById('cpfMA').value) || 0,
    srsBalance: parseFloat(document.getElementById('cpfSRS').value) || 0,
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
  if (!data._deletedIds) data._deletedIds = [];
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
  if (!data._deletedIds) data._deletedIds = [];
  data._deletedIds.push(id);
  data.taxRecords = (data.taxRecords || []).filter(r => r.id !== id);
  saveData(data);
  closeSheet();
  renderAll();
  showToast('Tax record deleted');
}

// ── Retirement Planning ───────────────────────────────────────────────────────
function saveRetirementSettings(field, value) {
  data.retirementSettings[field] = parseFloat(value);
  data._retirementSettingsTs = Date.now();
  saveData(data);
  renderRetirement();
}

// Uses the final row of calcSaProjectionRows (same as CPF tab SA table) as SA@55,
// forms RA = min(SA@55, projected FRS@55), grows RA at 4% for 10 years to age 65.
// Returns CPF LIFE monthly payout in dollars.
function calcCpfLifePayoutForPerson(person) {
  const s = data.cpfSettings || {};
  const proj = calcSaProjectionRows(person);
  if (!proj || !proj.rows.length) return 0;

  const { rows, dobYear } = proj;
  const sa55 = rows[rows.length - 1].sa;

  const ersGrowthRate = parseFloat(s.ersGrowthRate) || 3.5;
  const lifeExp = parseFloat(s.lifeExpectancy) || 85;
  const mortalityFactor = parseFloat(s.mortalityFactor) || 1.35;
  const currentYear = new Date().getFullYear();

  const yearsTurn55 = Math.max(0, dobYear + 55 - currentYear);
  const frsAt55 = Math.round(CPF_FRS * Math.pow(1 + ersGrowthRate / 100, yearsTurn55));

  let ra = Math.min(sa55, frsAt55);
  for (let age = 55; age < 65; age++) ra = ra * (1 + CPF_INT_RA);

  return Math.round(ra * cpfLifeMonthlyFactor(lifeExp, mortalityFactor));
}

function calcSrsBalance62ForPerson(person) {
  const s = data.cpfSettings || {};
  const dobStr = person === 'husband' ? s.dateOfBirth : s.spouseDob;
  if (!dobStr) return 0;
  const dobYear = parseInt(dobStr.slice(0, 4));
  if (!dobYear) return 0;
  const recs = (data.cpfRecords || []).filter(r => (r.forPerson || 'husband') === person).sort((a, b) => a.year - b.year);
  const last = recs[recs.length - 1];
  if (!last || !last.srsBalance) return 0;
  let srs = last.srsBalance;
  for (let y = parseInt(last.year) + 1; y <= dobYear + 62; y++) {
    const age = y - dobYear;
    srs = Math.round((srs + (age <= 55 ? 15300 : 0)) * 1.04);
  }
  return srs;
}

function calcRetirementPlan() {
  const s = data.retirementSettings;
  const cpfSet = data.cpfSettings;

  const dob = cpfSet.dateOfBirth ? new Date(cpfSet.dateOfBirth) : null;
  const spouseDob = cpfSet.spouseDob ? new Date(cpfSet.spouseDob) : null;
  const now = new Date();
  const currentAge = dob ? Math.floor((now - dob) / (365.25 * 24 * 3600 * 1000)) : 35;
  const currentYear = now.getFullYear();
  const hubDobYear = dob ? dob.getFullYear() : null;
  const spouseDobYear = spouseDob ? spouseDob.getFullYear() : null;

  const r = s.investmentRate / 100;
  const g = s.inflationRate / 100;
  const retireAge = Math.round(s.retirementAge);
  const deathAge = Math.round(s.deathAge);

  const physAssets = data.assets.reduce((sum, a) => sum + (isInvestable(a) && a.class !== 'CPF' && a.class !== 'SRS' ? currentValue(a) : 0), 0);
  const currentAssets = physAssets;

  const annualSavings = s.annualSavings != null ? s.annualSavings : 150000;

  // Both use calcSaProjectionRows (same as CPF tab SA table): SA@55 → RA → grows to 65 → payout
  let hubCpfMonthly = 0;
  try { hubCpfMonthly = calcCpfLifePayoutForPerson('husband'); } catch (e) {}
  const hubCpfAnnual = hubCpfMonthly * 12;

  let wifeCpfMonthly = 0;
  if (cpfSet.spouseDob) {
    try { wifeCpfMonthly = calcCpfLifePayoutForPerson('wife'); } catch (e) {}
  }
  const wifeCpfAnnual = wifeCpfMonthly * 12;

  // Express CPF start ages in terms of husband's age:
  // Husband CPF always starts at husband age 65.
  // Wife CPF starts when wife is 65 → husband's age = 65 + (wifeDobYear − hubDobYear).
  // (Positive offset when wife is younger than husband.)
  const hubCpfStartAge = 65;
  const wifeCpfStartAge = (hubDobYear !== null && spouseDobYear !== null)
    ? 65 + (spouseDobYear - hubDobYear)
    : null;

  // SRS: project each person's SRS balance to age 62, then draw down equally over 10 years (age 62–71).
  const hubSrsAt62 = calcSrsBalance62ForPerson('husband');
  const hubSrsAnnual = hubSrsAt62 > 0 ? Math.round(hubSrsAt62 / 10) : 0;
  const wifeSrsAt62 = cpfSet.spouseDob ? calcSrsBalance62ForPerson('wife') : 0;
  const wifeSrsAnnual = wifeSrsAt62 > 0 ? Math.round(wifeSrsAt62 / 10) : 0;
  // Express SRS start ages in terms of husband's age (same offset logic as CPF).
  const hubSrsStartAge = 62;
  const hubSrsEndAge = 71;
  const wifeSrsStartAge = (hubDobYear !== null && spouseDobYear !== null && wifeSrsAnnual > 0)
    ? 62 + (spouseDobYear - hubDobYear) : null;
  const wifeSrsEndAge = wifeSrsStartAge !== null ? wifeSrsStartAge + 9 : null;

  const rows = [];
  let assets = currentAssets;

  for (let age = currentAge; age < retireAge; age++) {
    const yearsFromNow = age - currentAge;
    const inflFactor = Math.pow(1 + g, yearsFromNow);
    const savingsNom = annualSavings * inflFactor;
    const investReturn = assets * r;
    const assetsStart = assets;
    assets = assetsStart * (1 + r) + savingsNom;
    rows.push({
      year: currentYear + yearsFromNow, age, phase: 'accumulation',
      assetsStart, investReturn, savings: savingsNom,
      assetsEnd: assets,
      assetsEndReal: assets / Math.pow(1 + g, yearsFromNow + 1)
    });
  }

  const retirementPortfolio = assets;

  const swr = (s.safeWithdrawalRate != null ? s.safeWithdrawalRate : 4.0) / 100;
  // SWR amount is nominal at the retirement date (swr × the nominal portfolio).
  // Deflate it back to today's dollars so W_real is genuinely "today's $": the
  // drawdown loop below re-inflates it from today via (1+g)^(age-currentAge), so
  // at the first retirement year withdrawalNom === retirementPortfolio × swr.
  const yearsToRetire = Math.max(0, retireAge - currentAge);
  const W_real = retirementPortfolio > 0
    ? (retirementPortfolio * swr) / Math.pow(1 + g, yearsToRetire)
    : 0;

  for (let age = retireAge; age < deathAge; age++) {
    const yearsFromNow = age - currentAge;
    const inflFactor = Math.pow(1 + g, yearsFromNow);
    const withdrawalNom = W_real * inflFactor;
    const rowHubCpf = age >= hubCpfStartAge ? hubCpfAnnual : 0;
    const rowWifeCpf = (wifeCpfStartAge !== null && age >= wifeCpfStartAge) ? wifeCpfAnnual : 0;
    const cpfNom = rowHubCpf + rowWifeCpf;
    const rowHubSrs = (hubSrsAnnual > 0 && age >= hubSrsStartAge && age <= hubSrsEndAge) ? hubSrsAnnual : 0;
    const rowWifeSrs = (wifeSrsStartAge !== null && age >= wifeSrsStartAge && age <= wifeSrsEndAge) ? wifeSrsAnnual : 0;
    const srsNom = rowHubSrs + rowWifeSrs;
    const portfolioWithdrawal = Math.max(0, withdrawalNom - cpfNom - srsNom);
    const totalIncome = cpfNom + srsNom + portfolioWithdrawal;
    const investReturn = assets * r;
    const assetsStart = assets;
    assets = assetsStart * (1 + r) - portfolioWithdrawal;
    rows.push({
      year: currentYear + yearsFromNow, age, phase: 'drawdown',
      assetsStart, investReturn,
      cpf: cpfNom, hubCpf: rowHubCpf, wifeCpf: rowWifeCpf,
      srs: srsNom, hubSrs: rowHubSrs, wifeSrs: rowWifeSrs,
      withdrawal: withdrawalNom,
      withdrawalReal: W_real,
      portfolioWithdrawal,
      totalIncome,
      assetsEnd: assets,
      assetsEndReal: assets / Math.pow(1 + g, yearsFromNow + 1)
    });
  }

  const endPortfolio = assets;
  // cpfAnnualPayout kept for backward-compat (AI summary uses it)
  return { rows, W_real, hubCpfAnnual, wifeCpfAnnual, wifeCpfStartAge, cpfAnnualPayout: hubCpfAnnual + wifeCpfAnnual, hubSrsAt62, wifeSrsAt62, hubSrsAnnual, wifeSrsAnnual, hubSrsStartAge, wifeSrsStartAge, retirementPortfolio, endPortfolio, currentAge, currentAssets, annualSavings };
}

function renderRetirement() {
  const el = document.getElementById('retirementContent');
  if (!data.retirementSettings) data.retirementSettings = { inflationRate: 2.5, investmentRate: 5.0, retirementAge: 62, deathAge: 85, monthlyExpenses: 3000, annualSavings: 150000, safeWithdrawalRate: 4.0 };
  const s = data.retirementSettings;
  const cpfSet = data.cpfSettings;

  const dob = cpfSet.dateOfBirth ? new Date(cpfSet.dateOfBirth) : null;
  const now = new Date();
  const currentAge = dob ? Math.floor((now - dob) / (365.25 * 24 * 3600 * 1000)) : null;

  if (!dob) {
    el.innerHTML = `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">elderly</span></div>Set your date of birth in CPF settings to use retirement planning.</div>`;
    return;
  }

  const savingsVal = s.annualSavings != null ? s.annualSavings : 150000;
  el.innerHTML = `
    <div class="ret-sliders">
      <div class="slider-group">
        <div class="slider-row">
          <span class="slider-label">Annual Savings</span>
          <span class="slider-value" id="retSliderValSavings">${fmtDollar(savingsVal)}</span>
        </div>
        <input type="range" min="100000" max="200000" step="10000" value="${savingsVal}"
          oninput="document.getElementById('retSliderValSavings').textContent=fmtDollar(+this.value)"
          onchange="saveRetirementSettings('annualSavings',this.value)">
        <div class="slider-labels"><span>$100k</span><span>$200k</span></div>
      </div>
      <div class="slider-group">
        <div class="slider-row">
          <span class="slider-label">Inflation Rate</span>
          <span class="slider-value" id="retSliderValInfl">${s.inflationRate.toFixed(1)}%</span>
        </div>
        <input type="range" min="0" max="8" step="0.1" value="${s.inflationRate}"
          oninput="document.getElementById('retSliderValInfl').textContent=parseFloat(this.value).toFixed(1)+'%'"
          onchange="saveRetirementSettings('inflationRate',this.value)">
      </div>
      <div class="slider-group">
        <div class="slider-row">
          <span class="slider-label">Investment Rate</span>
          <span class="slider-value" id="retSliderValInvest">${s.investmentRate.toFixed(1)}%</span>
        </div>
        <input type="range" min="0" max="12" step="0.1" value="${s.investmentRate}"
          oninput="document.getElementById('retSliderValInvest').textContent=parseFloat(this.value).toFixed(1)+'%'"
          onchange="saveRetirementSettings('investmentRate',this.value)">
      </div>
      <div class="slider-group">
        <div class="slider-row">
          <span class="slider-label">Retirement Age</span>
          <span class="slider-value" id="retSliderValRetAge">${Math.round(s.retirementAge)}</span>
        </div>
        <input type="range" min="50" max="75" step="1" value="${s.retirementAge}"
          oninput="document.getElementById('retSliderValRetAge').textContent=Math.round(this.value)"
          onchange="saveRetirementSettings('retirementAge',this.value)">
      </div>
      <div class="slider-group">
        <div class="slider-row">
          <span class="slider-label">Death Age</span>
          <span class="slider-value" id="retSliderValDeath">${Math.round(s.deathAge)}</span>
        </div>
        <input type="range" min="70" max="100" step="1" value="${s.deathAge}"
          oninput="document.getElementById('retSliderValDeath').textContent=Math.round(this.value)"
          onchange="saveRetirementSettings('deathAge',this.value)">
      </div>
      <div class="slider-group">
        <div class="slider-row">
          <span class="slider-label">Safe Withdrawal Rate</span>
          <span class="slider-value" id="retSliderValSwr">${(s.safeWithdrawalRate != null ? s.safeWithdrawalRate : 4.0).toFixed(1)}%</span>
        </div>
        <input type="range" min="2.5" max="5.0" step="0.1" value="${s.safeWithdrawalRate != null ? s.safeWithdrawalRate : 4.0}"
          oninput="document.getElementById('retSliderValSwr').textContent=parseFloat(this.value).toFixed(1)+'%'"
          onchange="saveRetirementSettings('safeWithdrawalRate',this.value)">
        <div class="slider-labels"><span>2.5%</span><span>5.0%</span></div>
      </div>
    </div>`;

  let plan;
  try { plan = calcRetirementPlan(); }
  catch (e) {
    el.innerHTML += `<div class="empty-state" style="margin-top:16px">Unable to calculate: ${esc(e.message)}</div>`;
    return;
  }

  const { rows, W_real, hubCpfAnnual, wifeCpfAnnual, wifeCpfStartAge, hubSrsAt62, wifeSrsAt62, hubSrsAnnual, wifeSrsAnnual, hubSrsStartAge, wifeSrsStartAge, retirementPortfolio, endPortfolio, annualSavings: planSavings } = plan;
  const endColor = endPortfolio >= 0 ? 'var(--green,#27ae60)' : 'var(--red,#e74c3c)';
  const hubCpfStartAge = 65;

  el.innerHTML += `
    <div class="ret-summary-grid">
      <div class="ret-summary-item">
        <div class="ret-summary-label">Portfolio at Retirement</div>
        <div class="ret-summary-value">${fmtDollar(retirementPortfolio)}</div>
        <div class="hint">investable assets (CPF, SRS &amp; home excluded)</div>
      </div>
      <div class="ret-summary-item">
        <div class="ret-summary-label">Annual Savings (today's $)</div>
        <div class="ret-summary-value">${fmtDollar(planSavings)}</div>
        <div class="hint">grows with inflation each year</div>
      </div>
      <div class="ret-summary-item">
        <div class="ret-summary-label">SWR Annual Withdrawal (today's $)</div>
        <div class="ret-summary-value">${fmtDollar(W_real)}</div>
        <div class="hint">${(s.safeWithdrawalRate != null ? s.safeWithdrawalRate : 4.0).toFixed(1)}% of portfolio at retirement</div>
      </div>
      <div class="ret-summary-item">
        <div class="ret-summary-label">Husband CPF LIFE / yr</div>
        <div class="ret-summary-value">${fmtDollar(hubCpfAnnual)}</div>
        <div class="hint">starts husband age ${hubCpfStartAge} · SA@55 from CPF tab table → RA → age 65</div>
      </div>
      ${wifeCpfAnnual > 0 ? `<div class="ret-summary-item">
        <div class="ret-summary-label">Wife CPF LIFE / yr</div>
        <div class="ret-summary-value">${fmtDollar(wifeCpfAnnual)}</div>
        <div class="hint">starts husband age ${wifeCpfStartAge} · SA@55 from CPF tab table → RA → age 65</div>
      </div>` : ''}
      ${hubSrsAt62 > 0 ? `<div class="ret-summary-item">
        <div class="ret-summary-label">Husband SRS / yr (age ${hubSrsStartAge}–${hubSrsStartAge + 9})</div>
        <div class="ret-summary-value">${fmtDollar(hubSrsAnnual)}</div>
        <div class="hint">10-yr equal drawdown · SRS at 62: ${fmtDollar(hubSrsAt62)}</div>
      </div>` : ''}
      ${wifeSrsAt62 > 0 ? `<div class="ret-summary-item">
        <div class="ret-summary-label">Wife SRS / yr (starts husband age ${wifeSrsStartAge})</div>
        <div class="ret-summary-value">${fmtDollar(wifeSrsAnnual)}</div>
        <div class="hint">10-yr equal drawdown · SRS at 62: ${fmtDollar(wifeSrsAt62)}</div>
      </div>` : ''}
      <div class="ret-summary-item">
        <div class="ret-summary-label">Monthly Spending (today's $)</div>
        <div class="ret-summary-value">${fmtDollar(W_real / 12)}</div>
      </div>
      <div class="ret-summary-item">
        <div class="ret-summary-label">Portfolio at Death Age</div>
        <div class="ret-summary-value" style="color:${endColor}">${fmtDollar(endPortfolio)}</div>
        <div class="hint">${endPortfolio >= 0 ? 'surplus — estate / buffer' : 'shortfall — raise savings or lower SWR'}</div>
      </div>
    </div>`;

  if (!rows.length) {
    el.innerHTML += `<div class="empty-state" style="margin-top:16px">Adjust retirement age and death age to see projection.</div>`;
    return;
  }

  el.innerHTML += `
    <div class="amort-scroll" style="margin-top:16px">
      <table class="amort-table ret-table">
        <thead>
          <tr>
            <th style="text-align:left">Year</th>
            <th>Age</th>
            <th style="text-align:left">Phase</th>
            <th>Portfolio Start</th>
            <th>Returns</th>
            <th>Savings / CPF</th>
            <th>SRS</th>
            <th>Portfolio Drawdown</th>
            <th>Total Income</th>
            <th>Portfolio End</th>
            <th>End Today's $</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => {
            const isDrawdown = row.phase === 'drawdown';
            const streams = [];
            if (isDrawdown && row.cpf > 0) streams.push(row.hubCpf > 0 && row.wifeCpf > 0 ? 'CPF×2' : 'CPF');
            if (isDrawdown && row.srs > 0) streams.push('SRS');
            const phaseLabel = isDrawdown
              ? (streams.length > 0
                  ? `<span style="color:var(--green,#27ae60)">Drawdown+${streams.join('+')}</span>`
                  : '<span style="color:var(--red,#e74c3c)">Drawdown</span>')
              : '<span style="color:var(--primary)">Accumulation</span>';
            const endNeg = row.assetsEnd < 0 ? 'color:var(--red,#e74c3c)' : '';
            const savingsOrCpf = isDrawdown ? fmtDollar(row.cpf || 0) : `<span style="color:var(--green,#27ae60)">${fmtDollar(row.savings)}</span>`;
            const srsCell = isDrawdown ? (row.srs > 0 ? `<span style="color:var(--green,#27ae60)">${fmtDollar(row.srs)}</span>` : '—') : '—';
            const portDrawdown = isDrawdown ? `<span style="color:var(--red,#e74c3c)">${fmtDollar(row.portfolioWithdrawal)}</span>` : '—';
            const totalIncome = isDrawdown ? `<strong>${fmtDollar(row.totalIncome)}</strong>` : '—';
            return `<tr>
              <td style="text-align:left">${row.year}</td>
              <td>${row.age}</td>
              <td style="text-align:left;white-space:nowrap">${phaseLabel}</td>
              <td>${fmtDollar(row.assetsStart)}</td>
              <td style="color:var(--green,#27ae60)">${fmtDollar(row.investReturn)}</td>
              <td>${savingsOrCpf}</td>
              <td>${srsCell}</td>
              <td>${portDrawdown}</td>
              <td>${totalIncome}</td>
              <td style="${endNeg}">${fmtDollar(row.assetsEnd)}</td>
              <td style="${endNeg}">${fmtDollar(row.assetsEndReal)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

