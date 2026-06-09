/**
 * LTA Bus Proxy — Google Apps Script
 *
 * Handles two actions for the Finance PWA. The LTA API key lives in
 * Script Properties (LTA_API_KEY), never in the browser.
 *
 * One-time setup:
 *   1. Go to https://script.google.com → New project → paste this file.
 *   2. Project Settings → Script Properties → add:
 *        LTA_API_KEY  = <your LTA DataMall AccountKey>
 *        PROXY_TOKEN  = <any secret string you choose>  (optional but recommended)
 *   3. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone (even anonymous)
 *   4. Run any function once to trigger the authorization flow.
 *   5. Copy the web app URL (ends in /exec) into the Finance PWA Proxy URL field.
 *
 * GET {webAppUrl}?action=BusArrival&stops=83139,12345&token=<secret>
 *   Fetches all stops in parallel, returns:
 *   { "83139": { BusStopCode, Services: [...] }, "12345": { ... } }
 *
 * GET {webAppUrl}?action=BusStopCoords&stops=83139,12345&token=<secret>
 *   Pages through the LTA BusStops dataset in parallel, returns coordinates
 *   for only the requested stops:
 *   { "83139": { lat, lng, name }, "12345": { ... } }
 *
 * ── Rain radar cache ──
 * Keeps the last 24h of NEA rain-radar frames (weather.gov.sg publishes a
 * frame every 5 min but only retains ~1 hour). A time-driven trigger saves
 * each frame as <YYYYMMDDHHMM>.png (SGT slot key) into a Drive folder named
 * "rain-radar-cache" and prunes frames older than 24h (~288 small PNGs).
 *
 * One-time setup (in addition to the steps above):
 *   1. Run cacheRainFrame once manually — this triggers the authorization
 *      flow for the Drive + weather.gov.sg scopes (required again if you
 *      added this section to an already-deployed script).
 *   2. Run installRainTrigger once to install the every-5-minutes trigger.
 *   3. Redeploy the web app (Manage deployments → edit → New version) so
 *      the new actions go live on the same /exec URL.
 *
 * GET {webAppUrl}?action=RainList&token=<secret>
 *   → { "frames": ["202606090800", "202606090805", ...] }  (sorted ascending)
 *
 * GET {webAppUrl}?action=RainImg&t=202606090800&token=<secret>
 *   → { "t": "202606090800", "png": "<base64>" }
 *   (Apps Script can't serve binary; the PWA builds a data: URI.)
 *
 * If PROXY_TOKEN is not set in Script Properties, the token check is skipped.
 */

var LTA_API_KEY_PROP = 'LTA_API_KEY';
var PROXY_TOKEN_PROP = 'PROXY_TOKEN';
var BUS_ARRIVAL_URL  = 'https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival';
var BUS_STOPS_URL    = 'https://datamall2.mytransport.sg/ltaodataservice/BusStops';

