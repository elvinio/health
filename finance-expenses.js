// ── Render: Expenses ─────────────────────────────────────────────────────────
function renderExpenseList() {
  const el = document.getElementById('expenseList');
  if (!allExpenses().length) {
    el.innerHTML = `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">payments</span></div>No expenses yet.<br>Tap + to add one.</div>`;
    return;
  }
  const curYear = String(new Date().getFullYear());
  const source = filterYear === curYear ? data.expenses : historyData.expenses.filter(e => e.date.startsWith(filterYear + '-'));
  let sorted = [...source].sort((a, b) => b.date.localeCompare(a.date) || b._ts - a._ts);
  if (filterAccount) sorted = sorted.filter(e => e.ac === filterAccount);
  if (filterSearch) sorted = sorted.filter(e => e.desc.toLowerCase().includes(filterSearch));
  if (!sorted.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">search</span></div>No matching expenses.</div>`;
    return;
  }

  // Group by month, then by date within month
  const byMonth = {};
  sorted.forEach(e => {
    const m = e.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = {};
    (byMonth[m][e.date] = byMonth[m][e.date] || []).push(e);
  });

  const hidden = balanceHidden;
  const emojiMap = parseCatEmojis();
  const statStyle = 'font-size:.7rem;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase';
  const valStyle = 'font-weight:700;color:#fff';
  el.innerHTML = Object.entries(byMonth).map(([month, dateGroups]) => {
    const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const monthExps = Object.values(dateGroups).flat();
    const totalSpend = monthExps.filter(e => e.cat !== 'TopUp').reduce((s, e) => s + e.amount, 0);
    const spendDiv = `<div><span style="${statStyle}">Spent</span><br><span style="${valStyle}">${hidden ? '••••' : fmtDollar(totalSpend)}</span></div>`;

    let headerRight;
    if (month.startsWith(curYear)) {
      const balanceAccounts = filterAccount ? data.accounts.filter(a => a.id === filterAccount) : data.accounts;
      const balanceDivs = balanceAccounts.map(acc => {
        const bal = data.expenses
          .filter(e => e.ac === acc.id && e.date && e.date.slice(0, 7) <= month)
          .reduce((s, e) => s + (e.cat === 'TopUp' ? e.amount : -e.amount), acc.startingBalance);
        return `<div><span style="${statStyle}">${esc(acc.name)}</span><br><span style="${valStyle}">${hidden ? '••••' : fmtDollar(bal)}</span></div>`;
      }).join('');
      headerRight = balanceDivs + spendDiv;
    } else {
      headerRight = spendDiv;
    }

    const dateRows = Object.entries(dateGroups).sort(([a], [b]) => b.localeCompare(a)).map(([date, exps]) => `
      <div class="date-group">
        <div class="date-label">${formatDate(date)}</div>
        ${exps.map(e => {
          const emoji = emojiMap[e.cat] || '';
          return `
            <div class="expense-item" onclick="openExpenseSheet('${esc(e.id)}')">
              <span class="cat-emoji">${emoji}</span>
              <div class="expense-left">
                <span class="expense-desc">${esc(e.desc)}</span>
              </div>
              <div class="expense-amount" style="color:${e.cat === 'TopUp' ? 'var(--green)' : 'var(--red)'}">${e.cat === 'TopUp' ? '+' : '-'}${fmtCurrency(e.amount)}</div>
              <div class="acc-dot ${e.ac === 'acc1' ? 'acc1' : 'acc2'}"></div>
            </div>`;
        }).join('')}
      </div>`).join('');

    const isCollapsed = collapsedMonths.has(month);
    return `
      <div style="background:var(--primary);color:#fff;border-radius:var(--radius);padding:12px 16px;margin:16px 0 8px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:700;font-size:.95rem;cursor:pointer;display:flex;align-items:center;gap:4px" onclick="toggleMonth('${month}')">
          <span class="material-symbols-outlined" id="month-chevron-${month}" style="font-size:1.1rem;transition:transform .2s;${isCollapsed ? 'transform:rotate(-90deg)' : ''}">expand_more</span>
          ${monthLabel}
        </div>
        <div style="display:flex;gap:20px;text-align:right">${headerRight}</div>
      </div>
      <div id="month-rows-${month}" style="${isCollapsed ? 'display:none' : ''}">${dateRows}</div>`;
  }).join('');
}

function formatDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Expense Sheet ─────────────────────────────────────────────────────────────
function openExpenseSheet(id, preAcct) {
  const form = document.getElementById('expenseForm');
  form.reset();
  document.getElementById('expenseId').value = '';
  document.getElementById('expDate').value = today();
  document.getElementById('expDeleteBtn').style.display = 'none';

  // Populate account select
  const sel = document.getElementById('expAcct');
  sel.innerHTML = data.accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');

  // Populate category select from existing data, TopUp first then alphabetical
  const cats = [...new Set([...expenseCatDefaults(), 'Other', ...allExpenses().map(e => e.cat)])].sort();
  if (!cats.includes('TopUp')) cats.unshift('TopUp'); else { cats.splice(cats.indexOf('TopUp'), 1); cats.unshift('TopUp'); }
  document.getElementById('expCat').innerHTML = cats.map(c => `<option>${esc(c)}</option>`).join('');

  if (id) {
    const exp = data.expenses.find(e => e.id === id) || historyData.expenses.find(e => e.id === id);
    if (!exp) return;
    document.getElementById('expenseSheetTitle').textContent = 'Edit Expense';
    document.getElementById('expenseId').value = exp.id;
    sel.value = exp.ac;
    document.getElementById('expDate').value = exp.date;
    document.getElementById('expAmount').value = exp.amount;
    document.getElementById('expDesc').value = exp.desc;
    const catSel = document.getElementById('expCat');
    catSel.value = exp.cat;
    if (catSel.value !== exp.cat) {
      const opt = document.createElement('option');
      opt.value = exp.cat;
      opt.textContent = exp.cat;
      catSel.appendChild(opt);
      catSel.value = exp.cat;
    }
    document.getElementById('expDeleteBtn').style.display = '';
  } else {
    document.getElementById('expenseSheetTitle').textContent = 'Add Expense';
    const lastAcct = preAcct || localStorage.getItem('finance:lastAcct');
    if (lastAcct && data.accounts.some(a => a.id === lastAcct)) sel.value = lastAcct;
    document.getElementById('expCat').value = 'Grocery';
  }
  openSheet('expenseSheet');
  setTimeout(() => document.getElementById('expAmount').focus(), 350);
}

document.getElementById('expenseForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('expenseId').value;
  const amount = parseFloat(document.getElementById('expAmount').value);
  if (!Number.isFinite(amount)) { showToast('Enter a valid amount'); return; }
  const entry = {
    id: id || uid(),
    ac: document.getElementById('expAcct').value,
    date: document.getElementById('expDate').value,
    desc: document.getElementById('expDesc').value.trim(),
    amount,
    cat: document.getElementById('expCat').value,
    _ts: Date.now()
  };
  if (!id) localStorage.setItem('finance:lastAcct', entry.ac);
  const curYear = String(new Date().getFullYear());
  const toHistory = !entry.date.startsWith(curYear + '-');

  if (id) {
    const inCurrent = data.expenses.some(e => e.id === id);
    if (inCurrent && !toHistory) {
      const idx = data.expenses.findIndex(e => e.id === id);
      if (idx >= 0) data.expenses[idx] = entry;
    } else if (!inCurrent && toHistory) {
      const idx = historyData.expenses.findIndex(e => e.id === id);
      if (idx >= 0) historyData.expenses[idx] = entry;
      saveHistory(historyData);
    } else if (inCurrent && toHistory) {
      data.expenses = data.expenses.filter(e => e.id !== id);
      historyData.expenses.push(entry);
      saveHistory(historyData);
    } else {
      historyData.expenses = historyData.expenses.filter(e => e.id !== id);
      data.expenses.push(entry);
      saveHistory(historyData);
    }
  } else {
    if (toHistory) {
      historyData.expenses.push(entry);
      saveHistory(historyData);
    } else {
      data.expenses.push(entry);
    }
  }
  recalcBalances(data, data.expenses);
  recalcMonthlyAgg(data, allExpenses());
  saveData(data);
  closeSheet();
  renderAll();
  showToast(id ? 'Expense updated' : 'Expense added');
});

