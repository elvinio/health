# Health Repo — Claude Notes

## Repo overview

Personal health and finance tools, all served as **static files under `/health/`**
via GitHub Pages. No build step, no bundler — plain `<script src>` files. The repo
holds three independent things that share an origin but little code:

1. **Finance PWA** — `finance.html` + `finance.css` + 10 `finance-*.js` files +
   `sw.js`. **Deep-dive → [`docs/finance.md`](docs/finance.md).**
2. **Health Tracker PWA** — `tracker.html` + `tracker-chat.js` + `tracker-radio.js`
   + `sw-tracker.js`. **Deep-dive → [`docs/tracker.md`](docs/tracker.md).**
3. **Fitness/nutrition knowledgebase** — `index.html` (a large static reference
   page) + the `*.md` content files (`cardio.md`, `nutrition.md`,
   `strength-training.md`, `supplements.md`, …) it is built from, plus the
   standalone health-plan pages `her.html` / `him.html`.

The two PWAs are essentially decoupled: the only shared runtime file is
`themes.css`. They have **separate** service workers, manifests, and localStorage
namespaces (`finance:*` vs `health:*`), so they coexist on the same origin without
colliding. **Work on one app rarely touches the other** — read the matching
deep-dive doc rather than loading both.

## File index

| File | Purpose | ~Lines |
|---|---|---|
| **Finance PWA** (details in `docs/finance.md`) | | |
| `finance.html` | Finance PWA shell — HTML only (no inline CSS or JS) | 1083 |
| `finance.css` | Finance PWA styles | 916 |
| `finance-core.js` | Constants, data layer, utilities, sheet/tab/FAB helpers, SG tax + CPF constants | 415 |
| `finance-drive.js` | Import/export + Google Drive bidirectional sync (metadata file + per-file watermarks + gzipped data files) + merge logic | 960 |
| `finance-expenses.js` | Expenses tab — render, CRUD, filters, year/account pills, sub-tab switching | 375 |
| `finance-investments.js` | Account settings, budgets, assets, asset allocation, investment history modal | 627 |
| `finance-events.js` | Events tab, calendar, bus panel, Leaflet map, notes, reminders | 934 |
| `finance-insurance.js` | Insurance, medical visits, recurring expenses, mortgages | 816 |
| `finance-tax.js` | Income tax, CPF projection, retirement planning, tax PIN | 1186 |
| `finance-ai.js` | AI advisor — net-worth snapshots, savings/runway, consolidated summary builder, Drive push/fetch, Markdown report render | 582 |
| `finance-wiki.js` | Wiki tab — Recipe, Shopping List, Resume CRUD; tap-to-view / swipe-to-edit gesture; resume PDF print | — |
| `finance-app.js` | Analysis tab, `renderAll()`, theme picker, `esc()`, DMY widget, init sequence | 791 |
| `finance-gmail.js` | Email parser rules (expense + event parsers) | 268 |
| `sw.js` | Service worker for `finance.html` | 76 |
| `apps-script/quarterly-report.gs` | Optional Google Apps Script — quarterly Claude API call → Drive report | — |
| **Health Tracker PWA** (details in `docs/tracker.md`) | | |
| `tracker.html` | Health tracker shell — `Storage`, `DriveSync`, hash router, Today/History/Health/Setup tabs | — |
| `tracker-chat.js` | Chat tab — browser Claude agent (`@anthropic-ai/sdk` via ESM CDN); history/program tools; streaming, prompt caching, per-profile sessions | — |
| `tracker-radio.js` | Radio tab — on-demand AI radio: Claude script → self-hosted Kokoro TTS; manual prompt/paste path; royalty-free piano interstitials; IndexedDB audio; custom player | — |
| `sw-tracker.js` | Service worker for `tracker.html` (caches `tracker-chat.js` + `tracker-radio.js`; `esm.sh` SDK in `EXT_CACHE`) | — |
| `apps-script/classicals-proxy.gs` | Optional Google Apps Script — scrapes classicals.de solo-piano selection (server-side, bypasses 403/CORS) and returns each MP3 as base64; caches in a `radio-music-cache` Drive folder. Powers Radio interstitial music. | — |
| **Shared / knowledgebase / assets** | | |
| `themes.css` | Shared CSS themes (navy, earth, pastel) — used by **both** PWAs | — |
| `index.html` / `*.md` / `her.html` / `him.html` | Fitness & nutrition knowledgebase + health-plan pages | — |
| `manifest.json` / `manifest-tracker.json` | PWA manifests (finance / tracker) | — |
| `icons/` | PWA icons (192px, 512px, tracker icon) | — |
| `fonts/material-symbols-outlined.{css,woff2}` | Self-hosted icon font subset (finance) — see `docs/finance.md` | — |
| `fonts/eb-garamond.woff2` | Self-hosted serif for resume PDF (finance) — see `docs/finance.md` | — |
| `finance-data-structure.md` / `finance-import-format.md` | Finance data schema + import format specs | — |
| `tests/harness.js` / `tests/finance.test.js` | Test harness + `node:test` suite (finance pure logic) | — |