function doGet(e) {
  try {
    var props = PropertiesService.getScriptProperties();

    var expectedToken = props.getProperty(PROXY_TOKEN_PROP);
    if (expectedToken) {
      var providedToken = e.parameter && e.parameter.token;
      if (providedToken !== expectedToken) {
        return jsonOut({ error: 'Forbidden' });
      }
    }

    var action = e.parameter && e.parameter.action;

    // Rain actions need Drive only, not the LTA key.
    if (action === 'RainList') return handleRainList();
    if (action === 'RainImg') return handleRainImg(e);

    var apiKey = props.getProperty(LTA_API_KEY_PROP);
    if (!apiKey) {
      return jsonOut({ error: 'LTA_API_KEY not set in Script Properties' });
    }

    if (action === 'BusArrival') return handleBusArrival(e, apiKey);
    if (action === 'BusStopCoords') return handleBusStopCoords(e, apiKey);

    return jsonOut({ error: 'Unknown action' });

  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function handleBusArrival(e, apiKey) {
  var stopsParam = e.parameter && e.parameter.stops;
  if (!stopsParam) return jsonOut({ error: 'Missing stops parameter' });

  var stopCodes = stopsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (!stopCodes.length) return jsonOut({ error: 'No stop codes provided' });

  var requests = stopCodes.map(function(code) {
    return {
      url: BUS_ARRIVAL_URL + '?BusStopCode=' + encodeURIComponent(code),
      method: 'get',
      headers: { AccountKey: apiKey, accept: 'application/json' },
      muteHttpExceptions: true
    };
  });

  var responses = UrlFetchApp.fetchAll(requests);
  var result = {};
  stopCodes.forEach(function(code, i) {
    try {
      result[code] = JSON.parse(responses[i].getContentText());
    } catch (err) {
      result[code] = { error: 'Parse error' };
    }
  });

  return jsonOut(result);
}

function handleBusStopCoords(e, apiKey) {
  var stopsParam = e.parameter && e.parameter.stops;
  if (!stopsParam) return jsonOut({ error: 'Missing stops parameter' });

  var stopCodes = stopsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (!stopCodes.length) return jsonOut({ error: 'No stop codes provided' });

  // Page through the full BusStops dataset in parallel (~21 pages × 500 stops).
  var requests = [];
  for (var skip = 0; skip < 10500; skip += 500) {
    requests.push({
      url: BUS_STOPS_URL + '?$skip=' + skip,
      method: 'get',
      headers: { AccountKey: apiKey, accept: 'application/json' },
      muteHttpExceptions: true
    });
  }

  var responses = UrlFetchApp.fetchAll(requests);
  var result = {};
  var found = 0;

  responses.forEach(function(resp) {
    if (found >= stopCodes.length) return;
    try {
      var data = JSON.parse(resp.getContentText());
      (data.value || []).forEach(function(s) {
        if (stopCodes.indexOf(s.BusStopCode) !== -1) {
          result[s.BusStopCode] = { lat: s.Latitude, lng: s.Longitude, name: s.Description };
          found++;
        }
      });
    } catch (err) {}
  });

  return jsonOut(result);
}

// ── Rain radar cache ─────────────────────────────────────────────────────────

var RAIN_URL_PREFIX    = 'https://www.weather.gov.sg/files/rainarea/50km/v2/dpsri_70km_';
var RAIN_URL_SUFFIX    = '0000dBR.dpsri.png';
var RAIN_FOLDER_NAME   = 'rain-radar-cache';
var RAIN_RETENTION_MS  = 24 * 60 * 60 * 1000;

// Run once manually to install the every-5-minutes trigger (idempotent).
function installRainTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'cacheRainFrame') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cacheRainFrame').timeBased().everyMinutes(5).create();
}

// SGT slot key (yyyyMMddHHmm, minutes floored to a 5-min boundary),
// stepped back offsetSlots × 5 min.
function sgtSlotKey_(date, offsetSlots) {
  var t = date.getTime() - (offsetSlots || 0) * 5 * 60000;
  var floored = new Date(Math.floor(t / 300000) * 300000);
  return Utilities.formatDate(floored, 'Asia/Singapore', 'yyyyMMddHHmm');
}

function getRainFolder_() {
  var it = DriveApp.getFoldersByName(RAIN_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(RAIN_FOLDER_NAME);
}

// Trigger handler: fetch the newest available frame (NEA publishes with a
// little lag, so fall back up to 2 slots) and prune frames older than 24h.
function cacheRainFrame() {
  var folder = getRainFolder_();
  var now = new Date();
  for (var off = 0; off <= 2; off++) {
    var key = sgtSlotKey_(now, off);
    var name = key + '.png';
    if (folder.getFilesByName(name).hasNext()) break; // newest slot already cached
    var resp = UrlFetchApp.fetch(RAIN_URL_PREFIX + key + RAIN_URL_SUFFIX, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200 && (resp.getBlob().getContentType() || '').indexOf('image') === 0) {
      folder.createFile(resp.getBlob().setName(name));
      break;
    }
  }
  pruneRainCache_(folder, now);
}

function pruneRainCache_(folder, now) {
  // Slot keys are yyyyMMddHHmm, so lexicographic compare == chronological.
  var cutoffKey = sgtSlotKey_(new Date(now.getTime() - RAIN_RETENTION_MS), 0);
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    var m = f.getName().match(/^(\d{12})\.png$/);
    if (m && m[1] < cutoffKey) f.setTrashed(true);
  }
}

function handleRainList() {
  var files = getRainFolder_().getFiles();
  var frames = [];
  while (files.hasNext()) {
    var m = files.next().getName().match(/^(\d{12})\.png$/);
    if (m) frames.push(m[1]);
  }
  frames.sort();
  return jsonOut({ frames: frames });
}

function handleRainImg(e) {
  var key = e.parameter && e.parameter.t;
  if (!key || !/^\d{12}$/.test(key)) return jsonOut({ error: 'Bad t parameter' });
  var it = getRainFolder_().getFilesByName(key + '.png');
  if (!it.hasNext()) return jsonOut({ error: 'Not found' });
  return jsonOut({ t: key, png: Utilities.base64Encode(it.next().getBlob().getBytes()) });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
