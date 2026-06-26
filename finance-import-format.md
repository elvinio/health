# Finance Import Format

## Import Expenses (CSV)

Use **Import Expenses** from the menu (💰 Import Expenses) to merge new or updated expenses without replacing existing data.

### Merge behaviour

- If an expense with the same `id` exists and the incoming `_ts` is newer, the existing record is updated.
- If the `id` does not exist, the expense is added.
- Expenses dated in the current year go into the main store; earlier dates go into history.

### CSV format

```
id,date,desc,amount,cat,ac,_ts
```

| Column | Required | Format / allowed values |
|--------|----------|------------------------|
| `id` | Yes | Unique alphanumeric identifier, 8–12 characters |
| `date` | Yes | `YYYY-MM-DD` |
| `desc` | Yes | Free-text description |
| `amount` | Yes | Positive number, e.g. `87.40`. Treated as SGD — CSV import does not support per-row currency/rate, so imported expenses are always SGD. Use the in-app form for USD expenses. |
| `cat` | Yes | `Food` · `Transport` · `Shopping` · `Health` · `Entertainment` · `Bills` · `Other` · `TopUp` |
| `ac` | Yes | `acc1` or `acc2` |
| `_ts` | No | Unix timestamp in milliseconds — defaults to import time if omitted |

> **TopUp** adds to the account balance; all other categories subtract.

### Example

```csv
id,date,desc,amount,cat,ac,_ts
abc12345,2026-05-21,Grocery shopping,87.40,Food,acc1,1747440000000
def67890,2026-05-20,Bus fare,2.50,Transport,acc2,1747350000000
ghi11111,2026-04-15,Electricity bill,120.00,Bills,acc1,1744800000000
jkl22222,2026-05-01,Salary top-up,3000.00,TopUp,acc1,1746000000000
```

---

## Import Events (JSON)

Use **Import Events** from the menu (📅 Import Events) to merge new or updated events.

### Merge behaviour

- If an event with the same `id` exists and the incoming `_ts` is newer, the existing record is updated.
- If the `id` does not exist, the event is added.

### JSON format

The file must be either a JSON array of event objects, or an object with an `events` array:

```json
[
  { ...event },
  { ...event }
]
```

or

```json
{ "events": [ { ...event }, { ...event } ] }
```

### Event object fields

| Field | Required | Format / allowed values |
|-------|----------|------------------------|
| `id` | Yes | Unique alphanumeric identifier |
| `title` | Yes | Free-text event name |
| `startDate` | Yes | `YYYY-MM-DD` |
| `startTime` | No | `{ "hour": 1–12, "minute": 0/15/30/45, "ampm": "AM"/"PM" }` |
| `endDate` | No | `YYYY-MM-DD` — omit or `null` for single-day events |
| `endTime` | No | Same structure as `startTime` |
| `description` | No | Free-text notes |
| `tags` | No | Array of strings, e.g. `["work", "urgent"]` |
| `reminderHours` | No | Hours before event to trigger a reminder; `0` = no reminder |
| `_ts` | No | Unix timestamp in milliseconds — defaults to `0` if omitted (always overwritten on update) |

### Example

```json
[
  {
    "id": "evt001abc",
    "title": "Team standup",
    "startDate": "2026-05-22",
    "startTime": { "hour": 9, "minute": 0, "ampm": "AM" },
    "endDate": "2026-05-22",
    "endTime": { "hour": 9, "minute": 30, "ampm": "AM" },
    "description": "Daily sync",
    "tags": ["work"],
    "reminderHours": 0,
    "_ts": 1747440000000
  },
  {
    "id": "evt002def",
    "title": "Annual leave",
    "startDate": "2026-06-01",
    "endDate": "2026-06-07",
    "tags": ["personal"],
    "reminderHours": 24,
    "_ts": 1747500000000
  }
]
```
