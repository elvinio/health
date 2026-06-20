# Finance PWA — Architecture & Internals

> Finance-specific reference. Repo-wide conventions (no-build, service-worker
> cache-bump rule, testing, self-hosted fonts) live in the root `CLAUDE.md`.
> Tracker internals live in `docs/tracker.md`.

The Finance PWA is `finance.html` + `finance.css` + 10 `finance-*.js` domain
files + `sw.js`, all served under `/health/`.

## JS load order (plain `<script src>` tags, no ES modules)

```
finance-core.js → finance-drive.js → finance-expenses.js → finance-investments.js
→ finance-events.js → finance-insurance.js → finance-tax.js → finance-ai.js → finance-wiki.js → finance-app.js → finance-gmail.js
```

All files share a global scope. Each file may reference globals defined in files that load before it.

## Architecture

- **Split-file app**: HTML in `finance.html`, CSS in `finance.css`, JS split across 10 domain files. No build step, no bundler.
- **Icons**: Google Material Symbols Outlined, self-hosted as a subset in `fonts/` (see "Material Symbols font" in root `CLAUDE.md`).
- **Offline-first**: service worker caches all assets; Drive sync is optional.
- **No frameworks**: vanilla JS, no React/Vue/etc.

## Service worker cache

`sw.js` line 1 holds the cache version (`const CACHE = 'finance-v157';`).
**Bump it whenever any file in the ASSETS list changes** — see the root
`CLAUDE.md` "Service worker versioning" section for the ASSETS list and rules.
Leaflet's CSS/JS are cached separately in `EXT_CACHE` (`finance-ext-v1`) and do
not need a bump.

### Tabs

There are **6 top-level tabs** (there is no standalone Investments tab — assets live under Tax › Assets):

| Tab | `data-tab` | Icon | Page ID |
|---|---|---|---|
| Events | `events` | `event` | `page-events` |
| Wiki | `wiki` | `description` | `page-wiki` |
| Expenses | `expenses` | `credit_card` | `page-expenses` |
| Analysis | `analysis` | `bar_chart` | `page-analysis` |
| Insurance | `insurance` | `shield` | `page-insurance` |
| Tax | `tax` | `receipt_long` | `page-tax` |

**Wiki sub-tabs** (switched by `switchWikiSubTab(tab)` in `finance-wiki.js`):
- `recipe` — Recipe list + tap-to-view detail with ingredients/steps/notes
- `shopping` — Shopping list list + tap-to-view detail with checkbox items (`toggleShopItem`)
- `resume` — Resume list + tap-to-view detail with read-only render, PDF font/size controls, and Print button (`printResume`); builds content into `#resumePrintRoot` and calls `window.print()`

Interaction: each Wiki card is **tap to view** (opens in-place read-only detail; `wikiView={type,id}`) and **swipe left to edit** (reveals an Edit action button → opens edit sheet). Back button clears `wikiView`.

Tab switching is driven by `data-tab` attributes and the `currentTab` variable (the click handler lives at the bottom of `finance-core.js`). Each tab maps to a `#page-{tab}` div. The FAB (`+` button, id `fabBtn`) action depends on `currentTab` **and the active sub-tab**; it is hidden on Analysis › AI/Expense and Tax › Retirement (see the `fabBtn` handler in `finance-core.js` and `renderAll()` in `finance-app.js`).

> Note: `renderInvestments()` (`finance-investments.js`) is **not currently wired into any tab** — assets are rendered by `renderAssetsSubTab()` on the Tax tab. Treat `renderInvestments()` as dead/legacy unless re-introduced.

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
| `expenseBudgetSheet` | Expense categories + emojis, monthly budgets, email-keyword map |
| `allocationRatioSheet` | Target asset-allocation percentages |
| `customPromptSheet` | Edit the AI advisor prompt template |
| `medicalSheet` | Add/edit medical visit |
| `noteSheet` | Add/edit note |
| `recipeSheet` | Add/edit recipe (title, ingredients, steps, notes) |
| `shoppingSheet` | Add/edit shopping list (title + dynamic items with checkboxes) |
| `resumeSheet` | Add/edit resume (name, contact, summary, skills, dynamic experience/projects, education) |
| `powerSheet` | Add/edit utility (electricity/water) record |

