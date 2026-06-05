# fixme — Finance PWA

Actionable issues from the code review (full write-up in `finance-review.md`). Grouped by severity. Check off as resolved.

## 🔴 High

- [x] **`esc()` doesn't escape single quotes → injection.** `esc()` (`finance-app.js:611`) escapes only `& < > "`. It's used inside single-quoted inline handlers in ~23 places (e.g. `setEventTagFilter('${esc(t)}')` `finance-events.js:66`; `openPowerSheet('${esc(r.id)}')`). Worse, `renderExpenseList` interpolates a **CSV-imported `id` with no escaping at all** (`finance-expenses.js:70`). A value containing `'` breaks out of the JS string and injects code (self-XSS, but real). **Fix:** extend `esc()` to also escape `'` and `` ` ``, or move handlers to `data-*` + event delegation.
- [x] **Event import without `startTime` crashes the whole Events tab.** Import validates only `id`/`title`/`startDate` (`finance-drive.js:112`), but `eventToMs()` dereferences `startTime.hour/.minute/.ampm` (`finance-events.js:2`); the failing sort blanks the entire list. **Fix:** default `startTime`/`endTime` on import and/or guard `eventToMs()`.

## 🟠 Medium

- [ ] **Charts hardcode earth-theme colors.** Grid `#e8dece` / text `#7a6a52` are hardcoded in every SVG chart (`finance-app.js:73-74`, `finance-tax.js:82-83`, `finance-ai.js:519-520`, etc.), so gridlines/labels clash under `theme-navy`/`theme-pastel`. **Fix:** use `var(--border)` / `var(--muted)` (as `renderPower` already does).
- [ ] **Month-header account balance ignores prior-year history.** Header balance uses current-year `data.expenses` only from `acc.startingBalance` (`finance-expenses.js:53-55`), while `acc.balance` from `recalcBalances` uses `allExpenses()` (history + current) (`finance-core.js:201`). The two diverge for any user with migrated history. **Fix:** reconcile to one basis / clarify `startingBalance` semantics.
- [x] **CPF double-counting in net worth.** `computeNetWorth()` (`finance-ai.js:46`) sums all assets **and** `latestCpfBalances().total`, so a `class:'CPF'` asset is counted twice. **Fix:** exclude `class:'CPF'` assets from the asset sum, or forbid CPF-as-asset.
- [x] **`confirmClearData()` resets history to `{ expenses: [] }`** (`finance-drive.js:88`), dropping `powerRecords` / future history collections — violates the documented historyData invariant. **Fix:** rebuild the full history shape like the import handler does.
- [x] **`migrateExpenses()` / sync filters assume `e.date` exists** (`finance-core.js:235`, `finance-drive.js:590`) and throw on a malformed/legacy entry. **Fix:** guard for missing `date`.
- [ ] **`Other` category silently excluded from monthly analysis** (`finance-app.js:527`) but included in the YTD pill and yearly chart, so totals don't reconcile across views. **Fix:** include `Other` consistently, or label the exclusion.

## 🟡 Low / polish

- [ ] **Dead code:** `balanceAtMonthStart()` / `balanceAtMonthEnd()` (`finance-expenses.js:2-14`) are never called. `renderInvestments()` (`finance-investments.js:264`) is no longer wired to any tab (assets render via `renderAssetsSubTab`). Remove or re-wire.
- [ ] **`openExpenseSheet` silently rewrites an unknown category to `Other`** (`finance-expenses.js:125-127`) on edit+save.
- [ ] **Net-worth snapshot `key` is the date, not the quarter** (`finance-ai.js:84`), contradicting the `'YYYY-Qn'` comment; "one per quarter" is enforced only by the write-time check, not the merge key.
- [ ] **`parseCatEmojis()` called once per month** inside the `renderExpenseList` loop (`finance-expenses.js:63`); hoist it.
- [ ] **`autoGenOngoingExpenses` updates `monthlyAgg` by hand** instead of `recalcMonthlyAgg` (`finance-insurance.js:474`) — duplicate aggregation rule, drift risk.
- [ ] **First bus-map load does ~20 serial proxied requests** (`fetchBusStopCoords`, `finance-events.js:368`). Cached after, but slow on first open.

## 🏗 Architecture / tech-debt (no single line)

- [ ] **De-duplicate SVG chart scaffolding.** Grid/ticks/axis/path building is reimplemented ~7× across `finance-app/tax/ai`. Extract one `lineChart()` helper (also fixes the theme-color issue centrally).
- [ ] **De-duplicate** asset-card markup (`renderInvestments` vs `renderAssetsSubTab`), bus API-setup UI (`renderBusPanel` vs `renderBusMapPanel`), and `autoGen`/`manualGen` recurring functions.
- [ ] **Move repeated inline styles to CSS classes** in `finance.css` to shrink the JS and keep theming consistent.
- [ ] **Failure isolation:** wrap each `renderX` in try/catch so one bad record can't blank a tab.
- [ ] **`_deletedIds` grows unbounded** — cap or age out tombstones.
- [ ] **Secret exposure:** bus path defaults to public `corsproxy.io` carrying the LTA `AccountKey` (`finance-events.js:240`), and `busApiKey` is written into the synced Drive file (`finance-drive.js:640`). Decide/flag intentionally; consider defaulting to the local proxy.
- [ ] **No tests.** Consider a minimal harness for the pure logic (`mergeData`, `calcSGTax`, `calcCpfProjection`, `calcRetirementPlan`, recurring date math).
