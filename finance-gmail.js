// ── Parser Rules (Rules subtab of Expenses) ───────────────────────────────────
// All parsers — both expense and event — live in data.emailParsers.parsers.
// Event parsers carry type:"event" and use the Apps Script datetime shape.
// The Apps Script reads the same array directly from finance-elvis.json.

// ── Storage ───────────────────────────────────────────────────────────────────

function loadGmailParsers() {
  return (data.emailParsers && data.emailParsers.parsers) ? data.emailParsers.parsers : [];
}

function saveGmailParsers(parsers) {
  if (!data.emailParsers) data.emailParsers = {};
  data.emailParsers.parsers = parsers;
  data._emailParsersTs = Date.now();
  saveData(data);
}

// ── Parser Config Import / Export ─────────────────────────────────────────────

function triggerImportParsers() {
  document.getElementById('importParsersFile').click();
}

function exportParsers() {
  const parsers = loadGmailParsers();
  if (!parsers.length) { showToast('No parser config to export'); return; }
  const config = {
    parsers,
    catMap:     data.emailCatMap     || [],
    catDefault: data.emailCatDefault || 'Other'
  };
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'email-parsers.json';
  a.click();
}

document.getElementById('importParsersFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const raw    = JSON.parse(ev.target.result);
      const config = Array.isArray(raw) ? { parsers: raw } : raw;
      if (!Array.isArray(config.parsers)) throw new Error('Missing parsers array');
      const existing = loadGmailParsers();
      const incoming = config.parsers;
      const merged = [...existing];
      incoming.forEach(p => {
        const idx = p.id
          ? merged.findIndex(x => x.id === p.id)
          : merged.findIndex(x => x.name === p.name);
        if (idx >= 0) merged[idx] = p; else merged.push(p);
      });
      saveGmailParsers(merged);
      if (Array.isArray(config.catMap)) {
        data.emailCatMap     = config.catMap;
        data.emailCatDefault = config.catDefault || 'Other';
        data._emailCatMapTs  = Date.now();
        saveData(data);
      }
      const added = incoming.filter(p => !existing.find(x => (p.id && x.id === p.id) || x.name === p.name)).length;
      const updated = incoming.length - added;
      showToast(`${added} added, ${updated} updated (${merged.length} total)`);
      renderEmailRulesSubTab();
    } catch (err) {
      showToast('Invalid parser config: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Rules Subtab ──────────────────────────────────────────────────────────────

function renderEmailRulesSubTab() {
  const el = document.getElementById('emailRulesContent');
  if (!el) return;
  const all      = loadGmailParsers();
  const expItems = all.map((p, i) => ({ p, i })).filter(x => (x.p.type || 'expense') !== 'event');
  const evItems  = all.map((p, i) => ({ p, i })).filter(x => x.p.type === 'event');

  function expCard({ p, i }) {
    return `
    <div style="background:var(--card);border-radius:12px;padding:14px 16px;margin-bottom:10px;border:1px solid var(--border)">
      <div class="row-between">
        <div style="font-weight:600;font-size:.95rem">${esc(p.name || 'Parser ' + (i + 1))}</div>
        <div style="display:flex;gap:8px">
          <button class="btn" style="font-size:.78rem;padding:4px 10px" onclick="openParserEditor(${i})">Edit</button>
          <button class="btn" style="font-size:.78rem;padding:4px 10px;color:var(--danger)" onclick="deleteParserAt(${i})">Delete</button>
        </div>
      </div>
      <div style="font-size:.8rem;color:var(--muted);margin-bottom:4px">Subject: <code class="code-tag">${esc(p.subjectContains || '')}</code></div>
      <div style="font-size:.78rem;color:var(--muted);display:grid;gap:2px;margin-top:4px">
        <div>Amount: <code class="code-tag">${esc(p.amount && p.amount.regex || '')}</code> gr ${esc(String(p.amount && p.amount.group != null ? p.amount.group : 1))}</div>
        <div>Date: <code class="code-tag">${esc(p.date && p.date.regex || '')}</code> <code class="code-tag">${esc(p.date && p.date.format || '')}</code></div>
        <div>Desc: <code class="code-tag">${esc(p.desc && p.desc.regex || '')}</code> gr ${esc(String(p.desc && p.desc.group != null ? p.desc.group : 1))}</div>
      </div>
    </div>`;
  }

  function evCard({ p, i }) {
    const dt = p.datetime || {};
    return `
    <div style="background:var(--card);border-radius:12px;padding:14px 16px;margin-bottom:10px;border:1px solid var(--border)">
      <div class="row-between">
        <div style="font-weight:600;font-size:.95rem">${esc(p.name || 'Parser ' + (i + 1))}</div>
        <div style="display:flex;gap:8px">
          <button class="btn" style="font-size:.78rem;padding:4px 10px" onclick="openEventParserEditor(${i})">Edit</button>
          <button class="btn" style="font-size:.78rem;padding:4px 10px;color:var(--danger)" onclick="deleteParserAt(${i})">Delete</button>
        </div>
      </div>
      <div style="font-size:.8rem;color:var(--muted);margin-bottom:4px">Subject: <code class="code-tag">${esc(p.subjectContains || '')}</code></div>
      <div style="font-size:.78rem;color:var(--muted);display:grid;gap:2px;margin-top:4px">
        <div>Title: <code class="code-tag">${esc(p.title && p.title.regex || '')}</code> gr ${esc(String(p.title && p.title.group != null ? p.title.group : 1))}</div>
        <div>Datetime: <code class="code-tag">${esc(dt.regex || '')}</code> <code class="code-tag">${esc(dt.dateFormat || '')}</code></div>
        <div style="padding-left:4px;color:var(--muted)">date gr ${esc(String(dt.dateGroup || 1))} · start gr ${esc(String(dt.startTimeGroup || 2))} · end gr ${esc(String(dt.endTimeGroup || 3))}</div>
        ${p.descItems && p.descItems.regex ? `<div>Items: <code class="code-tag">${esc(p.descItems.regex)}</code> name gr ${esc(String(p.descItems.nameGroup || 1))} qty gr ${esc(String(p.descItems.qtyGroup || 2))}</div>` : ''}
      </div>
    </div>`;
  }

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <div></div>
      <div style="display:flex;gap:8px">
        <button class="btn" style="font-size:.78rem;padding:5px 10px" onclick="triggerImportParsers()">Import</button>
        <button class="btn" style="font-size:.78rem;padding:5px 10px" onclick="exportParsers()">Export</button>
      </div>
    </div>
    <div class="section-heading">Expense Parsers</div>
    <div style="display:flex;justify-content:flex-end;margin:4px 0 8px">
      <button class="btn btn-primary" style="font-size:.82rem;padding:7px 14px" onclick="openParserEditor(-1)">+ Add</button>
    </div>
    ${expItems.length ? expItems.map(expCard).join('') : '<p style="font-size:.82rem;color:var(--muted);text-align:center;padding:8px 0">No expense parsers.</p>'}
    <div class="section-heading" style="margin-top:12px">Event Parsers</div>
    <div style="display:flex;justify-content:flex-end;margin:4px 0 8px">
      <button class="btn btn-primary" style="font-size:.82rem;padding:7px 14px" onclick="openEventParserEditor(-1)">+ Add</button>
    </div>
    ${evItems.length ? evItems.map(evCard).join('') : '<p style="font-size:.82rem;color:var(--muted);text-align:center;padding:8px 0">No event parsers.</p>'}`;
}

// ── Expense Parser Editor ─────────────────────────────────────────────────────

let editingParserIdx = -1;

function openParserEditor(idx) {
  editingParserIdx = idx;
  const parsers = loadGmailParsers();
  const p = idx >= 0 ? parsers[idx] : {
    name: '', subjectContains: '',
    amount: { regex: '', group: 1 },
    date:   { regex: '', format: 'DD/MM/YY' },
    desc:   { regex: '', group: 1 }
  };
  document.getElementById('parserEditorTitle').textContent    = idx >= 0 ? 'Edit Parser' : 'Add Parser';
  document.getElementById('parserName').value                 = p.name || '';
  document.getElementById('parserSubject').value              = p.subjectContains || '';
  document.getElementById('parserAmountRegex').value          = (p.amount && p.amount.regex) || '';
  document.getElementById('parserAmountGroup').value          = p.amount && p.amount.group != null ? p.amount.group : 1;
  document.getElementById('parserDateRegex').value            = (p.date && p.date.regex) || '';
  document.getElementById('parserDateFormat').value           = (p.date && p.date.format) || 'DD/MM/YY';
  document.getElementById('parserDescRegex').value            = (p.desc && p.desc.regex) || '';
  document.getElementById('parserDescGroup').value            = p.desc && p.desc.group != null ? p.desc.group : 1;
  openSheet('parserEditorSheet');
}

function saveParserEditor() {
  const parsers = loadGmailParsers();
  const existing = editingParserIdx >= 0 ? parsers[editingParserIdx] : null;
  const p = {
    id:              (existing && existing.id) || uid(),
    name:            document.getElementById('parserName').value.trim(),
    subjectContains: document.getElementById('parserSubject').value.trim(),
    amount: { regex: document.getElementById('parserAmountRegex').value.trim(), group: parseInt(document.getElementById('parserAmountGroup').value) || 1 },
    date:   { regex: document.getElementById('parserDateRegex').value.trim(),   format: document.getElementById('parserDateFormat').value.trim() },
    desc:   { regex: document.getElementById('parserDescRegex').value.trim(),   group: parseInt(document.getElementById('parserDescGroup').value) || 1 }
  };
  if (!p.name || !p.subjectContains) { showToast('Name and subject are required'); return; }
  if (editingParserIdx >= 0) parsers[editingParserIdx] = p;
  else parsers.push(p);
  saveGmailParsers(parsers);
  closeSheet();
  renderEmailRulesSubTab();
  showToast(editingParserIdx >= 0 ? 'Parser updated' : 'Parser added');
}

// ── Event Parser Editor ───────────────────────────────────────────────────────
// Uses the same datetime shape as the Apps Script:
// { type:"event", name, subjectContains,
//   title:    { regex, group },
//   datetime: { regex, dateGroup, startTimeGroup, endTimeGroup, dateFormat } }

let editingEventParserIdx = -1;

function openEventParserEditor(idx) {
  editingEventParserIdx = idx;
  const parsers = loadGmailParsers();
  const p  = idx >= 0 ? parsers[idx] : null;
  const dt = p && p.datetime  ? p.datetime  : {};
  const di = p && p.descItems ? p.descItems : {};
  document.getElementById('evParserEditorTitle').textContent    = idx >= 0 ? 'Edit Event Parser' : 'Add Event Parser';
  document.getElementById('evParserName').value                 = p ? p.name || '' : '';
  document.getElementById('evParserSubject').value              = p ? p.subjectContains || '' : '';
  document.getElementById('evParserTitleRegex').value           = (p && p.title && p.title.regex) || '';
  document.getElementById('evParserTitleGroup').value           = (p && p.title && p.title.group != null) ? p.title.group : 1;
  document.getElementById('evParserDtRegex').value              = dt.regex          || '';
  document.getElementById('evParserDtDateFormat').value         = dt.dateFormat     || 'D Mon YYYY';
  document.getElementById('evParserDtDateGroup').value          = dt.dateGroup      != null ? dt.dateGroup      : 1;
  document.getElementById('evParserDtStartGroup').value         = dt.startTimeGroup != null ? dt.startTimeGroup : 2;
  document.getElementById('evParserDtEndGroup').value           = dt.endTimeGroup   != null ? dt.endTimeGroup   : 3;
  document.getElementById('evParserDiRegex').value              = di.regex     || '';
  document.getElementById('evParserDiNameGroup').value          = di.nameGroup != null ? di.nameGroup : 1;
  document.getElementById('evParserDiQtyGroup').value           = di.qtyGroup  != null ? di.qtyGroup  : 2;
  openSheet('evParserEditorSheet');
}

function saveEventParserEditor() {
  const diRegex = document.getElementById('evParserDiRegex').value.trim();
  const parsers = loadGmailParsers();
  const existing = editingEventParserIdx >= 0 ? parsers[editingEventParserIdx] : null;
  const p = {
    id:              (existing && existing.id) || uid(),
    type:            'event',
    name:            document.getElementById('evParserName').value.trim(),
    subjectContains: document.getElementById('evParserSubject').value.trim(),
    title: {
      regex: document.getElementById('evParserTitleRegex').value.trim(),
      group: parseInt(document.getElementById('evParserTitleGroup').value) || 1
    },
    datetime: {
      regex:          document.getElementById('evParserDtRegex').value.trim(),
      dateFormat:     document.getElementById('evParserDtDateFormat').value.trim(),
      dateGroup:      parseInt(document.getElementById('evParserDtDateGroup').value)  || 1,
      startTimeGroup: parseInt(document.getElementById('evParserDtStartGroup').value) || 2,
      endTimeGroup:   parseInt(document.getElementById('evParserDtEndGroup').value)   || 3
    }
  };
  // Only include descItems if a regex is provided
  if (diRegex) {
    p.descItems = {
      regex:     diRegex,
      nameGroup: parseInt(document.getElementById('evParserDiNameGroup').value) || 1,
      qtyGroup:  parseInt(document.getElementById('evParserDiQtyGroup').value)  || 2
    };
  }
  if (!p.name || !p.subjectContains)  { showToast('Name and subject are required'); return; }
  if (!p.title.regex)                 { showToast('Title regex is required'); return; }
  if (!p.datetime.regex)              { showToast('Datetime regex is required'); return; }
  if (editingEventParserIdx >= 0) parsers[editingEventParserIdx] = p;
  else parsers.push(p);
  saveGmailParsers(parsers);
  closeSheet();
  renderEmailRulesSubTab();
  showToast(editingEventParserIdx >= 0 ? 'Event parser updated' : 'Event parser added');
}

function deleteParserAt(idx) {
  if (!confirm('Delete this parser?')) return;
  const parsers = loadGmailParsers();
  parsers.splice(idx, 1);
  saveGmailParsers(parsers);
  renderEmailRulesSubTab();
  showToast('Parser deleted');
}
