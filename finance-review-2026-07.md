# Finance PWA Review — July 2026

Three-perspective review of the Finance PWA (`finance.html`, `finance.css`, `sw.js`, 12 `finance-*.js` files, ~10.5k lines):

1. **Software developer** — is the architecture and design optimal?
2. **Finance advisor** — what is missing that would improve the financial overview?
3. **QA** — bugs and errors.

No code was changed; this report is the deliverable. Every finding was verified against the current source. The test suite passes (50/50, `npm test`).

**Relationship to `fixme.md`:** this repo already contains a detailed review (`fixme.md`). This report does **not** repeat it. Section 3.1 audits which of its findings are actually fixed in today's code, Section 3.2 lists **new** bugs found in this pass, and Section 2 (finance advisor) is entirely new ground — `fixme.md` had no product/feature perspective.

---

## Executive summary

- **Architecture:** deliberately unconventional (no build step, 12 plain scripts in one global scope) and — *for this app's constraints* — close to optimal. The Drive sync v2 design (metadata file + opaque-token watermarks + gzip + merge-before-upload + tombstones) is genuinely well engineered and better than most hand-rolled sync. The structural taxes that remain are the ones inherent to the style: load-order coupling, innerHTML-rebuild rendering with ~100 inline handlers, convention-enforced invariants, and derived data (`monthlyAgg`, `balance`) persisted and synced instead of computed.
- **Fix velocity is real:** of the 10 high-severity bugs in `fixme.md`, **all 10 are fixed** in the current code, plus about half the mediums. The remaining open items are mostly operational (no optimistic concurrency, silent SW rollout, recurring-expense duplication across devices).
- **Biggest product gaps for a finance overview:** no income ledger (income is inferred from a tax estimate), insurance tracks premiums but **not coverage amounts**, SRS balances are recorded but excluded from net worth, no emergency-fund/runway KPI, and — most important operationally — **no local export/backup of the data at all** (the storage-full toast literally tells the user to "export your data", but no export exists).
- **New bugs found:** 10 (one medium-severity sync-tombstone ordering issue, a cache-destruction path that bypasses the carefully-written SW whitelist, a lingering family of UTC-date bugs, and several small ones). Nothing data-destroying at high severity — the dangerous paths flagged last time are now guarded.

---

## 1. Software developer — architecture & design

### 1.1 What is right (keep it)

- **No-build static deployment** is the correct call for a personal, GitHub-Pages-hosted, 2-user app. Zero toolchain = zero bitrot. A framework or bundler would cost more than it returns here.
- **Drive sync v2** (`finance-drive.js`) is the strongest subsystem:
  - The tiny metadata file + per-store watermarks means a no-op sync is one small GET, and idle devices never ping-pong versions. Using **equality of opaque tokens** instead of `>` comparisons makes the design immune to cross-device clock skew — a subtle trap most sync implementations fall into.
  - "Never upload without merging first" is now actually enforced (transient download failures skip the upload instead of clobbering remote — the old H2 hole is closed).
  - Metadata written **last**, field-merged after re-download — crash-safe ordering with the failure mode being harmless re-sync, not data loss.
  - Edits made during the upload window are folded back in (`interim` handling) — the old H3 hole is closed.
- **Data partitioning** (main / history / wiki as separate localStorage keys and separate gzipped Drive files) keeps the hot blob bounded to one year of expenses and was the right response to blob growth.
- **The vm test harness** (`tests/harness.js`) is a clever answer to "no module exports": the most dangerous code (merge logic, tax math, recurring date math) is exactly the code with tests. 50 tests, all passing.
- **XSS posture** is now disciplined: `esc()` everywhere user data is interpolated, `renderMarkdownLite` is escape-first, and the two stored-XSS sinks from the previous review are fixed.

### 1.2 Where the design is not optimal

These are structural, not bugs — ranked by ongoing cost:

