# fixme — Finance PWA

Actionable issues from the code review (full write-up in `finance-review.md`). Grouped by severity. Check off as resolved.

## 🟡 Low / polish

- [x] **Dead code:** `balanceAtMonthStart()` / `balanceAtMonthEnd()` (`finance-expenses.js:2-14`) are never called. `renderInvestments()` (`finance-investments.js:264`) is no longer wired to any tab (assets render via `renderAssetsSubTab`). Remove or re-wire.
- [x] **`openExpenseSheet` silently rewrites an unknown category to `Other`** (`finance-expenses.js:125-127`) on edit+save.
- [x] **Net-worth snapshot `key` is the date, not the quarter** (`finance-ai.js:84`), contradicting the `'YYYY-Qn'` comment; "one per quarter" is enforced only by the write-time check, not the merge key.
- [x] **`parseCatEmojis()` called once per month** inside the `renderExpenseList` loop (`finance-expenses.js:63`); hoist it.
- [x] **First bus-map load does ~20 serial proxied requests** (`fetchBusStopCoords`, `finance-events.js:368`). Cached after, but slow on first open.

## 🏗 Architecture / tech-debt (no single line)

- [ ] **De-duplicate SVG chart scaffolding.** Grid/ticks/axis/path building is reimplemented ~7× across `finance-app/tax/ai`. Extract one `lineChart()` helper (also fixes the theme-color issue centrally).
- [ ] **De-duplicate** asset-card markup (`renderInvestments` vs `renderAssetsSubTab`), bus API-setup UI (`renderBusPanel` vs `renderBusMapPanel`), and `autoGen`/`manualGen` recurring functions.
- [ ] **Move repeated inline styles to CSS classes** in `finance.css` to shrink the JS and keep theming consistent.
- [x] **`_deletedIds` grows unbounded** — cap or age out tombstones.
- [ ] **Secret exposure:** bus path defaults to public `corsproxy.io` carrying the LTA `AccountKey` (`finance-events.js:240`), and `busApiKey` is written into the synced Drive file (`finance-drive.js:640`). Decide/flag intentionally; consider defaulting to the local proxy.
- [ ] **No tests.** Consider a minimal harness for the pure logic (`mergeData`, `calcSGTax`, `calcCpfProjection`, `calcRetirementPlan`, recurring date math).
