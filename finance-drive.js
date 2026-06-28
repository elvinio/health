// ── Google Drive token (declared first so it is always initialised before any
// synchronous DOM setup below can throw and leave it in TDZ) ──────────────────
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
let driveToken = null;
let syncInFlight = false;

// ── Sync v2: metadata file + per-file watermarks + gzipped data files ──────────
// The file pointed at by DRIVE_FILE_KEY (and embedded in the share code) is now a
// small *metadata* file `elvis-finance-metadata.json`: it holds the IDs and last-
// updated versions of the three bulk files (main / history / wiki). A sync first
// downloads this tiny file, then only downloads/uploads the bulk files that
// actually changed (decided by watermarks). The three bulk files are stored
// app-level gzipped (with a magic-byte fallback so legacy plain-JSON still reads).
const MAIN_DATA_FILE_KEY = 'finance:driveMainDataFileId'; // local cache of the main bulk file's ID
const META_FILENAME = 'elvis-finance-metadata.json';
const MAIN_FILENAME = 'finance-elvis.json';
const HISTORY_FILENAME = 'finance-elvis-history.json';
const WIKI_FILENAME = 'finance-elvis-wiki.json';
// Incoming file written by the Android MOE Bridge app (plain JSON, app is sole writer).
const MOE_INBOX_FILENAME = 'moe-inbox-incoming.json';

// Watermarks: per store we remember the local version (`l`) and remote version
// (`r`) at the moment of the last successful reconcile. A store is "locally dirty"
// when its current local version differs from `l`; "remote-new" when the metadata
// file's version differs from `r`. Equality (not >) is used throughout so cross-
// device clock skew never matters — versions are treated as opaque tokens.
function wmKey(store, which) { return 'finance:wm:' + store + ':' + which; }
function getWm(store) { return { l: localStorage.getItem(wmKey(store, 'l')), r: localStorage.getItem(wmKey(store, 'r')) }; }
function setWm(store, l, r) {
  localStorage.setItem(wmKey(store, 'l'), String(l));
  localStorage.setItem(wmKey(store, 'r'), String(r));
}
function differs(a, b) { return String(a) !== String(b); }

// Metadata-file shape helpers.
function isOldBulkFile(o) { return !!(o && o._meta !== 1 && o.accounts && Array.isArray(o.expenses) && Array.isArray(o.assets)); }
function normalizeMeta(o) {
  o = o || {};
  return {
    _meta: 1,
    mainFileId: o.mainFileId || null,
    historyFileId: o.historyFileId || null,
    wikiFileId: o.wikiFileId || null,
    mainUpdatedAt: o.mainUpdatedAt || 0,
    historyUpdatedAt: o.historyUpdatedAt || 0,
    wikiUpdatedAt: o.wikiUpdatedAt || 0,
    _metaTs: o._metaTs || 0,
  };
}

// ── gzip helpers (app-level, with magic-byte fallback) ────────────────────────
// gzipString returns a Blob: gzipped when CompressionStream exists, else plain
// JSON (graceful degradation on old browsers). gunzipBlobToText sniffs the gzip
// magic bytes (0x1f 0x8b) so it transparently reads both gzipped and legacy
// plain-JSON files during/after rollout.
async function gzipString(str) {
  if (typeof CompressionStream === 'undefined') return new Blob([str], { type: 'application/json' });
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  const gz = await new Response(stream).blob();
  return new Blob([gz], { type: 'application/gzip' });
}
async function gunzipBlobToText(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('gzip not supported in this browser');
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(buf);
}

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
  if (syncInFlight) { showToast('Sync already in progress'); return; }
  await driveSync();
}

