// ── Account Settings ──────────────────────────────────────────────────────────
function openAccountSettings() {
  document.getElementById('mainMenu').classList.remove('open');
  const body = document.getElementById('accountSettingsBody');

  const cpfS = data.cpfSettings || {};
  const cpfSection = `
    <div style="padding-top:4px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div class="section-heading">CPF Projection</div>
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:12px">Used to project CPF balances on the Tax › CPF page.</p>
      <div class="field">
        <label>Date of Birth</label>
        <input type="date" id="cpfDOB" value="${esc(cpfS.dateOfBirth || '')}">
      </div>
    </div>`;

  const depsList = data.dependents || [];
  const depRowHtml = (i, d) => {
    const rel = d.relationship || '';
    const sex = d.sex || '';
    const relOpts = ['Child', 'Spouse', 'Parent', 'Other'].map(o => `<option ${o === rel ? 'selected' : ''}>${o}</option>`).join('');
    return `<div style="display:flex;gap:6px;margin-bottom:8px">
      <input type="text" id="depName${i}" value="${esc(d.name || '')}" placeholder="Name" style="flex:2;min-width:0">
      <select id="depRel${i}" style="flex:1.4;min-width:0"><option value=""></option>${relOpts}</select>
      <input type="number" id="depYear${i}" value="${d.birthYear || ''}" placeholder="Born" style="flex:1;min-width:0" inputmode="numeric">
      <select id="depSex${i}" style="width:3.6rem;flex-shrink:0"><option value=""></option><option value="F" ${sex === 'F' ? 'selected' : ''}>F</option><option value="M" ${sex === 'M' ? 'selected' : ''}>M</option></select>
    </div>`;
  };
  let depRows = '';
  for (let i = 0; i < depsList.length + 2; i++) depRows += depRowHtml(i, depsList[i] || {});
  const dependentsSection = `
    <div style="padding-top:4px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div class="section-heading">Household / Dependents</div>
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:10px">Enriches the AI financial analysis (insurance needs, education planning, tax reliefs). Age is derived from birth year. Leave a name blank to skip a row.</p>
      <div style="display:flex;gap:6px;margin-bottom:4px;font-size:.72rem;color:var(--muted);padding:0 2px">
        <span style="flex:2">Name</span><span style="flex:1.4">Relationship</span><span style="flex:1">Birth yr</span><span style="width:3.6rem;text-align:center;flex-shrink:0">Sex</span>
      </div>
      ${depRows}
    </div>`;

  const td = data.termDates || {};
  const tagsSection = `
    <div style="padding-top:4px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div class="section-heading">School Terms</div>
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:12px">Start date of each term. Used to show current term &amp; week on the events page.</p>
      ${[1,2,3,4].map(n => `
        <div class="field">
          <label>Term ${n} Start</label>
          <input type="date" id="termDate${n}" value="${esc(td['t'+n] || '')}">
        </div>`).join('')}
    </div>
    <div style="padding-top:4px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div class="section-heading">Event Tags</div>
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:12px">Comma-separated list of tags for events (e.g. Work, Personal, Travel).</p>
      <div class="field">
        <input type="text" id="eventTagsInput" value="${esc((data.eventTags || []).join(', '))}" placeholder="Work, Personal, Travel">
      </div>
    </div>`;

  const pinSet = !!localStorage.getItem('finance:taxPin');
  const pinSection = `
    <div style="padding-top:4px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div class="section-heading">Tax Page PIN</div>
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:12px">Shows a PIN overlay when you navigate to the Tax tab — prevents casual glances only. To reset a forgotten PIN, open DevTools → Application → Local Storage and delete <code style="font-size:.78rem">finance:taxPin</code>.</p>
      <div class="field" style="margin-bottom:8px">
        <label>New PIN <span style="font-weight:400;color:var(--muted)">(digits only${pinSet ? ', leave blank to keep current' : ''})</span></label>
        <input type="password" id="settingsPinInput" inputmode="numeric" pattern="[0-9]*" placeholder="${pinSet ? 'Enter new PIN to change' : 'e.g. 1234'}" autocomplete="new-password" style="letter-spacing:.15em;font-size:1.1rem">
      </div>
      ${pinSet ? `<div style="display:flex;align-items:center;gap:12px;margin-top:4px"><span style="font-size:.82rem;color:var(--muted)">PIN is currently <strong>set</strong>.</span><button type="button" class="btn btn-secondary" onclick="clearTaxPin()" style="font-size:.78rem;padding:5px 12px">Clear PIN</button></div>` : `<div style="font-size:.82rem;color:var(--muted)">No PIN set.</div>`}
    </div>`;

  body.innerHTML = data.accounts.map((acc, i) => `
    <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div class="section-heading">Account ${i + 1}</div>
      <div class="field"><label>Name</label>
        <input type="text" id="accName${i}" value="${esc(acc.name)}" placeholder="Account name">
      </div>
      <div class="field"><label>Starting Balance</label>
        <input type="number" id="accStart${i}" value="${acc.startingBalance}" step="0.01" placeholder="0.00">
      </div>
    </div>
  `).join('') + pinSection + cpfSection + dependentsSection + tagsSection;
  openSheet('settingsSheet');
}

