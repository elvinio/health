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
| `finance-app.js` | Analysis tab, `renderAll()`, theme picker, init sequence | 394 |
| `finance-gmail.js` | Email parser rules (expense + event parsers) | 264 |
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
→ finance-events.js → finance-insurance.js → finance-tax.js → finance-app.js → finance-gmail.js
```

All files share a global scope. Each file may reference globals defined in files that load before it.

---

## IMPORTANT: Service worker versioning

**Bump the cache version in `sw.js` whenever any file in the ASSETS list is modified.**

```js
// sw.js line 1
const CACHE = 'finance-v59';  // increment this number
```

Current ASSETS list (16 files):
```
/health/finance.html, /health/finance.css,
/health/finance-core.js, /health/finance-drive.js, /health/finance-expenses.js,
/health/finance-investments.js, /health/finance-events.js, /health/finance-insurance.js,
/health/finance-tax.js, /health/finance-app.js, /health/finance-gmail.js,
/health/themes.css, /health/icons/icon-192.png, /health/icons/icon-512.png,
/health/fonts/material-symbols-outlined.css, /health/fonts/material-symbols-outlined.woff2
```

Without bumping, users will keep being served old cached files after deployment.

Same rule applies to `tracker.html` — bump the version in `sw-tracker.js` if that file changes.

---

## Finance PWA architecture

- **Split-file app**: HTML in `finance.html`, CSS in `finance.css`, JS split across 9 domain files. No build step, no bundler.
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

Modal overlays: `backdrop`, `mortgageOverlay`, `historyOverlay`, `driveOverlay`.

### Data storage

Two localStorage keys:

| Key | Contains |
|---|---|
| `finance:v1` | All main data (see `defaultData()` below) |
| `finance:v1:history` | All past-year expenses |

`saveData(data)` / `loadData()` handle the main key. Always call `saveData(data)` after mutating `data`, then `renderAll()` to refresh the UI.

#### `defaultData()` shape

```js
{
  accounts: [{ id, name, startingBalance, balance, _updatedAt }],
  expenses: [],          // { id, ac, date, desc, amount, cat, _ts }
  assets: [],            // { id, name, units, history: [{ date, value, _ts }] }
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
  emailCatDefault: 'Other'
}
```

**Adding a new data collection:**
1. Add `myCollection: []` to `defaultData()`
2. Add `if (!d.myCollection) d.myCollection = [];` in `loadData()`
3. Write `renderMyCollection()` and call it from `renderAll()`
4. Add a sheet, form, and CRUD functions following the insurance pattern

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
| `busMapCenter` | Saved map centre `[lat, lng]` |

### Google Drive sync

Two Drive files per user: `finance-elvis.json` (main) and `finance-elvis-history.json` (history).

**Merge strategy** (bidirectional, conflict-resolved):
- Expenses/Events/Tax/CPF/Insurance/OngoingExpenses: union by ID, prefer higher `_ts` / `_updatedAt`, exclude `_deletedIds`
- Assets: union by ID, merge `history[]`, deduplicate by `_ts`
- Mortgages: union by ID, merge `entries[]`, deduplicate by ID
- Accounts: prefer higher `_updatedAt`
- Scalars (termDates, eventTags, expenseCats, emailParsers, emailCatMap): last-writer-wins via timestamp

**Share code**: `makeShareCode(clientId, fileId, historyFileId)` encodes a base64 string the partner can paste via `applyConnectCode()` to share the same Drive files.

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

**Step 1 — find all unique characters across every icon name in use:**
```bash
grep -rh "material-symbols-outlined" finance.html finance-*.js \
  | grep -oP "(?<=>)[a-z_]+(?=<)" | sort -u \
  | tr -d '\n _' | grep -o . | sort -u | tr -d '\n'
```
Copy the output string (e.g. `abcdefghiklmnoprstuvwxy`).

**Step 2 — fetch the subset CSS from Google Fonts** (replace `TEXT` with the string from step 1):
```bash
TEXT="abcdefghiklmnoprstuvwxy"
curl -sS \
  -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0&text=${TEXT}"
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
