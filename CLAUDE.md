# Health Repo — Claude Notes

## Repo overview

Personal health and finance tools, all served as static files under `/health/`.

| File | Purpose | ~Lines |
|---|---|---|
| `finance.html` | Finance PWA shell — HTML only (no inline CSS or JS) | 850 |
| `finance.css` | Finance PWA styles | 716 |
| `finance-core.js` | Constants, data layer, utilities, sheet/tab helpers | 599 |
| `finance-drive.js` | Google Drive bidirectional sync + merge logic | 587 |
| `finance-expenses.js` | Expenses tab — render, CRUD, filters, recurring, mortgage inline | 367 |
| `finance-investments.js` | Accounts, assets, investment history modal | 407 |
| `finance-events.js` | Events tab, calendar, bus panel, Leaflet map | 847 |
| `finance-insurance.js` | Insurance, recurring expenses, mortgages | 613 |
| `finance-tax.js` | Income tax, CPF projection, retirement planning | 1040 |
| `finance-ai.js` | AI advisor — net-worth snapshots, savings/runway, consolidated summary builder, Drive push/fetch, Markdown report render | 380 |
| `finance-app.js` | Analysis tab, `renderAll()`, theme picker, init sequence | 394 |
| `finance-gmail.js` | Email parser rules (expense + event parsers) | 264 |
| `apps-script/quarterly-report.gs` | Optional Google Apps Script — quarterly Claude API call → Drive report | — |
| `sw.js` | Service worker for `finance.html` | 50 |
| `tracker.html` | Health tracker PWA | — |
| `sw-tracker.js` | Service worker for `tracker.html` | — |
| `her.html` / `him.html` | Health plan pages | — |
| `themes.css` | Shared CSS themes (navy, earth, pastel) | — |
| `manifest.json` | PWA manifest (finance) | — |
| `icons/` | PWA icons (192px, 512px) | — |
| `fonts/material-symbols-outlined.css` | Self-hosted icon font CSS | — |
| `fonts/material-symbols-outlined.woff2` | Icon font subset (~279KB, 29 icons) | — |
| `finance-data-structure.md` | Full data schema reference | — |
| `finance-import-format.md` | CSV/JSON import format spec | — |

### JS load order (plain `<script src>` tags, no ES modules)

```
finance-core.js → finance-drive.js → finance-expenses.js → finance-investments.js
→ finance-events.js → finance-insurance.js → finance-tax.js → finance-ai.js → finance-app.js → finance-gmail.js
```

All files share a global scope. Each file may reference globals defined in files that load before it.

---

## IMPORTANT: Service worker versioning

**Bump the cache version in `sw.js` whenever any file in the ASSETS list is modified.**

```js
// sw.js line 1
const CACHE = 'finance-v64';  // increment this number
```

Current ASSETS list (17 files):
```
/health/finance.html, /health/finance.css,
/health/finance-core.js, /health/finance-drive.js, /health/finance-expenses.js,
/health/finance-investments.js, /health/finance-events.js, /health/finance-insurance.js,
/health/finance-tax.js, /health/finance-ai.js, /health/finance-app.js, /health/finance-gmail.js,
/health/themes.css, /health/icons/icon-192.png, /health/icons/icon-512.png,
/health/fonts/material-symbols-outlined.css, /health/fonts/material-symbols-outlined.woff2
```

Without bumping, users will keep being served old cached files after deployment.

Same rule applies to `tracker.html` — bump the version in `sw-tracker.js` if that file changes.

---

## Finance PWA architecture

- **Split-file app**: HTML in `finance.html`, CSS in `finance.css`, JS split across 10 domain files. No build step, no bundler.
- **Icons**: Google Material Symbols Outlined, self-hosted as a subset in `fonts/` (see section below).
- **Offline-first**: service worker caches all assets; Drive sync is optional.
- **No frameworks**: vanilla JS, no React/Vue/etc.

