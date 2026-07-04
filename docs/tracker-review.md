# Health Tracker PWA — Code Review

*Review date: 2026-07-04 · Scope: `tracker.html` (~4,040 lines), `tracker-chat.js` (783), `tracker-radio.js` (1,264), `sw-tracker.js` (51), `manifest-tracker.json`, `docs/tracker.md`*

This review looks at the app from three angles: **software engineering** (design & architecture), **QA** (bugs found by reading the code), and **UX** (how the app could serve its users better). Findings are prioritized within each section.

---

## 1. Software engineering — design & architecture

### Overall assessment

For a no-build, framework-free PWA, the architecture is coherent and disciplined. The module boundaries are genuinely good: `Storage`, `DriveSync`, `HeartRate`, `GPS`, and `Timer` are each self-contained IIFE/singleton modules with narrow public surfaces; Chat and Radio live in their own IIFEs that touch the shell only through a small set of documented globals (`Storage`, `escapeHtml`, `showModal`, `go`, …). The two-phase Radio pipeline (script → review → synthesize, with statuses `scripting → draft → synthesizing → ready`, IndexedDB reconciliation after crashes, and resumable synthesis) is the strongest piece of design in the app. The `escapeHtml`-before-`innerHTML` discipline is applied consistently in ~95% of render paths, timezone-safe date handling (`fmtISO`/`parseISO` local-midnight) is done correctly, and the Claude integration follows current API guidance — valid model IDs (`claude-sonnet-4-6`, `claude-opus-4-8`), correct pricing constants, correct cache-multiplier math (1.25× write / 0.1× read), streaming with a proper abort path, and a bounded tool loop.

The main architectural risks are below, roughly in priority order.

### 1.1 Three sources of truth for the cache version — all currently disagree

The service worker declares `health-tracker-v26` (`sw-tracker.js:1`), the in-app constant `TRACKER_CACHE_VERSION` shown on the Setup → App tab says `health-tracker-v19` (`tracker.html:986`), and both `CLAUDE.md` and `docs/tracker.md` document v13. The Setup screen therefore tells the user they're running a cache version that hasn't existed for seven bumps. Any manually-mirrored constant will drift; the shell could instead read the version out of the controlling service worker (or the docs could stop stating a number and just point at the file). At minimum, the constant and the docs should be part of the "bump the SW" checklist.

### 1.2 `tracker.html` is a 4,000-line monolith with data baked into the shell

The single file contains the CSS, the storage layer, the Drive sync client, the BLE heart-rate client, the GPS tracker, the router, four full views, the timer state machine — and ~250 lines of hardcoded programme data (`WEEKS`, `DAYS`, the whole "Strength + Cardio (40s, Male)" definition). The repo already has the pattern for the fix: finance is split into ten `finance-*.js` files, and Chat/Radio are already separate files. Splitting at the existing seams (e.g. `tracker-core.js` for Storage/date helpers, `tracker-today.js` for the day view/timer, `tracker-health.js`, plus a `programs/strength-40-male.js` data file) would cost only new entries in the SW `ASSETS` list. The built-in programme especially doesn't belong inline — it's content, not code, and it already has a JSON import format it could live in.

### 1.3 The custom-programme abstraction is leaky

Imported/AI-created programmes are first-class in `Storage` and the Chat tools, but several core paths still assume the built-in programme's shape:

- `navDay()` hardcodes 7 days per week and clamps to 4 weeks, regardless of the active programme's `days.length` / `weeks` keys.
- `todaySessionFromConfig()` maps calendar days to programme days with fixed `% 7` arithmetic, so a programme with fewer than 7 defined days renders "Unknown day." on the Today tab for the gap days.
- `renderHistory()` / `findExerciseName()` resolve day names and exercise names against the *currently active* programme, not the programme the session was logged under (see QA 2.5).
- `renderCycleComplete` copy ("You've passed the 28-day mark") and the new-cycle seeding logic assume the 4-week W1→W2 progression model.

