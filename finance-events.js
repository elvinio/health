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
  if (!ev.startTime) return datePart;
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
  const timeFmt = ev.startTime
    ? `${ev.startTime.hour}:${String(ev.startTime.minute).padStart(2, '0')} ${ev.startTime.ampm}`
    : 'All day';
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
  const searchBar = document.getElementById('eventSearchBar');
  const searchInput = document.getElementById('eventSearchInput');
  if (searchBar) searchBar.style.display = tab === 'past' ? '' : 'none';
  if (tab !== 'past') { eventSearchQuery = ''; if (searchInput) searchInput.value = ''; }
  renderEventList();
}

function onEventSearch(val) {
  eventSearchQuery = val.trim().toLowerCase();
  renderEventList();
}

function renderEventList() {
  const el = document.getElementById('eventList');
  if (!el) return;
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
    const q = eventSearchQuery;
    const filtered = q
      ? past.filter(ev =>
          ev.title.toLowerCase().includes(q) ||
          (ev.description || '').toLowerCase().includes(q) ||
          (ev.tags || []).some(t => t.toLowerCase().includes(q))
        )
      : past;
    if (!filtered.length) {
      el.innerHTML = q
        ? `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">search</span></div>No past events match "${esc(q)}".</div>`
        : `<div class="empty-state"><div class="icon"><span class="material-symbols-outlined">history</span></div>No past events.</div>`;
      return;
    }
    el.innerHTML = renderWithWeekMarkers(filtered.slice().reverse());
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
  document.getElementById('evViewRain').classList.toggle('active', mode === 'rain');
  document.getElementById('page-events').classList.toggle('cal-mode', mode === 'calendar');
  document.getElementById('eventListSubTabs').style.display = mode === 'list' ? '' : 'none';
  document.getElementById('eventList').style.display = mode === 'list' ? '' : 'none';
  document.getElementById('eventCalendar').style.display = mode === 'calendar' ? '' : 'none';
  document.getElementById('busPanel').style.display = mode === 'bus' ? '' : 'none';
  document.getElementById('busMapPanel').style.display = mode === 'busmap' ? '' : 'none';
  document.getElementById('rainPanel').style.display = mode === 'rain' ? '' : 'none';
  if (busPollingInterval) { clearInterval(busPollingInterval); busPollingInterval = null; }
  if (busMapPollingInterval) { clearInterval(busMapPollingInterval); busMapPollingInterval = null; }
  if (rainPollingInterval) { clearInterval(rainPollingInterval); rainPollingInterval = null; }
  if (rainAnimTimer) rainToggleAnim(); // stops the loop and resets the play icon
  if (mode !== 'busmap' && mode !== 'rain') stopLocationTracking();
  renderEventTagFilterPills();
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
  if (mode === 'rain') {
    loadLeaflet(function() {
      if (eventViewMode !== 'rain') return;
      renderRainPanel();
      rainPollingInterval = setInterval(refreshRainFrames, 300000);
    });
  }
}

function busMinutes(isoStr) {
  if (!isoStr) return null;
  return Math.round((new Date(isoStr) - Date.now()) / 60000);
}

function busTimeLabel(mins) {
  if (mins === null) return null;
  if (mins <= 1) return 'Arr';
  return mins + ' min';
}


async function fetchAllBusStops() {
  const proxyUrl = localStorage.getItem(BUS_PROXY_URL_STORAGE);
  if (!proxyUrl) throw new Error('No bus proxy URL configured');
  const token = localStorage.getItem(BUS_PROXY_TOKEN_STORAGE) || '';
  const stops = BUS_STOPS.map(s => s.code).join(',');
  let url = `${proxyUrl.replace(/\/$/, '')}?action=BusArrival&stops=${encodeURIComponent(stops)}&_t=${Date.now()}`;
  if (token) url += `&token=${encodeURIComponent(token)}`;
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(resp.status);
  return resp.json(); // { stopCode: { Services: [...] }, ... }
}

