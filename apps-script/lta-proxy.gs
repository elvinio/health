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
 *        Leave the API Key field blank.
 *        Paste the web app URL into the Proxy URL field.
 *        Paste the same secret into the Proxy Token field.
 *
 * The PWA calls: GET {webAppUrl}?token=<secret>&url=<encodedLtaApiUrl>
 * This script checks the token, forwards the request to LTA with the stored
 * key, and returns the JSON. The browser never sees the LTA key.
 *
 * If PROXY_TOKEN is not set in Script Properties, the token check is skipped
 * (useful for initial testing).
 */

var LTA_API_KEY_PROP = 'LTA_API_KEY';
var PROXY_TOKEN_PROP  = 'PROXY_TOKEN';
var ALLOWED_HOST = 'datamall2.mytransport.sg';

function doGet(e) {
  try {
    // Token check — only enforced when PROXY_TOKEN is configured
    var expectedToken = PropertiesService.getScriptProperties().getProperty(PROXY_TOKEN_PROP);
    if (expectedToken) {
      var providedToken = e.parameter && e.parameter.token;
      if (providedToken !== expectedToken) {
        return jsonOut({ error: 'Forbidden' });
      }
    }

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