Either sessions should record their `programId` (and lookups should resolve against it), or the programme contract should be documented as "exactly 7 days × N weeks" and validated at import/creation time. Right now the Chat agent can create a programme that the Today tab can't render.

### 1.4 Everything lives in `localStorage`, with no quota handling

`health:v1` holds workout sessions, health reports, doctor visits, **and** full chat transcripts including verbose tool results (a single `get_workout_history` result can be tens of KB, and it's persisted inside the session's message array). Radio episode manifests and progress add more keys. `Storage.save()` is a bare `setItem` — the first `QuotaExceededError` will throw uncaught mid-action and silently stop persisting. Under the ~5 MB typical quota, a few months of chatty coaching sessions is a realistic path there. Options: trim or summarize tool-result blocks before persisting chat history, cap `chatSessions` count/size, or move chat transcripts to IndexedDB (where Radio audio already lives). At minimum, wrap `save()` and surface the failure.

### 1.5 Drive sync is deliberately simpler than finance's — but the trade-off is undocumented in-app

Whole-file, last-writer-wins backup is a reasonable simplification, but two devices that both "Save to Drive" will silently clobber each other (no timestamp check, no merge). The load path at least confirms before replacing. Also, `authorize()` triggers a token prompt on every save/load (the cached `_token` is only used to soften the prompt), and the auto-export of radio episodes after synthesis calls `authorize()` outside any user gesture, where popup blockers may kill it — the failure is captured in `ep.driveError`, which is good. Worth a line in the Setup UI: "backup replaces the Drive copy; last save wins."

### 1.6 Claude integration — solid, with one caching flaw and duplicated model config

The agent loop in `tracker-chat.js` is well built (tool results marshalled correctly in a single user turn, `is_error` flags, abort handling, a 16-iteration guard). Two issues:

