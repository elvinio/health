# Health Tracker PWA — Architecture & Internals

> Tracker-specific reference. Repo-wide conventions (no-build, service-worker
> cache-bump rule, self-hosted fonts) live in the root `CLAUDE.md`. Finance
> internals live in `docs/finance.md`.

The Health Tracker is a separate PWA from the Finance app — it shares the repo
and the `themes.css` stylesheet, but **no JS** with finance. It is served under
`/health/` (same origin as finance; localStorage is namespaced `health:*` vs
`finance:*` so the two never collide).

## Files

| File | Purpose |
|---|---|
| `tracker.html` | App shell — single-file HTML/CSS/JS for the whole tracker except Chat & Radio. Defines `Storage`, `DriveSync`, the hash router, and the Today / History / Health / Setup tabs. Exposes `window.Tracker`, `window.go`. |
| `tracker-chat.js` | **Chat tab** — Claude agent in the browser (`@anthropic-ai/sdk` via ESM CDN). Tools to browse workout/health history + create/modify/activate programs; streaming, prompt caching, per-message cost/tokens, per-profile saved sessions. Exposes `window.renderChat`. |
| `tracker-radio.js` | **Radio tab** — on-demand AI "radio station" (script via Claude, voice via ElevenLabs). Exposes `window.renderRadio`. See "Radio" below. |
| `sw-tracker.js` | Service worker for `tracker.html`. |
| `manifest-tracker.json` | PWA manifest (`start_url`/`scope` = `/health/tracker.html`). |
| `icons/tracker-icon.png` | Maskable app icon (512px); shares `icon-192.png` with finance. |
| `apps-script/classicals-proxy.gs` | Optional Apps Script — server-side scraper/proxy for Radio interstitial piano music (see "Interstitial music" below). |

`tracker.html` loads `themes.css`, then `tracker-chat.js` and `tracker-radio.js`
as plain `<script src>` tags at the bottom (no ES modules; same global-scope
pattern as finance).

## Navigation (hash router)

Six tabs, driven by `window.go(route)` and `location.hash`:

| Route | Tab |
|---|---|
| `#/today` | Today — log/run today's workout session |
| `#/history` | History — past sessions |
| `#/health` | Health — doctor visits, health reports, baselines |
| `#/chat` | Chat (`renderChat`, `tracker-chat.js`) |
| `#/radio` | Radio (`renderRadio`, `tracker-radio.js`) |
| `#/setup` | Setup — profiles, program import, Drive sync, API keys |

The PWA manifest also defines app shortcuts to `#/today` (Log Workout) and
`#/health` (Add Doctor Visit).

## Data model — `health:v1` (the `Storage` module)

Main data lives in `localStorage` under `health:v1` (`STORAGE_KEY` in
`tracker.html`), managed by the `Storage` singleton. **Two-profile, per-profile**
shape:

```js
{
  profiles: {
    p1: { name: 'Person 1', gender: 'male' },
    p2: { name: 'Person 2', gender: 'female' },
  },
  activeProfile: 'p1',
  importedPrograms: {},          // program definitions imported/created, keyed by id
  perProfile: {
    p1: { config: null, baselines: {}, sessions: {}, doctorVisits: [], healthReports: [], chatSessions: [] },
    p2: { ...same shape },
  },
}
```

- `Storage.load()` parses `health:v1`, falls back to `_defaultData()` on parse
  error, and runs forward-compat guards (`_ensureProfile` backfills any missing
  `baselines`/`sessions`/`doctorVisits`/`healthReports`/`chatSessions`). Always
  go through `Storage` accessors rather than touching `health:v1` directly.
- `Storage.save()` writes the whole blob back.
- `Storage.getActiveProfile()` / `setActiveProfile(id)` / `getProfiles()` /
  `setProfileNames(n1, n2)` manage profiles; `Storage._pd(pid)` returns the
  active (or named) profile's per-profile data.

> When you add a new per-profile collection, add it to `_defaultData()` **and**
> backfill it in `_ensureProfile()`, mirroring the finance "add a collection"
> discipline — otherwise old stored blobs won't have the field.

## Other `health:*` localStorage keys

| Key | Purpose |
|---|---|
| `health:v1` | Main tracker data (above) |
| `health:anthropicKey` | Anthropic API key — shared by Chat **and** Radio script generation (local-only secret) |
| `health:chatModel` | Selected Claude model for the Chat tab |
| `health:elevenLabsKey` | ElevenLabs API key for Radio TTS (local-only secret) |
| `health:radioChannels` | User's radio channel/persona definitions |
| `health:radioPresetOverrides` | Per-preset channel overrides |
| `health:radio:episodes` | Episode metadata index (status, segments, voice) |
| `health:radio:progress` | Per-episode playback position (resume) |
| `health:radio:elevenVoices` | Cached ElevenLabs voice list (`GET /v1/voices`) |
| `health:radio:musicProxyUrl` | Web-app URL of `apps-script/classicals-proxy.gs` — enables Radio interstitial music (set in Setup → Radio station) |
| `health:radio:musicTracks` | Cached scraped piano-track list (weekly refresh) |
| `tracker:drive-config` | `DriveSync` config — `{ clientId, fileId }` for Google Drive backup |

