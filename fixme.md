# FIXME — Finance PWA Code Review

Full review of the finance PWA (~10,000 lines: 11 JS files, `finance.html`, `finance.css`, `sw.js`).
Three perspectives: **QA tester** (bugs), **software developer** (cleanliness/maintainability),
**software architect** (architecture, bottlenecks, responsiveness). No code was changed —
this file is the deliverable. Every finding was verified against the actual source; line
numbers are as of this review.

**Overall:** the strongest parts of the codebase are the Drive sync merge design
(timestamped LWW + tombstones + merge-before-upload, with 43 targeted tests) and the
disciplined data partitioning (main/history/wiki split with mirrored timestamps). The
weakest parts are operational: concurrency guards, quota/error handling, update rollout,
and a handful of real data-loss / XSS bugs listed below.

---

## 1. QA — Bugs

### 1.1 High severity

- [x] **H1. Mutual service-worker cache destruction between finance and tracker apps** — `sw.js:39-41` vs `sw-tracker.js` activate handler.
  The Cache Storage API is per-**origin**, not per-SW-scope. `sw.js` activate deletes every cache except `finance-v163`/`finance-ext-v1`; `sw-tracker.js` deletes everything except its own `CACHE` — including the finance caches. Opening `tracker.html` after using the finance app wipes the entire finance asset cache. The finance SW's `install` won't re-run until the next version bump and the fetch handler does no runtime re-caching of ASSETS, so the finance PWA is **offline-broken until the next `sw.js` bump** (and vice versa: every finance cache bump wipes the tracker cache). Fix: each activate handler must whitelist the sibling app's cache prefix (keep `health-tracker-*` in `sw.js`, keep `finance-*` in `sw-tracker.js`).

