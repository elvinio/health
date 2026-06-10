function rebuildIndex() {
  const txSheet = getSheet(CONFIG.TX_SHEET);
  const idxSheet = getSheet(CONFIG.INDEX_SHEET);
  const data = txSheet.getDataRange().getValues();

  // Column B (index 1) is project name
  // Map: project → { first, last, count }
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const proj = data[i][1]; // already uppercased at ingestion
    const rowNum = i + 1;    // 1-based sheet row
    if (!map[proj]) {
      map[proj] = { first: rowNum, last: rowNum, count: 1 };
    } else {
      map[proj].last = rowNum;
      map[proj].count++;
    }
  }

  // Write index sheet (clear first, keep header)
  idxSheet.clearContents();
  idxSheet.appendRow(['project', 'first_row', 'last_row', 'count']);
  const indexRows = Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([proj, v]) => [proj, v.first, v.last, v.count]);

  if (indexRows.length > 0) {
    idxSheet.getRange(2, 1, indexRows.length, 4).setValues(indexRows);
  }

  setMeta('index_last_rebuilt', new Date().toISOString());
  Logger.log(`Index rebuilt: ${indexRows.length} projects`);
}
