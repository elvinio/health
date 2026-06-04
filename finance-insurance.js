// ── Insurance ─────────────────────────────────────────────────────────────────
const INSURANCE_CATEGORIES = ['Life', 'Hospitalisation', 'Critical Illness', 'Disability', 'Personal Accident', 'Travel', 'Home', 'Motor', 'Other'];

let currentInsSubTab = 'policy';
let insuranceFilterSearch = '';
let medicalFilterSearch = '';

function switchInsSubTab(tab) {
  currentInsSubTab = tab;
  document.querySelectorAll('.ins-sub-tab').forEach(b => {
    b.classList.toggle('active', b.id === 'insSubTab-' + tab);
  });
  ['policy', 'medical'].forEach(t => {
    const el = document.getElementById('insSubContent-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'medical') renderMedical();
  else renderInsurances();
}

function onInsuranceSearchInput() {
  insuranceFilterSearch = document.getElementById('insuranceSearch').value.toLowerCase();
  renderInsurances();
}

function renderInsurances() {
  const el = document.getElementById('insuranceList');
  let list = data.insurances || [];
  if (insuranceFilterSearch) {
    list = list.filter(ins =>
      (ins.name || '').toLowerCase().includes(insuranceFilterSearch) ||
      (ins.details || '').toLowerCase().includes(insuranceFilterSearch) ||
      (ins.agentContacts || '').toLowerCase().includes(insuranceFilterSearch)
    );
  }
  if (!list.length) {
    const isEmpty = !(data.insurances || []).length;
    el.innerHTML = isEmpty
      ? '<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">shield</span></div>No insurance policies yet.<br>Tap + to add one.</div>'
      : '<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">search</span></div>No policies match your search.</div>';
    return;
  }
  el.innerHTML = list.map(ins => {
    const freq = ins.paymentFrequency === 'annual' ? 'annual' : 'monthly';
    const freqLabel = freq === 'annual' ? 'Annual' : 'Monthly';
    const amt = ins.paymentAmount != null ? `$${parseFloat(ins.paymentAmount).toFixed(2)}` : '—';
    return `<div class="insurance-card" onclick="openInsuranceSheet('${esc(ins.id)}')">
      <div class="ins-header">
        <div class="ins-name">${esc(ins.name)}</div>
        <div class="ins-badge ${freq === 'annual' ? 'annual' : ''}">${freqLabel}</div>
      </div>
      <div class="ins-meta">
        ${ins.category ? `<span><span class="cat-chip">${esc(ins.category)}</span></span>` : ''}
        <span><span class="label">Insured:</span>${esc(ins.personInsured || '—')}</span>
        <span><span class="label">Start:</span>${esc(ins.startDate || '—')}</span>
        ${ins.contractId ? `<span><span class="label">Policy ID:</span>${esc(ins.contractId)}</span>` : ''}
        ${ins.agentContacts ? `<span><span class="label">Agent:</span>${esc(ins.agentContacts)}</span>` : ''}
        ${ins.details ? `<span><span class="label">Details:</span>${esc(ins.details)}</span>` : ''}
      </div>
      <div class="ins-amount">${amt} / ${freqLabel.toLowerCase()}</div>
    </div>`;
  }).join('');
}

function openInsuranceSheet(id) {
  const form = document.getElementById('insuranceForm');
  form.reset();
  document.getElementById('insuranceId').value = '';
  document.getElementById('insuranceDeleteBtn').style.display = 'none';

  const catSel = document.getElementById('insCategory');
  catSel.innerHTML = INSURANCE_CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  if (id) {
    const ins = (data.insurances || []).find(i => i.id === id);
    if (!ins) return;
    document.getElementById('insuranceSheetTitle').textContent = 'Edit Insurance';
    document.getElementById('insuranceId').value = id;
    document.getElementById('insName').value = ins.name || '';
    catSel.value = ins.category || INSURANCE_CATEGORIES[0];
    document.getElementById('insPersonInsured').value = ins.personInsured || '';
    document.getElementById('insStartDate').value = ins.startDate || '';
    document.getElementById('insContractId').value = ins.contractId || '';
    document.getElementById('insDetails').value = ins.details || '';
    document.getElementById('insPaymentAmount').value = ins.paymentAmount != null ? ins.paymentAmount : '';
    document.getElementById('insPaymentFrequency').value = ins.paymentFrequency || 'monthly';
    document.getElementById('insAgentContacts').value = ins.agentContacts || '';
    document.getElementById('insuranceDeleteBtn').style.display = '';
  } else {
    document.getElementById('insuranceSheetTitle').textContent = 'Add Insurance';
    document.getElementById('insStartDate').value = today();
  }
  openSheet('insuranceSheet');
  setTimeout(() => document.getElementById('insName').focus(), 350);
}

document.getElementById('insuranceForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('insuranceId').value;
  const entry = {
    id: id || uid(),
    name: document.getElementById('insName').value.trim(),
    category: document.getElementById('insCategory').value,
    personInsured: document.getElementById('insPersonInsured').value.trim(),
    startDate: document.getElementById('insStartDate').value,
    contractId: document.getElementById('insContractId').value.trim(),
    details: document.getElementById('insDetails').value.trim(),
    paymentAmount: parseFloat(document.getElementById('insPaymentAmount').value) || 0,
    paymentFrequency: document.getElementById('insPaymentFrequency').value,
    agentContacts: document.getElementById('insAgentContacts').value.trim(),
    _updatedAt: Date.now()
  };

  if (!data.insurances) data.insurances = [];
  if (id) {
    const idx = data.insurances.findIndex(i => i.id === id);
    if (idx >= 0) data.insurances[idx] = entry;
  } else {
    data.insurances.push(entry);
  }
  saveData(data);
  closeSheet();
  renderAll();
  showToast(id ? 'Insurance updated' : 'Insurance added');
});

function deleteInsurance() {
  const id = document.getElementById('insuranceId').value;
  if (!id) return;
  if (!confirm('Delete this insurance policy?')) return;
  data._deletedIds.push(id);
  data.insurances = (data.insurances || []).filter(i => i.id !== id);
  saveData(data);
  closeSheet();
  renderAll();
  showToast('Insurance deleted');
}

// ── Medical Visits ────────────────────────────────────────────────────────────
function onMedicalSearchInput() {
  medicalFilterSearch = document.getElementById('medicalSearch').value.toLowerCase();
  renderMedical();
}

function medAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 1) return 'this month';
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}yr ${rem}mo ago` : `${years}yr ago`;
}

function renderMedical() {
  const el = document.getElementById('medicalList');
  if (!el) return;
  let list = [...(data.medicalVisits || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (medicalFilterSearch) {
    list = list.filter(v =>
      (v.title || '').toLowerCase().includes(medicalFilterSearch) ||
      (v.description || '').toLowerCase().includes(medicalFilterSearch)
    );
  }
  if (!list.length) {
    const isEmpty = !(data.medicalVisits || []).length;
    el.innerHTML = isEmpty
      ? '<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">history</span></div>No medical visits yet.<br>Tap + to add one.</div>'
      : '<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">search</span></div>No visits match your search.</div>';
    return;
  }
  el.innerHTML = list.map(v => {
    const amt = v.amount != null && v.amount !== '' ? fmtCurrency(parseFloat(v.amount) || 0) : '—';
    const ago = medAgo(v.date);
    return `<div class="medical-card" onclick="openMedicalSheet('${esc(v.id)}')">
      <div class="med-header">
        <div class="med-title">${esc(v.title)}</div>
        <div class="med-date">${esc(v.date || '—')}${ago ? `<br><span class="med-ago">(${ago})</span>` : ''}</div>
      </div>
      <div class="med-meta">
        <span><span class="label">Person:</span>${esc(v.person || '—')}</span>
        ${v.paymentType ? `<span><span class="label">Payment:</span>${esc(v.paymentType)}</span>` : ''}
        ${v.description ? `<span><span class="label">Notes:</span>${esc(v.description)}</span>` : ''}
      </div>
      <div class="med-amount">${amt}</div>
    </div>`;
  }).join('');
}

function openMedicalSheet(id) {
  const form = document.getElementById('medicalForm');
  form.reset();
  document.getElementById('medicalId').value = '';
  document.getElementById('medicalDeleteBtn').style.display = 'none';

  if (id) {
    const v = (data.medicalVisits || []).find(x => x.id === id);
    if (!v) return;
    document.getElementById('medicalSheetTitle').textContent = 'Edit Visit';
    document.getElementById('medicalId').value = id;
    document.getElementById('medTitle').value = v.title || '';
    document.getElementById('medPerson').value = v.person || '';
    document.getElementById('medDate').value = v.date || '';
    document.getElementById('medAmount').value = v.amount != null ? v.amount : '';
    document.getElementById('medPaymentType').value = v.paymentType || '';
    document.getElementById('medDescription').value = v.description || '';
    document.getElementById('medicalDeleteBtn').style.display = '';
  } else {
    document.getElementById('medicalSheetTitle').textContent = 'Add Visit';
    document.getElementById('medDate').value = today();
  }
  openSheet('medicalSheet');
  setTimeout(() => document.getElementById('medTitle').focus(), 350);
}

document.getElementById('medicalForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('medicalId').value;
  const entry = {
    id: id || uid(),
    title: document.getElementById('medTitle').value.trim(),
    person: document.getElementById('medPerson').value.trim(),
    date: document.getElementById('medDate').value,
    amount: document.getElementById('medAmount').value !== '' ? parseFloat(document.getElementById('medAmount').value) || 0 : null,
    paymentType: document.getElementById('medPaymentType').value.trim(),
    description: document.getElementById('medDescription').value.trim(),
    _ts: Date.now()
  };
  if (!data.medicalVisits) data.medicalVisits = [];
  if (id) {
    const idx = data.medicalVisits.findIndex(x => x.id === id);
    if (idx >= 0) data.medicalVisits[idx] = entry;
  } else {
    data.medicalVisits.push(entry);
  }
  saveData(data);
  closeSheet();
  renderMedical();
  showToast(id ? 'Visit updated' : 'Visit added');
});

function deleteMedical() {
  const id = document.getElementById('medicalId').value;
  if (!id) return;
  if (!confirm('Delete this medical visit?')) return;
  data._deletedIds.push(id);
  data.medicalVisits = (data.medicalVisits || []).filter(x => x.id !== id);
  saveData(data);
  closeSheet();
  renderMedical();
  showToast('Visit deleted');
}

// ── Ongoing Expenses ──────────────────────────────────────────────────────────
function openOngoingListSheet() {
  renderOngoingList();
  openSheet('ongoingListSheet');
}

function renderOngoingListInto(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const list = data.ongoingExpenses || [];
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">repeat</span></div>No ongoing expenses yet.<br>Tap + to add one.</div>';
    return;
  }
  const freqLabel = { monthly: 'mo', quarterly: 'qtr', annual: 'yr' };
  const annualMult = { monthly: 12, quarterly: 4, annual: 1 };
  el.innerHTML = list.map(o => {
    const acc = data.accounts.find(a => a.id === o.accountId);
    const freq = freqLabel[o.frequency] || o.frequency;
    const annual = fmtDollar(o.amount * (annualMult[o.frequency] || 12));
    const nextDue = getOngoingNextDue(o);
    return `<div class="ongoing-card" onclick="openOngoingFormSheet('${o.id}')">
      <div class="ongoing-left">
        <div class="ongoing-name">${esc(o.name)}</div>
        <div class="ongoing-meta">
          <span class="cat-chip">${esc(o.category || '—')}</span>
          ${acc ? `<span class="acc-badge${acc.id === 'acc1' ? '' : ' acc2'}">${esc(acc.name)}</span>` : ''}
          <span>${annual}/yr</span>
          ${nextDue ? `<span>next: ${formatDate(nextDue)}</span>` : ''}
        </div>
      </div>
      <div class="ongoing-amount">${fmtCurrency(o.amount)}/${freq}</div>
    </div>`;
  }).join('');
}
function renderOngoingList() { renderOngoingListInto('ongoingList'); }
function renderOngoingListInline() { renderOngoingListInto('ongoingListInline'); }

function openOngoingFormSheet(id) {
  document.getElementById('ongoingForm').reset();
  document.getElementById('ongoingId').value = '';
  document.getElementById('ongoingDeleteBtn').style.display = 'none';
  document.getElementById('ongoingStartDate').value = today();
  const cats = [...new Set([...expenseCatDefaults(), ...allExpenses().map(e => e.cat)])].sort();
  document.getElementById('ongoingCategory').innerHTML = cats.map(c => `<option>${esc(c)}</option>`).join('');
  document.getElementById('ongoingAccount').innerHTML = data.accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');

  if (id) {
    const o = (data.ongoingExpenses || []).find(x => x.id === id);
    if (!o) return;
    document.getElementById('ongoingFormTitle').textContent = 'Edit Ongoing Expense';
    document.getElementById('ongoingId').value = id;
    document.getElementById('ongoingName').value = o.name;
    document.getElementById('ongoingAmount').value = o.amount;
    document.getElementById('ongoingFrequency').value = o.frequency || 'monthly';
    document.getElementById('ongoingStartDate').value = o.startDate || today();
    document.getElementById('ongoingCategory').value = o.category || '';
    document.getElementById('ongoingAccount').value = o.accountId || '';
    document.getElementById('ongoingNote').value = o.note || '';
    document.getElementById('ongoingDeleteBtn').style.display = '';
  } else {
    document.getElementById('ongoingFormTitle').textContent = 'Add Ongoing Expense';
  }
  openSheet('ongoingFormSheet');
  setTimeout(() => document.getElementById('ongoingName').focus(), 350);
}

document.getElementById('ongoingForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('ongoingId').value;
  const existing = id ? (data.ongoingExpenses || []).find(x => x.id === id) : null;
  const freq = document.getElementById('ongoingFrequency').value;
  const startDate = document.getElementById('ongoingStartDate').value;
  const entry = {
    id: id || uid(),
    name: document.getElementById('ongoingName').value.trim(),
    amount: parseFloat(document.getElementById('ongoingAmount').value) || 0,
    frequency: freq,
    startDate,
    category: document.getElementById('ongoingCategory').value,
    accountId: document.getElementById('ongoingAccount').value,
    note: document.getElementById('ongoingNote').value.trim(),
    lastAutoGenPeriod: existing ? existing.lastAutoGenPeriod : '',
    _updatedAt: Date.now()
  };
  if (!data.ongoingExpenses) data.ongoingExpenses = [];
  if (id) {
    const idx = data.ongoingExpenses.findIndex(x => x.id === id);
    if (idx >= 0) data.ongoingExpenses[idx] = entry;
  } else {
    data.ongoingExpenses.push(entry);
  }
  saveData(data);
  closeSheet();
  showToast(id ? 'Updated' : 'Added');
  if (currentExpSubTab === 'recurring') { renderOngoingListInline(); } else { setTimeout(() => openOngoingListSheet(), 350); }
});

function deleteOngoing() {
  const id = document.getElementById('ongoingId').value;
  if (!id) return;
  if (!confirm('Delete this ongoing expense?')) return;
  data.ongoingExpenses = (data.ongoingExpenses || []).filter(x => x.id !== id);
  if (!data._deletedIds) data._deletedIds = [];
  data._deletedIds.push(id);
  saveData(data);
  closeSheet();
  showToast('Deleted');
  if (currentExpSubTab === 'recurring') { renderOngoingListInline(); } else { setTimeout(() => openOngoingListSheet(), 350); }
}

function getOngoingDueInfo(o, refDate) {
  if (!o.startDate) return null;
  const today = refDate || new Date();
  const todayStr = localDateStr(today);
  const start = new Date(o.startDate + 'T00:00:00');
  const startYear = start.getFullYear();
  const startMonth = start.getMonth();
  const startDay = start.getDate();
  const y = today.getFullYear();
  const m = today.getMonth();

  let dueYear, dueMonth, periodKey;

  if (o.frequency === 'monthly') {
    if (y < startYear || (y === startYear && m < startMonth)) return null;
    dueYear = y; dueMonth = m;
    periodKey = `${y}-${String(m + 1).padStart(2, '0')}`;
  } else if (o.frequency === 'quarterly') {
    const totalMonths = (y - startYear) * 12 + (m - startMonth);
    if (totalMonths < 0) return null;
    if (totalMonths % 3 !== 0) return null;
    dueYear = y; dueMonth = m;
    periodKey = `${y}-${String(m + 1).padStart(2, '0')}`;
  } else if (o.frequency === 'annual') {
    if (m !== startMonth) return null;
    if (y < startYear) return null;
    dueYear = y; dueMonth = startMonth;
    periodKey = `${y}`;
  } else {
    return null;
  }

  const lastDayOfMonth = new Date(dueYear, dueMonth + 1, 0).getDate();
  const day = Math.min(startDay, lastDayOfMonth);
  const dueStr = `${dueYear}-${String(dueMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (todayStr < dueStr) return null;
  return { dueDate: dueStr, periodKey };
}

function getOngoingNextDue(o) {
  if (!o.startDate) return null;
  const start = new Date(o.startDate + 'T00:00:00');
  const startDay = start.getDate();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  const nextCandidate = (year, month) => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    const day = Math.min(startDay, lastDay);
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  if (o.frequency === 'monthly') {
    const thisMonth = nextCandidate(y, m);
    if (thisMonth > localDateStr(now)) return thisMonth;
    const nm = m === 11 ? 0 : m + 1;
    const ny = m === 11 ? y + 1 : y;
    return nextCandidate(ny, nm);
  }
  if (o.frequency === 'quarterly') {
    const start2 = new Date(o.startDate + 'T00:00:00');
    const startM = start2.getMonth();
    const startY = start2.getFullYear();
    let candidate = new Date(startY, startM, 1);
    while (candidate <= now) candidate = new Date(candidate.getFullYear(), candidate.getMonth() + 3, 1);
    return nextCandidate(candidate.getFullYear(), candidate.getMonth());
  }
  if (o.frequency === 'annual') {
    const startM = start.getMonth();
    const cand = nextCandidate(y, startM);
    if (cand > localDateStr(now)) return cand;
    return nextCandidate(y + 1, startM);
  }
  return null;
}

function autoGenOngoingExpenses() {
  const list = data.ongoingExpenses || [];
  if (!list.length) return;
  const today = new Date();
  const curYear = String(today.getFullYear());
  let anyAdded = false;

  list.forEach(o => {
    const info = getOngoingDueInfo(o, today);
    if (!info) return;
    if (o.lastAutoGenPeriod === info.periodKey) return;

    const exp = {
      id: uid(),
      date: info.dueDate,
      desc: o.name + (o.note ? ' · ' + o.note : ''),
      amount: o.amount,
      cat: o.category || 'Bills',
      ac: o.accountId || (data.accounts[0] ? data.accounts[0].id : 'acc1'),
      _ts: Date.now()
    };

    const expYear = info.dueDate.slice(0, 4);
    if (expYear === curYear) {
      data.expenses.push(exp);
    } else {
      historyData.expenses.push(exp);
      saveHistory(historyData);
    }

    const month = info.dueDate.slice(0, 7);
    if (!data.monthlyAgg[month]) data.monthlyAgg[month] = {};
    data.monthlyAgg[month][exp.cat] = (data.monthlyAgg[month][exp.cat] || 0) + exp.amount;

    o.lastAutoGenPeriod = info.periodKey;
    anyAdded = true;
  });

  if (anyAdded) {
    recalcBalances(data, allExpenses());
    saveData(data);
    renderAll();
  }
}

function manualGenOngoingExpenses() {
  const list = data.ongoingExpenses || [];
  if (!list.length) { showToast('No recurring expenses set up'); return; }
  const today = new Date();
  let added = 0, skipped = 0;

  list.forEach(o => {
    const info = getOngoingDueInfo(o, today);
    if (!info) { skipped++; return; }
    if (o.lastAutoGenPeriod === info.periodKey) { skipped++; return; }

    const exp = {
      id: uid(),
      date: info.dueDate,
      desc: o.name + (o.note ? ' · ' + o.note : ''),
      amount: o.amount,
      cat: o.category || 'Bills',
      ac: o.accountId || (data.accounts[0] ? data.accounts[0].id : 'acc1'),
      _ts: Date.now()
    };

    const expYear = info.dueDate.slice(0, 4);
    if (expYear === String(today.getFullYear())) {
      data.expenses.push(exp);
    } else {
      historyData.expenses.push(exp);
      saveHistory(historyData);
    }

    const month = info.dueDate.slice(0, 7);
    if (!data.monthlyAgg[month]) data.monthlyAgg[month] = {};
    data.monthlyAgg[month][exp.cat] = (data.monthlyAgg[month][exp.cat] || 0) + exp.amount;

    o.lastAutoGenPeriod = info.periodKey;
    added++;
  });

  if (added > 0) {
    recalcBalances(data, allExpenses());
    saveData(data);
    renderAll();
    showToast(`Added ${added} recurring expense${added > 1 ? 's' : ''}`);
  } else {
    showToast('Already up to date for this period');
  }
}

// ── Mortgages ─────────────────────────────────────────────────────────────────
function mortgageCurrentBalance(m) {
  const entries = (m.entries || []).filter(e => e.type === 'balance').sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b._ts || 0) - (a._ts || 0));
  return entries.length ? entries[0].amount : (m.principal || 0);
}

