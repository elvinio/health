# Health Repo — Claude Notes

## Repo overview

Personal health and finance tools, all served as static files under `/health/`.

| File | Purpose |
|---|---|
| `finance.html` | Finance PWA shell — ~705 lines, HTML only (no inline CSS or JS) |
| `finance.css` | Finance PWA styles (~716 lines) |
| `finance-core.js` | Constants, data layer, utilities, sheet/tab helpers |
| `finance-drive.js` | Google Drive sync + CSV/history import/export |
| `finance-expenses.js` | Expenses tab — render, CRUD, filters |
| `finance-investments.js` | Accounts, investments, history modal |
| `finance-events.js` | Events tab, calendar, reminders, bus panel + map |
| `finance-insurance.js` | Insurance, ongoing expenses, mortgages |
| `finance-tax.js` | Income tax and CPF projection |
| `finance-app.js` | Analysis tab, renderAll, theme picker, init |
| `sw.js` | Service worker for `finance.html` |
| `tracker.html` | Health tracker PWA |
| `sw-tracker.js` | Service worker for `tracker.html` |
| `her.html` / `him.html` | Health plan pages |
| `themes.css` | Shared CSS themes (navy, earth, pastel) |
| `manifest.json` | PWA manifest (finance) |
| `icons/` | PWA icons (192px, 512px) |
| `finance-data-structure.md` | Full data schema reference |
| `finance-import-format.md` | CSV/JSON import format spec |

### JS load order (plain `<script src>` tags, no ES modules)

```
finance-core.js → finance-drive.js → finance-expenses.js → finance-investments.js
→ finance-events.js → finance-insurance.js → finance-tax.js → finance-app.js
```

All files share a global scope. Each file may reference globals defined in files that load before it.

---

## IMPORTANT: Service worker versioning

**Bump the cache version in `sw.js` whenever any finance file in the ASSETS list is modified.**

```js
// sw.js line 1
const CACHE = 'finance-v32';  // increment this number
```

Files that require a version bump when changed:
`finance.html`, `finance.css`, `finance-core.js`, `finance-drive.js`, `finance-expenses.js`,
`finance-investments.js`, `finance-events.js`, `finance-insurance.js`, `finance-tax.js`,
`finance-app.js`, `themes.css`

Without bumping, users will keep serving old cached files even after deployment.

Same rule applies to `tracker.html` — bump the version in `sw-tracker.js` if that file changes.

---

## Finance PWA architecture

- **Split-file app**: HTML in `finance.html`, CSS in `finance.css`, JS split across 8 domain files. No build step, no bundler.
- **Icons**: Google Material Symbols Outlined, self-hosted as a subset in `fonts/` (see below).
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

Tab switching is driven by `data-tab` attributes and the `currentTab` variable. Each tab maps to a `#page-{tab}` div. The FAB (`+` button) is hidden on the Analysis tab; its action depends on `currentTab`.

### Data storage

Two localStorage keys:

| Key | Contains |
|---|---|
| `finance:v1` | Accounts, current-year expenses, assets, insurances, events, budgets, monthlyAgg |
| `finance:v1:history` | All past-year expenses |

`saveData(data)` / `loadData()` handle the main key. Always call `saveData(data)` after mutating `data`, then `renderAll()` to refresh the UI.

**Adding a new data collection** (like `insurances` was added):
1. Add `myCollection: []` to `defaultData()`
2. Add `if (!d.myCollection) d.myCollection = [];` in `loadData()`
3. Write `renderMyCollection()` and call it from `renderAll()`
4. Add a sheet, form, and CRUD functions following the asset/insurance pattern

### Google Drive sync

Two Drive files per user: `finance-elvis.json` (main) and `finance-elvis-history.json` (history). Drive file IDs and client ID are stored in localStorage under `finance:driveFileId`, `finance:driveHistoryFileId`, and `finance:googleClientId`.

### Expense categories

`Food` · `Transport` · `Shopping` · `Health` · `Entertainment` · `Bills` · `Other` · `TopUp`

`TopUp` is income (adds to balance); all others are expenses (subtract). Categories are open — new ones can be added via import and will appear in the UI.

### Themes

Defined in `themes.css`, applied as a class on `<html>`:

| Class | Name |
|---|---|
| `theme-navy` | Navy (default) |
| `theme-earth` | Earth |
| `theme-pastel` | Pastel |

Theme preference stored in `localStorage` under `finance:theme`.

### Material Symbols font (self-hosted subset)

The icon font lives in `fonts/material-symbols-outlined.css` and `fonts/material-symbols-outlined.woff2`.
It is a subset containing only the icons currently used (~279KB vs ~1.5MB for the full font).
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

### UI patterns

- **Bottom sheets**: `openSheet(id)` / `closeSheet()`. Each sheet has a `.sheet` div, handle, title, and form.
- **Toast notifications**: `showToast(message)`.
- **XSS safety**: always use `esc(str)` when interpolating user data into innerHTML.
- **IDs**: generated with `uid()` (short random alphanumeric strings).
- **Formatting**: `fmtCurrency(n)` for dollar amounts, `today()` for current date string.
- **Empty states**: use the `.empty-state` + `.icon` pattern (see existing tabs for examples).
