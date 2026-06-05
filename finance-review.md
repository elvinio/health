# Finance PWA — Code Review Report

Review of the finance PWA (`finance.html` + `finance.css` + 10 `finance-*.js` modules + `sw.js`, ~8,800 lines). Three lenses: **developer** (cleanliness/maintainability), **architect** (structure/bottlenecks/responsiveness), **QA** (bugs). No code was changed.

---

## Executive summary

The app is impressively capable for a no-build, no-framework, vanilla-JS PWA: offline-first, bidirectional Drive sync with conflict-resolved merges, and a lot of well-thought-out domain logic (CPF/tax/retirement). The data layer and merge logic are the strongest part — they show real care about sync edge cases (cross-store dedup, deletion propagation, "never upload without merging first").

The main weaknesses are **(1) a systemic XSS/injection vector** because `esc()` doesn't escape single quotes yet is used inside single-quoted inline `onclick` handlers, **(2) several render paths that throw on malformed/imported data and break the whole tab**, **(3) charts hardcode earth-theme colors so they look wrong in Navy/Pastel**, and **(4) heavy duplication** (chart scaffolding, asset cards, bus API setup, auto/manual recurring) that inflates maintenance cost. There are no automated tests and the rendering model re-builds entire tab `innerHTML` on every change — fine at current data sizes, a latent scaling bottleneck.

---

## Developer perspective — cleanliness & maintainability

### Strengths
- Consistent, readable idioms across files (CRUD-by-sheet, `openSheet`/`closeSheet`, `uid()`, `esc()`, `fmtDollar`). A new feature clearly follows the "insurance pattern" the docs describe.
- Good explanatory comments where it matters most (sync invariants in `finance-drive.js`, CPF allocation math, the `W_real` deflation comment in `calcRetirementPlan`).
- Storage migrations in `loadData()` are defensive (lots of `if (!d.x) d.x = …` guards), so old stored blobs upgrade cleanly.

### Issues

1. **Large-scale duplication (top maintainability cost).**
   - **SVG chart scaffolding** (grid lines, ticks, `xPos`/`yPos`, `Math.pow(10, Math.floor(log10))` axis rounding, `.toFixed(1)` path building) is re-implemented ~7 times: `renderCategoryChart`, `renderYearlyChart`, `renderAssetMortgageChart` (`finance-app.js`), `renderTaxChart`, `renderCpfChart` (`finance-tax.js`), `renderNetWorthChart` (`finance-ai.js`), `renderPower` (`finance-app.js`). A single `lineChart({series, months, …})` helper would remove hundreds of lines.
   - **Asset card markup** is duplicated between `renderInvestments` and `renderAssetsSubTab` (`finance-investments.js:283` vs `:474`).
   - **`autoGenOngoingExpenses` and `manualGenOngoingExpenses`** (`finance-insurance.js:444` / `:489`) are ~95% identical — only the toast/skip counting differs.
   - **Bus API-key setup UI** is duplicated verbatim between `renderBusPanel` and `renderBusMapPanel` (`finance-events.js`), including an inline `onclick` blob of JS.

2. **Dead code.** `balanceAtMonthStart()` / `balanceAtMonthEnd()` (`finance-expenses.js:2-14`) are defined but never called — the month-header balance is computed inline instead.

3. **Inline styles everywhere.** Most rendered HTML uses long inline `style="…"` strings rather than CSS classes (e.g. the expense month header, KPI strips, tax/CPF cards). This is the biggest readability drag and makes theme-consistency hard (see charts below). Promoting repeated inline styles to classes in `finance.css` would shrink the JS significantly.

4. **Single global scope / name shadowing.** All files share globals (no modules/IIFE). `today` exists both as a global function and as local variables that shadow it (`getOngoingDueInfo` `const today = …`). It works but is a footgun; one accidental top-level `const` redeclaration would break load order.

5. **Inline event handlers as strings.** Passing data through `onclick="fn('${id}')"` couples rendering to the global namespace and is the root cause of the injection issue below. Event delegation (`data-id` + one listener) would be cleaner and safer.

6. **Documentation drift (CLAUDE.md).** The doc is out of date vs. the code, which will mislead future work:
   - SW version listed as `finance-v64`; actual is `finance-v119` (`sw.js:1`).
   - ASSETS "17 files"; actual list now includes `manifest.json` (18).
   - `ASSET_CLASSES` in the doc omits `Gold` and `CPF`, which exist in `finance-core.js:49`.
   - `defaultData()` in the doc is missing `customAiPrompt`, `allocationRatios`, `medicalVisits`, `notes`, and the doc's `cpfSettings`/`retirementSettings` shapes are stale.

---

## Architect perspective — structure, bottlenecks, responsiveness

