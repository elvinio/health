// ── Account Settings ──────────────────────────────────────────────────────────
function openAccountSettings() {
  document.getElementById('mainMenu').classList.remove('open');
  const body = document.getElementById('accountSettingsBody');
  const allCats = [...new Set([
    ...expenseCatDefaults(),
    ...allExpenses().filter(e => e.cat !== 'TopUp').map(e => e.cat),
    ...Object.keys(data.budgets || {})
  ])].sort();
  const budgets = data.budgets || {};
  const catEmojis = parseCatEmojis();

  const budgetSection = allCats.length ? `
    <div style="padding-top:4px">
      <div class="section-heading">Monthly Budget by Category</div>
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:12px">Leave blank for no budget limit.</p>
      ${allCats.map((cat, ci) => `
        <div class="field">
          <label><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${catColor(cat, ci)};margin-right:6px;vertical-align:middle"></span>${esc(cat)}</label>
          <div style="display:flex;gap:8px">
            <input type="text" id="budgetEmoji${ci}" value="${esc(catEmojis[cat] || '')}" placeholder="😀" style="width:3.2rem;text-align:center;font-size:1.1rem;padding:8px 4px">
            <input type="number" id="budgetCat${ci}" value="${budgets[cat] || ''}" step="0.01" min="0" placeholder="No limit" style="flex:1">
          </div>
        </div>`).join('')}
    </div>` : '';

  const cpfS = data.cpfSettings || {};
  const cpfSection = `
    <div style="padding-top:4px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div class="section-heading">CPF Projection</div>
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:12px">Used to project CPF balances on the Tax › CPF page.</p>
      <div class="field">
        <label>Date of Birth</label>
        <input type="date" id="cpfDOB" value="${esc(cpfS.dateOfBirth || '')}">
      </div>
      <div class="field">
        <label>Retirement Age</label>
        <input type="number" id="cpfRetAge" min="55" max="75" value="${cpfS.retirementAge || 65}">
      </div>
      <div class="field">
        <label>Current Monthly Salary ($)</label>
        <input type="number" id="cpfMonthlySalary" min="0" step="100" value="${cpfS.monthlySalary || ''}" placeholder="0" inputmode="decimal">
        <div class="field-hint">Capped at $6,800/month OW ceiling for projections.</div>
      </div>
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
    </div>
    <div style="padding-top:4px">
      <div class="section-heading">Expense Categories</div>
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:12px">Comma-separated, emoji first. Sets the emoji shown per category in the expense list. E.g. 🎬 Entertainment, 🛒 Grocery</p>
      <div class="field">
        <input type="text" id="expenseCatsInput" value="${esc(data.expenseCats || '')}" placeholder="🎬 Entertainment, 🛒 Grocery, 🚗 Transport">
      </div>
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
  `).join('') + cpfSection + tagsSection + budgetSection;
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

  // allCats must match what was rendered (computed from unchanged data)
  const allCats = [...new Set([
    ...expenseCatDefaults(),
    ...allExpenses().filter(e => e.cat !== 'TopUp').map(e => e.cat),
    ...Object.keys(data.budgets || {})
  ])].sort();

  // Merge expenseCatsInput text + per-row budget emoji inputs into data.expenseCats
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

  if (!data.cpfSettings) data.cpfSettings = {};
  data.cpfSettings.dateOfBirth   = (document.getElementById('cpfDOB')?.value || '').trim();
  data.cpfSettings.retirementAge = parseInt(document.getElementById('cpfRetAge')?.value) || 65;
  data.cpfSettings.monthlySalary = parseFloat(document.getElementById('cpfMonthlySalary')?.value) || 0;
  data._cpfSettingsTs = Date.now();

  recalcBalances(data, allExpenses());
  saveData(data);
  closeSheet();
  renderAll();
  showToast('Settings saved');
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

  if (id) {
    const asset = data.assets.find(a => a.id === id);
    if (!asset) return;
    document.getElementById('assetSheetTitle').textContent = 'Update Asset';
    document.getElementById('assetId').value = id;
    document.getElementById('assetName').value = asset.name;
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
  const value = parseFloat(document.getElementById('assetValue').value);
  const unitsRaw = document.getElementById('assetUnits').value;
  const units = unitsRaw !== '' ? parseFloat(unitsRaw) : 1;
  const date = document.getElementById('assetDate').value;

  if (id) {
    const asset = data.assets.find(a => a.id === id);
    if (!asset) return;
    asset.name = name;
    asset.units = units;
    const last = asset.history[asset.history.length - 1];
    if (!last || last.value !== value || last.date !== date) {
      asset.history.push({ date, value, _ts: Date.now() });
    }
  } else {
    data.assets.push({ id: uid(), name, units, history: [{ date, value, _ts: Date.now() }] });
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