function deleteExpense() {
  const id = document.getElementById('expenseId').value;
  if (!id) return;
  if (!confirm('Delete this expense?')) return;
  data._deletedIds.push(id);
  const inCurrent = data.expenses.some(e => e.id === id);
  if (inCurrent) {
    data.expenses = data.expenses.filter(e => e.id !== id);
  } else {
    historyData.expenses = historyData.expenses.filter(e => e.id !== id);
    saveHistory(historyData);
  }
  recalcBalances(data, data.expenses);
  recalcMonthlyAgg(data, allExpenses());
  saveData(data);
  closeSheet();
  renderAll();
  showToast('Expense deleted');
}

// ── Expense filters ───────────────────────────────────────────────────────────
let filterAccount = null;
let filterSearch = '';
let filterYear = String(new Date().getFullYear());
let currentExpSubTab = 'expenses';
let filterEventTag = null;
let eventViewMode = 'list';
let currentEventListSubTab = 'upcoming';
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let analysisYears = new Set([String(new Date().getFullYear())]);
let showHistoryPills = false;

function getExpenseYears() {
  const years = new Set([
    ...data.expenses.map(e => e.date.slice(0, 4)),
    ...historyData.expenses.map(e => e.date.slice(0, 4))
  ]);
  years.add(String(new Date().getFullYear()));
  return [...years].sort((a, b) => Number(b) - Number(a));
}

function renderYearFilterPills() {
  const container = document.getElementById('yearFilterPills');
  if (!container) return;
  const years = getExpenseYears();
  const curYear = String(new Date().getFullYear());
  const prevYears = years.filter(y => y !== curYear);
  const visibleYears = showHistoryPills ? years : [curYear];
  const allCollapsed = visibleYears.every(y => {
    const source = y === curYear ? data.expenses : historyData.expenses.filter(e => e.date.startsWith(y + '-'));
    return source.map(e => e.date.slice(0, 7)).filter((m, i, a) => a.indexOf(m) === i).every(m => collapsedMonths.has(m));
  });
  const collapseLabel = allCollapsed ? 'Expand All' : 'Collapse All';
  const historyActive = showHistoryPills && filterYear !== curYear;
  const historyPill = prevYears.length > 0
    ? `<button class="filter-pill${historyActive ? ' active' : ''}" onclick="toggleHistoryPills()">History ${showHistoryPills ? '▲' : '▼'}</button>`
    : '';
  const prevPills = showHistoryPills
    ? prevYears.map(y => `<button class="filter-pill${filterYear === y ? ' active' : ''}" onclick="setYearFilter('${y}')">${y}</button>`).join('')
    : '';
  container.innerHTML =
    `<button class="filter-pill${filterYear === curYear ? ' active' : ''}" onclick="setYearFilter('${curYear}')">${curYear}</button>` +
    historyPill + prevPills +
    `<button class="filter-pill" onclick="toggleCollapseAll()">${collapseLabel}</button>`;
}

function toggleHistoryPills() {
  showHistoryPills = !showHistoryPills;
  if (!showHistoryPills && filterYear !== String(new Date().getFullYear())) {
    filterYear = String(new Date().getFullYear());
    renderExpenseList();
  }
  renderYearFilterPills();
}


function toggleCollapseAll() {
  const source = filterYear === String(new Date().getFullYear()) ? data.expenses : historyData.expenses.filter(e => e.date.startsWith(filterYear + '-'));
  const months = [...new Set(source.map(e => e.date.slice(0, 7)))];
  const allCollapsed = months.every(m => collapsedMonths.has(m));
  if (allCollapsed) months.forEach(m => collapsedMonths.delete(m));
  else months.forEach(m => collapsedMonths.add(m));
  renderExpenseList();
  renderYearFilterPills();
}