### Tabs

| Tab | `data-tab` | Icon | Page ID |
|---|---|---|---|
| Events | `events` | `event` | `page-events` |
| Expenses | `expenses` | `credit_card` | `page-expenses` |
| Investments | `investments` | `trending_up` | `page-investments` |
| Analysis | `analysis` | `bar_chart` | `page-analysis` |
| Insurance | `insurance` | `shield` | `page-insurance` |
| Tax | `tax` | `receipt_long` | `page-tax` |

Tab switching is driven by `data-tab` attributes and the `currentTab` variable. Each tab maps to a `#page-{tab}` div. The FAB (`+` button, id `fabBtn`) is hidden on the Analysis tab; its action depends on `currentTab`.

### Bottom sheets

| Sheet ID | Purpose |
|---|---|
| `themeSheet` | Theme picker |
| `expenseSheet` | Add/edit expense |
| `eventSheet` | Add/edit event |
| `assetSheet` | Add/edit asset |
| `insuranceSheet` | Add/edit insurance policy |
| `taxSheet` | Add/edit tax record |
| `settingsSheet` | Account settings, budgets, CPF/retirement settings |
| `cpfEntrySheet` | Add/edit CPF balance record |
| `ongoingListSheet` | Recurring expenses list modal |
| `ongoingFormSheet` | Add/edit recurring expense |
| `mortgageListSheet` | Mortgage list modal |
| `mortgageFormSheet` | Add/edit mortgage |
| `mortgageEntrySheet` | Add balance/payment/interest entry to mortgage |
| `parserEditorSheet` | Add/edit expense email parser |
| `evParserEditorSheet` | Add/edit event email parser |
| `aiReportSheet` | Paste/save the AI advisor Markdown report |

Modal overlays: `backdrop`, `mortgageOverlay`, `historyOverlay`, `driveOverlay`.

### Data storage

Two localStorage keys:

| Key | Contains |
|---|---|
| `finance:v1` | All main data (see `defaultData()` below) |
| `finance:v1:history` | Past-year expenses + all historyData collections (see below) |

`saveData(data)` / `loadData()` handle the main key. Always call `saveData(data)` after mutating `data`, then `renderAll()` to refresh the UI.

#### `defaultData()` shape

```js
{
  accounts: [{ id, name, startingBalance, balance, _updatedAt }],
  expenses: [],          // { id, ac, date, desc, amount, cat, _ts }
  assets: [],            // { id, name, class, units, history: [{ date, value, _ts }] } — class ∈ ASSET_CLASSES; "Home (own use)" is non-investable
  events: [],            // { id, title, description, startDate, startTime, endDate, endTime, tags, reminderHours, _ts }
  insurances: [],        // { id, name, personInsured, startDate, contractId, details, paymentAmount, paymentFrequency, agentContacts, _updatedAt }
  taxRecords: [],        // { id, year, isHistorical, basicSalary, bonus, otherIncome, cpfEmployee, reliefs, taxRebate, _ts }
  cpfRecords: [],        // { id, year, oaBalance, saBalance, maBalance, oaInterest, saInterest, maInterest, _ts }
  cpfSettings: { dateOfBirth, retirementAge, monthlySalary, lifeExpectancy, ersGrowthRate, mortalityFactor, monthlyMortgage },
  retirementSettings: { inflationRate, investmentRate, retirementAge, deathAge, monthlyExpenses },
  _deletedIds: [],
  budgets: {},           // { [category]: amount }
  monthlyAgg: {},        // { [YYYY-MM]: { [category]: total } }
  mortgages: [],         // { id, name, principal, startDate, interestRate, tenorYears, entries: [{ id, date, type, amount, note, _ts }], _updatedAt }
  ongoingExpenses: [],   // { id, name, amount, frequency, startDate, category, accountId, note, lastAutoGenPeriod, _updatedAt }
  emailCatMap: [],       // [{ match, value }]
  emailCatDefault: 'Other',
  netWorthSnapshots: [], // { key: 'YYYY-Qn', date, liquid, assets, cpf, debt, net, _ts } — one per quarter
  aiReport: null,        // { markdown, generatedAt, period } — latest AI advisor report
  dependents: []         // { id, name, relationship, birthYear, sex, _ts } — household, enriches AI analysis
}
```

