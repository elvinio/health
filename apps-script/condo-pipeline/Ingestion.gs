// Main entry point — called by timer trigger and manual backfill runs.
//
// Modes:
//   backfill  — backfill_complete meta flag is absent/false; accepts all records
//               >= HISTORY_CUTOFF and relies purely on tx_key dedup. Re-run until
//               the log says "Backfill complete".
//   incremental — backfill_complete = true; skips records with date <= last_ingested_date.
//
// Graceful timeout: the loop checks elapsed time every page and stops at
// SAFE_RUNTIME_MS (5.5 min) so state is always saved before GAS kills the script.
// Simply re-run fetchAndStore() until "Backfill complete" appears in the log.
function fetchAndStore() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No API key set. Add DATA_GOV_API_KEY in Project Settings → Script Properties.');
  }

  const SAFE_RUNTIME_MS = 5.5 * 60 * 1000; // stop fetching at 5.5 min, save state, exit cleanly
  const startTime = Date.now();

  const txSheet = getSheet(CONFIG.TX_SHEET);
  const lastDate = getMeta('last_ingested_date') || CONFIG.HISTORY_CUTOFF;
  const backfillComplete = getMeta('backfill_complete') === 'true';
  const isBackfill = !backfillComplete;

  if (isBackfill) {
    Logger.log(`Backfill mode (resumable): dedup-only, no date cutoff. Re-run until "Backfill complete".`);
  } else {
    Logger.log(`Incremental mode: fetching records newer than ${lastDate}`);
  }

  // Build dedup key set from existing transactions
  const existing = new Set();
  const allData = txSheet.getDataRange().getValues();
  for (let i = 1; i < allData.length; i++) {
    existing.add(allData[i][12]); // column M = tx_key
  }

  let offset = 0;
  let newRows = [];
  let latestDate = lastDate;
  let hasMore = true;
  let totalFetched = 0;
  let timedOut = false;

  while (hasMore) {
    // Graceful timeout: flush pending rows and save state before GAS kills us
    if (Date.now() - startTime > SAFE_RUNTIME_MS) {
      Logger.log(`Approaching 6-min GAS limit after ${totalFetched} records. Saving progress and exiting.`);
      timedOut = true;
      break;
    }

    const url = `${CONFIG.API_BASE}?resource_id=${CONFIG.DATASET_RESOURCE_ID}&limit=${CONFIG.PAGE_SIZE}&offset=${offset}`;
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'x-api-key': apiKey },
    });

    const json = JSON.parse(response.getContentText());
    if (!json.success) {
      Logger.log(`API error at offset ${offset}: ${response.getContentText()}`);
      break;
    }

    const records = json.result.records;
    if (records.length === 0) { hasMore = false; break; }
    totalFetched += records.length;

    for (const r of records) {
      if (!CONFIG.PROPERTY_TYPES.includes(r.propertyType)) continue;

      const date = normaliseDate(r.contractDate);
      if (!date) continue;
      if (date < CONFIG.HISTORY_CUTOFF) continue;

      // Incremental mode: skip already-ingested dates. Backfill: dedup only.
      if (!isBackfill && date <= lastDate) continue;

      const area = parseFloat(r.floorAreaSqft) || 0;
      const price = parseFloat(r.price) || 0;
      const psf = area > 0 ? Math.round(price / area) : 0;

      const storeyParts = (r.floorRange || '').split(' TO ');
      const floorLow = parseInt(storeyParts[0]) || 0;
      const floorHigh = parseInt(storeyParts[1]) || floorLow;

      const row = {
        date,
        project: normaliseProject(r.project),
        street: (r.street || '').trim(),
        type: r.propertyType,
        price,
        area_sqft: area,
        psf,
        floor_low: floorLow,
        floor_high: floorHigh,
        tenure: r.tenure || '',
        district: r.district || '',
        postal: r.postalCode || '',
      };
      row.tx_key = makeTxKey(row);

      if (existing.has(row.tx_key)) continue;
      existing.add(row.tx_key);
      newRows.push(row);
      if (date > latestDate) latestDate = date;
    }

    offset += CONFIG.PAGE_SIZE;
    if (records.length < CONFIG.PAGE_SIZE) hasMore = false;

    // Flush every 500 rows to avoid memory pressure
    if (newRows.length >= 500) {
      appendRows(txSheet, newRows);
      newRows = [];
    }
  }

  if (newRows.length > 0) appendRows(txSheet, newRows);

  // Always save state so re-runs resume correctly
  setMeta('last_ingested_date', latestDate);
  setMeta('last_run_timestamp', new Date().toISOString());

  const total = txSheet.getLastRow() - 1;
  setMeta('total_rows', total);

  if (!timedOut && isBackfill) {
    // Completed a full pass without timing out — backfill is done
    setMeta('backfill_complete', 'true');
    Logger.log(`Backfill complete. Total rows: ${total}`);
  } else if (timedOut) {
    Logger.log(`Timed out. Progress saved. Rows so far: ${total}. Re-run fetchAndStore() to continue.`);
  }

  rebuildIndex();
  Logger.log(`Run finished. Fetched: ${totalFetched} API records. Latest date: ${latestDate}. Total rows: ${total}`);
}

function appendRows(sheet, rows) {
  const values = rows.map(r => [
    r.date, r.project, r.street, r.type,
    r.price, r.area_sqft, r.psf,
    r.floor_low, r.floor_high,
    r.tenure, r.district, r.postal, r.tx_key
  ]);
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);
}

function normaliseDate(raw) {
  if (!raw) return null;
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  // Handle "MMM-YY" e.g. "Mar-24"
  const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                   Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  const match = raw.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (match) {
    const mm = months[match[1]];
    const yy = parseInt(match[2]);
    const yyyy = yy >= 90 ? `19${yy}` : `20${String(yy).padStart(2,'0')}`;
    return `${yyyy}-${mm}`;
  }
  return null;
}