// Auto-sync on app open when connected and the last sync was >24h ago (or never).
// Runs quietly in the background; failures fall through to the next manual/auto sync.
const AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
async function maybeAutoSync() {
  const connected = !!(localStorage.getItem(DRIVE_FILE_KEY) && localStorage.getItem(DRIVE_CLIENT_KEY));
  if (!connected || syncInFlight) return;
  const last = localStorage.getItem('finance:lastSync');
  const lastMs = last ? new Date(last).getTime() : 0;
  if (Number.isFinite(lastMs) && Date.now() - lastMs < AUTO_SYNC_INTERVAL_MS) return;
  try { await driveSync(); } catch (e) { /* next open retries */ }
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
    caches.keys().then(keys => {
      const v = keys.find(k => k.startsWith('finance-v'));
      const el = document.getElementById('swVersionDisplay');
      if (el) el.textContent = v ? 'Cache: ' + v : '';
    });
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
// Uses !== undefined so explicit null/'' from the winner are preserved (not fallen through).
function lww(local, remote, field, tsField, fallback) {
  const winner = (local[tsField] || 0) >= (remote[tsField] || 0) ? local : remote;
  const loser  = winner === local ? remote : local;
  return winner[field] !== undefined ? winner[field] : (loser[field] ?? fallback);
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

// MOE inbox merge between two PWA devices. Items are immutable once captured, so the
// only conflict is deletion: an id that a device has in moeInboxSeenIds but NOT in its
// moeInbox was deleted there — and delete wins. Seen-ids are unioned (permanent
// tombstones) so a deleted item never reappears via fetchMoeInbox.
function mergeMoeInbox(local, remote) {
  const lInbox = local.moeInbox || [], rInbox = remote.moeInbox || [];
  const lSeen = new Set(local.moeInboxSeenIds || []), rSeen = new Set(remote.moeInboxSeenIds || []);
  const lPresent = new Set(lInbox.map(i => i.id)), rPresent = new Set(rInbox.map(i => i.id));
  const deleted = new Set();
  lSeen.forEach(id => { if (!lPresent.has(id)) deleted.add(id); });
  rSeen.forEach(id => { if (!rPresent.has(id)) deleted.add(id); });
  const byId = new Map();
  [...rInbox, ...lInbox].forEach(i => { if (i && i.id && !deleted.has(i.id)) byId.set(i.id, i); });
  return [...byId.values()].sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
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
    const la = localAssetMap.get(a.id);
    const ra = remoteAssetMap.get(a.id);
    const deletedTs = new Set([...(la?._deletedHistoryTs || []), ...(ra?._deletedHistoryTs || [])]);
    a._deletedHistoryTs = deletedTs.size ? [...deletedTs] : undefined;
    const seen = new Set();
    a.history = a.history
      .filter(h => !deletedTs.has(h._ts))
      .filter(h => { const k = h._ts || h.date + h.value; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (a._ts || 0) - (b._ts || 0));
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
    moeInbox:        mergeMoeInbox(local, remote),
    moeInboxSeenIds: [...new Set([...(local.moeInboxSeenIds || []), ...(remote.moeInboxSeenIds || [])])],
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
    const mainVer = Date.now();
    const histVer = Date.now();
    if (historyData.expenses.length && !historyData._updatedAt) historyData._updatedAt = histVer;
    const histPub = historyData._updatedAt || histVer;
    // Create the gzipped bulk files first…
    const historyFileId = await uploadDataFile(token, null, historyData, HISTORY_FILENAME, null);
    data.historyFileId = historyFileId;
    data._localTs = mainVer;
    const mainFileId = await uploadDataFile(token, null, data, MAIN_FILENAME, MAIN_DATA_FILE_KEY);
    // …then the small metadata file. Its ID is what the share code points at, so
    // store it under DRIVE_FILE_KEY (replacing the legacy "main file = share file").
    const metaObj = {
      _meta: 1, mainFileId, historyFileId, wikiFileId: data.wikiFileId || null,
      mainUpdatedAt: mainVer, historyUpdatedAt: histPub, wikiUpdatedAt: data.wikiUpdatedAt || 0,
      _metaTs: Date.now(),
    };
    await uploadFileToDrive(token, null, metaObj, META_FILENAME, DRIVE_FILE_KEY);
    saveData(data, false);
    setWm('main', mainVer, mainVer);
    setWm('history', histPub, histPub);
    setWm('wiki', metaObj.wikiUpdatedAt, metaObj.wikiUpdatedAt);
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
  const metaFileId = localStorage.getItem(DRIVE_FILE_KEY);
  if (!clientId || !metaFileId) { showToast('Not connected to Drive'); return; }
  if (syncInFlight) { showToast('Sync already in progress'); return; }
  syncInFlight = true;
  const btn = document.getElementById('driveSyncBtn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  setDriveStatus('Authenticating…');
  try {
    const token = await getAccessToken(clientId);

    // Ingest any new MOE Bridge captures first so they ride this sync's upload.
    try {
      const n = await fetchMoeInbox(token);
      if (n) showToast(`MOE inbox: ${n} new`);
    } catch (e) { console.warn('[fetchMoeInbox]', e); }

    setDriveStatus('Checking…');
    // The file behind DRIVE_FILE_KEY is the metadata file in the v2 format. On the
    // very first sync after upgrading it is still the old single bulk file — detect
    // that and migrate once. Both forms are plain JSON, so a plain download reads both.
    const head = await downloadFromDrive(token, metaFileId);
    if (isOldBulkFile(head)) {
      await migrateToMetadataFile(token, metaFileId, head);
    } else {
      await syncWithMetadata(token, metaFileId, normalizeMeta(head));
    }

    const now = new Date().toISOString();
    localStorage.setItem('finance:lastSync', now);
    document.getElementById('shareCodeDisplay').textContent = makeShareCode(clientId, metaFileId);
    document.getElementById('driveLastSync').textContent = 'Last synced ' + new Date(now).toLocaleString();
    setDriveStatus('Sync complete ✓');
    showToast('Sync complete');
  } catch (err) {
    const loc = (err.stack || '').split('\n').find(l => /finance-.*:\d+/.test(l));
    const detail = err.message + (loc ? ' @ ' + loc.trim().replace(/^at\s+/, '') : '');
    setDriveStatus('Error: ' + detail);
    showToast('Sync failed — ' + detail, 10000);
  } finally {
    syncInFlight = false;
    btn.disabled = false;
    btn.textContent = '↕ Sync Now';
  }
}

// ── v2 sync: reconcile each store gated by its watermark ──────────────────────
// For each store: localDirty = (local version ≠ wm.l), remoteNew = (meta version ≠
// wm.r). When dirty we download→merge→upload (preserving the "never upload without
// merging first" invariant); when only remote is new we adopt without uploading
// (so two idle devices never ping-pong versions); when neither, the store is
// skipped entirely — that is the speed win.
async function syncWithMetadata(token, metaFileId, meta) {
  const deletedSet = new Set(data._deletedIds || []);
  const startMainVer = data._localTs;
  const startHistVer = historyData._updatedAt || 0;
  const startWikiVer = wikiData._updatedAt || 0;
  let mainPublished = false, historyPublished = false, wikiPublished = false;
  let mainTouched = false, historyTouched = false;

  // ===== MAIN =====
  const mainFileId = meta.mainFileId || localStorage.getItem(MAIN_DATA_FILE_KEY);
  {
    const wm = getWm('main');
    const localDirty = differs(data._localTs, wm.l);
    const remoteNew = differs(meta.mainUpdatedAt, wm.r);
    if (!mainFileId && localDirty) {
      // No main file yet (unusual) — create one from local.
      setDriveStatus('Uploading data…');
      const pubVer = Date.now();
      data._localTs = pubVer;
      const id = await uploadDataFile(token, null, data, MAIN_FILENAME, MAIN_DATA_FILE_KEY);
      meta.mainFileId = id; meta.mainUpdatedAt = pubVer;
      mainPublished = true; mainTouched = true;
      saveData(data, false);
      setWm('main', pubVer, pubVer);
    } else if (mainFileId && localDirty) {
      setDriveStatus('Syncing data…');
      const remoteMain = await downloadDataFile(token, mainFileId).catch(() => null);
      if (remoteMain && remoteMain.accounts) {
        const merged = mergeData(data, remoteMain);
        const pubVer = Date.now();
        merged._localTs = pubVer;
        await uploadDataFile(token, mainFileId, merged, MAIN_FILENAME, MAIN_DATA_FILE_KEY);
        meta.mainFileId = mainFileId; meta.mainUpdatedAt = pubVer;
        mainPublished = true; mainTouched = true;
        // Fold in any edits made during the upload window; if there were any, keep
        // the store dirty (≠ pubVer) so the next sync re-uploads them.
        const interim = differs(data._localTs, startMainVer);
        data = interim ? mergeData(data, merged) : merged;
        data._localTs = interim ? Date.now() : pubVer;
        saveData(data, false);
        setWm('main', pubVer, pubVer);
      }
      // remoteMain === null → transient download failure; skip to avoid clobbering.
    } else if (mainFileId && remoteNew) {
      setDriveStatus('Downloading data…');
      const remoteMain = await downloadDataFile(token, mainFileId).catch(() => null);
      if (remoteMain && remoteMain.accounts) {
        const merged = mergeData(data, remoteMain);
        merged._localTs = meta.mainUpdatedAt;
        data = merged; mainTouched = true;
        saveData(data, false);
        setWm('main', meta.mainUpdatedAt, meta.mainUpdatedAt);
      }
    }
  }

  // ===== HISTORY =====
  const historyFileId = meta.historyFileId || data.historyFileId || null;
  {
    const wm = getWm('history');
    const localDirty = differs(historyData._updatedAt || 0, wm.l);
    const remoteNew = differs(meta.historyUpdatedAt, wm.r);
    const hasLocalHistory = (historyData.expenses || []).length || (historyData.powerRecords || []).length;
    if (!historyFileId && localDirty && hasLocalHistory) {
      setDriveStatus('Uploading history…');
      const pubVer = Date.now();
      historyData._updatedAt = pubVer;
      const id = await uploadDataFile(token, null, historyData, HISTORY_FILENAME, null);
      meta.historyFileId = id; meta.historyUpdatedAt = pubVer;
      data.historyFileId = id;
      historyPublished = true; historyTouched = true;
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyData)); } catch (e) {}
      setWm('history', pubVer, pubVer);
    } else if (historyFileId && localDirty) {
      setDriveStatus('Syncing history…');
      const remoteHist = await downloadDataFile(token, historyFileId).catch(() => null);
      if (remoteHist && Array.isArray(remoteHist.expenses)) {
        let mergedH = mergeHistoryData(historyData, remoteHist);
        mergedH.expenses = mergedH.expenses.filter(e => !deletedSet.has(e.id));
        mergedH.powerRecords = (mergedH.powerRecords || []).filter(r => !deletedSet.has(r.id));
        const pubVer = Date.now();
        mergedH._updatedAt = pubVer;
        await uploadDataFile(token, historyFileId, mergedH, HISTORY_FILENAME, null);
        meta.historyFileId = historyFileId; meta.historyUpdatedAt = pubVer;
        data.historyFileId = historyFileId;
        historyPublished = true; historyTouched = true;
        const interim = differs(historyData._updatedAt || 0, startHistVer);
        historyData = interim ? mergeHistoryData(historyData, mergedH) : mergedH;
        historyData._updatedAt = interim ? Date.now() : pubVer;
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyData)); } catch (e) {}
        setWm('history', pubVer, pubVer);
      }
    } else if (historyFileId && remoteNew) {
      setDriveStatus('Downloading history…');
      const remoteHist = await downloadDataFile(token, historyFileId).catch(() => null);
      if (remoteHist && Array.isArray(remoteHist.expenses)) {
        let mergedH = mergeHistoryData(historyData, remoteHist);
        mergedH.expenses = mergedH.expenses.filter(e => !deletedSet.has(e.id));
        mergedH.powerRecords = (mergedH.powerRecords || []).filter(r => !deletedSet.has(r.id));
        mergedH._updatedAt = meta.historyUpdatedAt;
        historyData = mergedH; historyTouched = true;
        data.historyFileId = historyFileId;
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyData)); } catch (e) {}
        setWm('history', meta.historyUpdatedAt, meta.historyUpdatedAt);
      }
    }
  }

  // Cross-store dedup (local-only cleanup): an expense edited across the year
  // boundary can land in both stores. Keep the higher-_ts copy. Runs only when we
  // touched both stores; both devices compute it identically so no re-upload needed.
  if (mainTouched && historyTouched) {
    const histExpById = new Map(historyData.expenses.map(e => [e.id, e]));
    data.expenses = data.expenses.filter(e => {
      const h = histExpById.get(e.id);
      if (!h) return true;
      if ((e._ts || 0) >= (h._ts || 0)) { histExpById.delete(e.id); return true; }
      return false;
    });
    historyData.expenses = [...histExpById.values()];
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyData)); } catch (e) {}
  }

  // ===== WIKI (only when a file is linked; no auto-creation) =====
  const wikiFileId = meta.wikiFileId || data.wikiFileId || null;
  {
    const wm = getWm('wiki');
    const localDirty = differs(wikiData._updatedAt || 0, wm.l);
    const remoteNew = differs(meta.wikiUpdatedAt, wm.r);
    // A freshly linked wiki file (id known locally but not yet in the metadata file)
    // must be adopted into metadata even when nothing else changed.
    const linkNeedsMeta = wikiFileId && differs(meta.wikiFileId, wikiFileId);
    if (wikiFileId && localDirty) {
      setDriveStatus('Syncing wiki…');
      const remoteWiki = await downloadDataFile(token, wikiFileId).catch(() => null);
      let mergedW = wikiData;
      if (remoteWiki && (Array.isArray(remoteWiki.recipes) || Array.isArray(remoteWiki.shoppingLists) || Array.isArray(remoteWiki.resumes))) {
        mergedW = mergeWikiData(wikiData, remoteWiki);
      }
      // Skip upload only when the download failed AND the remote already has data
      // (uploading then would erase remote-only records).
      if (remoteWiki !== null || !meta.wikiUpdatedAt) {
        mergedW.recipes = (mergedW.recipes || []).filter(r => !deletedSet.has(r.id));
        mergedW.shoppingLists = (mergedW.shoppingLists || []).filter(r => !deletedSet.has(r.id));
        mergedW.resumes = (mergedW.resumes || []).filter(r => !deletedSet.has(r.id));
        const pubVer = Date.now();
        mergedW._updatedAt = pubVer;
        await uploadDataFile(token, wikiFileId, mergedW, WIKI_FILENAME, null);
        meta.wikiFileId = wikiFileId; meta.wikiUpdatedAt = pubVer;
        data.wikiFileId = wikiFileId; data.wikiUpdatedAt = pubVer;
        wikiPublished = true;
        const interim = differs(wikiData._updatedAt || 0, startWikiVer);
        wikiData = interim ? mergeWikiData(wikiData, mergedW) : mergedW;
        wikiData._updatedAt = interim ? Date.now() : pubVer;
        try { localStorage.setItem(WIKI_KEY, JSON.stringify(wikiData)); } catch (e) {}
        setWm('wiki', pubVer, pubVer);
      }
    } else if (wikiFileId && (remoteNew || linkNeedsMeta)) {
      setDriveStatus('Downloading wiki…');
      const remoteWiki = await downloadDataFile(token, wikiFileId).catch(() => null);
      if (remoteWiki && (Array.isArray(remoteWiki.recipes) || Array.isArray(remoteWiki.shoppingLists) || Array.isArray(remoteWiki.resumes))) {
        let mergedW = mergeWikiData(wikiData, remoteWiki);
        mergedW.recipes = (mergedW.recipes || []).filter(r => !deletedSet.has(r.id));
        mergedW.shoppingLists = (mergedW.shoppingLists || []).filter(r => !deletedSet.has(r.id));
        mergedW.resumes = (mergedW.resumes || []).filter(r => !deletedSet.has(r.id));
        mergedW._updatedAt = meta.wikiUpdatedAt || wikiData._updatedAt || 0;
        wikiData = mergedW;
        data.wikiFileId = wikiFileId; data.wikiUpdatedAt = mergedW._updatedAt;
        try { localStorage.setItem(WIKI_KEY, JSON.stringify(wikiData)); } catch (e) {}
        setWm('wiki', mergedW._updatedAt, meta.wikiUpdatedAt || 0);
      }
      if (linkNeedsMeta) { meta.wikiFileId = wikiFileId; wikiPublished = true; }
    }
  }

  // ===== Write the metadata file LAST (crash-safe ordering) =====
  // Re-download first and only overwrite the stores we actually published, so a
  // partner's concurrent change to a *different* store isn't clobbered.
  if (mainPublished || historyPublished || wikiPublished) {
    setDriveStatus('Finishing…');
    const fresh = normalizeMeta(await downloadFromDrive(token, metaFileId).catch(() => meta));
    if (mainPublished) { fresh.mainFileId = meta.mainFileId; fresh.mainUpdatedAt = meta.mainUpdatedAt; }
    if (historyPublished) { fresh.historyFileId = meta.historyFileId; fresh.historyUpdatedAt = meta.historyUpdatedAt; }
    if (wikiPublished) { fresh.wikiFileId = meta.wikiFileId; fresh.wikiUpdatedAt = meta.wikiUpdatedAt; }
    fresh._meta = 1; fresh._metaTs = Date.now();
    await uploadFileToDrive(token, metaFileId, fresh, META_FILENAME, null);
  }

  // ===== Commit local derived state =====
  if (data.busProxyUrl) localStorage.setItem(BUS_PROXY_URL_STORAGE, data.busProxyUrl);
  if (data.busProxyToken) localStorage.setItem(BUS_PROXY_TOKEN_STORAGE, data.busProxyToken);
  recalcBalances(data, data.expenses);
  recalcMonthlyAgg(data, allExpenses());
  saveData(data, false);
  renderAll();
}

