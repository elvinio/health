# Email Parser Config Guide

Parsers tell the Gmail sync (both the PWA and the Apps Script) how to extract data from transaction and notification emails. All parsers live in a single JSON config file that you import into the PWA.

---

## Config file structure

```json
{
  "parsers": [ ...parser objects... ],
  "catMap":  [ ...category rules... ],
  "catDefault": "Other"
}
```

Import via **Expenses → Email Rules → Import Config** (or the Gmail modal menu). The config is stored inside `finance-elvis.json` on Drive and shared with the Apps Script automatically.

---

## Parser fields (common to all types)

| Field | Required | Description |
|---|---|---|
| `type` | no | `"expense"` (default) or `"event"` |
| `name` | yes | Human-readable label shown in the UI |
| `subjectContains` | yes | Case-insensitive substring matched against the email subject |

The parser is selected by finding the first entry whose `subjectContains` appears in the subject line.

---

## Regex field shape

Every field that extracts text from the email body uses this shape:

```json
{ "regex": "Amount:\\s+SGD([0-9,.]+)", "group": 1 }
```

- `regex` — a JavaScript-compatible regular expression. Use `\\` to escape backslashes in JSON.
- `group` — which capture group to use (default `1`).
- Matching is case-insensitive and multiline (`im` flags).

---

## Expense parsers (`"type": "expense"`)

Extracts a transaction and adds it to your expenses list.

### Fields

| Field | Required | Description |
|---|---|---|
| `amount` | yes | Regex field — extracts the transaction amount (digits and commas, e.g. `23.00` or `1,234.56`) |
| `desc` | yes | Regex field — extracts the merchant / description |
| `date` | no | Regex field — extracts the date string. If omitted, falls back to the email's received date |
| `date.format` | yes (if `date` set) | How to interpret the extracted date string — see formats below |

### Supported date formats

| Format | Example | Notes |
|---|---|---|
| `DD/MM/YY` | `23/05/26` | |
| `DD-Mon-YY` | `23-May-26` | |
| `D Mon` | `23 May` | Uses current year |
| `Mon D YYYY` | `May 23 2026` | |
| `D Mon YYYY` | `23 May 2026` | |

### Example — DBS PayLah transfer

**Email body snippet:**
```
Date & Time:    23 May 11:43 (SGT)
Amount: SGD23.00
From:   PayLah! Wallet (Mobile ending 9007)
To:     FOMO PAY PTE. LTD.
```

**Parser config:**
```json
{
  "type": "expense",
  "name": "DBS PayLah",
  "subjectContains": "Transaction Alerts",
  "amount": {
    "regex": "Amount:[ \\t]+SGD([0-9,.]+)",
    "group": 1
  },
  "desc": {
    "regex": "To:[ \\t]+(?![^\\r\\n]*@)([^\\r\\n]+)",
    "group": 1
  },
  "date": {
    "regex": "Date & Time:[ \\t]+(\\d{1,2} [A-Za-z]+)",
    "group": 1,
    "format": "D Mon"
  }
}
```

**Note on the `desc` regex:** `(?![^\r\n]*@)` is a negative lookahead that skips any `To:` line containing an email address (e.g. the email header `To: you@email.com`), leaving only the merchant line.

---

## Event parsers (`"type": "event"`)

Extracts a calendar event and adds it to your Events tab.

### Fields

| Field | Required | Description |
|---|---|---|
| `title` | yes | Regex field — extracts the event title |
| `datetime` | yes | Object — extracts date and times from a single regex with multiple groups |
| `datetime.regex` | yes | Regex with capture groups for date, start time, end time |
| `datetime.dateGroup` | no | Group index for the date (default `1`) |
| `datetime.startTimeGroup` | no | Group index for the start time in `HH:MM` 24-hour format (default `2`) |
| `datetime.endTimeGroup` | no | Group index for the end time in `HH:MM` 24-hour format (default `3`) |
| `datetime.dateFormat` | yes | Same format strings as expense date (see table above) |

Times are extracted as 24-hour `HH:MM` strings and automatically converted to the 12-hour AM/PM format the PWA uses internally.

### Example — RedMart delivery

**Email body snippet:**
```
Sold by: RedMart
Estimated Delivery Dates: 12 May 2026 at 08:00 - 14:00
```

**Parser config:**
```json
{
  "type": "event",
  "name": "RedMart Delivery",
  "subjectContains": "RedMart",
  "title": {
    "regex": "Sold by: ([^\\r\\n]+)",
    "group": 1
  },
  "datetime": {
    "regex": "Estimated Delivery Dates: (\\d{1,2} \\w+ \\d{4}) at (\\d{2}:\\d{2}) - (\\d{2}:\\d{2})",
    "dateGroup": 1,
    "startTimeGroup": 2,
    "endTimeGroup": 3,
    "dateFormat": "D Mon YYYY"
  }
}
```

**Result:** event titled `Redmart`, date `2026-05-12`, start `8:00 AM`, end `2:00 PM`.

---

## Category mapping (`catMap`)

Applies to expense parsers only. Rules are checked in order; the first match wins. If no rule matches, `catDefault` is used.

```json
"catMap": [
  { "match": "grab",     "value": "Transport" },
  { "match": "redmart",  "value": "Food" },
  { "match": "netflix",  "value": "Entertainment" }
],
"catDefault": "Other"
```

- `match` — case-insensitive regex tested against the extracted description.
- `value` — the category to assign (must be one of the PWA's expense categories).

---

## Full config example

```json
{
  "parsers": [
    {
      "type": "expense",
      "name": "DBS PayLah",
      "subjectContains": "Transaction Alerts",
      "amount": {
        "regex": "Amount:[ \\t]+SGD([0-9,.]+)",
        "group": 1
      },
      "desc": {
        "regex": "To:[ \\t]+(?![^\\r\\n]*@)([^\\r\\n]+)",
        "group": 1
      },
      "date": {
        "regex": "Date & Time:[ \\t]+(\\d{1,2} [A-Za-z]+)",
        "group": 1,
        "format": "D Mon"
      }
    },
    {
      "type": "event",
      "name": "RedMart Delivery",
      "subjectContains": "RedMart",
      "title": {
        "regex": "Sold by: ([^\\r\\n]+)",
        "group": 1
      },
      "datetime": {
        "regex": "Estimated Delivery Dates: (\\d{1,2} \\w+ \\d{4}) at (\\d{2}:\\d{2}) - (\\d{2}:\\d{2})",
        "dateGroup": 1,
        "startTimeGroup": 2,
        "endTimeGroup": 3,
        "dateFormat": "D Mon YYYY"
      }
    }
  ],
  "catMap": [
    { "match": "grab",    "value": "Transport" },
    { "match": "redmart", "value": "Food" }
  ],
  "catDefault": "Other"
}
```

---

## Debugging tips

- **Apps Script logs**: open the script editor → **Executions** to see which emails were found and what was parsed or skipped.
- **"Could not parse"**: the `amount` or `desc` regex returned no match. Add a temporary `Logger.log(body.slice(0, 1000))` in the script to see the exact text the parser receives.
- **Wrong field captured**: tighten the regex — use more surrounding context (e.g. `Amount:` before the digits) rather than a broad pattern.
- **Email already processed**: the `Expense-Done` label is the guard. Remove the label from the email in Gmail to reprocess it.