1. **Convention-enforced invariants.** "Always `saveHistory` then `saveData`", "always tombstone deletes", "bump the SW cache version", "add a merge block for every new collection" live only in CLAUDE.md and reviewer discipline. Each has already produced at least one real bug historically. The cheapest structural fix is to centralize: one `deleteRecord(collection, id)` helper that tombstones + saves + re-renders (there are ~9 near-identical delete functions today, and `deleteOngoing` in `finance-insurance.js` orders its steps differently from the rest); one `COLLECTIONS` table driving `mergeData`/tombstone filters so a new collection is a one-line addition.
2. **Derived data is persisted and synced.** `monthlyAgg` and `accounts[].balance` are recomputed from source on every load *and* stored in the blob *and* merged across devices. That is a cache that can only be stale or redundant — the uploaded `monthlyAgg` is in fact wrong around year boundaries (fixme L10, still open). Dropping both from the stored/synced shape and computing on load would delete ~40 lines and a whole class of staleness questions.
3. **Load-order coupling in one global scope.** `finance-core.js` (loaded first) wires the tab bar and FAB to functions defined in six later files; `esc()` lives in the *last-loaded* file yet is called by every earlier file's render code. It works only because nothing renders during script evaluation. Progressive migration to `<script type="module">` (still no build step) would make the dependency graph explicit and let tests import directly — this remains the highest-value structural move if the app keeps growing.
4. **Full-tab innerHTML rebuilds with inline `onclick`.** This is the root cause of the historical XSS class, blocks any CSP, loses scroll position, and does O(n²) work in the expense list (each month header re-filters all expenses per account). Event delegation with `data-*` attributes plus targeted re-render (the `toggleChartCat` pattern already in the codebase) fixes all four at once.
5. **State scattered by load order, not ownership.** Event-view state (`eventViewMode`, `calYear`, `eventSearchQuery`…) and `currentTaxSubTab`/`switchTaxSubTab` live in `finance-expenses.js`. Anyone maintaining the events tab must know to look in the expenses file.
6. **Dead code persists** (verified zero call sites): `simulateSAOAtoRetire`, `cpfContrib`, `CPF_ERS`, `CPF_OW_CAP` (`finance-core.js:431-432,442`), `fmtEventCountdown`, `annualRecurring`, `recalcAll` (its menu entry was removed). `CPF_ERS = FRS × 1.5` also contradicts the live `ERS_2026 = 440800` (2×FRS post-2025 rule) — a landmine for the next person touching CPF math.
7. **Four sync flows remain near-duplicates** (`syncWithMetadata` history/wiki branches, `forceSyncHistory`, `forceSyncWiki`) — same download → merge → tombstone-filter → stamp → upload shape, four implementations that must be kept in lockstep (and are already subtly inconsistent — see QA finding N1).
8. **The service worker is pure cache-first with silent rollout.** No runtime revalidation, no update toast (`fixme` M12, open). Forgetting the manual version bump pins users to stale assets forever; the repo's own CLAUDE.md has to shout about it. A `controllerchange` reload prompt is ~10 lines.

**Verdict:** the architecture is *optimal for its constraints* (zero-toolchain, offline-first, 2 users, one maintainer + AI pair) with the exception of items 1–2, which are cheap to fix and would remove real recurring risk. Items 3–4 are the right investments *if* the app keeps accreting features at the current rate (the git log shows steady growth: MOE bridge, rain radar, Modal proxies within weeks).

---

## 2. Finance advisor — what's missing from the overview

The app already covers expenses, budgets, assets + allocation targets, mortgages, insurance premiums, SG income tax, CPF/SRS projections, retirement drawdown, and an AI quarterly review. The gaps below are ranked by how much they would sharpen the *financial overview*, with the cheapest wins first.

### 2.1 High value, low effort

1. **Full data export / backup (and restore).** Today the only copy of your financial life outside localStorage is Google Drive — and `confirmClearData`'s warning plus the storage-full toast both assume an export feature that **does not exist** (only email-parser configs and the AI summary can be exported). One "Export all (JSON)" menu item writing `{data, historyData, wikiData}` — and a matching import — is the single most important missing feature. It is also the prerequisite for ever leaving Drive.
2. **Emergency-fund / runway KPI.** All inputs already exist: liquid balances (`computeNetWorth().liquid`) ÷ average monthly spend (`computeCashflow().avgMonthlyExpense`). "4.2 months of runway" next to Net Worth and Savings Rate on the AI card answers the first question any advisor asks. Add it to `buildAiSummary()` too so the quarterly report can comment on it.
3. **Insurance coverage amounts, not just premiums.** The `insurances` schema has `paymentAmount` but no **sum assured**, term/end date, or type-specific coverage (death/TPD/CI). Without it, neither you nor the AI advisor can assess adequacy (the prompt asks the model to "comment on insurance coverage adequacy" — but the data contains only what the policies *cost*). Add `sumAssured`, `coverageEndDate`; then a one-line KPI: total life cover ÷ annual income (rule of thumb: 9–10×, CI ≈ 4×).
4. **Count SRS in net worth.** `cpfRecords.srsBalance` is captured and projected (`calcSrsBalance62ForPerson`) but `computeNetWorth()` ignores it — net worth is understated by the entire SRS balance unless you double-enter it as an `SRS`-class asset (and the two can drift). Pick one source (recommend: cpfRecords) and include it, mirroring the CPF handling.
5. **Tax-relief optimizer.** `calcSGTax` is already there. A small card on Tax › Income: "An $8,000 CPF cash top-up saves $X; $15,300 into SRS saves $Y" — marginal-rate math you already have, plus a 31 Dec deadline reminder (the Events system can host it). Given dependents are tracked with ages/sex, a static SG relief checklist (QCR/WMCR, Parent Relief, CPF top-up relief, SRS, NSman, 250% donations) with "likely eligible" flags is nearly free and feeds section 7/8 of the AI prompt with facts instead of guesses.