### Strengths
- **Clean layering:** `finance-core.js` (data/util) → domain modules → `finance-app.js` (`renderAll`). Documented, deterministic script load order.
- **Sync design is genuinely good.** `mergeData`/`mergeHistoryData` do union-by-id with `_ts`/`_updatedAt` tie-breaks, per-field last-writer-wins via `_*Ts` timestamps, history-merge-before-upload, deletion propagation via `_deletedIds`, and cross-store dedup for the year-boundary case. This is the hardest part of the app and it's handled thoughtfully.
- **Offline-first SW** with separate immutable external cache (`EXT_CACHE` for Leaflet) and versioned app cache.

### Bottlenecks / concerns

1. **Full-innerHTML re-render model.** Every mutation calls `renderAll()` (or a `renderX`) which rebuilds the active tab's entire `innerHTML` from string concatenation. At today's data volume this is fine, but it's O(n) string building on every keystroke-adjacent action and discards DOM/scroll/focus state. It's the main latent scaling bottleneck. The search input already needed a debounce (`onSearchInput`, 150 ms) precisely because of this.

2. **`allExpenses()` allocates a fresh merged array on every call** (`finance-core.js:225`) and is called many times per render (balance recalc, monthlyAgg recalc, year list, empty checks, category lists). Cheap now; worth memoizing if expense history grows large.

3. **`_deletedIds` grows unbounded forever.** Every delete appends an id and it's never pruned, so the synced main file accumulates tombstones indefinitely across years. Consider capping/ageing them.

4. **CPF/asset double-counting risk in net worth.** `computeNetWorth()` (`finance-ai.js:46`) sums *all* assets (including any asset whose `class === 'CPF'`) **and** adds `latestCpfBalances().total`. A user who records CPF both as an asset row and via CPF records is double-counted in net worth and the AI summary. Worth excluding `class === 'CPF'` assets from the asset sum, or documenting that CPF should only live in one place.

5. **Third-party exposure of secrets.** The bus path defaults to `https://corsproxy.io/?…` and sends the LTA `AccountKey` header through it (`finance-events.js:240`). The optional local proxy mitigates this, but the default leaks the key to a third party. Separately, `driveSync` writes `busApiKey` into the synced `finance-elvis.json` (`finance-drive.js:640`), so the key also lands in Drive. Both are worth a conscious decision/flag.

6. **Responsiveness.** Layout is mobile-first: content capped at `max-width:640px` centered, `100dvh`, `env(safe-area-inset-*)` respected, sheets `max-height:92dvh`, charts/tables wrapped in `overflow-x:auto`. This works well on phones and degrades acceptably to a centered column on desktop. **There are zero `@media` queries** — acceptable for a personal phone-first PWA, but there's no tablet/desktop optimization, and the fixed-pixel SVG charts (`COL_W` per point) only scroll horizontally rather than scaling to width. Not a bug, but the ceiling on "responsive" is low by design.

7. **No tests / no error isolation.** There's no test harness, and because a render builds the whole tab, a single thrown exception (see QA #2/#3) blanks the tab. Wrapping each `renderX` in try/catch, or rendering per-item, would contain failures.

---

## QA perspective — bugs

### High severity

