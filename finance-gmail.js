// ── Gmail Import ──────────────────────────────────────────────────────────────
const GMAIL_PARSERS_KEY = 'finance:emailParsers';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

let gmailToken = null;
let gmailLabelDoneId = null;
let gmailReviewItems = [];

// ── Parser Storage ────────────────────────────────────────────────────────────

function loadEmailParsers() {
  try {
    const raw = localStorage.getItem(GMAIL_PARSERS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveEmailParsers(config) {
  localStorage.setItem(GMAIL_PARSERS_KEY, JSON.stringify(config));
  data.emailParsers = config;
  data._emailParsersTs = Date.now();
  saveData(data);
}

// ── Parser Engine ─────────────────────────────────────────────────────────────

const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

function parseDateStr(str, format) {
  const pad = n => String(n).padStart(2, '0');
  const year = new Date().getFullYear();
  if (format === 'DD/MM/YY') {
    const [d, m, y] = str.split('/');
    return `20${y}-${pad(+m)}-${pad(+d)}`;
  }
  if (format === 'DD-Mon-YY') {
    const [d, mon, y] = str.split('-');
    const m = MONTH_MAP[mon.toLowerCase().slice(0, 3)];
    return m ? `20${y}-${pad(m)}-${pad(+d)}` : null;
  }
  if (format === 'D Mon') {
    const parts = str.trim().split(/\s+/);
    const m = MONTH_MAP[parts[1].toLowerCase().slice(0, 3)];
    return m ? `${year}-${pad(m)}-${pad(+parts[0])}` : null;
  }
  return null;
}

function resolveCategory(desc, catMap, catDefault) {
  const upper = (desc || '').toUpperCase();
  for (const rule of (catMap || [])) {
    if (new RegExp(rule.match, 'i').test(upper)) return rule.value;
  }
  return catDefault || 'Other';
}

function applyParser(parser, body, catMap, catDefault) {
  function extract(field) {
    if (!field) return null;
    const m = new RegExp(field.regex, 'im').exec(body);
    return m ? m[field.group || 1].trim() : null;
  }
  const amountRaw = extract(parser.amount);
  const dateRaw   = extract(parser.date);
  const descRaw   = extract(parser.desc);
  if (!amountRaw || !dateRaw || !descRaw) return null;
  const amount = parseFloat(amountRaw.replace(/,/g, ''));
  if (isNaN(amount) || amount <= 0) return null;
  const date = parseDateStr(dateRaw, parser.date.format);
  if (!date) return null;
  const cat = resolveCategory(descRaw, catMap, catDefault);
  return { amount, date, desc: descRaw, cat };
}

function findParser(subject, parsers) {
  const s = subject.toLowerCase();
  return parsers.find(p => s.includes(p.subjectContains.toLowerCase())) || null;
}

// ── Gmail OAuth ───────────────────────────────────────────────────────────────

async function getGmailToken() {
  if (gmailToken && gmailToken.expiry > Date.now()) return gmailToken.token;
  const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
  if (!clientId) throw new Error('Configure Google Client ID in Drive settings first.');
  await ensureGsiLoaded();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,
      callback: resp => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        gmailToken = { token: resp.access_token, expiry: Date.now() + (resp.expires_in - 30) * 1000 };
        resolve(resp.access_token);
      }
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
}

// ── Gmail API ─────────────────────────────────────────────────────────────────

async function gmailApi(token, path, opts = {}) {
  const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  if (!resp.ok) throw new Error('Gmail API error ' + resp.status);
  return resp.json();
}

async function fetchUnreadMessages(token, parsers) {
  const subjects = parsers.map(p => `subject:"${p.subjectContains}"`).join(' OR ');
  const q = encodeURIComponent(`is:unread (${subjects})`);
  const res = await gmailApi(token, `/messages?q=${q}&maxResults=50`);
  return res.messages || [];
}

async function getMessage(token, id) {
  return gmailApi(token, `/messages/${id}?format=full`);
}

function decodeBase64Url(s) {
  return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
}

function extractTextBody(msg) {
  function findData(parts, mime) {
    for (const p of parts || []) {
      if (p.mimeType === mime && p.body && p.body.data) return p.body.data;
      const found = findData(p.parts, mime);
      if (found) return found;
    }
    return null;
  }
  const pl = msg.payload || {};
  const raw = findData(pl.parts, 'text/plain')
    || (pl.mimeType === 'text/plain' && pl.body && pl.body.data ? pl.body.data : null)
    || findData(pl.parts, 'text/html')
    || (pl.mimeType === 'text/html' && pl.body && pl.body.data ? pl.body.data : null);
  if (!raw) return '';
  const text = decodeBase64Url(raw);
  return text.includes('<')
    ? text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    : text;
}

function extractHeader(msg, name) {
  const h = (msg.payload && msg.payload.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

async function getLabelDoneId(token) {
  if (gmailLabelDoneId) return gmailLabelDoneId;
  const res = await gmailApi(token, '/labels');
  const lbl = (res.labels || []).find(l => l.name === 'Expense-Done');
  if (!lbl) throw new Error('Label "Expense-Done" not found. Create it in Gmail first.');
  gmailLabelDoneId = lbl.id;
  return gmailLabelDoneId;
}

async function markDone(token, msgId, labelId) {
  await gmailApi(token, `/messages/${msgId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: [labelId], removeLabelIds: ['UNREAD'] })
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openGmailModal() {
  document.getElementById('mainMenu').classList.remove('open');
  setGmailStatus('');
  const config = loadEmailParsers();
  const hasConfig = !!(config && config.parsers && config.parsers.length);
  document.getElementById('gmailSetupSection').style.display = hasConfig ? 'none' : '';
  document.getElementById('gmailReadySection').style.display = hasConfig ? '' : 'none';
  document.getElementById('gmailReviewSection').style.display = 'none';
  if (hasConfig) {
    document.getElementById('gmailParserInfo').textContent =
      `${config.parsers.length} parser(s): ${config.parsers.map(p => p.name).join(', ')}`;
  }
  document.getElementById('gmailOverlay').classList.add('open');
}

function closeGmailModal() {
  document.getElementById('gmailOverlay').classList.remove('open');
}

document.getElementById('gmailOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('gmailOverlay')) closeGmailModal();
});

function setGmailStatus(msg) {
  document.getElementById('gmailStatus').textContent = msg;
}

// ── Parser Config Import / Export ─────────────────────────────────────────────

function triggerImportParsers() {
  document.getElementById('importParsersFile').click();
}

function exportParsers() {
  const config = loadEmailParsers();
  if (!config) { showToast('No parser config to export'); return; }
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'email-parsers.json';
  a.click();
}

document.getElementById('importParsersFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const config = JSON.parse(ev.target.result);
      if (!Array.isArray(config.parsers)) throw new Error('Missing parsers array');
      saveEmailParsers(config);
      showToast(`Loaded ${config.parsers.length} parser(s)`);
      openGmailModal();
    } catch (err) {
      showToast('Invalid parser config: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Fetch & Parse ─────────────────────────────────────────────────────────────

async function startGmailFetch() {
  const config = loadEmailParsers();
  if (!config) { showToast('No parsers configured'); return; }
  document.getElementById('gmailReadySection').style.display = 'none';
  document.getElementById('gmailReviewSection').style.display = 'none';
  setGmailStatus('Authenticating…');
  try {
    const token = await getGmailToken();
    setGmailStatus('Fetching unread emails…');
    const messages = await fetchUnreadMessages(token, config.parsers);
    if (!messages.length) {
      setGmailStatus('No unread emails from known senders.');
      document.getElementById('gmailReadySection').style.display = '';
      return;
    }
    setGmailStatus(`Parsing ${messages.length} email(s)…`);
    gmailReviewItems = [];
    for (const { id } of messages) {
      const msg = await getMessage(token, id);
      const sender  = extractHeader(msg, 'from');
      const subject = extractHeader(msg, 'subject');
      const body    = extractTextBody(msg);
      const parser  = findParser(subject, config.parsers);
      if (!parser) continue;
      const parsed = applyParser(parser, body, config.catMap, config.catDefault);
      if (parsed) {
        gmailReviewItems.push({ msgId: id, sender, subject, expId: 'gm' + id.slice(-10), parsed, checked: true });
      }
    }
    setGmailStatus('');
    if (!gmailReviewItems.length) {
      setGmailStatus('Could not parse any emails. Check your parser config.');
      document.getElementById('gmailReadySection').style.display = '';
      return;
    }
    renderGmailReview();
  } catch (err) {
    setGmailStatus('Error: ' + err.message);
    document.getElementById('gmailReadySection').style.display = '';
  }
}

// ── Review UI ─────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderGmailReview() {
  const checkedCount = gmailReviewItems.filter(i => i.checked).length;
  document.getElementById('gmailReviewList').innerHTML = gmailReviewItems.map((item, idx) => `
    <div class="gmail-review-item${item.checked ? '' : ' unchecked'}" onclick="toggleGmailItem(${idx})">
      <input type="checkbox" class="gmail-checkbox" ${item.checked ? 'checked' : ''}
             onclick="event.stopPropagation();toggleGmailItem(${idx})">
      <div class="gmail-review-body">
        <div class="gmail-review-desc">${escHtml(item.parsed.desc)}</div>
        <div class="gmail-review-meta">
          <span class="cat-chip">${escHtml(item.parsed.cat)}</span>
          <span class="gmail-review-date">${escHtml(item.parsed.date)}</span>
          <span class="expense-amount">$${item.parsed.amount.toFixed(2)}</span>
        </div>
        <div class="gmail-review-subject">${escHtml(item.subject)}</div>
      </div>
    </div>
  `).join('');
  document.getElementById('gmailCommitBtn').textContent =
    `Commit ${checkedCount} expense${checkedCount !== 1 ? 's' : ''}`;
  document.getElementById('gmailReviewSection').style.display = '';
}

function toggleGmailItem(idx) {
  gmailReviewItems[idx].checked = !gmailReviewItems[idx].checked;
  renderGmailReview();
}

// ── Commit ────────────────────────────────────────────────────────────────────

async function commitGmailImport() {
  if (!gmailToken || gmailToken.expiry <= Date.now()) { showToast('Session expired — re-fetch'); return; }
  const token = gmailToken.token;
  const btn = document.getElementById('gmailCommitBtn');
  btn.disabled = true;
  setGmailStatus('Applying labels…');
  try {
    const labelId = await getLabelDoneId(token);
    for (const item of gmailReviewItems) {
      try { await markDone(token, item.msgId, labelId); } catch {}
    }
    const curYear = String(new Date().getFullYear());
    let added = 0;
    gmailReviewItems.filter(i => i.checked).forEach(item => {
      const expense = {
        id: item.expId, ac: 'acc1',
        date: item.parsed.date, desc: item.parsed.desc,
        amount: item.parsed.amount, cat: item.parsed.cat,
        _ts: Date.now()
      };
      const store = expense.date.startsWith(curYear + '-') ? data.expenses : historyData.expenses;
      const idx = store.findIndex(x => x.id === expense.id);
      if (idx >= 0) {
        if (expense._ts > (store[idx]._ts || 0)) store[idx] = expense;
      } else {
        store.push(expense); added++;
      }
    });
    recalcBalances(data, allExpenses());
    recalcMonthlyAgg(data, allExpenses());
    saveData(data);
    saveHistory(historyData);
    renderAll();
    closeGmailModal();
    showToast(`Added ${added} expense${added !== 1 ? 's' : ''} from Gmail`);
    gmailReviewItems = [];
  } catch (err) {
    setGmailStatus('Error: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}