## Shared conventions (apply to both PWAs)

- **No build step.** Both apps are plain `<script src>` files sharing a global
  scope — no ES modules, no bundler, no framework. Each file may reference globals
  defined in files loaded before it.
- **Offline-first PWAs.** Each app has its own service worker that pre-caches its
  assets. See the cache-versioning rule below.
- **Self-hosted fonts**, pre-cached by the service worker, so they load offline.
  The finance subset/refresh recipes live in `docs/finance.md`.
- **Themes** (`themes.css`) are shared: a `theme-{navy,earth,pastel}` class on
  `<html>` driving CSS custom properties.
- **Browser-side Claude.** Both apps call Claude directly from the browser
  (`finance-ai.js`'s advisor; `tracker-chat.js` / `tracker-radio.js`). When
  touching any LLM call, follow the latest Claude API guidance.

## IMPORTANT: Service worker versioning

**Bump the cache version whenever any file in that worker's ASSETS list is
modified** — otherwise users keep being served stale cached files after deploy.

- **Finance** — `sw.js` line 1: `const CACHE = 'finance-v183';` (increment the
  number). ASSETS list (20 files) and the `EXT_CACHE` note are in `docs/finance.md`.
- **Tracker** — `sw-tracker.js` line 1: `const CACHE = 'health-tracker-v13';`.
  ASSETS = `tracker.html`, `tracker-chat.js`, `tracker-radio.js`.

> Dev-only files (the `tests/` suite) are **not** in any ASSETS list, so changing
> them does not require a cache bump.

## Testing

Pure finance logic has a minimal, dependency-free test suite under `tests/` using
Node's built-in runner (`node:test`). No build step, no framework to install.

```bash
npm test                       # → node --test tests/*.test.js
node --test tests/*.test.js    # equivalent
```

**How it works** — the app ships as plain `<script src>` files with no module exports, so they can't be `require()`d. `tests/harness.js` concatenates the **pure-logic** files (`finance-core`, `-investments`, `-insurance`, `-tax`, `-drive`), runs them once inside a Node `vm` sandbox with lightweight browser stubs (`document`, `localStorage`, `navigator`, …), and exposes the functions — plus `getData`/`setData`/`getHistory`/`setHistory` accessors for the globals — via `loadFinance()`.

- UI-only files (`finance-app.js`, `-events.js`, `-gmail.js`, `-ai.js`, `-expenses.js`) are **not** loaded — their bottom-of-file init would run DOM rendering / SW registration on load. If a tested function grows a dependency on one of them, add the file to `FILES` in `harness.js`.
- **Coverage:** `calcSGTax`, `getOngoingDueInfo` (recurring date math), `mergeData`, `mergeHistoryData`, `mergeWikiData`, `calcCpfProjection`, `calcRetirementPlan`.
- **Gotchas when adding tests** (see `tests/README.md`): sandbox-returned values carry the vm realm's prototypes, so `assert.deepStrictEqual` fails on prototype identity — use the `plain()` JSON-round-trip helper; `calcSGTax` returns un-rounded floats — use the `closeTo()` tolerance helper.

The tracker has no automated tests.

## Where to look

- **Finance internals** (data model, Drive sync/merge, tabs/sheets, AI advisor,
  fonts, init sequence, `renderAll()`): **[`docs/finance.md`](docs/finance.md)**
- **Tracker internals** (`Storage` model, hash routes, Chat agent, Radio pipeline,
  Drive backup, `health:*` keys): **[`docs/tracker.md`](docs/tracker.md)**