// Shared Bus API-setup form markup, used by both the bus arrivals panel and the
// bus map panel. `idPrefix` namespaces the input ids ('bus' vs 'busMap') and
// `reloadFn` is the name of the render function to call after saving.
function busApiSetupHtml(idPrefix, reloadFn) {
  const proxyUrl = localStorage.getItem(BUS_PROXY_URL_STORAGE) || '';
  const token = localStorage.getItem(BUS_PROXY_TOKEN_STORAGE) || '';
  return `<div class="bus-api-setup">
    <div style="font-weight:600;margin-bottom:4px">Bus API Setup</div>
    <div style="font-size:.82rem;color:var(--muted);margin-bottom:8px">Apps Script web app URL — the LTA API key lives in Script Properties server-side.</div>
    <div style="font-size:.78rem;color:var(--muted);margin-bottom:2px">Proxy URL</div>
    <input type="text" id="${idPrefix}ProxyUrlInput" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(proxyUrl)}" />
    <div style="font-size:.78rem;color:var(--muted);margin-top:8px;margin-bottom:2px">Proxy token <span style="opacity:.6">(optional — set PROXY_TOKEN in Script Properties)</span></div>
    <input type="text" id="${idPrefix}ProxyTokenInput" placeholder="your-secret-token" value="${esc(token)}" />
    <button class="btn btn-primary btn-block" style="margin-top:8px" onclick="
      const p=document.getElementById('${idPrefix}ProxyUrlInput').value.trim();
      const t=document.getElementById('${idPrefix}ProxyTokenInput').value.trim();
      localStorage.setItem(BUS_PROXY_URL_STORAGE,p);
      localStorage.setItem(BUS_PROXY_TOKEN_STORAGE,t);
      data.busProxyUrl=p; data.busProxyToken=t; data._busProxyTs=Date.now(); saveData(data);
      ${reloadFn}();
    ">Save &amp; Load</button>
  </div>`;
}

function showBusSettings() {
  const panel = document.getElementById('busPanel');
  if (panel) panel.innerHTML = busApiSetupHtml('bus', 'renderBusPanel');
}

function showBusMapSettings() {
  stopLocationTracking();
  if (busMapInstance) { busMapInstance.remove(); busMapInstance = null; }
  locationMap = null;
  busMapMarkers = []; busMapPrevPositions = {};
  const panel = document.getElementById('busMapPanel');
  if (panel) panel.innerHTML = busApiSetupHtml('busMap', 'renderBusMapPanel');
}

