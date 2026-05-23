# Health Repo — Claude Notes

## Repo overview

Personal health and finance tools, all served as static files under `/health/`.

| File | Purpose |
|---|---|
| `finance.html` | Finance PWA — single-file, ~3300 lines, vanilla JS |
| `sw.js` | Service worker for `finance.html` |
| `tracker.html` | Health tracker PWA |
| `sw-tracker.js` | Service worker for `tracker.html` |
| `her.html` / `him.html` | Health plan pages |
| `themes.css` | Shared CSS themes (navy, earth, pastel) |
| `manifest.json` | PWA manifest (finance) |
| `icons/` | PWA icons (192px, 512px) |
| `finance-data-structure.md` | Full data schema reference |
| `finance-import-format.md` | CSV/JSON import format spec |

---

## IMPORTANT: Service worker versioning

**Whenever `finance.html` or `themes.css` is modified, bump the cache version in `sw.js`.**

```js
// sw.js line 1
const CACHE = 'finance-v14';  // increment this number
```

Without bumping, users will keep serving the old cached file even after deployment. The service worker caches these assets:

```js
const ASSETS = [
  '/health/finance.html',
  '/health/themes.css',
  '/health/icons/icon-192.png',
  '/health/icons/icon-512.png',
];
```

Same rule applies to `tracker.html` — bump the version in `sw-tracker.js` if that file changes.

---

## Finance PWA architecture

- **Single-file app**: all HTML, CSS, and JS live in `finance.html`. No build step, no bundler.
- **Icons**: Google Material Symbols Outlined (loaded from Google Fonts CDN).
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

### UI patterns

- **Bottom sheets**: `openSheet(id)` / `closeSheet()`. Each sheet has a `.sheet` div, handle, title, and form.
- **Toast notifications**: `showToast(message)`.
- **XSS safety**: always use `esc(str)` when interpolating user data into innerHTML.
- **IDs**: generated with `uid()` (short random alphanumeric strings).
- **Formatting**: `fmtCurrency(n)` for dollar amounts, `today()` for current date string.
- **Empty states**: use the `.empty-state` + `.icon` pattern (see existing tabs for examples).