1. **`esc()` does not escape single quotes, but is used inside single-quoted inline handlers → injection.**
   `esc()` (`finance-app.js:611`) escapes `& < > "` only. Yet ~23 call sites build handlers like `onclick="openExpenseSheet('${e.id}')"` / `setEventTagFilter('${esc(t)}')` / `openPowerSheet('${esc(r.id)}')`. A value containing `'` breaks out of the JS string literal and injects code. Vectors that accept arbitrary text:
   - **Event tags** (`setEventTagFilter('${esc(t)}')`, `finance-events.js:66`) — user-typed in settings; a tag like `x');somefn();//` injects.
   - **CSV-imported expense `id`** (`renderExpenseList` uses `openExpenseSheet('${e.id}')` with no escaping at all, `finance-expenses.js:70`) — import sets `id` straight from the CSV (`finance-drive.js`/`finance-expenses.js` import).
   It's mostly self-XSS (local data), but it's a real correctness/security defect. Fix at the root: make `esc()` also escape `'` (and `` ` ``), or switch these handlers to event delegation with `data-id`.

2. **Importing events without `startTime` crashes the Events tab.**
   The events JSON import only validates `id`, `title`, `startDate` (`finance-drive.js:112`). But `renderEventList` sorts via `eventToMs(ev)` which reads `ev.startTime.hour`/`.minute`/`.ampm` (`finance-events.js:2-7`). An imported event lacking `startTime` throws a `TypeError`, and since the sort runs over the whole list, **the entire events list fails to render**. Import should default `startTime`/`endTime`, or `eventToMs` should guard.

### Medium severity

3. **Charts hardcode earth-theme colors → wrong look in Navy/Pastel themes.**
   Grid/axis colors `#e8dece` and text `#7a6a52` are hardcoded in every SVG chart (e.g. `finance-app.js:73-74`, `finance-tax.js:82-83`, `finance-ai.js:519-520`). These are the Earth palette; under `theme-navy`/`theme-pastel` the gridlines/labels clash with the background. Should use CSS vars (`var(--border)`, `var(--muted)`) like `renderPower` already does.

4. **Per-month account balance in the expense list ignores prior-year history.**
   The month-header per-account balance is computed from `data.expenses` (current year only) starting at `acc.startingBalance` (`finance-expenses.js:53-55`), whereas the canonical `acc.balance` from `recalcBalances` is computed over `allExpenses()` (history + current) (`finance-core.js:201`). For any user with migrated history, these two numbers diverge — the header balance silently omits all prior-year spending. Either `startingBalance` must be re-keyed to the current-year opening each January (no such rollover exists), or the header should use the same all-time basis. Worth verifying against intended semantics.

5. **`confirmClearData()` resets history to `{ expenses: [] }`**, dropping `powerRecords` and any future history collection (`finance-drive.js:88`). This violates the documented historyData invariant ("never create a plain `{ expenses }` object"). For a "clear all" action the data loss is intended, but the shape is inconsistent and will silently swallow collections added later.

6. **`migrateExpenses()` / sync filters assume `e.date` exists.**
   `data.expenses.filter(e => e.date.startsWith(curYear + '-'))` (`finance-core.js:235`) and `remote.expenses.filter(e => !e.date.startsWith(…))` (`finance-drive.js:590`) throw if any expense lacks `date`. CSV import guards against empty `date`, but a malformed remote/legacy blob would crash the load/sync path.

7. **`monthlyAgg`-based analysis silently excludes the `Other` category** (`renderAnalysis`, `finance-app.js:527`) from the monthly trend chart and the per-month cards, while the YTD pill and yearly-total chart include it. Totals between views won't reconcile, which looks like a bug to a user even if the exclusion is intentional.

### Low severity / polish

8. **`openExpenseSheet` silently rewrites an unknown category to `Other`** (`finance-expenses.js:125-127`): if an expense's `cat` isn't in the option list, editing-then-saving changes its category without warning.

9. **Net-worth snapshot key is the date, not the quarter.** `recordNetWorthSnapshot` sets `key: date` (`finance-ai.js:84`) and `mergeData` unions by `key` — so the "one snapshot per quarter" guarantee is enforced only by the write-time `hasThisQuarter` check, not by the merge key. Two devices snapshotting different days in the same quarter both persist. Matches code intent (manual snapshots are per-day) but contradicts the `'YYYY-Qn'` comment in `defaultData()`.

10. **`parseCatEmojis()` is called once per month** inside the `renderExpenseList` month loop (`finance-expenses.js:63`) instead of once. Trivial, but easy to hoist.

11. **`autoGenOngoingExpenses` updates `data.monthlyAgg` incrementally** rather than calling `recalcMonthlyAgg` (`finance-insurance.js:474`), duplicating the aggregation rule in a second place — a drift risk if the rule changes.

12. **`fetchBusStopCoords` does up to ~20 sequential proxied requests** on first map load (`$skip` 0→10000 step 500, `finance-events.js:368`). Cached afterward, but the first open is slow and entirely serial.

---

## Prioritized recommendations

1. **Fix `esc()` to also escape `'` and `` ` ``** (single, central fix that closes most injection vectors), or migrate inline `onclick('${id}')` handlers to event delegation. *(QA #1)*
2. **Guard `eventToMs` and default `startTime` on event import** so malformed data can't blank the Events tab; wrap each `renderX` in try/catch for failure isolation. *(QA #2, Arch #7)*
3. **Swap hardcoded chart colors for `var(--border)`/`var(--muted)`** so charts respect the active theme. *(QA #3)*
4. **Reconcile the two account-balance computations** and the `Other`-category inclusion so displayed numbers are internally consistent. *(QA #4, #7)*
5. **Extract a shared SVG line-chart helper and an asset-card partial**, and de-dupe the bus setup + auto/manual recurring functions — biggest maintainability win. *(Dev #1)*
6. **Update CLAUDE.md** (SW version, asset count, asset classes, `defaultData` shape) to stop future drift. *(Dev #6)*
7. Consider: excluding `class:'CPF'` assets from net worth, capping `_deletedIds`, and defaulting the bus path to the local proxy. *(Arch #3, #4, #5)*

Overall: a solid, thoughtfully-built personal app. The sync/merge core is production-quality; the rendering layer and input-handling are where the bugs and maintenance cost concentrate.
