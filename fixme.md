# Finance PWA — Outstanding Fixes

Remaining findings from the code review, ordered **High → Low**. The top-5
items (retirement double-inflation, SG tax brackets, Drive history-sync
masking + CSV import, crash/NaN guards, and the a11y/`.btn-full`/timezone/CPF-
memoization batch) are already fixed on `claude/finance-pwa-review-v4YCR` and
are **not** repeated here.

Each item: `severity` · `file:line` · description · suggested fix.

---

## 🟠 High

- [x] **Cross-store expense move doesn't propagate via `_deletedIds`** — `finance-expenses.js:~152-172`.
  Editing an expense across the year boundary moves it between `data.expenses`
  and `historyData.expenses` under the same id; main and history are merged
  independently, so a partner's stale copy in the other store can resurrect.
  *Fix:* when relocating between stores, add the id to `data._deletedIds` for
  the store it left (or dedupe across stores during merge).


---

## 🟡 Medium

- [ ] **Custom expense category silently rewritten to 'Other'** — `finance-expenses.js:~117-127`.
  Editing an expense whose category isn't in the dropdown resets it to 'Other'
  on open; saving without touching the dropdown permanently rewrites it.
  *Fix:* inject the record's existing category as a `<select>` option.

- [x] **Same-day asset value re-entry appends a duplicate** — `finance-investments.js:~548`.
  Correcting a value on the same date adds a second same-date history row.
  *Fix:* if `last.date === date`, replace in place instead of pushing.

- [ ] **Gmail parser import merges by non-unique `name`** — `finance-gmail.js:~51-56`.
  Duplicate/blank names silently clobber unrelated parsers. *Fix:* merge by a
  stable `id` (assign one on create) and/or warn on duplicate names.

- [x] **`avgMonthlyExpense` always divides by 12** — `finance-ai.js:~108`.
  Understates spend / savings-rate / runway for users with <12 months of data.
  *Fix:* divide by the count of months that actually have aggregated data
  (`Math.min(12, monthsWithData)`).

- [ ] **Mortgage "current balance" sort uses raw `_ts`** — `finance-insurance.js:~492, 660`.
  Undefined `_ts` on imported entries yields `NaN` comparisons → wrong balance.
  *Fix:* `(b._ts || 0) - (a._ts || 0)` (and same for date sorts using
  `localeCompare` on possibly-missing dates).


- [ ] **Retirement vs CPF accumulation use inconsistent interest conventions** — `finance-tax.js:~895-897` vs CPF loop.
  CPF gives a full year's interest on the year's contributions (overstates);
  retirement gives none on the year's savings (understates). *Fix:* adopt a
  consistent mid-year convention in both.

- [ ] **`calcRetirementPlan` uses ERS reference payout over actual projected payout** — `finance-tax.js:~879`.
  `cpfAnnualPayout = (ersRefPayout || lifePayout) * 12` credits ERS-level CPF
  income even on an FRS track. *Fix:* confirm intent; likely should use
  `lifePayout`.

- [ ] **Four duplicated chargeable-income/tax computations + four CPF-contribution loops** — `finance-tax.js` (`renderTaxChart`, `calcEffectiveTax`, `renderTaxRecords`, `updateTaxPreview`; CPF loops at age<55 / 55 / post-55 / `simulateSAOAtoRetire`).
  Drift risk. *Fix:* extract one `computeTaxBreakdown(record)` and one shared CPF
  contribution step.

- [ ] **`finance-tax.js` (~1100 lines) mixes income tax, CPF, retirement, PIN** — *Fix:* split into `finance-cpf.js` / `finance-retirement.js` (update load order + `sw.js` ASSETS + cache bump).

- [ ] **Full-list `innerHTML` rebuild on every search keystroke** — `finance-expenses.js` (`onSearchInput` → `renderExpenseList`).
  Janky on large histories, discards scroll position. *Fix:* debounce ~150ms.

- [ ] **Drive: pretty-printed JSON upload + no 401 re-auth/retry + sequential downloads** — `finance-drive.js` (`uploadToDrive` ~`:660`, `getAccessToken`, `driveSync`).
  *Fix:* drop `JSON.stringify(payload, null, 2)`; on HTTP 401 clear `driveToken`
  and retry once; `Promise.all` the two independent downloads.

