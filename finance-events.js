// ── Events ────────────────────────────────────────────────────────────────────
function eventToMs(ev) {
  if (!ev.startTime) return new Date(ev.startDate).getTime();
  let h = ev.startTime.hour % 12;
  if (ev.startTime.ampm === 'PM') h += 12;
  const [y, m, d] = ev.startDate.split('-').map(Number);
  return new Date(y, m - 1, d, h, ev.startTime.minute).getTime();
}

function fmtEventDateTime(ev) {
  const ms = eventToMs(ev);
  const datePart = new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const min = String(ev.startTime.minute).padStart(2, '0');
  return `${datePart} at ${ev.startTime.hour}:${min} ${ev.startTime.ampm}`;
}

function fmtEventCountdown(ev) {
  const days = Math.round((eventToMs(ev) - Date.now()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  if (days > 1 && days < 7) return `${days} days`;
  if (days >= 7 && days < 14) return '1 week';
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  if (days === -1) return '1 day ago';
  return `${Math.abs(days)} days ago`;
}

function getCurrentTermWeek() {
  const td = data.termDates || {};
  const terms = [1,2,3,4]
    .map(n => ({ label: `Term ${n}`, date: td['t'+n] }))
    .filter(t => t.date);
  if (!terms.length) return null;
  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let current = null;
  for (const t of terms) {
    const [y,m,d] = t.date.split('-').map(Number);
    const startMs = new Date(y, m-1, d).getTime();
    if (todayMs >= startMs) current = { label: t.label, startMs };
  }
  if (!current) return null;
  const week = Math.floor((todayMs - current.startMs) / (7 * 86400000)) + 1;
  return `${current.label}, Week ${week}`;
}

function renderTermWeekBanner() {
  const el = document.getElementById('termWeekBanner');
  if (el) el.style.display = 'none';
}

function syncEndDate() {
  const startEl = document.getElementById('evDate');
  const endEl = document.getElementById('evEndDate');
  if (startEl.value) endEl.value = startEl.value;
}

function renderEventTagFilterPills() {
  const bar = document.getElementById('eventFilterBar');
  const container = document.getElementById('eventTagFilterPills');
  if (!bar || !container) return;
  const tags = data.eventTags || [];
  if (!tags.length || eventViewMode === 'calendar') { bar.style.display = 'none'; return; }
  bar.style.display = '';
  container.innerHTML =
    `<button class="filter-pill${filterEventTag === null ? ' active' : ''}" onclick="setEventTagFilter(null)">All</button>` +
    tags.map(t => `<button class="filter-pill${filterEventTag === t ? ' active' : ''}" onclick="setEventTagFilter('${esc(t)}')">${esc(t)}</button>`).join('');
}

function setEventTagFilter(tag) {
  filterEventTag = tag;
  renderEventTagFilterPills();
  renderEventList();
}

function getMondayMs(dateMs) {
  const d = new Date(dateMs);
  const day = d.getDay();
  const daysToMon = day === 0 ? -6 : 1 - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysToMon).getTime();
}

const TAG_COLORS = ['#1a6b9e','#8b2252','#2d7a4f','#7a4d1a','#5a2d7a','#1a7a6b','#7a2d2d','#4d6b1a'];

function getTagColor(tag) {
  const tags = data.eventTags || [];
  const idx = tags.indexOf(tag);
  if (idx >= 0) return TAG_COLORS[idx % TAG_COLORS.length];
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
}

function renderEventItem(ev) {
  const ms = eventToMs(ev);
  const d = new Date(ms);
  const dayNum = d.getDate();
  const mon = d.toLocaleDateString(undefined, { month: 'short' });
  const min = String(ev.startTime.minute).padStart(2, '0');
  const timeFmt = `${ev.startTime.hour}:${min} ${ev.startTime.ampm}`;
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
  const tagBadges = (ev.tags || []).map(t => `<span class="event-tag-badge" style="background:${getTagColor(t)}">${esc(t)}</span>`).join('');

  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowD = new Date(); tomorrowD.setDate(tomorrowD.getDate() + 1);
  const tomorrowStr = tomorrowD.toISOString().slice(0, 10);
  const dayClass = ev.startDate === todayStr ? ' event-item-today' : ev.startDate === tomorrowStr ? ' event-item-tomorrow' : '';

  const isMultiDay = ev.endDate && ev.endDate !== ev.startDate;
  let dateDisplay, weekdayDisplay, endTimeLine = '';

  if (isMultiDay) {
    const endD = new Date(ev.endDate + 'T00:00:00');
    const endWeekday = endD.toLocaleDateString(undefined, { weekday: 'short' });
    dateDisplay = `${dayNum} ${mon}`;
    weekdayDisplay = `${weekday} to ${endWeekday}`;
    if (ev.endTime) {
      const endMin = String((ev.endTime).minute || 0).padStart(2, '0');
      endTimeLine = `<div class="event-end-time">${ev.endTime.hour}:${endMin} ${ev.endTime.ampm}</div>`;
    }
  } else {
    dateDisplay = `${dayNum} ${mon}`;
    weekdayDisplay = weekday;
    if (ev.endTime) {
      const endMin = String((ev.endTime).minute || 0).padStart(2, '0');
      endTimeLine = `<div class="event-end-time">to ${ev.endTime.hour}:${endMin} ${ev.endTime.ampm}</div>`;
    }
  }

  const emojiMatch = ev.title.match(/^(\p{Extended_Pictographic}[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{20E3}]*)\s*/u);
  const leadingEmoji = emojiMatch ? emojiMatch[1] : null;
  const titleText = emojiMatch ? ev.title.slice(emojiMatch[0].length) : ev.title;

  return `
  <div class="event-item${dayClass}" onclick="openEventSheet('${ev.id}')">
    <div class="event-row">
      <div class="event-date-col">
        <div class="event-date-display">${dateDisplay}</div>
        <div class="event-time-display">${timeFmt}</div>
        ${endTimeLine}
      </div>
      ${leadingEmoji ? `<div class="event-emoji-col">${leadingEmoji}</div>` : ''}
      <div class="event-middle">
        <div class="event-title">${esc(titleText)}</div>
        ${ev.description ? `<div class="event-desc-text">${esc(ev.description)}</div>` : ''}
        ${tagBadges ? `<div>${tagBadges}</div>` : ''}
        ${ev.reminderHours > 0 ? `<span class="event-reminder-badge">&#9200; ${ev.reminderHours}h before</span>` : ''}
      </div>
      <div class="event-weekday-right">${weekdayDisplay}</div>
    </div>
  </div>`;
}

function switchEventListSubTab(tab) {
  currentEventListSubTab = tab;
  ['upcoming', 'past'].forEach(t => {
    const btn = document.getElementById(`evListSubTab-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  renderEventList();
}

function renderEventList() {
  const el = document.getElementById('eventList');
  if (!el) return;
  renderTermWeekBanner();
  renderEventTagFilterPills();
  const todayStr = today();
  let events = (data.events || []).slice().sort((a, b) => eventToMs(a) - eventToMs(b));
  if (filterEventTag) events = events.filter(ev => (ev.tags || []).includes(filterEventTag));

  // upcoming: starts today or later, or multi-day ending today or later
  const upcoming = events.filter(ev => ev.startDate >= todayStr || (ev.endDate && ev.endDate >= todayStr));
  // past: started before today and ended before today
  const past = events.filter(ev => ev.startDate < todayStr && (!ev.endDate || ev.endDate < todayStr));

  if (!events.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">event</span></div>No events yet.<br>Tap + to add one.</div>`;
    return;
  }

  const currentMonMs = getMondayMs(Date.now());
  const renderWithWeekMarkers = arr => {
    let html = '';
    let lastMonMs = null;
    arr.forEach(ev => {
      const monMs = getMondayMs(eventToMs(ev));
      if (monMs !== lastMonMs) {
        lastMonMs = monMs;
        const monDate = new Date(monMs);
        const monLabel = monDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const weeksAway = Math.round((monMs - currentMonMs) / (7 * 86400000));
        const bracket = weeksAway === 1 ? ' (Next Week)' : weeksAway > 1 ? ` (${weeksAway} weeks)` : '';
        html += `<div class="week-marker">${monLabel}${bracket}</div>`;
      }
      html += renderEventItem(ev);
    });
    return html;
  };

  if (currentEventListSubTab === 'past') {
    if (!past.length) {
      el.innerHTML = `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">history</span></div>No past events.</div>`;
      return;
    }
    el.innerHTML = renderWithWeekMarkers(past.slice().reverse());
  } else {
    if (!upcoming.length) {
      el.innerHTML = `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">event</span></div>No upcoming events.<br>Tap + to add one.</div>`;
      return;
    }
    const termWeekLabel = getCurrentTermWeek() || 'Upcoming';
    el.innerHTML = `<div class="event-section-label">${termWeekLabel}</div>${renderWithWeekMarkers(upcoming)}`;
  }
}

function setEventView(mode) {
  eventViewMode = mode;
  document.getElementById('evViewList').classList.toggle('active', mode === 'list');
  document.getElementById('evViewCal').classList.toggle('active', mode === 'calendar');
  document.getElementById('evViewBus').classList.toggle('active', mode === 'bus');
  document.getElementById('evViewBusMap').classList.toggle('active', mode === 'busmap');
  document.getElementById('evViewNotes').classList.toggle('active', mode === 'notes');
  document.getElementById('eventListSubTabs').style.display = mode === 'list' ? '' : 'none';
  document.getElementById('eventList').style.display = mode === 'list' ? '' : 'none';
  document.getElementById('eventCalendar').style.display = mode === 'calendar' ? '' : 'none';
  document.getElementById('busPanel').style.display = mode === 'bus' ? '' : 'none';
  document.getElementById('busMapPanel').style.display = mode === 'busmap' ? '' : 'none';
  document.getElementById('notesPanel').style.display = mode === 'notes' ? '' : 'none';
  if (busPollingInterval) { clearInterval(busPollingInterval); busPollingInterval = null; }
  if (busMapPollingInterval) { clearInterval(busMapPollingInterval); busMapPollingInterval = null; }
  if (mode !== 'busmap') stopLocationTracking();
  renderEventTagFilterPills();
  if (mode === 'notes') renderNotesList();
  if (mode === 'calendar') renderEventCalendar();
  if (mode === 'bus') {
    renderBusPanel();
    busPollingInterval = setInterval(renderBusPanel, 60000);
  }
  if (mode === 'busmap') {
    loadLeaflet(function() {
      if (eventViewMode !== 'busmap') return;
      renderBusMapPanel();
      busMapPollingInterval = setInterval(refreshBusMapMarkers, 30000);
    });
  }
}

function getBusApiKey() { return localStorage.getItem(BUS_API_KEY_STORAGE) || ''; }
function saveBusApiKey(key) { localStorage.setItem(BUS_API_KEY_STORAGE, key.trim()); }

function busMinutes(isoStr) {
  if (!isoStr) return null;
  return Math.round((new Date(isoStr) - Date.now()) / 60000);
}

function busTimeLabel(mins) {
  if (mins === null) return null;
  if (mins <= 1) return 'Arr';
  return mins + ' min';
}

function busProxyFetch(target, apiKey, opts = {}) {
  const local = localStorage.getItem(BUS_PROXY_URL_STORAGE);
  // A proxy URL is required. We no longer fall back to the public corsproxy.io,
  // which would route the LTA AccountKey through a third party.
  if (!local) return Promise.reject(new Error('No bus proxy URL configured'));
  const token = localStorage.getItem(BUS_PROXY_TOKEN_STORAGE) || '';
  const base = local.replace(/\/$/, '');
  const url = token
    ? `${base}?token=${encodeURIComponent(token)}&url=${encodeURIComponent(target)}`
    : `${base}?url=${encodeURIComponent(target)}`;
  return fetch(url, {
    ...opts,
    headers: { AccountKey: apiKey, accept: 'application/json', ...opts.headers }
  });
}

async function fetchBusStop(stopCode, apiKey) {
  const target = `${BUS_API_URL}?BusStopCode=${stopCode}&_t=${Date.now()}`;
  const resp = await busProxyFetch(target, apiKey, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
  if (!resp.ok) throw new Error(resp.status);
  return resp.json();
}

async function renderBusPanel() {
  const panel = document.getElementById('busPanel');
  if (!panel || panel.style.display === 'none') return;
  const apiKey = getBusApiKey();
  const proxyUrl = localStorage.getItem(BUS_PROXY_URL_STORAGE) || '';

  if (!proxyUrl) {
    panel.innerHTML = `<div class="bus-api-setup">
      <div style="font-weight:600;margin-bottom:4px">Bus API Setup</div>
      <div style="font-size:.82rem;color:var(--muted);margin-bottom:8px">A proxy URL (Apps Script or local) is required — it forwards requests to LTA without exposing your key to a third party. The API key is optional: leave it blank if the proxy holds the key server-side, or enter it if your proxy expects it as a header.</div>
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:2px">Proxy URL</div>
      <input type="text" id="busProxyUrlInput" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(proxyUrl)}" />
      <div style="font-size:.78rem;color:var(--muted);margin-top:8px;margin-bottom:2px">Proxy token <span style="opacity:.6">(optional — set PROXY_TOKEN in Script Properties)</span></div>
      <input type="text" id="busProxyTokenInput" placeholder="your-secret-token" value="${esc(localStorage.getItem(BUS_PROXY_TOKEN_STORAGE) || '')}" />
      <div style="font-size:.78rem;color:var(--muted);margin-top:8px;margin-bottom:2px">LTA AccountKey <span style="opacity:.6">(optional — only if your proxy doesn't hold it)</span></div>
      <input type="text" id="busApiKeyInput" placeholder="LTA AccountKey (not needed with Apps Script proxy)" value="${esc(apiKey)}" />
      <button class="btn btn-primary btn-block" style="margin-top:8px" onclick="
        const k=document.getElementById('busApiKeyInput').value.trim();
        const p=document.getElementById('busProxyUrlInput').value.trim();
        const t=document.getElementById('busProxyTokenInput').value.trim();
        localStorage.setItem(BUS_PROXY_URL_STORAGE,p);
        localStorage.setItem(BUS_PROXY_TOKEN_STORAGE,t);
        if(k) saveBusApiKey(k);
        if(p) renderBusPanel();
      ">Save &amp; Load</button>
    </div>`;
    return;
  }

  const container = document.getElementById('busStopsContainer');
  if (!container) {
    panel.innerHTML = `<div class="bus-refresh-row">
      <span class="bus-last-updated" id="busLastUpdated">Fetching…</span>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="bus-refresh-btn" onclick="saveBusApiKey('');localStorage.removeItem(BUS_PROXY_URL_STORAGE);localStorage.removeItem(BUS_PROXY_TOKEN_STORAGE);renderBusPanel()" style="font-size:.75rem">Settings</button>
        <button class="bus-refresh-btn" onclick="renderBusPanel()">
          <span class="material-symbols-outlined" style="font-size:.9rem">refresh</span> Refresh
        </button>
      </div>
    </div>
    <div id="busStopsContainer"><div style="color:var(--muted);text-align:center;padding:24px">Loading…</div></div>`;
  }

  const results = await Promise.allSettled(
    BUS_STOPS.map(stop => fetchBusStop(stop.code, apiKey))
  );

  const cont = document.getElementById('busStopsContainer');
  if (!cont) return;

  cont.innerHTML = BUS_STOPS.map((stop, i) => {
    const result = results[i];
    if (result.status === 'rejected') {
      return `<div class="bus-stop-card">
        <div class="bus-stop-header">${stop.name} <span style="font-weight:400;text-transform:none">(${stop.code})</span></div>
        <div style="color:var(--muted);font-size:.82rem">Failed to load</div>
      </div>`;
    }
    const serviceMap = {};
    (result.value.Services || []).forEach(s => { serviceMap[s.ServiceNo] = s; });
    const rows = stop.services.map(svc => {
      const s = serviceMap[svc];
      let chips = '';
      if (!s) {
        chips = `<span class="bus-time-chip no-data">—</span>`;
      } else {
        [s.NextBus, s.NextBus2].forEach(nb => {
          const mins = busMinutes(nb && nb.EstimatedArrival);
          if (mins === null || mins < -1) return;
          const label = busTimeLabel(mins);
          chips += `<span class="bus-time-chip ${mins <= 1 ? 'arriving' : ''}">${label}</span>`;
        });
        if (!chips) chips = `<span class="bus-time-chip no-data">No data</span>`;
      }
      return `<div class="bus-route-row">
        <span class="bus-route-badge">${svc}</span>
        <div class="bus-time-chips">${chips}</div>
      </div>`;
    }).join('');
    return `<div class="bus-stop-card">
      <div class="bus-stop-header">${stop.name} <span style="font-weight:400;text-transform:none">(${stop.code})</span></div>
      ${rows}
    </div>`;
  }).join('');

  const upd = document.getElementById('busLastUpdated');
  if (upd) upd.textContent = 'Updated ' + new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
}

// ── Bus Map ──────────────────────────────────────────────────────────────────
let busMapInstance = null;
let busMapPollingInterval = null;
let busMapMarkers = [];
let busMapPrevPositions = {};
let busMapLocationMarker = null;
let busMapLocationWatcher = null;
let busMapStopMarkers = [];
const BUS_MAP_DEFAULT = [1.3201, 103.9024];
const BUS_MAP_CENTER_KEY = 'busMapCenter';

function getBusMapCenter() {
  const saved = localStorage.getItem(BUS_MAP_CENTER_KEY);
  if (saved) {
    const parts = saved.split(',').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return parts;
  }
  return BUS_MAP_DEFAULT;
}

async function fetchBusStopCoords(apiKey) {
  const cacheKey = 'finance:busStopCoords';
  const cached = JSON.parse(localStorage.getItem(cacheKey) || '{}');
  const missing = BUS_STOPS.map(s => s.code).filter(c => !cached[c]);
  if (!missing.length) return cached;

  // Fire all pages in parallel (~21 pages × 500 stops covers the full LTA dataset).
  // Much faster than the previous serial loop on first load.
  const BASE = 'https://datamall2.mytransport.sg/ltaodataservice/BusStops';
  const skips = Array.from({ length: 21 }, (_, i) => i * 500);
  const pages = await Promise.allSettled(
    skips.map(skip =>
      busProxyFetch(`${BASE}?$skip=${skip}`, apiKey)
        .then(r => r.json())
        .catch(() => null)
    )
  );

  pages.forEach(result => {
    if (result.status !== 'fulfilled' || !result.value?.value?.length) return;
    result.value.value.forEach(s => {
      if (missing.includes(s.BusStopCode)) {
        cached[s.BusStopCode] = { lat: s.Latitude, lng: s.Longitude, name: s.Description };
      }
    });
  });

  localStorage.setItem(cacheKey, JSON.stringify(cached));
  return cached;
}

function placeLocationMarker(lat, lng) {
  if (!busMapInstance) return;
  if (busMapLocationMarker) busMapLocationMarker.remove();
  const icon = L.divIcon({
    className: '',
    html: '<div class="bus-map-location"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
  busMapLocationMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(busMapInstance);
  busMapLocationMarker.bindPopup('You are here');
}

function startLocationTracking() {
  if (!navigator.geolocation || !busMapInstance) return;
  stopLocationTracking();
  busMapLocationWatcher = navigator.geolocation.watchPosition(
    pos => placeLocationMarker(pos.coords.latitude, pos.coords.longitude),
    () => {}, { enableHighAccuracy: true, maximumAge: 10000 }
  );
}

function stopLocationTracking() {
  if (busMapLocationWatcher !== null) {
    navigator.geolocation.clearWatch(busMapLocationWatcher);
    busMapLocationWatcher = null;
  }
  if (busMapLocationMarker) { busMapLocationMarker.remove(); busMapLocationMarker = null; }
}

async function placeBusStopMarkers(apiKey) {
  if (!busMapInstance) return;
  busMapStopMarkers.forEach(m => m.remove());
  busMapStopMarkers = [];
  let coords;
  try { coords = await fetchBusStopCoords(apiKey); } catch { return; }
  BUS_STOPS.forEach(stop => {
    const c = coords[stop.code];
    if (!c) return;
    const icon = L.divIcon({
      className: '',
      html: `<div class="bus-stop-icon" title="${esc(stop.name)}"><span class="material-symbols-outlined" style="font-size:1rem">directions_bus</span></div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 26]
    });
    const marker = L.marker([c.lat, c.lng], { icon, zIndexOffset: 500 }).addTo(busMapInstance);
    marker.bindPopup(`<b>${esc(stop.name)}</b><br>Stop ${stop.code}<br>Routes: ${stop.services.join(', ')}`);
    busMapStopMarkers.push(marker);
  });
}

function computeBearing(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function loadLeaflet(cb) {
  if (window.L) { cb(); return; }
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(css);
  const js = document.createElement('script');
  js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  js.onload = cb;
  document.head.appendChild(js);
}

function renderBusMapPanel() {
  const panel = document.getElementById('busMapPanel');
  if (!panel || panel.style.display === 'none') return;
  const apiKey = getBusApiKey();
  const proxyUrl = localStorage.getItem(BUS_PROXY_URL_STORAGE) || '';

  if (!proxyUrl) {
    panel.innerHTML = `<div class="bus-api-setup">
      <div style="font-weight:600;margin-bottom:4px">Bus API Setup</div>
      <div style="font-size:.82rem;color:var(--muted);margin-bottom:8px">A proxy URL (Apps Script or local) is required — it forwards requests to LTA without exposing your key to a third party. The API key is optional: leave it blank if the proxy holds the key server-side, or enter it if your proxy expects it as a header.</div>
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:2px">Proxy URL</div>
      <input type="text" id="busMapProxyUrlInput" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(proxyUrl)}" />
      <div style="font-size:.78rem;color:var(--muted);margin-top:8px;margin-bottom:2px">Proxy token <span style="opacity:.6">(optional — set PROXY_TOKEN in Script Properties)</span></div>
      <input type="text" id="busMapProxyTokenInput" placeholder="your-secret-token" value="${esc(localStorage.getItem(BUS_PROXY_TOKEN_STORAGE) || '')}" />
      <div style="font-size:.78rem;color:var(--muted);margin-top:8px;margin-bottom:2px">LTA AccountKey <span style="opacity:.6">(optional — only if your proxy doesn't hold it)</span></div>
      <input type="text" id="busMapApiKeyInput" placeholder="LTA AccountKey (not needed with Apps Script proxy)" value="${esc(apiKey)}" />
      <button class="btn btn-primary btn-block" style="margin-top:8px" onclick="
        const k=document.getElementById('busMapApiKeyInput').value.trim();
        const p=document.getElementById('busMapProxyUrlInput').value.trim();
        const t=document.getElementById('busMapProxyTokenInput').value.trim();
        localStorage.setItem(BUS_PROXY_URL_STORAGE,p);
        localStorage.setItem(BUS_PROXY_TOKEN_STORAGE,t);
        if(k) saveBusApiKey(k);
        if(p) renderBusMapPanel();
      ">Save &amp; Load</button>
    </div>`;
    return;
  }

  // If map already initialised, just refresh markers and re-check size
  if (busMapInstance) {
    setTimeout(() => busMapInstance.invalidateSize(), 50);
    startLocationTracking();
    refreshBusMapMarkers();
    return;
  }

  const center = getBusMapCenter();
  panel.innerHTML = `
    <div class="bus-map-controls">
      <input type="text" id="busMapCoordInput" class="bus-map-coord-input"
        placeholder="lat, lng  e.g. 1.3201, 103.9024"
        value="${center[0].toFixed(4)}, ${center[1].toFixed(4)}" />
      <button class="bus-refresh-btn" title="Centre map" onclick="busMapSetCenter()">
        <span class="material-symbols-outlined" style="font-size:.95rem">my_location</span>
      </button>
      <button class="bus-refresh-btn" title="Refresh" onclick="refreshBusMapMarkers()">
        <span class="material-symbols-outlined" style="font-size:.95rem">refresh</span>
      </button>
    </div>
    <div id="busMapContainer"></div>
    <div class="bus-refresh-row" style="margin-top:8px">
      <span class="bus-last-updated" id="busMapLastUpdated">Fetching…</span>
      <button class="bus-refresh-btn" onclick="saveBusApiKey('');localStorage.removeItem(BUS_PROXY_URL_STORAGE);localStorage.removeItem(BUS_PROXY_TOKEN_STORAGE);busMapInstance=null;busMapMarkers=[];busMapPrevPositions={};renderBusMapPanel()" style="font-size:.75rem">Settings</button>
    </div>`;

  busMapPrevPositions = {};
  busMapInstance = L.map('busMapContainer', { zoomControl: true }).setView(center, 15);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19, minZoom: 11
  }).addTo(busMapInstance);
  busMapInstance.on('moveend', () => {
    const c = busMapInstance.getCenter();
    localStorage.setItem(BUS_MAP_CENTER_KEY, `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`);
  });
  setTimeout(() => busMapInstance.invalidateSize(), 50);

  startLocationTracking();
  placeBusStopMarkers(apiKey);
  refreshBusMapMarkers();
}

function busMapSetCenter() {
  if (!busMapInstance) return;
  const raw = (document.getElementById('busMapCoordInput') || {}).value || '';
  const parts = raw.split(',').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    busMapInstance.setView([parts[0], parts[1]], 15);
  }
}

async function refreshBusMapMarkers() {
  if (!busMapInstance) return;
  const apiKey = getBusApiKey();
  if (!apiKey) return;

  // Remove old markers
  busMapMarkers.forEach(m => m.remove());
  busMapMarkers = [];

  const results = await Promise.allSettled(
    BUS_STOPS.map(stop => fetchBusStop(stop.code, apiKey))
  );

  const seen = new Set();
  BUS_STOPS.forEach((stop, i) => {
    const res = results[i];
    if (res.status !== 'fulfilled') return;
    (res.value.Services || []).forEach(svc => {
      if (!stop.services.includes(svc.ServiceNo)) return;
      [svc.NextBus, svc.NextBus2].forEach((nb, busIdx) => {
        if (!nb) return;
        const lat = parseFloat(nb.Latitude);
        const lng = parseFloat(nb.Longitude);
        if (!lat || !lng) return;
        const key = `${svc.ServiceNo}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
        if (seen.has(key)) return;
        seen.add(key);

        const posKey = `${stop.code}|${svc.ServiceNo}|${busIdx}`;
        const prev = busMapPrevPositions[posKey];
        let arrowHtml = prev?.arrowHtml || '';
        if (prev && (Math.abs(prev.lat - lat) > 0.0001 || Math.abs(prev.lng - lng) > 0.0001)) {
          const bearing = computeBearing(prev.lat, prev.lng, lat, lng);
          arrowHtml = `<svg class="bus-arrow" width="10" height="13" viewBox="0 0 10 13" style="transform:rotate(${bearing.toFixed(0)}deg)" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><polyline points="1,8 5,2 9,8"/><polyline points="1,13 5,7 9,13"/></svg>`;
        }
        busMapPrevPositions[posKey] = { lat, lng, arrowHtml };

        const mins = busMinutes(nb.EstimatedArrival);
        const arriving = mins !== null && mins <= 1;
        const icon = L.divIcon({
          className: '',
          html: `<div class="bus-map-marker${arriving ? ' arriving' : ''}">${svc.ServiceNo}${arrowHtml}</div>`,
          iconSize: null,
          iconAnchor: [22, 13]
        });
        const marker = L.marker([lat, lng], { icon }).addTo(busMapInstance);
        const timeStr = mins === null ? '' : arriving ? 'Arriving now' : `~${mins} min`;
        marker.bindPopup(`<b>Bus ${svc.ServiceNo}</b>${timeStr ? '<br>' + timeStr : ''}`);
        busMapMarkers.push(marker);
      });
    });
  });

  const upd = document.getElementById('busMapLastUpdated');
  if (upd) upd.textContent =
    'Updated ' + new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' }) +
    ' · ' + busMapMarkers.length + (busMapMarkers.length === 1 ? ' bus' : ' buses');
}

function calPrev() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderEventCalendar();
}

function calNext() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderEventCalendar();
}