- **The system prompt embeds volatile data, partially defeating the prompt cache it pays for.** `buildSystemPrompt()` interpolates today's date, logged-workout/report/visit counts, and the full programme list. Prompt caching is a prefix match, so the moment the agent runs `create_program` mid-conversation the programme list changes, the system block changes, and the entire cached prefix (tools + system + all prior turns) is invalidated and rewritten at 1.25×. The counts have the same effect across turns whenever a tool writes data. The stable coaching persona should be the cached block; volatile facts (date, counts, programme list) belong in the first user turn or a tool the model can call. Separately, note the minimum cacheable prefix is 2,048 tokens on Sonnet 4.6 and 4,096 on Opus 4.8 — with a ~600-word system prompt plus six small tools, the Opus path may be silently below the threshold (check `cache_read_input_tokens` in the usage the app already displays).
- **Model list and pricing are hardcoded in three places**: `CHAT_MODELS` in `tracker-chat.js`, a parallel `CHAT_MODELS` in `tracker-radio.js`, and the hand-written `<option>` labels in Setup → AI. They already agree only loosely (Radio's copy has no pricing). One shared constant would prevent the inevitable drift when models change.

### 1.7 Secrets model

API keys (`health:anthropicKey`, `health:kokoroKey`) live in `localStorage` on an origin shared with the finance app and the static knowledgebase — any script injection anywhere on `elvinio.github.io/health/` can read them. That's an accepted risk of the browser-side-Claude design (and the keys are correctly *excluded* from Drive backups), but it raises the stakes on the small escaping gaps noted in QA 2.10. Also, `KOKORO_DEFAULT_URL` hardcodes a personal Modal endpoint as the default for all users; anyone else deploying the app will silently POST their key to that host if they leave the URL blank. Defaulting to blank + a validation error would be safer.

### 1.8 No tests, though the harness pattern exists

`tests/harness.js` already demonstrates how to run no-build script files in a Node `vm` sandbox. The tracker has a set of pure, high-value functions that would slot straight into that pattern: `projectedWeight` (three progression strategies), `setSpec` (five-level fallback chain), `todaySessionFromConfig`, `dateForCycleDay`, `mergeIfNeeded`/`_ensureProfile` backfills, `parsePastedScript`/`chunkIntoSegments`, and `renderMarkdownLite` (XSS surface). Several of the QA bugs below (2.3, 2.5, 2.12) are exactly the kind of thing such tests catch.

### 1.9 Dead code

`renderSetupData()` (tracker.html:2726) and `renderSetupApp()` (tracker.html:2800) are unreachable — the router sends `/setup-data` and `/setup-app` to `renderSetup()`, which contains its own copies of the same markup. ~130 lines of duplicated Drive/backup UI that will drift from the live copy. Delete them.

---

## 2. QA — bugs

Severity: **High** = data loss or feature deadlock in a mainline flow · **Medium** = wrong data/behavior in realistic use · **Low** = edge case or cosmetic.

### 2.1 HIGH — Dismissing the program-activation confirm sheet deadlocks the Chat tab

`chatConfirm()` (tracker-chat.js:348) resolves its promise only via the "Yes, switch" / "Cancel" buttons. But `showModal()` also wires the backdrop and the ✕ button to `closeModal()`, which closes the sheet **without resolving the promise**. If the user dismisses the sheet that way (the most natural gesture on a bottom sheet), `execTool('activate_program')` awaits forever: the agent turn never finishes, `ChatState.busy` stays `true`, the composer stays locked on "Stop" (which aborts a stream that already completed, doing nothing), and the Chat tab is dead until a full page reload. Fix: `chatConfirm` should override/restore the backdrop and close handlers so any dismissal resolves `false`.

### 2.2 HIGH — Cardio GPS tracking silently dies on navigation or refresh, and ending the session zeroes the distance

- `route()` calls `stopCardioOnNav()` on **every** hash change, which stops GPS. When the user returns to the cardio day, `renderDay` calls `_resumeCardioTracking()`, which re-attaches HR/GPS **listeners** and the display interval — but never calls `GPS.start()` again. The clock keeps ticking; distance is frozen. The same applies after a page refresh mid-session (the `startedAt` is persisted, the GPS watch is not).
- Worse, `endCardio()` then writes `activeDayState.cardio.distanceMeters = GPS.getDistanceM()`, overwriting whatever distance had been accumulated with the fresh (post-restart) counter — typically **0.00 km** for a 45-minute ruck if the user ever glanced at another tab. HR samples collected before the interruption are also lost, since they only live in memory and `persistDayState()` isn't called during the run.

Realistic trigger: check the Radio tab or answer a message mid-ruck. Fix direction: persist distance incrementally, and have the resume path restart the GPS watch and add to (not replace) the stored distance.

### 2.3 MEDIUM — HR ring buffer caps at 30 minutes, truncating the app's own prescribed workouts

`HeartRate._buffer` discards samples older than 30 minutes (tracker.html:1814), but `extractWindow()` is called at cardio end over the full session window — and the built-in programme itself prescribes 35–45-minute rucks. Zones and ramp rate for any session over 30 minutes silently describe only the last 30 minutes. (`hrAvg/hrMax/hrMin` are unaffected — they come from the separately-accumulated `hrSamples`.) Either size the buffer to the longest expected session or compute zone time incrementally.

### 2.4 MEDIUM — Cardio zone guidance is hardcoded to one person's numbers

`_cardioUpdateZone()` (tracker.html:3053) hardcodes the 107–125 bpm Zone-2 band from the male programme's notes ("age 42"), ignoring the per-profile `cfg.maxHr` the Setup screen collects and the fact that the app is explicitly two-profile. Person 2 gets coaching text ("Too fast — slow down") computed from Person 1's physiology. The zone math the app already has (`extractWindow`'s 60–70% band from `maxHr`) should drive this display.

### 2.5 MEDIUM — History mislabels sessions after switching programmes

`renderHistory()`, `renderHistoryDetail()`, and `findExerciseName()` all resolve `s.day` and exercise ids against `getActiveProgram()`. Sessions don't record which programme they were logged under. Switch from the built-in programme to a custom one (or let the Chat agent activate one) and the entire history is reinterpreted: day names change, strength sessions logged under the old programme show the new programme's Day-N title, and exercise ids that don't exist in the new programme render as raw ids (`floor-press`). Store `programId` on each session and resolve names against it.

### 2.6 MEDIUM — Radio Drive export writes Opus audio into files named `.mp3`

`synthesizeTTS()` requests `format: 'opus'` and the blob keeps the server's content type (typically `audio/ogg`). But `DriveSync.exportRadioEpisode()` names every segment `<base> - NN.mp3` with mime `audio/mpeg`, and the docs describe the pipeline as "MP3 out". The exported files are mislabeled Ogg/Opus; players that trust the extension (or Drive's preview) may refuse to play them. Either request MP3 from Kokoro for exports or name/mime the files by the actual blob type.

### 2.7 MEDIUM — Rest heart-rate data is only captured when the user taps "Skip rest"

`onTimerSkipRest()` records `restHrAvg/restHrMax/hrRecovery` etc., but the other path that ends a rest — tapping the next set's Start button (`handleSetAction`, which calls `Timer.endRest()` directly) — records only `restSeconds` and none of the HR recovery metrics. Since starting the next set is the *normal* way rest ends, most rest-HR data (including the `hrRecovery` number the Chat coach reads via `get_workout_history`) is simply missing. Extract the rest-HR capture into a shared helper used by both paths.

### 2.8 LOW — Chat: message text is destroyed before the API-key check

`sendFromInput()` clears the textarea, *then* checks `hasApiKey()` and bails with a warning note. A user who typed a long question before adding a key loses the text. Check the key first (tracker-chat.js:677–685).

### 2.9 LOW — `navDay` clamps to 4 weeks / 7 days regardless of programme

Prev/Next navigation is hardcoded to `nw > 4` and 7-day weeks (tracker.html:3022). A 6-week imported programme can't be browsed past week 4; a 1-week programme lets Next walk into week 2, where the router bounces to Setup. Related to 1.3.

### 2.10 LOW — A few unescaped interpolations remain (self-XSS via imported JSON)

The Setup weights list interpolates `ex.id` raw into `data-ex="…"` attributes (tracker.html:2588, 2596), and the start-date input interpolates `cfg.startDate` raw (tracker.html:2416). Both values are attacker-controlled only via a crafted programme/backup JSON the user imports themselves, so impact is low — but with API keys in `localStorage` (see 1.7), an imported-file XSS is a key-theft vector, and everywhere else the code is careful. Escape these like the rest.

### 2.11 LOW — Stale "Active" set state after navigating away

`route()` cancels the timer on navigation, but the in-progress set entry (startedAt, no endedAt) stays persisted, so returning to the day shows the set as "● Active" with no timer running. It's cleaned up lazily by `abandonInProgressSets()` on the next Start, but until then the UI claims a set is in progress that isn't.

### 2.12 LOW — Custom programme with fewer than 7 days shows "Unknown day." on Today

Consequence of the `% 7` day mapping in `todaySessionFromConfig` (see 1.3): on calendar days beyond the programme's `days` array, `dayDef()` returns undefined and the Today tab renders "Unknown day." with no way forward except Setup. Since the Chat agent is allowed to create programmes, this is reachable without file imports.

### 2.13 LOW — Interstitial music can stall playback on iOS

Between segments, `playInterstitial()` performs async network fetches (track list, then a possibly multi-MB base64 download) before calling `music.play()`. On iOS Safari, `play()` calls that far removed from a user gesture are frequently rejected; the code does fall through (`.catch(() => finish())` → next segment), but the segment-to-segment gap can be long and silent while a large track downloads on cellular. Pre-fetching the next break's blob while a segment plays would close the gap.

### 2.14 LOW — Miscellaneous

- `Storage.save()` / `saveEpisodes()` have no `QuotaExceededError` handling (see 1.4) — first failure is an uncaught exception.
- `synthesizeTTS` silently truncates scripts over 9,000 chars (`TTS_CHAR_LIMIT`) — the tail of an over-long segment is dropped with no warning.
- If the user switches profiles while a Chat turn is streaming, `execTool()` reads/writes whichever profile is active *at tool-execution time* (`Storage.getActiveProfile()` is resolved per call), so a coach turn can mix two people's data. Capturing the pid at turn start would pin it.
- The stale `TRACKER_CACHE_VERSION` (see 1.1) means the App tab's "Cache version" readout is wrong today.

---

## 3. UX — where the app could serve users better

### Strengths worth keeping

The workout screen gets a lot right: projected weights per week with live projection tables at setup, "Last: 24kg · W2 D1" hints for autoregulation, RPE capture per set, one-tap set → rest flow with a recovery-HR target that turns the BPM readout green. Radio's review-before-synthesis step (read/edit the script before paying for TTS), voice preview, resumable playback, and the no-API-key Prompt/Paste path are all thoughtful. Chat's per-message cost/token display is more transparent than most commercial AI products.

### 3.1 The rest timer never tells you rest is over (highest-impact gap)

The rest countdown communicates completion only by a color change (red → green) — no sound, no vibration, no notification. During rest, the phone is realistically locked or face-down on the floor. `requestAnimationFrame` also pauses in a background tab, so nothing is even ticking. Ironically, `sw-tracker.js` ships a `notificationclick` handler, but nothing in the app ever posts a notification — it's a feature that was clearly intended and never wired up. `navigator.vibrate()` + a short audio cue when planned rest elapses (and optionally a Notification when the tab is hidden) would materially improve every strength session.

### 3.2 The screen sleeps mid-workout

Radio acquires a wake lock while generating audio, but the workout views never do. Mid-set, the screen dims and locks; the user has to unlock the phone to end a set, and rAF-driven displays freeze in the meantime (values are recomputed from timestamps, so they're *correct* on wake — but invisible when needed). A screen wake lock while `Timer.state ≠ idle` (or during a cardio session) is a few lines and matches what Radio already does.

### 3.3 You can't record what actually happened in a set

The app logs planned reps, set duration, rest, RPE, and HR — but not **reps actually completed** or per-set weight deviations (weight is per-exercise, not per-set). "Pull-up: 5/4/4" that came out as 5/4/3 is unrecordable, which undermines both the History view and the AI coach's ability to autoregulate ("you missed reps at 24 kg last week, hold the weight"). A small optional "reps done" field on set completion — same interaction as the existing RPE selector — would close the loop.

### 3.4 History is a wall of codes, with no progression view

A history line reads like `S1:00:45 r90s @8 ♥120/150 rest♥98/110 ↓40 [Z3]`. That's dense telemetry for the person who built it, but hard to scan mid-gym. And nowhere does the app answer the question a lifter actually has: *is my floor press going up?* The data for a per-exercise weight/RPE trend line across cycles is all in `Storage`; today the only way to see progression is to ask the Chat coach (which costs API tokens). Even a simple sparkline per exercise, or a "personal records" card, would make weeks of logging feel rewarding. A legend for the history codes would help meanwhile.

### 3.5 Two profiles, one man's programme

The app is built for two people (profiles, per-profile baselines/history), but the only built-in programme is "Strength + Cardio (40s, Male)", the cardio guidance is his Zone-2 band (QA 2.4), and Person 2's `gender: 'female'` field is used for nothing except the Chat system prompt. Person 2's experience is: switch profile → get the male programme with empty baselines. Given the repo already contains `her.html`/monthly plans, shipping a second built-in programme (or making the Chat "design me a programme" path a first-run suggestion for P2) would make the two-profile design real.

### 3.6 Profile switching is ambiguous and abrupt

The topbar chip ("Elvin ▾") looks like a dropdown but is actually a blind toggle — tapping it instantly switches person and re-renders whatever you were doing, cancelling any running set timer without warning (via `route()` → `Timer.cancel()`). Mid-workout, a stray tap costs you the current set's timing. A tiny menu (with the two names + a "switching cancels the running timer" guard while a set is active) would fix both the affordance and the data risk.

### 3.7 Inconsistent dialogs and confirmations

The app has a polished bottom-sheet modal system, yet ~20 flows use blocking native `alert()`/`confirm()` ("Names saved.", "Session marked complete.", "Wipe ALL data…"). Native dialogs on mobile PWAs look foreign, block the thread, and can't be styled or auto-dismissed. Routing these through the existing sheet (or a lightweight toast for pure confirmations like "saved") would tighten the feel considerably. Related: the Setup → Training tab has four separate save actions ("Save names", "Save and continue", plus per-card saves on other tabs) — it's genuinely unclear whether "Save and continue" persists the profile names above it (it doesn't).

### 3.8 Accessibility

- `maximum-scale=1.0` in the viewport meta disables pinch-zoom — a WCAG 1.4.4 failure and a real problem for the small (0.72–0.78rem) telemetry text everywhere.
- Icon-only buttons (`◑` theme, `♥` HR connect, `✕` close, `⏮/⏭` transport) have no `aria-label`s; the theme button's `title` is the only hint.
- The modal sheet has no focus trap, no `Escape` handling, and no `role="dialog"`.
- Zone/status information is conveyed by color alone in several places (rest bar red/green, BPM green/red).

### 3.9 Radio: no lock-screen controls

Radio is a listen-while-doing-something-else feature, but without the Media Session API there's no lock-screen/notification transport, no metadata, and the custom `±15s`/segment controls are unreachable once the screen locks. `navigator.mediaSession` with the channel name/emoji and seek/next handlers would make it behave like a real podcast app. (Also worth verifying background playback continues on iOS standalone PWAs — the `<audio>`-element approach generally survives, but the segment-chaining + interstitial fetch path in QA 2.13 is the fragile part.)

### 3.10 Smaller notes

- **No dark theme.** Three light themes only — notable for an app with a 3 a.m. radio persona and for gym use in dim rooms.
- **Generation requires keeping the tab open.** Script + TTS generation is foreground JS; navigating away or locking the phone (wake lock helps but can be released) stalls it. Worth a line of UI copy ("keep the app open while generating"), since users will assume it continues.
- **Radio episode length options up to 4 h** with a single Claude call per ~2.5-min segment — a 4-hour show is ~96 sequential API calls with no cost estimate shown up front. Chat shows cost transparently; Radio could estimate before generating.
- **First-run weight entry** asks for ~10 baselines before you can start; it's skippable ("leave blank"), which is good — making the skip more prominent ("You can set these on the day") would reduce abandonment.
- **Cycle-complete screen** seeds next cycle's baselines from W2 projections silently; showing the proposed numbers for confirmation would build trust in what it just did.

---

## 4. Prioritized recommendations

1. **Fix the Chat confirm deadlock (QA 2.1)** — one-line-ish fix, mainline feature.
2. **Fix cardio GPS resume/zeroing (QA 2.2)** — silent data loss in a weekly flow.
3. **Add rest-complete vibration/sound + workout wake lock (UX 3.1, 3.2)** — biggest everyday quality win for the core use case.
4. **Record `programId` on sessions and fix history/name resolution (QA 2.5, 1.3)** — before more AI-generated programmes accumulate.
5. **De-volatilize the Chat system prompt for caching, and unify model constants (1.6)** — direct cost saving.
6. **Wrap `Storage.save()` with quota handling and slim chat-session persistence (1.4)**.
7. **Fix per-profile cardio zones (QA 2.4) and rest-HR capture on both paths (QA 2.7)** — data correctness for the coach.
8. **Reconcile the three cache-version declarations (1.1) and delete the dead Setup views (1.9)**.
9. **Start a small `tests/tracker.test.js`** covering `projectedWeight`, `setSpec`, `todaySessionFromConfig`, and `parsePastedScript` using the existing harness pattern (1.8).
10. **Accessibility pass**: remove `maximum-scale=1`, add `aria-label`s to icon buttons, Escape-to-close on the modal (3.8).
