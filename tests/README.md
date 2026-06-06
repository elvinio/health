# Finance PWA tests

A minimal, dependency-free harness for the app's **pure logic**. No build step,
no test framework to install — just Node's built-in test runner (`node:test`).

```bash
npm test
# or
node --test tests/*.test.js
```

## How it works

The app ships as plain `<script src>` files that share one global scope and have
no module exports, so they can't be `require()`d directly. `harness.js`
concatenates the files holding the pure logic, runs them once inside a Node `vm`
sandbox with lightweight browser stubs (`document`, `localStorage`, `navigator`,
…), and exposes the functions — plus `getData`/`setData` accessors for the global
`data` object — through `loadFinance()`.

UI-only files (`finance-app.js`, `finance-events.js`, `finance-gmail.js`,
`finance-ai.js`, `finance-expenses.js`) are intentionally **not** loaded: their
bottom-of-file init would run DOM rendering / service-worker registration on
load. If a tested function ever grows a dependency in one of those files, add the
file to `FILES` in `harness.js`.

## Coverage

- `calcSGTax` — IRAS resident tax bands, cumulative figures, monotonicity
- `getOngoingDueInfo` — recurring-expense date math (monthly/quarterly/annual,
  day-clamping, before-start/before-due guards)
- `mergeData` — Drive sync conflict resolution (union-by-id, tombstones,
  account/budget/asset/snapshot rules, balance recompute)
- `mergeHistoryData` — past-year expenses + power-record union
- `calcCpfProjection` / `calcRetirementPlan` — projection structure & key invariants

## Gotchas when adding tests

- Values returned from the sandbox carry that realm's prototypes, so
  `assert.deepStrictEqual` fails on prototype identity. Use the `plain()` helper
  (JSON round-trip) before deep comparison.
- `calcSGTax` returns un-rounded floats — compare with the `closeTo()` helper.
