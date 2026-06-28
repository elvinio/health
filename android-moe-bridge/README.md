# MOE Bridge (Android)

A small **debug** Android app that captures messages/notifications from the **MOE
Parents Gateway** app (via an Accessibility Service), stores them locally in
**SQLite (Room)**, and uploads new items to your **Google Drive** as
`moe-inbox-incoming.json`. The Finance PWA in this repo reads that file on its
normal Drive sync and shows the items in its **MOE** view (under the Events tab).

```
MOE PG app ──AccessibilityEvent──► MoeAccessibilityService ──► Room/SQLite (dedup queue)
                                                                │ WorkManager
                                                                ▼
                                  Google Drive: moe-inbox-incoming.json (plain JSON)
                                                                ▼
                                  Finance PWA ──► data.moeInbox ──► "MOE" view (Events tab)
```

> Why not have the PWA read the SQLite file directly? A browser PWA can't reach a
> file in Android app storage — there's no shared path. Google Drive is the bridge
> (the PWA already syncs with Drive).

## Build the APK

### Option A — GitHub Actions (no local SDK needed)
Push changes under `android-moe-bridge/**`; the **Android MOE Bridge APK** workflow
builds it and uploads `moe-bridge-debug-apk` as a run artifact. Download, then
sideload `app-debug.apk`. You can also trigger it manually (workflow_dispatch).

### Option B — local
Requires Android SDK (platform 34). From this directory:
```bash
./gradlew :app:assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

## One-time Google setup (required for Drive upload)

The app signs in with Google and uploads with the `drive.file` scope. You must
create an OAuth **Android** client whose signing certificate matches this app.

1. In [Google Cloud Console](https://console.cloud.google.com/) create/select a
   project and **enable the Google Drive API**.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Android**.
   - **Package name:** `com.elvinio.moebridge`
   - **SHA-1** of the committed debug keystore:
     ```
     71:0B:47:EA:E1:5C:0C:9E:82:F5:93:93:6A:1C:A6:A0:53:19:96:A6
     ```
     (Re-derive any time with:
     `keytool -list -v -keystore debug.keystore -storepass android -alias androiddebugkey`.)
3. Configure the **OAuth consent screen** (External, Testing is fine) and add your
   own Google account as a **Test user**.

> The app uses the **same Google account** as your Finance PWA's Drive — sign in
> with that account so the PWA can see `moe-inbox-incoming.json`.

> The debug keystore is committed on purpose so the SHA-1 is **stable** across CI
> and local builds. This is a personal debug-only app; do not reuse this keystore
> for anything published.

## Install & use on your phone

1. Sideload `app-debug.apk` (enable "Install unknown apps" for your file manager).
2. Open **MOE Bridge** → **Sign in to Google Drive** (use your Drive account).
3. Tap **Enable Accessibility** → enable **MOE Bridge capture**.
   - On **Android 13+**, sideloaded accessibility services are blocked until you
     allow it: **Settings → Apps → MOE Bridge → ⋮ → Allow restricted settings**,
     then enable the service.
4. **Find the real MOE package name** (first run only): turn on **Debug: capture
   ALL apps**, **Save**, open MOE Parents Gateway, come back and read the `pkg`
   shown under *Recent captures*. Put that value in **Target package(s)**, turn
   **capture all OFF**, and **Save**.
5. Use MOE PG normally. Captures appear under *Recent captures* and upload (a
   `•` = pending, `✓` = synced). **Sync now** forces an upload.
6. In the Finance PWA, run a Drive sync → open the **Events** tab → tap the
   **MOE** (school) view button → items show there.

## Notes
- Accessibility scraping is inherently fragile to MOE UI changes; the full capture
  is preserved in the `rawJson` column so mapping can be refined later.
- The Drive file is capped to the most recent ~200 items / 60 days.
- Everything stays in your own Google account; nothing is sent anywhere else.