### 2.2 High value, medium effort

6. **An income ledger.** Income is currently *inferred* from the latest non-historical tax estimate (`computeCashflow`), and `TopUp` conflates real income with inter-account transfers. Consequences: the savings-rate KPI is an estimate, and cashflow can't distinguish "salary landed" from "moved $5k between accounts". Either a dedicated income record type, or split `TopUp` into `Income` vs `Transfer` categories — the merge/CRUD patterns to copy are all there.
7. **Cash-flow forecast (next 12 months).** You already store every scheduled outflow: `ongoingExpenses`, insurance premiums + frequency, mortgage installments, and estimated tax. Calendarizing them into a "projected liquidity by month" line (against current liquid balances) turns the app from backward-looking to forward-looking — the most advisor-like feature on this list. It would also surface the recurring-expense periods that the current "Generate this month" flow silently misses (see QA N-refs to fixme M14).
8. **Investment performance (money-weighted return).** Asset history tracks *values* but not *contributions*, so "up $40k" can't be split into "market grew" vs "I deposited". Add an optional `flow` entry type (contribution/withdrawal) per asset; then XIRR per asset and portfolio-level, and a net-worth-growth attribution ("+$30k savings, +$12k market, −$3k FX"). This is the difference between a *tracker* and an *advisor*.
9. **Goal buckets.** Dependents' ages are known — an education-fund goal per child (target amount, target year, funded-so-far from tagged assets) plus a generic goal type would let the AI report and the retirement plan talk about *funded ratios* instead of one undifferentiated pool.

### 2.3 Worth considering

10. **Retirement robustness:** the drawdown model is deterministic single-path. A pessimistic toggle (e.g. returns −2%, or a 3-year 30% drawdown at retirement start) or a simple Monte Carlo (200 paths, in a worker) would answer "what if the first years are bad" — the question SWR exists for. Also surface *success age* ("portfolio survives to 89") rather than only the end balance.
11. **Mortgage realism:** `interestRate` is fixed for the life of the loan, while SG mortgages typically reprice after the lock-in. A `rateResetDate` + reminder ("lock-in ends Mar 2027 — review refinancing") matches how these loans actually behave, and a "prepay vs invest" comparison (mortgage rate vs `investmentRate`) is two lines of math the AI prompt currently has to hand-wave.
12. **CPF constants need a year-stamped table.** `CPF_BHS = 75500` is the **2025** figure (it rises every January), and the `CPF_CONTRIB` senior-worker rates (e.g. 55–60 at 13%/15%) predate the 2025/2026 step-ups. Projections silently degrade each year these sit flat. One `CPF_TABLE[year]` object with explicit year labels — and a visible "rates as of 20XX" footnote in the UI — keeps the model honest. (Same for `USD_DEFAULT_RATE = 1.28` — consider a manual "update rate" nudge if USD expenses are common.)
13. **Estate/legacy checklist** (Wiki tab is a natural home): CPF nomination done?, will, LPA, insurance nominations — pure content, no code risk, and it's the section every real financial review ends with.
14. **Savings-rate definition:** the KPI divides (gross income − spend) by gross income while `expenses` include the "Income Tax" category only if you log tax payments as expenses — so the rate mixes gross and net concepts depending on logging habits. Decide one convention (recommend: net-of-tax income, exclude the Income Tax category from spend) and label the KPI accordingly.

---

## 3. QA — bugs & errors

### 3.1 Status audit of the prior review (`fixme.md`)

Verified against current source:

