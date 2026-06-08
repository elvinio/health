# Finance PWA — Code Review (2026-06)

Full read-through of the finance PWA: `finance.html`, `finance.css`, `sw.js`, `manifest.json`, and the 10 `finance-*.js` modules (~8,800 lines). Three lenses — **developer** (cleanliness/maintainability), **architect** (structure/bottlenecks/responsiveness), **QA** (bugs). No code was changed.

Findings marked **✓ verified** were confirmed by reading the cited lines directly; the rest are high-confidence from a structured pass and are worth a quick confirm before acting.

> Note: a prior `finance-review.md` exists in the repo. It is partly **stale** — it lists "`esc()` doesn't escape single quotes" as the #1 issue, but `esc()` was since hardened (see Doc Drift below). This report supersedes that point.

---

## Executive summary

For a no-build, no-framework, offline-first vanilla-JS PWA, this is genuinely capable: bidirectional Drive sync with conflict-resolved merges, careful deletion propagation, and a lot of correct domain logic (SG tax / CPF / retirement). The data + merge layer is the strongest part of the codebase.

The issues that actually matter, in order:

1. **One shipped, visible bug:** the Net Worth chart markup uses Unicode curly quotes and renders broken. **(Critical, ✓ verified)**
2. **Two silent data-loss paths in Drive sync/import** — deleted records resurrect on history import, and asset `units`/`class` edits from a partner device are lost. **(High, ✓ verified)**
3. **A class of render functions that throw on malformed/imported data and blank the whole tab** (whole-tab `innerHTML` rebuild means one bad record = blank screen). **(High, ✓ verified for events)**
4. **Responsiveness is phone-only** — zero media queries, no keyboard focus styling, no `role="tab"` semantics. Works great on a phone, poor on tablet/desktop and for a11y. **(High)**
5. **Performance:** every mutation re-serializes the whole dataset and rebuilds the active tab's `innerHTML`; CPF sliders do this on every `oninput` tick. Fine today, a latent bottleneck. **(Medium)**

Good news that changes the threat picture: the **single-quote XSS class is largely closed** — `esc()` now escapes `'` and `` ` `` (verified), contrary to CLAUDE.md / `fixme.md` / the old review. Residual risk only exists where `esc()` isn't applied at all, on app-generated values.

---

## 1. QA — Bugs (by severity)

### Critical

**B1. Net Worth chart renders broken — Unicode curly quotes in HTML/SVG attributes. ✓ verified**
`finance-ai.js:517-523`. The markup uses `”`/`“` (U+201D/U+201C) instead of `"`: `class=”chart-wrap”`, `style=”…”`, etc. Browsers won't parse these as quoted attributes — classes/styles are dropped and the chart section of the AI card is malformed. Wired live via `renderNetWorthChart()` → `renderAiReport()` (`finance-ai.js:544`). Introduced by the #122 "move inline styles to CSS classes" refactor. **This is a real, shipped, user-visible defect.**

### High

**B2. History import resurrects deleted records. ✓ verified**
`finance-drive.js:70`. The `historyImportFile` handler replaces `historyData.expenses` wholesale with the file's contents and sets a fresh `_updatedAt`, with **no filter against `data._deletedIds`**. A previously-deleted expense present in the imported file comes back and then propagates to the partner on the next sync. (It does correctly carry `powerRecords`, per the documented pattern — just not the deletion filter.)

**B3. Asset `units`/`class` sync is "local-non-null-wins", losing partner edits. ✓ verified**
`finance-drive.js:241-244`. Unlike `name` (which compares `_nameTs`), `units` and `class` have no timestamp: `if (localAsset.units != null) existing.units = localAsset.units`. If the partner updates `units`/`class` and you never touched yours, your stale-but-non-null value wins and their edit is silently lost. Add `_unitsTs`/`_classTs` or reuse a timestamp comparison.

**B4. Event render throws on a timeless event → blanks the entire Events tab. ✓ verified**
`finance-events.js:13` (`ev.startTime.minute`), also `:99-100`, `:711-712`. `eventToMs()` (line 3) explicitly guards `!ev.startTime`, but `fmtEventDateTime()` and the item/calendar renderers dereference `ev.startTime.minute`/`.hour`/`.ampm` with no guard. One imported/synced all-day event without a `startTime` object throws, and because `renderAll()` rebuilds the whole tab's `innerHTML`, the **entire Events tab goes blank**.

