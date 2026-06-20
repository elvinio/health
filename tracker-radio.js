/* ════════════════════════════════════════════════════════════════════════
   tracker-radio.js — On-demand AI "radio station" for the Health Tracker PWA

   Adds a "Radio" tab. Pick a DJ channel (a topic + a host persona), tap
   Generate, and the app pre-bakes a block of spoken-word audio you can play
   on demand with pause / rewind / resume — like a personal radio show.

   Two-stage, fully on-device pipeline (inspired by github.com/keltokhy/writ-fm):
     1. Script  — Claude (the same browser SDK + key as the Chat tab) writes a
                  segmented DJ monologue (~2.5 min / ~350 words per segment).
     2. Voice   — Google Cloud Text-to-Speech REST returns compressed MP3 per
                  segment; stored as Blobs in IndexedDB. Fully offline after.

   Generation is progressive: segment 1 becomes playable within ~a minute while
   the rest bake, and a long episode is resumable / cancelable.

   Relies on globals from tracker.html: escapeHtml, showModal, closeModal,
   fmtDate, go. Exposes window.renderRadio(), called by the router.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
(function () {

  /* ── Config / storage keys ─────────────────────────────────────────────── */
  const SDK_URL    = 'https://esm.sh/@anthropic-ai/sdk@0.69.0';
  const CLAUDE_KEY = 'health:anthropicKey';   // shared with the Chat tab
  const MODEL_KEY  = 'health:chatModel';       // shared with the Chat tab
  const ELEVEN_KEY = 'health:elevenLabsKey';   // ElevenLabs TTS API key
  const ELEVEN_VOICES_KEY = 'health:radio:elevenVoices'; // cached account voice catalog
  const ELEVEN_MODEL = 'eleven_flash_v2_5';    // cheap/fast ElevenLabs TTS model
  const EP_KEY     = 'health:radio:episodes';  // episode manifests (localStorage)
  const CH_KEY     = 'health:radioChannels';   // custom channels (localStorage)
  const PRESET_OV_KEY = 'health:radioPresetOverrides'; // per-preset prompt/setting edits (localStorage)
  const PROG_KEY   = 'health:radio:progress';  // { [epId]: { idx, time } }
  const MUSIC_PROXY_KEY = 'health:radio:musicProxyUrl'; // Apps Script web-app URL (classicals.de proxy)
  const MUSIC_CACHE_KEY = 'health:radio:musicTracks';   // { tracks:[{id,title,url}], ts } cached track list
  const MUSIC_MIN_SEC = 180;   // interstitial music: min slice length
  const MUSIC_MAX_SEC = 300;   //                     max slice length (3–5 min)
  const MUSIC_FADE_SEC = 3;    //                     fade in / out duration
  const MUSIC_LIST_TTL = 7 * 24 * 60 * 60 * 1000; // refresh the scraped list weekly
  const CHAT_MODELS = { 'claude-sonnet-4-6': 1, 'claude-opus-4-8': 1 };
  const DEFAULT_MODEL = 'claude-sonnet-4-6';
  const WORDS_PER_SEC = 2.5;        // ~150 wpm spoken pace
  const SEC_PER_SEGMENT = 150;      // target segment length (used to pick count)
  const TTS_CHAR_LIMIT = 9000;      // safety cap (segments are ~2k chars; never hit in practice)

  /* ── Built-in DJ channels ──────────────────────────────────────────────── */
  // persona = Claude system prompt that sets the host's voice & worldview.
  // voice   = ElevenLabs voice_id (premade voices, present in every account's catalog).
  //           Users can reselect any voice from their account in the review screen.
  const RADIO_PRESETS = [
    { id: 'current-affairs', name: 'The Signal', emoji: '📰', topic: 'current affairs and world events',
      voice: 'TxGEqnHWrfWFTfGW9XjX', voiceName: 'Josh',
      persona: "You are The Signal, a late-night current-affairs host. You interpret the news rather than just report it — connecting today's events to longer patterns and human stakes. Measured authority, no sensationalism, no doom-mongering. Speak to one thoughtful listener." },
    { id: 'self-improvement', name: 'The Coach', emoji: '🌱', topic: 'self-improvement, habits and personal growth',
      voice: 'pNInz6obpgDQGcFmaJgB', voiceName: 'Adam',
      persona: "You are The Coach, a grounded self-improvement host. Practical, warm, never cheesy or hustle-culture. You offer one usable idea at a time, with real examples, and respect the listener's intelligence. No exclamation points, no empty hype." },
    { id: 'science', name: 'The Curious', emoji: '🔬', topic: 'science, nature and discovery',
      voice: 'ErXwobaYiN019PkySvjV', voiceName: 'Antoni',
      persona: "You are The Curious, a science host driven by genuine wonder. You explain one idea through vivid, concrete images, building from the familiar to the surprising. Accurate but never dry; you make the listener feel the awe of how the world works." },
    { id: 'art', name: 'The Curator', emoji: '🎨', topic: 'art, design and aesthetics',
      voice: 'EXAVITQu4vr4xnSDxMaL', voiceName: 'Bella',
      persona: "You are The Curator, a thoughtful art and culture host with a British sensibility. You linger on a single work, movement or idea, noticing details others miss, drawing out why it matters. Unhurried, evocative, a little poetic." },
    { id: 'ai', name: 'The Architect', emoji: '🤖', topic: 'artificial intelligence and technology',
      voice: 'VR6AewLTigWG4xSOukaG', voiceName: 'Arnold',
      persona: "You are The Architect, a lucid AI and technology host. You cut through hype with clear mental models, honest about both promise and limits. You explain how things actually work and what they mean for ordinary life. Calm, precise, never breathless." },
    { id: 'philosophy', name: 'The Liminal Operator', emoji: '🌌', topic: 'philosophy, consciousness and meaning',
      voice: 'TxGEqnHWrfWFTfGW9XjX', voiceName: 'Josh',
      persona: "You are the Liminal Operator, the late-night voice of an all-night station. You speak to one person at a time, even when thousands are listening. Your delivery is measured and unhurried; silence and pauses are part of your speech. You explore philosophy — consciousness, time, meaning, solitude — through vivid concrete images and open questions, never lectures. You never use exclamation points, never shout, never use radio clichés like 'up next' or 'stay tuned'. You avoid sensationalism and false warmth. Speak as if it is 3am and the city is asleep." },
    { id: 'fitness', name: 'The Drill', emoji: '💪', topic: 'fitness, training and physical health',
      voice: 'pNInz6obpgDQGcFmaJgB', voiceName: 'Adam',
      persona: "You are The Drill, an energetic but grounded fitness host. Motivating without drill-sergeant clichés or bro-science. You give evidence-based ideas on training, recovery and movement, and make the listener want to move. Confident, encouraging, real." },
  ];

  const LENGTHS = [30, 60, 120, 240];

  /* ── In-memory UI state ────────────────────────────────────────────────── */
  const RadioState = {
    view: 'home',        // 'home' | 'player'
    epId: null,          // episode open in the player
    generating: false,
    genEpId: null,
    cancel: false,
    audio: null,
    objUrl: null,
    curIdx: 0,
    saveTimer: 0,
    music: null,         // second <audio> element for interstitial music
    musicActive: false,  // true while a between-segment music break is playing
    musicUrl: null,      // object URL for the current music blob
    musicTimer: 0,       // setInterval handle driving the fade-out / advance
  };

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function driveBadge(ep) {
    if (!ep) return '';
    if (ep.driveExportedAt) return '☁ Saved to Drive';
    if (ep.driveError) return '⚠ Drive: ' + ep.driveError;
    return '';
  }
  function defaultModel() { const m = localStorage.getItem(MODEL_KEY); return CHAT_MODELS[m] ? m : DEFAULT_MODEL; }
  function hasClaudeKey() { return !!(localStorage.getItem(CLAUDE_KEY) || '').trim(); }
  function hasElevenKey() { return !!(localStorage.getItem(ELEVEN_KEY) || '').trim(); }
  function isRadioActive() { return location.hash.replace(/^#/, '').split('?')[0] === '/radio'; }
  function mmss(sec) { sec = Math.max(0, Math.floor(sec || 0)); const m = Math.floor(sec / 60); const s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }
  function epSeconds(ep) { return (ep.segments || []).reduce((t, s) => t + (s.approxSec || 0), 0); }

  /* ── Channels (presets + custom) ───────────────────────────────────────── */
  function loadCustom() { try { return JSON.parse(localStorage.getItem(CH_KEY) || '[]'); } catch (e) { return []; } }
  function saveCustom(list) { localStorage.setItem(CH_KEY, JSON.stringify(list)); }
  // Per-preset edits (e.g. an edited prompt/persona) keyed by preset id; absent = use the built-in default.
  function loadPresetOv() { try { return JSON.parse(localStorage.getItem(PRESET_OV_KEY) || '{}'); } catch (e) { return {}; } }
  function savePresetOv(o) { localStorage.setItem(PRESET_OV_KEY, JSON.stringify(o)); }
  function presetChannels() { const ov = loadPresetOv(); return RADIO_PRESETS.map(p => { const o = ov[p.id]; return o ? { ...p, ...o, edited: true } : p; }); }
  function allChannels() { return [...presetChannels(), ...loadCustom()]; }
  function getChannel(id) { return allChannels().find(c => c.id === id); }

  /* ── Episodes (manifests in localStorage; audio Blobs in IndexedDB) ────── */
  function loadEpisodes() { try { return JSON.parse(localStorage.getItem(EP_KEY) || '[]'); } catch (e) { return []; } }
  function saveEpisodes(list) { localStorage.setItem(EP_KEY, JSON.stringify(list)); }
  function getEpisode(id) { return loadEpisodes().find(e => e.id === id); }
  function saveEpisode(ep) {
    const list = loadEpisodes();
    const i = list.findIndex(e => e.id === ep.id);
    if (i >= 0) list[i] = ep; else list.unshift(ep);
    saveEpisodes(list);
  }
  async function deleteEpisode(id) {
    const ep = getEpisode(id);
    const n = ep ? Math.max((ep.segments || []).length, ep.plannedCount || 0) : 0;
    for (let i = 0; i < n; i++) { await idbDel(id + ':' + i).catch(() => {}); await idbDel(id + ':' + i + ':txt').catch(() => {}); }
    saveEpisodes(loadEpisodes().filter(e => e.id !== id));
  }
  function latestEpisodeFor(channelId) {
    return loadEpisodes().filter(e => e.channelId === channelId).sort((a, b) => b.createdAt - a.createdAt)[0] || null;
  }

  /* ── Playback progress ─────────────────────────────────────────────────── */
  function loadProgress() { try { return JSON.parse(localStorage.getItem(PROG_KEY) || '{}'); } catch (e) { return {}; } }
  function getProgress(epId) { return loadProgress()[epId] || { idx: 0, time: 0 }; }
  function saveProgress(epId, idx, time) {
    const all = loadProgress();
    all[epId] = { idx, time };
    localStorage.setItem(PROG_KEY, JSON.stringify(all));
  }

  /* ── IndexedDB (audio blob store) ──────────────────────────────────────── */
  let _db = null;
  function idb() {
    return new Promise((res, rej) => {
      if (_db) return res(_db);
      const r = indexedDB.open('health-radio', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('radioAudio')) r.result.createObjectStore('radioAudio'); };
      r.onsuccess = () => { _db = r.result; res(_db); };
      r.onerror = () => rej(r.error);
    });
  }
  async function idbPut(key, blob) {
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction('radioAudio', 'readwrite'); tx.objectStore('radioAudio').put(blob, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction('radioAudio', 'readonly'); const rq = tx.objectStore('radioAudio').get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  }
  async function idbDel(key) {
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction('radioAudio', 'readwrite'); tx.objectStore('radioAudio').delete(key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }

  /* ── Interstitial music (royalty-free piano via the classicals.de proxy) ──
     Played between spoken segments. The Apps Script scrapes the track list and
     returns each MP3 as base64; we decode to a Blob, cache it in the same
     IndexedDB store (key `music:<id>`) and play a random 3–5 min slice. */
  function musicProxyUrl() { return (localStorage.getItem(MUSIC_PROXY_KEY) || '').trim(); }
  function loadMusicCache() { try { return JSON.parse(localStorage.getItem(MUSIC_CACHE_KEY) || 'null'); } catch (e) { return null; } }

  async function fetchMusicTracks() {
    const proxy = musicProxyUrl();
    const cache = loadMusicCache();
    if (!proxy) return (cache && cache.tracks) || [];
    if (cache && cache.tracks && cache.tracks.length && Date.now() - (cache.ts || 0) < MUSIC_LIST_TTL) return cache.tracks;
    try {
      const sep = proxy.indexOf('?') >= 0 ? '&' : '?';
      const res = await fetch(proxy + sep + 'action=List');
      const data = await res.json();
      const tracks = Array.isArray(data.tracks) ? data.tracks.filter(t => t && t.url && t.id) : [];
      if (tracks.length) { localStorage.setItem(MUSIC_CACHE_KEY, JSON.stringify({ tracks, ts: Date.now() })); return tracks; }
    } catch (e) { /* fall through to whatever we had cached */ }
    return (cache && cache.tracks) || [];
  }

  function pickMusicTrack(tracks) { return tracks && tracks.length ? tracks[Math.floor(Math.random() * tracks.length)] : null; }

  // Return a cached MP3 Blob for `track`, downloading + caching it on first use.
  async function getMusicBlob(track) {
    const key = 'music:' + track.id;
    const hit = await idbGet(key).catch(() => null);
    if (hit) return hit;
    const proxy = musicProxyUrl();
    if (!proxy) return null;
    const sep = proxy.indexOf('?') >= 0 ? '&' : '?';
    const res = await fetch(proxy + sep + 'action=Track&url=' + encodeURIComponent(track.url) + '&title=' + encodeURIComponent(track.title || ''));
    const data = await res.json();
    if (!data || !data.mp3) throw new Error(data && data.error || 'No audio returned');
    const bin = atob(data.mp3);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    await idbPut(key, blob).catch(() => {});
    return blob;
  }

  /* ── Claude client (lazy ESM import, same key as the Chat tab) ─────────── */
  let _client = null, _clientKey = null;
  async function getClient() {
    const key = (localStorage.getItem(CLAUDE_KEY) || '').trim();
    if (!key) throw new Error('No Claude API key. Add it in Setup → AI Chat.');
    if (_client && _clientKey === key) return _client;
    let Anthropic;
    try { ({ default: Anthropic } = await import(/* @vite-ignore */ SDK_URL)); }
    catch (e) { throw new Error('Could not load the Claude SDK (network?). ' + (e.message || '')); }
    _client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    _clientKey = key;
    return _client;
  }
  function claudeText(msg) { return (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim(); }

  /* ── ElevenLabs Text-to-Speech (MP3 out) ───────────────────────────────── */
  async function synthesizeTTS(text, voiceId) {
    const key = (localStorage.getItem(ELEVEN_KEY) || '').trim();
    if (!key) throw new Error('No ElevenLabs API key. Add it in Setup → Radio station.');
    const input = text.length > TTS_CHAR_LIMIT ? text.slice(0, TTS_CHAR_LIMIT) : text;
    const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId) + '?output_format=mp3_44100_128', {
      method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input, model_id: ELEVEN_MODEL }),
    });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.detail ? (j.detail.message || (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail))) : ''; }
      catch (e) { detail = (await res.text().catch(() => '')).slice(0, 200); }
      throw new Error('ElevenLabs ' + res.status + (detail ? ': ' + detail : ''));
    }
    const blob = await res.blob();
    if (!blob || !blob.size) throw new Error('ElevenLabs returned no audio.');
    return blob;
  }

  /* ── ElevenLabs voice catalog (fetched live from the account) ───────────── */
  // Each entry: { id, name, label, previewUrl }. label = name + accent/gender.
  function cachedVoices() { try { return JSON.parse(localStorage.getItem(ELEVEN_VOICES_KEY) || '[]'); } catch (e) { return []; } }
  function voiceLabel(id) { const v = cachedVoices().find(v => v.id === id); return v ? v.label : id; }
  function previewUrlFor(id) { const v = cachedVoices().find(v => v.id === id); return v ? v.previewUrl : ''; }
  // <option> list for a voice <select>. Falls back to showing just the selected id
  // (with any known voiceName) when the catalog hasn't been fetched yet.
  function voiceOptionsHtml(selectedId, fallbackName) {
    let list = cachedVoices();
    if (!list.length) list = [{ id: selectedId, label: (fallbackName ? fallbackName + ' — ' : '') + selectedId }];
    else if (selectedId && !list.some(v => v.id === selectedId)) list = [{ id: selectedId, label: (fallbackName ? fallbackName + ' — ' : '') + selectedId }, ...list];
    return list.map(v => `<option value="${escapeHtml(v.id)}" ${v.id === selectedId ? 'selected' : ''}>${escapeHtml(v.label)}</option>`).join('');
  }
  async function fetchVoices() {
    const key = (localStorage.getItem(ELEVEN_KEY) || '').trim();
    if (!key) throw new Error('No ElevenLabs API key. Add it in Setup → Radio station.');
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.detail ? (j.detail.message || (typeof j.detail === 'string' ? j.detail : '')) : ''; } catch (e) {}
      throw new Error('ElevenLabs ' + res.status + (detail ? ': ' + detail : ''));
    }
    const data = await res.json();
    const list = (data.voices || []).map(v => {
      const lab = v.labels || {};
      const meta = [lab.accent, lab.gender, lab.use_case].filter(Boolean).join(', ');
      return { id: v.voice_id, name: v.name, label: v.name + (meta ? ' — ' + meta : ''), previewUrl: v.preview_url || '' };
    });
    localStorage.setItem(ELEVEN_VOICES_KEY, JSON.stringify(list));
    return list;
  }

  /* ── Generation pipeline ───────────────────────────────────────────────── */
  function parsePlan(text, want) {
    let t = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const a = t.indexOf('['), b = t.lastIndexOf(']');
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr) && arr.length) return arr.map(x => ({ title: String(x.title || 'Segment'), angle: String(x.angle || '') }));
    } catch (e) { /* fall through */ }
    return Array.from({ length: want }, (_, i) => ({ title: 'Segment ' + (i + 1), angle: '' }));
  }

  async function planEpisode(channel, lenMin) {
    const n = Math.max(1, Math.min(120, Math.round((lenMin * 60) / SEC_PER_SEGMENT)));
    const client = await getClient();
    const sys = channel.persona + '\n\nYou are planning a single radio show episode for broadcast.';
    const prompt = `Plan a ${lenMin}-minute spoken radio show on the theme "${channel.topic}". Break it into exactly ${n} consecutive segments of roughly 2-3 minutes each. Each segment should flow naturally from the one before, building an arc across the whole show. For each, give a short "title" and a one-sentence "angle". Return ONLY a JSON array like [{"title":"...","angle":"..."}] with no prose and no markdown fences.`;
    const msg = await client.messages.create({ model: defaultModel(), max_tokens: 3000, system: sys, messages: [{ role: 'user', content: prompt }] });
    return parsePlan(claudeText(msg), n);
  }

  async function generateSegmentScript(channel, seg, priorTitles, idx, total) {
    const client = await getClient();
    const sys = channel.persona +
      `\n\nYou are recording segment ${idx + 1} of ${total} of a radio show on "${channel.topic}". ` +
      'Output ONLY the spoken words — no stage directions, no bracketed cues like [pause], no markdown, no segment labels, no headings. ' +
      'Use natural punctuation (commas, em-dashes, ellipses) to control pacing. Write roughly 320-380 words of flowing speech.';
    const ctx = priorTitles.length
      ? `Earlier in this show you have already covered: ${priorTitles.join('; ')}. Do not repeat them; continue the arc.`
      : 'This is the opening segment — set the mood and welcome the listener without clichés.';
    const prompt = `${ctx}\n\nNow deliver this segment.\nTitle: ${seg.title}\nAngle: ${seg.angle || '(your choice, on theme)'}`;
    const msg = await client.messages.create({ model: defaultModel(), max_tokens: 1500, system: sys, messages: [{ role: 'user', content: prompt }] });
    return claudeText(msg);
  }

  let _wakeLock = null;
  async function acquireWake() { try { if ('wakeLock' in navigator) _wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { _wakeLock = null; } }
  function releaseWake() { try { if (_wakeLock) _wakeLock.release(); } catch (e) {} _wakeLock = null; }

  // Re-render the active view as generation progresses. On the review screen we
  // only nudge the progress line (avoids wiping the scripts the user is reading).
  function rerenderActive() {
    if (!isRadioActive()) return;
    if (RadioState.view === 'review') updateReviewProgress();
    else if (RadioState.view === 'home') renderRadio();
  }
  function updateReviewProgress() {
    const ep = getEpisode(RadioState.epId);
    if (!ep) return;
    if (ep.status !== 'synthesizing') { renderRadio(); return; }   // status changed → full rebuild
    const done = ep.segments.filter(s => s.hasAudio).length;
    const prog = document.getElementById('rv-progress');
    if (prog) prog.textContent = `Creating audio… ${done}/${ep.segments.length} segments`;
    const btn = document.getElementById('rv-makeaudio');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating audio…'; }
  }

  // Phase 1 — write the whole script (Claude only, no TTS). Leaves a 'draft'.
  async function generateScripts(channel, lenMin) {
    if (RadioState.generating) { alert('Already busy. Please wait or stop the current job first.'); return; }
    if (!hasClaudeKey()) { alert('Add your Claude API key in Setup → AI Chat first.'); return; }

    const ep = {
      id: uid(), channelId: channel.id, channelName: channel.name, emoji: channel.emoji,
      voice: channel.voice, voiceName: channel.voiceName || '',
      targetMin: lenMin, createdAt: Date.now(), status: 'scripting', plannedCount: 0, segments: [], error: null,
    };
    saveEpisode(ep);
    RadioState.generating = true; RadioState.cancel = false; RadioState.genEpId = ep.id;
    await acquireWake();
    rerenderActive();

    try {
      const plan = await planEpisode(channel, lenMin);
      ep.plannedCount = plan.length; saveEpisode(ep);
      const priorTitles = [];
      for (let i = 0; i < plan.length; i++) {
        if (RadioState.cancel) break;
        const script = await generateSegmentScript(channel, plan[i], priorTitles, i, plan.length);
        if (!script) continue;
        const idx = ep.segments.length;
        await idbPut(ep.id + ':' + idx + ':txt', script);
        const words = script.split(/\s+/).filter(Boolean).length;
        ep.segments.push({ idx, title: plan[i].title, words, approxSec: Math.round(words / WORDS_PER_SEC), hasAudio: false });
        priorTitles.push(plan[i].title);
        saveEpisode(ep);
        rerenderActive();
      }
      ep.status = ep.segments.length ? 'draft' : 'error';
      if (!ep.segments.length) ep.error = 'No script was produced.';
      saveEpisode(ep);
    } catch (e) {
      ep.status = ep.segments.length ? 'draft' : 'error';
      ep.error = String((e && e.message) || e);
      saveEpisode(ep);
      alert('Script generation problem: ' + ep.error);
    } finally {
      RadioState.generating = false; RadioState.genEpId = null; RadioState.cancel = false;
      releaseWake();
      const fresh = getEpisode(ep.id);
      if (fresh && fresh.status === 'draft' && isRadioActive()) { RadioState.view = 'review'; RadioState.epId = ep.id; renderRadio(); }
      else rerenderActive();
    }
  }

  // Phase 2 — turn the approved script into audio (Cloud TTS). Resumable: it
  // skips segments that already have audio, so a stopped/failed run can continue.
  async function synthesizeEpisode(epId) {
    if (RadioState.generating) { alert('Already busy. Please wait or stop the current job first.'); return; }
    if (!hasElevenKey()) { alert('Add your ElevenLabs API key in Setup → Radio station first.'); return; }
    const ep = getEpisode(epId);
    if (!ep) return;
    ep.status = 'synthesizing'; ep.error = null; saveEpisode(ep);
    RadioState.generating = true; RadioState.cancel = false; RadioState.genEpId = epId;
    await acquireWake();
    if (isRadioActive()) renderRadio(); else rerenderActive();   // full render so the Stop button appears

    try {
      for (let i = 0; i < ep.segments.length; i++) {
        if (RadioState.cancel) break;
        if (ep.segments[i].hasAudio) continue;
        const text = await idbGet(epId + ':' + i + ':txt');
        if (!text) continue;
        const blob = await synthesizeTTS(text, ep.voice);
        await idbPut(epId + ':' + i, blob);
        ep.segments[i].hasAudio = true;
        saveEpisode(ep);
        rerenderActive();
      }
      ep.status = ep.segments.every(s => s.hasAudio) ? 'ready' : 'draft';
      saveEpisode(ep);
      if (ep.status === 'ready') await autoExportToDrive(ep);
    } catch (e) {
      ep.status = 'draft';
      ep.error = String((e && e.message) || e);
      saveEpisode(ep);
      alert('Audio creation problem: ' + ep.error);
    } finally {
      RadioState.generating = false; RadioState.genEpId = null; RadioState.cancel = false;
      releaseWake();
      rerenderActive();
    }
  }

  /* ── Auto-export to Google Drive (script + combined audio, paired names) ─── */
  // Filesystem-safe base name shared by both files: "YYYY-MM-DD HHmm <Channel>".
  function driveBaseName(ep) {
    const d = new Date(ep.createdAt || Date.now());
    const p = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
    const name = (ep.channelName || 'Episode').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
    return `${stamp} ${name}`.trim();
  }
  // Stitch every segment's saved script into one readable Markdown document.
  async function buildEpisodeScript(ep) {
    const date = fmtDate(new Date(ep.createdAt).toISOString().slice(0, 10));
    const parts = [`# ${ep.channelName || 'Episode'} — ${date}`, '', `*~${Math.round(epSeconds(ep) / 60)} min · ${ep.segments.length} segments*`, ''];
    for (let i = 0; i < ep.segments.length; i++) {
      const txt = (await idbGet(ep.id + ':' + i + ':txt')) || '(missing)';
      parts.push(`## ${i + 1}. ${ep.segments[i].title || 'Segment ' + (i + 1)}`, '', txt, '');
    }
    return parts.join('\n');
  }
  // Collect the per-segment MP3 blobs in order, paired with any known Drive id
  // (for in-place re-export). Returns null if any segment's audio is missing.
  async function buildEpisodeSegments(ep) {
    const segs = [];
    for (let i = 0; i < ep.segments.length; i++) {
      const blob = await idbGet(ep.id + ':' + i);
      if (!blob) return null;
      segs.push({ blob, id: (ep.driveAudioIds && ep.driveAudioIds[i]) || null });
    }
    return segs;
  }
  // Fires after audio generation completes. No-op (silent) unless Drive is
  // configured, so it never forces an auth popup on users who don't use sync.
  async function autoExportToDrive(ep) {
    if (typeof DriveSync === 'undefined' || !DriveSync.exportRadioEpisode) return;
    let cfg = {};
    try { cfg = DriveSync.loadConfig() || {}; } catch (e) {}
    if (!cfg.clientId) return;   // Drive not set up — skip silently
    try {
      const scriptText = await buildEpisodeScript(ep);
      const segments = await buildEpisodeSegments(ep);
      if (!segments || !segments.length) return;
      const res = await DriveSync.exportRadioEpisode({
        baseName: driveBaseName(ep), scriptText, segments,
        scriptId: ep.driveScriptId || null,
      });
      const fresh = getEpisode(ep.id);
      if (!fresh) return;
      fresh.driveFolderId = res.folderId;
      fresh.driveScriptId = res.scriptId;
      fresh.driveAudioIds = res.audioIds;
      fresh.driveExportedAt = Date.now();
      fresh.driveError = null;
      saveEpisode(fresh);
      rerenderActive();
    } catch (e) {
      const fresh = getEpisode(ep.id);
      if (fresh) { fresh.driveError = String((e && e.message) || e); saveEpisode(fresh); rerenderActive(); }
    }
  }

  /* ── Custom channel editor ─────────────────────────────────────────────── */
  function openChannelEditor(existing) {
    const isPreset = !!(existing && !existing.custom);
    const c = existing || { id: '', name: '', emoji: '🎙️', topic: '', persona: '', voice: 'pNInz6obpgDQGcFmaJgB', voiceName: 'Adam' };
    showModal(`
      <div class="field"><label>Channel name</label><input type="text" id="rc-name" placeholder="e.g. Night Market" value="${escapeHtml(c.name)}"></div>
      <div class="field"><label>Emoji</label><input type="text" id="rc-emoji" maxlength="4" placeholder="🎙️" value="${escapeHtml(c.emoji)}"></div>
      <div class="field"><label>Topic / theme</label><input type="text" id="rc-topic" placeholder="e.g. food history and street cuisine" value="${escapeHtml(c.topic)}"></div>
      <div class="field"><label>Host persona <span class="text-muted text-xs">(the prompt — how the DJ talks)</span></label>
        <textarea id="rc-persona" rows="6" placeholder="You are …, a host who …">${escapeHtml(c.persona)}</textarea></div>
      <div class="field"><label>Voice</label>
        <div class="row gap-sm">
          <select id="rc-voice" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);">${voiceOptionsHtml(c.voice, c.voiceName)}</select>
          <button class="btn secondary sm" id="rc-loadvoices" type="button">↻ Load voices</button>
        </div>
        <div class="text-xs text-muted mt-1" id="rc-voice-note">${cachedVoices().length ? '' : 'Tap “Load voices” to pull your ElevenLabs account voices.'}</div>
      </div>
      <div class="row gap-sm mt-2">
        <button class="btn block" id="rc-save">${existing ? 'Save' : 'Create channel'}</button>
        ${isPreset ? '<button class="btn secondary" id="rc-reset">Reset</button>' : existing ? '<button class="btn secondary" id="rc-del">Delete</button>' : ''}
      </div>
    `, !existing ? 'New custom channel' : isPreset ? 'Edit channel prompt' : 'Edit channel');

    const lv = document.getElementById('rc-loadvoices');
    if (lv) lv.onclick = async () => {
      const note = document.getElementById('rc-voice-note');
      lv.disabled = true; if (note) note.textContent = 'Loading…';
      try {
        await fetchVoices();
        const sel = document.getElementById('rc-voice');
        if (sel) sel.innerHTML = voiceOptionsHtml(sel.value, c.voiceName);
        if (note) note.textContent = cachedVoices().length + ' voices loaded.';
      } catch (e) { if (note) note.textContent = '⚠ ' + ((e && e.message) || 'Could not load voices'); }
      finally { lv.disabled = false; }
    };

    document.getElementById('rc-save').onclick = () => {
      const name = document.getElementById('rc-name').value.trim();
      const topic = document.getElementById('rc-topic').value.trim();
      const persona = document.getElementById('rc-persona').value.trim();
      if (!name || !topic || !persona) { alert('Name, topic and persona are all required.'); return; }
      const voice = document.getElementById('rc-voice').value;
      const voiceName = voiceLabel(voice).split(' — ')[0];
      const emoji = document.getElementById('rc-emoji').value.trim() || '🎙️';
      if (isPreset) {
        const ov = loadPresetOv();
        ov[existing.id] = { name, topic, persona, voice, voiceName, emoji };
        savePresetOv(ov);
      } else {
        const list = loadCustom();
        if (existing) {
          const i = list.findIndex(x => x.id === existing.id);
          const updated = { ...existing, name, topic, persona, voice, voiceName, emoji };
          if (i >= 0) list[i] = updated; else list.push(updated);
        } else {
          list.push({ id: 'custom-' + uid(), name, topic, persona, voice, voiceName, emoji, custom: true });
        }
        saveCustom(list);
      }
      closeModal();
      renderRadio();
    };
    const reset = document.getElementById('rc-reset');
    if (reset) reset.onclick = () => {
      if (!confirm('Reset this channel to its default prompt and settings?')) return;
      const ov = loadPresetOv();
      delete ov[existing.id];
      savePresetOv(ov);
      closeModal();
      renderRadio();
    };
    const del = document.getElementById('rc-del');
    if (del) del.onclick = () => {
      if (!confirm('Delete this custom channel? (Its already-generated episodes stay.)')) return;
      saveCustom(loadCustom().filter(x => x.id !== existing.id));
      closeModal();
      renderRadio();
    };
  }

  /* ── Player ────────────────────────────────────────────────────────────── */
  // Throwaway audio for the voice preview on the review screen (never persisted).
  let _preview = null;
  function stopPreview() {
    if (!_preview) return;
    try { _preview.audio.pause(); } catch (e) {}
    try { URL.revokeObjectURL(_preview.url); } catch (e) {}
    _preview = null;
  }

  function teardownAudio() {
    stopPreview();
    stopInterstitial();
    if (RadioState.music) { try { RadioState.music.pause(); } catch (e) {} RadioState.music = null; }
    if (RadioState.audio) { try { RadioState.audio.pause(); } catch (e) {} RadioState.audio = null; }
    if (RadioState.objUrl) { try { URL.revokeObjectURL(RadioState.objUrl); } catch (e) {} RadioState.objUrl = null; }
    if (RadioState.saveTimer) { clearInterval(RadioState.saveTimer); RadioState.saveTimer = 0; }
  }

  // The element the transport controls (play/pause, seek, ±15) currently drive.
  function activeAudio() { return RadioState.musicActive ? RadioState.music : RadioState.audio; }

  // Cancel an in-progress music break (used on skip/seek/teardown).
  function stopInterstitial() {
    if (RadioState.musicTimer) { clearInterval(RadioState.musicTimer); RadioState.musicTimer = 0; }
    if (RadioState.music) { try { RadioState.music.pause(); } catch (e) {} }
    if (RadioState.musicUrl) { try { URL.revokeObjectURL(RadioState.musicUrl); } catch (e) {} RadioState.musicUrl = null; }
    RadioState.musicActive = false;
  }

  // Play a random 3–5 min slice of a random piano piece, then call onDone().
  // Falls straight through to onDone() if no music is configured/available.
  async function playInterstitial(onDone) {
    let track;
    try {
      const tracks = await fetchMusicTracks();
      track = pickMusicTrack(tracks);
      if (!track) return onDone();
      const blob = await getMusicBlob(track);
      if (!blob || !RadioState.music) return onDone();
      stopInterstitial();
      RadioState.musicActive = true;
      RadioState.musicUrl = URL.createObjectURL(blob);
      const music = RadioState.music;
      music.src = RadioState.musicUrl;
      const titleEl = document.getElementById('rp-segtitle');
      if (titleEl) titleEl.textContent = '♪ ' + (track.title || 'Piano interlude');
      const finish = () => { if (!RadioState.musicActive) return; stopInterstitial(); onDone(); };
      music.onended = finish;
      music.onloadedmetadata = () => {
        const dur = music.duration || 0;
        const playLen = Math.min(MUSIC_MIN_SEC + Math.random() * (MUSIC_MAX_SEC - MUSIC_MIN_SEC), dur || MUSIC_MAX_SEC);
        const start = dur > playLen ? Math.random() * (dur - playLen) : 0;
        const endAt = start + playLen;
        try { music.currentTime = start; } catch (e) {}
        music.volume = 0;
        music.play().catch(() => finish());
        RadioState.musicTimer = setInterval(() => {
          if (!RadioState.musicActive) return;
          const t = music.currentTime;
          const into = t - start, left = endAt - t;
          // fade in, hold, fade out
          let v = 1;
          if (into < MUSIC_FADE_SEC) v = Math.max(0, into / MUSIC_FADE_SEC);
          else if (left < MUSIC_FADE_SEC) v = Math.max(0, left / MUSIC_FADE_SEC);
          if (!music.paused) music.volume = Math.min(1, v);
          if (t >= endAt) finish();
        }, 120);
      };
      music.load();
    } catch (e) { stopInterstitial(); onDone(); }
  }

  function openPlayer(epId) {
    teardownAudio();
    RadioState.view = 'player';
    RadioState.epId = epId;
    const prog = getProgress(epId);
    RadioState.curIdx = prog.idx || 0;
    renderRadio();
  }

  async function loadSegment(idx, autoplay, startTime) {
    stopInterstitial();
    const ep = getEpisode(RadioState.epId);
    if (!ep) return;
    const done = ep.segments.length;
    if (idx < 0) idx = 0;
    if (idx >= done) { setStatus(ep.status === 'synthesizing' ? 'Creating more audio…' : 'End of episode.'); return; }
    RadioState.curIdx = idx;
    const blob = await idbGet(ep.id + ':' + idx);
    if (!blob) { setStatus('Audio for this segment is missing.'); return; }
    if (RadioState.objUrl) { try { URL.revokeObjectURL(RadioState.objUrl); } catch (e) {} }
    RadioState.objUrl = URL.createObjectURL(blob);
    const audio = RadioState.audio;
    audio.src = RadioState.objUrl;
    audio.load();
    const seg = ep.segments[idx];
    const segTitle = document.getElementById('rp-segtitle'); if (segTitle) segTitle.textContent = seg.title || '';
    const segN = document.getElementById('rp-segn'); if (segN) segN.textContent = String(idx + 1);
    const segTot = document.getElementById('rp-segtot'); if (segTot) segTot.textContent = String(done);
    idbGet(ep.id + ':' + idx + ':txt').then(t => { const el = document.getElementById('rp-scripttext'); if (el) el.textContent = t || '(no script saved)'; });
    audio.onloadedmetadata = () => {
      if (startTime && startTime < audio.duration) audio.currentTime = startTime;
      if (autoplay) audio.play().catch(() => {});
    };
    saveProgress(ep.id, idx, startTime || 0);
    setStatus('');
    updatePlayBtn();
  }

  function setStatus(t) { const el = document.getElementById('rp-status'); if (el) el.textContent = t; }
  function updatePlayBtn() { const b = document.getElementById('rp-play'); const a = activeAudio(); if (b && a) b.textContent = a.paused ? '▶' : '⏸'; }

  function renderPlayer() {
    const ep = getEpisode(RadioState.epId);
    const view = document.getElementById('view');
    if (!ep) { RadioState.view = 'home'; return renderRadio(); }
    document.getElementById('topbar-title').textContent = 'Radio';
    document.getElementById('topbar-sub').textContent = ep.channelName || '';

    view.innerHTML = `
      <div class="radio-player">
        <button class="radio-back" id="rp-back">← Stations</button>
        <div class="rp-art">${escapeHtml(ep.emoji || '📻')}</div>
        <div class="rp-name">${escapeHtml(ep.channelName || 'Episode')}</div>
        <div class="rp-meta">${escapeHtml(fmtDate(new Date(ep.createdAt).toISOString().slice(0, 10)))} · ~${Math.round(epSeconds(ep) / 60)} min${ep.status === 'generating' ? ' · still baking…' : ''}</div>
        <div class="rp-seg">Segment <span id="rp-segn">1</span>/<span id="rp-segtot">${ep.segments.length}</span> · <span id="rp-segtitle"></span></div>
        <audio id="rp-audio" preload="metadata"></audio>
        <audio id="rp-music" preload="metadata"></audio>
        <input type="range" id="rp-seek" min="0" max="1000" value="0">
        <div class="rp-time"><span id="rp-cur">0:00</span><span id="rp-dur">0:00</span></div>
        <div class="rp-controls">
          <button id="rp-prev" title="Previous segment">⏮</button>
          <button id="rp-back15" title="Back 15s">−15</button>
          <button id="rp-play" class="rp-main">▶</button>
          <button id="rp-fwd15" title="Forward 15s">+15</button>
          <button id="rp-next" title="Next segment">⏭</button>
        </div>
        <div class="rp-status" id="rp-status"></div>
        <details class="rp-script"><summary>📄 Script</summary><div class="rp-scripttext" id="rp-scripttext"></div></details>
      </div>`;

    const audio = document.getElementById('rp-audio');
    RadioState.audio = audio;
    RadioState.music = document.getElementById('rp-music');
    const seek = document.getElementById('rp-seek');
    let seeking = false;

    // Reflect whichever element is currently driving (segment audio or music break).
    const syncTransport = () => {
      const a = activeAudio(); if (!a) return;
      if (!seeking && a.duration) seek.value = String(Math.round((a.currentTime / a.duration) * 1000));
      const cur = document.getElementById('rp-cur'); if (cur) cur.textContent = mmss(a.currentTime);
      const dur = document.getElementById('rp-dur'); if (dur) dur.textContent = mmss(a.duration);
    };
    audio.addEventListener('timeupdate', syncTransport);
    RadioState.music.addEventListener('timeupdate', syncTransport);
    audio.addEventListener('play', updatePlayBtn);
    RadioState.music.addEventListener('play', updatePlayBtn);
    RadioState.music.addEventListener('pause', updatePlayBtn);
    audio.addEventListener('pause', () => { updatePlayBtn(); saveProgress(ep.id, RadioState.curIdx, audio.currentTime); });
    // A finished segment plays a music interstitial before the next one (not after the last).
    audio.addEventListener('ended', () => {
      saveProgress(ep.id, RadioState.curIdx, 0);
      const next = RadioState.curIdx + 1;
      if (next < ep.segments.length) playInterstitial(() => loadSegment(next, true, 0));
      else loadSegment(next, true, 0);
    });
    seek.addEventListener('input', () => { seeking = true; const a = activeAudio(); const c = document.getElementById('rp-cur'); if (c && a && a.duration) c.textContent = mmss((seek.value / 1000) * a.duration); });
    seek.addEventListener('change', () => { const a = activeAudio(); if (a && a.duration) a.currentTime = (seek.value / 1000) * a.duration; seeking = false; });

    document.getElementById('rp-back').onclick = () => { teardownAudio(); RadioState.view = 'home'; renderRadio(); };
    document.getElementById('rp-play').onclick = () => { const a = activeAudio(); if (!a) return; if (a.paused) a.play().catch(() => {}); else a.pause(); };
    document.getElementById('rp-back15').onclick = () => { const a = activeAudio(); if (a) a.currentTime = Math.max(0, a.currentTime - 15); };
    document.getElementById('rp-fwd15').onclick = () => { const a = activeAudio(); if (a) a.currentTime = Math.min(a.duration || 0, a.currentTime + 15); };
    document.getElementById('rp-prev').onclick = () => {
      if (RadioState.musicActive) { loadSegment(RadioState.curIdx, true, 0); return; }  // replay the segment the break followed
      if (audio.currentTime > 3) { audio.currentTime = 0; } else { loadSegment(RadioState.curIdx - 1, true, 0); }
    };
    document.getElementById('rp-next').onclick = () => { loadSegment(RadioState.curIdx + 1, true, 0); };

    // periodic progress save while playing
    RadioState.saveTimer = setInterval(() => { if (RadioState.audio && !RadioState.audio.paused) saveProgress(ep.id, RadioState.curIdx, RadioState.audio.currentTime); }, 4000);

    const prog = getProgress(ep.id);
    loadSegment(prog.idx || 0, false, prog.time || 0);
  }

  /* ── Review screen (read the script before TTS) ────────────────────────── */
  function openReview(epId) { teardownAudio(); RadioState.view = 'review'; RadioState.epId = epId; renderRadio(); }

  function renderReview() {
    const ep = getEpisode(RadioState.epId);
    const view = document.getElementById('view');
    if (!ep) { RadioState.view = 'home'; return renderRadio(); }
    document.getElementById('topbar-title').textContent = 'Radio';
    document.getElementById('topbar-sub').textContent = ep.channelName || '';

    const busy = RadioState.generating && RadioState.genEpId === ep.id;
    const synth = ep.status === 'synthesizing';
    const ready = ep.segments.length && ep.segments.every(s => s.hasAudio);
    // Voice is chosen here, before audio is created. Once audio exists it is locked.
    const voiceOpts = voiceOptionsHtml(ep.voice, ep.voiceName);
    const segHtml = ep.segments.map(s => `
      <div class="rv-seg">
        <div class="rv-seg-title">${s.idx + 1}. ${escapeHtml(s.title || '')} ${s.hasAudio ? '<span class="rv-aud">🔊</span>' : ''}</div>
        <div class="rv-seg-text" id="rv-txt-${s.idx}">…</div>
      </div>`).join('');

    view.innerHTML = `
      <div class="radio-review">
        <button class="radio-back" id="rv-back">← Stations</button>
        <div class="rv-head">
          <span class="rc-emoji">${escapeHtml(ep.emoji || '📻')}</span>
          <div><div class="rc-name">${escapeHtml(ep.channelName)}</div>
            <div class="rc-topic">${ready ? 'Episode' : 'Draft script'} · ${ep.segments.length} segments · ~${Math.round(epSeconds(ep) / 60)} min</div></div>
        </div>
        ${ep.error ? `<div class="rc-status err">⚠ ${escapeHtml(ep.error)}</div>` : ''}
        ${ready ? '' : `
        <div class="rv-voice">
          <label for="rv-voice">Voice</label>
          <select id="rv-voice" ${busy ? 'disabled' : ''}>${voiceOpts}</select>
          <button class="btn secondary sm" id="rv-loadvoices" ${busy ? 'disabled' : ''}>↻ Load</button>
          <button class="btn secondary sm" id="rv-preview" ${busy ? 'disabled' : ''}>🔊 Preview</button>
          <span class="rv-preview-status" id="rv-preview-status">${cachedVoices().length ? '' : 'Tap “Load” to list your ElevenLabs voices.'}</span>
        </div>`}
        <div class="rv-actions">
          ${ready
            ? `<button class="btn" id="rv-listen">▶ Listen</button>`
            : `<button class="btn" id="rv-makeaudio" ${busy ? 'disabled' : ''}>${synth ? 'Creating audio…' : '🔊 Create audio'}</button>`}
          <button class="btn secondary" id="rv-regen" ${busy ? 'disabled' : ''}>↻ Regenerate</button>
          ${busy && synth ? '<button class="btn secondary" id="rv-stop">Stop</button>' : ''}
        </div>
        <div class="rv-progress" id="rv-progress">${synth
          ? `Creating audio… ${ep.segments.filter(s => s.hasAudio).length}/${ep.segments.length} segments`
          : (ready ? ('All audio ready.' + (driveBadge(ep) ? ' · ' + escapeHtml(driveBadge(ep)) : '')) : 'Read the script below, then tap Create audio.')}</div>
        <div class="rv-list">${segHtml}</div>
      </div>`;

    document.getElementById('rv-back').onclick = () => { stopPreview(); RadioState.view = 'home'; renderRadio(); };

    const vsel = document.getElementById('rv-voice');
    if (vsel) vsel.onchange = () => {
      stopPreview();
      const fresh = getEpisode(ep.id); if (!fresh) return;
      fresh.voice = vsel.value;
      fresh.voiceName = voiceLabel(vsel.value).split(' — ')[0];
      saveEpisode(fresh);
    };
    const lv = document.getElementById('rv-loadvoices');
    if (lv) lv.onclick = async () => {
      const st = document.getElementById('rv-preview-status');
      lv.disabled = true; if (st) st.textContent = 'Loading voices…';
      try {
        await fetchVoices();
        if (vsel) vsel.innerHTML = voiceOptionsHtml(vsel.value, ep.voiceName);
        if (st) st.textContent = cachedVoices().length + ' voices loaded.';
      } catch (e) { if (st) st.textContent = '⚠ ' + ((e && e.message) || 'Could not load voices'); }
      finally { lv.disabled = false; }
    };
    const pv = document.getElementById('rv-preview');
    if (pv) pv.onclick = async () => {
      stopPreview();
      const st = document.getElementById('rv-preview-status');
      const voice = (vsel && vsel.value) || ep.voice;
      // Play the voice's free sample (no credits). Requires the catalog to be loaded.
      const url = previewUrlFor(voice);
      if (!url) { if (st) st.textContent = cachedVoices().length ? 'No preview sample for this voice.' : 'Tap “Load” first to fetch voice samples.'; return; }
      try {
        const audio = new Audio(url);
        _preview = { audio, url: '' };   // remote URL — nothing to revoke
        audio.onended = () => { const s = document.getElementById('rv-preview-status'); if (s) s.textContent = ''; _preview = null; };
        await audio.play();
        if (st) st.textContent = '▶ Playing sample…';
      } catch (e) {
        if (st) st.textContent = '⚠ ' + ((e && e.message) || 'Preview failed');
      }
    };

    const mk = document.getElementById('rv-makeaudio'); if (mk) mk.onclick = () => { stopPreview(); synthesizeEpisode(ep.id); };
    const ls = document.getElementById('rv-listen'); if (ls) ls.onclick = () => openPlayer(ep.id);
    const st = document.getElementById('rv-stop'); if (st) st.onclick = () => { RadioState.cancel = true; st.textContent = 'stopping…'; };
    const rg = document.getElementById('rv-regen'); if (rg) rg.onclick = async () => {
      stopPreview();
      const ch = getChannel(ep.channelId);
      if (!ch) { alert('This channel no longer exists.'); return; }
      if (!confirm('Discard this script (and any audio made so far) and write a new one?')) return;
      const len = ep.targetMin;
      await deleteEpisode(ep.id);
      RadioState.view = 'home';
      generateScripts(ch, len);
    };

    // fill in the script bodies from IndexedDB
    ep.segments.forEach(s => idbGet(ep.id + ':' + s.idx + ':txt').then(t => {
      const el = document.getElementById('rv-txt-' + s.idx);
      if (el) el.textContent = t || '(missing)';
    }));
  }

  /* ── Home (channel grid + episodes) ────────────────────────────────────── */
  function channelCard(ch) {
    const ep = latestEpisodeFor(ch.id);
    const genHere = RadioState.generating && RadioState.genEpId && getEpisode(RadioState.genEpId) && getEpisode(RadioState.genEpId).channelId === ch.id;
    let statusLine = '';
    if (genHere) {
      const g = getEpisode(RadioState.genEpId);
      if (g.status === 'synthesizing') {
        const done = g.segments.filter(s => s.hasAudio).length;
        statusLine = `<div class="rc-status">🔊 Creating audio… ${done}/${g.segments.length} <button class="rc-cancel" data-cancel="1">stop</button></div>`;
      } else {
        const tot = g.plannedCount || Math.round((g.targetMin * 60) / SEC_PER_SEGMENT);
        statusLine = `<div class="rc-status">✍ Writing script… ${g.segments.length}/${tot || '?'} <button class="rc-cancel" data-cancel="1">stop</button></div>`;
      }
    } else if (ep && ep.status === 'ready') {
      const db = driveBadge(ep);
      statusLine = `<div class="rc-status">✓ Episode ready · ~${Math.round(epSeconds(ep) / 60)} min${db ? ' · ' + escapeHtml(db) : ''}</div>`;
    } else if (ep && ep.status === 'draft') {
      statusLine = `<div class="rc-status">📝 Draft script ready — review &amp; create audio</div>`;
    } else if (ep && ep.status === 'error') {
      statusLine = `<div class="rc-status err">⚠ ${escapeHtml(ep.error || 'generation failed')}</div>`;
    }
    const lenOpts = LENGTHS.map(m => `<option value="${m}" ${m === 30 ? 'selected' : ''}>${m >= 60 ? (m / 60) + 'h' : m + ' min'}</option>`).join('');
    const ready = ep && ep.status === 'ready' && ep.segments.some(s => s.hasAudio);
    const draft = ep && ep.status === 'draft';
    return `
      <div class="rc-card">
        <div class="rc-head" data-edit="${ch.id}" title="Edit prompt">
          <span class="rc-emoji">${escapeHtml(ch.emoji || '🎙️')}</span>
          <div><div class="rc-name">${escapeHtml(ch.name)}${ch.custom ? ' <span class="rc-tag">custom</span>' : ch.edited ? ' <span class="rc-tag">edited</span>' : ''}</div>
            <div class="rc-topic">${escapeHtml(ch.topic)}</div></div>
        </div>
        ${statusLine}
        <div class="rc-actions">
          <select class="rc-len" data-ch="${ch.id}" ${RadioState.generating ? 'disabled' : ''}>${lenOpts}</select>
          <button class="btn secondary sm rc-gen" data-ch="${ch.id}" ${RadioState.generating ? 'disabled' : ''}>${ep ? 'New script' : 'Write script'}</button>
          ${draft ? `<button class="btn sm rc-review" data-ep="${ep.id}">📝 Review</button>` : ''}
          ${ready ? `<button class="btn sm rc-listen" data-ep="${ep.id}">▶ Listen</button>` : ''}
        </div>
      </div>`;
  }

  function episodesSection() {
    const eps = loadEpisodes().filter(e => e.segments && e.segments.length).sort((a, b) => b.createdAt - a.createdAt);
    if (!eps.length) return '';
    const rows = eps.map(e => {
      const ready = e.status === 'ready' && e.segments.some(s => s.hasAudio);
      const tag = ready ? '' : (e.status === 'draft' ? ' · draft' : e.status === 'synthesizing' ? ' · baking audio' : e.status === 'scripting' ? ' · writing' : '');
      return `
      <div class="rep-row">
        <button class="rep-open" data-ep="${e.id}" data-ready="${ready ? 1 : 0}">
          <span class="rc-emoji">${escapeHtml(e.emoji || '📻')}</span>
          <span><strong>${escapeHtml(e.channelName)}</strong>
            <span class="text-xs text-muted">${escapeHtml(fmtDate(new Date(e.createdAt).toISOString().slice(0, 10)))} · ~${Math.round(epSeconds(e) / 60)} min${tag}</span></span>
        </button>
        <button class="iconbtn rep-del" data-del="${e.id}" title="Delete">✕</button>
      </div>`;
    }).join('');
    return `<div class="card" style="margin-top:14px;"><h2>Your episodes</h2>${rows}</div>`;
  }

  function renderHome() {
    const view = document.getElementById('view');
    document.getElementById('topbar-title').textContent = 'Radio';
    document.getElementById('topbar-sub').textContent = 'DJ stations';

    if (!hasClaudeKey()) {
      view.innerHTML = `
        <div class="card">
          <h2>📻 Radio station</h2>
          <p class="note">Generate on-demand, talk-radio style audio shows — pick a topic & host, read the script, then turn it into audio you can play with pause / rewind / resume. You'll need a <strong>Claude API key</strong> to write the shows (and an <strong>ElevenLabs API key</strong> to voice them).</p>
          <button class="btn block mt-2" id="radio-go-setup">Go to Setup</button>
          <div class="text-xs text-muted mt-1">Keys are stored only in this browser.</div>
        </div>`;
      document.getElementById('radio-go-setup').onclick = () => go('/setup');
      return;
    }

    const ttsBanner = hasElevenKey() ? '' :
      `<div class="rc-status err" style="margin-bottom:10px;">Add an ElevenLabs key in Setup to turn scripts into audio. You can still write & read scripts now.</div>`;
    const cards = allChannels().map(channelCard).join('');
    view.innerHTML = `
      <div class="radio-home">
        ${ttsBanner}
        <div class="rc-grid">${cards}</div>
        <button class="btn secondary block" id="radio-add" style="margin-top:12px;" ${RadioState.generating ? 'disabled' : ''}>＋ Custom channel</button>
        ${episodesSection()}
        <div class="text-xs text-muted" style="margin:14px 0 28px;text-align:center;">Audio is generated once and saved on this device for offline listening.</div>
      </div>`;

    view.querySelectorAll('.rc-gen').forEach(b => b.onclick = () => {
      const ch = getChannel(b.dataset.ch);
      const sel = view.querySelector(`.rc-len[data-ch="${b.dataset.ch}"]`);
      generateScripts(ch, Number(sel ? sel.value : 30));
    });
    view.querySelectorAll('.rc-review').forEach(b => b.onclick = () => openReview(b.dataset.ep));
    view.querySelectorAll('.rc-cancel').forEach(b => b.onclick = () => { RadioState.cancel = true; b.textContent = 'stopping…'; });
    view.querySelectorAll('.rc-listen').forEach(b => b.onclick = () => openPlayer(b.dataset.ep));
    view.querySelectorAll('.rep-open').forEach(b => b.onclick = () => { if (b.dataset.ready === '1') openPlayer(b.dataset.ep); else openReview(b.dataset.ep); });
    view.querySelectorAll('.rep-del').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this episode and its audio?')) return;
      await deleteEpisode(b.dataset.del);
      renderRadio();
    });
    view.querySelectorAll('.rc-head[data-edit]').forEach(h => { if (h.dataset.edit) h.onclick = () => openChannelEditor(getChannel(h.dataset.edit)); });
    document.getElementById('radio-add').onclick = () => openChannelEditor(null);
  }

  /* ── Entry point (router calls this) ───────────────────────────────────── */
  function renderRadio() {
    injectStyles();
    document.querySelectorAll('.bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.route === 'radio'));
    if (RadioState.view === 'player' && RadioState.epId && getEpisode(RadioState.epId)) renderPlayer();
    else if (RadioState.view === 'review' && RadioState.epId && getEpisode(RadioState.epId)) renderReview();
    else { RadioState.view = 'home'; renderHome(); }
  }

  /* ── Styles ────────────────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('radio-styles')) return;
    const css = `
      .rc-grid { display:flex; flex-direction:column; gap:10px; }
      .rc-card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:12px 14px; }
      .rc-head { display:flex; align-items:flex-start; gap:10px; }
      .rc-head[data-edit]:not([data-edit=""]) { cursor:pointer; }
      .rc-emoji { font-size:1.5rem; line-height:1.2; }
      .rc-card .rc-name { font-weight:700; color:var(--accent-d); }
      .rc-tag { font-size:0.62rem; font-weight:600; color:var(--muted); border:1px solid var(--border); border-radius:6px; padding:1px 5px; vertical-align:middle; }
      .rc-topic { font-size:0.8rem; color:var(--muted); margin-top:2px; }
      .rc-status { font-size:0.78rem; color:var(--green-d, #3f5b43); margin:8px 0 2px; }
      .rc-status.err { color:var(--red, #c0392b); }
      .rc-cancel { color:var(--red, #c0392b); font-weight:600; font-size:0.74rem; margin-left:6px; text-decoration:underline; }
      .rc-actions { display:flex; align-items:center; gap:8px; margin-top:10px; flex-wrap:wrap; }
      .rc-len { padding:6px 8px; border-radius:8px; border:1px solid var(--border); background:var(--paper); color:var(--text); font-size:0.82rem; }
      .btn.sm, .rc-gen, .rc-listen { padding:7px 12px; font-size:0.82rem; }
      .rep-row { display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--border); }
      .rep-open { flex:1; display:flex; align-items:center; gap:10px; text-align:left; }
      .rep-open span span { display:block; }
      .radio-player { display:flex; flex-direction:column; align-items:center; text-align:center; padding:8px 4px 40px; }
      .radio-back { align-self:flex-start; color:var(--accent); font-weight:600; padding:6px 2px; }
      .rp-art { font-size:5rem; margin:18px 0 6px; }
      .radio-player .rp-name { font-size:1.3rem; font-weight:700; color:var(--accent-d); }
      .rp-meta { font-size:0.78rem; color:var(--muted); margin-top:4px; }
      .rp-seg { font-size:0.85rem; color:var(--text); margin:16px 0 8px; min-height:1.2em; padding:0 8px; }
      #rp-seek { width:100%; max-width:420px; accent-color:var(--accent); margin:6px 0; }
      .rp-time { width:100%; max-width:420px; display:flex; justify-content:space-between; font-size:0.72rem; color:var(--muted); }
      .rp-controls { display:flex; align-items:center; gap:14px; margin-top:18px; }
      .rp-controls button { font-size:1.1rem; font-weight:700; color:var(--accent-d); min-width:48px; padding:8px; }
      .rp-controls .rp-main { width:64px; height:64px; border-radius:50%; background:var(--accent); color:#fff; font-size:1.5rem; }
      .rp-status { font-size:0.8rem; color:var(--muted); margin-top:16px; min-height:1.2em; }
      .rp-script { width:100%; max-width:440px; margin-top:22px; text-align:left; border:1px solid var(--border); border-radius:10px; background:var(--card); }
      .rp-script summary { cursor:pointer; padding:9px 12px; font-weight:600; color:var(--accent-d); user-select:none; }
      .rp-scripttext { padding:0 12px 12px; font-size:0.9rem; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; }
      .radio-review { padding-bottom:40px; }
      .rv-head { display:flex; align-items:flex-start; gap:10px; margin:8px 0 4px; }
      .radio-review .rc-name { font-weight:700; color:var(--accent-d); }
      .rv-voice { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:12px 0 0; }
      .rv-voice label { font-size:0.82rem; font-weight:600; color:var(--muted); }
      .rv-voice select { flex:1; min-width:150px; padding:7px 8px; border-radius:6px; border:1px solid var(--border); background:var(--card); color:var(--text); }
      .rv-preview-status { font-size:0.8rem; color:var(--muted); width:100%; }
      .rv-actions { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0 4px; }
      .rv-progress { font-size:0.8rem; color:var(--muted); margin:4px 0 14px; }
      .rv-list { display:flex; flex-direction:column; gap:12px; }
      .rv-seg { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:11px 13px; }
      .rv-seg-title { font-weight:700; color:var(--accent-d); font-size:0.9rem; margin-bottom:6px; }
      .rv-seg-text { font-size:0.92rem; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; }
    `;
    const el = document.createElement('style');
    el.id = 'radio-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  window.renderRadio = renderRadio;
})();