- [x] **H2. Drive sync: transient download failure silently overwrites remote history/wiki** — `finance-drive.js:439-446` (history), `:466-472` (wiki).
  Remote history/wiki downloads are wrapped in `.catch(() => null)` (lines 411, 414, 430, 461). If the GET fails transiently (network blip, 500, 403 rate limit), `dl` is `null` — but `uploadHistory`/`uploadWiki` is still set to `true`, so local-only data is uploaded with a fresh `_updatedAt`, **erasing every remote-only record from the Drive file** (e.g. a partner's power records or recipes). This directly violates the documented "never upload without merging first" invariant. If the records existed only on Drive, the loss is permanent. Fix: when the remote timestamp is non-zero and the download returned null, abort the aux-file upload (or the whole sync).

- [x] **H3. User edits made during the sync upload window are silently discarded** — `finance-drive.js:475-540`.
  `mergeData(data, remote)` snapshots `data`, then up to three sequential network uploads run (seconds on slow connections), and only afterwards `data = merged` (line 527) and `saveData(data)` (line 540). The UI stays fully interactive during sync. An expense added while the status reads "Uploading…" mutates the *old* `data` object; line 527 then replaces it and line 540 overwrites localStorage — the expense is gone from memory, localStorage, and Drive. Fix: lock input during sync, or re-merge `data` into `merged` just before the final assignment.

- [x] **H4. Stored XSS via category name in the Analysis chart legend** — `finance-app.js:169`.
  `onclick='toggleChartCat(${JSON.stringify(cat)})'` uses a **single-quoted** attribute, but `JSON.stringify` only escapes double quotes. A category named `x' onpointerenter='alert(document.cookie)//` breaks out of the attribute and injects a second, valid event handler. Categories ride on expenses and `data.expenseCats` through Drive sync, so this is **cross-user stored XSS** (your partner's device executes it). Fix: put the category in a `data-cat` attribute (esc'd) with a delegated listener, or double-quote the attribute and `esc()` the JSON.

- [x] **H5. Stored XSS via the category "emoji" field** — `finance-expenses.js:54-57`.
  `const emoji = emojiMap[e.cat] || ''; ... <span class="cat-emoji">${emoji}</span>` — interpolated **without `esc()`**. `emojiMap` comes from `parseCatEmojis()` over `data.expenseCats`, which is free-text user input (`expenseCatsInput`, `finance-investments.js:179`). Entering `<svg/onload=alert(1)> Grocery` as a category puts active markup into every expense row, and `expenseCats` syncs via Drive (`_expenseCatsTs` LWW), so it executes on the partner's device too. Fix: `esc(emoji)`.

- [x] **H6. `latestCpfBalances()` ignores `forPerson` — one spouse's entire CPF missing from net worth** — `finance-investments.js:270-276`.
  It sorts all `cpfRecords` (husband + wife mixed) by year and takes only the **last record**. `finance-tax.js` consistently partitions by `r.forPerson` (e.g. `finance-tax.js:140-142`), but `computeNetWorth()` (`finance-ai.js:50`) uses `latestCpfBalances().total`. With both spouses having records for the same year, only one person's balances are counted — net worth, every snapshot, and every AI KPI is understated by an entire person's CPF. Fix: sum the latest record per `forPerson`.

- [x] **H7. Dependent deletion is never tombstoned — deleted dependents resurrect on sync** — `finance-investments.js:111-130`.
  `saveAccountSettings` rebuilds `data.dependents` and drops blanked rows, but never pushes the dropped `id` into `data._deletedIds`. `mergeData` union-merges dependents (`finance-drive.js:319`), so the remote copy re-adds them on the next sync. Secondary bug at line 126: every save stamps *all* dependents `_ts: Date.now()`, so a partner's concurrent edit always loses, even for untouched rows.

- [x] **H8. "Remove Latest Entry" on asset history resurrects after sync** — `finance-investments.js:573-582`.
  `deleteLatestHistory()` pops the last history entry with no tombstone, but the asset merge (`finance-drive.js:260-279`) is a pure union of `history[]` deduped by `_ts` — there is no deletion mechanism for history entries. Scenario: fat-finger $500,000 instead of $50,000, remove it, sync — the bad entry comes back from the remote file and, having the highest `_ts`, becomes `currentValue()` again, corrupting net worth, allocation, and the retirement projection.

- [x] **H9. Editing an expense across the year boundary double-counts it after sync** — `finance-expenses.js:149-166`.
  Moving an expense from `historyData.expenses` to `data.expenses` (date changed from 2025 to 2026, lines 162-165) removes it from local history, but the remote history file still has it; `mergeHistoryData` is union-by-id with no tombstone, so after sync the old 2025 copy exists in history *and* the new 2026 copy in main — same id, double-counted in `allExpenses()` / `recalcMonthlyAgg`, permanently. (The reverse direction self-heals via `migrateExpenses()` on reload; this direction has no self-heal.)

- [x] **H10. Asset rename/class/units edits ping-pong between devices** — `finance-drive.js:260-274`.
  For an asset on both sides, the merged record is seeded from the first-seen (remote) copy and only `name`/`class`/`units` are taken from the LWW winner — **`_metaTs` itself is never carried over**, so it stays at the remote's older/absent value. After A renames and syncs, the uploaded file has the new name but stale `_metaTs`; B's sync then ties (0 vs 0) and local-wins re-uploads the old name; A's next sync flips it back — forever. Fix: `merged._metaTs = Math.max(local._metaTs||0, remote._metaTs||0)` (and `_nameTs` likewise).

### 1.2 Medium severity

**Sync / data layer**

- [x] **M1. No single-flight guard across the four sync entry points** — `finance-drive.js:392` (`driveSync`), `:94-97` (`driveSyncHeader` quick-sync), `:559` (`forceSyncHistory`), `:646` (`forceSyncWiki`).
  `driveSync` disables `#driveSyncBtn` but never *checks* it, and the other three entry points call straight in. Two overlapping syncs interleave download/merge/upload and both reassign the global `data = merged` mid-flight (compounding H3). Fix: a module-level `let syncInFlight` mutex checked in all four.

- [ ] **M2. No optimistic concurrency on Drive uploads** — `finance-drive.js:684-704`.
  `uploadFileToDrive` PATCHes blindly with no ETag/revision precondition. Two devices syncing simultaneously: the second PATCH clobbers the first. Union'd collections self-repair on the next sync, but **LWW scalar fields and the `budgets` shallow merge can lose writes permanently**. Fix: compare Drive `version`/`headRevisionId` before upload and retry-merge on conflict.

- [ ] **M3. First-time history upload failure orphans the new Drive file** — `finance-drive.js:504-523` (and same shape in `driveFirstSave` ~line 378).
  When no `historyFileId` exists, a new Drive file is created and its ID captured only in local variables / the in-flight `merged` object. If the subsequent main upload throws, the ID is recorded nowhere — the next sync creates *another* history file, orphaning the first. Fix: persist the new file ID (`saveData`) immediately after creation.

- [x] **M4. `lww()` resurrects values the winner explicitly set to `null`** — `finance-drive.js:223-229`.
  The comment claims `??` preserves explicit null/'' from the winning side; `??` does the opposite for `null` — it falls through to the **loser's** value. Concrete case: user resets `customAiPrompt` to null (newer ts); merge with a partner's old non-null prompt brings the old prompt back. Same for `aiReport: null` ("report cleared"). Fix: don't fall through when the winner's timestamp is strictly newer.

- [x] **M5. Date-less expenses are silently destroyed at startup** — `finance-core.js:293-302`, same double-filter in `finance-drive.js:423-424`.
  An expense with a missing/empty `date` matches neither the "past" nor "current-year" filter: not copied to history, removed from `data.expenses` — deleted with no toast and no tombstone on every load; the sync variant then propagates the deletion. The form can't produce these (`required`), but JSON/CSV imports and legacy data can. Fix: treat falsy dates as "keep in current".

- [x] **M6. Fresh install bypasses `loadData()` backfills — undefined CPF settings on first session** — `finance-core.js:131-134, 144-146`.
  `loadData()` early-returns `defaultData()` when nothing is stored, skipping the backfills. `defaultData()`'s `cpfSettings` is just `{ dateOfBirth: '' }` — no `lifeExpectancy`/`ersGrowthRate`/`mortalityFactor` — so the CPF tab can compute NaNs until the first save+reload. Fix: make `defaultData()` complete, or run the backfills on the fresh object too.

- [x] **M7. No try/catch around any `localStorage.setItem`; quota failure = silent data loss** — `finance-core.js:190-195, 209-213, 252-258`.
  `QuotaExceededError` propagates out of `saveData`/`saveHistory`/`saveWiki` mid-form-handler: the sheet stays open with no explanation and the data exists only in memory (gone on reload). The history blob grows unboundedly (all past years), so this *will* eventually fire. Also `loadData()`'s blanket `catch { return defaultData() }` discards a possibly-recoverable corrupt blob and the next `saveData` overwrites it permanently — stash the raw string (e.g. `finance:v1:corrupt`) before resetting.

- [ ] **M8. `_deletedIds` capped at 500 — old tombstones rotate out, deletions resurrect** — `finance-core.js:191-193`.
  Tombstones are the only deletion mechanism for every union-merged collection. A device (or stale Drive file) that hasn't synced in months merges back in after >500 newer deletions and resurrects records. Compounded by L3 below (duplicate pushes evict tombstones sooner). The cap is an arbitrary magic number with no age component.

- [ ] **M9. "Delete ALL data" doesn't, when Drive-connected** — `finance-drive.js:7-21`.
  `confirmClearData` says "This cannot be undone" but keeps the Drive connection and never touches remote files; worse, `saveHistory(historyData)` stamps the now-empty history with a fresh `_updatedAt`. The next sync union-merges the remote back in — nearly everything returns. Either disconnect Drive, offer to clear remote files, or warn that synced data will come back.

**Service worker / PWA**

- [x] **M10. PWA shortcuts fail offline — cache match doesn't ignore query strings** — `sw.js:65-67` + `manifest.json` shortcuts.
  The manifest's shortcuts point at `/health/finance.html?add=1` / `?addevent=1`; `caches.match(e.request)` without options doesn't match the cached `finance.html`, so the "Quickly add expense" shortcut shows a browser error page offline. Fix: `caches.match(e.request, { ignoreSearch: true })` for navigations.

- [ ] **M11. `EXT_CACHE` never populates — Leaflet never works offline** — `sw.js:46-63` + `finance-events.js:518-528`.
  `loadLeaflet` injects plain `<link>`/`<script>` tags (no `crossorigin`), so the SW sees no-cors requests and **opaque** responses (`res.ok === false`); the `if (res.ok) cache.put(...)` gate never fires. CLAUDE.md's claim that Leaflet is "cached in EXT_CACHE on first fetch" is currently false. Fix: add `crossorigin="anonymous"` in `loadLeaflet`, or cache opaque responses for these exact versioned URLs.

- [ ] **M12. Silent SW rollout — no update notification** — `sw.js:32-44`; no `updatefound`/`controllerchange` listener anywhere.
  Pure cache-first with no revalidation; after a new SW activates (`skipWaiting` + `clients.claim`), an open tab keeps old JS in memory while new fetches hit the new cache — old page + new assets can mix, and the user never learns a version changed. Add a "New version — tap to reload" toast on `controllerchange`.

**Domain logic**

- [ ] **M13. Recurring generation marker doesn't sync — duplicate recurring expenses across devices** — `finance-insurance.js:470`.
  `genDueOngoingExpenses` sets `o.lastAutoGenPeriod = info.periodKey` **without bumping `o._updatedAt`**, and `ongoingExpenses` merge by `_updatedAt` with local-wins ties. Device A generates June; B's copy (tie → local wins) still has the old marker, so B's "Generate this month" creates a second June expense with a different uid — union keeps both. Any later partner edit of the rule also erases A's marker.

- [ ] **M14. Missed recurring periods are silently lost — no catch-up** — `finance-insurance.js:376-393`.
  `getOngoingDueInfo` only ever yields the period containing `refDate` (annual: a one-calendar-month window per year). If the user doesn't press "Generate this month" within the window, the period can never be generated afterwards — the expense silently vanishes from records.

- [ ] **M15. `getOngoingNextDue` quarterly display skips the current quarter's upcoming due date** — `finance-insurance.js:427-428`.
  The candidate is the **1st** of the due month, so any time after the 1st but before the due day steps past the whole quarter (start 2026-01-20: on Apr 10 the card says "next: Jul 20" though generation is due Apr 20). Display-only but contradicts what the app then does.

- [ ] **M16. Mortgage projection overstates total interest after payoff** — `finance-insurance.js:676-688`.
  Balance is clamped at 0 but `totalInterest = monthlyPmt * yr * 12 - (bal - b)` assumes the full payment stream for all `yr*12` months; the `projYears` filter admits horizons up to 6 months past payoff, charging phantom installments as interest. (`monthsElapsed` also uses a 30.44-day approximation rather than calendar math.)

- [x] **M17. YTD pill uses UTC date — wrong before 8am SGT** — `finance-expenses.js:291`.
  `new Date().toISOString().slice(0, 10)` — the codebase added `localDateStr()` (`finance-core.js:314-316`) precisely to avoid this. Between 00:00 and 08:00 local, today's expenses are excluded from the YTD figure.

- [ ] **M18. CPF constants are internally contradictory** — `finance-core.js:394` vs `finance-tax.js:136`.
  `CPF_ERS = CPF_FRS * 1.5` = $330,600 ("ERS = 1.5× FRS") coexists with `ERS_2026 = 440800` (the post-2025 2×FRS rule) — two different ERS values; the core one is dead code but a landmine. The "CPF Board official rates (2024)" block mixes 2024/2025/2026 figures with inconsistent year labels; `CPF_BHS = 75500` is held flat across multi-decade projections; magic numbers (`annualSalary = 102000`, SRS `15300`, growth `1.04`, payout age `65`) are inline.

- [x] **M19. Records missing `desc`/`date`/`history` blank entire tabs** — `finance-expenses.js:10, 12`; `finance-investments.js:266`.
  `b.date.localeCompare(...)` and `e.desc.toLowerCase()` throw on `undefined`; `currentValue(a)` assumes `a.history` is an array. CLAUDE.md warns an uncaught render exception blanks the tab — imported or partner-edited data with a missing field is enough. Guard with fallbacks.

**UI / events**

- [x] **M20. Wiki gesture listeners accumulate on every render** — `finance-wiki.js:188, 317, 461` → `attachWikiGestures`.
  Each list render calls `attachWikiGestures` on the same **persistent** container (`#wikiSubContent-*` are static in the HTML; only innerHTML is replaced), unconditionally adding `touchstart/touchmove/touchend/click` listeners with no dedupe. After N renders a single tap fires N click handlers. Fix: a `container._wikiGesturesBound` guard or one delegated listener bound once.

- [ ] **M21. Event reminders >7 days out are dropped and never re-armed** — `finance-events.js:1060-1083`.
  The 7-day `MAX_DELAY` cap correctly avoids the 32-bit `setTimeout` overflow, but there is no re-arm mechanism (no daily timer, no visibilitychange rescheduling) — `scheduleEventReminders()` runs only on load and event save/delete. An event 10 days out gets no reminder unless the app is reopened inside the window. Also reminders are in-page `setTimeout` only — closing the PWA cancels all of them. At minimum document the limitation; better, re-arm on visibilitychange.

- [ ] **M22. All-day events parse as UTC midnight — day-shift in sort/countdown** — `finance-events.js:2-8`.
  `new Date(ev.startDate)` (no time component) parses as UTC midnight, 8h earlier than SGT local; the timed branch builds local time. An all-day event "today" can show as yesterday late in the day. Related: `time24ToObj('')` returns 12:00 AM (`finance-events.js:931, 1007`), so the UI can never create a genuine all-day event — the all-day render branches are dead for UI-created events and only bite imports.

- [ ] **M23. Leaflet double-load race on rapid view switching** — `finance-events.js:518-528`.
  `loadLeaflet` checks `window.L` else appends a `<script>`; rapid busmap → rain → busmap toggles before load appends **two** script tags and fires both `onload`s. The mode guards inside the callbacks mitigate the worst, but duplicate injection is real. Use a single shared loading promise.

### 1.3 Low severity

- [ ] **L1.** Token acquisition can hang forever — no `error_callback` on GIS `initTokenClient`, so a closed/blocked consent popup leaves the sync button stuck on "Authenticating…" until reload (`finance-drive.js:191-208`).
- [ ] **L2.** Events import ignores `data._deletedIds` — re-importing an old export transiently resurrects deleted events; also `reader.onload = ev => { ... incoming.forEach(ev => ...) }` shadows `ev` (`finance-drive.js:28-58`).
- [x] **L3.** `_deletedIds.push(id)` without an `includes` check at 8 call sites (`finance-expenses.js:188`, `finance-investments.js:533`, `finance-insurance.js:132/250/356/645`, `finance-tax.js:513/740`) — duplicates inflate the array and evict older tombstones sooner (see M8). CLAUDE.md's own recipe includes the dedupe check.
- [ ] **L4.** `forceSyncHistory` filters only with **local** tombstones — partner-deleted records transiently resurrect and get uploaded until the next full sync (`finance-drive.js:575-579`).
- [ ] **L5.** `forceSyncWiki` has no remote-shape validation — linking the wrong file ID (e.g. the main data file) and tapping "Sync wiki" **overwrites that file with wiki content**, destroying it (`finance-drive.js:658-667`). Validate like `driveSync` does.
- [ ] **L6.** Parser import: merge keys on id-else-name but the added/updated count keys on id-or-name — same-name/different-id parsers are pushed as duplicates yet counted as "updated" (`finance-gmail.js:52-67`).
- [ ] **L7.** `notificationclick` focuses an arbitrary same-origin window — may focus `tracker.html` for a finance reminder, and never navigates to the event (`sw.js:70-78`, same in `sw-tracker.js`).
- [ ] **L8.** Legacy `finance:driveHistoryFileId` is migrated but never removed — if `data.historyFileId` is later cleared, the stale legacy ID is silently re-adopted (`finance-core.js:172-175`).
- [ ] **L9.** `busProxyToken` (a secret-ish bearer token) **is** synced to Drive via LWW and restored to localStorage, inconsistent with the documented `busApiKey` never-sync policy, and the key is missing from CLAUDE.md's localStorage table (`finance-drive.js:348-350`, `finance-core.js:284-285`).
- [ ] **L10.** Uploaded `monthlyAgg` excludes history months — `mergeData` ends with current-year-only `recalcMonthlyAgg` and that gets uploaded; the all-years recompute runs only after upload. External consumers of the Drive file (the Apps Script quarterly report) see months missing around year boundaries (`finance-drive.js:359-360, 523, 533`).
- [ ] **L11.** FAB stays visible (no-op) when switching to Tax › Retirement — `switchTaxSubTab` doesn't update FAB visibility, unlike `switchAnalysisSubTab` (`finance-expenses.js:327-336`). On Expenses › Recurring/Mortgage the FAB still opens the plain expense sheet rather than the sub-tab's own add-entity.
- [ ] **L12.** Hardcoded account-id styling: `e.ac === 'acc1' ? 'acc1' : 'acc2'` — anything not literally `acc1` styles as account 2 (`finance-expenses.js:62`, `finance-insurance.js:279`).
- [x] **L13.** Double-escaping into `textContent`: `historyTitle.textContent = esc(asset.name) + …` shows `A &amp; B` for `A & B` (`finance-investments.js:545`).
- [ ] **L14.** Tax PIN: lock screen renders exactly `pin.length` dots (discloses length), 1-digit PINs accepted, and the tab handler runs `renderAll()` **before** `maybeShowTaxPin()` so all tax data is in the DOM behind the overlay (find-in-page / screen readers see it) (`finance-tax.js:22, 44-49`; `finance-investments.js:138`; `finance-core.js:422-423`).
- [ ] **L15.** CPF "Monthly Mortgage" cannot be set below $3,000 (slider min + validation + default all 3000) — a user with no mortgage can't model $0 OA deduction; out-of-range values are silently discarded (`finance-tax.js:320, 363, 432`).
- [ ] **L16.** Retirement loop `for (age = retireAge; age < deathAge; ...)` — "Portfolio at Death Age" is actually the balance at end of age `deathAge − 1`; the death year is never simulated (`finance-tax.js:882, 1045`).
- [ ] **L17.** Expense amount validation accepts 0 and negatives — a negative non-TopUp expense silently *increases* the balance (`finance-expenses.js:135`).
- [ ] **L18.** Allocation total tolerance mismatch: UI shows green only within ±0.05% but save accepts ±0.1% — 99.93% shows red yet saves (`finance-investments.js:388, 399`).
- [ ] **L19.** `saveExpenseBudget` matches DOM inputs to categories purely by sorted index computed independently at open and at save — a background sync merge that introduces a category between open and save shifts indices and writes budgets/emojis/keywords to the wrong categories (`finance-investments.js:160-165, 208-213`).
- [ ] **L20.** `medAgo` labels future-dated visits "this month" (`finance-insurance.js:151`); `mortgageMonthlyInstallment` returns $0/mo for a 0%-interest loan instead of `P/n` (`finance-insurance.js:503-504`).
- [ ] **L21.** Insurance list renders in raw array order; merge interleaving means partners see different orders (`finance-insurance.js:43`). Cosmetic.
- [ ] **L22.** `printResume` attaches the `afterprint` cleanup listener *after* calling `window.print()` — on browsers where the event fires during the synchronous call (or never, on some mobile), the injected `@page` style leaks and duplicates on the next print (`finance-wiki.js:631-634`). Attach before printing.
- [ ] **L23.** Calendar `evByDate` while-loop is unbounded — a typo'd `endDate` year (e.g. `22026`) iterates thousands of days (`finance-events.js:851-860`). Clamp the span.
- [ ] **L24.** Visibility-resume for the bus map relies on `locationMap` still being set; after visiting map settings (`locationMap = null`) and re-foregrounding, location tracking silently stops until a full re-render (`finance-app.js:747-755`, `finance-events.js:332`).
- [ ] **L25.** `recordNetWorthSnapshot()` runs at top level on load and can `saveData()` before `renderAll()` — merely opening the app mutates persisted state at quarter boundaries (by design, but it triggers a Drive upload on next sync with no user change) (`finance-ai.js:560`).
- [ ] **L26.** `findDriveFileIdByName` builds the Drive query with an unescaped filename — fine for the current hardcoded constants, breaks/injects if ever reused with user input (`finance-ai.js:377`).

**Verified safe (checked, not bugs):** `calcSGTax` brackets exactly match IRAS resident rates YA 2024+. All five `recalcBalances` call sites pass `data.expenses`, never `allExpenses()` (the CLAUDE.md invariant holds). `getOngoingDueInfo` month-end handling is correct. Mortgage amortization table math is correct. `renderMarkdownLite()` is XSS-safe (escape-first design, no link/image syntax — no `href` to inject into). `unionById` tie-breaking matches the documented "local wins". `localDateStr()`/`today()` are used consistently except M17. `finance-gmail.js` routes all user strings through `esc()`. 401-retry with token invalidation exists on upload and download paths.

---

## 2. Software developer — cleanliness & maintainability

- [ ] **D1. `driveSync` is a 165-line god function** (`finance-drive.js:392-557`) owning auth, three downloads, three merge strategies, tombstone application, cross-store dedup, three uploads, timestamp bookkeeping, and UI updates. The history/wiki sub-flows are near-duplicates of each other **and** of `forceSyncHistory`/`forceSyncWiki` — four implementations of "download → merge → tombstone-filter → stamp → upload". Extract a `syncAuxFile({fileId, localBlob, remoteTs, merge, collections})` helper; that's also the single place to enforce the H2 invariant.

- [ ] **D2. SG tax computation quadruplicated** — the assessable→chargeable→tax pipeline appears in `renderTaxChart` (`finance-tax.js:56-62`), `calcEffectiveTax` (522-528), `renderTaxRecords` (551-565), and `updateTaxPreview` (671-674). `calcEffectiveTax` exists; the other three should call it. The SRS projection is likewise duplicated with re-inlined magic numbers (`finance-tax.js:253-259` vs `781-796`).

- [ ] **D3. Retirement/CPF defaults exist in three diverging copies** — `defaultData()`, the `loadData` fallback (which omits `annualSavings`/`safeWithdrawalRate`, papered over by per-field backfills), and `RS_DEFAULTS` in `mergeData` (`finance-core.js:110, 152-159`; `finance-drive.js:308`). One exported constant should feed all three (also fixes M6).

- [ ] **D4. Dead code (verified by grep, zero call sites):**
  - `simulateSAOAtoRetire()` — `finance-tax.js:102-123`
  - `cpfContrib()`, `CPF_ERS`, `CPF_OW_CAP` — `finance-core.js:394-395, 405-408` (and `CPF_ERS` contradicts the live `ERS_2026`, see M18)
  - `fmtEventCountdown()` — `finance-events.js:18`
  - `annualRecurring()` — `finance-ai.js:132`
  - The history branch of `genDueOngoingExpenses` (`finance-insurance.js:465-468`) is unreachable — every `getOngoingDueInfo` branch sets `dueYear` to the current year.

- [ ] **D5. Tombstone-filter boilerplate repeated five times** (`finance-drive.js:479-483, 578-579, 662-664`) — CLAUDE.md documents adding a collection as a 5-step ritual precisely because of this. A `HISTORY_COLLECTIONS` / `WIKI_COLLECTIONS` constant iterated in the merge functions and filter sites turns "silently dropped during syncs" into a one-line change.

- [ ] **D6. Inconsistent timestamp fields for no clear reason** — `_ts` (expenses, medical, tax, cpf) vs `_updatedAt` (insurance, ongoing, mortgage, notes). Each new collection must pick the one matching its `mergeData` block or sync silently breaks. Pick one and alias the other in merge.

- [ ] **D7. Inconsistent CRUD/render patterns between near-identical features** — after submit: insurance → `renderAll()`; medical → `renderMedical()` only; ongoing → `renderOngoingListInline()` only; mortgage → `renderAll()` plus conditional sheet re-open. Delete functions are ~8 near-identical copies that differ in whether they remember the tombstone dedupe (none do — L3).

- [ ] **D8. Misplaced state / functions** — all event-view state (`eventViewMode`, `calYear`, `calMonth`, `eventSearchQuery`, `currentEventListSubTab`) and `currentTaxSubTab` + `switchTaxSubTab` live in `finance-expenses.js:205-216, 326-336`, not in the events/tax files. Pure load-order accommodation that makes the dependency graph illegible; consolidate into a single `ui = {}` object in `finance-core.js` or move state home.

- [ ] **D9. Oversized multi-responsibility functions** — `renderCpf` (~120 lines, 5 unrelated cards), `renderRetirement` (~190 lines), `calcRetirementPlan` (~115 lines mixing CPF LIFE, SRS, accumulation, drawdown), `openAccountSettings`/`saveAccountSettings` (a god-form covering accounts + tax PIN + CPF DOBs + dependents + school terms + event tags; the dependents "existing rows + 2 blanks matched by index" persistence at `finance-investments.js:34, 112-128` is particularly fragile — see also H7/L19).

- [ ] **D10. Swallowed exceptions hide real failures** — `try { hubCpfMonthly = calcCpfLifePayoutForPerson('husband'); } catch (e) {}` silently zeroes a major income stream in the retirement plan (`finance-tax.js:822, 827`); empty `catch {}` in `loadData`/`loadHistory`/import handlers reports nothing (corrupt blob and quota error look identical); `throw new Error('HTTP ' + resp.status)` discards Drive's error body, which contains the actionable reason (`userRateLimitExceeded`, `notFound`) — real-world sync failures are undebuggable (`finance-drive.js:700, 731`).

- [ ] **D11. Magic numbers without provenance** — `500` tombstone cap, `expires_in - 30`s token slack, polling intervals `60000/30000/300000` duplicated between `setEventView` and the visibilitychange handler (`finance-events.js:258-271`, `finance-app.js:746-754`), CPF/SRS figures (M18). Name the constants; the first two affect correctness.

- [ ] **D12. Duplicated resume-render logic** — `renderResumeDetail` (`finance-wiki.js:494-509`) and `printResume` (`:591-606`) build nearly identical HTML with different class names; they will drift. The 6-statement inline `onclick` in `busApiSetupHtml` (`finance-events.js:313-320`) should be a named function.

- [ ] **D13. Chart hand-rolls asset valuation instead of calling `currentValue()`** — `renderAssetMortgageChart` (`finance-app.js:285`) re-implements value × units; if the definitions ever diverge, the chart disagrees with net worth.

- [ ] **D14. CLAUDE.md doc drift (verified):** `renderInvestments()` no longer exists at all (doc says "treat as dead/legacy"); `calcCpfProjection` is claimed as test coverage in CLAUDE.md and `tests/README.md` but the function doesn't exist in any JS file (only `calcRetirementPlan` does); `ASSET_CLASSES` includes `'SRS'` in code but not in the doc; `finance:busProxyToken` is missing from the localStorage key table; the Leaflet "cached on first fetch" claim is false (M11); cache version reference is stale (`v157` vs actual `v163`).

- [ ] **D15. Minor naming/contract inconsistencies** — `DRIVE_HISTORY_FILE_KEY` survives only for migration (deserves a `LEGACY_` prefix); `mergeData` carries a vestigial `_dependentsTs` though dependents are union-merged; `uploadToDrive` returns the payload while siblings return the file ID (no caller uses it); asset-history dedup key `h._ts || h.date + h.value` mixes number and string keys — an entry with `_ts` on one side only never dedups (`finance-drive.js:278`).

---

## 3. Software architect — architecture, bottlenecks, responsiveness

### 3.1 Architecture assessment

- **Global-scope coupling (HIGH, by design but fragile):** 11 scripts share one global scope; the *first*-loaded file (`finance-core.js:417-483` — tab clicks, FAB) references `let` bindings and functions from six *later* files. One syntax error or missed SW cache entry in any later file makes every tap throw `ReferenceError`, detected only by the `renderAll` try/catch. 30+ scattered mutable UI-state globals (enumerated in D8 and across events/tax/wiki files). `esc()` is defined in the last-loaded file but used by every earlier file's render functions — safe only because nothing renders during script evaluation.
- **Data layer (MEDIUM):** `saveData()` synchronously stringifies the whole main blob at 61 call sites — fine today (main blob is bounded by one year of expenses), but unbatched, on the main thread, and with zero quota/error handling (M7). The invariant discipline ("always saveHistory then saveData", "always tombstone", "mirror historyUpdatedAt") is enforced only by CLAUDE.md convention; one missed pairing = silent sync divergence. This is the highest-tax aspect of the design.
- **Drive sync (sound core, two real gaps):** the merge architecture (per-record LWW + tombstones + merge-before-upload + 43 targeted tests on exactly the dangerous code) is better than most hand-rolled sync. The gaps are operational: no single-flight (M1) and no optimistic concurrency (M2), plus the H2 download-failure hole.
- **Service worker (MEDIUM):** pure cache-first, no revalidation, silent `skipWaiting` activation, no update prompt (M12), and the manual version-bump discipline is a standing footgun — forget the bump and users are pinned to stale assets forever.
- **Testability:** 5 of 11 files load in the vm harness; the merge logic is the best-tested code (correct prioritization). Untested but easily testable: `finance-gmail.js` parsers and `finance-ai.js`'s `buildAiSummary`/`renderMarkdownLite` — the latter is the declared XSS boundary and deserves tests. All ~80 `render*` functions are untestable as structured; `driveSync` orchestration (the intricate timestamp branching) is fetch-coupled and untested.

### 3.2 Performance / responsiveness bottlenecks

- [ ] **P1. O(n²) inside full-tab innerHTML rebuilds** — each month header re-filters **all** `data.expenses` per account per month (`finance-expenses.js:38-44`): O(months × accounts × expenses) on every add/edit/delete, pill tap, and (debounced) search keystroke. `renderAssetMortgageChart` filters **and sorts** every asset's full history per x-axis month (`finance-app.js:282-299`). A single running-balance pass / pre-indexed histories make both O(n). `renderYearFilterPills` runs an O(n²) `indexOf` dedup — use a `Set` (`finance-expenses.js:234-237`).
- [ ] **P2. Full-tab rebuild per change** — `renderExpenseList` rebuilds the entire selected year as one string (~350 bytes/expense → ~700KB at 2,000 expenses) plus parse and reflow per keystroke/CRUD. Scroll position is lost (collapse state is kept). The `toggleChartCat` pattern (`finance-app.js:27-32`) already demonstrates targeted re-render — generalize it: expense CRUD should re-render only the affected month group + pills.
- [ ] **P3. Startup does O(all-time expenses) work synchronously before first paint** — three blob parses, `migrateExpenses`, `recalcBalances`, and `recalcMonthlyAgg(data, allExpenses())` (`finance-core.js:281-306`) — the last iterates every expense ever recorded and grows unboundedly. Then snapshot capture + `renderAll()` + reminder scheduling, all sync. Acceptable now; the `allExpenses()` aggregation is the part that will hurt first.
- [ ] **P4. Responsiveness gap: the CSS is mobile-only** — `finance.css` contains exactly **one** media query (`@media print`, line 1092). Viewport/safe-area/dvh handling is correct, and `.page { max-width: 640px }` means desktop gets a centered phone column — functional but not adaptive (no breakpoints, no pointer-hover affordances, sheets stay bottom-anchored). Add at least a `@media (min-width: 900px)` layer if desktop use matters.
- [ ] **P5. Touch targets below the 44px guideline on the most-tapped controls** — `.filter-pill` ≈29px tall (`finance.css:72-77`), expense rows ≈34px (`padding: 7px 0`). Tabs (48px) are fine; 40px icon buttons are borderline.
- [ ] **P6. 98 inline `onclick` attributes in `finance.html` plus every render** — no leak risk, but forces all handlers global, blocks any CSP without `unsafe-inline`, and is the root cause of the H4/H5 XSS class. Event delegation with `data-*` attributes removes the whole category.
- (Verified non-issues: `calcRetirementPlan`/CPF projections are ~50-row loops — microseconds, not a bottleneck. `renderAll()` correctly renders only the active tab and is not called excessively. Leaflet is lazy-loaded; fonts are subset and precached.)

### 3.3 Scalability risks

| Risk | Severity | Notes |
|---|---|---|
| `finance:v1:history` unbounded growth | High (long-term) | All past-year expenses accumulate forever; ~30k records ≈ 5MB quota, with zero quota handling (M7). First symptom: unhandled exception mid-save. |
| Drive sync round-trips whole files | Medium | Download + parse + stringify + upload of the full history per sync; at MB scale this janks the main thread on mobile. Merge itself is O(n) Maps — fine. |
| `monthlyAgg` recompute | Medium | Stored, but fully recomputed from `allExpenses()` on every expense change and at startup — a cache that costs O(all-time) to refresh (P3). |
| `_deletedIds` 500 cap | Low/Med | Correctness ceiling for long-stale partners (M8/L3). |
| `netWorthSnapshots`, `monthlyAgg` size, wikiData | Low | Effectively bounded; the wiki/history file split was the right call. |

### 3.4 Recommendations (ranked by value ÷ effort, all no-build-step compatible)

**Tier 1 — cheap, high value (~50 lines total)**
1. Single-flight sync mutex across the four entry points (fixes M1, halves H3's window).
2. try/catch around all three `setItem` paths with a persistent "Storage full — export your data" toast; stash corrupt blobs before resetting (fixes M7).
3. Fix the two stored-XSS sinks (H4, H5) — `data-*` + delegation, `esc(emoji)`.
4. SW: whitelist sibling caches in both activate handlers (H1), `ignoreSearch` for navigations (M10), `updatefound`/`controllerchange` reload toast (M12).
5. Load `finance-gmail.js` + pure parts of `finance-ai.js` in the test harness; add tests for the email parsers and `renderMarkdownLite`.

**Tier 2 — moderate effort, clear payoff**
6. Abort aux-file upload when the remote download failed (H2); persist new file IDs immediately (M3); carry `_metaTs` in the asset merge (H10); fix `lww()` null handling (M4).
7. Tombstone the missing deletion paths: dependents (H7), asset history entries (H8), cross-year expense moves (H9).
8. Fix the O(n²) renders (P1) and generalize targeted re-render (P2).
9. Consolidate UI state into one object / move state home (D8); extract `syncAuxFile` (D1); single source for tax pipeline and CPF defaults (D2, D3).
10. Touch targets ≥40px; optional desktop breakpoint (P4, P5).

**Tier 3 — structural, when pain is felt**
11. ES modules without a bundler (`<script type="module">` + explicit imports) — makes the dependency graph explicit and checkable, lets tests import directly; migrate one leaf file at a time. Pair with event delegation (P6), which also unlocks CSP.
12. IndexedDB for `historyData` — async, removes the only unbounded localStorage consumer and the O(all-time) startup aggregation; load history lazily when a history year is opened.
13. Drive optimistic concurrency: compare `headRevisionId` before upload, retry-merge on conflict (M2).
14. Web Worker for sync parse/stringify/merge once the history file reaches MB scale (defer until after #12 decides where history lives).

**Not recommended:** a framework, a bundler, or a virtual-DOM library — the app's value is its zero-toolchain deployability, and Tiers 1–2 capture most of the benefit without sacrificing that.
