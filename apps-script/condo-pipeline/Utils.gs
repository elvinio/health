function getSheet(name) {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(name);
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