## Chat tab (`tracker-chat.js`)

A Claude agent that runs entirely in the browser via the `@anthropic-ai/sdk`
ESM build (loaded from `esm.sh`, cached by the SW in `EXT_CACHE`). API key from
`health:anthropicKey`; model from `health:chatModel`.

- **Agentic tools** let Claude browse the active profile's workout/health history
  and **create / modify / activate** training programs (writing back into
  `Storage.importedPrograms` and the per-profile `config`).
- **Streaming** responses with **prompt caching** to cut cost on repeated context.
- **Per-message cost/tokens** are surfaced in the UI.
- **Per-profile saved sessions** persist in `perProfile[pid].chatSessions`.

## Radio tab (`tracker-radio.js`)

On-demand AI "radio station". **Two phases per episode**, with status
`scripting` → `draft` → `synthesizing` → `ready`:

1. **Script** — Claude (same browser SDK / `health:anthropicKey` as Chat) writes
   a segmented DJ script per channel/persona → `draft`. The user reads it on the
   **review screen** before synthesis.
2. **Voice** — ElevenLabs TTS (`api.elevenlabs.io`, model `eleven_flash_v2_5`,
   MP3) voices each segment → `ready`.

**Manual (no-Claude-key) path** — each channel card also has:
- **📋 Prompt** (`openPromptModal` → `buildCopyPrompt`): one self-contained prompt
  requesting the whole show as `## N. Title` Markdown, to paste into claude.ai.
- **📥 Paste** (`openPasteModal` → `parsePastedScript`): the inverse split,
  importing the reply straight into a `draft` episode on the review screen; falls
  back to `chunkIntoSegments` when headings are absent.

So phase 1 works without a Claude API key.

**Voices** are fetched live from the account (`GET /v1/voices`, cached in
`health:radio:elevenVoices`) and are user-selectable per channel/episode with a
free `preview_url` sample. API key in `health:elevenLabsKey`.

**Storage** — script text + audio Blobs both live in IndexedDB (DB `health-radio`,
store `radioAudio`; keys `epId:idx` for audio, `epId:idx:txt` for script, and
`music:<id>` for cached interstitial MP3 Blobs). Episode metadata indexes in
`health:radio:episodes`; playback position in `health:radio:progress`.

**Interstitial music** — between every spoken segment (not after the last), the
player drops in a random 3–5 min slice of a random royalty-free piano piece with
fade in/out, captioned with the piece title. Tracks are scraped server-side by
`apps-script/classicals-proxy.gs` (web-app URL in `health:radio:musicProxyUrl`,
set in Setup → Radio station; bypasses classicals.de's 403/CORS and returns each
MP3 as base64). The track list is cached in `health:radio:musicTracks` (weekly
refresh) and decoded Blobs in IndexedDB under `music:<id>`. It's always on when a
proxy URL is set, and a no-op otherwise. A second `<audio id="rp-music">` element
plus `activeAudio()` route the transport controls during a break.

**Playback** — synthesis is progressive, resumable, and cancelable; a custom
`<audio>` player offers pause/seek/±15s/segment-nav + resume + a Script
transcript.

## Google Drive backup (`DriveSync` in `tracker.html`)

The tracker has its **own** Drive sync, independent of finance's. Config lives in
`tracker:drive-config` (`{ clientId, fileId }`). It uses Google Identity Services
(`accounts.google.com/gsi/client`) with the `drive.file` scope and uploads the
whole `health:v1` blob as a single `tracker-backup.json` file (multipart
POST/PATCH to the Drive v3 upload endpoint). This is a **whole-file backup**, not
the per-collection bidirectional merge that finance uses.

## Service worker (`sw-tracker.js`)

```js
const CACHE = 'health-tracker-v13';     // bump on any ASSETS change
const EXT_CACHE = 'health-tracker-ext-v1';
const ASSETS = ['/health/tracker.html', '/health/tracker-chat.js', '/health/tracker-radio.js'];
```

- **Bump `CACHE`** whenever `tracker.html`, `tracker-chat.js`, or `tracker-radio.js`
  changes — same discipline as `sw.js` (see root `CLAUDE.md`).
- The `activate` handler deletes old caches but **preserves** `finance-*` caches,
  so the two PWAs coexist on the same origin without evicting each other.
- The `esm.sh` Claude SDK module is cached in `EXT_CACHE` on first fetch
  (versioned CDN URL — no bump needed).
- Includes a `notificationclick` handler that focuses/opens `/health/tracker.html`.