`ASSET_CLASSES` (in `finance-core.js`): Cash, Equities, Bonds, Property (rental), Home (own use), Crypto, Commodities, Other. `isInvestable(a)` excludes `Home (own use)` — counted in net worth but excluded from investable allocation and `calcRetirementPlan()` drawdown.

**Adding a new data collection to `data` (main key):**
1. Add `myCollection: []` to `defaultData()`
2. Add `if (!d.myCollection) d.myCollection = [];` in `loadData()`
3. Write `renderMyCollection()` and call it from `renderAll()`
4. Add a sheet, form, and CRUD functions following the insurance pattern
5. Add a union-by-ID merge block in `mergeData()` in `finance-drive.js`

---

### historyData — structure, persistence, and sync

`historyData` is a separate in-memory object (global in `finance-core.js`) backed by `finance:v1:history` in localStorage.

**Current shape:**
```js
{
  expenses: [],      // { id, ac, date, desc, amount, cat, _ts } — past-year expenses
  powerRecords: [],  // { id, year, month, elecUsage, elecUnitCost, waterUsage, waterUnitCost, _ts }
  _updatedAt: number // timestamp of last local write — drives Drive sync decisions
}
```

**Key functions (`finance-core.js`):**
- `loadHistory()` — parses localStorage, ensures every collection is an array, returns the object
- `saveHistory(h)` — sets `h._updatedAt = Date.now()`, mirrors it to `data.historyUpdatedAt`, writes to localStorage. **Always call `saveHistory` then `saveData(data)` together when mutating `historyData`.**

`data.historyUpdatedAt` is stored in the main Drive file and is the sole signal `driveSync()` uses to decide whether to download/upload the history file. It must always equal `historyData._updatedAt` after any write.

#### Drive sync invariant — NEVER upload without merging first

