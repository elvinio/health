# Apps Script deployments

Two scripts live in this folder:

- `quarterly-report.gs` — quarterly AI finance report (below).
- `lta-proxy.gs` — bus arrivals proxy **and** the rain-radar cache (see
  "Rain radar cache" at the end; full setup steps are in the file header).

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

# Rain radar cache (`lta-proxy.gs`)

The Events › Rain view overlays NEA's rain-radar PNG on a map. weather.gov.sg
publishes a frame every 5 minutes but only keeps ~1 hour; the proxy script
extends that to **24 hours** by caching frames in your Drive.

- A 5-minute trigger (`cacheRainFrame`) saves each frame as
  `<YYYYMMDDHHMM>.png` (SGT slot key) into a Drive folder named
  `rain-radar-cache`, and trashes frames older than 24h (~288 small PNGs at
  steady state).
- The PWA reuses the **same proxy URL/token** you already configured for the
  bus views — no new setting. Without the cache, the Rain view still works in
  live mode (last hour straight from weather.gov.sg).

Setup, if you already deployed `lta-proxy.gs` for buses:

1. Paste the updated `lta-proxy.gs` over your existing project's code.
2. Run `cacheRainFrame` once in the editor — re-authorise when prompted
   (the rain feature adds the Drive scope).
3. Run `installRainTrigger` once (installs/replaces the every-5-min trigger).
4. **Deploy → Manage deployments → edit → New version** so the new
   `RainList` / `RainImg` actions go live on the same `/exec` URL.

Endpoints (token optional, as for the bus actions):

```
GET {url}?action=RainList&token=…          → { "frames": ["202606090800", …] }
GET {url}?action=RainImg&t=202606090800&token=… → { "t": "…", "png": "<base64>" }
```