**B5. Unguarded `data._deletedIds.push` crashes deletes on legacy data. ✓ verified (pattern)**
Inconsistent guarding: `deleteNote` (`finance-events.js:962`) and `deleteOngoing` (`finance-insurance.js:359`) guard `if (!data._deletedIds) data._deletedIds = []`, but `deleteEvent` (`finance-events.js:838`), `deleteCpfRecord` (`finance-tax.js:721`), `deleteTaxRecord` (`:947`), `deleteInsurance`, `deleteMedical`, `deleteAsset`, `deleteMortgage`, `deleteExpense` push without it. On data missing `_deletedIds` (legacy/partial import), the delete throws, the record isn't removed, and the sheet stays open.

**B6. Tax PIN gate provides no real protection. ✓ verified**
`finance-tax.js:1-50`. PIN is plaintext in `localStorage['finance:taxPin']`; `taxPinUnlocked` is a plain JS global; `maybeShowTaxPin()` only toggles `taxPinOverlay.style.display` over content that `renderTaxRecords()`/`renderCpf()` have **already rendered into the DOM**. Anyone can read the PIN in devtools, set `taxPinUnlocked = true` in the console, or inspect the DOM directly. For a single-user local PWA there's arguably no threat model — but the feature *implies* protection it doesn't provide. Either drop the pretense or gate actual rendering.

**B7. CPF projection ignores bonus and wage growth; can produce materially wrong retirement numbers.**
`finance-tax.js:149-152`. Contributions are modelled from `basicSalary` only (bonus/`otherIncome` ignored), the last record's salary is applied flat to every future year with no growth, and there's no Additional-Wage ceiling. Everything downstream (FRS/ERS attainment, the whole retirement plan via `calcRetirementPlan`) inherits the error for anyone with bonuses or raises.

### Medium

**B8. Timezone inconsistency: all-day vs timed events. ✓ verified**
`finance-events.js:3` vs `:6-7`. Timeless events use `new Date(ev.startDate).getTime()` (parses as **UTC** midnight), timed events build a **local** Date. In UTC+8, `new Date('2026-06-08')` is `2026-06-08 08:00` local — so all-day events can sort/display on the wrong day relative to timed ones. Related: `finance-events.js:104` uses UTC `toISOString().slice(0,10)` for "today" highlighting while `:177`/`:647` use local `today()` — they disagree for ~8h around midnight.

**B9. CPF relief can be double-counted.** `finance-tax.js:732-735`. `calcEffectiveTax` subtracts `r.cpfEmployee` *and* every row in the reliefs array. A user who enters CPF relief both in the dedicated field and as a manual relief row understates chargeable income twice. No validation.

**B10. Two divergent CPF RA-formation implementations.** `finance-tax.js:102-123` (`simulateSAOAtoRetire`, can pull RA from OA) vs the inline loop `:185-242` (forms RA from SA only). Reconciled by hand via snapshots; easy to drift. Same family: `calcSaProjectionRows` uses a hardcoded `102000` salary while the main projection uses the user's `basicSalary` — the two will disagree.

**B11. Asset-history dedup key can collide.** `finance-drive.js:250`. For legacy entries without `_ts`, the key is `h.date + h.value` (string concat, no delimiter) — distinct entries can merge into one. Use a delimiter and/or guarantee `_ts`.

**B12. `monthlyAgg` uploaded to Drive is current-year-only.** `finance-drive.js:468`. `mergeData` recomputes `monthlyAgg` from `merged.expenses` (current year) and uploads that; the correct multi-year recompute via `allExpenses()` happens *after* upload (`:596`). Self-healing because each device recomputes locally, but the data sitting in Drive is truncated.

**B13. `mergeData` doesn't carry `historyUpdatedAt`.** `finance-drive.js:425-466`. Works only because `driveSync` re-sets it afterward; any other caller of `mergeData` (it's in the test harness) yields `historyUpdatedAt === undefined` → treated as `0` → forces an unnecessary history merge/upload every sync.

