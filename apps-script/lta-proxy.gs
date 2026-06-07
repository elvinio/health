/**
 * LTA Bus Arrival Proxy — Google Apps Script
 *
 * Acts as a CORS proxy for the LTA DataMall Bus Arrival v3 API.
 * The API key lives in Script Properties, never in the browser.
 *
 * One-time setup:
 *   1. Go to https://script.google.com → New project → paste this file.
 *   2. Project Settings → Script Properties → add:
 *        LTA_API_KEY = <your LTA DataMall AccountKey>
 *        PROXY_TOKEN  = <any secret string you choose>  (optional but recommended)
 *   3. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone (even anonymous)
 *   4. Copy the web app URL (ends in /exec).
 *   5. In the Finance PWA → Events → Bus or Bus Map:
 *        Paste the web app URL into the Proxy URL field.
 *
 * Bus arrival (new style — fetches all stops in one parallel batch):
 *   GET {webAppUrl}?action=BusArrival&stops=83139,12345&token=<secret>
 *   Returns: { "83139": { BusStopCode, Services: [...] }, "12345": { ... } }
 *
 * Generic proxy (legacy — used for BusStops coord lookup):
 *   GET {webAppUrl}?url=<encodedLtaUrl>&token=<secret>
 *
 * If PROXY_TOKEN is not set in Script Properties, the token check is skipped.
 */

var LTA_API_KEY_PROP  = 'LTA_API_KEY';
var PROXY_TOKEN_PROP  = 'PROXY_TOKEN';
var ALLOWED_HOST      = 'datamall2.mytransport.sg';
var BUS_ARRIVAL_URL   = 'https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival';

function doGet(e) {
  try {
    var props = PropertiesService.getScriptProperties();

    // Token check — only enforced when PROXY_TOKEN is configured
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

    if (action === 'BusArrival') {
      return handleBusArrival(e, apiKey);
    }

    // Legacy generic proxy (used for BusStops coord lookup)
    return handleGenericProxy(e, apiKey);

  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function handleBusArrival(e, apiKey) {
  var stopsParam = e.parameter && e.parameter.stops;
  if (!stopsParam) {
    return jsonOut({ error: 'Missing stops parameter' });
  }

  var stopCodes = stopsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (!stopCodes.length) {
    return jsonOut({ error: 'No stop codes provided' });
  }

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
      var parsed = JSON.parse(responses[i].getContentText());
      result[code] = parsed;
    } catch (err) {
      result[code] = { error: 'Parse error' };
    }
  });

  return jsonOut(result);
}

function handleGenericProxy(e, apiKey) {
  var rawUrl = e.parameter && e.parameter.url;
  if (!rawUrl) {
    return jsonOut({ error: 'Missing url parameter' });
  }

  if (!rawUrl.startsWith('https://' + ALLOWED_HOST + '/')) {
    return jsonOut({ error: 'Only LTA DataMall requests are proxied' });
  }

  var resp = UrlFetchApp.fetch(rawUrl, {
    method: 'get',
    headers: { AccountKey: apiKey, accept: 'application/json' },
    muteHttpExceptions: true
  });

  return ContentService
    .createTextOutput(resp.getContentText())
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
