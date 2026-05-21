# Tracker Health Data Import Format

Use **Import Health Data** from Settings → Data backup to merge doctor visits and health reports without replacing existing data.

## Merge behaviour

- If a record with the same `id` exists and the incoming `_ts` is newer, the existing record is updated.
- If the `id` does not exist, the record is added.
- Records with no `_ts` are treated as new and added unconditionally (they receive the import timestamp).
- Workout sessions and config are not affected by this import.

## JSON format

The file must be a JSON object with one or both of these keys:

```json
{
  "doctorVisits": [ { ...visit } ],
  "healthReports": [ { ...report } ]
}
```

Either key may be omitted if you only want to import one type.

---

## Doctor visit fields

| Field | Required | Format / allowed values |
|-------|----------|------------------------|
| `id` | Yes | Unique alphanumeric identifier |
| `date` | Yes | `YYYY-MM-DD` |
| `doctor` | No | Clinician name, free-text |
| `specialty` | No | e.g. `GP`, `Cardiologist`, `Orthopaedic` |
| `reason` | No | Reason for visit, free-text |
| `notes` | No | Findings, blood pressure, recommendations |
| `followUp` | No | `YYYY-MM-DD` — next appointment, or omit |
| `_ts` | No | Unix timestamp ms — defaults to import time if omitted |

---

## Health report fields

| Field | Required | Format / allowed values |
|-------|----------|------------------------|
| `id` | Yes | Unique alphanumeric identifier |
| `date` | Yes | `YYYY-MM-DD` |
| `type` | Yes | `Blood Test` · `Imaging` · `Checkup` · `Specialist Report` · `Other` |
| `title` | No | Short label, e.g. `Annual Blood Panel` |
| `notes` | No | Summary, findings, doctor's comments |
| `values` | No | Object of key→value metric pairs (see example below) |
| `_ts` | No | Unix timestamp ms — defaults to import time if omitted |

---

## Example

```json
{
  "doctorVisits": [
    {
      "id": "vis001abc",
      "date": "2026-05-10",
      "doctor": "Dr Tan Wei Ming",
      "specialty": "GP",
      "reason": "Annual health screening",
      "notes": "BP 118/76. Advised to maintain current exercise routine.",
      "followUp": "2027-05-10",
      "_ts": 1747440000000
    },
    {
      "id": "vis002def",
      "date": "2026-03-22",
      "doctor": "Dr Lim Siew Hong",
      "specialty": "Cardiologist",
      "reason": "Palpitation follow-up",
      "notes": "ECG normal. No further action required.",
      "followUp": null,
      "_ts": 1742300000000
    }
  ],
  "healthReports": [
    {
      "id": "rep001xyz",
      "date": "2026-05-10",
      "type": "Blood Test",
      "title": "Annual Blood Panel",
      "notes": "All markers within normal range. Vitamin D slightly low.",
      "values": {
        "Total Cholesterol": "4.8 mmol/L",
        "LDL": "2.9 mmol/L",
        "HDL": "1.6 mmol/L",
        "Triglycerides": "1.1 mmol/L",
        "Fasting Glucose": "5.2 mmol/L",
        "HbA1c": "5.4%",
        "Vitamin D": "42 nmol/L",
        "TSH": "2.1 mIU/L"
      },
      "_ts": 1747440000000
    },
    {
      "id": "rep002uvw",
      "date": "2026-01-15",
      "type": "Imaging",
      "title": "Lumbar MRI",
      "notes": "Mild L4-L5 disc bulge. Physiotherapy recommended.",
      "values": {},
      "_ts": 1736900000000
    }
  ]
}
```