**B14. `_deletedIds` FIFO-capped at 500 → deletions can resurrect at scale.** `finance-core.js:179`. Oldest tombstones drop past 500; if a device syncs after a long gap, an aged-out deletion resurrects via union merge. Prefer time-based tombstone GC.

### Low (selected)

- **B15.** `getCurrentTermWeek` never clamps to term end — shows ever-growing "Week 40" labels out of term (`finance-events.js:43`).
- **B16.** `loadLeaflet` has `onload` but no `onerror` — offline/CDN failure leaves the bus-map view silently dead, no toast (`finance-events.js:499-509`). Hard online dependency in an offline-first app.
- **B17.** `if (!lat || !lng) return` treats legitimate `0` lat/long as invalid; `busMapSetCenter` accepts out-of-range coords (`finance-events.js:565-572,592-594`).
- **B18.** Snapshot can be created on load (`recordNetWorthSnapshot()` at `finance-ai.js:558` → `saveData`), i.e. merely opening the app mutates+persists data and can churn sync at a quarter boundary.
- **B19.** Reminders rely on in-page `setTimeout` (lost when the PWA is closed) and silently never schedule beyond the 7-day `MAX_DELAY` cap (`finance-events.js:864-888`). Unreliable by design — worth a comment.

---

## 2. Architect — Architecture, performance, responsiveness

### Responsiveness & accessibility (High — biggest gap after the bugs)

**A1. Zero media queries — the app is phone-only.** `finance.css` (entire file). The only adaptivity is `.page { max-width:640px; margin:0 auto }` plus `dvh` units. On tablet/desktop the whole UI is a narrow phone column in an empty viewport, and bottom sheets remain glued to the bottom edge — the wrong interaction model on a large screen. It's responsive *down*, nothing *up*.

**A2. No keyboard focus indicator anywhere (WCAG 2.4.7 fail).** Inputs do `outline:none` and signal focus only via border-color; buttons, tabs, sub-tabs, FAB, dropdown items, PIN pad, theme options have **no** `:focus`/`:focus-visible` styling at all. There is no `:focus-visible` rule in the stylesheet.

**A3. Tabs aren't exposed as a tablist.** `finance.html:21-47`. Tab buttons use `data-tab` + `aria-label` but no `role="tablist"`/`role="tab"`/`aria-selected`. Screen-reader users get five unrelated buttons with no active-state cue. Same for all four sub-tab groups.

**A4. Fixed-width PIN pad overflows narrow screens.** `finance.css:883-886`. `grid-template-columns: repeat(3, 72px)` + gaps + modal padding ≈ 288px min — overflows ~280px / split-screen devices. Use `minmax()`/`aspect-ratio`.

**A5. Other narrow-screen risks:** toast is `white-space:nowrap` with no `max-width` (long messages clip off-screen, `finance.css:389-397`); several touch targets below 44px (`.iconbtn` 40px, event-view/bus-refresh/cal-nav buttons ~28-30px); no `prefers-reduced-motion` guard for the pulsing/shake/spin animations.

*Positives, verified:* `viewport-fit=cover` + `env(safe-area-inset-*)` applied correctly to body/tabs/FAB/sheet/toast; `dvh` used instead of `vh` (avoids iOS URL-bar jump); inputs at `16px` (prevents iOS zoom-on-focus); tables wrapped in `overflow-x:auto`.

### Service worker / PWA

**A6. Cache-first with no revalidation — a missed version bump strands users on old code permanently.** `sw.js:63-65` is pure `caches.match() || fetch()`. Cached URLs are *never* re-checked against the network, so the whole reliability model rests on manually bumping `CACHE` in every change (the docs stress this precisely because the strategy is fragile). Recommend stale-while-revalidate for JS/CSS, or network-first for the HTML navigation. ASSETS list verified complete vs HTML references; no missing-asset bug.

### Performance / scaling

**A7. Whole-dataset re-serialization on every mutation.** `finance-core.js:182,200`. `saveData`/`saveHistory` `JSON.stringify` the entire blob on every write, paired with a full active-tab `innerHTML` rebuild in `renderAll()`. O(everything) per keystroke-driven save; destroys DOM (loses scroll/focus). Fine at personal scale, janky as years accumulate.