async function renderBusPanel() {
  const panel = document.getElementById('busPanel');
  if (!panel || panel.style.display === 'none') return;
  const proxyUrl = localStorage.getItem(BUS_PROXY_URL_STORAGE) || '';

  if (!proxyUrl) {
    panel.innerHTML = busApiSetupHtml('bus', 'renderBusPanel');
    return;
  }

  const container = document.getElementById('busStopsContainer');
  if (!container) {
    panel.innerHTML = `<div class="bus-refresh-row">
      <span class="bus-last-updated" id="busLastUpdated">Fetching…</span>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="bus-refresh-btn" onclick="showBusSettings()" style="font-size:.75rem">Settings</button>
        <button class="bus-refresh-btn" onclick="renderBusPanel()">
          <span class="material-symbols-outlined" style="font-size:.9rem">refresh</span> Refresh
        </button>
      </div>
    </div>
    <div id="busStopsContainer"><div style="color:var(--muted);text-align:center;padding:24px">Loading…</div></div>`;
  }

  let allData = {};
  try { allData = await fetchAllBusStops(); } catch { allData = {}; }

  const cont = document.getElementById('busStopsContainer');
  if (!cont) return;

  cont.innerHTML = BUS_STOPS.map(stop => {
    const stopData = allData[stop.code];
    if (!stopData || stopData.error) {
      return `<div class="bus-stop-card">
        <div class="bus-stop-header">${stop.name} <span style="font-weight:400;text-transform:none">(${stop.code})</span></div>
        <div style="color:var(--muted);font-size:.82rem">Failed to load</div>
      </div>`;
    }
    const serviceMap = {};
    (stopData.Services || []).forEach(s => { serviceMap[s.ServiceNo] = s; });
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
let locationMap = null; // map the blue location dot is attached to (bus map or rain map)
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

async function fetchBusStopCoords() {
  const cacheKey = 'finance:busStopCoords';
  const cached = JSON.parse(localStorage.getItem(cacheKey) || '{}');
  const missing = BUS_STOPS.map(s => s.code).filter(c => !cached[c]);
  if (!missing.length) return cached;

  const proxyUrl = localStorage.getItem(BUS_PROXY_URL_STORAGE);
  if (!proxyUrl) throw new Error('No bus proxy URL configured');
  const token = localStorage.getItem(BUS_PROXY_TOKEN_STORAGE) || '';
  let url = `${proxyUrl.replace(/\/$/, '')}?action=BusStopCoords&stops=${encodeURIComponent(missing.join(','))}`;
  if (token) url += `&token=${encodeURIComponent(token)}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(resp.status);
  const data = await resp.json();

  missing.forEach(code => { if (data[code]) cached[code] = data[code]; });
  localStorage.setItem(cacheKey, JSON.stringify(cached));
  return cached;
}

function placeLocationMarker(lat, lng) {
  if (!locationMap) return;
  if (busMapLocationMarker) busMapLocationMarker.remove();
  const icon = L.divIcon({
    className: '',
    html: '<div class="bus-map-location"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
  busMapLocationMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(locationMap);
  busMapLocationMarker.bindPopup('You are here');
}

const LAST_LOCATION_KEY = 'finance:lastLocation';

function startLocationTracking(map) {
  if (map) locationMap = map;
  if (!navigator.geolocation || !locationMap) return;
  stopLocationTracking();
  const cached = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) || 'null');
  if (cached) placeLocationMarker(cached.lat, cached.lng);
  busMapLocationWatcher = navigator.geolocation.watchPosition(
    pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ lat, lng }));
      placeLocationMarker(lat, lng);
    },
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

async function placeBusStopMarkers() {
  if (!busMapInstance) return;
  busMapStopMarkers.forEach(m => m.remove());
  busMapStopMarkers = [];
  let coords;
  try { coords = await fetchBusStopCoords(); } catch { return; }
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
  const proxyUrl = localStorage.getItem(BUS_PROXY_URL_STORAGE) || '';

  if (!proxyUrl) {
    panel.innerHTML = busApiSetupHtml('busMap', 'renderBusMapPanel');
    return;
  }

  // If map already initialised, just refresh markers and re-check size
  if (busMapInstance) {
    setTimeout(() => busMapInstance.invalidateSize(), 50);
    startLocationTracking(busMapInstance);
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
      <button class="bus-refresh-btn" onclick="showBusMapSettings()" style="font-size:.75rem">Settings</button>
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

  startLocationTracking(busMapInstance);
  placeBusStopMarkers();
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

  // Remove old markers
  busMapMarkers.forEach(m => m.remove());
  busMapMarkers = [];

  let allData = {};
  try { allData = await fetchAllBusStops(); } catch { allData = {}; }

  const seen = new Set();
  BUS_STOPS.forEach(stop => {
    const res = allData[stop.code];
    if (!res || res.error) return;
    (res.Services || []).forEach(svc => {
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

// ── Rain Radar ───────────────────────────────────────────────────────────────
let rainMapInstance = null;
let rainOverlay = null;
let rainFrames = [];        // windowed SGT slot keys (yyyyMMddHHmm), oldest first
let rainFrameIdx = 0;
let rainFrameCache = new Map(); // slot key → data: URI (proxy) / direct URL (live); hot cache over the persistent Cache API
let rainPollingInterval = null;
let rainAnimTimer = null;
let rainUsingProxy = false;
let rainWindowDays = 1/24;  // selected range pill — bounds how far back the slider can be dragged

// Fixed georeference of the NEA radar PNG (same extent every frame) —
// SW / NE corners from the checkweather-sg / rain-geojson-sg projects.
const RAIN_BOUNDS = [[1.156, 103.565], [1.475, 104.13]];
const RAIN_IMG_URL = key => `https://www.weather.gov.sg/files/rainarea/50km/v2/dpsri_70km_${key}0000dBR.dpsri.png`;
const RAIN_BATCH_SIZE = 48; // 4h of 5-min frames fetched per batched proxy request
const RAIN_WINDOWS = [[1/24, '1 hour'], [4/24, '4 hours'], [1, '1 day'], [7, '1 week']];
const RAIN_CACHE_NAME = 'rain-frames-v1'; // persistent Cache API store (preserved across SW updates, see sw.js)

// SGT 5-min slot keys for the last `days` days, oldest first. Frames are
// deterministic (one every 5 min), so the client generates the keys it wants
// and asks the proxy only for those — no server-side index/listing to scan.
// One slot back from "now" covers NEA's publish lag.
function rainGenerateKeys(days) {
  const count = Math.max(1, Math.round(days * 24 * 12)); // 12 five-min slots / hour
  const base = Math.floor((Date.now() + 8 * 3600000) / 300000) * 300000 - 300000; // latest slot, SGT-shifted
  const keys = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base - i * 300000);
    keys.push('' + d.getUTCFullYear() +
      String(d.getUTCMonth() + 1).padStart(2, '0') +
      String(d.getUTCDate()).padStart(2, '0') +
      String(d.getUTCHours()).padStart(2, '0') +
      String(d.getUTCMinutes()).padStart(2, '0'));
  }
  return keys;
}

function rainFrameTimeLabel(key) {
  return `${key.slice(6, 8)}/${key.slice(4, 6)} ${key.slice(8, 10)}:${key.slice(10, 12)}`;
}

// ── Persistent frame cache (Cache API) — frames are immutable per slot key ────
function rainCacheKeyUrl(key) { return '/rainframe/' + key; }

async function rainCacheStore() {
  if (!('caches' in self)) return null;
  try { return await caches.open(RAIN_CACHE_NAME); } catch { return null; }
}

async function rainCacheGet(store, key) {
  if (!store) return null;
  try { const r = await store.match(rainCacheKeyUrl(key)); return r ? await r.text() : null; } catch { return null; }
}

function rainCachePut(store, key, uri) {
  if (!store) return;
  try { store.put(rainCacheKeyUrl(key), new Response(uri)); } catch {}
}

// Drop persistently-cached frames older than the 30-day retention window.
async function rainPrunePersistentCache() {
  const store = await rainCacheStore();
  if (!store) return;
  try {
    const cutoff = rainGenerateKeys(30)[0];
    const reqs = await store.keys();
    await Promise.all(reqs.map(r => {
      const m = r.url.match(/\/rainframe\/(\d{12})$/);
      return (m && m[1] < cutoff) ? store.delete(r) : null;
    }));
  } catch {}
}

function showRainSettings() {
  stopLocationTracking();
  if (rainAnimTimer) { clearInterval(rainAnimTimer); rainAnimTimer = null; }
  if (rainMapInstance) { rainMapInstance.remove(); rainMapInstance = null; rainOverlay = null; }
  locationMap = null;
  const panel = document.getElementById('rainPanel');
  if (panel) panel.innerHTML = busApiSetupHtml('rain', 'renderRainPanel');
}

function renderRainPanel() {
  const panel = document.getElementById('rainPanel');
  if (!panel || panel.style.display === 'none') return;

  if (rainMapInstance) {
    setTimeout(() => rainMapInstance.invalidateSize(), 50);
    startLocationTracking(rainMapInstance);
    refreshRainFrames();
    return;
  }

  const pills = RAIN_WINDOWS.map(([d, l]) =>
    `<button class="filter-pill${d === rainWindowDays ? ' active' : ''}" data-days="${d}" onclick="rainSetWindow(${d})">${l}</button>`
  ).join('');

  panel.innerHTML = `
    <div id="rainMapContainer"></div>
    <div class="filter-pills" id="rainPills" style="margin-top:10px">${pills}</div>
    <div class="rain-controls">
      <button class="bus-refresh-btn" id="rainPlayBtn" title="Play loop" onclick="rainToggleAnim()">
        <span class="material-symbols-outlined" style="font-size:.95rem">play_arrow</span>
      </button>
      <input type="range" id="rainSlider" class="rain-slider" min="0" max="0" value="0" oninput="rainShowFrame(this.value)">
      <span class="rain-frame-label" id="rainFrameLabel">—</span>
    </div>
    <div class="bus-refresh-row" style="margin-top:8px">
      <span class="bus-last-updated" id="rainLastUpdated">Fetching…</span>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="bus-refresh-btn" onclick="showRainSettings()" style="font-size:.75rem">Settings</button>
        <button class="bus-refresh-btn" onclick="refreshRainFrames()">
          <span class="material-symbols-outlined" style="font-size:.9rem">refresh</span> Refresh
        </button>
      </div>
    </div>`;

  rainMapInstance = L.map('rainMapContainer', { zoomControl: true }).setView([1.3521, 103.82], 11);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a> · Radar © <a href="https://www.nea.gov.sg/weather/rain-areas">NEA</a>',
    maxZoom: 19, minZoom: 10
  }).addTo(rainMapInstance);
  setTimeout(() => rainMapInstance.invalidateSize(), 50);

  startLocationTracking(rainMapInstance);
  rainUsingProxy = !!(localStorage.getItem(BUS_PROXY_URL_STORAGE) || '');
  rainPrunePersistentCache();
  rainApplyWindow(rainWindowDays, true);
}

