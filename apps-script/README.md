# Quarterly AI finance report

Two ways to turn your finance data into an AI report that the PWA displays on the
**Analysis** tab. Both share the same on-device summary builder (`buildAiSummary()`
in `finance-ai.js`) and the same display card — pick whichever fits.

```
App computes a compact summary  →  finance-elvis-summary.json on Drive
                                →  Claude (manual paste OR Apps Script)
                                →  finance-elvis-report.json on Drive
App displays the Markdown report on the Analysis tab
```

## Path A — Manual (no API key, $0)

Uses your existing claude.ai subscription. Run it quarterly:

1. Analysis tab → **📋 Copy summary**. This copies a ready-made prompt plus your
   data snapshot to the clipboard.
2. Paste it into a new chat at [claude.ai](https://claude.ai). Claude replies with
   a Markdown report.
3. Copy Claude's reply, return to the app → **✍️ Paste report** → *Save Report*.

The report is stored with your data and syncs to all your devices via Google Drive.

## Path B — Automated (Apps Script + Claude API)

Hands-off: a quarterly Google Apps Script trigger calls the Claude API and writes
the report to Drive for the app to fetch.

> The Claude **API** (console.anthropic.com) is a separate, pay-per-token account —
> billed separately from a claude.ai subscription. A quarterly run on a few KB of
> JSON costs roughly a cent or two.

1. Open [script.google.com](https://script.google.com) → **New project** → paste
   `quarterly-report.gs`.
2. **Project Settings → Script Properties** → add
   `ANTHROPIC_API_KEY = sk-ant-...` (create a key at
   [console.anthropic.com](https://console.anthropic.com)).
3. In the PWA: Analysis tab → **☁ Summary → Drive** (once) so the summary file exists.
4. In the script editor, run `generateReport` once — authorise Drive + external
   requests when prompted, and confirm `finance-elvis-report.json` appears in Drive.
5. Run `installQuarterlyTrigger` once to schedule it (runs on the 2nd of
   Jan / Apr / Jul / Oct).
6. In the PWA after each run: Analysis tab → **⬇ Fetch report**.

### Notes

- `CLAUDE_MODEL` in the script defaults to a cost-efficient model; change it to any
  current model you prefer.
- The script reads/writes the two JSON files by name in your Drive, so the app and
  the script must use the **same Google account**.
- Keep the summary small: it already contains only aggregates (no raw transactions),
  which keeps both the API cost and what leaves your device to a minimum.
