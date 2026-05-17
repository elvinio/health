# Finance App — Data Structure & File Format

This document describes the complete storage design used by `finance.html`. Read this before importing data, writing migration scripts, or building tooling that produces files for this app.

---

## Storage architecture

The app splits data across two localStorage keys and two Google Drive files to keep current-year writes fast and history reads lazy.

| localStorage key | Drive file | Contains | Written when |
|---|---|---|---|
| `finance:v1` | `finance-elvis.json` | Accounts, current-year expenses, assets, budgets, aggregations, metadata | Every expense add/edit/delete |
| `finance:v1:history` | `finance-elvis-history.json` | All past-year expenses (every year except the current calendar year) | Rarely — only when past expenses change or year rolls over |

**Current year** is defined as `new Date().getFullYear()` at runtime. On the first load of a new year the app automatically migrates the previous year's expenses from the main store into history.

---

## Main file — `finance-elvis.json`

### Top-level structure

```json
{
  "accounts": [...],
  "expenses": [...],
  "assets": [...],
  "budgets": {},
  "monthlyAgg": {},
  "historyUpdatedAt": 1747440000000,
  "_deletedIds": []
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `accounts` | array | yes | Exactly 2 account objects |
| `expenses` | array | yes | **Current-year expenses only** (year matches `new Date().getFullYear()`) |
| `assets` | array | yes | Investment assets with value history |
| `budgets` | object | no | Monthly budget limits per category. Keys are category names, values are numbers. Omit or set to `{}` if none. |
| `monthlyAgg` | object | no | Pre-computed per-month category totals derived from **all** expenses (current + history). The app rebuilds this automatically on import, so you may set it to `{}`. |
| `historyUpdatedAt` | number | no | Unix timestamp (ms) of the last write to the history file. Used during Drive sync to decide whether the history file needs downloading. Set to `0` or omit if history is empty. |
| `_deletedIds` | array | no | IDs marked as deleted — prevents re-merging deleted records. Set to `[]` for fresh data. |

---

### `accounts[]`

```json
{
  "id": "acc1",
  "name": "Alice",
  "startingBalance": 5000.00,
  "balance": 4320.50,
  "_updatedAt": 1747440000000
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Must be exactly `"acc1"` or `"acc2"` |
| `name` | string | yes | Display name for the account owner |
| `startingBalance` | number | yes | Opening balance |
| `balance` | number | yes | Current balance. The app recalculates this on import — set equal to `startingBalance` if unsure. |
| `_updatedAt` | number | no | Unix timestamp (ms) of last settings change. Set to `0` or omit. |

Always include exactly 2 accounts with IDs `"acc1"` and `"acc2"`.

---

### `expenses[]` — current year only

Each entry is one transaction dated within the **current calendar year**.

```json
{
  "id": "lf3k2abc9",
  "ac": "acc1",
  "date": "2026-05-15",
  "desc": "Grocery shopping",
  "amount": 87.40,
  "cat": "Food",
  "_ts": 1747440000000
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique alphanumeric string (8–12 chars). Must be unique across all expenses in both files. |
| `ac` | string | yes | `"acc1"` or `"acc2"` |
| `date` | string | yes | `YYYY-MM-DD`. Must start with the current year (e.g. `"2026-…"`). |
| `desc` | string | yes | Free-text description |
| `amount` | number | yes | Positive number. Expenses reduce balance; TopUp entries increase it. |
| `cat` | string | yes | One of: `Food`, `Transport`, `Shopping`, `Health`, `Entertainment`, `Bills`, `Other`, `TopUp` |
| `_ts` | number | no | Unix timestamp (ms) of creation/last edit. Used for conflict resolution. Set to `0` or omit. |

---

### `assets[]`

```json
{
  "id": "mx9z1def4",
  "name": "S&P 500 ETF",
  "history": [
    { "date": "2026-01-01", "value": 12000.00, "_ts": 1735689600000 },
    { "date": "2026-05-15", "value": 13500.00, "_ts": 1747440000000 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique identifier |
| `name` | string | yes | Display name |
| `history` | array | yes | Chronological valuations. Must have at least one entry. Last entry = current value. |
| `history[].date` | string | yes | `YYYY-MM-DD` |
| `history[].value` | number | yes | Asset value on that date |
| `history[]._ts` | number | no | Unix timestamp (ms). Used for deduplication during sync. |

Sort `history` oldest-first.

---

### `monthlyAgg` — computed field

Pre-computed spending totals per month per category, built from **all** expenses across all years. The app rebuilds this automatically whenever expenses change, so for import purposes you can always set it to `{}`.

Shown here for reference (e.g. if pre-populating for performance):

```json
{
  "monthlyAgg": {
    "2026-05": { "Food": 250.50, "Transport": 120.00, "Bills": 200.00 },
    "2026-04": { "Food": 310.00, "Shopping": 95.00 },
    "2025-12": { "Food": 280.00, "Entertainment": 60.00 }
  }
}
```

`TopUp` entries are excluded. `Other` is included in storage but excluded from the analysis view at render time.

---

## History file — `finance-elvis-history.json`

Contains all expenses dated **before** the current calendar year. The structure is intentionally minimal.

### Top-level structure

```json
{
  "expenses": [...],
  "_updatedAt": 1747440000000
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `expenses` | array | yes | All past-year expense objects (same schema as current-year expenses, but with dates in any prior year) |
| `_updatedAt` | number | yes | Unix timestamp (ms) of the last write to this file. The main file mirrors this value in `historyUpdatedAt`. During Drive sync, the app compares these timestamps to decide whether to download this file at all. Set to `Date.now()` at generation time. |

The expense objects inside `expenses` use the identical schema as in the main file. The only difference is the `date` field, which must be in a year **earlier** than the current calendar year.

---

### History file example

```json
{
  "expenses": [
    {
      "id": "exp2025a",
      "ac": "acc1",
      "date": "2025-11-03",
      "desc": "Supermarket",
      "amount": 145.00,
      "cat": "Food",
      "_ts": 1730592000000
    },
    {
      "id": "exp2025b",
      "ac": "acc2",
      "date": "2025-12-20",
      "desc": "Flight tickets",
      "amount": 620.00,
      "cat": "Transport",
      "_ts": 1734652800000
    },
    {
      "id": "exp2024a",
      "ac": "acc1",
      "date": "2024-06-14",
      "desc": "Annual insurance",
      "amount": 980.00,
      "cat": "Bills",
      "_ts": 1718323200000
    }
  ],
  "_updatedAt": 1747440000000
}
```

---

## How the two files relate during sync

The app embeds `historyUpdatedAt` (a Unix ms timestamp) in the main file so that after downloading `finance-elvis.json`, it can decide whether `finance-elvis-history.json` needs fetching at all:

```
Download finance-elvis.json
  → read remote.historyUpdatedAt

Compare with local historyData._updatedAt:
  remote > local  →  download history file, merge, upload both
  local > remote  →  skip download, upload local history, update timestamp
  equal           →  skip history file entirely (1 download + 1 upload total)
```

This means a typical sync where no old expenses changed costs exactly one download and one upload.

---

## Migration script specification

### Goal

Produce two files from an existing single-blob export:
- `finance-elvis.json` — main file containing only current-year expenses
- `finance-elvis-history.json` — history file containing all other expenses

### Input format

The old export is a single JSON file (typically exported as `finance-elvis-YYYY-MM-DD.json` or imported from `finance:v1` localStorage) with the following shape:

```json
{
  "accounts": [...],
  "expenses": [...all years mixed together...],
  "assets": [...],
  "budgets": {},
  "_deletedIds": []
}
```

The `expenses` array contains entries from all years with `date` fields in `YYYY-MM-DD` format. There is no `monthlyAgg` or `historyUpdatedAt` field in the old format.

### Migration steps

1. **Determine current year**: `currentYear = new Date().getFullYear()` as a 4-digit string (e.g. `"2026"`).

2. **Split expenses by year**:
   - `currentExpenses` = entries where `expense.date.startsWith(currentYear + "-")`
   - `historyExpenses` = all remaining entries

3. **Build the main file**:
   - Copy `accounts`, `assets`, `budgets`, `_deletedIds` from the source unchanged.
   - Set `expenses` to `currentExpenses`.
   - Set `monthlyAgg` to `{}` (the app will rebuild it on next load).
   - Set `historyUpdatedAt` to the current Unix timestamp in ms **if `historyExpenses` is non-empty**, otherwise `0`.

4. **Build the history file**:
   - Set `expenses` to `historyExpenses`.
   - Set `_updatedAt` to the same timestamp used for `historyUpdatedAt` in step 3.

5. **ID uniqueness**: Verify that no `id` value appears in both `currentExpenses` and `historyExpenses`. If duplicates exist, flag as an error — IDs must be globally unique.

6. **Output**:
   - Write the main object to `finance-elvis.json`
   - Write `{ "expenses": historyExpenses, "_updatedAt": <timestamp> }` to `finance-elvis-history.json`

### Pseudocode

```python
import json, time

with open("finance-elvis-export.json") as f:
    source = json.load(f)

current_year = str(__import__('datetime').date.today().year)
now_ms = int(time.time() * 1000)

current_expenses = [e for e in source["expenses"] if e["date"].startswith(current_year + "-")]
history_expenses = [e for e in source["expenses"] if not e["date"].startswith(current_year + "-")]

# Validate uniqueness
all_ids = [e["id"] for e in source["expenses"]]
assert len(all_ids) == len(set(all_ids)), "Duplicate IDs found"

hist_ts = now_ms if history_expenses else 0

main = {
    "accounts":        source.get("accounts", []),
    "expenses":        current_expenses,
    "assets":          source.get("assets", []),
    "budgets":         source.get("budgets", {}),
    "monthlyAgg":      {},
    "historyUpdatedAt": hist_ts,
    "_deletedIds":     source.get("_deletedIds", [])
}

history = {
    "expenses":   history_expenses,
    "_updatedAt": hist_ts
}

with open("finance-elvis.json", "w") as f:
    json.dump(main, f, indent=2)

with open("finance-elvis-history.json", "w") as f:
    json.dump(history, f, indent=2)

print(f"Main:    {len(current_expenses)} expenses ({current_year})")
print(f"History: {len(history_expenses)} expenses (all prior years)")
```

### Import into the app

After generating both files:

1. Open the app → Menu → Import JSON → select `finance-elvis.json`
   - This loads accounts, current expenses, assets, and budgets.
   - The app will rebuild `monthlyAgg` and recalculate balances automatically.
2. The history file is loaded lazily — the app reads `finance:v1:history` from localStorage directly. To populate it, either:
   - Use the browser console: `localStorage.setItem('finance:v1:history', JSON.stringify(<contents of finance-elvis-history.json>))`
   - Or connect to Google Drive and sync — the app will pull the history file automatically if `historyUpdatedAt > 0` in the main file.

---

## Rules for AI agents generating data

1. **IDs**: Short unique alphanumeric strings (8–12 chars). Unique across both files combined.
2. **Amounts**: Always positive numbers.
3. **Dates**: Always `YYYY-MM-DD`.
4. **Category mapping**: Map to the closest of `Food`, `Transport`, `Shopping`, `Health`, `Entertainment`, `Bills`, `Other`. Use `TopUp` for deposits.
5. **Account assignment**: Map person 1 → `acc1`, person 2 → `acc2`.
6. **Timestamps (`_ts`)**: Convert source datetimes to Unix ms. If unknown, use `date + "T00:00:00Z"` converted to ms, or `0`.
7. **Expense routing**: Put expenses with dates in the current calendar year into the main file's `expenses`. Put all others into the history file's `expenses`.
8. **`historyUpdatedAt` / `_updatedAt`**: Set both to the same `Date.now()` value if the history file has any entries. Set both to `0` if history is empty.
9. **`monthlyAgg`**: Always set to `{}` — the app recomputes it.
10. **`balance`**: Set equal to `startingBalance` — the app recalculates on import.
11. **`_deletedIds`**: Always `[]` for fresh data.
12. **Validate**: Confirm valid JSON, two accounts with IDs `"acc1"` and `"acc2"`, no duplicate expense IDs across both files.