function rainSyncPills() {
  const pills = document.getElementById('rainPills');
  if (!pills) return;
  pills.style.display = rainUsingProxy ? '' : 'none'; // live mode only has the last hour
  pills.querySelectorAll('.filter-pill').forEach(b =>
    b.classList.toggle('active', Number(b.dataset.days) === rainWindowDays));
}

function rainUpdateStatus() {
  const upd = document.getElementById('rainLastUpdated');
  if (!upd) return;
  if (!rainUsingProxy) {
    upd.textContent = 'Live: last hour only — add the rain cache to your Apps Script proxy';
    return;
  }
  const w = RAIN_WINDOWS.find(x => x[0] === rainWindowDays);
  upd.textContent = `Last ${w ? w[1] : rainWindowDays + ' days'} · ${rainFrames.length} frames`;
}

// Pill click: change the draggable range (lower bound) and jump to the latest frame.
function rainSetWindow(days) {
  if (rainAnimTimer) rainToggleAnim(); // stop the loop when the range changes
  rainApplyWindow(days, true);
}

// Poll / manual refresh: re-generate the window so "now" advances and the newest
// frames load; keep the scrub position unless the user was already at the latest.
async function refreshRainFrames() {
  if (!rainMapInstance) return;
  const wasAtLatest = !rainFrames.length || rainFrameIdx >= rainFrames.length - 1;
  await rainApplyWindow(rainWindowDays, wasAtLatest);
}