Modal overlays: `backdrop`, `mortgageOverlay`, `historyOverlay`, `driveOverlay`, plus the `taxPinOverlay` (PIN gate for the Tax tab).

### Data storage

Two localStorage keys:

| Key | Contains |
|---|---|
| `finance:v1` | All main data (see `defaultData()` below) |
| `finance:v1:history` | Past-year expenses + all historyData collections (see below) |
| `finance:v1:wiki` | Wiki tab collections — recipes, shoppingLists, resumes (see wikiData below) |

`saveData(data)` / `loadData()` handle the main key. Always call `saveData(data)` after mutating `data`, then `renderAll()` to refresh the UI.

#### `defaultData()` shape

```js
{
  accounts: [{ id, name, startingBalance, balance, _updatedAt }],
                         // startingBalance = user-entered balance at START OF CURRENT YEAR (not account creation, not all-time).
                         // balance = recalculated from startingBalance + current-year expenses only (data.expenses).
                         // NEVER pass allExpenses() to recalcBalances() — that would subtract historical years' spending
                         // from a start-of-year figure, producing a wrong (too low) balance.
                         // recalcMonthlyAgg() is the exception — it intentionally uses allExpenses() for multi-year charts.
  expenses: [],          // { id, ac, date, desc, amount, cat, _ts } — current year only; past years live in historyData.expenses
  assets: [],            // { id, name, class, units, history: [{ date, value, _ts }] } — class ∈ ASSET_CLASSES; "Home (own use)" is non-investable
  events: [],            // { id, title, description, startDate, startTime, endDate, endTime, tags, reminderHours, _ts }
  insurances: [],        // { id, name, personInsured, startDate, contractId, details, paymentAmount, paymentFrequency, agentContacts, _updatedAt }
  taxRecords: [],        // { id, year, isHistorical, basicSalary, bonus, otherIncome, cpfEmployee, reliefs, taxRebate, _ts }
  cpfRecords: [],        // { id, year, oaBalance, saBalance, maBalance, oaInterest, saInterest, maInterest, _ts }
  cpfSettings: { dateOfBirth, spouseDob, retirementAge, lifeExpectancy, ersGrowthRate, mortalityFactor, monthlyMortgage },
  retirementSettings: { inflationRate, investmentRate, retirementAge, deathAge, monthlyExpenses, annualSavings, safeWithdrawalRate },
  _deletedIds: [],
  budgets: {},           // { [category]: amount }
  monthlyAgg: {},        // { [YYYY-MM]: { [category]: total } }
  mortgages: [],         // { id, name, principal, startDate, interestRate, tenorYears, entries: [{ id, date, type, amount, note, _ts }], _updatedAt }
  ongoingExpenses: [],   // { id, name, amount, frequency, startDate, category, accountId, note, lastAutoGenPeriod, _updatedAt }
  emailCatMap: [],       // [{ match, value }]
  emailCatDefault: 'Other',
  netWorthSnapshots: [], // { key, date, liquid, assets, investableAssets, cpf, debt, net, _ts } — key is the capture date (YYYY-MM-DD); auto ≤1/quarter + manual per-day
  aiReport: null,        // { markdown, generatedAt, period } — latest AI advisor report
  customAiPrompt: null,  // string | null — user-edited AI prompt template (null = use DEFAULT_AI_PROMPT)
  dependents: [],        // { id, name, relationship, birthYear, sex, _ts } — household, enriches AI analysis
  allocationRatios: {},  // { Equities: 40, Bonds: 20, ... } target allocation % per class
  medicalVisits: [],     // { id, title, person, description, date, amount, paymentType, _ts }
  notes: [],             // { id, title, content, _updatedAt }
  wikiFileId: null,      // Drive file ID for the separate wiki file (recipes/shoppingLists/resumes); null = not linked. Lives in main file so it propagates to partners; entered/created via the Drive menu.
  wikiUpdatedAt: 0,      // mirror of wikiData._updatedAt — sole signal driveSync uses to sync the wiki file (parallels historyUpdatedAt)
  // recipes/shoppingLists/resumes USED to live here; they now live in wikiData (finance:v1:wiki) — see "wikiData" section below.
}
```