function renderEventCalendar() {
  const el = document.getElementById('eventCalendar');
  if (!el) return;
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const _tn = new Date();
  const todayStr = `${_tn.getFullYear()}-${String(_tn.getMonth()+1).padStart(2,'0')}-${String(_tn.getDate()).padStart(2,'0')}`;
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay = new Date(calYear, calMonth + 1, 0);

  // Monday-based start offset (Mon=0 … Sun=6)
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  // Build map: dateStr -> events active on that day
  const evByDate = {};
  (data.events || []).forEach(ev => {
    let d = new Date(ev.startDate + 'T00:00:00');
    const endD = new Date((ev.endDate || ev.startDate) + 'T00:00:00');
    while (d <= endD) {
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (!evByDate[key]) evByDate[key] = [];
      evByDate[key].push(ev);
      d.setDate(d.getDate() + 1);
    }
  });

  const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const headerRow = DAYS.map(d => `<div class="cal-day-header">${d}</div>`).join('');

  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-day other-month"></div>`;

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayEvs = evByDate[dateStr] || [];
    const isToday = dateStr === todayStr;
    let cls = 'cal-day' + (isToday ? ' today' : '') + (dayEvs.length ? ' has-events' : '');
    let chips = dayEvs.slice(0, 2).map(ev => `<div class="cal-ev-chip">${esc(ev.title)}</div>`).join('');
    if (dayEvs.length > 2) chips += `<div class="cal-ev-more">+${dayEvs.length - 2}</div>`;
    const onclick = dayEvs.length ? `showCalDay('${dateStr}')` : '';
    cells += `<div class="${cls}" onclick="${onclick}"><div class="cal-day-num">${day}</div>${chips}</div>`;
  }

  const total = startDow + lastDay.getDate();
  const trailing = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 0; i < trailing; i++) cells += `<div class="cal-day other-month"></div>`;

  el.innerHTML = `
    <div class="cal-nav">
      <button class="cal-nav-btn" onclick="calPrev()">‹</button>
      <div class="cal-month-label">${MONTHS[calMonth]} ${calYear}</div>
      <button class="cal-nav-btn" onclick="calNext()">›</button>
    </div>
    <div class="cal-grid">${headerRow}${cells}</div>
    <div id="calDayDetail"></div>`;
}