- **Fixed (confirmed in code):** all 10 high-severity items — H1 (sibling SW caches whitelisted in `sw.js:43`), H2 (download-failure guards + "skip upload when remote has data"), H3 (interim-edit fold-back in `syncWithMetadata`), H4/H5 (XSS sinks — legend uses `data-cat` delegation, emoji is `esc()`d), H6 (`latestCpfBalances` partitions by `forPerson`), H7 (dependents tombstoned + per-row `_ts`), H8 (asset-history `_deletedHistoryTs` tombstones exist and merge honours them), H9 (cross-store dedup passes in sync/migrate/forceSync), H10 (`_metaTs` carried as max of both sides). Also fixed: M1 (`syncInFlight` mutex on all entry points), M4 (`lww` uses `!== undefined`), M5 (date-less expenses kept in current), M6 (`defaultData()` completed), M7 (try/catch + toast on all three `setItem` paths), M10 (`ignoreSearch: true`), M17 (YTD pill uses `localDateStr`), M19 (null-safe `desc`/`date` guards), M20 (`_wikiGesturesBound` guard), L3 (dedupe checks at tombstone push sites), L13.
- **Still open (spot-verified, ~25 items):** the significant ones are M2 (no ETag/If-Match on Drive uploads — acknowledged in docs as the residual race), M8 (`_deletedIds` capped at 500 — `finance-core.js:204`), M9 ("Delete ALL data" resurrects on next sync while Drive stays connected), M11 (Leaflet never actually lands in `EXT_CACHE` — no `crossorigin` → opaque responses fail the `res.ok` gate), M12 (silent SW rollout), **M13/M14 (recurring generation: `lastAutoGenPeriod` set without bumping `_updatedAt` → doesn't sync → both devices can generate the same month as duplicate expenses; missed periods are never backfilled)**, M15, M16, M18 (contradictory CPF constants — see §2.3-12), M21 (reminders >7 days out never re-armed; all reminders die when the PWA closes), M22 (all-day events parse as UTC midnight; editing one silently makes it 12:00 AM), M23, L1–L2, L4–L12, L14–L26, and the D/P (design/performance) sections wholesale. M13/M14 are the ones most likely to corrupt *financial* data (duplicate or missing recurring expenses) and deserve priority.

### 3.2 New findings (this review)

**N1 — Medium. Stale tombstone set in `syncWithMetadata`: partner deletions resurrect locally on the adopt path.** `finance-drive.js:568` computes `deletedSet` from `data._deletedIds` **once, before** the main store merges in the partner's new tombstones. The history/wiki branches then filter with that stale set. Scenario: partner deletes a history expense (tombstone in their main, record removed from the Drive history file) → your next sync adopts their tombstone into `data._deletedIds` *after* `deletedSet` was built → the history merge unions your local copy back in → the deleted expense **reappears on your device** (and in `allExpenses()` totals) until some later sync where history happens to be dirty. Fix is one line: rebuild `deletedSet` after the MAIN block (or filter with `data._deletedIds` at use time).

**N2 — Medium. `refreshPwaCache` destroys the sibling app's caches and the rain-frame archive.** `finance-app.js:773-788` deletes **every** cache on the origin — including `health-tracker-*` (which `sw.js`'s activate handler carefully whitelists; this path bypasses that fix) and `rain-frames-v1`. Tracker assets re-cache on next visit, but rain frames older than the live window are **unrecoverable without the proxy's cache** — a permanent archive wiped by a button whose label says "Refresh Cache" for the *finance* app. Filter to `k.startsWith('finance-')`.

