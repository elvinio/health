// ── Finance Gmail Sync ────────────────────────────────────────────────────────
//
// Google Apps Script that reads Gmail expense emails and writes parsed expenses
// into finance-elvis.json on Drive — the same file the Finance PWA syncs with.
//
// SETUP (one-time):
//   1. Go to https://script.google.com and create a new project.
//   2. Paste this entire file into the editor (replace the default code).
//   3. Run setupTrigger() once — it will ask you to authorise Gmail + Drive access.
//   4. After authorising, the script runs automatically every hour.
//   5. In the PWA, do a Drive sync to pick up new expenses.
//
// CONFIGURATION:
//   The script reads your parser config (emailParsers, emailCatMap, emailCatDefault)
//   directly from finance-elvis.json, so no separate config is needed here.
//   Manage parsers in the PWA as usual — the script always uses the latest version.
//
// LOGGING:
//   View → Logs (or Executions) in the Apps Script editor to see what was processed.

const DRIVE_FILENAME         = 'finance-elvis.json';
const DRIVE_HISTORY_FILENAME = 'finance-elvis-history.json';
const LABEL_DONE             = 'Expense-Done';
const DEFAULT_ACCOUNT        = 'acc1';
const MAX_EMAILS             = 50;

// ── Entry Point ───────────────────────────────────────────────────────────────

function syncGmailExpenses() {
  const { file: mainFile, data } = loadDriveJson(DRIVE_FILENAME);
  if (!mainFile) { Logger.log('finance-elvis.json not found on Drive. Exiting.'); return; }

  const parsers = (data.emailParsers && data.emailParsers.parsers) ? data.emailParsers.parsers : [];
  if (!parsers.length) { Logger.log('No email parsers configured in finance-elvis.json. Exiting.'); return; }

  const catMap     = data.emailCatMap     || [];
  const catDefault = data.emailCatDefault || 'Other';

  const { file: histFile, data: histData } = loadDriveJson(DRIVE_HISTORY_FILENAME);

  const labelDone = getOrCreateLabel(LABEL_DONE);
  const subjects  = parsers.map(p => `subject:"${p.subjectContains}"`).join(' OR ');
  const threads   = GmailApp.search(`is:unread (${subjects})`, 0, MAX_EMAILS);

  let added   = 0;
  const curYear = String(new Date().getFullYear());

  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      if (!msg.isUnread()) continue;

      const subject = msg.getSubject();
      const parser  = findParser(subject, parsers);
      if (!parser) continue;

      const body      = getMessageBody(msg);
      const timestamp = msg.getDate().getTime();
      const parsed    = applyParser(parser, body, catMap, catDefault, timestamp);

      if (!parsed) {
        Logger.log(`Could not parse: "${subject}"`);
        continue;
      }

      const expId  = 'gm' + msg.getId().slice(-10);
      const expense = {
        id: expId, ac: DEFAULT_ACCOUNT,
        date: parsed.date, desc: parsed.desc,
        amount: parsed.amount, cat: parsed.cat,
        _ts: Date.now()
      };

      const store = expense.date.startsWith(curYear + '-') ? data.expenses : histData.expenses;
      const idx   = store.findIndex(x => x.id === expense.id);
      if (idx >= 0) {
        if (expense._ts > (store[idx]._ts || 0)) store[idx] = expense;
      } else {
        store.push(expense);
        added++;
        Logger.log(`Added: ${parsed.desc}  $${parsed.amount.toFixed(2)}  ${parsed.date}  [${parsed.cat}]`);
      }

      msg.markRead();
      thread.addLabel(labelDone);
    }
  }

  if (added > 0) {
    recalcBalances(data, [...histData.expenses, ...data.expenses]);
    recalcMonthlyAgg(data, [...histData.expenses, ...data.expenses]);
    saveDriveJson(mainFile, data);
    histData._updatedAt     = Date.now();
    data.historyUpdatedAt   = histData._updatedAt;
    saveDriveJson(histFile, histData);
    Logger.log(`Done — added ${added} expense(s). Sync the PWA to see them.`);
  } else {
    Logger.log('No new expenses found.');
  }
}

// ── Trigger Setup ─────────────────────────────────────────────────────────────

// Run this once manually to create an hourly trigger.
function setupTrigger() {
  // Remove any existing triggers for this function to avoid duplicates.
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncGmailExpenses')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncGmailExpenses')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('Hourly trigger created. syncGmailExpenses will run every hour.');
}

// ── Drive Helpers ─────────────────────────────────────────────────────────────

function loadDriveJson(filename) {
  const files = DriveApp.getFilesByName(filename);
  if (!files.hasNext()) return { file: null, data: { expenses: [] } };
  const file    = files.next();
  const content = file.getBlob().getDataAsString();
  return { file, data: JSON.parse(content) };
}

function saveDriveJson(file, data) {
  if (!file) return;
  file.setContent(JSON.stringify(data));
}

// ── Gmail Helpers ─────────────────────────────────────────────────────────────

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function getMessageBody(msg) {
  const plain = msg.getPlainBody();
  if (plain && plain.trim()) return plain;
  return msg.getBody()
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Parser Engine (mirrors finance-gmail.js) ──────────────────────────────────

const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

function parseDateStr(str, format) {
  const pad  = n => String(n).padStart(2, '0');
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
    const d = new Date(emailTimestamp);
    const pad = n => String(n).padStart(2, '0');
    date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (!date) return null;
  const cat     = resolveCategory(descRaw, catMap, catDefault);
  const letters = descRaw.replace(/[^a-zA-Z]/g, '');
  const desc    = letters.length > 0 && letters === letters.toUpperCase()
    ? descRaw.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase())
    : descRaw;
  return { amount, date, desc, cat };
}

function findParser(subject, parsers) {
  const s = subject.toLowerCase();
  return parsers.find(p => s.includes(p.subjectContains.toLowerCase())) || null;
}

// ── Recalc (mirrors finance-core.js) ─────────────────────────────────────────

function recalcBalances(d, expenses) {
  (d.accounts || []).forEach(acc => {
    const net = expenses
      .filter(e => e.ac === acc.id)
      .reduce((s, e) => s + (e.cat === 'TopUp' ? -e.amount : e.amount), 0);
    acc.balance = acc.startingBalance - net;
  });
}

function recalcMonthlyAgg(d, expenses) {
  d.monthlyAgg = {};
  expenses.forEach(e => {
    if (e.cat === 'TopUp') return;
    const m = e.date.slice(0, 7);
    if (!d.monthlyAgg[m]) d.monthlyAgg[m] = {};
    d.monthlyAgg[m][e.cat] = (d.monthlyAgg[m][e.cat] || 0) + e.amount;
  });
}
