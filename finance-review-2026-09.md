# Finance PWA Review — September 2026

Three-perspective review of the Finance PWA (`finance.html`, `finance.css`, `sw.js`, 12 `finance-*.js` files, ~11.8k lines):

1. **UI designer** — layout, navigation, hierarchy, feedback, accessibility.
2. **Software engineer** — structure, correctness, testing, security, operations.
3. **Financial advisor** — is the model right, and what is missing for a real financial overview?

No code was changed; this list is the deliverable. Every point was verified against today's source. `npm test` passes (50/50).

**Relationship to the July 2026 review (`finance-review-2026-07.md`) and `fixme.md`:** the UI-designer section is entirely new ground. The other two sections do not repeat July's findings except where they are still open and still the highest-value action; those are listed once, up front, with a "still open" status verified today.

---

## 1. UI designer

### Information architecture

1. **Tabs do not match the mental model.** "Tax" hosts Assets, CPF and Retirement (all net-worth topics). "Analysis" hosts Mortgage and Power utilities. "Events" hosts bus arrivals, a rain radar and school (MOE) messages. "Wiki" hosts résumés and recipes. Six icon-only tabs hide roughly 23 sub-views. A regroup along user goals would help: Money (expenses, budgets, recurring), Wealth (assets, CPF, SRS, retirement, mortgage), Protection (insurance, medical), Tax, Life (events, bus, rain, MOE, wiki).
2. **No landing screen.** The app opens on Events. The headline finance numbers (net worth, savings rate, monthly spend) sit behind Analysis › AI Analysis. A home dashboard with three or four KPIs plus a "needs attention" list (over-budget categories, recurring items due, insurance renewals, next event) would be the single biggest usability gain.
3. **Icon-only tab bar with no labels.** `aria-label`s exist, but sighted users must guess that a receipt icon means Tax and a document icon means Wiki. Seven targets share the width of a phone. Add short text labels, or cut to five tabs.
4. **The floating "+" is a guessing game.** Its action changes with tab and sub-tab (on Tax it adds a tax year, a CPF record or an asset depending on the active sub-tab), and it is hidden on some sub-tabs. Nothing on the button signals what it will create. Recurring, Mortgage and CPF already have their own inline "+ Add" buttons, so the pattern is inconsistent. Use a labelled extended FAB ("+ Expense") or per-section Add buttons everywhere.
5. **Five look-alike sub-navigation components.** Expenses, Analysis, Insurance, Tax and Wiki each have their own sub-tab CSS family with near-identical rules; Events uses a right-aligned icon row plus a separate Upcoming/Past bar; Analysis mixes an emoji tab (🤖) with Material icons. Unify into one component with one style.

### Visual hierarchy and legibility

6. **Type is too small for money.** The stylesheet has 5 rules at .68rem (~11px), 7 at .7rem and 10 at .72rem, plus 57 inline `.6x–.7x rem` font sizes in the JS renders. The retirement table (11 columns) runs at .72rem and the amortization table at .76rem; the chart axis labels are 8px SVG text. Much of this carries the actual numbers. Platform guidance is 12px minimum for secondary text and 16px for body copy.
7. **Touch targets below the minimum.** Filter pills are ~28px tall, event view buttons ~30px, sub-tabs ~34px, the tax-relief "×" is a bare glyph. Apple recommends 44pt, Material 48dp. The tab bar (48px) and FAB (56px) are fine.
8. **Colour semantics are overloaded.** Red is spend, deduction, over-budget, mortgage line, danger button and the secondary-styled Delete button; green is TopUp, under-budget, asset line, "Filed" badge and "Annual" badge. Account dots are hardcoded blue and pink. Category chart colours are keyed to categories that do not exist in the defaults (Food, Transport…), so real categories get index-based fallback colours that shift when a category is added. Define a semantic palette (money-in, money-out, ok/warn/over, neutral) and stable per-category colours stored with the category.
9. **Charts are hard to read on a phone.** Hand-rolled SVGs with horizontal scroll and no scroll affordance, no tap-to-inspect values, colour-only series differentiation (fails colour-blind users), and line charts for categorical monthly spend where stacked bars would read better. Legend items toggle but there is no "solo this series".

### Interaction and feedback

