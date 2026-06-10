# fixme — Finance PWA

Actionable issues from the 2026-06 code review (developer / architect / QA lenses). Grouped by severity. Check off as resolved. Findings marked **✓** were verified against source during the review.

## 🟠 High

- [ ] **Tax PIN gate provides no real protection** ✓ (`finance-tax.js:1-50`). PIN is plaintext in `localStorage`; `taxPinUnlocked` is a plain global; `maybeShowTaxPin()` only toggles `taxPinOverlay.style.display` over content already rendered into the DOM. Bypassable via devtools/console/DOM. Either gate actual rendering or drop the implied protection.
- [ ] **CPF projection ignores bonus + wage growth** (`finance-tax.js:149-152`). Contributions modelled from `basicSalary` only, last salary applied flat with no growth, no Additional-Wage ceiling. Skews FRS/ERS attainment and the whole retirement plan downstream.
- [ ] **Responsiveness: phone-only.** No media queries anywhere in `finance.css` — tablet/desktop is a narrow phone column; bottom sheets stay glued to the bottom edge. Add tablet/desktop breakpoints.
- [ ] **No keyboard focus indicator (WCAG 2.4.7 fail).** Inputs do `outline:none`; buttons/tabs/sub-tabs/FAB/dropdown/PIN pad/theme options have no `:focus`/`:focus-visible` styling. Add a global `:focus-visible` rule.
- [ ] **Tabs not exposed as a tablist** (`finance.html:21-47`). No `role="tablist"`/`role="tab"`/`aria-selected` on the tab bar or the four sub-tab groups.

## 🟡 Medium

- [ ] **CPF sliders recompute + persist on every `oninput` tick** (`finance-tax.js:523-555`) — full projection + two `simulateSAOAtoRetire` passes + SVG build + `saveData` per pixel of drag. Switch to `onchange` like the retirement sliders already do.
- [ ] **Service worker is cache-first with no revalidation** (`sw.js:63-65`). Cached URLs are never re-checked, so a single missed `CACHE` bump strands users on old code permanently. Move to stale-while-revalidate (JS/CSS) or network-first (HTML navigation).
- [ ] **Bus/geolocation polling not stopped on top-level tab switch** (`finance-events.js:249-265`). Intervals clear only inside `setEventView()`; leaving Events via a top-level tab leaves the 60s bus poll, 30s map poll, and high-accuracy `watchPosition` running with no visible panel.
- [ ] **UTC-vs-local "today" / all-day date handling** ✓ (`finance-events.js:3` vs `:6-7`; `:104` vs `:177`/`:647`). Timeless events parse as UTC midnight, timed events as local; "today" highlighting uses UTC `toISOString().slice(0,10)` while the list split uses local `today()`. They disagree for ~8h around midnight in UTC+8.
- [ ] **CPF relief can be double-counted** (`finance-tax.js:732-735`). `calcEffectiveTax` subtracts `r.cpfEmployee` *and* the reliefs array; entering CPF relief in both places understates chargeable income twice. No validation.
- [ ] **Two divergent CPF RA-formation implementations** (`finance-tax.js:102-123` vs `:185-242`); `calcSaProjectionRows` uses a hardcoded `102000` salary while the main projection uses the user's `basicSalary`. Single source of truth needed.
- [ ] **Asset-history dedup key can collide** (`finance-drive.js:250`). Legacy entries without `_ts` key on `h.date + h.value` (no delimiter) — distinct entries can merge. Use a delimiter and/or guarantee `_ts`.
- [ ] **`monthlyAgg` uploaded to Drive is current-year-only** (`finance-drive.js:468`). `mergeData` recomputes from `merged.expenses` and uploads before the correct `allExpenses()` recompute at `:596`. Self-healing locally, but Drive data is truncated.
- [ ] **`mergeData` doesn't carry `historyUpdatedAt`** (`finance-drive.js:425-466`). Works only because `driveSync` re-sets it; any other caller yields `undefined` → treated as `0` → forces an unnecessary history merge/upload every sync.
- [ ] **`_deletedIds` FIFO-capped at 500 → deletions can resurrect at scale** (`finance-core.js:179`). Prefer time-based tombstone GC.
- [ ] **`buildAiSummary` rebuilt 2-3× per action, no memoization**; calls `computeCashflow()` twice (`finance-ai.js:228,261`). `calcCpfProjection`'s `JSON.stringify` memo key cost approaches the compute it avoids (`finance-tax.js:131-133`).
- [ ] **CPF/AI summary asset inconsistency.** `computeNetWorth()` excludes CPF-class assets (correct), but `buildAiSummary()` includes them — the AI gets a CPF-double-counted asset total inconsistent with net worth (`finance-ai.js:169-177`).
- [ ] **Calendar/bus hot paths.** `renderEventCalendar` rebuilds the full event-by-date map for the entire dataset on every month flip (`finance-events.js:656-666`); `refreshBusMapMarkers` tears down + recreates every Leaflet marker every 30s (`:574-622`).
- [ ] **Fixed-width PIN pad overflows narrow screens** (`finance.css:883-886`, `repeat(3, 72px)` ≈ 288px min). Use `minmax()`/`aspect-ratio`.
- [ ] **User-entered email-parser regex stored unvalidated** (`finance-gmail.js` editors). No `new RegExp()` validity check or ReDoS guard — a bad pattern throws/hangs at match time with no edit-time feedback.

