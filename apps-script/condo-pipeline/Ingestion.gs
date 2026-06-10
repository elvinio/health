// Main entry point — called by timer trigger and manual backfill runs.
// On the very first run (total_rows == 0), performs a full backfill from
// HISTORY_CUTOFF. On subsequent runs, fetches only records newer than
// last_ingested_date (incremental update).
function fetchAndStore() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No API key set. Run setApiKey("your-key") first. Get a free key at https://data.gov.sg');
  }

  const txSheet = getSheet(CONFIG.TX_SHEET);
  const lastDate = getMeta('last_ingested_date') || CONFIG.HISTORY_CUTOFF;
  const isBackfill = (String(getMeta('total_rows') || '0') === '0');

  if (isBackfill) {
    Logger.log(`Backfill mode: fetching all records from ${CONFIG.HISTORY_CUTOFF}`);
  } else {
    Logger.log(`Incremental mode: fetching records newer than ${lastDate}`);
  }

  // Build existing dedup key set from transactions sheet
  const existing = new Set();
  const allData = txSheet.getDataRange().getValues();
  for (let i = 1; i < allData.length; i++) {
    existing.add(allData[i][12]); // column M (index 12) = tx_key
  }

  let offset = 0;
  let newRows = [];
  let latestDate = lastDate;
  let hasMore = true;
  let totalFetched = 0;

  while (hasMore) {
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
      // Filter property type
      if (!CONFIG.PROPERTY_TYPES.includes(r.propertyType)) continue;

      // Parse date (API returns e.g. "2024-03" or "Mar-24")
      const date = normaliseDate(r.contractDate);
      if (!date) continue;

      // Always enforce the 10-year floor
      if (date < CONFIG.HISTORY_CUTOFF) continue;

      // During incremental runs, skip records already ingested.
      // During backfill, accept everything >= HISTORY_CUTOFF (dedup handles reruns).
      if (!isBackfill && date <= lastDate) continue;

      const area = parseFloat(r.floorAreaSqft) || 0;
      const price = parseFloat(r.price) || 0;
      const psf = area > 0 ? Math.round(price / area) : 0;

      // Parse storey range e.g. "07 TO 09"
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

    // Batch-write every 500 rows to avoid memory pressure
    if (newRows.length >= 500) {
      appendRows(txSheet, newRows);
      newRows = [];
    }
  }

  if (newRows.length > 0) appendRows(txSheet, newRows);

  // Persist state — latestDate advances even on partial timeout runs,
  // so the next manual re-run resumes from where this one stopped.
  setMeta('last_ingested_date', latestDate);
  setMeta('last_run_timestamp', new Date().toISOString());
  rebuildIndex();
  const total = txSheet.getLastRow() - 1;
  setMeta('total_rows', total);

  Logger.log(`Done. Pages fetched: ${totalFetched / CONFIG.PAGE_SIZE}. Latest date: ${latestDate}. Total rows: ${total}`);
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
  // Handle "YYYY-MM" directly
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