**A8. CPF sliders recompute + persist on every `oninput` tick.** `finance-tax.js:523-555`. Dragging a CPF slider fires `saveData` (serialize + write) **and** `renderCpf` (full year-by-year projection, two `simulateSAOAtoRetire` passes, SVG build, DOM replace) on every pixel. The retirement sliders correctly use `onchange` (fires on release) — the CPF sliders should too.

**A9. `mergeData` asset loop is O(n²).** `finance-drive.js:235-236` runs `local.assets.find()` + `remote.assets.find()` inside the per-asset `forEach`. Pre-build Maps like the other collections do.

**A10. Calendar/bus hot paths:** `renderEventCalendar` rebuilds the full event-by-date map for the entire dataset on every month flip (`finance-events.js:656-666`); `refreshBusMapMarkers` tears down and recreates every Leaflet marker every 30s alongside high-accuracy `watchPosition` (battery drain, `:574-622`).

**A11. Bus polling not stopped on top-level tab switch.** `finance-events.js:249-265`. Intervals are cleared only inside `setEventView()`. Leaving Events via a *top-level* tab (not a view button) leaves the 60s bus poll, 30s map poll, and geolocation watch running with no visible panel.

**A12. `buildAiSummary` rebuilt 2-3× per action, no memoization;** internally calls `computeCashflow()` twice (`finance-ai.js:228,261`). `calcCpfProjection`'s memo key is a `JSON.stringify` of settings+records (`finance-tax.js:131-133`) whose cost approaches the compute it's avoiding — a version counter would be cheaper.

---

## 3. Developer — Cleanliness & maintainability

**D1. Large-scale duplication (top maintenance cost).**
- **SVG chart scaffolding** re-implemented ~7× (`renderCategoryChart`, `renderYearlyChart`, `renderAssetMortgageChart`, `renderTaxChart`, `renderCpfChart`, `renderNetWorthChart`, `renderPower`). A single `lineChart()` helper removes hundreds of lines — and would have prevented B1.
- **Last-writer-wins blocks** in `mergeData` (~10 near-identical `(localTs >= remoteTs) ? … : …` + `Math.max`, `finance-drive.js:276-423`) → one `lww(local, remote, field, tsField)` helper.
- **Recurring due-date math** implemented twice and divergently: `getOngoingDueInfo` vs `getOngoingNextDue` (`finance-insurance.js:367-442`); auto vs manual recurring generators ~95% identical.
- **CPF/SRS projection math** spread across `calcSaProjectionRows`, `calcCpfLifePayoutForPerson`, the inline projection loop, `simulateSAOAtoRetire`, `calcSrsBalance62ForPerson` — four+ places that already disagree on salary assumptions.
- **Triple wrapper pattern** `renderXListInto/List/Inline` copied for ongoing and mortgage lists.

**D2. Dead / legacy code.** `renderInvestments()` (documented dead), `renderTermWeekBanner` always hides its element yet is still called (`finance-events.js:47-50,175`), `ongoingListSheet` modal path superseded by the inline sub-tab, `balanceAtMonthStart/End` defined-but-unused (per prior review), CSS `.portfolio-*` styles for the dead investments view.

**D3. Hardcoded hex colors bypass the theme system.** `finance.css:138-139,244-246,468-471,543,588,603,613`. Event today/tomorrow blues (`#dbeafe`/`#eff6ff`) are off-palette and lower-contrast on the earth/pastel themes — a real cross-theme visual bug — and use four `!important`s to win specificity. Move to `--var`s.

**D4. CSS duplication.** Four byte-identical sub-tab style blocks (`.analysis-sub-tabs`/`.exp-sub-tabs`/`.ins-sub-tabs`/`.tax-sub-tabs`, `finance.css:85-109,166-177,774-785`) → one `.sub-tabs`/`.sub-tab`. `.btn-block` and `.btn-full` are identical. Mixed 2-space vs flush-left indentation signals append-without-formatter growth.

**D5. Heavy inline-style strings generated in JS.** Despite the "no inline CSS in HTML" rule, the render functions emit huge repeated `style="…"` blobs (card wrappers, stat rows, the Drive modal in `finance.html:867-918`). Bloats every rebuilt `innerHTML` and can't be tuned by a future media query.