Per-field sync timestamps (set on write, consumed by `mergeData` for last-writer-wins): `_termDatesTs`, `_eventTagsTs`, `_expenseCatsTs`, `_emailParsersTs`, `_emailCatMapTs`, `_cpfSettingsTs`, `_aiReportTs`, `_dependentsTs`, `_allocationRatiosTs`, `_customAiPromptTs`, `_retirementSettingsTs`.

`ASSET_CLASSES` (in `finance-core.js`): Cash, Equities, Bonds, Gold, Property (rental), Home (own use), Crypto, Commodities, CPF, Other. `isInvestable(a)` excludes `Home (own use)` — counted in net worth but excluded from investable allocation and `calcRetirementPlan()` drawdown. ⚠️ A `CPF`-class asset is **also** summed on top of `cpfRecords` in `computeNetWorth()`, so CPF should live in only one place to avoid double-counting.

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

**History file ID lives in the main file** (`data.historyFileId`), not localStorage — same as `data.wikiFileId`. This keeps it out of the share code and lets a partner adopt it automatically from the main file on their first sync. (`driveSync()`/`forceSyncHistory()` read `data.historyFileId`; the upload helper passes no `storageKey` and callers persist the returned ID back into `data.historyFileId`.) The legacy `finance:driveHistoryFileId` localStorage key is migrated into the main file once on load by `loadData()`.

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

---

### wikiData — Wiki tab collections in their own file

`wikiData` is a separate in-memory object (global in `finance-core.js`) backed by `finance:v1:wiki` in localStorage **and its own Drive file** `finance-elvis-wiki.json`. It holds the Wiki tab data so the main file doesn't bloat with recipe/resume text.

**Shape:**
```js
{
  recipes: [],       // { id, title, ingredients, steps, notes, _updatedAt } — multiline strings (one item per line)
  shoppingLists: [], // { id, title, items:[{id,text,checked}], _updatedAt }
  resumes: [],       // { id, title, name, contact, summary, coreSkills, experience:[{id,company,period,projects:[{name,points}]}], education, pdfFont, pdfSize, _updatedAt }
  _updatedAt: number // last local write — drives Drive sync decisions
}
```

**Key functions (`finance-core.js`):** `loadWiki()` / `saveWiki(w)` mirror `loadHistory`/`saveHistory`. `saveWiki` sets `w._updatedAt = Date.now()`, mirrors it to `data.wikiUpdatedAt`, and writes localStorage. **Always call `saveWiki(wikiData)` then `saveData(data)` together when mutating wikiData** — all Wiki CRUD in `finance-wiki.js` does this; deletes also push the id to `data._deletedIds`. `loadWiki()` runs a **one-time local migration**: if the main blob still has pre-split `recipes`/`shoppingLists`/`resumes`, it adopts them into wikiData, then scrubs them from the main blob.

**File ID storage differs from history:** the wiki file ID lives **in the main file** (`data.wikiFileId`), not in a `localStorage` key. This means it auto-propagates to a partner via the normal main-file sync (no share-code change needed). `data.wikiUpdatedAt` is the sole signal `driveSync()` uses to decide whether to sync the wiki file (parallels `historyUpdatedAt`).