- [ ] **`mergeData` budgets merge has no tombstone** — `finance-drive.js:~469`.
  `{ ...remote.budgets, ...local.budgets }` resurrects locally-deleted budgets
  and always prefers local on conflict. *Fix:* timestamp or tombstone budgets.

- [ ] **`mergeData` asset merge is O(n²)** — `finance-drive.js:~288-289`.
  `.find()` per asset over both arrays. *Fix:* pre-build id→asset Maps.

- [ ] **`getAccessToken` hangs if the consent popup is closed** — `finance-drive.js:~248`.
  `requestAccessToken({ prompt: '' })` may never fire its callback. *Fix:* add a
  timeout / `error_callback`.

- [ ] **No `localStorage` quota handling; corrupt-parse silently resets to defaults** — `finance-core.js` (`saveData`/`saveHistory` ~`:177/195`, `loadData`/`loadHistory` catch).
  *Fix:* wrap writes in try/catch with a "storage full" toast; on parse failure
  back up the raw string to a separate key before returning defaults.

- [x] **`recalcMonthlyAgg`/`recalcBalances` crash on a record missing `date`/`cat`** — `finance-core.js:~213`.
  `e.date.slice(0,7)` throws on a malformed/merged record, breaking render.
  *Fix:* guard `if (!e.date) return;`.

- [ ] **`uid()` collision risk under bulk import** — `finance-core.js:~242`.
  ~5 random base36 chars per ms. *Fix:* use `crypto.randomUUID()` when available.

- [ ] **`autoGenOngoingExpenses` calls `saveHistory` inside the loop** — `finance-insurance.js:~471`.
  Repeated localStorage writes when back-filling; also mixes history-year rows
  into `data.monthlyAgg`. *Fix:* batch the save after the loop; reconsider
  monthlyAgg for history years.

- [ ] **`mortgageAmortTable` recomputed every render** — `finance-insurance.js:~511, 576`.
  Full tenor×12 loop inside `.map`. *Fix:* memoize per mortgage signature.

- [ ] **Manifest scope is a file, not a directory; manifest not precached** — `manifest.json:6`, `sw.js`.
  `"scope": "/health/finance.html"` can push `?add=1` shortcuts out of scope.
  *Fix:* `"scope": "/health/"` and add `/health/manifest.json` to ASSETS.

- [ ] **Top-level tabs / sub-tabs not exposed as ARIA tablists** — `finance.html:22-26` and the four `*-sub-tabs` groups.
  *Fix:* `role="tablist"` / `role="tab"` + `aria-selected`, panels `role="tabpanel"`.

- [ ] **Dialogs lack focus trap / focus return** — sheets and `.modal` in `finance.html`.
  Markup-level `role=dialog` is done; behavioral trap is not. *Fix:* trap Tab
  within the open sheet/modal and restore focus to the opener on close.

- [ ] **PIN pad fixed `repeat(3, 72px)` overflows on ≤280px / large font zoom; `.toast` `white-space:nowrap` with no max-width** — `finance.css:~877, 388-396`.
  *Fix:* `minmax(0, 72px)` for the pad; `max-width: calc(100vw - 32px)` + allow
  wrapping on `.toast`.

- [ ] **`#busMapContainer` uses `vh` not `dvh`** — `finance.css:~569`.
  Layout shift when mobile browser chrome toggles. *Fix:* use `dvh`
  (consistent with the rest of the app).

- [ ] **`manifest.json` maskable icon not padded; no 192 maskable** — `manifest.json:10-13`.
  Risks Android adaptive-icon cropping. *Fix:* add a padded purpose-`maskable`
  icon.

---

## 🟢 Low

- [ ] **Dead code:** `PVA` (`finance-tax.js:~898`, unused), `renderTermWeekBanner` (`finance-events.js:~46-49`, only sets `display:none`), CSS `.card-row`/`.notif-hint`/`.time-picker-row` (`finance.css`).

- [ ] **`esc()` omits `'`** — `finance-app.js:~610`.
  Safe today (single-quoted attrs only interpolate `uid()` ids) but fragile.
  *Fix:* escape `'` too, or use `JSON.stringify` for JS-string `onclick` contexts.