10. **Destructive actions rely on 21 native `confirm()` dialogs and there is no undo.** Delete buttons are styled as secondary in some sheets and danger in others. The tombstone mechanism makes a 5-second "Undo" toast cheap; use an in-app confirm sheet for the rest.
11. **"Hide Balances" is partial and the PIN gate is misplaced.** Hide Balances masks only the Expenses list and the YTD pill; assets, net worth, CPF, retirement and mortgage balances stay visible. The PIN protects the Tax tab, but net worth is on Analysis. Users will assume privacy mode is app-wide. Make both cover every money figure.
12. **Toasts are the only feedback channel.** They carry success, validation errors and 10-second sync failures with stack locations. There are no loading skeletons for Drive sync, bus or rain, no offline indicator, and service-worker updates are silent. Add a header sync/offline status pill and an "Update available, tap to reload" banner.
13. **Sheets and modals lack keyboard and focus handling.** No Escape to close, no focus trap, no focus return to the trigger; `aria-modal` is set but the page behind stays tabbable. Sheets are 92dvh with `required` fields, so the on-screen keyboard overlaps the Save button on small phones.
14. **Forms put the primary field third.** The expense sheet lists Account and Category before Amount, although Amount gets auto-focus. The custom day/month/year widget is good for local entry but is invisible to keyboard and screen-reader users (the capture input is `aria-hidden`). Number fields have no currency prefix. The default category "Grocery" silently becomes empty if the user renamed that category.
15. **Settings are piled into two long sheets.** Account Settings mixes account names and balances, the tax PIN, CPF birth dates, dependents, school terms and event tags. Expense Budget mixes emoji, monthly budget and email-regex keywords in one row per category. Split by concern and move the developer-facing fields (regex keywords, Drive client and file IDs) behind an "Advanced" section.
16. **The Drive setup exposes raw Google Client IDs and file IDs in monospace inputs.** Turn it into a three-step wizard (sign in, create or join, share code) and hide IDs unless expanded.

### Theming and inclusivity

17. **No dark mode and no reduced-motion handling.** Three light themes only, no `prefers-color-scheme`, static `theme-color`. A finance app is often checked at night. The PIN shake and bus-marker pulse ignore `prefers-reduced-motion`.
18. **Personal assumptions leak into controls.** Sliders are bounded to $100k–$200k annual savings and $3,000–$5,000 monthly mortgage; CPF entries are labelled Husband/Wife; bus stops are named. Fine for a two-user app, but a slider whose range excludes the true value reads as a bug. Use free number inputs with sensible defaults, and person labels drawn from settings.
19. **Empty states are good; onboarding is absent.** Every list has a consistent empty state, but a new user lands on an empty Events tab with no hint that the finance features live elsewhere.

---

## 2. Software engineer

### Still open from July (verified today; close these first)

1. **No full export/import of the data** (only parser configs and the AI summary can be exported). The storage-full toast still tells users to export.
2. **`deletedSet` in `syncWithMetadata` is built once before the main merge**, so a partner's fresh tombstones do not apply to the history/wiki branches in the same sync.
3. **`refreshPwaCache` deletes every cache on the origin**, including the tracker's and the rain-frame archive that `sw.js` carefully whitelists.
4. **Three `toISOString()` date sites remain** (event today/tomorrow highlight, yearly-chart cutoff, 12-month KPI window), all wrong between midnight and 08:00 SGT.
5. **Recurring generation stamps `lastAutoGenPeriod` without bumping `_updatedAt`**, so the stamp never syncs and both devices can generate the same month twice.
6. **Dead code is still present:** `simulateSAOAtoRetire`, `cpfContrib`, `CPF_ERS`, `CPF_OW_CAP`, `fmtEventCountdown`, `annualRecurring`, `recalcAll`.

### Structure

7. **One global namespace across 12 scripts.** `esc()` is defined in the second-to-last file yet called by every earlier render; tab and FAB wiring in the first file references six later files; the events view state and the Tax sub-tab switcher live in `finance-expenses.js`. Move to ES modules progressively (still no build step), or at least a single app namespace object with an explicit dependency header per file.
8. **Full-tab innerHTML rebuilds with 159 inline `onclick` handlers and 315 inline `style` attributes in JS.** This blocks any Content Security Policy, makes XSS a per-line discipline, resets scroll position on every save, and the expense list recomputes per-account balances per month header. Event delegation with `data-*` attributes plus a small template helper fixes all four; `finance.css` already has a "utility classes extracted from inline styles" section, so finish that job.
9. **Derived state is persisted and synced.** `monthlyAgg` and `accounts[].balance` are recomputed on every load and also stored and merged across devices. Compute on load, drop them from the stored shape and from `mergeData`.
10. **Duplication that must be kept in lockstep:** nine near-identical delete functions, four near-identical sync branches, five sub-tab switchers of the same shape, two annual-multiplier tables that disagree on weekly/yearly, the SRS contribution literal repeated, and a local `ERS_2026` that contradicts the global `CPF_ERS`. One `deleteRecord(collection, id)`, one `COLLECTIONS` table driving merge and tombstone filters, one `switchSubTab(group, tab)`.
11. **Data model has no schema version.** Migrations are sprinkled through `loadData`/`loadHistory`/`loadWiki` as `if (!d.x)` guards; IDs mix UUIDs and base36; timestamps mix `_ts`, `_updatedAt` and `_metaTs`; accounts are hardcoded to two (`acc1`/`acc2` appear in CSS and in the expense list). A `schemaVersion` with an ordered migration list would replace the guards.
12. **Non-finance features ride the finance bundle.** Bus, rain radar, MOE and the wiki share the service-worker asset list, the load time and the main data blob, so a rain-radar change forces a finance cache bump. Split them into their own page and worker, or at least lazy-load their scripts.

