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

    var apiKey = props.getProperty(LTA_API_KEY_PROP);
    if (!apiKey) {
      return jsonOut({ error: 'LTA_API_KEY not set in Script Properties' });
    }

    var action = e.parameter && e.parameter.action;

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

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