## 🟢 Low / polish

- [ ] **`loadLeaflet` has no `onerror`** (`finance-events.js:499-509`) — offline/CDN failure leaves the bus-map view silently dead in an offline-first app.
- [ ] **`getCurrentTermWeek` never clamps to term end** (`finance-events.js:43`) — shows ever-growing "Week 40" out of term.
- [ ] **`if (!lat || !lng) return`** treats legitimate `0` lat/long as invalid; `busMapSetCenter` accepts out-of-range coords (`finance-events.js:565-572,592-594`).
- [ ] **Snapshot persisted on load** (`finance-ai.js:558` → `saveData`) — opening the app mutates+persists data and can churn sync at a quarter boundary.
- [ ] **Reminders use in-page `setTimeout`** (lost when PWA closes) and silently never schedule beyond the 7-day `MAX_DELAY` cap (`finance-events.js:864-888`). Document the limitation.
- [ ] **`renderMarkdownLite` cosmetic defects** (`finance-ai.js:421-474`) — italic/`***`/unbalanced-`*` nesting and header-less pipe tables mis-render. (XSS-safe ✓ — `esc()` runs before every interpolation.)
- [ ] **Residual raw interpolations skipping `esc()`** — `finance-expenses.js:70` `${month}`, `:243/246` `${y}`, `finance-insurance.js:277` `${o.id}`. App-generated (uid/date slices) so low risk; route through `esc()` or use `data-*` + delegation for consistency.
- [ ] **Touch targets below 44px** — `.iconbtn` 40px; event-view/bus-refresh/cal-nav buttons ~28-30px. No `prefers-reduced-motion` guard for pulsing/shake/spin animations. Toast `white-space:nowrap` with no `max-width` clips long messages (`finance.css:389-397`).

## 🏗 Architecture / tech-debt (no single line)

- [ ] **De-duplicate SVG chart scaffolding** — grid/ticks/axis/path reimplemented ~7× across `finance-app/tax/ai` (`renderCategoryChart`, `renderYearlyChart`, `renderAssetMortgageChart`, `renderTaxChart`, `renderCpfChart`, `renderNetWorthChart`, `renderPower`). One `lineChart()` helper removes hundreds of lines (and would have prevented the curly-quote bug).
- [ ] **De-duplicate `mergeData` last-writer-wins blocks** (~10 near-identical blocks, `finance-drive.js:276-423`) → one `lww(local, remote, field, tsField)` helper. Pre-build asset Maps to kill the O(n²) `find()`-in-`forEach` (`:235-236`).
- [ ] **De-duplicate recurring due-date math** — `getOngoingDueInfo` vs `getOngoingNextDue` (`finance-insurance.js:367-442`) diverge; share one date-stepping helper.
- [ ] **De-duplicate CPF/SRS projection math** spread across `calcSaProjectionRows`, `calcCpfLifePayoutForPerson`, the inline projection loop, `simulateSAOAtoRetire`, `calcSrsBalance62ForPerson`.
- [ ] **Whole-dataset re-serialization + full-tab `innerHTML` rebuild on every mutation** (`finance-core.js:182,200` + `renderAll`). Latent bottleneck as data grows; destroys scroll/focus.
- [ ] **Theme system bypassed by hardcoded hexes** (`finance.css:138-139,244-246,468-471,543,588,603,613`). Event today/tomorrow blues are off-palette/low-contrast on earth/pastel themes and use four `!important`s. Move to `--var`s.
- [ ] **CSS duplication** — four byte-identical sub-tab blocks (`finance.css:85-109,166-177,774-785`) → one `.sub-tabs`/`.sub-tab`; `.btn-block` == `.btn-full`.
- [ ] **Dead/legacy code** — `renderInvestments()`, `renderTermWeekBanner` (always hides yet still called, `finance-events.js:47-50,175`), `ongoingListSheet` modal path, `.portfolio-*` CSS.
- [ ] **Magic numbers in financial logic** — `ERS_2026=440800`, `annualSalary=102000`, `SRS 15300`, SA ratios only in a footnote string, base year `2026`, default `annualSavings 150000` (×3), poll intervals, focus `setTimeout(…,350)` (×8). Annual statutory updates require cross-file hunting.