function saveAccountSettings() {
  data.accounts.forEach((acc, i) => {
    const name = document.getElementById('accName' + i).value.trim();
    const start = parseFloat(document.getElementById('accStart' + i).value) || 0;
    acc.name = name || acc.name;
    acc.startingBalance = start;
    acc._updatedAt = Date.now();
  });

  const termDates = {};
  [1,2,3,4].forEach(n => {
    const v = document.getElementById('termDate' + n).value;
    if (v) termDates['t' + n] = v;
  });
  data.termDates = termDates;
  data._termDatesTs = Date.now();

  const tagsRaw = (document.getElementById('eventTagsInput').value || '').trim();
  data.eventTags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  data._eventTagsTs = Date.now();

  // Dependents — read existing rows plus the two blank ones rendered
  const depCount = (data.dependents || []).length + 2;
  const newDeps = [];
  for (let i = 0; i < depCount; i++) {
    const nameEl = document.getElementById('depName' + i);
    if (!nameEl) continue;
    const name = nameEl.value.trim();
    if (!name) continue;
    const existing = (data.dependents || [])[i] || {};
    newDeps.push({
      id: existing.id || uid(),
      name,
      relationship: document.getElementById('depRel' + i).value || '',
      birthYear: parseInt(document.getElementById('depYear' + i).value) || null,
      sex: document.getElementById('depSex' + i).value || '',
      _ts: Date.now()
    });
  }
  data.dependents = newDeps;
  data._dependentsTs = Date.now();

  if (!data.cpfSettings) data.cpfSettings = {};
  data.cpfSettings.dateOfBirth = (document.getElementById('cpfDOB')?.value || '').trim();
  data._cpfSettingsTs = Date.now();

  const newPin = (document.getElementById('settingsPinInput')?.value || '').replace(/\D/g, '');
  if (newPin.length >= 1) {
    localStorage.setItem('finance:taxPin', newPin);
    taxPinUnlocked = false;
  }

  recalcBalances(data, allExpenses());
  saveData(data);
  closeSheet();
  renderAll();
  showToast('Settings saved');
}

function clearTaxPin() {
  localStorage.removeItem('finance:taxPin');
  taxPinUnlocked = false;
  closeSheet();
  showToast('PIN cleared');
}

