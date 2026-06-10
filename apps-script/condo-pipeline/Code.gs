function doGet(e) {
  try {
    const params = e.parameter || {};
    const action = params.action || 'query';
    let result;
    switch (action) {
      case 'query':   result = handleQuery(params);   break;
      case 'suggest': result = handleSuggest(params); break;
      case 'meta':    result = handleMeta();          break;
      default:        result = { error: 'Unknown action' };
    }
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// --- action=query ---
// Params: project (required or district), from, to, min_psf, max_psf, limit
function handleQuery(params) {
  const txSheet = getSheet(CONFIG.TX_SHEET);
  const txData = txSheet.getDataRange().getValues();
  let rowIndices = [];

  if (params.project) {
    // Use index for fast project lookup
    const projKey = normaliseProject(params.project);
    const idx = getIndexEntry(projKey);
    if (!idx) return { count: 0, data: [] };
    for (let i = idx.first_row - 1; i < idx.last_row; i++) {
      rowIndices.push(i);
    }
  } else {
    // Full scan (for district queries etc.)
    for (let i = 1; i < txData.length; i++) rowIndices.push(i);
  }

  // Apply filters
  const from   = params.from   || null;
  const to     = params.to     || null;
  const dist   = params.district ? params.district.toUpperCase() : null;
  const minPsf = params.min_psf ? parseInt(params.min_psf) : null;
  const maxPsf = params.max_psf ? parseInt(params.max_psf) : null;
  const limit  = Math.min(parseInt(params.limit || '200'), 1000);

  const filtered = [];
  for (const i of rowIndices) {
    const row = txData[i];
    if (!row) continue;
    const [date, project, street, type, price, area, psf,
           flLow, flHigh, tenure, district, postal, txKey] = row;
    if (from   && date < from)    continue;
    if (to     && date > to)      continue;
    if (dist   && district.toUpperCase() !== dist) continue;
    if (minPsf && psf < minPsf)   continue;
    if (maxPsf && psf > maxPsf)   continue;
    filtered.push({ date, project, street, type, price,
                    area_sqft: area, psf, floor_low: flLow,
                    floor_high: flHigh, tenure, district, postal });
    if (filtered.length >= limit) break;
  }

  return { count: filtered.length, data: filtered };
}

// --- action=suggest ---
// Params: q (partial project name prefix)
function handleSuggest(params) {
  const q = normaliseProject(params.q || '');
  if (q.length < 2) return { suggestions: [] };

  const idxSheet = getSheet(CONFIG.INDEX_SHEET);
  const data = idxSheet.getDataRange().getValues();
  const suggestions = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].startsWith(q)) {
      suggestions.push({ project: data[i][0], count: data[i][3] });
    }
    if (suggestions.length >= 10) break;
  }
  return { suggestions };
}

// --- action=meta ---
function handleMeta() {
  const sheet = getSheet(CONFIG.META_SHEET);
  const data = sheet.getDataRange().getValues();
  const meta = {};
  for (let i = 1; i < data.length; i++) {
    meta[data[i][0]] = data[i][1];
  }
  return { meta };
}

// Helper: look up index entry for a project
function getIndexEntry(projectKey) {
  const idxSheet = getSheet(CONFIG.INDEX_SHEET);
  const data = idxSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === projectKey) {
      return { first_row: data[i][1], last_row: data[i][2], count: data[i][3] };
    }
  }
  return null;
}

// Run once to install the weekly trigger (Saturday 2–3 AM SGT)
function installTrigger() {
  ScriptApp.newTrigger('fetchAndStore')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(2)
    .create();
  Logger.log('Weekly trigger installed.');
}
