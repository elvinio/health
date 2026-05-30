// ── Import / Export ───────────────────────────────────────────────────────────
function triggerImportExpenses() {
  document.getElementById('mainMenu').classList.remove('open');
  document.getElementById('importExpensesFile').click();
}

document.getElementById('importExpensesFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const lines = ev.target.result.trim().split('\n');
      if (lines.length < 2) { showToast('CSV is empty'); return; }
      const headers = lines[0].split(',').map(h => h.trim());
      const required = ['id', 'date', 'desc', 'amount', 'cat', 'ac'];
      if (!required.every(f => headers.includes(f))) {
        showToast('CSV missing required columns'); return;
      }
      const curYear = String(new Date().getFullYear());
      let added = 0, updated = 0;
      lines.slice(1).forEach(line => {
        if (!line.trim()) return;
        const vals = line.split(',');
        const row = {};
        headers.forEach((h, i) => row[h] = (vals[i] || '').trim());
        if (!row.id || !row.date || !row.desc || !row.amount || !row.cat || !row.ac) return;
        const expense = {
          id: row.id,
          date: row.date,
          desc: row.desc,
          amount: parseFloat(row.amount),
          cat: row.cat,
          ac: row.ac,
          _ts: row._ts ? parseInt(row._ts) : Date.now()
        };
        if (isNaN(expense.amount)) return;
        const isCurrent = expense.date.startsWith(curYear + '-');
        const store = isCurrent ? data.expenses : historyData.expenses;
        const idx = store.findIndex(x => x.id === expense.id);
        if (idx >= 0) {
          if (expense._ts > (store[idx]._ts || 0)) { store[idx] = expense; updated++; }
        } else {
          store.push(expense); added++;
        }
      });
      recalcBalances(data, allExpenses());
      recalcMonthlyAgg(data, allExpenses());
      saveData(data);
      saveHistory(historyData);
      renderAll();
      showToast(`Imported: ${added} added, ${updated} updated`);
    } catch (err) { showToast('Could not read CSV'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

function confirmClearData() {
  document.getElementById('mainMenu').classList.remove('open');
  if (!confirm('Delete ALL data? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(HISTORY_KEY);
  data = defaultData();
  historyData = { expenses: [] };
  saveData(data);
  saveHistory(historyData);
  renderAll();
  showToast('All data cleared');
}

function triggerImportEvents() {
  document.getElementById('mainMenu').classList.remove('open');
  document.getElementById('importEventsFile').click();
}

document.getElementById('importEventsFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const incoming = Array.isArray(parsed) ? parsed : parsed.events;
      if (!Array.isArray(incoming)) { showToast('Invalid events file'); return; }
      if (!data.events) data.events = [];
      let added = 0, updated = 0;
      incoming.forEach(ev => {
        if (!ev.id || !ev.title || !ev.startDate) return;
        const idx = data.events.findIndex(e => e.id === ev.id);
        if (idx >= 0) {
          if ((ev._ts || 0) > (data.events[idx]._ts || 0)) { data.events[idx] = ev; updated++; }
        } else {
          data.events.push(ev); added++;
        }
      });
      saveData(data);
      renderEventList();
      scheduleEventReminders();
      showToast(`Imported: ${added} added, ${updated} updated`);
    } catch { showToast('Could not read events file'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

function pullHistory() {
  document.getElementById('mainMenu').classList.remove('open');
  document.getElementById('historyImportFile').click();
}

document.getElementById('historyImportFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if (!Array.isArray(d.expenses)) { showToast('Invalid history file'); return; }
      historyData = { expenses: d.expenses, _updatedAt: d._updatedAt || Date.now() };
      data.historyUpdatedAt = historyData._updatedAt;
      recalcMonthlyAgg(data, allExpenses());
      saveData(data);
      saveHistory(historyData);
      renderAll();
      showToast(`Loaded ${d.expenses.length} history expenses`);
    } catch { showToast('Could not read history file'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Drive header sync button ──────────────────────────────────────────────────
function updateDriveSyncBtn() {
  const connected = !!(localStorage.getItem(DRIVE_FILE_KEY) && localStorage.getItem(DRIVE_CLIENT_KEY));
  document.getElementById('quickSyncMenuItem').style.display = connected ? '' : 'none';
}

async function driveSyncHeader() {
  document.getElementById('mainMenu').classList.remove('open');
  await driveSync();
}

// ── Google Drive ──────────────────────────────────────────────────────────────
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
let driveToken = null;

function openDriveMenu() {
  document.getElementById('mainMenu').classList.remove('open');
  document.getElementById('driveStatus').textContent = '';
  document.getElementById('driveLoginHint').value = localStorage.getItem(DRIVE_LOGIN_HINT_KEY) || '';
  const fileId = localStorage.getItem(DRIVE_FILE_KEY);
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  if (fileId && clientId) {
    document.getElementById('driveSetup').style.display = 'none';
    document.getElementById('driveConnected').style.display = '';
    document.getElementById('shareCodeDisplay').textContent = makeShareCode(clientId, fileId, localStorage.getItem(DRIVE_HISTORY_FILE_KEY) || '');
    const lastSync = localStorage.getItem('finance:lastSync');
    document.getElementById('driveLastSync').textContent = lastSync
      ? 'Last synced ' + new Date(lastSync).toLocaleString() : '';
  } else {
    document.getElementById('driveSetup').style.display = '';
    document.getElementById('driveConnected').style.display = 'none';
    document.getElementById('driveClientId').value = clientId || '';
  }
  document.getElementById('driveOverlay').classList.add('open');
}

function closeDriveModal() {
  document.getElementById('driveOverlay').classList.remove('open');
}

document.getElementById('driveOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('driveOverlay')) closeDriveModal();
});

function setDriveStatus(msg) {
  document.getElementById('driveStatus').textContent = msg;
}

// Share code = base64(clientId + "||" + fileId + "||" + historyFileId)
function makeShareCode(clientId, fileId, historyFileId) {
  return btoa(clientId + '||' + fileId + '||' + (historyFileId || ''));
}

function applyConnectCode() {
  const raw = document.getElementById('driveConnectCode').value.trim();
  if (!raw) { showToast('Paste a connect code first'); return; }
  try {
    const decoded = atob(raw);
    const parts = decoded.split('||');
    if (parts.length < 2) throw new Error('bad format');
    const [clientId, fileId, historyFileId] = parts;
    if (!clientId || !fileId) throw new Error('bad format');
    localStorage.setItem(DRIVE_CLIENT_KEY, clientId);
    localStorage.setItem(DRIVE_FILE_KEY, fileId);
    if (historyFileId) localStorage.setItem(DRIVE_HISTORY_FILE_KEY, historyFileId);
    driveToken = null;
    updateDriveSyncBtn();
    openDriveMenu();
    showToast('Connected — tap Sync Now');
  } catch { showToast('Invalid connect code'); }
}

function copyShareCode() {
  const code = document.getElementById('shareCodeDisplay').textContent;
  navigator.clipboard.writeText(code).then(() => showToast('Code copied')).catch(() => showToast('Copy failed'));
}

function driveDisconnect() {
  if (!confirm('Disconnect from Drive? Local data is kept.')) return;
  localStorage.removeItem(DRIVE_FILE_KEY);
  localStorage.removeItem(DRIVE_CLIENT_KEY);
  localStorage.removeItem('finance:lastSync');
  driveToken = null;
  updateDriveSyncBtn();
  openDriveMenu();
  showToast('Disconnected');
}

function ensureGsiLoaded() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
}

async function getAccessToken(clientId) {
  if (driveToken && driveToken.expiry > Date.now()) return driveToken.token;
  await ensureGsiLoaded();
  return new Promise((resolve, reject) => {
    const hint = localStorage.getItem(DRIVE_LOGIN_HINT_KEY) || '';
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      login_hint: hint,
      callback: resp => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        driveToken = { token: resp.access_token, expiry: Date.now() + (resp.expires_in - 30) * 1000 };
        resolve(resp.access_token);
      }
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// ── Merge logic ───────────────────────────────────────────────────────────────
function mergeHistoryData(localH, remoteH) {
  const expMap = new Map();
  [...(remoteH.expenses || []), ...(localH.expenses || [])].forEach(e => {
    const existing = expMap.get(e.id);
    if (!existing || (e._ts || 0) > (existing._ts || 0)) expMap.set(e.id, e);
  });
  return { expenses: [...expMap.values()] };
}

function mergeData(local, remote) {
  const deletedIds = new Set([...(local._deletedIds || []), ...(remote._deletedIds || [])]);

  // Expenses: union by id, prefer higher _ts for same id, exclude deleted
  const expMap = new Map();
  [...(remote.expenses || []), ...(local.expenses || [])].forEach(e => {
    if (deletedIds.has(e.id)) return;
    const existing = expMap.get(e.id);
    if (!existing || (e._ts || 0) > (existing._ts || 0)) expMap.set(e.id, e);
  });

  // Assets: union by id, merge history by _ts, exclude deleted
  const assetMap = new Map();
  [...(remote.assets || []), ...(local.assets || [])].forEach(a => {
    if (deletedIds.has(a.id)) return;
    if (!assetMap.has(a.id)) {
      assetMap.set(a.id, { ...a, history: [] });
    }
    assetMap.get(a.id).history.push(...(a.history || []));
    // keep latest name and units
    const existing = assetMap.get(a.id);
    const localAsset = local.assets && local.assets.find(x => x.id === a.id);
    const remoteAsset = remote.assets && remote.assets.find(x => x.id === a.id);
    const latestName = (localAsset && remoteAsset)
      ? (localAsset._nameTs || 0) >= (remoteAsset._nameTs || 0) ? localAsset.name : remoteAsset.name
      : (localAsset || remoteAsset || a).name;
    existing.name = latestName;
    if (localAsset && localAsset.units != null) existing.units = localAsset.units;
    else if (remoteAsset && remoteAsset.units != null) existing.units = remoteAsset.units;
  });
  // Deduplicate history by _ts within each asset, sort ascending
  assetMap.forEach(a => {
    const seen = new Set();
    a.history = a.history
      .filter(h => { const k = h._ts || h.date + h.value; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (a._ts || 0) - (b._ts || 0));
  });

  // Accounts: by id, prefer higher _updatedAt
  const accMap = new Map();
  [...(remote.accounts || []), ...(local.accounts || [])].forEach(a => {
    const existing = accMap.get(a.id);
    if (!existing || (a._updatedAt || 0) >= (existing._updatedAt || 0)) accMap.set(a.id, a);
  });

  const eventMap = new Map();
  [...(remote.events || []), ...(local.events || [])].forEach(ev => {
    if (deletedIds.has(ev.id)) return;
    const existing = eventMap.get(ev.id);
    if (!existing || (ev._ts || 0) > (existing._ts || 0)) eventMap.set(ev.id, ev);
  });

  const taxMap = new Map();
  [...(remote.taxRecords || []), ...(local.taxRecords || [])].forEach(r => {
    if (deletedIds.has(r.id)) return;
    const existing = taxMap.get(r.id);
    if (!existing || (r._ts || 0) > (existing._ts || 0)) taxMap.set(r.id, r);
  });

  // termDates: prefer whichever side was saved most recently
  const termDates = (local._termDatesTs || 0) >= (remote._termDatesTs || 0)
    ? (local.termDates || remote.termDates || {})
    : (remote.termDates || local.termDates || {});
  const termDatesTs = Math.max(local._termDatesTs || 0, remote._termDatesTs || 0);

  // eventTags: prefer whichever side was saved most recently
  const eventTags = (local._eventTagsTs || 0) >= (remote._eventTagsTs || 0)
    ? (local.eventTags || remote.eventTags || [])
    : (remote.eventTags || local.eventTags || []);
  const eventTagsTs = Math.max(local._eventTagsTs || 0, remote._eventTagsTs || 0);

  // expenseCats: prefer whichever side was saved most recently
  const expenseCats = (local._expenseCatsTs || 0) >= (remote._expenseCatsTs || 0)
    ? (local.expenseCats ?? remote.expenseCats ?? '')
    : (remote.expenseCats ?? local.expenseCats ?? '');
  const expenseCatsTs = Math.max(local._expenseCatsTs || 0, remote._expenseCatsTs || 0);

  // emailParsers: prefer whichever side was saved most recently
  const emailParsers = (local._emailParsersTs || 0) >= (remote._emailParsersTs || 0)
    ? (local.emailParsers || remote.emailParsers || null)
    : (remote.emailParsers || local.emailParsers || null);
  const emailParsersTs = Math.max(local._emailParsersTs || 0, remote._emailParsersTs || 0);

  // emailCatMap + emailCatDefault: prefer whichever side was saved most recently
  const emailCatMap = (local._emailCatMapTs || 0) >= (remote._emailCatMapTs || 0)
    ? (local.emailCatMap || remote.emailCatMap || [])
    : (remote.emailCatMap || local.emailCatMap || []);
  const emailCatDefault = (local._emailCatMapTs || 0) >= (remote._emailCatMapTs || 0)
    ? (local.emailCatDefault || remote.emailCatDefault || 'Other')
    : (remote.emailCatDefault || local.emailCatDefault || 'Other');
  const emailCatMapTs = Math.max(local._emailCatMapTs || 0, remote._emailCatMapTs || 0);

  // CPF records: union by id, prefer higher _ts, exclude deleted
  const cpfMap = new Map();
  [...(remote.cpfRecords || []), ...(local.cpfRecords || [])].forEach(r => {
    if (deletedIds.has(r.id)) return;
    const ex = cpfMap.get(r.id);
    if (!ex || (r._ts || 0) > (ex._ts || 0)) cpfMap.set(r.id, r);
  });

  // CPF settings: last-writer-wins via _cpfSettingsTs
  const cpfSettings = (local._cpfSettingsTs || 0) >= (remote._cpfSettingsTs || 0)
    ? (local.cpfSettings || remote.cpfSettings || { dateOfBirth: '', retirementAge: 65, monthlySalary: 0 })
    : (remote.cpfSettings || local.cpfSettings || { dateOfBirth: '', retirementAge: 65, monthlySalary: 0 });
  const cpfSettingsTs = Math.max(local._cpfSettingsTs || 0, remote._cpfSettingsTs || 0);

  // Insurances: union by id, prefer higher _updatedAt, exclude deleted
  const insMap = new Map();
  [...(remote.insurances || []), ...(local.insurances || [])].forEach(i => {
    if (deletedIds.has(i.id)) return;
    const existing = insMap.get(i.id);
    if (!existing || (i._updatedAt || 0) >= (existing._updatedAt || 0)) insMap.set(i.id, i);
  });

  // OngoingExpenses: union by id, prefer higher _updatedAt
  const ongoingMap = new Map();
  [...(remote.ongoingExpenses || []), ...(local.ongoingExpenses || [])].forEach(o => {
    if (deletedIds.has(o.id)) return;
    const existing = ongoingMap.get(o.id);
    if (!existing || (o._updatedAt || 0) >= (existing._updatedAt || 0)) ongoingMap.set(o.id, o);
  });

  // Mortgages: union by id, prefer higher _updatedAt, merge entries, exclude deleted
  const mortgageMap = new Map();
  [...(remote.mortgages || []), ...(local.mortgages || [])].forEach(m => {
    if (deletedIds.has(m.id)) return;
    if (!mortgageMap.has(m.id)) {
      mortgageMap.set(m.id, { ...m, entries: [] });
    }
    const existing = mortgageMap.get(m.id);
    if ((m._updatedAt || 0) >= (existing._updatedAt || 0)) {
      const entries = existing.entries;
      mortgageMap.set(m.id, { ...m, entries });
    }
    mortgageMap.get(m.id).entries.push(...(m.entries || []));
  });
  mortgageMap.forEach(m => {
    const seen = new Set();
    m.entries = m.entries
      .filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return !deletedIds.has(e.id); })
      .sort((a, b) => (a._ts || 0) - (b._ts || 0));
  });

  // Net-worth snapshots: union by quarter key, prefer higher _ts
  const nwMap = new Map();
  [...(remote.netWorthSnapshots || []), ...(local.netWorthSnapshots || [])].forEach(s => {
    const ex = nwMap.get(s.key);
    if (!ex || (s._ts || 0) > (ex._ts || 0)) nwMap.set(s.key, s);
  });
  const netWorthSnapshots = [...nwMap.values()].sort((a, b) => a.key.localeCompare(b.key));

  // AI report: last-writer-wins via _aiReportTs
  const aiReport = (local._aiReportTs || 0) >= (remote._aiReportTs || 0)
    ? (local.aiReport ?? remote.aiReport ?? null)
    : (remote.aiReport ?? local.aiReport ?? null);
  const aiReportTs = Math.max(local._aiReportTs || 0, remote._aiReportTs || 0);

  const merged = {
    accounts: [...accMap.values()],
    expenses: [...expMap.values()],
    assets: [...assetMap.values()],
    events: [...eventMap.values()],
    taxRecords: [...taxMap.values()],
    cpfRecords: [...cpfMap.values()],
    cpfSettings,
    _cpfSettingsTs: cpfSettingsTs,
    insurances: [...insMap.values()],
    ongoingExpenses: [...ongoingMap.values()],
    mortgages: [...mortgageMap.values()],
    _deletedIds: [...deletedIds],
    budgets: { ...(remote.budgets || {}), ...(local.budgets || {}) },
    termDates,
    _termDatesTs: termDatesTs,
    eventTags,
    _eventTagsTs: eventTagsTs,
    expenseCats,
    _expenseCatsTs: expenseCatsTs,
    emailParsers,
    _emailParsersTs: emailParsersTs,
    emailCatMap,
    emailCatDefault,
    _emailCatMapTs: emailCatMapTs,
    netWorthSnapshots,
    aiReport,
    _aiReportTs: aiReportTs,
  };
  recalcBalances(merged, merged.expenses);
  recalcMonthlyAgg(merged, merged.expenses);
  return merged;
}

// ── Bidirectional sync ────────────────────────────────────────────────────────
async function driveFirstSave() {
  const clientId = document.getElementById('driveClientId').value.trim();
  if (!clientId) { showToast('Enter your Google Client ID'); return; }
  localStorage.setItem(DRIVE_CLIENT_KEY, clientId);
  setDriveStatus('Authenticating…');
  try {
    const token = await getAccessToken(clientId);
    setDriveStatus('Creating files on Drive…');
    if (historyData.expenses.length && !historyData._updatedAt) {
      historyData._updatedAt = Date.now();
      data.historyUpdatedAt = historyData._updatedAt;
    }
    await uploadToDrive(token, null, data);
    await uploadHistoryToDrive(token, null, historyData);
    localStorage.setItem('finance:lastSync', new Date().toISOString());
    renderAll();
    updateDriveSyncBtn();
    openDriveMenu();
    setDriveStatus('');
    showToast('Saved — share the connect code with your partner');
  } catch (err) {
    setDriveStatus('Error: ' + err.message);
  }
}

async function driveSync() {
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  const fileId = localStorage.getItem(DRIVE_FILE_KEY);
  if (!clientId || !fileId) { showToast('Not connected to Drive'); return; }
  const btn = document.getElementById('driveSyncBtn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  setDriveStatus('Authenticating…');
  try {
    const token = await getAccessToken(clientId);

    setDriveStatus('Downloading…');
    const remote = await downloadFromDrive(token, fileId);
    if (!remote.accounts || !Array.isArray(remote.expenses) || !Array.isArray(remote.assets)) {
      throw new Error('Invalid backup format');
    }

    // Split off any past-year entries that landed in remote.expenses (old format)
    const curYear = String(new Date().getFullYear());
    const remoteHistFromMain = (remote.expenses || []).filter(e => !e.date.startsWith(curYear + '-'));
    remote.expenses = (remote.expenses || []).filter(e => e.date.startsWith(curYear + '-'));

    // Decide whether to download history based on the timestamp embedded in the main file
    const remoteHistTs = remote.historyUpdatedAt || 0;
    const localHistTs = historyData._updatedAt || 0;
    const historyFileId = localStorage.getItem(DRIVE_HISTORY_FILE_KEY);

    let mergedHistory = historyData;
    let uploadHistory = localHistTs > remoteHistTs; // local has changes remote hasn't seen

    if (remoteHistTs > localHistTs) {
      // Remote history is newer — download and merge
      if (historyFileId) {
        let remoteHistory = { expenses: remoteHistFromMain };
        try {
          const dl = await downloadFromDrive(token, historyFileId);
          if (Array.isArray(dl.expenses)) remoteHistory = mergeHistoryData(dl, { expenses: remoteHistFromMain });
        } catch {}
        mergedHistory = mergeHistoryData(historyData, remoteHistory);
        uploadHistory = true;
      }
      // No historyFileId: can't download remote history, keep local as-is
    } else if (remoteHistFromMain.length) {
      // Old-format migration: past-year entries found in remote main file
      mergedHistory = mergeHistoryData(historyData, { expenses: remoteHistFromMain });
      uploadHistory = true;
    }

    setDriveStatus('Merging…');
    const merged = mergeData(data, remote);

    // Apply deletedIds to history
    const deletedSet = new Set(merged._deletedIds);
    mergedHistory.expenses = mergedHistory.expenses.filter(e => !deletedSet.has(e.id));

    setDriveStatus('Uploading…');
    merged.busApiKey = getBusApiKey() || merged.busApiKey || '';
    if (uploadHistory) {
      mergedHistory._updatedAt = Date.now();
      merged.historyUpdatedAt = mergedHistory._updatedAt;
      await uploadHistoryToDrive(token, historyFileId || null, mergedHistory);
    } else {
      merged.historyUpdatedAt = remoteHistTs || localHistTs;
    }
    await uploadToDrive(token, fileId, merged);

    const now = new Date().toISOString();
    localStorage.setItem('finance:lastSync', now);
    data = merged;
    if (merged.busApiKey) saveBusApiKey(merged.busApiKey);
    historyData = mergedHistory;
    recalcBalances(data, allExpenses());
    recalcMonthlyAgg(data, allExpenses());
    saveData(data);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyData));
    renderAll();

    // Refresh share code in case history file ID was just created
    document.getElementById('shareCodeDisplay').textContent =
      makeShareCode(clientId, fileId, localStorage.getItem(DRIVE_HISTORY_FILE_KEY) || '');
    document.getElementById('driveLastSync').textContent = 'Last synced ' + new Date(now).toLocaleString();
    setDriveStatus('Sync complete ✓');
    showToast('Sync complete');
  } catch (err) {
    setDriveStatus('Error: ' + err.message);
    showToast('Sync failed');
  } finally {
    btn.disabled = false;
    btn.textContent = '↕ Sync Now';
  }
}

async function uploadFileToDrive(token, fileId, payload, filename, storageKey) {
  const content = JSON.stringify(payload, null, 2);
  const metadata = { name: filename, mimeType: 'application/json' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([content], { type: 'application/json' }));
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&supportsAllDrives=true`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true';
  const method = fileId ? 'PATCH' : 'POST';
  const resp = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token }, body: form });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const json = await resp.json();
  if (storageKey) localStorage.setItem(storageKey, json.id);
  return json.id;
}

async function uploadToDrive(token, fileId, payload) {
  await uploadFileToDrive(token, fileId, payload, 'finance-elvis.json', DRIVE_FILE_KEY);
  return payload;
}

async function uploadHistoryToDrive(token, fileId, payload) {
  return uploadFileToDrive(token, fileId, payload, 'finance-elvis-history.json', DRIVE_HISTORY_FILE_KEY);
}

async function downloadFromDrive(token, fileId) {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