**N3 — Low/Medium. The UTC-date bug class was only fixed at one call site.** `localDateStr()` exists precisely to avoid the SGT-vs-UTC shift, and fixme M17 fixed the YTD pill — but three siblings remain: `finance-events.js:105-107` (today/tomorrow event highlighting uses `toISOString()` — between 00:00 and 08:00 SGT, today's events lose their highlight and yesterday's gain it), `finance-app.js:187` (`renderYearlyChart` cutoff — same window excludes today's spending), and `finance-ai.js:33` (`lastNMonthKeys` month keys — on the 1st of a month before 08:00 SGT the 12-month window shifts by one month, skewing avg-spend/savings-rate KPIs). Grep for `toISOString().slice` and replace with `localDateStr()`.

**N4 — Low (data-safety messaging). The storage-full toast tells users to do something impossible.** `finance-core.js:210,232,281`: "⚠️ Storage full — **export your data** to avoid losing changes" — there is no export feature anywhere in the UI (verified; only parser-config export and AI-summary download exist). When this toast fires, the user genuinely cannot follow the advice. Ties directly to §2.1-1.

**N5 — Low. New-expense category can silently save as empty.** `finance-expenses.js:143` sets the default with `expCat.value = 'Grocery'`. If the user's custom `expenseCats` don't include Grocery and no existing expense uses it, the assignment no-ops (`select.value` becomes `''`, selectedIndex −1) and the expense saves with `cat: ""` — an invisible category in budgets/aggregates. Default to the first non-TopUp option instead.

**N6 — Low. Residual of fixed H9: the Drive history file keeps a stale duplicate that devices only hide locally.** The cross-store dedup (`finance-drive.js:678-688`) runs **after** the history upload, and its localStorage write doesn't bump `historyData._updatedAt`. So after moving an expense across the year boundary, the uploaded `finance-elvis-history.json` retains the superseded copy; every PWA device deduplicates locally so users never see double-counting, but any *external* consumer of the Drive files (the Apps Script quarterly report reads them directly) sees the expense twice. Run the dedup before the history upload.

**N7 — Low. Auto net-worth snapshot can record stale numbers at quarter boundaries.** `recordNetWorthSnapshot()` fires at script load (`finance-ai.js:560`), *before* `maybeAutoSync()` has pulled the partner's changes. A device that has been idle for weeks opens on 1 Oct and permanently records a quarterly snapshot from stale balances (snapshots merge by date key, so the partner's correct snapshot for a *different* date doesn't replace it). Cheap mitigation: record the auto-snapshot after a successful sync instead of at load.

**N8 — Low. Dateless expenses now crash the Expenses tab render.** The fixme-M5 fix deliberately keeps `date`-less expenses in `data.expenses` (`finance-core.js:331`), but `getExpenseYears` (`finance-expenses.js:243`) calls `e.date.slice(0,4)` and `renderExpenseList`'s month grouping calls `e.date.slice(0,7)` unguarded — one imported/legacy dateless record now throws, blanking the tab (caught by `renderAll`'s try/catch as "Render error — check console"). Guard with `(e.date || '')` like the history branch on line 9 already does.

**N9 — Info. `docs/finance.md` drift:** tab table says there are 6 tabs but omits the Events *MOE* sub-view's FAB interaction note added in `renderAll`; the file-index line counts in CLAUDE.md are stale (e.g. `finance.html` is ~1,230 lines, not 1,083; `finance-tax.js` 1,109 not 1,186); `docs/finance.md` line 146 still warns that a CPF-class asset is "also summed on top of cpfRecords in computeNetWorth()" — the code now **excludes** CPF-class assets there (`finance-ai.js:48`), so the doc describes a fixed bug as current behaviour. Tests: CLAUDE.md claims coverage of `calcCpfProjection`, which doesn't exist (the function is `calcRetirementPlan`; fixme D14 flagged this and it's still stale).

**N10 — Info. `fmtEventCountdown`, `annualRecurring`, `recalcAll`, `cpfContrib`, `CPF_ERS`, `CPF_OW_CAP`, `simulateSAOAtoRetire` remain dead** (zero call sites; re-verified this pass — `recalcAll` is newly dead since its menu entry was removed).

### 3.3 Verified-safe spot checks (not bugs)

`calcSGTax` brackets still exactly match IRAS resident rates YA2024+. `recalcBalances` is never fed `allExpenses()` (the CLAUDE.md invariant holds at all call sites). The watermark logic uses equality-of-opaque-tokens consistently. `mergeMoeInbox` delete-wins semantics are correct (tombstones union, presence intersects). `renderMarkdownLite` remains escape-first with no URL sinks. The wiki gesture engine binds once per container. `expSgd` conversion is applied consistently in balances, aggregates, and month headers. USD default-rate handling round-trips through edit correctly.

---

## 4. Prioritized recommendations

**Do first (small, high value):**
1. Add full JSON export/import (fixes N4's broken promise, enables backups independent of Drive) — §2.1-1.
2. Rebuild `deletedSet` after the main merge in `syncWithMetadata` (N1).
3. Scope `refreshPwaCache` to `finance-*` caches (N2).
4. Sweep the three remaining `toISOString()` date sites to `localDateStr()` (N3).
5. Fix recurring-expense sync: bump `o._updatedAt` when stamping `lastAutoGenPeriod` (fixme M13) — this is the most likely source of *wrong financial numbers* today.

**Next (product):**
6. Emergency-fund KPI + insurance sum-assured fields + SRS in net worth (§2.1-2/3/4) — three small schema/UI changes that materially upgrade the AI advisor's inputs.
7. Tax-relief optimizer card and year-stamped CPF constants table (§2.1-5, §2.3-12).
8. Income ledger / TopUp split, then the 12-month cash-flow forecast (§2.2-6/7).

**Structural (when convenient):**
9. Centralize delete/tombstone and collection-merge tables; stop persisting `monthlyAgg`/balances (§1.2-1/2).
10. SW update toast (fixme M12) and `_deletedIds` age-based pruning (fixme M8).
11. If growth continues: ES modules + event delegation migration, one file at a time (§1.2-3/4).
