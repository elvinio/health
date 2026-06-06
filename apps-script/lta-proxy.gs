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
 *   3. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone (even anonymous)
 *   4. Copy the web app URL (ends in /exec).
 *   5. In the Finance PWA → Events → Bus or Bus Map:
 *        Leave the API Key field blank.
 *        Paste the web app URL into the Proxy URL field.
 *
 * The PWA calls: GET {webAppUrl}?url=<encodedLtaApiUrl>
 * This script forwards the request to LTA with the stored key and
 * returns the JSON. The browser never sees the key.
 */

var LTA_API_KEY_PROP = 'LTA_API_KEY';
var ALLOWED_HOST = 'datamall2.mytransport.sg';

function doGet(e) {
  try {
    var rawUrl = e.parameter && e.parameter.url;
    if (!rawUrl) {
      return jsonOut({ error: 'Missing url parameter' });
    }

    if (!rawUrl.startsWith('https://' + ALLOWED_HOST + '/')) {
      return jsonOut({ error: 'Only LTA DataMall requests are proxied' });
    }

    var apiKey = PropertiesService.getScriptProperties().getProperty(LTA_API_KEY_PROP);
    if (!apiKey) {
      return jsonOut({ error: 'LTA_API_KEY not set in Script Properties' });
    }

    var resp = UrlFetchApp.fetch(rawUrl, {
      method: 'get',
      headers: { AccountKey: apiKey, accept: 'application/json' },
      muteHttpExceptions: true
    });

    return ContentService
      .createTextOutput(resp.getContentText())
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