function openExpenseBudget() {
  document.getElementById('mainMenu').classList.remove('open');
  const body = document.getElementById('expenseBudgetBody');
  const allCats = [...new Set([
    ...expenseCatDefaults(),
    'Other',
    ...allExpenses().filter(e => e.cat !== 'TopUp').map(e => e.cat),
    ...Object.keys(data.budgets || {})
  ])].sort();
  const budgets = data.budgets || {};
  const catEmojis = parseCatEmojis();
  const catKeywordsMap = {};
  (data.emailCatMap || []).forEach(rule => {
    if (!catKeywordsMap[rule.value]) catKeywordsMap[rule.value] = [];
    catKeywordsMap[rule.value].push(rule.match);
  });

  body.innerHTML = `
    <div style="padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div class="section-heading">Expense Categories</div>
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:12px">Comma-separated, emoji first. Sets the emoji shown per category. E.g. 🎬 Entertainment, 🛒 Grocery</p>
      <div class="field">
        <input type="text" id="expenseCatsInput" value="${esc(data.expenseCats || '')}" placeholder="🎬 Entertainment, 🛒 Grocery, 🚗 Transport">
      </div>
    </div>
    <div style="padding-top:4px">
      <div class="section-heading">Monthly Budget by Category</div>
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:8px">Leave blank for no budget limit. Keywords are matched against email descriptions to auto-categorise (comma-separated, regex supported).</p>
      <div class="field" style="margin-bottom:12px">
        <label style="font-size:.8rem">Default category (no keyword match)</label>
        <input type="text" id="emailCatDefault" value="${esc(data.emailCatDefault || 'Other')}" placeholder="Other" style="font-size:.82rem">
      </div>
      <div style="display:flex;gap:8px;margin-bottom:4px;font-size:.75rem;color:var(--muted);padding:0 2px">
        <span style="width:3.2rem;text-align:center;flex-shrink:0">Emoji</span>
        <span style="flex:1;min-width:0">Budget/mo</span>
        <span style="flex:2;min-width:0">Email keywords</span>
      </div>
      ${allCats.map((cat, ci) => `
        <div class="field">
          <label><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${catColor(cat, ci)};margin-right:6px;vertical-align:middle"></span>${esc(cat)}</label>
          <div style="display:flex;gap:8px">
            <input type="text" id="budgetEmoji${ci}" value="${esc(catEmojis[cat] || '')}" placeholder="😀" style="width:3.2rem;text-align:center;font-size:1.1rem;padding:8px 4px;flex-shrink:0">
            <input type="number" id="budgetCat${ci}" value="${budgets[cat] || ''}" step="0.01" min="0" placeholder="No limit" style="flex:1;min-width:0">
            <input type="text" id="budgetKeywords${ci}" value="${esc((catKeywordsMap[cat] || []).join(', '))}" placeholder="grab, gojek" style="flex:2;min-width:0;font-size:.82rem;font-family:monospace">
          </div>
        </div>`).join('')}
    </div>`;
  openSheet('expenseBudgetSheet');
}

function saveExpenseBudget() {
  const allCats = [...new Set([
    ...expenseCatDefaults(),
    'Other',
    ...allExpenses().filter(e => e.cat !== 'TopUp').map(e => e.cat),
    ...Object.keys(data.budgets || {})
  ])].sort();

  const expCatsRaw = (document.getElementById('expenseCatsInput').value || '').trim();
  const entries = expCatsRaw.split(',').map(p => {
    const s = p.trim(); if (!s) return null;
    const sp = s.indexOf(' ');
    return sp > 0 ? { emoji: s.slice(0, sp).trim(), name: s.slice(sp + 1).trim() } : { emoji: '', name: s };
  }).filter(e => e && e.name);
  const entryMap = Object.fromEntries(entries.map(e => [e.name, e]));
  allCats.forEach((cat, ci) => {
    const em = (document.getElementById(`budgetEmoji${ci}`)?.value || '').trim();
    if (!em) return;
    if (entryMap[cat]) entryMap[cat].emoji = em;
    else entryMap[cat] = { emoji: em, name: cat };
  });
  const seen = new Set();
  const rebuilt = entries.map(e => { seen.add(e.name); return entryMap[e.name] || e; });
  allCats.forEach(cat => { if (!seen.has(cat) && entryMap[cat]) rebuilt.push(entryMap[cat]); });
  data.expenseCats = rebuilt.length
    ? rebuilt.map(e => e.emoji ? `${e.emoji} ${e.name}` : e.name).join(', ')
    : expCatsRaw;
  data._expenseCatsTs = Date.now();

  if (!data.budgets) data.budgets = {};
  allCats.forEach((cat, ci) => {
    const input = document.getElementById('budgetCat' + ci);
    if (!input) return;
    const val = parseFloat(input.value);
    if (val > 0) data.budgets[cat] = val;
    else delete data.budgets[cat];
  });

  const newCatMap = [];
  allCats.forEach((cat, ci) => {
    const kwText = (document.getElementById(`budgetKeywords${ci}`)?.value || '').trim();
    if (!kwText) return;
    kwText.split(',').map(k => k.trim()).filter(Boolean).forEach(kw => {
      newCatMap.push({ match: kw, value: cat });
    });
  });
  data.emailCatMap = newCatMap;
  data.emailCatDefault = (document.getElementById('emailCatDefault')?.value || 'Other').trim() || 'Other';
  data._emailCatMapTs = Date.now();

  saveData(data);
  closeSheet();
  renderAll();
  showToast('Expense budget saved');
}