### Correctness and testing

13. **Tests cover the merge logic well and almost nothing else.** Of 50 tests, about 35 target `mergeData`. Zero coverage for the CPF SA projection, CPF LIFE payout, SRS projection, mortgage instalment and amortization, `computeNetWorth`, `computeCashflow`, `buildAiSummary`, `getOngoingNextDue`, `parseCatEmojis`, and `renderMarkdownLite` (security-relevant).
14. **No CI runs the tests and there is no linter or formatter.** The two workflows cover the Android bridge and the Modal deploy only. A `test.yml` running `npm test` on every push, plus ESLint with a small config, would catch the load-order and undefined-global class of bug before it ships.
15. **Failure handling is mostly silent.** Only 3 `console.*` calls in ~11k lines. `loadData`, `loadHistory` and `loadWiki` catch parse errors and reset to defaults, which is data loss without notice. `renderAll` catches and blanks the tab with a generic toast. Add global `error`/`unhandledrejection` handlers, keep a last-good copy of each blob before replacing it, and surface parse failures.
16. **Storage is synchronous localStorage with whole-blob stringify on every save**, including slider `onchange`. There is no `navigator.storage.estimate()` check and no `persist()` request, so the browser may evict the PWA's data. Move to IndexedDB (the tracker already uses it) with an in-memory write-through and a debounced persist.
17. **Drive uploads have no precondition.** No `If-Match`/revision check, so two devices syncing together can lose LWW scalar writes (documented residual race). Drive v3 exposes `headRevisionId`; a compare-and-retry loop is small.

### Security and operations

18. **OAuth asks for the full `drive` scope.** `drive.file` would limit the app to files it created or was given, at the cost of the name-based lookups (`findDriveFileByName`, the MOE inbox written by another app). Worth deciding explicitly and documenting.
19. **Leaflet loads from unpkg without `integrity` or `crossorigin`.** No subresource integrity, and the missing `crossorigin` is why the external cache never actually stores it (opaque responses fail the `res.ok` gate).
20. **The service worker updates silently.** `skipWaiting` plus `clients.claim` swaps assets under a running page (mixed-version state until reload) and users never learn an update exists. A `controllerchange` listener with a reload prompt is about ten lines. The manual cache-bump rule is convention-only; a pre-commit hook that bumps the version when any ASSETS file changed would remove the failure mode.
21. **Documentation is load-bearing and drifting.** CLAUDE.md quotes cache `v184` (actual `v207`) and stale line counts; it claims `calcCpfProjection` is tested (no such function); `docs/finance.md` describes CPF-class double counting that has been fixed. Because the invariants live in the docs, drift is expensive.

---

## 3. Financial advisor

### Still missing from July (verified today; highest value)

1. **Full backup/export**, an **income ledger** (income is inferred from the latest tax estimate; TopUp conflates salary with inter-account transfers), **insurance sum assured and dates**, **SRS in net worth**, an **emergency-fund/runway KPI**, and a **12-month cash-flow forecast** from the scheduled outflows the app already stores.

### Model correctness

2. **The savings rate ignores CPF.** For a Singapore employee, up to 37% of ordinary wages goes to CPF. The KPI is (gross income − cash spend) ÷ gross income, so it neither counts CPF as saving nor removes it from disposable income. Show two figures: cash savings rate on take-home pay, and total savings rate including employee and employer CPF plus SRS.
3. **The retirement plan is supply-driven, not need-driven.** It shows what a safe withdrawal rate allows but never compares that to required spending. `retirementSettings.monthlyExpenses` exists but is unused in the calculation, while the last-12-month average spend is available. Add a need-versus-capacity gap, a funded ratio and a "portfolio survives to age N" line.
4. **Retirement ignores tax and healthcare.** SRS withdrawals are 50% taxable (and penalised before the statutory retirement age); MediShield Life and Integrated Shield premiums rise steeply with age; MediSave is not modelled in drawdown; the home is tracked but no downsizing or lease-buyback option exists.
5. **CPF LIFE is understated when SA is below FRS.** The Retirement Account is formed from SA only; in reality OA is also transferred up to FRS at 55. A member with a small SA and a large OA gets a much lower projected payout than CPF would actually give. Also, CPF's extra interest (1% on the first $60k, a further 1% on the first $30k after 55) is not modelled, so balances are understated for everyone.
6. **CPF constants are single-year and partly stale.** The Basic Healthcare Sum is the 2025 figure and rises every January; the global Enhanced Retirement Sum is defined as 1.5× FRS while the SA projection uses the current 2× rule; the senior-worker contribution table predates the 2025/2026 step-ups. A year-stamped table with a visible "rates as of" footnote keeps projections honest.
7. **CPF LIFE payout uses a home-grown annuity formula with a mortality-credit slider.** Interpolating from CPF's published payout ranges for the Standard, Basic and Escalating plans at FRS and ERS, and letting the user pick the plan, would be more defensible. The Escalating plan's 2% growth matters against the inflation assumption used elsewhere.
8. **The SA projection assumes a fixed $102,000 CPF-able salary and $15,300 SRS every year.** These are personal constants baked into code rather than settings, and the SRS cap is a fixed number in the source rather than a year-stamped one.

