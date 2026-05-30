/**
 * Finance PWA — Quarterly AI report (Google Apps Script)
 *
 * Reads the summary the finance PWA writes to Google Drive
 * (finance-elvis-summary.json), sends it to the Claude API, and writes the
 * report back to Drive (finance-elvis-report.json). The PWA's Analysis tab then
 * fetches and displays it ("⬇ Fetch report").
 *
 * One-time setup:
 *   1. Create a script at https://script.google.com (or `clasp`), paste this file.
 *   2. Project Settings → Script Properties → add ANTHROPIC_API_KEY = sk-ant-...
 *      (get a key at https://console.anthropic.com — this is the pay-per-use API,
 *       billed separately from a claude.ai subscription; a quarterly run is ~cents).
 *   3. In the PWA: Analysis tab → "☁ Summary → Drive" once, so the summary file exists.
 *   4. Run `generateReport` once from the editor to authorise Drive access + test.
 *   5. Run `installQuarterlyTrigger` once to schedule it automatically.
 *
 * Scopes used: Drive (read/write the two JSON files) + external request to api.anthropic.com.
 */

var SUMMARY_FILENAME = 'finance-elvis-summary.json';
var REPORT_FILENAME = 'finance-elvis-report.json';
var CLAUDE_MODEL = 'claude-sonnet-4-6'; // any current model; Sonnet keeps a quarterly run cheap
var CLAUDE_MAX_TOKENS = 2000;

function generateReport() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY in Script Properties first.');

  var summaryText = readDriveFile_(SUMMARY_FILENAME);
  if (!summaryText) throw new Error('Could not find ' + SUMMARY_FILENAME + ' on Drive. Push it from the app first.');

  var summary = JSON.parse(summaryText);
  var markdown = callClaude_(apiKey, summary);

  var report = {
    generatedAt: new Date().toISOString(),
    period: summary.period || '',
    model: CLAUDE_MODEL,
    markdown: markdown
  };
  writeDriveFile_(REPORT_FILENAME, JSON.stringify(report, null, 2));
  Logger.log('Wrote ' + REPORT_FILENAME + ' (' + markdown.length + ' chars).');
}

function buildPrompt_(summary) {
  var period = summary.period || 'this quarter';
  return [
    'You are a Singapore-based personal financial advisor. Below is a JSON snapshot',
    'of my consolidated finances for ' + period + ' (all amounts in SGD). Write a concise',
    'quarterly review in GitHub-flavoured Markdown covering: executive summary; net worth',
    '(with QoQ/YoY change and drivers); cash flow & savings (savings rate, emergency-fund',
    'runway vs the 6-month target, spending vs budget); spending trends and recurring costs',
    'worth reviewing; mortgage payoff/prepayment; CPF & retirement readiness (progress to',
    'FRS/ERS, projected CPF LIFE payout, sustainable withdrawal vs target expenses); a brief',
    'income-tax note; 3-5 specific prioritised action items; and risks/gaps to start tracking.',
    'Be specific and quantitative, reference the actual numbers, keep it under ~600 words,',
    'and respond with ONLY the Markdown report (no preamble).',
    '',
    '```json',
    JSON.stringify(summary, null, 2),
    '```'
  ].join('\n');
}

function callClaude_(apiKey, summary) {
  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      messages: [{ role: 'user', content: buildPrompt_(summary) }]
    })
  });
  var code = resp.getResponseCode();
  if (code !== 200) throw new Error('Claude API HTTP ' + code + ': ' + resp.getContentText());
  var json = JSON.parse(resp.getContentText());
  return json.content.map(function (b) { return b.text || ''; }).join('').trim();
}

// ── Drive helpers ─────────────────────────────────────────────────────────────
function readDriveFile_(name) {
  var it = DriveApp.getFilesByName(name);
  if (!it.hasNext()) return null;
  return it.next().getBlob().getDataAsString();
}

function writeDriveFile_(name, content) {
  var it = DriveApp.getFilesByName(name);
  if (it.hasNext()) {
    it.next().setContent(content);
  } else {
    DriveApp.createFile(name, content, 'application/json');
  }
}

// ── Quarterly trigger ─────────────────────────────────────────────────────────
function installQuarterlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'maybeRunQuarterly') ScriptApp.deleteTrigger(t);
  });
  // Apps Script has no native quarterly timer; check monthly and run only in Jan/Apr/Jul/Oct.
  ScriptApp.newTrigger('maybeRunQuarterly').timeBased().onMonthDay(2).atHour(7).create();
  Logger.log('Quarterly trigger installed (runs on the 2nd of Jan/Apr/Jul/Oct).');
}

function maybeRunQuarterly() {
  var month = new Date().getMonth(); // 0-based
  if (month % 3 === 0) generateReport();
}