// ── Render: Investments ───────────────────────────────────────────────────────
function renderInvestments() {
  const total = data.assets.reduce((s, a) => s + currentValue(a), 0);
  document.getElementById('portfolioTotal').textContent = fmtDollar(total);

  const prevTotal = data.assets.reduce((s, a) => s + prevValue(a), 0);
  const diff = total - prevTotal;
  const pct = prevTotal ? (diff / prevTotal * 100) : 0;
  const changeEl = document.getElementById('portfolioChange');
  if (data.assets.length && prevTotal !== total) {
    changeEl.textContent = `${diff >= 0 ? '+' : ''}${fmtDollar(diff)} (${diff >= 0 ? '+' : ''}${pct.toFixed(2)}%) from last update`;
  } else {
    changeEl.textContent = '';
  }

  const el = document.getElementById('assetList');
  if (!data.assets.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">trending_up</span></div>No assets yet.<br>Tap + to add one.</div>`;
    return;
  }
  el.innerHTML = data.assets.map(a => {
    const cur = currentValue(a);
    const prev = prevValue(a);
    const diff = cur - prev;
    const pct = prev ? (diff / prev * 100) : 0;
    const deltaClass = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const deltaText = prev > 0
      ? `${diff >= 0 ? '+' : ''}${fmtDollar(diff)} (${diff >= 0 ? '+' : ''}${pct.toFixed(2)}%)`
      : 'No prior value';
    const lastDate = a.history.length ? a.history[a.history.length - 1].date : '';
    const unitsLabel = (a.units != null && a.units !== 1) ? `<span style="color:var(--muted);font-size:.75rem;font-weight:500"> ×${a.units}</span>` : '';
    return `
      <div class="asset-card" onclick="openAssetSheet('${a.id}')">
        <div class="asset-row-main">
          <div class="asset-name">${esc(a.name)}${unitsLabel}</div>
          <div style="display:flex;align-items:center;gap:4px">
            <div class="asset-value">${fmtDollar(cur)}</div>
            <button class="iconbtn" style="font-size:.9rem;color:var(--muted)" onclick="event.stopPropagation();openHistory('${a.id}')"><span class="material-symbols-outlined">history</span></button>
          </div>
        </div>
        <div class="asset-meta">
          <span class="asset-delta ${deltaClass}">${deltaText}</span>${lastDate ? ` <span style="color:var(--muted)">· ${formatDate(lastDate)}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

function currentValue(a) {
  const units = a.units != null ? a.units : 1;
  return a.history.length ? a.history[a.history.length - 1].value * units : 0;
}

// ── CPF balance helper (used here and in finance-ai.js) ──────────────────────
function latestCpfBalances() {
  const recs = (data.cpfRecords || []).slice().sort((a, b) => a.year - b.year);
  const r = recs[recs.length - 1];
  if (!r) return { year: null, oa: 0, sa: 0, ma: 0, total: 0 };
  const oa = r.oaBalance || 0, sa = r.saBalance || 0, ma = r.maBalance || 0;
  return { year: r.year, oa, sa, ma, total: oa + sa + ma };
}

// ── Asset allocation ──────────────────────────────────────────────────────────
const ASSET_CLASS_COLORS = {
  'Cash': '#16a085', 'Equities': '#2980b9', 'Bonds': '#8e44ad',
  'Gold': '#f1c40f', 'Property (rental)': '#d35400', 'Home (own use)': '#7f8c8d',
  'Crypto': '#f39c12', 'Commodities': '#c0392b', 'CPF': '#27ae60', 'Other': '#95a5a6'
};
function assetClassColor(c) { return ASSET_CLASS_COLORS[c] || '#95a5a6'; }

const ALLOCATION_CATS = ['Equities', 'Bonds', 'Gold', 'Crypto', 'Cash', 'CPF'];

function computeAllocationAmounts() {
  const byClass = {};
  (data.assets || []).forEach(a => {
    if (!isInvestable(a)) return;
    const c = assetClass(a);
    byClass[c] = (byClass[c] || 0) + currentValue(a);
  });
  return byClass;
}

function renderAssetAllocation() {
  const byClass = computeAllocationAmounts();
  const total = Object.values(byClass).reduce((s, v) => s + v, 0);
  if (total <= 0) return '';

  const ratios = data.allocationRatios || {};
  const hasTarget = ALLOCATION_CATS.some(c => (ratios[c] || 0) > 0);

  const sortedForBar = Object.entries(byClass).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const bar = sortedForBar.map(([c, v]) =>
    `<div style="width:${(v / total * 100).toFixed(2)}%;background:${assetClassColor(c)}" title="${esc(c)}: ${(v / total * 100).toFixed(1)}%"></div>`
  ).join('');

  const otherClasses = Object.keys(byClass).filter(c => !ALLOCATION_CATS.includes(c) && byClass[c] > 0);
  const displayCats = [...ALLOCATION_CATS, ...otherClasses];

  const td = 'padding:5px 6px;border-top:1px solid var(--border)';
  const tableRows = displayCats.map(c => {
    const amt = byClass[c] || 0;
    const workingPct = ALLOCATION_CATS.includes(c) ? (ratios[c] || 0) : 0;
    if (amt <= 0 && workingPct <= 0) return '';
    const curPct = total > 0 ? (amt / total * 100) : 0;
    const targetAmt = workingPct > 0 ? (workingPct / 100) * total : 0;
    const diff = targetAmt - amt;
    const diffEl = workingPct > 0
      ? `<div style="font-size:.7rem;color:${diff >= 0 ? 'var(--green)' : 'var(--red)'}">${diff >= 0 ? '+' : ''}${fmtDollar(diff)}</div>`
      : '';
    return `<tr>
      <td style="${td};white-space:nowrap">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${assetClassColor(c)};margin-right:4px;vertical-align:middle"></span>${esc(c)}
      </td>
      <td style="${td};text-align:right">${fmtDollar(amt)}</td>
      <td style="${td};text-align:right">${curPct.toFixed(1)}%</td>
      <td style="${td};text-align:right">${workingPct > 0 ? workingPct.toFixed(1) + '%' : '<span style="color:var(--muted)">—</span>'}</td>
      <td style="${td};text-align:right">${workingPct > 0 ? fmtDollar(targetAmt) + diffEl : '<span style="color:var(--muted)">—</span>'}</td>
    </tr>`;
  }).filter(Boolean).join('');

  const totalTargetPct = ALLOCATION_CATS.reduce((s, c) => s + (ratios[c] || 0), 0);
  const thStyle = 'text-align:right;padding:0 6px 6px;font-size:.72rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap';

  return `<div class="chart-wrap">
    <div class="chart-title">Asset Allocation</div>
    <div class="alloc-bar">${bar}</div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:.82rem">
        <thead><tr>
          <th style="text-align:left;padding:0 6px 6px 0;${thStyle.slice(thStyle.indexOf(';')+1)}">Type</th>
          <th style="${thStyle}">Amount</th>
          <th style="${thStyle}">Current</th>
          <th style="${thStyle}">Target %</th>
          <th style="${thStyle}">Target $</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot><tr style="font-weight:700">
          <td style="padding:6px 6px 0 0;border-top:2px solid var(--border)">Total</td>
          <td style="text-align:right;padding:6px;border-top:2px solid var(--border)">${fmtDollar(total)}</td>
          <td style="text-align:right;padding:6px;border-top:2px solid var(--border)">100%</td>
          <td style="text-align:right;padding:6px;border-top:2px solid var(--border)">${hasTarget ? totalTargetPct.toFixed(1) + '%' : '—'}</td>
          <td style="border-top:2px solid var(--border)"></td>
        </tr></tfoot>
      </table>
    </div>
    ${!hasTarget ? '<div style="font-size:.78rem;color:var(--muted);margin-top:6px">Tap ··· → Allocation Ratios to set targets.</div>' : ''}
  </div>`;
}

// ── Allocation Ratio Sheet ────────────────────────────────────────────────────
function openAllocationRatioSheet() {
  document.getElementById('mainMenu').classList.remove('open');
  const ratios = data.allocationRatios || {};
  document.getElementById('allocationRatioFields').innerHTML = ALLOCATION_CATS.map(cat => `
    <div class="field">
      <label>${esc(cat)}</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="allocRatio_${cat}" value="${ratios[cat] || ''}" min="0" max="100" step="0.1" placeholder="0" inputmode="decimal" oninput="updateAllocTotal()" style="flex:1">
        <span style="color:var(--muted);font-weight:600;min-width:1.2rem">%</span>
      </div>
    </div>`).join('');
  updateAllocTotal();
  openSheet('allocationRatioSheet');
}

function updateAllocTotal() {
  const total = ALLOCATION_CATS.reduce((s, cat) => {
    return s + (parseFloat(document.getElementById('allocRatio_' + cat)?.value) || 0);
  }, 0);
  const el = document.getElementById('allocationRatioTotal');
  if (!el) return;
  el.textContent = total.toFixed(1) + '%';
  el.style.color = Math.abs(total - 100) < 0.05 ? 'var(--green)' : 'var(--red)';
}

function saveAllocationRatios() {
  let total = 0;
  const ratios = {};
  ALLOCATION_CATS.forEach(cat => {
    const v = parseFloat(document.getElementById('allocRatio_' + cat)?.value) || 0;
    ratios[cat] = v;
    total += v;
  });
  if (Math.abs(total - 100) > 0.1) {
    showToast(`Total must be 100% (currently ${total.toFixed(1)}%)`);
    return;
  }
  data.allocationRatios = ratios;
  data._allocationRatiosTs = Date.now();
  saveData(data);
  closeSheet();
  renderAll();
  showToast('Allocation targets saved');
}

// ── Render: Assets sub-tab (Tax page) ────────────────────────────────────────
function renderAssetsSubTab() {
  const el = document.getElementById('taxAssetsContent');
  const total = data.assets.reduce((s, a) => s + (isInvestable(a) ? currentValue(a) : 0), 0);
  const prevTotal = data.assets.reduce((s, a) => s + (isInvestable(a) ? prevValue(a) : 0), 0);
  const diff = total - prevTotal;
  const pct = prevTotal ? (diff / prevTotal * 100) : 0;
  const homeTotal = data.assets.reduce((s, a) => s + (!isInvestable(a) ? currentValue(a) : 0), 0);

  if (!data.assets.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">account_balance</span></div>No assets yet.<br>Tap + to add one.</div>`;
    return;
  }

  el.innerHTML = `
    ${data.assets.length && prevTotal !== total ? `<div style="font-size:.8rem;color:var(--muted);margin-bottom:8px;padding:0 4px">${diff >= 0 ? '+' : ''}${fmtDollar(diff)} (${diff >= 0 ? '+' : ''}${pct.toFixed(2)}%) from last update</div>` : ''}
    ${renderAssetAllocation()}
    ${data.assets.map(a => {
      const cur = currentValue(a);
      const prev = prevValue(a);
      const d2 = cur - prev;
      const p2 = prev ? (d2 / prev * 100) : 0;
      const deltaClass = d2 > 0 ? 'up' : d2 < 0 ? 'down' : 'flat';
      const deltaText = prev > 0 ? `${d2 >= 0 ? '+' : ''}${fmtDollar(d2)} (${d2 >= 0 ? '+' : ''}${p2.toFixed(2)}%)` : 'No prior value';
      const lastDate = a.history.length ? a.history[a.history.length - 1].date : '';
      const unitsLabel = (a.units != null && a.units !== 1) ? `<span style="color:var(--muted);font-size:.75rem;font-weight:500"> ×${a.units}</span>` : '';
      const classChip = `<span class="asset-class-chip" style="background:${assetClassColor(assetClass(a))}1f;color:${assetClassColor(assetClass(a))}">${esc(assetClass(a))}</span>`;
      return `
        <div class="asset-card" onclick="openAssetSheet('${a.id}')">
          <div class="asset-row-main">
            <div class="asset-name">${esc(a.name)}${unitsLabel}</div>
            <div style="display:flex;align-items:center;gap:4px">
              <div class="asset-value">${fmtDollar(cur)}</div>
              <button class="iconbtn" style="font-size:.9rem;color:var(--muted)" onclick="event.stopPropagation();openHistory('${a.id}')"><span class="material-symbols-outlined">history</span></button>
            </div>
          </div>
          <div class="asset-meta">
            ${classChip} <span class="asset-delta ${deltaClass}">${deltaText}</span>${lastDate ? ` <span style="color:var(--muted)">· ${formatDate(lastDate)}</span>` : ''}
          </div>
        </div>`;
    }).join('')}`;
}

function prevValue(a) {
  const units = a.units != null ? a.units : 1;
  return a.history.length > 1 ? a.history[a.history.length - 2].value * units : currentValue(a);
}

// ── Asset Sheet ───────────────────────────────────────────────────────────────
function openAssetSheet(id) {
  const form = document.getElementById('assetForm');
  form.reset();
  document.getElementById('assetId').value = '';
  document.getElementById('assetDate').value = today();
  document.getElementById('assetUnits').value = '';
  document.getElementById('assetDeleteBtn').style.display = 'none';

  const classSel = document.getElementById('assetClass');
  classSel.innerHTML = ASSET_CLASSES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  classSel.value = 'Other';

  if (id) {
    const asset = data.assets.find(a => a.id === id);
    if (!asset) return;
    document.getElementById('assetSheetTitle').textContent = 'Update Asset';
    document.getElementById('assetId').value = id;
    document.getElementById('assetName').value = asset.name;
    classSel.value = assetClass(asset);
    document.getElementById('assetUnits').value = asset.units != null ? asset.units : 1;
    const lastEntry = asset.history[asset.history.length - 1];
    document.getElementById('assetValue').value = lastEntry ? lastEntry.value : '';
    document.getElementById('assetDeleteBtn').style.display = '';
  } else {
    document.getElementById('assetSheetTitle').textContent = 'Add Asset';
  }
  openSheet('assetSheet');
  setTimeout(() => document.getElementById('assetValue').focus(), 350);
}

document.getElementById('assetForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('assetId').value;
  const name = document.getElementById('assetName').value.trim();
  const cls = document.getElementById('assetClass').value || 'Other';
  const value = parseFloat(document.getElementById('assetValue').value);
  if (!Number.isFinite(value)) { showToast('Enter a valid value'); return; }
  const unitsRaw = document.getElementById('assetUnits').value;
  const units = unitsRaw !== '' ? parseFloat(unitsRaw) : 1;
  if (!Number.isFinite(units)) { showToast('Enter valid units'); return; }
  const date = document.getElementById('assetDate').value;

  if (id) {
    const asset = data.assets.find(a => a.id === id);
    if (!asset) return;
    asset.name = name;
    asset.class = cls;
    asset.units = units;
    const last = asset.history[asset.history.length - 1];
    if (!last || last.value !== value || last.date !== date) {
      asset.history.push({ date, value, _ts: Date.now() });
    }
  } else {
    data.assets.push({ id: uid(), name, class: cls, units, history: [{ date, value, _ts: Date.now() }] });
  }
  saveData(data);
  closeSheet();
  renderAll();
  showToast(id ? 'Asset updated' : 'Asset added');
});

function deleteAsset() {
  const id = document.getElementById('assetId').value;
  if (!id) return;
  if (!confirm('Delete this asset and all its history?')) return;
  data._deletedIds.push(id);
  data.assets = data.assets.filter(a => a.id !== id);
  saveData(data);
  closeSheet();
  renderAll();
  showToast('Asset deleted');
}

// ── History Modal ─────────────────────────────────────────────────────────────
function openHistory(id) {
  const asset = data.assets.find(a => a.id === id);
  if (!asset) return;
  document.getElementById('historyTitle').textContent = esc(asset.name) + ' — History';
  const rows = [...asset.history].reverse();
  document.getElementById('historyBody').innerHTML = `
    <table class="hist-table">
      <thead><tr><th>Date</th><th>Value</th><th>Change</th></tr></thead>
      <tbody>${rows.map((h, i) => {
        const prev = rows[i + 1];
        const diff = prev ? h.value - prev.value : null;
        const pct = prev && prev.value ? (diff / prev.value * 100) : null;
        const changeStr = diff !== null
          ? `<span style="color:${diff >= 0 ? 'var(--green)' : 'var(--red)'}">
              ${diff >= 0 ? '+' : ''}${fmtCurrency(diff)}<br>
              <small>${diff >= 0 ? '+' : ''}${pct.toFixed(2)}%</small>
            </span>`
          : '<span style="color:var(--muted)">—</span>';
        return `<tr><td>${formatDate(h.date)}</td><td>${fmtCurrency(h.value)}</td><td>${changeStr}</td></tr>`;
      }).join('')}</tbody>
    </table>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-danger" style="font-size:.82rem;padding:8px 14px" onclick="deleteLatestHistory('${id}')">Remove Latest Entry</button>
    </div>`;
  document.getElementById('historyOverlay').classList.add('open');
}

function closeHistory() {
  document.getElementById('historyOverlay').classList.remove('open');
}

function deleteLatestHistory(id) {
  const asset = data.assets.find(a => a.id === id);
  if (!asset || asset.history.length < 2) { showToast('Cannot remove only entry'); return; }
  if (!confirm('Remove the latest value entry?')) return;
  asset.history.pop();
  saveData(data);
  closeHistory();
  renderAll();
  showToast('Entry removed');
}

document.getElementById('historyOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('historyOverlay')) closeHistory();
});

