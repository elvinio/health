// ── MOE inbox ────────────────────────────────────────────────────────────────
// Read-only-ish list of items captured by the Android MOE Bridge app and ingested
// from Drive (see fetchMoeInbox in finance-drive.js). Items are immutable; the only
// action is delete, which tombstones the id (kept in data.moeInboxSeenIds) so the
// item never reappears on the next Drive fetch or device merge.

function moeRelativeDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(ts); that.setHours(0, 0, 0, 0);
  const days = Math.round((today - that) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return 'Today ' + time;
  if (days === 1) return 'Yesterday ' + time;
  if (days > 1 && days < 7) return days + ' days ago';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderMoeInbox() {
  const el = document.getElementById('moeList');
  if (!el) return;
  const items = (data.moeInbox || []).slice().sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
  if (!items.length) {
    el.innerHTML =
      '<div class="moe-empty">' +
      '<div class="moe-empty-icon"><span class="material-symbols-outlined">school</span></div>' +
      '<p>No MOE messages yet.</p>' +
      '<p class="moe-empty-hint">Captured by the MOE Bridge app on your phone and pulled in on Drive sync.</p>' +
      '</div>';
    return;
  }
  el.innerHTML = items.map(it => `
    <div class="moe-card">
      <div class="moe-card-head">
        <span class="moe-date">${esc(moeRelativeDate(it.capturedAt))}</span>
        <button class="moe-del" aria-label="Delete" onclick="deleteMoeItem('${esc(it.id)}')">
          <span class="material-symbols-outlined" aria-hidden="true">delete</span>
        </button>
      </div>
      ${it.title ? `<div class="moe-title">${esc(it.title)}</div>` : ''}
      ${it.text ? `<div class="moe-text">${esc(it.text)}</div>` : ''}
      <div class="moe-meta">${esc(it.screen || '')}${it.screen && it.pkg ? ' · ' : ''}${esc(it.pkg || '')}</div>
    </div>
  `).join('');
}

function deleteMoeItem(id) {
  if (!data.moeInbox) return;
  data.moeInbox = data.moeInbox.filter(i => i.id !== id);
  // Keep the id tombstoned so it is never re-ingested.
  if (!data.moeInboxSeenIds) data.moeInboxSeenIds = [];
  if (!data.moeInboxSeenIds.includes(id)) data.moeInboxSeenIds.push(id);
  saveData(data);
  renderMoeInbox();
  showToast('Deleted');
}

function clearMoeInbox() {
  if (!data.moeInbox || !data.moeInbox.length) return;
  if (!confirm('Clear all MOE messages? They will not be re-imported.')) return;
  if (!data.moeInboxSeenIds) data.moeInboxSeenIds = [];
  data.moeInbox.forEach(i => { if (!data.moeInboxSeenIds.includes(i.id)) data.moeInboxSeenIds.push(i.id); });
  data.moeInbox = [];
  saveData(data);
  renderMoeInbox();
  showToast('MOE inbox cleared');
}
