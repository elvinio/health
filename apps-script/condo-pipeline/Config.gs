const CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  DATASET_RESOURCE_ID: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
  API_BASE: 'https://data.gov.sg/api/action/datastore_search',
  PAGE_SIZE: 100,
  TX_SHEET: 'transactions',
  INDEX_SHEET: 'index',
  META_SHEET: 'meta',
  PROPERTY_TYPES: ['Condominium', 'Apartment', 'Executive Condominium'],
  HISTORY_CUTOFF: '2015-01',   // 10-year history floor — never ingest older than this
};

// API key stored in Script Properties (not hardcoded).
// Run setApiKey('YOUR_KEY') once in the Apps Script editor console, then never touch it again.
// Get a free key at https://data.gov.sg (required since Dec 2025 for rate-limited access).
function setApiKey(key) {
  if (!key) throw new Error('Pass your data.gov.sg API key as the argument: setApiKey("your-key-here")');
  PropertiesService.getScriptProperties().setProperty('DATA_GOV_API_KEY', key);
  Logger.log('API key saved to Script Properties.');
}

function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty('DATA_GOV_API_KEY') || '';
}