// Build the windowed frame list, load the newest 4h so the latest frame shows
// fast, and lazily fetch the rest on demand as the user scrubs (see rainShowFrame).
async function rainApplyWindow(days, jumpToLatest) {
  rainWindowDays = days;
  const prevKey = rainFrames[rainFrameIdx];
  rainSyncPills();

  rainFrames = rainUsingProxy ? rainGenerateKeys(days) : rainGenerateKeys(1 / 24); // live = last hour
  const slider = document.getElementById('rainSlider');
  if (slider) slider.max = Math.max(0, rainFrames.length - 1);

  if (rainUsingProxy) {
    const end = rainFrames.length, start = Math.max(0, end - RAIN_BATCH_SIZE);
    try { await rainFetchBatch(rainFrames.slice(start, end)); } catch {}

    // Whole newest batch empty → the proxy has no rain cache deployed; fall back to live.
    if (!rainFrames.slice(start, end).some(k => rainFrameCache.has(k))) {
      rainUsingProxy = false;
      return rainApplyWindow(days, jumpToLatest);
    }
    // Trim trailing publish-lag gaps so the slider ends on a real frame.
    let last = rainFrames.length - 1;
    while (last >= start && !rainFrameCache.has(rainFrames[last])) last--;
    if (last >= 0 && last < rainFrames.length - 1) rainFrames = rainFrames.slice(0, last + 1);
    if (slider) slider.max = Math.max(0, rainFrames.length - 1);
  }

  rainSyncPills();
  rainUpdateStatus();

  let idx = rainFrames.length - 1;
  if (!jumpToLatest && prevKey) {
    const i = rainFrames.indexOf(prevKey);
    if (i >= 0) idx = i;
  }
  rainShowFrame(idx);
}