**Menu:** the Drive panel (`#driveConnected` in `finance.html`) has a wiki file-ID input + **Link** (`linkWikiFile()`), **＋ Create file** (`createWikiFile()` — makes a new `finance-elvis-wiki.json` from local wikiData and links it), and **⟳ Sync wiki** (`forceSyncWiki()`).

**Sync (no auto-creation):** `driveSync()` only syncs wiki when a file ID is known (`data.wikiFileId`, or adopted from `remote.wikiFileId` on a partner's first sync). If timestamps differ it downloads the remote wiki file, `mergeWikiData(local, remote)`, applies `_deletedIds`, uploads, and stamps `merged.wikiUpdatedAt`. `mergeWikiData(localW, remoteW)` is a union-by-ID merge per collection preferring higher `_updatedAt`; like `mergeHistoryData` it does **not** carry `_updatedAt` (the caller stamps it). Upload helper: `uploadWikiToDrive` (passes no `storageKey` — the ID is persisted into `data.wikiFileId` by callers).

#### Other localStorage keys

| Key | Purpose |
|---|---|
| `finance:theme` | Active theme ('navy' / 'earth' / 'pastel') |
| `finance:driveFileId` | Drive file ID for main data |
| `finance:driveHistoryFileId` | **Legacy** — history file ID now lives in the main file as `data.historyFileId`; this key is migrated into it once on load and no longer written |
| *(wiki / history file IDs)* | **Not** localStorage keys — stored in the main file as `data.wikiFileId` / `data.historyFileId` (see wikiData / historyData above) |
| `finance:googleClientId` | OAuth2 client ID |
| `finance:googleLoginHint` | Last signed-in Google email |
| `finance:busApiKey` | LTA DataMall API key — **local-only, never synced to Drive** (secret) |
| `finance:busProxyUrl` | Proxy base URL for bus calls (**required** — Apps Script or local; no public-proxy fallback) |
| `finance:busStopCoords` | Cached lat/lng for `BUS_STOPS` (bus map) |
| `finance:balanceHidden` | Bool — hide balance amounts |
| `finance:lastAcct` | Last-used account ID |
| `finance:lastSync` | Timestamp of last Drive sync |
| `finance:taxPin` | PIN gating the Tax tab (digits only) |
| `finance:driveSummaryFileId` | Drive file ID for `finance-elvis-summary.json` (AI summary) |
| `finance:driveReportFileId` | Drive file ID for `finance-elvis-report.json` (AI report) |
| `busMapCenter` | Saved map centre `[lat, lng]` |

### Google Drive sync

Three Drive files per user: `finance-elvis.json` (main), `finance-elvis-history.json` (history), and `finance-elvis-wiki.json` (wiki — recipes/shoppingLists/resumes; ID stored in the main file as `data.wikiFileId`, see wikiData section).

**Merge strategy** (bidirectional, conflict-resolved):

*Main data (`mergeData` in `finance-drive.js`):*
- Expenses/Events/Tax/CPF/Insurance/OngoingExpenses/Dependents/MedicalVisits/Notes: union by ID, prefer higher `_ts` / `_updatedAt`, exclude `_deletedIds`
- Assets: union by ID, merge `history[]`, deduplicate by `_ts`; `name`/`units`/`class` prefer local (via `_nameTs`)
- Mortgages: union by ID, merge `entries[]`, deduplicate by ID
- Accounts: prefer higher `_updatedAt`
- Scalars/objects (termDates, eventTags, expenseCats, emailParsers, emailCatMap+emailCatDefault, cpfSettings, retirementSettings, allocationRatios, customAiPrompt, `aiReport`): last-writer-wins via the matching `_*Ts` timestamp
- `netWorthSnapshots`: union by `key` (the capture date), prefer higher `_ts`
- `budgets`: shallow merge (local keys win)

> When you add a new collection/field to `data`, add a matching merge block to `mergeData` (step 5 of "Adding a new data collection") or it will silently fail to sync.

*History data (`mergeHistoryData` in `finance-drive.js`):*
- `expenses` and every other collection (`powerRecords`, …): union by ID, prefer higher `_ts`
- Sync rule: **always download remote and merge before uploading** when a `historyFileId` is known and timestamps differ — never upload local without pulling remote first (see historyData section above)

**Share code**: `makeShareCode(clientId, fileId)` encodes `base64(clientId + "||" + fileId)` — just the OAuth client ID and the **main** file ID. The history and wiki file IDs are no longer included; they ride in the main file (`data.historyFileId` / `data.wikiFileId`) and propagate on the partner's first sync. `applyConnectCode()` parses 2 parts but still tolerates a legacy 3rd part (old history file ID), adopting it into `data.historyFileId`.

### AI Financial Advisor (`finance-ai.js`)

A card at the top of the **Analysis** tab. It computes derived metrics and a
consolidated, AI-ready summary, then renders a Markdown report.

- **Net-worth snapshots**: `recordNetWorthSnapshot(force)` auto-records at most one
  `netWorthSnapshots` entry per quarter on load; the *📸 Snapshot now* button (`snapshotNetWorthNow()`)
  captures a dated point on demand. (`computeNetWorth()` = accounts + assets + CPF − mortgage debt.)
- **Cash flow**: `computeCashflow()` → avg monthly spend (last 12 months from `monthlyAgg`),
  monthly income (from latest non-historical tax estimate), and savings rate. Shown as a KPI strip
  via `renderAiKpis()` (Net Worth + QoQ delta, Savings Rate).
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

Default: `DEFAULT_CATS` = `Grocery` · `Travel` · `Income Tax` · `Allowance` (`finance-core.js`), plus any in `data.expenseCats` and any `.cat` values already on expenses.

`TopUp` is income (adds to balance); all others are expenses (subtract). Categories are open — new ones can be added via import and will appear in the UI. `data.expenseCats` is a comma-separated "emoji name" string parsed by `parseCatEmojis()` / `expenseCatDefaults()`.

### Expense sub-tabs

The Expenses page has four sub-tabs switched by `switchExpSubTab(tab)`:
- `expenses` — main expense list (default)
- `recurring` — renders `renderOngoingListInline()`
- `mortgage` — renders `renderMortgageListInline()`
- `emailrules` — renders `renderEmailRulesSubTab()`

### Analysis sub-tabs

Switched by `switchAnalysisSubTab(tab)` (`finance-app.js`):
- `ai` — AI Financial Advisor card (`renderAiReport()`, default)
- `expense` — category/yearly/asset-mortgage charts + monthly cards + budget summary
- `power` — utility (electricity/water) records & chart (`renderPower()`); FAB adds a power record

### Insurance sub-tabs

Switched by `switchInsSubTab(tab)` (`finance-insurance.js`):
- `policy` — insurance policies (`renderInsurances()`, default)
- `medical` — medical visits log (`renderMedical()`); FAB adds a visit

### Events features

- **Views** (`setEventView(mode)`): `list` (grouped by week), `calendar` (month grid), `bus` (real-time LTA arrivals), `busmap` (Leaflet interactive map), `rain` (NEA rain-radar overlay — windowed lazy-load with range pills 1d/3d/1w/2w/30d, default 1d; the client generates deterministic 5-min slot keys (`rainGenerateKeys`) and batch-fetches ~4h/request via the lta-proxy `RainImgBatch` action, no server-side listing; immutable frames persisted in a Cache API store `rain-frames-v1`, whitelisted in sw.js; live last-hour fallback without a proxy; blue location dot; `RAIN_BOUNDS` georeference in finance-events.js), `notes` (free-form notes)
- **Bus stops**: 6 hardcoded stops in `BUS_STOPS` array in `finance-core.js`
- **External APIs**: LTA DataMall (`BUS_API_URL`, via a **required** proxy URL — Apps Script or local; `busProxyFetch` no longer falls back to the public `corsproxy.io`, so the `AccountKey` never transits a third party), Leaflet.js (loaded dynamically), Geolocation API
- **Reminders**: browser notifications via `scheduleEventReminders()`

### Tax tab sub-tabs

Switched by `switchTaxSubTab(tab)` (`finance-expenses.js`):
- `incometax` — income tax estimates + historical records, SVG chart (default)
- `cpf` — CPF projection chart + recorded balances + SA-to-ERS tables
- `assets` — asset list + allocation (same `data.assets` source)
- `retirement` — retirement drawdown projection
- Optional **PIN gate** (`finance:taxPin`): `maybeShowTaxPin()` shows `taxPinOverlay` on entry until unlocked.

### Themes

Defined in `themes.css` (shared with the tracker), applied as a class on `<html>`. CSS custom properties used throughout:
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
- **XSS safety**: always use `esc(str)` (defined in `finance-app.js`) when interpolating user data into innerHTML. `esc()` escapes `& < > " '` and `` ` ``, so values passed through it are safe inside both double- and single-quoted inline handlers (e.g. `onclick="fn('${esc(x)}')"`). ⚠️ The remaining risk is interpolating user-controlled values **without** `esc()` — a few raw interpolations of app-generated values (uid/date slices) exist; route any new user-controlled value through `esc()`, or prefer `data-*` attributes + event delegation.
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
5. `updateDriveSyncBtn()`
6. `scheduleEventReminders()`
7. Check URL params: `?add=1` → open expense sheet; `?addevent=1` → open event sheet
8. Register service worker (`./sw.js`)
9. Attach `refreshPwaCache()` handler

> Recurring expenses are **never** auto-generated on startup — they are created only via the "Generate this month" button (`manualGenOngoingExpenses()`) on Expenses › Recurring.

### `renderAll()` call chain

`renderAll()` (`finance-app.js`) renders **only the active tab** (it `switch`es on `currentTab`); inactive tabs are rendered when next visited. It also recomputes FAB visibility first.

```
events:    eventViewMode === 'notes' ? renderNotesList() : renderEventList()
expenses:  renderAccountFilterPills() + renderYearFilterPills() + renderExpenseList()
             → renderOngoingListInline()   [if currentExpSubTab === 'recurring']
             → renderMortgageListInline()  [if currentExpSubTab === 'mortgage']
analysis:  renderAnalysis()  // dispatches on currentAnalysisSubTab → ai | expense | power
insurance: currentInsSubTab === 'medical' ? renderMedical() : renderInsurances()
tax:       renderTaxRecords()
             → renderCpf()          [if currentTaxSubTab === 'cpf']
             → renderAssetsSubTab() [if currentTaxSubTab === 'assets']
             → renderRetirement()   [if currentTaxSubTab === 'retirement']
```

> Because each render rebuilds the whole tab's `innerHTML`, an uncaught exception in one render blanks that tab. Guard parsing of imported/legacy data accordingly.

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
It is a subset containing only the 31 icons currently used (~286KB vs ~1.5MB for the full font).
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

## EB Garamond font (self-hosted)

`fonts/eb-garamond.woff2` is a self-hosted EB Garamond Regular subset used by the Resume PDF feature in the Wiki tab. It is pre-cached by the service worker.

`@font-face` declaration lives in `finance.css`. Font is available as `'EB Garamond'` in the resume PDF font selector. If the file is missing, the selector falls back gracefully to the generic `serif` stack.

To refresh the font file:
```bash
CSS=$(curl -sS -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" "https://fonts.googleapis.com/css2?family=EB+Garamond")
URL=$(echo "$CSS" | grep -oP "url\(\Khttps://[^)]+\.woff2")
curl -sS -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" "$URL" -o fonts/eb-garamond.woff2
```
Then bump the `sw.js` cache version.