function mortgageMonthlyInstallment(m) {
  const P = m.principal || 0;
  const r = (m.interestRate || 0) / 100 / 12;
  const n = (m.tenorYears || 0) * 12;
  if (!r || !n || !P) return 0;
  return P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

let _currentMortgageId = null;

function openMortgageListSheet() {
  renderMortgageList();
  openSheet('mortgageListSheet');
}

function mortgageAmortTable(m) {
  const P = m.principal || 0;
  const r = (m.interestRate || 0) / 100 / 12;
  const n = (m.tenorYears || 0) * 12;
  if (!P || !r || !n) return '';
  const pmt = P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  let rows = '';
  let balance = P;
  let totalInterest = 0;
  for (let yr = 1; yr <= m.tenorYears && balance > 0.005; yr++) {
    const openBal = balance;
    let yearInterest = 0;
    let yearPrincipal = 0;
    for (let mo = 0; mo < 12 && balance > 0.005; mo++) {
      const int = balance * r;
      const prin = Math.min(pmt - int, balance);
      yearInterest += int;
      yearPrincipal += prin;
      balance = Math.max(0, balance - prin);
    }
    totalInterest += yearInterest;
    rows += `<tr>
      <td class="amort-yr">${yr}</td>
      <td>${fmtDollar(openBal)}</td>
      <td class="amort-interest">${fmtDollar(yearInterest)}</td>
      <td>${fmtDollar(yearPrincipal)}</td>
      <td>${fmtDollar(balance)}</td>
    </tr>`;
  }
  return `<div class="amort-wrap">
    <div class="amort-title">Amortization Schedule</div>
    <div class="amort-scroll">
      <table class="amort-table">
        <thead><tr><th>Yr</th><th>Opening</th><th>Interest</th><th>Principal</th><th>Closing</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="2" class="amort-total-label">Total Interest Paid</td>
          <td colspan="3" class="amort-total-val">${fmtDollar(totalInterest)}</td>
        </tr></tfoot>
      </table>
    </div>
  </div>`;
}

function renderMortgageListInto(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const list = data.mortgages || [];
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">home_work</span></div>No mortgages yet.<br>Tap + to add one.</div>';
    return;
  }
  el.innerHTML = list.map(m => {
    const bal = mortgageCurrentBalance(m);
    const monthlyPmt = mortgageMonthlyInstallment(m);
    return `<div class="mortgage-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div class="mortgage-name">${esc(m.name)}</div>
        <div style="display:flex;gap:4px">
          <button class="iconbtn" onclick="openMortgageFormSheet('${m.id}')" title="Edit"><span class="material-symbols-outlined" style="font-size:1rem">edit</span></button>
          <button class="iconbtn" onclick="openMortgageOverlay('${m.id}')" title="Entries"><span class="material-symbols-outlined" style="font-size:1rem">history</span></button>
        </div>
      </div>
      <div class="mortgage-meta">${m.interestRate}% p.a. fixed · ${m.tenorYears}yr · ${fmtCurrency(monthlyPmt)}/mo installment</div>
      <div class="mortgage-balance">Balance: ${fmtDollar(bal)}</div>
      ${mortgageAmortTable(m)}
    </div>`;
  }).join('');
}
function renderMortgageList() { renderMortgageListInto('mortgageList'); }
function renderMortgageListInline() { renderMortgageListInto('mortgageListInline'); }

