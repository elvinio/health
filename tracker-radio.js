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
  const TTS_KEY    = 'health:googleTtsKey';    // new — Cloud TTS API key
  const EP_KEY     = 'health:radio:episodes';  // episode manifests (localStorage)
  const CH_KEY     = 'health:radioChannels';   // custom channels (localStorage)
  const PRESET_OV_KEY = 'health:radioPresetOverrides'; // per-preset prompt/setting edits (localStorage)
  const PROG_KEY   = 'health:radio:progress';  // { [epId]: { idx, time } }
  const CHAT_MODELS = { 'claude-sonnet-4-6': 1, 'claude-opus-4-8': 1 };
  const DEFAULT_MODEL = 'claude-sonnet-4-6';
  const WORDS_PER_SEC = 2.5;        // ~150 wpm spoken pace
  const SEC_PER_SEGMENT = 150;      // target segment length (used to pick count)
  const TTS_CHAR_LIMIT = 4800;      // Cloud TTS caps input at 5000 bytes

  /* ── Built-in DJ channels ──────────────────────────────────────────────── */
  // persona = Claude system prompt that sets the host's voice & worldview.
  // voice   = Google Cloud TTS voice name (Neural2 = natural, $16/1M chars).
  const RADIO_PRESETS = [
    { id: 'current-affairs', name: 'The Signal', emoji: '📰', topic: 'current affairs and world events',
      voice: 'en-US-Neural2-J', languageCode: 'en-US',
      persona: "You are The Signal, a late-night current-affairs host. You interpret the news rather than just report it — connecting today's events to longer patterns and human stakes. Measured authority, no sensationalism, no doom-mongering. Speak to one thoughtful listener." },
    { id: 'self-improvement', name: 'The Coach', emoji: '🌱', topic: 'self-improvement, habits and personal growth',
      voice: 'en-US-Neural2-D', languageCode: 'en-US',
      persona: "You are The Coach, a grounded self-improvement host. Practical, warm, never cheesy or hustle-culture. You offer one usable idea at a time, with real examples, and respect the listener's intelligence. No exclamation points, no empty hype." },
    { id: 'science', name: 'The Curious', emoji: '🔬', topic: 'science, nature and discovery',
      voice: 'en-US-Neural2-A', languageCode: 'en-US',
      persona: "You are The Curious, a science host driven by genuine wonder. You explain one idea through vivid, concrete images, building from the familiar to the surprising. Accurate but never dry; you make the listener feel the awe of how the world works." },
    { id: 'art', name: 'The Curator', emoji: '🎨', topic: 'art, design and aesthetics',
      voice: 'en-GB-Neural2-B', languageCode: 'en-GB',
      persona: "You are The Curator, a thoughtful art and culture host with a British sensibility. You linger on a single work, movement or idea, noticing details others miss, drawing out why it matters. Unhurried, evocative, a little poetic." },
    { id: 'ai', name: 'The Architect', emoji: '🤖', topic: 'artificial intelligence and technology',
      voice: 'en-US-Neural2-I', languageCode: 'en-US',
      persona: "You are The Architect, a lucid AI and technology host. You cut through hype with clear mental models, honest about both promise and limits. You explain how things actually work and what they mean for ordinary life. Calm, precise, never breathless." },
    { id: 'philosophy', name: 'The Liminal Operator', emoji: '🌌', topic: 'philosophy, consciousness and meaning',
      voice: 'en-US-Neural2-J', languageCode: 'en-US',
      persona: "You are the Liminal Operator, the late-night voice of an all-night station. You speak to one person at a time, even when thousands are listening. Your delivery is measured and unhurried; silence and pauses are part of your speech. You explore philosophy — consciousness, time, meaning, solitude — through vivid concrete images and open questions, never lectures. You never use exclamation points, never shout, never use radio clichés like 'up next' or 'stay tuned'. You avoid sensationalism and false warmth. Speak as if it is 3am and the city is asleep." },
    { id: 'fitness', name: 'The Drill', emoji: '💪', topic: 'fitness, training and physical health',
      voice: 'en-US-Neural2-D', languageCode: 'en-US',
      persona: "You are The Drill, an energetic but grounded fitness host. Motivating without drill-sergeant clichés or bro-science. You give evidence-based ideas on training, recovery and movement, and make the listener want to move. Confident, encouraging, real." },
  ];

  /* ── Cloud TTS voice options (for the custom-channel editor) ───────────── */
  const VOICE_OPTIONS = [
    { v: 'en-US-Neural2-J', l: 'US English — Male (J)' },
    { v: 'en-US-Neural2-D', l: 'US English — Male (D)' },
    { v: 'en-US-Neural2-A', l: 'US English — Male (A)' },
    { v: 'en-US-Neural2-I', l: 'US English — Male (I)' },
    { v: 'en-US-Neural2-C', l: 'US English — Female (C)' },
    { v: 'en-US-Neural2-F', l: 'US English — Female (F)' },
    { v: 'en-US-Neural2-H', l: 'US English — Female (H)' },
    { v: 'en-GB-Neural2-B', l: 'British English — Male (B)' },
    { v: 'en-GB-Neural2-A', l: 'British English — Female (A)' },
    { v: 'en-AU-Neural2-B', l: 'Australian English — Male (B)' },
  ];
  const LANG_OF = v => v.split('-').slice(0, 2).join('-');

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
  };

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function defaultModel() { const m = localStorage.getItem(MODEL_KEY); return CHAT_MODELS[m] ? m : DEFAULT_MODEL; }
  function hasClaudeKey() { return !!(localStorage.getItem(CLAUDE_KEY) || '').trim(); }
  function hasTtsKey() { return !!(localStorage.getItem(TTS_KEY) || '').trim(); }
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

  /* ── Google Cloud Text-to-Speech (MP3 out) ─────────────────────────────── */
  async function synthesizeTTS(text, voice, languageCode) {
    const key = (localStorage.getItem(TTS_KEY) || '').trim();
    if (!key) throw new Error('No Google TTS API key. Add it in Setup → Radio station.');
    let input = text.length > TTS_CHAR_LIMIT ? text.slice(0, TTS_CHAR_LIMIT) : text;
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text: input }, voice: { name: voice, languageCode: languageCode || LANG_OF(voice) }, audioConfig: { audioEncoding: 'MP3' } }),
    });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.error && j.error.message ? j.error.message : ''; } catch (e) { detail = (await res.text().catch(() => '')).slice(0, 200); }
      throw new Error('Cloud TTS ' + res.status + (detail ? ': ' + detail : ''));
    }
    const data = await res.json();
    if (!data.audioContent) throw new Error('Cloud TTS returned no audio.');
    const bin = atob(data.audioContent);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'audio/mpeg' });
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
      voice: channel.voice, languageCode: channel.languageCode || LANG_OF(channel.voice),
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
    if (!hasTtsKey()) { alert('Add your Google TTS API key in Setup → Radio station first.'); return; }
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
        const blob = await synthesizeTTS(text, ep.voice, ep.languageCode);
        await idbPut(epId + ':' + i, blob);
        ep.segments[i].hasAudio = true;
        saveEpisode(ep);
        rerenderActive();
      }
      ep.status = ep.segments.every(s => s.hasAudio) ? 'ready' : 'draft';
      saveEpisode(ep);
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

  /* ── Custom channel editor ─────────────────────────────────────────────── */
  function openChannelEditor(existing) {
    const isPreset = !!(existing && !existing.custom);
    const c = existing || { id: '', name: '', emoji: '🎙️', topic: '', persona: '', voice: 'en-US-Neural2-J' };
    const voiceOpts = VOICE_OPTIONS.map(o => `<option value="${o.v}" ${o.v === c.voice ? 'selected' : ''}>${escapeHtml(o.l)}</option>`).join('');
    showModal(`
      <div class="field"><label>Channel name</label><input type="text" id="rc-name" placeholder="e.g. Night Market" value="${escapeHtml(c.name)}"></div>
      <div class="field"><label>Emoji</label><input type="text" id="rc-emoji" maxlength="4" placeholder="🎙️" value="${escapeHtml(c.emoji)}"></div>
      <div class="field"><label>Topic / theme</label><input type="text" id="rc-topic" placeholder="e.g. food history and street cuisine" value="${escapeHtml(c.topic)}"></div>
      <div class="field"><label>Host persona <span class="text-muted text-xs">(the prompt — how the DJ talks)</span></label>
        <textarea id="rc-persona" rows="6" placeholder="You are …, a host who …">${escapeHtml(c.persona)}</textarea></div>
      <div class="field"><label>Voice</label>
        <select id="rc-voice" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);">${voiceOpts}</select></div>
      <div class="row gap-sm mt-2">
        <button class="btn block" id="rc-save">${existing ? 'Save' : 'Create channel'}</button>
        ${isPreset ? '<button class="btn secondary" id="rc-reset">Reset</button>' : existing ? '<button class="btn secondary" id="rc-del">Delete</button>' : ''}
      </div>
    `, !existing ? 'New custom channel' : isPreset ? 'Edit channel prompt' : 'Edit channel');

    document.getElementById('rc-save').onclick = () => {
      const name = document.getElementById('rc-name').value.trim();
      const topic = document.getElementById('rc-topic').value.trim();
      const persona = document.getElementById('rc-persona').value.trim();
      if (!name || !topic || !persona) { alert('Name, topic and persona are all required.'); return; }
      const voice = document.getElementById('rc-voice').value;
      const emoji = document.getElementById('rc-emoji').value.trim() || '🎙️';
      if (isPreset) {
        const ov = loadPresetOv();
        ov[existing.id] = { name, topic, persona, voice, languageCode: LANG_OF(voice), emoji };
        savePresetOv(ov);
      } else {
        const list = loadCustom();
        if (existing) {
          const i = list.findIndex(x => x.id === existing.id);
          const updated = { ...existing, name, topic, persona, voice, languageCode: LANG_OF(voice), emoji };
          if (i >= 0) list[i] = updated; else list.push(updated);
        } else {
          list.push({ id: 'custom-' + uid(), name, topic, persona, voice, languageCode: LANG_OF(voice), emoji, custom: true });
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
  function teardownAudio() {
    if (RadioState.audio) { try { RadioState.audio.pause(); } catch (e) {} RadioState.audio = null; }
    if (RadioState.objUrl) { try { URL.revokeObjectURL(RadioState.objUrl); } catch (e) {} RadioState.objUrl = null; }
    if (RadioState.saveTimer) { clearInterval(RadioState.saveTimer); RadioState.saveTimer = 0; }
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
  function updatePlayBtn() { const b = document.getElementById('rp-play'); const a = RadioState.audio; if (b && a) b.textContent = a.paused ? '▶' : '⏸'; }

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
    const seek = document.getElementById('rp-seek');
    let seeking = false;

    audio.addEventListener('timeupdate', () => {
      if (!seeking && audio.duration) seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
      const cur = document.getElementById('rp-cur'); if (cur) cur.textContent = mmss(audio.currentTime);
      const dur = document.getElementById('rp-dur'); if (dur) dur.textContent = mmss(audio.duration);
    });
    audio.addEventListener('play', updatePlayBtn);
    audio.addEventListener('pause', () => { updatePlayBtn(); saveProgress(ep.id, RadioState.curIdx, audio.currentTime); });
    audio.addEventListener('ended', () => { saveProgress(ep.id, RadioState.curIdx, 0); loadSegment(RadioState.curIdx + 1, true, 0); });
    seek.addEventListener('input', () => { seeking = true; const c = document.getElementById('rp-cur'); if (c && audio.duration) c.textContent = mmss((seek.value / 1000) * audio.duration); });
    seek.addEventListener('change', () => { if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; seeking = false; });

    document.getElementById('rp-back').onclick = () => { teardownAudio(); RadioState.view = 'home'; renderRadio(); };
    document.getElementById('rp-play').onclick = () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); };
    document.getElementById('rp-back15').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 15); };
    document.getElementById('rp-fwd15').onclick = () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15); };
    document.getElementById('rp-prev').onclick = () => { if (audio.currentTime > 3) { audio.currentTime = 0; } else { loadSegment(RadioState.curIdx - 1, true, 0); } };
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
        <div class="rv-actions">
          ${ready
            ? `<button class="btn" id="rv-listen">▶ Listen</button>`
            : `<button class="btn" id="rv-makeaudio" ${busy ? 'disabled' : ''}>${synth ? 'Creating audio…' : '🔊 Create audio'}</button>`}
          <button class="btn secondary" id="rv-regen" ${busy ? 'disabled' : ''}>↻ Regenerate</button>
          ${busy && synth ? '<button class="btn secondary" id="rv-stop">Stop</button>' : ''}
        </div>
        <div class="rv-progress" id="rv-progress">${synth
          ? `Creating audio… ${ep.segments.filter(s => s.hasAudio).length}/${ep.segments.length} segments`
          : (ready ? 'All audio ready.' : 'Read the script below, then tap Create audio.')}</div>
        <div class="rv-list">${segHtml}</div>
      </div>`;

    document.getElementById('rv-back').onclick = () => { RadioState.view = 'home'; renderRadio(); };
    const mk = document.getElementById('rv-makeaudio'); if (mk) mk.onclick = () => synthesizeEpisode(ep.id);
    const ls = document.getElementById('rv-listen'); if (ls) ls.onclick = () => openPlayer(ep.id);
    const st = document.getElementById('rv-stop'); if (st) st.onclick = () => { RadioState.cancel = true; st.textContent = 'stopping…'; };
    const rg = document.getElementById('rv-regen'); if (rg) rg.onclick = async () => {
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
      statusLine = `<div class="rc-status">✓ Episode ready · ~${Math.round(epSeconds(ep) / 60)} min</div>`;
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
          <p class="note">Generate on-demand, talk-radio style audio shows — pick a topic & host, read the script, then turn it into audio you can play with pause / rewind / resume. You'll need a <strong>Claude API key</strong> to write the shows (and a <strong>Google TTS key</strong> to voice them).</p>
          <button class="btn block mt-2" id="radio-go-setup">Go to Setup</button>
          <div class="text-xs text-muted mt-1">Keys are stored only in this browser.</div>
        </div>`;
      document.getElementById('radio-go-setup').onclick = () => go('/setup');
      return;
    }

    const ttsBanner = hasTtsKey() ? '' :
      `<div class="rc-status err" style="margin-bottom:10px;">Add a Google TTS key in Setup to turn scripts into audio. You can still write & read scripts now.</div>`;
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