function setYearFilter(y) {
  filterYear = y;
  if (y !== String(new Date().getFullYear())) showHistoryPills = true;
  renderYearFilterPills();
  renderExpenseList();
}

function toggleAnalysisYear(y) {
  if (analysisYears.has(y)) {
    if (analysisYears.size > 1) analysisYears.delete(y);
  } else {
    analysisYears.add(y);
  }
  renderAnalysis();
}

function renderAccountFilterPills() {
  const container = document.getElementById('accountFilterPills');
  if (!container) return;
  const cutoff = new Date().toISOString().slice(0, 10);
  const ytd = data.expenses.filter(e => e.cat !== 'TopUp' && e.date <= cutoff).reduce((s, e) => s + e.amount, 0);
  const ytdPill = `<span class="filter-pill" style="cursor:default">YTD: ${balanceHidden ? '••••' : fmtDollar(ytd)}</span>`;
  const pills = [{ id: null, name: 'All' }, ...data.accounts.map(a => ({ id: a.id, name: a.name }))];
  container.innerHTML = pills.map(p =>
    `<button class="filter-pill${filterAccount === p.id ? ' active' : ''}" onclick="setAccountFilter(${p.id === null ? 'null' : `'${p.id}'`})">${esc(p.name)}</button>`
  ).join('') + ytdPill;
}

function setAccountFilter(id) {
  filterAccount = id;
  renderAccountFilterPills();
  renderExpenseList();
}

let _searchDebounce;
function onSearchInput() {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    filterSearch = document.getElementById('expenseSearch').value.toLowerCase();
    renderExpenseList();
  }, 150);
}

function switchExpSubTab(tab) {
  currentExpSubTab = tab;
  ['expenses', 'recurring', 'mortgage', 'emailrules'].forEach(t => {
    document.getElementById(`expSubTab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`expSubContent-${t}`).style.display = t === tab ? '' : 'none';
  });
  if (tab === 'recurring') renderOngoingListInline();
  if (tab === 'mortgage') renderMortgageListInline();
  if (tab === 'emailrules') renderEmailRulesSubTab();
}

let currentTaxSubTab = 'incometax';
function switchTaxSubTab(tab) {
  currentTaxSubTab = tab;
  ['incometax', 'cpf', 'assets', 'retirement'].forEach(t => {
    document.getElementById(`taxSubTab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`taxSubContent-${t}`).style.display = t === tab ? '' : 'none';
  });
  if (tab === 'cpf') renderCpf();
  if (tab === 'assets') renderAssetsSubTab();
  if (tab === 'retirement') renderRetirement();
}

// ── Balance visibility ────────────────────────────────────────────────────────
let balanceHidden = localStorage.getItem('finance:balanceHidden') === 'true';
let collapsedMonths = new Set();

function toggleMonth(month) {
  if (collapsedMonths.has(month)) collapsedMonths.delete(month);
  else collapsedMonths.add(month);
  const rows = document.getElementById('month-rows-' + month);
  const chevron = document.getElementById('month-chevron-' + month);
  if (rows) rows.style.display = collapsedMonths.has(month) ? 'none' : '';
  if (chevron) chevron.style.transform = collapsedMonths.has(month) ? 'rotate(-90deg)' : '';
}

function recalcAll() {
  recalcBalances(data, data.expenses);
  recalcMonthlyAgg(data, allExpenses());
  saveData(data);
  document.getElementById('mainMenu').classList.remove('open');
  renderExpenseList();

}

function toggleBalanceVisibility() {
  balanceHidden = !balanceHidden;
  localStorage.setItem('finance:balanceHidden', balanceHidden);
  document.getElementById('balanceToggleBtn').innerHTML = balanceHidden
    ? '<span class="material-symbols-outlined">visibility</span> Show Balances'
    : '<span class="material-symbols-outlined">visibility_off</span> Hide Balances';
  document.getElementById('mainMenu').classList.remove('open');
  renderExpenseList();
  renderAccountFilterPills();
}

