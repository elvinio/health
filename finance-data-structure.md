# Finance App — JSON Data Structure

This document describes the JSON schema used by `finance.html`. The data is stored in `localStorage` under the key `finance:v1` and exported/synced to Google Drive as `finance-backup.json`.

Use this as a reference when preparing data from an external source for import.

---

## Top-level structure

```json
{
  "accounts": [...],
  "expenses": [...],
  "assets": [...],
  "_deletedIds": []
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `accounts` | array | yes | Expense accounts (exactly 2 expected) |
| `expenses` | array | yes | All expense entries |
| `assets` | array | yes | Investment assets |
| `_deletedIds` | array | no | IDs that have been deleted — used to prevent re-merging deleted records during sync. Set to `[]` if generating fresh data. |

---

## `accounts[]`

Each account represents one person's spending account.

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
| `id` | string | yes | Must be `"acc1"` or `"acc2"` — the app expects exactly these two IDs |
| `name` | string | yes | Display name for the account owner |
| `startingBalance` | number | yes | Opening balance in your currency |
| `balance` | number | yes | Current balance. The app will recalculate this automatically on import from `startingBalance` minus sum of expenses, so you can set it equal to `startingBalance` if unsure |
| `_updatedAt` | number | no | Unix timestamp in milliseconds of the last settings change. Used for conflict resolution during sync. Set to `0` or omit if not known. |

**Note:** Always include exactly 2 accounts with IDs `"acc1"` and `"acc2"`.

---

## `expenses[]`

Each entry is one spending transaction.

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
| `id` | string | yes | Unique identifier. Use any short random alphanumeric string. Must be unique across all expenses. |
| `ac` | string | yes | Must be `"acc1"` or `"acc2"` — which account this expense belongs to |
| `date` | string | yes | Date in `YYYY-MM-DD` format |
| `desc` | string | yes | Free-text description of the expense |
| `amount` | number | yes | Amount as a positive number (expenses reduce the balance) |
| `cat` | string | yes | One of: `Food`, `Transport`, `Shopping`, `Health`, `Entertainment`, `Bills`, `Other` |
| `_ts` | number | no | Unix timestamp in milliseconds when this record was created or last edited. Used for conflict resolution during sync. Set to `0` or omit if not known. |

---

## `assets[]`

Each entry is an investment asset with a full value history.

```json
{
  "id": "mx9z1def4",
  "name": "S&P 500 ETF",
  "history": [
    { "date": "2026-01-01", "value": 12000.00, "_ts": 1735689600000 },
    { "date": "2026-03-01", "value": 12800.00, "_ts": 1740787200000 },
    { "date": "2026-05-15", "value": 13500.00, "_ts": 1747440000000 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique identifier for the asset |
| `name` | string | yes | Display name (e.g. `"AAPL"`, `"Bitcoin"`, `"Property"`) |
| `history` | array | yes | Chronological list of valuations. Must have at least one entry. The **last entry** is the current value. |
| `history[].date` | string | yes | Date of the valuation in `YYYY-MM-DD` format |
| `history[].value` | number | yes | Asset value on that date |
| `history[]._ts` | number | no | Unix timestamp in milliseconds. Used for deduplication during sync. Set to `0` or omit if not known. |

**Note:** Sort `history` oldest-first. The app displays the last entry as the current value and computes gain/loss against the second-to-last entry.

---

## Minimal valid example

The smallest valid file the app will accept:

```json
{
  "accounts": [
    { "id": "acc1", "name": "Alice", "startingBalance": 5000, "balance": 5000 },
    { "id": "acc2", "name": "Bob",   "startingBalance": 3000, "balance": 3000 }
  ],
  "expenses": [],
  "assets": [],
  "_deletedIds": []
}
```

---

## Full example with data

```json
{
  "accounts": [
    {
      "id": "acc1",
      "name": "Alice",
      "startingBalance": 5000.00,
      "balance": 4752.10,
      "_updatedAt": 1747440000000
    },
    {
      "id": "acc2",
      "name": "Bob",
      "startingBalance": 3000.00,
      "balance": 2841.50,
      "_updatedAt": 1747440000000
    }
  ],
  "expenses": [
    {
      "id": "exp001",
      "ac": "acc1",
      "date": "2026-05-10",
      "desc": "Supermarket",
      "amount": 123.90,
      "cat": "Food",
      "_ts": 1746835200000
    },
    {
      "id": "exp002",
      "ac": "acc1",
      "date": "2026-05-12",
      "desc": "Electricity bill",
      "amount": 124.00,
      "cat": "Bills",
      "_ts": 1747008000000
    },
    {
      "id": "exp003",
      "ac": "acc2",
      "date": "2026-05-14",
      "desc": "Petrol",
      "amount": 80.00,
      "cat": "Transport",
      "_ts": 1747180800000
    },
    {
      "id": "exp004",
      "ac": "acc2",
      "date": "2026-05-15",
      "desc": "Pharmacy",
      "amount": 78.50,
      "cat": "Health",
      "_ts": 1747267200000
    }
  ],
  "assets": [
    {
      "id": "ast001",
      "name": "S&P 500 ETF",
      "history": [
        { "date": "2026-01-01", "value": 12000.00, "_ts": 1735689600000 },
        { "date": "2026-03-01", "value": 12800.00, "_ts": 1740787200000 },
        { "date": "2026-05-15", "value": 13500.00, "_ts": 1747267200000 }
      ]
    },
    {
      "id": "ast002",
      "name": "Bitcoin",
      "history": [
        { "date": "2026-04-01", "value": 8500.00, "_ts": 1743465600000 },
        { "date": "2026-05-15", "value": 9200.00, "_ts": 1747267200000 }
      ]
    }
  ],
  "_deletedIds": []
}
```

---

## Instructions for an AI agent converting external data

When converting data from another format into this structure, follow these rules:

1. **IDs**: Generate short unique alphanumeric strings (8–12 chars). Each ID must be unique across all expenses and assets. Never reuse an ID.

2. **Amounts**: Always positive numbers. Expenses are debits — the app subtracts them from the account balance automatically.

3. **Dates**: Always `YYYY-MM-DD`. Convert any other date format (DD/MM/YYYY, MM-DD-YYYY, natural language) to this format.

4. **Category mapping**: Map source categories to the closest of: `Food`, `Transport`, `Shopping`, `Health`, `Entertainment`, `Bills`, `Other`. When in doubt, use `Other`. Use `TopUp` for account top-ups/deposits.

5. **Account assignment**: If the source data is already separated by person, map person 1 to `acc1` and person 2 to `acc2`. Update the `name` fields in `accounts` accordingly.

6. **Timestamps (`_ts`)**: If the source has a datetime for each record, convert it to Unix milliseconds (`Date.getTime()` equivalent). If no time is available, derive it from the date at `00:00:00 UTC` or set to `0`.

7. **Asset history**: If the source has point-in-time valuations for an asset, each becomes one `history` entry. Sort them oldest-first.

8. **`balance` field**: Set each account's `balance` equal to its `startingBalance` — the app recalculates the correct balance on import.

9. **`_deletedIds`**: Always set to `[]` when generating fresh data.

10. **Validate before importing**: Ensure the output parses as valid JSON, all required fields are present, and `accounts` has exactly two entries with IDs `"acc1"` and `"acc2"`.