function openMortgageFormSheet(id) {
  document.getElementById('mortgageForm').reset();
  document.getElementById('mortgageId').value = '';
  document.getElementById('mortgageDeleteBtn').style.display = 'none';
  document.getElementById('mortgageStartDate').value = today();

  if (id) {
    const m = (data.mortgages || []).find(x => x.id === id);
    if (!m) return;
    document.getElementById('mortgageFormTitle').textContent = 'Edit Mortgage';
    document.getElementById('mortgageId').value = id;
    document.getElementById('mortgageName').value = m.name;
    document.getElementById('mortgagePrincipal').value = m.principal;
    document.getElementById('mortgageStartDate').value = m.startDate || today();
    document.getElementById('mortgageRate').value = m.interestRate;
    document.getElementById('mortgageTenor').value = m.tenorYears;
    document.getElementById('mortgageDeleteBtn').style.display = '';
  } else {
    document.getElementById('mortgageFormTitle').textContent = 'Add Mortgage';
  }
  openSheet('mortgageFormSheet');
  setTimeout(() => document.getElementById('mortgageName').focus(), 350);
}

document.getElementById('mortgageForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('mortgageId').value;
  const entry = {
    id: id || uid(),
    name: document.getElementById('mortgageName').value.trim(),
    principal: parseFloat(document.getElementById('mortgagePrincipal').value) || 0,
    startDate: document.getElementById('mortgageStartDate').value,
    interestRate: parseFloat(document.getElementById('mortgageRate').value) || 0,
    tenorYears: parseInt(document.getElementById('mortgageTenor').value) || 0,
    entries: [],
    _updatedAt: Date.now()
  };
  if (!data.mortgages) data.mortgages = [];
  if (id) {
    const idx = data.mortgages.findIndex(x => x.id === id);
    if (idx >= 0) {
      entry.entries = data.mortgages[idx].entries || [];
      data.mortgages[idx] = entry;
    }
  } else {
    data.mortgages.push(entry);
  }
  saveData(data);
  renderAll();
  closeSheet();
  showToast(id ? 'Mortgage updated' : 'Mortgage added');
  if (currentExpSubTab === 'mortgage') { renderMortgageListInline(); } else { setTimeout(() => openMortgageListSheet(), 350); }
});