### Budgeting and cash

9. **Budgets are monthly only.** The annual summary multiplies by 12, which misrepresents lumpy categories such as Travel, Income Tax and insurance premiums. The current month counts as fully elapsed, so mid-month always looks under budget. Allow annual budgets, prorate the current month, and add rolling three-month and year-over-year comparisons.
10. **Only two cash accounts and no liabilities beyond mortgages.** Credit cards, car or education loans and joint accounts cannot be represented, so net worth is overstated for anyone carrying a card balance, and there is no "bills due" view.
11. **Foreign currency is a static USD rate for expenses only.** Assets have no purchase currency, so foreign holdings are entered in SGD by hand and FX movement is invisible in performance.

### Investments and net worth

12. **Assets track values but not cost basis or cash flows.** No money-weighted or time-weighted return, no unrealised gain, no dividend income, and "up $40k" cannot be split into contributions versus market. Add contribution and withdrawal entries per asset and compute XIRR per asset and for the portfolio.
13. **Two definitions of "investable".** Asset allocation targets include CPF and SRS categories, while the retirement drawdown excludes them. Decide one definition and label it. There is also no rebalancing band or alert, and "Other" has no look-through.
14. **Net-worth history is four points a year.** Auto snapshots are quarterly; a monthly cadence makes the trend useful. The snapshot already stores liquid, investable, CPF and debt, so a stacked chart of composition is free.

### Protection, tax and household

15. **Insurance cannot answer "am I under-insured".** Premium frequency is only monthly or annual (the AI summary already handles quarterly), and there is no sum assured, policy term, renewal date, premium end date or per-person coverage roll-up. Standard rules of thumb (about 9–10× income for life cover, about 4× for critical illness) cannot be computed, and endowment maturities cannot appear as future cash inflows.
16. **Tax reliefs are free text with no eligibility logic.** No $80,000 total-relief cap, no CPF relief limits, no Qualifying Child or Working Mother's Child Relief, Parent Relief, CPF cash top-up or SRS relief, NSman relief or 250% donations. Dependents' ages and sex are already captured, so a relief checklist with "likely eligible" flags and a "top up $X, save $Y" calculator is cheap. Rate tables exist only for YA2024 onwards.
17. **Mortgage is fixed-rate for the full tenor.** Singapore loans reprice after lock-in. Add a rate-reset date with a reminder, a prepay-versus-invest comparison against the investment-return assumption, and the OA-versus-cash split of the instalment (the CPF tab has a mortgage slider but the mortgage record does not know it).
18. **No goals.** Children's birth years are known, so university funding (local versus overseas, years to go, funded so far) can be projected; parent-support and big-ticket goals have no home. Funded ratios per goal would sharpen both the retirement plan and the AI report.
19. **The AI advisor is asked to judge what the data cannot support.** The prompt requests insurance adequacy, tax-relief opportunities and education planning, but the summary lacks coverage amounts, relief eligibility and goals, so the model will guess. Feed it computed KPIs (runway, both savings rates, funded ratio, coverage ratios) and request a structured action-item block the app can render as a checklist.
20. **Estate and continuity.** CPF nomination, will, Lasting Power of Attorney, insurance nominations and a "what to do if" account inventory for the partner are absent. The app already syncs to a partner; the Wiki is the natural home for this checklist.

---

## 4. Suggested order

1. Close the six still-open engineering items (export/import first).
2. Dashboard tab with KPIs, app-wide Hide Balances, labelled tab bar, larger money type and 44px targets.
3. Savings rate with CPF, need-versus-capacity retirement gap, OA-to-RA transfer and extra interest in the CPF model.
4. Insurance coverage fields, relief checklist, annual budgets, more accounts and liabilities.
5. Tests for the finance math, a CI test workflow, and the delete/merge/sub-tab consolidation.