function showCalDay(dateStr) {
  const detail = document.getElementById('calDayDetail');
  if (!detail) return;
  const evs = (data.events || []).filter(ev => {
    const start = ev.startDate;
    const end = ev.endDate || ev.startDate;
    return dateStr >= start && dateStr <= end;
  }).sort((a, b) => eventToMs(a) - eventToMs(b));
  if (!evs.length) { detail.innerHTML = ''; return; }
  const d = new Date(dateStr + 'T00:00:00');
  const dateLabel = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const items = evs.map(ev => {
    const min = String(ev.startTime.minute).padStart(2, '0');
    const timeFmt = `${ev.startTime.hour}:${min} ${ev.startTime.ampm}`;
    const tagBadges = (ev.tags || []).map(t => `<span class="event-tag-badge">${esc(t)}</span>`).join('');
    return `<div class="event-item" onclick="openEventSheet('${ev.id}')">
      <div class="event-row">
        <div class="event-middle">
          <div class="event-title">${esc(ev.title)}</div>
          ${ev.description ? `<div class="event-desc-text">${esc(ev.description)}</div>` : ''}
          ${tagBadges ? `<div>${tagBadges}</div>` : ''}
        </div>
        <div class="event-date-col">
          <div class="event-time-display">${timeFmt}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  detail.innerHTML = `<div class="cal-day-modal"><div class="cal-day-modal-title">${dateLabel}</div>${items}</div>`;
}

function timeObjTo24h(t) {
  let h = t.hour % 12;
  if (t.ampm === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

function time24ToObj(val) {
  if (!val) return { hour: 12, minute: 0, ampm: 'AM' };
  const [h24, m] = val.split(':').map(Number);
  const ampm = h24 < 12 ? 'AM' : 'PM';
  let h = h24 % 12;
  if (h === 0) h = 12;
  return { hour: h, minute: m, ampm };
}

function openEventSheet(id) {
  const form = document.getElementById('eventForm');
  form.reset();
  document.getElementById('eventId').value = '';
  document.getElementById('evDate').value = today();
  document.getElementById('evDeleteBtn').style.display = 'none';

  // Defaults: start 9 AM, end 6 PM
  document.getElementById('evTime').value = '09:00';
  document.getElementById('evEndDate').value = today();
  document.getElementById('evEndTime').value = '18:00';
  document.getElementById('evReminder').value = '0';

  // Tags field
  const tags = data.eventTags || [];
  const tagsField = document.getElementById('evTagsField');
  const tagPills = document.getElementById('evTagPills');
  if (tags.length) {
    tagsField.style.display = '';
    tagPills.innerHTML = tags.map(t =>
      `<span class="tag-toggle-pill" data-tag="${esc(t)}" onclick="toggleEventTagPill(this)">${esc(t)}</span>`
    ).join('');
  } else {
    tagsField.style.display = 'none';
  }

  if (id) {
    const ev = (data.events || []).find(e => e.id === id);
    if (!ev) return;
    document.getElementById('eventSheetTitle').textContent = 'Edit Event';
    document.getElementById('eventId').value = id;
    document.getElementById('evTitle').value = ev.title;
    document.getElementById('evDesc').value = ev.description || '';
    document.getElementById('evDate').value = ev.startDate;
    document.getElementById('evTime').value = timeObjTo24h(ev.startTime);
    document.getElementById('evEndDate').value = ev.endDate || ev.startDate;
    if (ev.endTime) document.getElementById('evEndTime').value = timeObjTo24h(ev.endTime);
    document.getElementById('evReminder').value = ev.reminderHours;
    if (tags.length) {
      const evTags = ev.tags || [];
      tagPills.querySelectorAll('.tag-toggle-pill').forEach(pill => {
        if (evTags.includes(pill.dataset.tag)) pill.classList.add('selected');
      });
    }
    document.getElementById('evDeleteBtn').style.display = '';
  } else {
    document.getElementById('eventSheetTitle').textContent = 'Add Event';
  }
  openSheet('eventSheet');
  setTimeout(() => document.getElementById('evTitle').focus(), 350);
}

function toggleEventTagPill(el) {
  el.classList.toggle('selected');
}

document.getElementById('eventForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('eventId').value;
  const reminderHours = parseFloat(document.getElementById('evReminder').value) || 0;
  const selectedTags = [...document.getElementById('evTagPills').querySelectorAll('.tag-toggle-pill.selected')]
    .map(el => el.dataset.tag);
  const ev = {
    id: id || uid(),
    title: document.getElementById('evTitle').value.trim(),
    description: document.getElementById('evDesc').value.trim(),
    startDate: document.getElementById('evDate').value,
    startTime: time24ToObj(document.getElementById('evTime').value),
    endDate: document.getElementById('evEndDate').value || null,
    endTime: time24ToObj(document.getElementById('evEndTime').value),
    tags: selectedTags,
    reminderHours,
    _ts: Date.now()
  };
  if (!data.events) data.events = [];
  if (id) {
    const idx = data.events.findIndex(e => e.id === id);
    if (idx >= 0) data.events[idx] = ev; else data.events.push(ev);
  } else {
    data.events.push(ev);
  }
  saveData(data);
  closeSheet();
  renderEventList();
  if (eventViewMode === 'calendar') renderEventCalendar();
  scheduleEventReminders();
  if (reminderHours > 0) requestNotificationPermission();
  showToast(id ? 'Event updated' : 'Event added');
});

function deleteEvent() {
  const id = document.getElementById('eventId').value;
  if (!id || !confirm('Delete this event?')) return;
  data._deletedIds.push(id);
  data.events = (data.events || []).filter(e => e.id !== id);
  saveData(data);
  closeSheet();
  renderEventList();
  if (eventViewMode === 'calendar') renderEventCalendar();
  scheduleEventReminders();
  showToast('Event deleted');
}

// ── Notifications ─────────────────────────────────────────────────────────────
let _reminderTimeouts = [];

function clearReminderTimeouts() {
  _reminderTimeouts.forEach(t => clearTimeout(t));
  _reminderTimeouts = [];
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
    scheduleEventReminders();
  }
}

function scheduleEventReminders() {
  clearReminderTimeouts();
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  const MAX_DELAY = 7 * 24 * 3600 * 1000;
  (data.events || []).forEach(ev => {
    if (!ev.reminderHours) return;
    const fireMs = eventToMs(ev) - ev.reminderHours * 3600 * 1000;
    const delay = fireMs - now;
    if (delay <= 0 || delay > MAX_DELAY) return;
    const min = String(ev.startTime.minute).padStart(2, '0');
    const timeStr = `${ev.startTime.hour}:${min} ${ev.startTime.ampm}`;
    const t = setTimeout(() => {
      const body = `Starts at ${timeStr}${ev.description ? ' — ' + ev.description : ''}`;
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg =>
          reg.showNotification(ev.title, { body, icon: '/health/icons/icon-192.png', tag: 'event-' + ev.id })
        ).catch(() => new Notification(ev.title, { body }));
      } else {
        new Notification(ev.title, { body });
      }
    }, delay);
    _reminderTimeouts.push(t);
  });
}

// ── Notes ─────────────────────────────────────────────────────────────────────
function renderNotesList() {
  const el = document.getElementById('notesPanel');
  if (!el) return;
  const notes = (data.notes || []).slice().sort((a, b) => (b._updatedAt || 0) - (a._updatedAt || 0));
  if (!notes.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">description</span></div>No notes yet.<br>Tap + to add one.</div>`;
    return;
  }
  el.innerHTML = notes.map(n => {
    const ts = n._updatedAt ? new Date(n._updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const preview = (n.content || '').split('\n').find(l => l.trim()) || '';
    return `<div class="note-item" onclick="openNoteSheet('${n.id}')">
      <div class="note-item-header">
        <div class="note-item-title">${esc(n.title)}</div>
        <div class="note-item-date">${ts}</div>
      </div>
      ${preview ? `<div class="note-item-preview">${esc(preview)}</div>` : ''}
    </div>`;
  }).join('');
}

function openNoteSheet(id) {
  document.getElementById('noteForm').reset();
  document.getElementById('noteId').value = '';
  document.getElementById('noteDeleteBtn').style.display = 'none';
  document.getElementById('noteUpdatedAt').textContent = '';

  if (id) {
    const note = (data.notes || []).find(n => n.id === id);
    if (!note) return;
    document.getElementById('noteSheetTitle').textContent = 'Edit Note';
    document.getElementById('noteId').value = id;
    document.getElementById('noteTitle').value = note.title;
    document.getElementById('noteContent').value = note.content || '';
    if (note._updatedAt) {
      document.getElementById('noteUpdatedAt').textContent =
        'Updated ' + new Date(note._updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    document.getElementById('noteDeleteBtn').style.display = '';
  } else {
    document.getElementById('noteSheetTitle').textContent = 'Add Note';
  }
  openSheet('noteSheet');
  setTimeout(() => document.getElementById('noteTitle').focus(), 350);
}

document.getElementById('noteForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('noteId').value;
  const note = {
    id: id || uid(),
    title: document.getElementById('noteTitle').value.trim(),
    content: document.getElementById('noteContent').value,
    _updatedAt: Date.now()
  };
  if (!data.notes) data.notes = [];
  if (id) {
    const idx = data.notes.findIndex(n => n.id === id);
    if (idx >= 0) data.notes[idx] = note; else data.notes.push(note);
  } else {
    data.notes.push(note);
  }
  saveData(data);
  closeSheet();
  renderNotesList();
  showToast(id ? 'Note updated' : 'Note saved');
});

function deleteNote() {
  const id = document.getElementById('noteId').value;
  if (!id || !confirm('Delete this note?')) return;
  if (!data._deletedIds) data._deletedIds = [];
  data._deletedIds.push(id);
  data.notes = (data.notes || []).filter(n => n.id !== id);
  saveData(data);
  closeSheet();
  renderNotesList();
  showToast('Note deleted');
}