function deleteMortgage() {
  const id = document.getElementById('mortgageId').value;
  if (!id) return;
  if (!confirm('Delete this mortgage and all its entries?')) return;
  data._deletedIds.push(id);
  data.mortgages = (data.mortgages || []).filter(x => x.id !== id);
  saveData(data);
  renderAll();
  closeSheet();
  showToast('Mortgage deleted');
  if (currentExpSubTab === 'mortgage') { renderMortgageListInline(); } else { setTimeout(() => openMortgageListSheet(), 350); }
}

function openMortgageOverlay(id) {
  const m = (data.mortgages || []).find(x => x.id === id);
  if (!m) return;
  _currentMortgageId = id;
  document.getElementById('mortgageOverlayTitle').textContent = m.name;
  renderMortgageOverlayBody(m);
  document.getElementById('mortgageOverlay').classList.add('open');
}

function renderMortgageOverlayBody(m) {
  const entries = [...(m.entries || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b._ts || 0) - (a._ts || 0));
  const monthlyPmt = mortgageMonthlyInstallment(m);
  const bal = mortgageCurrentBalance(m);
  const yearlyInterest = bal * (m.interestRate / 100);

  const r = (m.interestRate || 0) / 100 / 12;
  const n = (m.tenorYears || 0) * 12;
  const startMs = m.startDate ? new Date(m.startDate + 'T00:00:00').getTime() : Date.now();
  const monthsElapsed = Math.max(0, Math.floor((Date.now() - startMs) / (30.44 * 24 * 3600 * 1000)));
  const monthsRemaining = Math.max(0, n - monthsElapsed);

  const projYears = [1, 2, 3, 5, 10].filter(yr => yr * 12 <= monthsRemaining + 6);
  const projRows = projYears.map(yr => {
    let b = bal;
    for (let i = 0; i < yr * 12 && b > 0; i++) {
      const int = b * r;
      b = Math.max(0, b + int - monthlyPmt);
    }
    const totalInterest = monthlyPmt * yr * 12 - (bal - b);
    return `<div class="projection-row">
      <span style="color:var(--muted)">In ${yr} year${yr > 1 ? 's' : ''}</span>
      <span style="font-weight:700">${fmtDollar(Math.max(0, b))}</span>
      <span style="color:var(--red);font-size:.8rem">int: ${fmtDollar(Math.max(0, totalInterest))}</span>
    </div>`;
  }).join('');

  const entryRows = entries.length ? entries.map(e => {
    const typeClass = e.type === 'interest' ? 'badge-interest' : e.type === 'payment' ? 'badge-payment' : 'badge-balance';
    const typeLabel = e.type === 'interest' ? 'Interest' : e.type === 'payment' ? 'Payment' : 'Balance';
    return `<div class="entry-row">
      <span class="entry-type-badge ${typeClass}">${typeLabel}</span>
      <span style="color:var(--muted);font-size:.8rem;white-space:nowrap">${formatDate(e.date)}</span>
      <span style="flex:1;text-align:right;font-weight:700">${fmtCurrency(e.amount)}</span>
      ${e.note ? `<span style="color:var(--muted);font-size:.8rem;margin-left:4px">${esc(e.note)}</span>` : ''}
    </div>`;
  }).join('') : '<div style="color:var(--muted);font-size:.88rem;padding:12px 0">No entries yet. Add a balance update to get started.</div>';

  document.getElementById('mortgageOverlayBody').innerHTML = `
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="color:var(--muted);font-size:.85rem">Current Balance</span>
        <span style="font-weight:800;font-size:1.1rem;color:var(--primary)">${fmtDollar(bal)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="color:var(--muted);font-size:.85rem">Monthly Installment</span>
        <span style="font-weight:700">${fmtCurrency(monthlyPmt)}</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="color:var(--muted);font-size:.85rem">Est. Yearly Interest</span>
        <span style="font-weight:700;color:#e74c3c">${fmtDollar(yearlyInterest)}</span>
      </div>
    </div>
    ${projRows ? `<div style="background:var(--bg);border-radius:10px;padding:10px 12px;margin-bottom:14px">
      <div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Projected Balance</div>
      ${projRows}
    </div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:.82rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">Entries</span>
      <button class="btn btn-primary" style="font-size:.78rem;padding:5px 12px" onclick="openMortgageEntryFromOverlay('${m.id}')">+ Add Entry</button>
    </div>
    ${entryRows}`;
}

function closeMortgageOverlay() {
  document.getElementById('mortgageOverlay').classList.remove('open');
  _currentMortgageId = null;
}

function openMortgageEntryFromOverlay(mortgageId) {
  closeMortgageOverlay();
  setTimeout(() => openMortgageEntrySheet(mortgageId), 200);
}

function openMortgageEntrySheet(mortgageId) {
  document.getElementById('mortgageEntryMortgageId').value = mortgageId;
  document.getElementById('mortgageEntryId').value = '';
  document.getElementById('mortgageEntryDate').value = today();
  document.getElementById('mortgageEntryType').value = 'balance';
  document.getElementById('mortgageEntryAmount').value = '';
  document.getElementById('mortgageEntryNote').value = '';
  document.getElementById('mortgageEntryTitle').textContent = 'Add Entry';
  openSheet('mortgageEntrySheet');
  setTimeout(() => document.getElementById('mortgageEntryAmount').focus(), 350);
}

document.getElementById('mortgageEntryForm').addEventListener('submit', e => {
  e.preventDefault();
  const mortgageId = document.getElementById('mortgageEntryMortgageId').value;
  const m = (data.mortgages || []).find(x => x.id === mortgageId);
  if (!m) return;
  const entry = {
    id: uid(),
    date: document.getElementById('mortgageEntryDate').value,
    type: document.getElementById('mortgageEntryType').value,
    amount: parseFloat(document.getElementById('mortgageEntryAmount').value) || 0,
    note: document.getElementById('mortgageEntryNote').value.trim(),
    _ts: Date.now()
  };
  if (!m.entries) m.entries = [];
  m.entries.push(entry);
  saveData(data);
  renderAll();
  closeSheet();
  showToast('Entry added');
  setTimeout(() => openMortgageOverlay(mortgageId), 350);
});

document.getElementById('mortgageOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('mortgageOverlay')) closeMortgageOverlay();
});