// One-time migration from the legacy single-bulk file. The legacy file (behind
// DRIVE_FILE_KEY, embedded in the share code) is rewritten in place as the new
// metadata file, and the bulk data is copied into a brand-new gzipped main file.
// History/wiki files keep their existing IDs. After this, the share code is
// unchanged — partners just need the upgraded code (old code can no longer read it).
async function migrateToMetadataFile(token, metaFileId, oldRemote) {
  setDriveStatus('Upgrading sync format…');
  if (!oldRemote.accounts || !Array.isArray(oldRemote.expenses) || !Array.isArray(oldRemote.assets)) {
    throw new Error('Invalid backup format');
  }
  // Past-year entries that may sit in the old main file → fold into history.
  const curYear = String(new Date().getFullYear());
  const remoteHistFromMain = (oldRemote.expenses || []).filter(e => e.date && !e.date.startsWith(curYear + '-'));
  oldRemote.expenses = (oldRemote.expenses || []).filter(e => !e.date || e.date.startsWith(curYear + '-'));

  const merged = mergeData(data, oldRemote);
  const deletedSet = new Set(merged._deletedIds || []);
  const mainVer = Date.now();
  merged._localTs = mainVer;

  // History
  const historyFileId = data.historyFileId || oldRemote.historyFileId || null;
  let remoteHist = historyFileId ? await downloadDataFile(token, historyFileId).catch(() => null) : null;
  let combinedRemoteHist = { expenses: remoteHistFromMain };
  if (remoteHist && Array.isArray(remoteHist.expenses)) combinedRemoteHist = mergeHistoryData(remoteHist, { expenses: remoteHistFromMain });
  let mergedHistory = mergeHistoryData(historyData, combinedRemoteHist);
  mergedHistory.expenses = mergedHistory.expenses.filter(e => !deletedSet.has(e.id));
  mergedHistory.powerRecords = (mergedHistory.powerRecords || []).filter(r => !deletedSet.has(r.id));
  const histVer = Date.now();
  mergedHistory._updatedAt = histVer;

  // Cross-store dedup
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

  // Wiki (only if linked)
  const wikiFileId = data.wikiFileId || oldRemote.wikiFileId || null;
  let mergedWiki = wikiData;
  let wikiVer = wikiData._updatedAt || 0;
  if (wikiFileId) {
    const remoteWiki = await downloadDataFile(token, wikiFileId).catch(() => null);
    if (remoteWiki && (Array.isArray(remoteWiki.recipes) || Array.isArray(remoteWiki.shoppingLists) || Array.isArray(remoteWiki.resumes))) {
      mergedWiki = mergeWikiData(wikiData, remoteWiki);
    }
    mergedWiki.recipes = (mergedWiki.recipes || []).filter(r => !deletedSet.has(r.id));
    mergedWiki.shoppingLists = (mergedWiki.shoppingLists || []).filter(r => !deletedSet.has(r.id));
    mergedWiki.resumes = (mergedWiki.resumes || []).filter(r => !deletedSet.has(r.id));
    wikiVer = Date.now();
    mergedWiki._updatedAt = wikiVer;
  }

  // Create/overwrite the gzipped bulk files.
  setDriveStatus('Creating files…');
  const histId = await uploadDataFile(token, historyFileId, mergedHistory, HISTORY_FILENAME, null);
  let wikiId = wikiFileId;
  if (wikiFileId) wikiId = await uploadDataFile(token, wikiFileId, mergedWiki, WIKI_FILENAME, null);
  const mainId = await uploadDataFile(token, null, merged, MAIN_FILENAME, MAIN_DATA_FILE_KEY);

  // Rewrite the legacy file in place as the metadata file (keeps the share code).
  const metaObj = {
    _meta: 1, mainFileId: mainId, historyFileId: histId, wikiFileId: wikiId || null,
    mainUpdatedAt: mainVer, historyUpdatedAt: histVer, wikiUpdatedAt: wikiVer, _metaTs: Date.now(),
  };
  await uploadFileToDrive(token, metaFileId, metaObj, META_FILENAME, null);

  // Commit locally.
  data = merged;
  data.historyFileId = histId;
  data.wikiFileId = wikiId || null;
  data._localTs = mainVer;
  historyData = mergedHistory;
  wikiData = mergedWiki;
  localStorage.setItem(MAIN_DATA_FILE_KEY, mainId);
  setWm('main', mainVer, mainVer);
  setWm('history', histVer, histVer);
  setWm('wiki', wikiVer, wikiVer);
  if (data.busProxyUrl) localStorage.setItem(BUS_PROXY_URL_STORAGE, data.busProxyUrl);
  if (data.busProxyToken) localStorage.setItem(BUS_PROXY_TOKEN_STORAGE, data.busProxyToken);
  recalcBalances(data, data.expenses);
  recalcMonthlyAgg(data, allExpenses());
  saveData(data, false);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyData)); } catch (e) {}
  try { localStorage.setItem(WIKI_KEY, JSON.stringify(wikiData)); } catch (e) {}
  renderAll();
}