`driveSync()` (`finance-drive.js`) uses this rule: **if a `historyFileId` is known and timestamps differ, always download the remote history file and merge it into local before uploading.** Uploading local history without first pulling remote will silently overwrite records that only exist on the remote (e.g. power records added on a partner's device).

Merge path in `driveSync` (simplified):
```
if (historyFileId && timestamps differ) {
  download remote → mergeHistoryData(local, remote) → upload merged
} else if (no historyFileId && local is newer) {
  upload local as-is (creates the history file for the first time)
}
```

`mergeHistoryData(localH, remoteH)` (`finance-drive.js`) does a union-by-ID merge for every collection, preferring the entry with the higher `_ts`. It returns a plain object containing all collections — **it does not carry `_updatedAt`**, which is set by the caller before uploading.

#### Deletion propagation for historyData collections

Because `historyData` is synced via merge (union), simply removing a record from the local array is not enough — the next merge with a partner would resurrect it. **Always add the deleted ID to `data._deletedIds`:**

```js
if (!data._deletedIds) data._deletedIds = [];
if (!data._deletedIds.includes(id)) data._deletedIds.push(id);
```

`driveSync` applies `_deletedIds` to `mergedHistory` after the merge, so the deletion propagates to both devices.

#### Adding a new collection to historyData

Follow all five steps or the collection will be silently dropped during syncs and imports:

1. **`loadHistory()` (`finance-core.js`)** — add a guard so old stored data gets the field:
   ```js
   if (!Array.isArray(d.myCollection)) d.myCollection = [];
   ```

2. **`mergeHistoryData(localH, remoteH)` (`finance-drive.js`)** — add a Map-based union block and include the field in the return value:
   ```js
   const myMap = new Map();
   [...(remoteH.myCollection || []), ...(localH.myCollection || [])].forEach(r => {
     const ex = myMap.get(r.id);
     if (!ex || (r._ts || 0) > (ex._ts || 0)) myMap.set(r.id, r);
   });
   return { expenses: [...expMap.values()], powerRecords: [...pwrMap.values()], myCollection: [...myMap.values()] };
   ```

3. **`driveSync()` — deletedIds filter** — add a line after the existing filters:
   ```js
   mergedHistory.myCollection = (mergedHistory.myCollection || []).filter(r => !deletedSet.has(r.id));
   ```

4. **`forceSyncHistory()` — deletedIds filter** — same line as above.

5. **History import handler (`historyImportFile` event, `finance-drive.js`)** — CRITICAL: when replacing `historyData` from an imported file, carry over every existing collection that the file may not contain. **Never** create a plain `{ expenses: ... }` object:
   ```js
   historyData = {
     expenses: d.expenses,
     powerRecords: historyData.powerRecords || [],
     myCollection: historyData.myCollection || [],
     _updatedAt: d._updatedAt || Date.now()
   };
   ```
   Omitting a collection here silently drops all its records from both localStorage and Drive on the next sync.

#### Other localStorage keys

| Key | Purpose |
|---|---|
| `finance:theme` | Active theme ('navy' / 'earth' / 'pastel') |
| `finance:driveFileId` | Drive file ID for main data |
| `finance:driveHistoryFileId` | Drive file ID for history |
| `finance:googleClientId` | OAuth2 client ID |
| `finance:googleLoginHint` | Last signed-in Google email |
| `finance:busApiKey` | LTA DataMall API key |
| `finance:balanceHidden` | Bool — hide balance amounts |
| `finance:lastAcct` | Last-used account ID |
| `finance:lastSync` | Timestamp of last Drive sync |
| `finance:driveSummaryFileId` | Drive file ID for `finance-elvis-summary.json` (AI summary) |
| `finance:driveReportFileId` | Drive file ID for `finance-elvis-report.json` (AI report) |
| `busMapCenter` | Saved map centre `[lat, lng]` |

### Google Drive sync

Two Drive files per user: `finance-elvis.json` (main) and `finance-elvis-history.json` (history).

**Merge strategy** (bidirectional, conflict-resolved):

*Main data (`mergeData` in `finance-drive.js`):*
- Expenses/Events/Tax/CPF/Insurance/OngoingExpenses/Dependents: union by ID, prefer higher `_ts` / `_updatedAt`, exclude `_deletedIds`
- Assets: union by ID, merge `history[]`, deduplicate by `_ts`; `name`/`units`/`class` prefer local
- Mortgages: union by ID, merge `entries[]`, deduplicate by ID
- Accounts: prefer higher `_updatedAt`
- Scalars (termDates, eventTags, expenseCats, emailParsers, emailCatMap, `aiReport` via `_aiReportTs`): last-writer-wins via timestamp
- `netWorthSnapshots`: union by quarter `key`, prefer higher `_ts`

*History data (`mergeHistoryData` in `finance-drive.js`):*
- `expenses` and every other collection (`powerRecords`, …): union by ID, prefer higher `_ts`
- Sync rule: **always download remote and merge before uploading** when a `historyFileId` is known and timestamps differ — never upload local without pulling remote first (see historyData section above)

**Share code**: `makeShareCode(clientId, fileId, historyFileId)` encodes a base64 string the partner can paste via `applyConnectCode()` to share the same Drive files.

### AI Financial Advisor (`finance-ai.js`)

A card at the top of the **Analysis** tab. It computes derived metrics and a
consolidated, AI-ready summary, then renders a Markdown report.

- **Net-worth snapshots**: `recordNetWorthSnapshot(force)` auto-records at most one
  `netWorthSnapshots` entry per quarter on load; the *📸 Snapshot now* button (`snapshotNetWorthNow()`)
  captures a dated point on demand. (`computeNetWorth()` = accounts + assets + CPF − mortgage debt.)
- **Cash flow**: `computeCashflow()` → avg monthly spend, savings rate, runway (vs a 6-month
  emergency-fund target). Shown as a KPI strip via `renderAiKpis()`.
- **Asset allocation**: `renderAssetAllocation()` (on Tax › Assets) groups assets by `class` with a
  stacked bar; own-home shown but flagged as excluded from the investable total.
- **Net-worth chart**: `renderNetWorthChart()` plots `netWorthSnapshots` by date (single point + hint until a second capture exists).
- **Dependents**: edited in Account Settings (`data.dependents`); ages/sex feed the AI summary.
- **Summary**: `buildAiSummary()` assembles a compact object (net worth + history, cash flow,
  quarterly/YTD expenses, budgets, asset allocation by class, household, mortgages, CPF projection,
  tax, retirement) reusing
  `calcCpfProjection()` / `calcRetirementPlan()` / `currentValue()`. `aiReportPrompt()` wraps it
  with an advisor prompt.
- **Two delivery paths** (see `apps-script/README.md`):
  - **Manual** — *📋 Copy summary* → paste into claude.ai → *✍️ Paste report* (`saveAiReportPaste`).
  - **Automated** — *☁ Summary → Drive* (`pushSummaryToDrive` → `finance-elvis-summary.json`); an
    Apps Script (`apps-script/quarterly-report.gs`) calls the Claude API and writes
    `finance-elvis-report.json`; *⬇ Fetch report* (`fetchAiReportFromDrive`) loads it.
- The report is stored in `data.aiReport` (syncs with normal data). `renderMarkdownLite()` is an
  XSS-safe Markdown→HTML renderer (the report is treated as untrusted).

### Expense categories

Default: `Grocery` · `Travel` (plus any in `data.expenseCats` and any `.cat` values already on expenses)

`TopUp` is income (adds to balance); all others are expenses (subtract). Categories are open — new ones can be added via import and will appear in the UI.

### Expense sub-tabs

The Expenses page has four sub-tabs switched by `switchExpSubTab(tab)`:
- `expenses` — main expense list (default)
- `recurring` — renders `renderOngoingListInline()`
- `mortgage` — renders `renderMortgageListInline()`
- `emailrules` — renders `renderEmailRulesSubTab()`

### Events features

- **Views**: list (grouped by week), calendar (month grid), bus panel (real-time LTA arrivals), bus map (Leaflet interactive map)
- **Bus stops**: 6 hardcoded stops in `BUS_STOPS` array in `finance-core.js`
- **External APIs**: LTA DataMall (`BUS_API_URL`), Leaflet.js (loaded dynamically), Geolocation API
- **Reminders**: browser notifications via `scheduleEventReminders()`

### Tax tab sub-tabs

- `tax` — income tax estimates + historical records, SVG chart
- `cpf` — CPF projection chart + recorded balances
- `assets` — asset list (same data as Investments)
- `retirement` — retirement drawdown projection

### Themes

Defined in `themes.css`, applied as a class on `<html>`. CSS custom properties used throughout:
`--bg`, `--paper`, `--card`, `--primary`, `--primary-light`, `--green`, `--green-light`, `--red`, `--red-light`, `--text`, `--muted`, `--border`, `--radius`, `--tab-h`

| Class | Name | Primary colour |
|---|---|---|
| `theme-navy` | Navy (default) | `#1b3a6b` |
| `theme-earth` | Earth | `#8b5e3c` |
| `theme-pastel` | Pastel | `#d4729a` |

Theme preference stored in `localStorage` under `finance:theme`.

### UI patterns

- **Bottom sheets**: `openSheet(id)` / `closeSheet()`. Each sheet has a `.sheet` div, handle, title, and form.
- **Toast notifications**: `showToast(message, duration?)`.
- **XSS safety**: always use `esc(str)` (defined in `finance-app.js`) when interpolating user data into innerHTML.
- **IDs**: generated with `uid()` (short random alphanumeric strings).
- **Formatting**: `fmtCurrency(n)` for dollar amounts, `fmt(n)` for plain numbers, `today()` for current date string.
- **Empty states**: use the `.empty-state` + `.icon` pattern (see existing tabs for examples).
- **Date inputs**: enhanced by `makeDmyWidget()` to allow DMY entry.
- **PWA cache reset**: `refreshPwaCache()` clears all caches, unregisters SW, and reloads.

### App init sequence (`finance-app.js` bottom)

1. Attach visibility change handler (pause/resume bus polling + geolocation)
2. Enhance date inputs with DMY widget
3. `renderAll()`
4. Apply balance visibility from localStorage
5. `autoGenOngoingExpenses()`
6. `updateDriveSyncBtn()`
7. `scheduleEventReminders()`
8. Check URL params: `?add=1` → open expense sheet; `?addevent=1` → open event sheet
9. Register service worker (`./sw.js`)
10. Attach `refreshPwaCache()` handler

### `renderAll()` call chain

```
renderEventList()
renderAccountFilterPills() + renderYearFilterPills()
renderExpenseList()
  → renderOngoingListInline()   [if currentExpSubTab === 'recurring']
  → renderMortgageListInline()  [if currentExpSubTab === 'mortgage']
renderInvestments()
renderAnalysis()
renderInsurances()
renderTaxRecords()
  → renderCpf()          [if currentTaxSubTab === 'cpf']
  → renderAssetsSubTab() [if currentTaxSubTab === 'assets']
  → renderRetirement()   [if currentTaxSubTab === 'retirement']
```

### Gmail email parser (`finance-gmail.js`)

Rules stored in `data.emailParsers.parsers`. Two parser types:

```js
// Expense parser
{ name, subjectContains, amount: { regex, group }, date: { regex, format }, desc: { regex, group } }

// Event parser
{ type: 'event', name, subjectContains, title: { regex, group },
  datetime: { regex, dateFormat, dateGroup, startTimeGroup, endTimeGroup },
  descItems: { regex, nameGroup, qtyGroup } }
```

---

## Material Symbols font (self-hosted subset)

The icon font lives in `fonts/material-symbols-outlined.css` and `fonts/material-symbols-outlined.woff2`.
It is a subset containing only the 29 icons currently used (~279KB vs ~1.5MB for the full font).
Both files are pre-cached by the service worker so icons load instantly offline.

**When you add a new icon**, re-run the subset to include it:

**Step 1 — collect all icon names in use:**
```bash
grep -rh "material-symbols-outlined" finance.html finance-*.js \
  | grep -oP "(?<=>)[a-z_]+(?=<)" | sort -u | tr '\n' ' '
```
Copy the output (space-separated icon names, e.g. `account_balance backspace bolt ...`).

**Step 2 — fetch the subset CSS from Google Fonts** (replace `TEXT` with the names from step 1):
```bash
TEXT="account_balance backspace bolt ..."   # paste icon names here
ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$TEXT")
curl -sS \
  -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0&text=${ENCODED}"
```
Copy the `url(https://fonts.gstatic.com/...)` value from the output.

**Step 3 — download the new WOFF2** (replace `URL` with the url from step 2):
```bash
curl -sS \
  -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "URL" \
  -o fonts/material-symbols-outlined.woff2
```

**Step 4 — bump the service worker cache version** in `sw.js` (required so users get the new font).

No changes needed to `fonts/material-symbols-outlined.css` or `finance.html`.

> **Note**: pass the full icon **names** (not individual characters) as the `text` parameter.
> Individual characters produce a much smaller file (~83KB) that omits the icon ligature glyphs.
