function getSheet(name) {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(name);
  if (!sheet) throw new Error(`Sheet "${name}" not found. Run setupSpreadsheet() first.`);
  return sheet;
}

function getMeta(key) {
  const sheet = getSheet(CONFIG.META_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

function setMeta(key, value) {
  const sheet = getSheet(CONFIG.META_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function normaliseProject(name) {
  return (name || '').toUpperCase().trim();
}

function makeTxKey(row) {
  return `${row.date}|${row.project}|${row.price}|${row.area_sqft}`;
}

// Run once before first fetchAndStore() to create all sheets and seed meta values.
function setupSpreadsheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  function ensureSheet(name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      Logger.log(`Created sheet: ${name}`);
    }
    // Write headers only if row 1 is empty
    if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() === '') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  ensureSheet(CONFIG.TX_SHEET, [
    'date', 'project', 'street', 'type', 'price',
    'area_sqft', 'psf', 'floor_low', 'floor_high',
    'tenure', 'district', 'postal', 'tx_key'
  ]);

  ensureSheet(CONFIG.INDEX_SHEET, ['project', 'first_row', 'last_row', 'count']);

  const metaSheet = ensureSheet(CONFIG.META_SHEET, ['key', 'value']);

  // Seed meta rows if not already present
  const seedRows = [
    ['last_ingested_date', CONFIG.HISTORY_CUTOFF],
    ['last_run_timestamp', ''],
    ['total_rows',         0],
    ['index_last_rebuilt', ''],
  ];
  const existing = metaSheet.getDataRange().getValues().map(r => r[0]);
  for (const [key, value] of seedRows) {
    if (!existing.includes(key)) {
      metaSheet.appendRow([key, value]);
      Logger.log(`Seeded meta: ${key} = ${value}`);
    }
  }

  Logger.log('setupSpreadsheet() complete. Ready to run fetchAndStore().');
}
