// ── Google Drive token (declared first so it is always initialised before any
// synchronous DOM setup below can throw and leave it in TDZ) ──────────────────
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
let driveToken = null;

// ── Import / Export ───────────────────────────────────────────────────────────
function confirmClearData() {
  document.getElementById('mainMenu').classList.remove('open');
  if (!confirm('Delete ALL data? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(HISTORY_KEY);
  data = defaultData();
  historyData = { expenses: [], powerRecords: [] };
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
        if (!ev.startTime) ev.startTime = { hour: 0, minute: 0, ampm: 'AM' };
        if (!ev.endTime) ev.endTime = { hour: 0, minute: 0, ampm: 'AM' };
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
      historyData = { expenses: d.expenses, powerRecords: historyData.powerRecords || [], _updatedAt: d._updatedAt || Date.now() };
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
  const pwrMap = new Map();
  [...(remoteH.powerRecords || []), ...(localH.powerRecords || [])].forEach(r => {
    const existing = pwrMap.get(r.id);
    if (!existing || (r._ts || 0) > (existing._ts || 0)) pwrMap.set(r.id, r);
  });
  return { expenses: [...expMap.values()], powerRecords: [...pwrMap.values()] };
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
    if (localAsset && localAsset.class != null) existing.class = localAsset.class;
    else if (remoteAsset && remoteAsset.class != null) existing.class = remoteAsset.class;
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
    ? (local.cpfSettings || remote.cpfSettings || { dateOfBirth: '' })
    : (remote.cpfSettings || local.cpfSettings || { dateOfBirth: '' });
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

  // Dependents: union by id, prefer higher _ts, exclude deleted
  const depMap = new Map();
  [...(remote.dependents || []), ...(local.dependents || [])].forEach(d => {
    if (deletedIds.has(d.id)) return;
    const ex = depMap.get(d.id);
    if (!ex || (d._ts || 0) > (ex._ts || 0)) depMap.set(d.id, d);
  });
  const dependents = [...depMap.values()];
  const dependentsTs = Math.max(local._dependentsTs || 0, remote._dependentsTs || 0);

  // Allocation ratios: last-writer-wins via _allocationRatiosTs
  const allocationRatios = (local._allocationRatiosTs || 0) >= (remote._allocationRatiosTs || 0)
    ? (local.allocationRatios || remote.allocationRatios || {})
    : (remote.allocationRatios || local.allocationRatios || {});
  const allocationRatiosTs = Math.max(local._allocationRatiosTs || 0, remote._allocationRatiosTs || 0);

  // Medical visits: union by id, prefer higher _ts, exclude deleted
  const medicalMap = new Map();
  [...(remote.medicalVisits || []), ...(local.medicalVisits || [])].forEach(v => {
    if (deletedIds.has(v.id)) return;
    const ex = medicalMap.get(v.id);
    if (!ex || (v._ts || 0) > (ex._ts || 0)) medicalMap.set(v.id, v);
  });

  // Notes: union by id, prefer higher _updatedAt, exclude deleted
  const notesMap = new Map();
  [...(remote.notes || []), ...(local.notes || [])].forEach(n => {
    if (deletedIds.has(n.id)) return;
    const ex = notesMap.get(n.id);
    if (!ex || (n._updatedAt || 0) >= (ex._updatedAt || 0)) notesMap.set(n.id, n);
  });

  // Custom AI prompt: last-writer-wins via _customAiPromptTs
  const customAiPrompt = (local._customAiPromptTs || 0) >= (remote._customAiPromptTs || 0)
    ? (local.customAiPrompt ?? remote.customAiPrompt ?? null)
    : (remote.customAiPrompt ?? local.customAiPrompt ?? null);
  const customAiPromptTs = Math.max(local._customAiPromptTs || 0, remote._customAiPromptTs || 0);

  // retirementSettings: last-writer-wins via _retirementSettingsTs; fill in field defaults
  const RS_DEFAULTS = { inflationRate: 2.5, investmentRate: 5.0, retirementAge: 62, deathAge: 85, monthlyExpenses: 3000, annualSavings: 150000, safeWithdrawalRate: 4.0 };
  const retirementSettingsWinner = (local._retirementSettingsTs || 0) >= (remote._retirementSettingsTs || 0)
    ? (local.retirementSettings || remote.retirementSettings)
    : (remote.retirementSettings || local.retirementSettings);
  const retirementSettings = { ...RS_DEFAULTS, ...(retirementSettingsWinner || {}) };
  const retirementSettingsTs = Math.max(local._retirementSettingsTs || 0, remote._retirementSettingsTs || 0);

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
    dependents,
    _dependentsTs: dependentsTs,
    allocationRatios,
    _allocationRatiosTs: allocationRatiosTs,
    medicalVisits: [...medicalMap.values()],
    notes: [...notesMap.values()],
    customAiPrompt,
    _customAiPromptTs: customAiPromptTs,
    retirementSettings,
    _retirementSettingsTs: retirementSettingsTs,
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
    const historyFileId = localStorage.getItem(DRIVE_HISTORY_FILE_KEY);
    // Fire both downloads in parallel; history prefetch fails gracefully if not needed
    const remoteP = downloadFromDrive(token, fileId);
    const remoteHistP = historyFileId
      ? downloadFromDrive(token, historyFileId).catch(() => null)
      : Promise.resolve(null);
    const remote = await remoteP;
    if (!remote.accounts || !Array.isArray(remote.expenses) || !Array.isArray(remote.assets)) {
      throw new Error('Invalid backup format');
    }

    // Split off any past-year entries that landed in remote.expenses (old format)
    const curYear = String(new Date().getFullYear());
    const remoteHistFromMain = (remote.expenses || []).filter(e => e.date && !e.date.startsWith(curYear + '-'));
    remote.expenses = (remote.expenses || []).filter(e => e.date && e.date.startsWith(curYear + '-'));

    // Decide whether to use the already-in-flight history download
    const remoteHistTs = remote.historyUpdatedAt || 0;
    const localHistTs = historyData._updatedAt || 0;

    let mergedHistory = historyData;
    let uploadHistory = false;

    if (historyFileId && (localHistTs !== remoteHistTs || remoteHistFromMain.length)) {
      // Timestamps differ (or old-format entries exist): merge before uploading
      // so we never overwrite records that are only on the remote side.
      let remoteHistory = { expenses: remoteHistFromMain };
      const dl = await remoteHistP;
      if (dl && Array.isArray(dl.expenses)) remoteHistory = mergeHistoryData(dl, { expenses: remoteHistFromMain });
      mergedHistory = mergeHistoryData(historyData, remoteHistory);
      uploadHistory = true;
    } else if (!historyFileId && remoteHistTs > localHistTs) {
      // Remote is newer but no history file linked — can't merge, keep local as-is.
      // Do NOT adopt remoteHistTs below: claiming a timestamp we never pulled makes
      // the next sync see equal timestamps and silently skip the remote forever.
    } else if (!historyFileId && (localHistTs > remoteHistTs || remoteHistFromMain.length)) {
      // No history file yet: create one from local (+ any old-format entries)
      if (remoteHistFromMain.length) mergedHistory = mergeHistoryData(historyData, { expenses: remoteHistFromMain });
      uploadHistory = true;
    }

    setDriveStatus('Merging…');
    const merged = mergeData(data, remote);

    // Apply deletedIds to history
    const deletedSet = new Set(merged._deletedIds);
    mergedHistory.expenses = mergedHistory.expenses.filter(e => !deletedSet.has(e.id));
    mergedHistory.powerRecords = (mergedHistory.powerRecords || []).filter(r => !deletedSet.has(r.id));

    // Cross-store dedup: if the same expense ID exists in both merged stores after a
    // cross-year-boundary edit, keep the copy with the higher _ts and drop the other.
    {
      const histExpById = new Map(mergedHistory.expenses.map(e => [e.id, e]));
      merged.expenses = merged.expenses.filter(e => {
        const h = histExpById.get(e.id);
        if (!h) return true;
        if ((e._ts || 0) >= (h._ts || 0)) { histExpById.delete(e.id); return true; }
        return false;
      });
      mergedHistory.expenses = [...histExpById.values()];
    }

    setDriveStatus('Uploading…');
    merged.busApiKey = getBusApiKey() || merged.busApiKey || '';
    merged.busProxyUrl = localStorage.getItem(BUS_PROXY_URL_STORAGE) || merged.busProxyUrl || '';
    merged.busProxyToken = localStorage.getItem(BUS_PROXY_TOKEN_STORAGE) || merged.busProxyToken || '';
    if (uploadHistory) {
      mergedHistory._updatedAt = Date.now();
      merged.historyUpdatedAt = mergedHistory._updatedAt;
      await uploadHistoryToDrive(token, historyFileId || null, mergedHistory);
    } else {
      // Nothing uploaded: keep our own local history timestamp. Adopting a remote
      // timestamp we never pulled would permanently mask the remote history.
      merged.historyUpdatedAt = localHistTs;
    }
    await uploadToDrive(token, fileId, merged);

    const now = new Date().toISOString();
    localStorage.setItem('finance:lastSync', now);
    data = merged;
    if (merged.busApiKey) saveBusApiKey(merged.busApiKey);
    if (merged.busProxyUrl) localStorage.setItem(BUS_PROXY_URL_STORAGE, merged.busProxyUrl);
    if (merged.busProxyToken) localStorage.setItem(BUS_PROXY_TOKEN_STORAGE, merged.busProxyToken);
    historyData = mergedHistory;
    recalcBalances(data, data.expenses);
    recalcMonthlyAgg(data, allExpenses());
    // historyData._updatedAt and data.historyUpdatedAt are already equal here (both
    // paths set merged.historyUpdatedAt to historyData._updatedAt), so persist the
    // history blob directly without bumping its timestamp via saveHistory().
    historyData._updatedAt = merged.historyUpdatedAt;
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

async function forceSyncHistory() {
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  const fileId = localStorage.getItem(DRIVE_FILE_KEY);
  const historyFileId = localStorage.getItem(DRIVE_HISTORY_FILE_KEY);
  if (!clientId || !fileId) { showToast('Not connected to Drive'); return; }
  if (!historyFileId) { showToast('No history file linked — run a full sync first'); return; }
  const btn = document.getElementById('forceHistorySyncBtn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  setDriveStatus('Authenticating…');
  try {
    const token = await getAccessToken(clientId);
    setDriveStatus('Downloading history…');
    const remoteHistory = await downloadFromDrive(token, historyFileId);
    if (!Array.isArray(remoteHistory.expenses)) throw new Error('Invalid history file format');
    setDriveStatus('Merging history…');
    const mergedHistory = mergeHistoryData(historyData, remoteHistory);
    // Apply any deleted IDs from local data
    const deletedSet = new Set(data._deletedIds || []);
    mergedHistory.expenses = mergedHistory.expenses.filter(e => !deletedSet.has(e.id));
    mergedHistory.powerRecords = (mergedHistory.powerRecords || []).filter(r => !deletedSet.has(r.id));

    // Cross-store dedup: drop history copies that are superseded by a newer main copy
    {
      const mainExpById = new Map(data.expenses.map(e => [e.id, e]));
      mergedHistory.expenses = mergedHistory.expenses.filter(e => {
        const m = mainExpById.get(e.id);
        return !m || (e._ts || 0) > (m._ts || 0);
      });
    }
    setDriveStatus('Uploading history…');
    mergedHistory._updatedAt = Date.now();
    await uploadHistoryToDrive(token, historyFileId, mergedHistory);
    // Update historyUpdatedAt in main data and push it
    data.historyUpdatedAt = mergedHistory._updatedAt;
    await uploadToDrive(token, fileId, data);
    historyData = mergedHistory;
    recalcMonthlyAgg(data, allExpenses());
    saveData(data);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyData));
    renderAll();
    setDriveStatus('History sync complete ✓');
    showToast(`History synced — ${historyData.expenses.length} records`);
  } catch (err) {
    setDriveStatus('Error: ' + err.message);
    showToast('History sync failed');
  } finally {
    btn.disabled = false;
    btn.textContent = '⟳ Force History Sync';
  }
}

async function uploadFileToDrive(token, fileId, payload, filename, storageKey) {
  const content = JSON.stringify(payload);
  const metadata = { name: filename, mimeType: 'application/json' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([content], { type: 'application/json' }));
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&supportsAllDrives=true`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true';
  const method = fileId ? 'PATCH' : 'POST';
  let resp = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token }, body: form });
  if (resp.status === 401) {
    driveToken = null;
    const freshToken = await getAccessToken(localStorage.getItem(DRIVE_CLIENT_KEY));
    resp = await fetch(url, { method, headers: { Authorization: 'Bearer ' + freshToken }, body: form });
  }
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
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  let resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (resp.status === 401) {
    driveToken = null;
    const freshToken = await getAccessToken(localStorage.getItem(DRIVE_CLIENT_KEY));
    resp = await fetch(url, { headers: { Authorization: 'Bearer ' + freshToken } });
  }
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