// Aligned [start, end) bounds of the RAIN_BATCH_SIZE window containing idx.
function rainBatchBounds(idx) {
  const start = Math.floor(idx / RAIN_BATCH_SIZE) * RAIN_BATCH_SIZE;
  return [start, Math.min(rainFrames.length, start + RAIN_BATCH_SIZE)];
}

// Load every not-yet-cached key in one round-trip: first from the persistent
// Cache API, then a single batched proxy request for whatever's still missing.
async function rainFetchBatch(keys) {
  if (rainFrameCache.size > 800) rainFrameCache.clear(); // persistent cache still backs everything
  let need = keys.filter(k => !rainFrameCache.has(k));
  if (!need.length) return;

  const store = await rainCacheStore();
  if (store) {
    const hits = await Promise.all(need.map(async k => [k, await rainCacheGet(store, k)]));
    hits.forEach(([k, v]) => { if (v) rainFrameCache.set(k, v); });
    need = need.filter(k => !rainFrameCache.has(k));
  }
  if (!need.length) return;

  const proxyUrl = localStorage.getItem(BUS_PROXY_URL_STORAGE) || '';
  if (!proxyUrl) return;
  const token = localStorage.getItem(BUS_PROXY_TOKEN_STORAGE) || '';
  let url = `${proxyUrl.replace(/\/$/, '')}?action=RainImgBatch&t=${need.join(',')}`;
  if (token) url += `&token=${encodeURIComponent(token)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(resp.status);
  const json = await resp.json();
  const imgs = json.images || {};
  Object.keys(imgs).forEach(k => {
    if (!imgs[k]) return;
    const uri = 'data:image/png;base64,' + imgs[k];
    rainFrameCache.set(k, uri);
    rainCachePut(store, k, uri);
  });
}

// Resolve a frame's overlay src, loading its 4h batch on demand in proxy mode.
async function rainEnsureFrame(idx) {
  const key = rainFrames[idx];
  if (rainFrameCache.has(key)) return rainFrameCache.get(key);
  if (!rainUsingProxy) { const u = RAIN_IMG_URL(key); rainFrameCache.set(key, u); return u; }
  const [s, e] = rainBatchBounds(idx);
  await rainFetchBatch(rainFrames.slice(s, e));
  return rainFrameCache.get(key);
}

async function rainShowFrame(idx) {
  if (!rainFrames.length || !rainMapInstance) return;
  idx = Math.max(0, Math.min(rainFrames.length - 1, Number(idx) || 0));
  rainFrameIdx = idx;
  const key = rainFrames[idx];
  const slider = document.getElementById('rainSlider');
  if (slider && Number(slider.value) !== idx) slider.value = idx;
  const label = document.getElementById('rainFrameLabel');
  if (label) label.textContent = rainFrameTimeLabel(key);

  let src;
  try { src = await rainEnsureFrame(idx); } catch { return; }
  if (rainFrameIdx !== idx || !rainMapInstance || !src) return; // user scrubbed on / frame gap
  if (!rainOverlay) rainOverlay = L.imageOverlay(src, RAIN_BOUNDS, { opacity: 0.65 }).addTo(rainMapInstance);
  else rainOverlay.setUrl(src);

  // Prefetch the adjacent 4h batches so scrubbing/animation stays smooth.
  if (rainUsingProxy) {
    const [s, e] = rainBatchBounds(idx);
    if (s > 0) rainFetchBatch(rainFrames.slice(Math.max(0, s - RAIN_BATCH_SIZE), s)).catch(() => {});
    if (e < rainFrames.length) rainFetchBatch(rainFrames.slice(e, Math.min(rainFrames.length, e + RAIN_BATCH_SIZE))).catch(() => {});
  }
}

function rainToggleAnim() {
  const btn = document.getElementById('rainPlayBtn');
  if (rainAnimTimer) {
    clearInterval(rainAnimTimer);
    rainAnimTimer = null;
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:.95rem">play_arrow</span>';
    return;
  }
  rainAnimTimer = setInterval(() => rainShowFrame((rainFrameIdx + 1) % rainFrames.length), 500);
  if (btn) btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:.95rem">pause</span>';
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
    // Render every event chip; fitCalendarCells() clips to the cell height after layout.
    const chips = dayEvs.map(ev => `<div class="cal-ev-chip">${esc(ev.title)}</div>`).join('');
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
    <div class="cal-grid-header">${headerRow}</div>
    <div class="cal-grid">${cells}</div>
    <div id="calDayDetail"></div>`;

  requestAnimationFrame(fitCalendarCells);
}

