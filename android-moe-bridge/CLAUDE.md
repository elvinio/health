# MOE Bridge (Android) — Claude Notes

Standalone **debug** Android app (Kotlin + Gradle). Captures **MOE Parents
Gateway** content via an AccessibilityService, queues it in **SQLite (Room)**, and
uploads new items to **Google Drive** as `moe-inbox-incoming.json` for the Finance
PWA to ingest. Fully self-contained in this folder — unrelated to the static web
apps except through the Drive file contract below.

> User-facing setup (OAuth, sideload, restricted-settings) lives in `README.md`.
> This file is the developer/architecture map.

## Data flow

```
MOE PG app ─AccessibilityEvent─► MoeAccessibilityService ─► Room (CaptureEntity, dedup by content hash)
                                                            │ SyncWorker (WorkManager: debounced + hourly + "Sync now")
                                                            ▼
                                 DriveUploader → Drive: moe-inbox-incoming.json (plain JSON, app is SOLE writer)
                                                            ▼
                  Finance PWA fetchMoeInbox() (finance-drive.js) → data.moeInbox → "MOE" view under Events (finance-moe.js)
```

Key decision: a browser PWA can't read on-device SQLite, so Drive is the bridge.
SQLite is the durable local queue; Drive carries only the JSON projection.

## Source map (`app/src/main/java/com/elvinio/moebridge/`)

| File | Role |
|---|---|
| `MoeAccessibilityService.kt` | Receives `TYPE_WINDOW_STATE/CONTENT_CHANGED` + `TYPE_NOTIFICATION_STATE_CHANGED`. Filters to configured package(s) (or all in debug). Pulls text from the `Notification` extras and by walking the `AccessibilityNodeInfo` tree. Dedups via a SHA-256 content hash (pkg+screen+title+text+5-min bucket), inserts into Room, kicks a debounced sync. |
| `db/CaptureEntity.kt` `db/CaptureDao.kt` `db/AppDatabase.kt` | Room: `captures` table; `insertIgnore` (PK = content hash = dedup), `pendingUnsynced`, `markSynced`, `recent`, counts. |
| `DriveUploader.kt` | OAuth token via `GoogleAuthUtil` (scope `drive.file`); Drive REST v3 over OkHttp. find-or-create the file, **download → merge by id → cap (≤200 items / ≤60 days) → rewrite** (`uploadType=media` PATCH). Marks rows synced. |
| `SyncWorker.kt` | `CoroutineWorker`. `enqueueDebounced` (unique, 15s, KEEP), `enqueueNow` (REPLACE), `ensurePeriodic` (hourly KEEP). `NotSignedIn` → success (no retry storm); other errors → retry. |
| `MainActivity.kt` | Status (accessibility on?, account, pending/total, last sync), Google sign-in, enable-accessibility deep link, Sync now, package/captureAll settings, recent-captures debug list. |
| `Prefs.kt` | SharedPreferences: `targetPackages` (default `sg.gov.tech.parentsgateway`), `captureAll`, cached `driveFileId`, `account`, `lastSync`; `packageFilter()` → set or null (=all). |

Accessibility is registered in `AndroidManifest.xml` + `res/xml/accessibility_service_config.xml`.
`packageNames` is intentionally **unset** there (receives all) so the in-code filter
+ the "capture all" debug mode can discover the real MOE package on-device.

## Drive file contract (the integration seam)

`moe-inbox-incoming.json` — plain JSON, Android is the **sole writer**:
```json
{ "items": [ { "id", "capturedAt", "pkg", "screen", "title", "text" } ], "_updatedAt": 0 }
```
PWA side (`finance-drive.js` `fetchMoeInbox`): adds items whose `id` ∉
`data.moeInboxSeenIds`, tombstones ids on delete so they never reappear, and merges
across PWA devices via `mergeMoeInbox` (delete-wins). `id` MUST be stable + globally
unique — it's the dedup/tombstone key on both sides. The PWA uses full `drive`
scope, so it can read this `drive.file`-created file by name (same Google account).

## Build & signing
- `./gradlew :app:assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`.
  Built in CI by `.github/workflows/android-moe-bridge.yml` (artifact:
  `moe-bridge-debug-apk`).
- Committed `debug.keystore` (storepass/keypass `android`, alias `androiddebugkey`)
  keeps the signing **SHA-1 stable** so it can be registered once in the Google
  OAuth Android client. SHA-1: `71:0B:47:EA:E1:5C:0C:9E:82:F5:93:93:6A:1C:A6:A0:53:19:96:A6`.
- Toolchain: AGP 8.5.2, Kotlin 1.9.24, KSP (Room), Gradle 8.7 (wrapper committed),
  JDK 17, minSdk 26 / target 34.

## Gotchas
- `event.parcelableData as? Notification` is deprecated but is the way to read
  notification text from an accessibility event; keep it.
- Node-tree scrapes are debounced (`TYPE_WINDOW_CONTENT_CHANGED` ≥1.5s apart) — the
  5-min hash bucket collapses the remaining bursts. Same content seen much later is
  re-captured as a new row (acceptable).
- `QUERY_ALL_PACKAGES` is declared only so the debug "capture all" flow can surface
  package names; capture itself does not require it.
- No instrumentation tests; verification is CI build + manual on-device (README).