**D6. Magic numbers in financial logic.** `ERS_2026=440800`, `annualSalary=102000`, `SRS 15300`, SA ratios only in a footnote string, base year `2026`, default `annualSavings 150000` (repeated 3×), poll intervals `60000`/`30000`, focus `setTimeout(…, 350)` (~8×), `30.44*24*3600*1000` avg-month. Annual statutory updates (FRS/ERS/OW ceiling/SRS cap) require hunting across files.

**D7. Misplaced ownership / minor.** Event/calendar state vars (`eventViewMode`, `calYear`, `calMonth`…) live in `finance-expenses.js:208-215`; non-ASCII Greek identifiers in `computeBearing` (`finance-events.js:490-497`); `aria-labelledby` IDs inconsistently kebab vs camel; sparse comments exactly where logic is trickiest (expense-move branching, budget rebuild).

---

## 4. Documentation drift (act on this — it misleads reviewers)

- **`esc()` now escapes `'` and `` ` `` ✓ verified** (`finance-app.js:601`: `…replace(/'/g,'&#39;').replace(/\`/g,'&#96;')`). But **CLAUDE.md**, **`fixme.md`**, and the existing **`finance-review.md`** all still state it escapes "only `& < > "`". This is dangerous in both directions — reviewers may add redundant escaping or, worse, "fix" something based on a false premise. The single-quote inline-handler XSS class flagged repeatedly by the old review is **largely closed**; residual risk is only on raw interpolations that skip `esc()` entirely (`finance-expenses.js:70` `${month}`, `:243/246` `${y}`, `finance-insurance.js:277` `${o.id}`) — all app-generated (uid / date slices), so Low. Recommend: update the three docs, and either route the few raw interpolations through `esc()` or switch to `data-*` + delegation for consistency.
- The existing `finance-review.md` is otherwise still a useful companion (its duplication catalogue overlaps and corroborates D1).

---

## 5. Prioritized fix list

| # | Sev | Fix | Location |
|---|-----|-----|----------|
| 1 | Critical | Replace curly quotes with `"` in the net-worth chart | `finance-ai.js:517-523` |
| 2 | High | Filter history import against `_deletedIds` | `finance-drive.js:70` |
| 3 | High | Timestamp-resolve asset `units`/`class` (don't always prefer local) | `finance-drive.js:241-244` |
| 4 | High | Null-guard `ev.startTime` in all event renderers | `finance-events.js:13,99-100,711-712` |
| 5 | High | Guard `data._deletedIds` in every `delete*` (or centralize) | multiple |
| 6 | High | Add tablet/desktop media queries; `:focus-visible`; `role="tab"`/`aria-selected` | `finance.css`, `finance.html` |
| 7 | High | Include bonus/wage-growth + AW ceiling in CPF projection | `finance-tax.js:149-152` |
| 8 | Med | Switch CPF sliders from `oninput` to `onchange` | `finance-tax.js:523-555` |
| 9 | Med | Stale-while-revalidate (or network-first HTML) in SW | `sw.js:63-65` |
| 10 | Med | Stop bus/geolocation polling on top-level tab switch | `finance-events.js` |
| 11 | Med | Fix UTC-vs-local "today"/all-day date handling | `finance-events.js:3,104` |
| 12 | Med | Update CLAUDE.md / fixme.md / finance-review.md re `esc()` | docs |
| — | Low/Refactor | `lineChart()` + `lww()` helpers; collapse duplicated CPF/recurring/sub-tab code; theme-variable the hardcoded hexes | various |

---

## 6. What's done well

- **Sync design** is thoughtful: union-by-ID merges, cross-store dedup, the "never upload without merging first" invariant, deletion tombstones.
- **Storage migrations** in `loadData()` upgrade old blobs defensively.
- **Mobile fundamentals** (safe-area insets, `dvh`, 16px inputs, overflow-x table scrollers) are correctly handled.
- **`renderMarkdownLite` is XSS-safe** for current input — `esc()` runs before every interpolation (✓ verified ordering); the only defects are cosmetic (italic/table edge cases).
- Consistent, learnable idioms (`openSheet`/`closeSheet`, `uid()`, the "insurance pattern") make the codebase approachable despite its size.
- A real (if minimal) test harness exists for the pure logic.