// Clip each day cell's event chips to its rendered height, collapsing the
// overflow into a "+N" indicator. Runs after layout so it adapts to the month's
// week-row count and the device's viewport height.
function fitCalendarCells() {
  document.querySelectorAll('#eventCalendar .cal-day').forEach(cell => {
    const old = cell.querySelector('.cal-ev-more');
    if (old) old.remove();
    const chips = [...cell.querySelectorAll('.cal-ev-chip')];
    chips.forEach(c => { c.style.display = ''; });
    if (!chips.length) return;

    let hidden = 0;
    for (let i = 0; i < chips.length; i++) {
      if (chips[i].offsetTop + chips[i].offsetHeight > cell.clientHeight) {
        for (let j = i; j < chips.length; j++) { chips[j].style.display = 'none'; hidden++; }
        break;
      }
    }
    if (!hidden) return;

    const more = document.createElement('div');
    more.className = 'cal-ev-more';
    more.textContent = '+' + hidden;
    cell.appendChild(more);
    // If the indicator itself overflows, hide one more chip to make room.
    if (more.offsetTop + more.offsetHeight > cell.clientHeight) {
      const visible = chips.filter(c => c.style.display !== 'none');
      if (visible.length) { visible[visible.length - 1].style.display = 'none'; more.textContent = '+' + (++hidden); }
    }
  });
}

window.addEventListener('resize', () => { if (eventViewMode === 'calendar') fitCalendarCells(); });

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
    const timeFmt = ev.startTime
      ? `${ev.startTime.hour}:${String(ev.startTime.minute).padStart(2, '0')} ${ev.startTime.ampm}`
      : 'All day';
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
  // The detail panel shrinks the grid in fill mode — re-fit the chips to the new height.
  requestAnimationFrame(fitCalendarCells);
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
    document.getElementById('evTime').value = ev.startTime ? timeObjTo24h(ev.startTime) : '';
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
  if (!data._deletedIds) data._deletedIds = [];
  if (!data._deletedIds.includes(id)) data._deletedIds.push(id);
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
    if (!ev.reminderHours || !ev.startTime) return;
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