async function forceSyncHistory() {
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  const metaFileId = localStorage.getItem(DRIVE_FILE_KEY);
  if (!clientId || !metaFileId) { showToast('Not connected to Drive'); return; }
  if (syncInFlight) { showToast('Sync already in progress'); return; }
  syncInFlight = true;
  const btn = document.getElementById('forceHistorySyncBtn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  setDriveStatus('Authenticating…');
  try {
    const token = await getAccessToken(clientId);
    const meta = normalizeMeta(await downloadFromDrive(token, metaFileId));
    const historyFileId = meta.historyFileId || data.historyFileId;
    if (!historyFileId) { showToast('No history file linked — run a full sync first'); return; }
    setDriveStatus('Downloading history…');
    const remoteHistory = await downloadDataFile(token, historyFileId);
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
    const pubVer = Date.now();
    mergedHistory._updatedAt = pubVer;
    await uploadDataFile(token, historyFileId, mergedHistory, HISTORY_FILENAME, null);
    // Record the new version + file ID in the metadata file.
    meta.historyFileId = historyFileId;
    meta.historyUpdatedAt = pubVer;
    meta._meta = 1; meta._metaTs = Date.now();
    await uploadFileToDrive(token, metaFileId, meta, META_FILENAME, null);
    historyData = mergedHistory;
    data.historyFileId = historyFileId;
    setWm('history', pubVer, pubVer);
    recalcMonthlyAgg(data, allExpenses());
    saveData(data, false);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyData)); }
    catch (e) { if (typeof showToast === 'function') showToast('⚠️ Storage full — history not saved locally', 8000); }
    renderAll();
    setDriveStatus('History sync complete ✓');
    showToast(`History synced — ${historyData.expenses.length} records`);
  } catch (err) {
    setDriveStatus('Error: ' + err.message);
    showToast('History sync failed — ' + err.message, 8000);
  } finally {
    syncInFlight = false;
    btn.disabled = false;
    btn.textContent = '⟳ Force History Sync';
  }
}

