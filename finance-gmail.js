// ── Gmail Import ──────────────────────────────────────────────────────────────
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

let gmailToken = null;
let gmailLabelDoneId = null;
let gmailReviewItems = [];

// ── Parser Storage ────────────────────────────────────────────────────────────

function loadGmailParsers() {
  return (data.emailParsers && data.emailParsers.parsers) ? data.emailParsers.parsers : [];
}

function saveGmailParsers(parsers) {
  if (!data.emailParsers) data.emailParsers = {};
  data.emailParsers.parsers = parsers;
  data._emailParsersTs = Date.now();
  saveData(data);
}

function loadGmailEventParsers() {
  return data.emailEventParsers || [];
}

function saveGmailEventParsers(parsers) {
  data.emailEventParsers = parsers;
  data._emailEventParsersTs = Date.now();
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
  if (format === 'Mon D YYYY') {
    const parts = str.trim().split(/\s+/);
    const m = MONTH_MAP[parts[0].toLowerCase().slice(0, 3)];
    return m ? `${parts[2]}-${pad(m)}-${pad(+parts[1])}` : null;
  }
  if (format === 'D Mon YYYY') {
    const parts = str.trim().split(/\s+/);
    const m = MONTH_MAP[parts[1].toLowerCase().slice(0, 3)];
    return m ? `${parts[2]}-${pad(m)}-${pad(+parts[0])}` : null;
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

function applyParser(parser, body, catMap, catDefault, emailTimestamp) {
  function extract(field) {
    if (!field) return null;
    const m = new RegExp(field.regex, 'im').exec(body);
    return m ? m[field.group || 1].trim() : null;
  }
  const amountRaw = extract(parser.amount);
  const descRaw   = extract(parser.desc);
  if (!amountRaw || !descRaw) return null;
  const amount = parseFloat(amountRaw.replace(/,/g, ''));
  if (isNaN(amount) || amount <= 0) return null;
  const dateRaw = extract(parser.date);
  let date = dateRaw ? parseDateStr(dateRaw, parser.date.format) : null;
  if (!date && emailTimestamp) {
    const d = new Date(+emailTimestamp);
    const pad = n => String(n).padStart(2, '0');
    date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (!date) return null;
  const cat = resolveCategory(descRaw, catMap, catDefault);
  const letters = descRaw.replace(/[^a-zA-Z]/g, '');
  const desc = letters.length > 0 && letters === letters.toUpperCase()
    ? descRaw.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase())
    : descRaw;
  return { amount, date, desc, cat };
}

function applyEventParser(parser, body, emailTimestamp) {
  function extract(field) {
    if (!field || !field.regex) return null;
    const m = new RegExp(field.regex, 'im').exec(body);
    return m ? m[field.group || 1].trim() : null;
  }
  const titleRaw = extract(parser.title);
  if (!titleRaw) return null;
  const dateRaw = extract(parser.date);
  let date = dateRaw ? parseDateStr(dateRaw, parser.date && parser.date.format) : null;
  if (!date && emailTimestamp) {
    const d = new Date(+emailTimestamp);
    const pad = n => String(n).padStart(2, '0');
    date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (!date) return null;
  const timeRaw = parser.time && parser.time.regex ? extract(parser.time) : null;
  let hour = 0, minute = 0, ampm = 'am';
  if (timeRaw) {
    const t = timeRaw.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (t) {
      hour = parseInt(t[1]);
      minute = parseInt(t[2]);
      ampm = t[3] ? t[3].toLowerCase() : (hour >= 12 ? 'pm' : 'am');
      if (ampm === 'am' && hour === 12) hour = 0;
      if (ampm === 'pm' && hour !== 12) hour -= 12;
    }
  }
  const tags = Array.isArray(parser.tags) ? parser.tags : [];
  return { title: titleRaw, date, hour, minute, ampm, tags };
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
    client.requestAccessToken({ prompt: '' });
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
  const parsers = loadGmailParsers();
  const hasConfig = parsers.length > 0;
  document.getElementById('gmailSetupSection').style.display = hasConfig ? 'none' : '';
  document.getElementById('gmailReadySection').style.display = hasConfig ? '' : 'none';
  document.getElementById('gmailReviewSection').style.display = 'none';
  if (hasConfig) {
    document.getElementById('gmailParserInfo').textContent =
      `${parsers.length} parser(s): ${parsers.map(p => p.name).join(', ')}`;
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
  const parsers = loadGmailParsers();
  if (!parsers.length) { showToast('No parser config to export'); return; }
  const config = {
    parsers,
    catMap: data.emailCatMap || [],
    catDefault: data.emailCatDefault || 'Other'
  };
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
      const raw = JSON.parse(ev.target.result);
      // Accept either a bare array of parsers or the full { parsers, catMap, catDefault } shape
      const config = Array.isArray(raw) ? { parsers: raw } : raw;
      if (!Array.isArray(config.parsers)) throw new Error('Missing parsers array');
      const existing = loadGmailParsers();
      const incoming = config.parsers;
      // Merge: incoming parser wins if same name exists, otherwise append
      const merged = [...existing];
      incoming.forEach(p => {
        const idx = merged.findIndex(x => x.name === p.name);
        if (idx >= 0) merged[idx] = p; else merged.push(p);
      });
      saveGmailParsers(merged);
      if (Array.isArray(config.catMap)) {
        data.emailCatMap = config.catMap;
        data.emailCatDefault = config.catDefault || 'Other';
        data._emailCatMapTs = Date.now();
        saveData(data);
      }
      const added = incoming.filter(p => !existing.find(x => x.name === p.name)).length;
      const updated = incoming.length - added;
      showToast(`${added} added, ${updated} updated (${merged.length} total)`);
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
  const parsers = loadGmailParsers();
  const eventParsers = loadGmailEventParsers();
  const allParsers = [...parsers, ...eventParsers];
  if (!allParsers.length) { openGmailModal(); return; }
  document.getElementById('gmailOverlay').classList.add('open');
  document.getElementById('gmailReadySection').style.display = 'none';
  document.getElementById('gmailReviewSection').style.display = 'none';
  setGmailStatus('Authenticating…');
  try {
    const token = await getGmailToken();
    setGmailStatus('Fetching unread emails…');
    const messages = await fetchUnreadMessages(token, allParsers);
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
      const expParser = findParser(subject, parsers);
      if (expParser) {
        const parsed = applyParser(expParser, body, data.emailCatMap, data.emailCatDefault, msg.internalDate);
        if (parsed) {
          gmailReviewItems.push({ type: 'expense', msgId: id, sender, subject, expId: 'gm' + id.slice(-10), parsed, checked: true });
        }
      }
      const evParser = findParser(subject, eventParsers);
      if (evParser) {
        const parsed = applyEventParser(evParser, body, msg.internalDate);
        if (parsed) {
          gmailReviewItems.push({ type: 'event', msgId: id, sender, subject, evId: 'gme' + id.slice(-10), parsed, checked: true });
        }
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
  const expCount = gmailReviewItems.filter(i => i.checked && i.type !== 'event').length;
  const evCount  = gmailReviewItems.filter(i => i.checked && i.type === 'event').length;
  document.getElementById('gmailReviewList').innerHTML = gmailReviewItems.map((item, idx) => {
    if (item.type === 'event') {
      const p = item.parsed;
      const timeStr = p.hour || p.minute ? ` ${p.hour}:${String(p.minute).padStart(2,'0')} ${p.ampm}` : '';
      const tagsStr = p.tags && p.tags.length ? p.tags.join(', ') : '';
      return `
    <div class="gmail-review-item${item.checked ? '' : ' unchecked'}" onclick="toggleGmailItem(${idx})">
      <input type="checkbox" class="gmail-checkbox" ${item.checked ? 'checked' : ''}
             onclick="event.stopPropagation();toggleGmailItem(${idx})">
      <div class="gmail-review-body">
        <div class="gmail-review-desc">${escHtml(p.title)}</div>
        <div class="gmail-review-meta">
          <span class="cat-chip" style="background:var(--accent-muted,#e8f4e8);color:var(--accent,#2e7d32)">event</span>
          <span class="gmail-review-date">${escHtml(p.date)}${escHtml(timeStr)}</span>
          ${tagsStr ? `<span style="font-size:.75rem;color:var(--muted)">${escHtml(tagsStr)}</span>` : ''}
        </div>
        <div class="gmail-review-subject">${escHtml(item.subject)}</div>
      </div>
    </div>`;
    }
    return `
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
    </div>`;
  }).join('');
  const parts = [];
  if (expCount) parts.push(`${expCount} expense${expCount !== 1 ? 's' : ''}`);
  if (evCount)  parts.push(`${evCount} event${evCount !== 1 ? 's' : ''}`);
  document.getElementById('gmailCommitBtn').textContent = parts.length ? `Commit ${parts.join(' + ')}` : `Commit ${checkedCount} item${checkedCount !== 1 ? 's' : ''}`;
  document.getElementById('gmailReviewSection').style.display = '';
}

function toggleGmailItem(idx) {
  gmailReviewItems[idx].checked = !gmailReviewItems[idx].checked;
  renderGmailReview();
}

// ── Email Rules Subtab ────────────────────────────────────────────────────────

let editingParserIdx = -1;

function renderEmailRulesSubTab() {
  const parsers = loadGmailParsers();
  const eventParsers = loadGmailEventParsers();
  const el = document.getElementById('emailRulesContent');
  if (!el) return;
  if (!parsers.length && !eventParsers.length) {
    el.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined icon">mail</span><p>No email parsers configured.<br>Import a parser config via the Gmail import menu.</p></div>`;
    return;
  }

  function parserCard(p, i, type) {
    const editFn   = type === 'event' ? `openEventParserEditor(${i})` : `openParserEditor(${i})`;
    const deleteFn = type === 'event' ? `deleteEventParser(${i})` : `deleteParser(${i})`;
    const details  = type === 'event'
      ? `<div>Title: <code style="background:var(--bg);padding:1px 5px;border-radius:4px">${esc(p.title && p.title.regex || '')}</code> group ${esc(String(p.title && p.title.group != null ? p.title.group : 1))}</div>
         <div>Date: <code style="background:var(--bg);padding:1px 5px;border-radius:4px">${esc(p.date && p.date.regex || '')}</code> format <code style="background:var(--bg);padding:1px 5px;border-radius:4px">${esc(p.date && p.date.format || '')}</code></div>
         ${p.time && p.time.regex ? `<div>Time: <code style="background:var(--bg);padding:1px 5px;border-radius:4px">${esc(p.time.regex)}</code></div>` : ''}
         ${p.tags && p.tags.length ? `<div>Tags: ${esc(p.tags.join(', '))}</div>` : ''}`
      : `<div>Amount: <code style="background:var(--bg);padding:1px 5px;border-radius:4px">${esc(p.amount && p.amount.regex || '')}</code> group ${esc(String(p.amount && p.amount.group != null ? p.amount.group : 1))}</div>
         <div>Date: <code style="background:var(--bg);padding:1px 5px;border-radius:4px">${esc(p.date && p.date.regex || '')}</code> format <code style="background:var(--bg);padding:1px 5px;border-radius:4px">${esc(p.date && p.date.format || '')}</code></div>
         <div>Desc: <code style="background:var(--bg);padding:1px 5px;border-radius:4px">${esc(p.desc && p.desc.regex || '')}</code> group ${esc(String(p.desc && p.desc.group != null ? p.desc.group : 1))}</div>`;
    return `
    <div style="background:var(--card);border-radius:12px;padding:14px 16px;margin-bottom:10px;border:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-weight:600;font-size:.95rem">${esc(p.name || 'Parser ' + (i + 1))}</div>
        <div style="display:flex;gap:8px">
          <button class="btn" style="font-size:.78rem;padding:4px 10px" onclick="${editFn}">Edit</button>
          <button class="btn" style="font-size:.78rem;padding:4px 10px;color:var(--danger)" onclick="${deleteFn}">Delete</button>
        </div>
      </div>
      <div style="font-size:.8rem;color:var(--muted);margin-bottom:4px">Subject contains: <code style="background:var(--bg);padding:1px 5px;border-radius:4px">${esc(p.subjectContains || '')}</code></div>
      <div style="font-size:.78rem;color:var(--muted);display:grid;gap:2px;margin-top:6px">${details}</div>
    </div>`;
  }

  el.innerHTML = `
    <div class="section-heading" style="margin-top:4px">Expense Parsers</div>
    <div style="padding:4px 0 4px;display:flex;justify-content:flex-end">
      <button class="btn btn-primary" style="font-size:.82rem;padding:7px 14px" onclick="openParserEditor(-1)">+ Add</button>
    </div>
    ${parsers.length ? parsers.map((p, i) => parserCard(p, i, 'expense')).join('') : '<p style="font-size:.82rem;color:var(--muted);text-align:center;padding:8px 0">No expense parsers.</p>'}
    <div class="section-heading" style="margin-top:12px">Event Parsers</div>
    <div style="padding:4px 0 4px;display:flex;justify-content:flex-end">
      <button class="btn btn-primary" style="font-size:.82rem;padding:7px 14px" onclick="openEventParserEditor(-1)">+ Add</button>
    </div>
    ${eventParsers.length ? eventParsers.map((p, i) => parserCard(p, i, 'event')).join('') : '<p style="font-size:.82rem;color:var(--muted);text-align:center;padding:8px 0">No event parsers.</p>'}`;
}

function openParserEditor(idx) {
  editingParserIdx = idx;
  const parsers = loadGmailParsers();
  const p = idx >= 0 ? parsers[idx] : {
    name: '', subjectContains: '',
    amount: { regex: '', group: 1 },
    date:   { regex: '', format: 'DD/MM/YY' },
    desc:   { regex: '', group: 1 }
  };
  document.getElementById('parserEditorTitle').textContent = idx >= 0 ? 'Edit Parser' : 'Add Parser';
  document.getElementById('parserName').value         = p.name || '';
  document.getElementById('parserSubject').value      = p.subjectContains || '';
  document.getElementById('parserAmountRegex').value  = (p.amount && p.amount.regex) || '';
  document.getElementById('parserAmountGroup').value  = p.amount && p.amount.group != null ? p.amount.group : 1;
  document.getElementById('parserDateRegex').value    = (p.date && p.date.regex) || '';
  document.getElementById('parserDateFormat').value   = (p.date && p.date.format) || 'DD/MM/YY';
  document.getElementById('parserDescRegex').value    = (p.desc && p.desc.regex) || '';
  document.getElementById('parserDescGroup').value    = p.desc && p.desc.group != null ? p.desc.group : 1;
  openSheet('parserEditorSheet');
}

function saveParserEditor() {
  const p = {
    name:            document.getElementById('parserName').value.trim(),
    subjectContains: document.getElementById('parserSubject').value.trim(),
    amount: { regex: document.getElementById('parserAmountRegex').value.trim(), group: parseInt(document.getElementById('parserAmountGroup').value) || 1 },
    date:   { regex: document.getElementById('parserDateRegex').value.trim(),   format: document.getElementById('parserDateFormat').value.trim() },
    desc:   { regex: document.getElementById('parserDescRegex').value.trim(),   group: parseInt(document.getElementById('parserDescGroup').value) || 1 }
  };
  if (!p.name || !p.subjectContains) { showToast('Name and subject are required'); return; }
  const parsers = loadGmailParsers();
  if (editingParserIdx >= 0) parsers[editingParserIdx] = p;
  else parsers.push(p);
  saveGmailParsers(parsers);
  closeSheet();
  renderEmailRulesSubTab();
  showToast(editingParserIdx >= 0 ? 'Parser updated' : 'Parser added');
}

function deleteParser(idx) {
  if (!confirm('Delete this parser?')) return;
  const parsers = loadGmailParsers();
  parsers.splice(idx, 1);
  saveGmailParsers(parsers);
  renderEmailRulesSubTab();
  showToast('Parser deleted');
}

// ── Event Parser Editor ───────────────────────────────────────────────────────

let editingEventParserIdx = -1;

function openEventParserEditor(idx) {
  editingEventParserIdx = idx;
  const parsers = loadGmailEventParsers();
  const p = idx >= 0 ? parsers[idx] : {
    name: '', subjectContains: '',
    title: { regex: '', group: 1 },
    date:  { regex: '', format: 'DD/MM/YY' },
    time:  { regex: '' },
    tags:  []
  };
  document.getElementById('evParserEditorTitle').textContent = idx >= 0 ? 'Edit Event Parser' : 'Add Event Parser';
  document.getElementById('evParserName').value        = p.name || '';
  document.getElementById('evParserSubject').value     = p.subjectContains || '';
  document.getElementById('evParserTitleRegex').value  = (p.title && p.title.regex) || '';
  document.getElementById('evParserTitleGroup').value  = p.title && p.title.group != null ? p.title.group : 1;
  document.getElementById('evParserDateRegex').value   = (p.date && p.date.regex) || '';
  document.getElementById('evParserDateFormat').value  = (p.date && p.date.format) || 'DD/MM/YY';
  document.getElementById('evParserTimeRegex').value   = (p.time && p.time.regex) || '';
  document.getElementById('evParserTags').value        = Array.isArray(p.tags) ? p.tags.join(', ') : '';
  openSheet('evParserEditorSheet');
}

function saveEventParserEditor() {
  const tagsRaw = document.getElementById('evParserTags').value.trim();
  const p = {
    name:            document.getElementById('evParserName').value.trim(),
    subjectContains: document.getElementById('evParserSubject').value.trim(),
    title: { regex: document.getElementById('evParserTitleRegex').value.trim(), group: parseInt(document.getElementById('evParserTitleGroup').value) || 1 },
    date:  { regex: document.getElementById('evParserDateRegex').value.trim(),  format: document.getElementById('evParserDateFormat').value.trim() },
    time:  { regex: document.getElementById('evParserTimeRegex').value.trim() },
    tags:  tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : []
  };
  if (!p.name || !p.subjectContains) { showToast('Name and subject are required'); return; }
  if (!p.title.regex) { showToast('Title regex is required'); return; }
  const parsers = loadGmailEventParsers();
  if (editingEventParserIdx >= 0) parsers[editingEventParserIdx] = p;
  else parsers.push(p);
  saveGmailEventParsers(parsers);
  closeSheet();
  renderEmailRulesSubTab();
  showToast(editingEventParserIdx >= 0 ? 'Event parser updated' : 'Event parser added');
}

function deleteEventParser(idx) {
  if (!confirm('Delete this event parser?')) return;
  const parsers = loadGmailEventParsers();
  parsers.splice(idx, 1);
  saveGmailEventParsers(parsers);
  renderEmailRulesSubTab();
  showToast('Event parser deleted');
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
    let addedExp = 0, addedEv = 0;
    gmailReviewItems.filter(i => i.checked).forEach(item => {
      if (item.type === 'event') {
        const p = item.parsed;
        const ev = {
          id: item.evId,
          title: p.title,
          description: '',
          startDate: p.date,
          startTime: { hour: p.hour, minute: p.minute, ampm: p.ampm },
          endDate: null,
          endTime: { hour: p.hour, minute: p.minute, ampm: p.ampm },
          tags: p.tags || [],
          reminderHours: 0,
          _ts: Date.now()
        };
        if (!data.events) data.events = [];
        const idx = data.events.findIndex(x => x.id === ev.id);
        if (idx >= 0) {
          if (ev._ts > (data.events[idx]._ts || 0)) data.events[idx] = ev;
        } else {
          data.events.push(ev); addedEv++;
        }
      } else {
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
          store.push(expense); addedExp++;
        }
      }
    });
    recalcBalances(data, allExpenses());
    recalcMonthlyAgg(data, allExpenses());
    saveData(data);
    saveHistory(historyData);
    renderAll();
    closeGmailModal();
    const parts = [];
    if (addedExp) parts.push(`${addedExp} expense${addedExp !== 1 ? 's' : ''}`);
    if (addedEv)  parts.push(`${addedEv} event${addedEv !== 1 ? 's' : ''}`);
    showToast(`Added ${parts.join(' + ') || '0 items'} from Gmail`);
    gmailReviewItems = [];
  } catch (err) {
    setGmailStatus('Error: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

