// ── Google Drive token (declared first so it is always initialised before any
// synchronous DOM setup below can throw and leave it in TDZ) ──────────────────
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
let driveToken = null;
let syncInFlight = false;

// ── Import / Export ───────────────────────────────────────────────────────────
function confirmClearData() {
  document.getElementById('mainMenu').classList.remove('open');
  if (!confirm('Delete ALL data? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(WIKI_KEY);
  data = defaultData();
  historyData = { expenses: [], powerRecords: [] };
  wikiData = defaultWikiData();
  saveData(data);
  saveHistory(historyData);
  saveWiki(wikiData);
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
      const deletedSet = new Set(data._deletedIds || []);
      const importedExpenses = d.expenses.filter(e => !deletedSet.has(e.id));
      historyData = { expenses: importedExpenses, powerRecords: historyData.powerRecords || [], _updatedAt: d._updatedAt || Date.now() };
      data.historyUpdatedAt = historyData._updatedAt;
      recalcMonthlyAgg(data, allExpenses());
      saveData(data);
      saveHistory(historyData);
      renderAll();
      showToast(`Loaded ${importedExpenses.length} history expenses`);
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
    const wikiInp = document.getElementById('wikiFileIdInput');
    if (wikiInp) wikiInp.value = data.wikiFileId || '';
    document.getElementById('shareCodeDisplay').textContent = makeShareCode(clientId, fileId);
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

// Share code = base64(clientId + "||" + fileId). The history and wiki file IDs are
// no longer included — they live in the main file (data.historyFileId / data.wikiFileId)
// and propagate to a partner on their first main sync.
function makeShareCode(clientId, fileId) {
  return btoa(clientId + '||' + fileId);
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
    // Backward-compat: older codes carried a 3rd part (history file ID). Adopt it into
    // the main file. New codes omit it — the partner gets it from the main file on sync.
    if (historyFileId) { data.historyFileId = historyFileId; saveData(data); }
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
// Union-by-id merge of two arrays; local wins on ties (>=).
// Pass deletedIds to filter tombstoned records.
function unionById(localArr, remoteArr, tsField, deletedIds) {
  const map = new Map();
  [...(remoteArr || []), ...(localArr || [])].forEach(item => {
    if (deletedIds && deletedIds.has(item.id)) return;
    const ex = map.get(item.id);
    if (!ex || (item[tsField] || 0) >= (ex[tsField] || 0)) map.set(item.id, item);
  });
  return [...map.values()];
}

// Last-writer-wins: pick the field value from whichever side has the newer tsField.
// When one side's timestamp is strictly newer, its value is used even if null/''
// (user intentionally cleared the field). Falls back to the other side only when
// the field is completely absent (undefined) on the winner.
function lww(local, remote, field, tsField, fallback) {
  const lt = local[tsField] || 0;
  const rt = remote[tsField] || 0;
  const winner = lt >= rt ? local : remote;
  const loser  = lt >= rt ? remote : local;
  return winner[field] !== undefined ? winner[field] : (loser[field] !== undefined ? loser[field] : fallback);
}

function lwwTs(local, remote, tsField) {
  return Math.max(local[tsField] || 0, remote[tsField] || 0);
}

function mergeHistoryData(localH, remoteH) {
  return {
    expenses:     unionById(localH.expenses,     remoteH.expenses,     '_ts'),
    powerRecords: unionById(localH.powerRecords, remoteH.powerRecords, '_ts'),
  };
}

// Union-by-id merge for the wiki file's collections, preferring the higher _updatedAt.
// Does not carry _updatedAt — the caller stamps it before uploading (like mergeHistoryData).
function mergeWikiData(localW, remoteW) {
  const l = localW || {}, r = remoteW || {};
  return {
    recipes:       unionById(l.recipes,       r.recipes,       '_updatedAt'),
    shoppingLists: unionById(l.shoppingLists, r.shoppingLists, '_updatedAt'),
    resumes:       unionById(l.resumes,       r.resumes,       '_updatedAt'),
  };
}

function mergeData(local, remote) {
  const deletedIds = new Set([...(local._deletedIds || []), ...(remote._deletedIds || [])]);

  // Assets: union by id, merge history by _ts, exclude deleted
  const localAssetMap = new Map((local.assets || []).map(a => [a.id, a]));
  const remoteAssetMap = new Map((remote.assets || []).map(a => [a.id, a]));
  const assetMap = new Map();
  [...(remote.assets || []), ...(local.assets || [])].forEach(a => {
    if (deletedIds.has(a.id)) return;
    if (!assetMap.has(a.id)) assetMap.set(a.id, { ...a, history: [] });
    assetMap.get(a.id).history.push(...(a.history || []));
    // keep latest name/class/units via LWW timestamp (_metaTs covers all three; fall back to _nameTs for pre-_metaTs records)
    const merged = assetMap.get(a.id);
    const la = localAssetMap.get(a.id);
    const ra = remoteAssetMap.get(a.id);
    const src = la && ra
      ? ((la._metaTs || la._nameTs || 0) >= (ra._metaTs || ra._nameTs || 0) ? la : ra)
      : (la || ra || a);
    merged.name = src.name;
    merged.class = src.class;
    merged.units = src.units;
    merged._metaTs = Math.max(la ? (la._metaTs || la._nameTs || 0) : 0, ra ? (ra._metaTs || ra._nameTs || 0) : 0);
  });
  assetMap.forEach(a => {
    const seen = new Set();
    a.history = a.history
      .filter(h => { const k = h._ts || h.date + h.value; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (a._ts || 0) - (b._ts || 0));
  });
  // Apply history-entry tombstones: union of _deletedHistoryTs from both sides
  assetMap.forEach(a => {
    const la = localAssetMap.get(a.id);
    const ra = remoteAssetMap.get(a.id);
    const delTs = new Set([
      ...((la && la._deletedHistoryTs) || []),
      ...((ra && ra._deletedHistoryTs) || []),
    ]);
    if (delTs.size) {
      a._deletedHistoryTs = [...delTs];
      a.history = a.history.filter(h => !delTs.has(h._ts));
    }
  });

  // Mortgages: union by id, prefer higher _updatedAt, merge entries, exclude deleted
  const mortgageMap = new Map();
  [...(remote.mortgages || []), ...(local.mortgages || [])].forEach(m => {
    if (deletedIds.has(m.id)) return;
    if (!mortgageMap.has(m.id)) mortgageMap.set(m.id, { ...m, entries: [] });
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

  const RS_DEFAULTS = { inflationRate: 2.5, investmentRate: 5.0, retirementAge: 62, deathAge: 85, monthlyExpenses: 3000, annualSavings: 150000, safeWithdrawalRate: 4.0 };

  const merged = {
    accounts:        unionById(local.accounts,       remote.accounts,       '_updatedAt'),
    expenses:        unionById(local.expenses,        remote.expenses,        '_ts',        deletedIds),
    assets:          [...assetMap.values()],
    events:          unionById(local.events,          remote.events,          '_ts',        deletedIds),
    taxRecords:      unionById(local.taxRecords,      remote.taxRecords,      '_ts',        deletedIds),
    cpfRecords:      unionById(local.cpfRecords,      remote.cpfRecords,      '_ts',        deletedIds),
    insurances:      unionById(local.insurances,      remote.insurances,      '_updatedAt', deletedIds),
    ongoingExpenses: unionById(local.ongoingExpenses, remote.ongoingExpenses, '_updatedAt', deletedIds),
    dependents:      unionById(local.dependents,      remote.dependents,      '_ts',        deletedIds),
    medicalVisits:   unionById(local.medicalVisits,   remote.medicalVisits,   '_ts',        deletedIds),
    notes:           unionById(local.notes,           remote.notes,           '_updatedAt', deletedIds),
    mortgages:       [...mortgageMap.values()],
    _deletedIds:     [...deletedIds],
    budgets:         { ...(remote.budgets || {}), ...(local.budgets || {}) },
    netWorthSnapshots: [...nwMap.values()].sort((a, b) => a.key.localeCompare(b.key)),

    cpfSettings:           lww(local, remote, 'cpfSettings',        '_cpfSettingsTs',       { dateOfBirth: '' }),
    _cpfSettingsTs:        lwwTs(local, remote, '_cpfSettingsTs'),
    termDates:             lww(local, remote, 'termDates',          '_termDatesTs',          {}),
    _termDatesTs:          lwwTs(local, remote, '_termDatesTs'),
    eventTags:             lww(local, remote, 'eventTags',          '_eventTagsTs',          []),
    _eventTagsTs:          lwwTs(local, remote, '_eventTagsTs'),
    expenseCats:           lww(local, remote, 'expenseCats',        '_expenseCatsTs',        ''),
    _expenseCatsTs:        lwwTs(local, remote, '_expenseCatsTs'),
    emailParsers:          lww(local, remote, 'emailParsers',       '_emailParsersTs',       null),
    _emailParsersTs:       lwwTs(local, remote, '_emailParsersTs'),
    emailCatMap:           lww(local, remote, 'emailCatMap',        '_emailCatMapTs',        []),
    emailCatDefault:       lww(local, remote, 'emailCatDefault',    '_emailCatMapTs',        'Other'),
    _emailCatMapTs:        lwwTs(local, remote, '_emailCatMapTs'),
    aiReport:              lww(local, remote, 'aiReport',           '_aiReportTs',           null),
    _aiReportTs:           lwwTs(local, remote, '_aiReportTs'),
    allocationRatios:      lww(local, remote, 'allocationRatios',   '_allocationRatiosTs',   {}),
    _allocationRatiosTs:   lwwTs(local, remote, '_allocationRatiosTs'),
    customAiPrompt:        lww(local, remote, 'customAiPrompt',     '_customAiPromptTs',     null),
    _customAiPromptTs:     lwwTs(local, remote, '_customAiPromptTs'),
    retirementSettings:    { ...RS_DEFAULTS, ...lww(local, remote, 'retirementSettings', '_retirementSettingsTs', {}) },
    _retirementSettingsTs: lwwTs(local, remote, '_retirementSettingsTs'),
    busProxyUrl:           lww(local, remote, 'busProxyUrl',        '_busProxyTs',           ''),
    busProxyToken:         lww(local, remote, 'busProxyToken',      '_busProxyTs',           ''),
    _busProxyTs:           lwwTs(local, remote, '_busProxyTs'),
    _dependentsTs:         lwwTs(local, remote, '_dependentsTs'),

    // Wiki/history file IDs live in the main file so partners adopt them on first sync.
    // driveSync overwrites wikiUpdatedAt after it merges/uploads the wiki file.
    wikiFileId:    local.wikiFileId || remote.wikiFileId || null,
    wikiUpdatedAt: local.wikiUpdatedAt || 0,
    historyFileId: local.historyFileId || remote.historyFileId || null,
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
    // Create the history file first so its ID can be embedded in the main file.
    data.historyFileId = await uploadHistoryToDrive(token, null, historyData);
    await uploadToDrive(token, null, data);
    saveData(data);
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
  if (syncInFlight) { showToast('Sync already in progress'); return; }
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  const fileId = localStorage.getItem(DRIVE_FILE_KEY);
  if (!clientId || !fileId) { showToast('Not connected to Drive'); return; }
  syncInFlight = true;
  const btn = document.getElementById('driveSyncBtn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  setDriveStatus('Authenticating…');
  try {
    const token = await getAccessToken(clientId);

    setDriveStatus('Downloading…');
    // Fire downloads in parallel; prefetches fail gracefully if not needed.
    // History + wiki file IDs live in the main file — prefetch with the locally-known
    // ID (the common case); a partner that only has it on the remote downloads below.
    const localHistoryFileId = data.historyFileId || null;
    const localWikiFileId = data.wikiFileId || null;
    const remoteP = downloadFromDrive(token, fileId);
    const remoteHistPrefetch = localHistoryFileId
      ? downloadFromDrive(token, localHistoryFileId).catch(() => null)
      : null;
    const remoteWikiPrefetch = localWikiFileId
      ? downloadFromDrive(token, localWikiFileId).catch(() => null)
      : null;
    const remote = await remoteP;
    if (!remote.accounts || !Array.isArray(remote.expenses) || !Array.isArray(remote.assets)) {
      throw new Error('Invalid backup format');
    }

    // Split off any past-year entries that landed in remote.expenses (old format)
    const curYear = String(new Date().getFullYear());
    const remoteHistFromMain = (remote.expenses || []).filter(e => e.date && !e.date.startsWith(curYear + '-'));
    remote.expenses = (remote.expenses || []).filter(e => e.date && e.date.startsWith(curYear + '-'));

    // History file ID may come from local or be adopted from the remote main file
    // (partner first sync), exactly like the wiki file ID.
    const historyFileId = localHistoryFileId || remote.historyFileId || null;
    const remoteHistP = remoteHistPrefetch
      || (historyFileId ? downloadFromDrive(token, historyFileId).catch(() => null) : Promise.resolve(null));

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
      // dl === null means the download failed transiently. If the remote already has
      // data (remoteHistTs > 0), uploading without it would permanently erase
      // remote-only records — violating the "merge before upload" invariant.
      // Skip the upload; the next sync will retry with a successful download.
      if (dl !== null || remoteHistTs === 0) {
        mergedHistory = mergeHistoryData(historyData, remoteHistory);
        uploadHistory = true;
      }
    } else if (!historyFileId && remoteHistTs > localHistTs) {
      // Remote is newer but no history file linked — can't merge, keep local as-is.
      // Do NOT adopt remoteHistTs below: claiming a timestamp we never pulled makes
      // the next sync see equal timestamps and silently skip the remote forever.
    } else if (!historyFileId && (localHistTs > remoteHistTs || remoteHistFromMain.length)) {
      // No history file yet: create one from local (+ any old-format entries)
      if (remoteHistFromMain.length) mergedHistory = mergeHistoryData(historyData, { expenses: remoteHistFromMain });
      uploadHistory = true;
    }

    // Wiki: only sync to an explicitly-linked file (no auto-creation). The ID may
    // come from local or be adopted from the remote main file (partner first sync).
    const wikiFileId = localWikiFileId || remote.wikiFileId || null;
    const remoteWikiP = remoteWikiPrefetch
      || (wikiFileId ? downloadFromDrive(token, wikiFileId).catch(() => null) : Promise.resolve(null));
    const remoteWikiTs = remote.wikiUpdatedAt || 0;
    const localWikiTs = wikiData._updatedAt || 0;
    let mergedWiki = wikiData;
    let uploadWiki = false;
    if (wikiFileId && localWikiTs !== remoteWikiTs) {
      const dl = await remoteWikiP;
      if (dl && (Array.isArray(dl.recipes) || Array.isArray(dl.shoppingLists) || Array.isArray(dl.resumes))) {
        mergedWiki = mergeWikiData(wikiData, dl);
      }
      // Same guard as history: skip upload when the download failed and the remote
      // already has data — uploading now would silently erase remote-only records.
      if (dl !== null || remoteWikiTs === 0) {
        uploadWiki = true;
      }
    }

    setDriveStatus('Merging…');
    const merged = mergeData(data, remote);

    // Apply deletedIds to history + wiki
    const deletedSet = new Set(merged._deletedIds);
    mergedHistory.expenses = mergedHistory.expenses.filter(e => !deletedSet.has(e.id));
    mergedHistory.powerRecords = (mergedHistory.powerRecords || []).filter(r => !deletedSet.has(r.id));
    mergedWiki.recipes = (mergedWiki.recipes || []).filter(r => !deletedSet.has(r.id));
    mergedWiki.shoppingLists = (mergedWiki.shoppingLists || []).filter(r => !deletedSet.has(r.id));
    mergedWiki.resumes = (mergedWiki.resumes || []).filter(r => !deletedSet.has(r.id));

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
    // busApiKey is intentionally NOT synced to Drive — it is a secret and stays
    // local-only (localStorage 'finance:busApiKey'). Not writing it here also
    // scrubs any previously-uploaded key from the Drive file on the next sync.
    // busProxyUrl/Token use last-writer-wins via _busProxyTs (handled in mergeData).
    let effectiveHistoryFileId = historyFileId;
    if (uploadHistory) {
      mergedHistory._updatedAt = Date.now();
      merged.historyUpdatedAt = mergedHistory._updatedAt;
      // Capture the returned ID — on first upload (no file yet) Drive assigns a new one.
      effectiveHistoryFileId = await uploadHistoryToDrive(token, historyFileId || null, mergedHistory);
    } else {
      // Nothing uploaded: keep our own local history timestamp. Adopting a remote
      // timestamp we never pulled would permanently mask the remote history.
      merged.historyUpdatedAt = localHistTs;
    }
    merged.historyFileId = effectiveHistoryFileId || null;
    if (uploadWiki) {
      mergedWiki._updatedAt = Date.now();
      merged.wikiUpdatedAt = mergedWiki._updatedAt;
      await uploadWikiToDrive(token, wikiFileId, mergedWiki);
    } else {
      merged.wikiUpdatedAt = localWikiTs;
    }
    merged.wikiFileId = wikiFileId;
    await uploadToDrive(token, fileId, merged);

    const now = new Date().toISOString();
    localStorage.setItem('finance:lastSync', now);
    // Re-merge to capture any edits made to `data` during the upload window.
    // New local records have higher _ts and win; the upload was already correct
    // for the remote side — the next sync will push the incremental diff.
    merged = mergeData(data, merged);
    data = merged;
    if (merged.busProxyUrl) localStorage.setItem(BUS_PROXY_URL_STORAGE, merged.busProxyUrl);
    if (merged.busProxyToken) localStorage.setItem(BUS_PROXY_TOKEN_STORAGE, merged.busProxyToken);
    // Mirror back to localStorage so the app reads the winning value immediately.
    historyData = mergedHistory;
    recalcBalances(data, data.expenses);
    recalcMonthlyAgg(data, allExpenses());
    // historyData._updatedAt and data.historyUpdatedAt are already equal here (both
    // paths set merged.historyUpdatedAt to historyData._updatedAt), so persist the
    // history blob directly without bumping its timestamp via saveHistory().
    historyData._updatedAt = merged.historyUpdatedAt;
    wikiData = mergedWiki;
    wikiData._updatedAt = merged.wikiUpdatedAt;
    saveData(data);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyData));
    localStorage.setItem(WIKI_KEY, JSON.stringify(wikiData));
    renderAll();

    document.getElementById('shareCodeDisplay').textContent =
      makeShareCode(clientId, fileId);
    document.getElementById('driveLastSync').textContent = 'Last synced ' + new Date(now).toLocaleString();
    setDriveStatus('Sync complete ✓');
    showToast('Sync complete');
  } catch (err) {
    setDriveStatus('Error: ' + err.message);
    showToast('Sync failed');
  } finally {
    syncInFlight = false;
    btn.disabled = false;
    btn.textContent = '↕ Sync Now';
  }
}

async function forceSyncHistory() {
  if (syncInFlight) { showToast('Sync already in progress'); return; }
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  const fileId = localStorage.getItem(DRIVE_FILE_KEY);
  const historyFileId = data.historyFileId;
  if (!clientId || !fileId) { showToast('Not connected to Drive'); return; }
  if (!historyFileId) { showToast('No history file linked — run a full sync first'); return; }
  syncInFlight = true;
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
    syncInFlight = false;
    btn.disabled = false;
    btn.textContent = '⟳ Force History Sync';
  }
}

// ── Wiki file (separate Drive file; ID stored in main file) ─────────────────────
// Save the file ID typed into the menu. Blank unlinks. The ID rides in the main
// file, so it propagates to a partner on the next main sync.
function linkWikiFile() {
  const v = (document.getElementById('wikiFileIdInput').value || '').trim();
  data.wikiFileId = v || null;
  saveData(data);
  showToast(v ? 'Wiki file linked — tap Sync Now' : 'Wiki file unlinked');
}

// Create a brand-new wiki file from the current local wiki data and link it.
async function createWikiFile() {
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  if (!clientId) { showToast('Connect to Drive first'); return; }
  if (data.wikiFileId && !confirm('A wiki file is already linked. Create a new one and replace the link?')) return;
  setDriveStatus('Creating wiki file…');
  try {
    const token = await getAccessToken(clientId);
    wikiData._updatedAt = Date.now();
    const id = await uploadWikiToDrive(token, null, wikiData);
    data.wikiFileId = id;
    data.wikiUpdatedAt = wikiData._updatedAt;
    saveData(data);
    localStorage.setItem(WIKI_KEY, JSON.stringify(wikiData));
    await uploadToDrive(token, localStorage.getItem(DRIVE_FILE_KEY), data);
    const inp = document.getElementById('wikiFileIdInput');
    if (inp) inp.value = id;
    setDriveStatus('Wiki file created ✓');
    showToast('Wiki file created & linked');
  } catch (err) {
    setDriveStatus('Error: ' + err.message);
    showToast('Could not create wiki file');
  }
}

async function forceSyncWiki() {
  if (syncInFlight) { showToast('Sync already in progress'); return; }
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  const fileId = localStorage.getItem(DRIVE_FILE_KEY);
  const wikiFileId = data.wikiFileId;
  if (!clientId || !fileId) { showToast('Not connected to Drive'); return; }
  if (!wikiFileId) { showToast('No wiki file linked — enter a file ID first'); return; }
  syncInFlight = true;
  const btn = document.getElementById('forceWikiSyncBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  setDriveStatus('Authenticating…');
  try {
    const token = await getAccessToken(clientId);
    setDriveStatus('Downloading wiki…');
    const remoteWiki = await downloadFromDrive(token, wikiFileId);
    setDriveStatus('Merging wiki…');
    const mergedWiki = mergeWikiData(wikiData, remoteWiki);
    const deletedSet = new Set(data._deletedIds || []);
    mergedWiki.recipes = mergedWiki.recipes.filter(r => !deletedSet.has(r.id));
    mergedWiki.shoppingLists = mergedWiki.shoppingLists.filter(r => !deletedSet.has(r.id));
    mergedWiki.resumes = mergedWiki.resumes.filter(r => !deletedSet.has(r.id));
    setDriveStatus('Uploading wiki…');
    mergedWiki._updatedAt = Date.now();
    await uploadWikiToDrive(token, wikiFileId, mergedWiki);
    data.wikiUpdatedAt = mergedWiki._updatedAt;
    await uploadToDrive(token, fileId, data);
    wikiData = mergedWiki;
    saveData(data);
    localStorage.setItem(WIKI_KEY, JSON.stringify(wikiData));
    renderAll();
    setDriveStatus('Wiki sync complete ✓');
    showToast(`Wiki synced — ${mergedWiki.recipes.length + mergedWiki.shoppingLists.length + mergedWiki.resumes.length} items`);
  } catch (err) {
    setDriveStatus('Error: ' + err.message);
    showToast('Wiki sync failed');
  } finally {
    syncInFlight = false;
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Sync wiki'; }
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

// History file ID lives in the main file (data.historyFileId) now, not localStorage,
// so pass no storageKey — callers persist the returned ID into data.historyFileId.
async function uploadHistoryToDrive(token, fileId, payload) {
  return uploadFileToDrive(token, fileId, payload, 'finance-elvis-history.json', null);
}

// Wiki file ID lives in the main file (data.wikiFileId), not localStorage, so pass
// no storageKey — callers persist the returned ID into data.wikiFileId themselves.
async function uploadWikiToDrive(token, fileId, payload) {
  return uploadFileToDrive(token, fileId, payload, 'finance-elvis-wiki.json', null);
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

