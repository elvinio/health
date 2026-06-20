/**
 * Classicals.de music proxy — Google Apps Script
 *
 * Supplies royalty-free piano music for the Health Tracker PWA's Radio tab,
 * which plays a musical interstitial between spoken segments. classicals.de
 * blocks generic fetchers (returns 403) and the browser can't scrape it
 * (CORS), so this web app does both the scrape and the audio fetch server-side
 * and hands base64 back to the PWA. Downloaded MP3s are cached in a Drive
 * folder so repeat plays don't re-hit classicals.de.
 *
 * One-time setup:
 *   1. https://script.google.com → New project → paste this file.
 *   2. (optional) Project Settings → Script Properties → add
 *        PROXY_TOKEN = <any secret string>   (if set, callers must pass &token=)
 *   3. Run `listTracks` once in the editor to trigger the authorization flow
 *      (grants the external-request + Drive scopes).
 *   4. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone (even anonymous)
 *   5. Copy the web app URL (ends in /exec) into the PWA:
 *        Tracker → Setup → Radio station → "Interstitial music URL".
 *
 * GET {webAppUrl}?action=List&token=<secret>
 *   Scrapes the solo-piano selection page, returns:
 *   { "tracks": [ { "id": "...", "title": "...", "url": "https://.../x.mp3" }, ... ] }
 *
 * GET {webAppUrl}?action=Track&url=<encoded mp3 url>&token=<secret>
 *   Returns one track as base64 (Apps Script can't serve binary), serving from
 *   a Drive cache when present:
 *   { "title": "...", "mp3": "<base64>" }
 *
 * If PROXY_TOKEN is not set in Script Properties, the token check is skipped.
 */

var PROXY_TOKEN_PROP = 'PROXY_TOKEN';
var PAGE_URL         = 'https://www.classicals.de/solo-piano-selection';
var SITE_ORIGIN      = 'https://www.classicals.de';
var MUSIC_FOLDER     = 'radio-music-cache';
var UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function doGet(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var expectedToken = props.getProperty(PROXY_TOKEN_PROP);
    if (expectedToken) {
      var providedToken = e.parameter && e.parameter.token;
      if (providedToken !== expectedToken) return jsonOut({ error: 'Forbidden' });
    }

    var action = e.parameter && e.parameter.action;
    if (action === 'List')  return handleList();
    if (action === 'Track') return handleTrack(e);
    return jsonOut({ error: 'Unknown action' });

  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

// Manual entry point for the one-time authorization run.
function listTracks() { return JSON.parse(handleList().getContent()); }

function handleList() {
  var resp = UrlFetchApp.fetch(PAGE_URL, {
    headers: { 'User-Agent': UA, accept: 'text/html' },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    return jsonOut({ error: 'Page fetch failed: HTTP ' + resp.getResponseCode(), tracks: [] });
  }
  return jsonOut({ tracks: parseTracks(resp.getContentText()) });
}

// Pull every .mp3 reference (href/src) out of the page HTML and pair each with a
// human title. Titles come from the link text when present, else the file slug.
function parseTracks(html) {
  var seen = {};
  var tracks = [];

  // <a ... href="...mp3" ...>Title</a>  — captures link text as the title.
  var anchor = /<a\b[^>]*href\s*=\s*["']([^"']+\.mp3)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = anchor.exec(html)) !== null) addTrack(seen, tracks, m[1], stripTags(m[2]));

  // Any remaining bare href/src="...mp3" not already captured (e.g. <audio><source>).
  var bare = /(?:href|src)\s*=\s*["']([^"']+\.mp3)["']/gi;
  while ((m = bare.exec(html)) !== null) addTrack(seen, tracks, m[1], '');

  return tracks;
}

function addTrack(seen, tracks, rawUrl, title) {
  var url = absUrl(rawUrl);
  if (!url || seen[url]) return;
  seen[url] = true;
  var slug = decodeURIComponent(url.split('/').pop().replace(/\.mp3$/i, '')).replace(/[_-]+/g, ' ').trim();
  tracks.push({ id: hashId(url), title: (title || '').trim() || slug, url: url });
}

function absUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return SITE_ORIGIN + u;
  return SITE_ORIGIN + '/' + u;
}

function stripTags(s) { return (s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }

function hashId(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) { var b = (bytes[i] + 256) % 256; hex += (b < 16 ? '0' : '') + b.toString(16); }
  return hex;
}

function handleTrack(e) {
  var url = e.parameter && e.parameter.url;
  if (!url) return jsonOut({ error: 'Missing url parameter' });
  // SSRF guard: only ever fetch from classicals.de.
  if (url.indexOf(SITE_ORIGIN + '/') !== 0) return jsonOut({ error: 'URL not allowed' });

  var title = (e.parameter.title || '').trim();
  var name = hashId(url) + '.mp3';
  var folder = getMusicFolder_();

  var existing = folder.getFilesByName(name);
  var bytes;
  if (existing.hasNext()) {
    bytes = existing.next().getBlob().getBytes();
  } else {
    var resp = UrlFetchApp.fetch(url, {
      headers: { 'User-Agent': UA, accept: 'audio/mpeg,*/*', referer: PAGE_URL },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) return jsonOut({ error: 'Track fetch failed: HTTP ' + resp.getResponseCode() });
    var blob = resp.getBlob().setName(name);
    bytes = blob.getBytes();
    folder.createFile(blob);
  }
  return jsonOut({ title: title, mp3: Utilities.base64Encode(bytes) });
}

function getMusicFolder_() {
  var it = DriveApp.getFoldersByName(MUSIC_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(MUSIC_FOLDER);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