- [ ] **`textContent = esc(...)` double-escapes** — `finance-investments.js:~576`.
  `textContent` already neutralizes HTML. *Fix:* drop `esc()` there.

- [ ] **`_deletedIds.push` without the documented guard** — `finance-expenses.js:~193`, `finance-investments.js:~564`, `finance-insurance.js:~131/248/641`.
  Throws if `_deletedIds` is ever undefined. *Fix:* guard before push (per CLAUDE.md).

- [ ] **`esc()` on `svc.ServiceNo` (transits untrusted proxy)** — `finance-events.js:~311, 559, 565`.
  Low likelihood, but a compromised proxy could inject via these fields.
  *Fix:* wrap in `esc()`.

- [ ] **`endTime` always defaulted; end-before-start never validated** — `finance-events.js:~761`.
  *Fix:* validate `end >= start`; don't force an endTime on end-less events.

- [ ] **Bus marker filter `!lat || !lng` rejects valid 0** — `finance-events.js:~540`.
  Harmless in SG. *Fix:* `Number.isFinite`.

- [ ] **Account-color logic hardcodes `acc1`/`acc2`** — `finance-expenses.js:~76`.
  Third/differently-id'd accounts all render as `acc2`. *Fix:* derive dot class
  from account index.

- [ ] **Dependents settings keyed by positional index** — `finance-investments.js:~108-124`.
  Clearing a middle row shifts id mapping. *Fix:* key by id.

- [ ] **Hardcoded hex colors bypass the theme system** — `finance.css` (event today/tomorrow highlights with `!important`, mortgage badges, acc-dots, bus green).
  *Fix:* move to theme CSS variables.

- [ ] **Touch targets under 44px** — `.filter-pill`, `.event-view-btn`, `.expense-item` rows (`finance.css`).
  *Fix:* raise min height / padding to 44px.

- [ ] **`CAT_COLORS` keys don't match real default categories** — `finance-app.js:~18-22`.
  Curated palette unused (falls through to `EXTRA_COLORS`). *Fix:* reconcile
  keys with actual category names.

- [ ] **Empty `catch {}` swallow errors** — `finance-drive.js:~560` (history download/merge), `finance-ai.js:~198/210/229`, `finance-tax.js` (`calcRetirementPlan` CPF try/catch).
  *Fix:* at least `console.warn(e)`.

- [ ] **No `&lt;meta name="description"&gt;`, no landmark roles / skip-link** — `finance.html`.
  *Fix:* add a description meta; wrap tabs in `&lt;nav&gt;` and pages in `&lt;main&gt;`.

- [ ] **Duplicated card/sub-tab CSS + render markup** — `finance.css` (`.analysis-sub-tab`/`.exp-sub-tab`/`.ins-sub-tab`/`.tax-sub-tab` identical), `finance-investments.js` (asset card markup duplicated), `finance-gmail.js` (`expCard`/`evCard`), `finance-events.js` (bus key-setup blocks).
  *Fix:* collapse into shared classes/helpers.

- [ ] **Inline `style="…"` in HTML despite "no inline CSS" intent** — `finance.html` (Drive modal, sheet buttons, version label).
  *Fix:* extract to classes (also helps CSP).

- [ ] **`reader.onerror` not handled in imports** — `finance-gmail.js:~46` (and other FileReader uses).
  *Fix:* add `reader.onerror` with a toast.

---

## Doc drift (CLAUDE.md)

- [ ] SW cache version listed as `finance-v64`; actual is `finance-v98`.
- [ ] `ASSET_CLASSES` doc omits `Gold` and `CPF` (code has both).
- [ ] "Investments tab" listed, but the app has 5 tabs — assets live under Tax.

---

## Verified non-issues (do NOT action)

- `renderMarkdownLite` (`finance-ai.js`) — XSS-safe (escapes before adding markup, emits only into element content).
- Asset-class "Gold vs Commodities" — `ASSET_CLASSES` has both; only CLAUDE.md is stale.
- Net-worth snapshot merge key — consistent (merges on full date); only the comment is misleading.
- Gmail regex ReDoS — regexes are only stored/displayed here, never executed (risk is in the Apps Script, out of scope).
- `month + '-31'` chart cutoff — intentional lexical end-of-month sentinel, correct for ISO strings.