// ── Wiki file (separate gzipped Drive file; ID tracked in the metadata file) ────
// Save the file ID typed into the menu. Blank unlinks. driveSync adopts a freshly
// linked ID into the metadata file on the next sync (the linkNeedsMeta path).
function linkWikiFile() {
  const v = (document.getElementById('wikiFileIdInput').value || '').trim();
  data.wikiFileId = v || null;
  // Force a wiki reconcile next sync (so a newly linked file is downloaded/adopted).
  if (v) localStorage.removeItem(wmKey('wiki', 'r'));
  saveData(data, false); // a link change rides in the metadata file, not the main store
  showToast(v ? 'Wiki file linked — tap Sync Now' : 'Wiki file unlinked');
}

// Create a brand-new wiki file from the current local wiki data and link it.
async function createWikiFile() {
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  const metaFileId = localStorage.getItem(DRIVE_FILE_KEY);
  if (!clientId || !metaFileId) { showToast('Connect to Drive first'); return; }
  if (data.wikiFileId && !confirm('A wiki file is already linked. Create a new one and replace the link?')) return;
  setDriveStatus('Creating wiki file…');
  try {
    const token = await getAccessToken(clientId);
    const pubVer = Date.now();
    wikiData._updatedAt = pubVer;
    const id = await uploadDataFile(token, null, wikiData, WIKI_FILENAME, null);
    data.wikiFileId = id;
    data.wikiUpdatedAt = pubVer;
    localStorage.setItem(WIKI_KEY, JSON.stringify(wikiData));
    // Record the new wiki file in the metadata file.
    const meta = normalizeMeta(await downloadFromDrive(token, metaFileId));
    meta.wikiFileId = id; meta.wikiUpdatedAt = pubVer;
    meta._meta = 1; meta._metaTs = Date.now();
    await uploadFileToDrive(token, metaFileId, meta, META_FILENAME, null);
    setWm('wiki', pubVer, pubVer);
    saveData(data, false);
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
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  const metaFileId = localStorage.getItem(DRIVE_FILE_KEY);
  if (!clientId || !metaFileId) { showToast('Not connected to Drive'); return; }
  if (syncInFlight) { showToast('Sync already in progress'); return; }
  syncInFlight = true;
  const btn = document.getElementById('forceWikiSyncBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  setDriveStatus('Authenticating…');
  try {
    const token = await getAccessToken(clientId);
    const meta = normalizeMeta(await downloadFromDrive(token, metaFileId));
    const wikiFileId = meta.wikiFileId || data.wikiFileId;
    if (!wikiFileId) { showToast('No wiki file linked — enter a file ID first'); return; }
    setDriveStatus('Downloading wiki…');
    const remoteWiki = await downloadDataFile(token, wikiFileId);
    setDriveStatus('Merging wiki…');
    const mergedWiki = mergeWikiData(wikiData, remoteWiki);
    const deletedSet = new Set(data._deletedIds || []);
    mergedWiki.recipes = mergedWiki.recipes.filter(r => !deletedSet.has(r.id));
    mergedWiki.shoppingLists = mergedWiki.shoppingLists.filter(r => !deletedSet.has(r.id));
    mergedWiki.resumes = mergedWiki.resumes.filter(r => !deletedSet.has(r.id));
    setDriveStatus('Uploading wiki…');
    const pubVer = Date.now();
    mergedWiki._updatedAt = pubVer;
    await uploadDataFile(token, wikiFileId, mergedWiki, WIKI_FILENAME, null);
    meta.wikiFileId = wikiFileId; meta.wikiUpdatedAt = pubVer;
    meta._meta = 1; meta._metaTs = Date.now();
    await uploadFileToDrive(token, metaFileId, meta, META_FILENAME, null);
    wikiData = mergedWiki;
    data.wikiFileId = wikiFileId;
    data.wikiUpdatedAt = pubVer;
    setWm('wiki', pubVer, pubVer);
    saveData(data, false);
    try { localStorage.setItem(WIKI_KEY, JSON.stringify(wikiData)); }
    catch (e) { if (typeof showToast === 'function') showToast('⚠️ Storage full — wiki not saved locally', 8000); }
    renderAll();
    setDriveStatus('Wiki sync complete ✓');
    showToast(`Wiki synced — ${mergedWiki.recipes.length + mergedWiki.shoppingLists.length + mergedWiki.resumes.length} items`);
  } catch (err) {
    setDriveStatus('Error: ' + err.message);
    showToast('Wiki sync failed — ' + err.message, 8000);
  } finally {
    syncInFlight = false;
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Sync wiki'; }
  }
}

// Core multipart upload. fileBlob is the already-encoded file body (plain JSON for
// metadata/AI files, gzip for bulk data files). Returns the Drive file ID.
async function uploadBlobToDrive(token, fileId, fileBlob, filename, mimeType, storageKey) {
  const metadata = { name: filename, mimeType };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', fileBlob);
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

// Plain-JSON upload — used for the metadata file and the AI summary/report files
// (finance-ai.js). Kept uncompressed so they stay small and human-readable.
async function uploadFileToDrive(token, fileId, payload, filename, storageKey) {
  return uploadBlobToDrive(token, fileId, new Blob([JSON.stringify(payload)], { type: 'application/json' }),
    filename, 'application/json', storageKey);
}

// gzipped upload — used for the three bulk data files (main / history / wiki).
async function uploadDataFile(token, fileId, payload, filename, storageKey) {
  const blob = await gzipString(JSON.stringify(payload));
  return uploadBlobToDrive(token, fileId, blob, filename, blob.type || 'application/gzip', storageKey);
}

// Plain-JSON download — metadata file + AI report file (finance-ai.js).
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

// Find a Drive file by exact name (first match). Returns its id, or null.
async function findDriveFileByName(token, name) {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?spaces=drive&fields=files(id,name)&q=${q}`;
  let resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (resp.status === 401) {
    driveToken = null;
    const freshToken = await getAccessToken(localStorage.getItem(DRIVE_CLIENT_KEY));
    resp = await fetch(url, { headers: { Authorization: 'Bearer ' + freshToken } });
  }
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const json = await resp.json();
  return (json.files && json.files[0]) ? json.files[0].id : null;
}

// MOE Bridge ingest: read the Android app's incoming file and merge any NEW captured
// items into data.moeInbox (id ∉ moeInboxSeenIds). Deleted items never return because
// their id stays in moeInboxSeenIds (tombstone). Bumps the main store so freshly
// ingested items get uploaded/propagated to other PWA devices in the same sync.
// Returns the number of items added.
async function fetchMoeInbox(token) {
  const fileId = await findDriveFileByName(token, MOE_INBOX_FILENAME);
  if (!fileId) return 0;
  const payload = await downloadFromDrive(token, fileId);
  const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
  if (!items.length) return 0;
  if (!data.moeInbox) data.moeInbox = [];
  if (!data.moeInboxSeenIds) data.moeInboxSeenIds = [];
  const seen = new Set(data.moeInboxSeenIds);
  let added = 0;
  items.forEach(it => {
    if (!it || !it.id || seen.has(it.id)) return;
    data.moeInbox.push({
      id: it.id,
      capturedAt: it.capturedAt || Date.now(),
      pkg: it.pkg || '',
      screen: it.screen || '',
      title: it.title || '',
      text: it.text || '',
      _ingestedAt: Date.now(),
    });
    data.moeInboxSeenIds.push(it.id);
    seen.add(it.id);
    added++;
  });
  if (added) {
    data.moeInbox.sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
    saveData(data); // bump=true → main store marked dirty so new items propagate
  }
  return added;
}

// gzip-or-plain download for bulk data files (transparent magic-byte fallback).
async function downloadDataFile(token, fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  let resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (resp.status === 401) {
    driveToken = null;
    const freshToken = await getAccessToken(localStorage.getItem(DRIVE_CLIENT_KEY));
    resp = await fetch(url, { headers: { Authorization: 'Bearer ' + freshToken } });
  }
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return JSON.parse(await gunzipBlobToText(await resp.blob()));
}

