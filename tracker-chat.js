/* ════════════════════════════════════════════════════════════════════════
   tracker-chat.js — Claude chat agent for the Health Tracker PWA

   Adds a "Chat" tab that talks to Claude as a turn-by-turn agent. Uses the
   official browser-capable JS SDK (@anthropic-ai/sdk) loaded as an ESM module
   from a CDN — no build step. The agent loop (tool use) is implemented here.

   Capabilities:
     • Sonnet / Opus model choice, with live per-message cost + token counts
     • Prompt caching (system + tools, and the conversation prefix)
     • Tools: browse workout history, browse health history, read the current
       program, and create / modify / activate workout programs (activation is
       gated behind a confirmation tap)
     • Streamed responses, visible tool calls + results, saved chat sessions,
       new-session support — all per profile, persisted in localStorage.

   Relies on globals defined by the inline script in tracker.html:
     Storage, escapeHtml, showModal, closeModal, todayISO, fmtDate,
     getActiveProgram, BUILT_IN_PROGRAMS.
   Exposes window.renderChat(), called by the router.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
(function () {

  /* ── Config: models + pricing (USD per 1M tokens) ──────────────────────── */
  const SDK_URL = 'https://esm.sh/@anthropic-ai/sdk@0.69.0';
  const KEY_STORE = 'health:anthropicKey';
  const MODEL_STORE = 'health:chatModel';
  const DEFAULT_MODEL = 'claude-sonnet-4-6';
  const MAX_TOKENS = 8000;
  const TOOL_LOOP_GUARD = 16;

  // Cache write = 1.25× input, cache read = 0.1× input.
  const CHAT_MODELS = {
    'claude-sonnet-4-6': { label: 'Sonnet 4.6', in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.30 },
    'claude-opus-4-8':   { label: 'Opus 4.8',   in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.50 },
  };

  /* ── In-memory UI state ────────────────────────────────────────────────── */
  const ChatState = { pid: null, sessionId: null, busy: false, stream: null, controller: null, notes: [] };

  /* ── Anthropic client (lazy ESM import) ────────────────────────────────── */
  let _anthropic = null;
  let _anthropicKey = null;
  async function getAnthropic() {
    const key = (localStorage.getItem(KEY_STORE) || '').trim();
    if (!key) throw new Error('No API key set. Add it in Setup → AI Chat.');
    if (_anthropic && _anthropicKey === key) return _anthropic;
    let Anthropic;
    try {
      ({ default: Anthropic } = await import(/* @vite-ignore */ SDK_URL));
    } catch (e) {
      throw new Error('Could not load the Claude SDK (network?). ' + (e.message || ''));
    }
    _anthropic = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    _anthropicKey = key;
    return _anthropic;
  }

  function hasApiKey() { return !!(localStorage.getItem(KEY_STORE) || '').trim(); }
  function defaultModel() {
    const m = localStorage.getItem(MODEL_STORE);
    return CHAT_MODELS[m] ? m : DEFAULT_MODEL;
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function costOf(usage, model) {
    const p = CHAT_MODELS[model];
    if (!p || !usage) return 0;
    return (
      (usage.input_tokens || 0) * p.in +
      (usage.output_tokens || 0) * p.out +
      (usage.cache_creation_input_tokens || 0) * p.cacheWrite +
      (usage.cache_read_input_tokens || 0) * p.cacheRead
    ) / 1e6;
  }
  function tokensOf(usage) {
    if (!usage) return 0;
    return (usage.input_tokens || 0) + (usage.output_tokens || 0) +
      (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  }
  function fmtCost(c) { return '$' + (c < 0.01 ? c.toFixed(4) : c.toFixed(3)); }

  /* ── Chat-session storage (per profile, inside health:v1) ──────────────── */
  function profileData(pid) {
    pid = pid || Storage.getActiveProfile();
    const pd = Storage.load().perProfile[pid];
    if (!Array.isArray(pd.chatSessions)) pd.chatSessions = [];
    return pd;
  }
  function getSessions(pid) {
    return profileData(pid).chatSessions.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  function newSession(pid) {
    const s = {
      id: uid(), title: 'New chat', model: defaultModel(),
      createdAt: Date.now(), updatedAt: Date.now(),
      messages: [], totalCost: 0, totalTokens: 0,
    };
    profileData(pid).chatSessions.push(s);
    Storage.save();
    return s;
  }
  function deleteSession(id, pid) {
    const pd = profileData(pid);
    pd.chatSessions = pd.chatSessions.filter(s => s.id !== id);
    Storage.save();
  }
  function currentSession() {
    const pid = Storage.getActiveProfile();
    const list = getSessions(pid);
    let s = list.find(x => x.id === ChatState.sessionId);
    if (!s) s = list[0] || newSession(pid);
    ChatState.sessionId = s.id;
    ChatState.pid = pid;
    return s;
  }

  /* ── System prompt ─────────────────────────────────────────────────────── */
  function buildSystemPrompt(pid) {
    const data = Storage.load();
    const prof = data.profiles[pid] || {};
    const prog = getActiveProgram();
    const cfg = Storage.getConfig(pid) || {};
    const sessions = Storage.listSessions(pid);
    const reports = Storage.getHealthReports(pid);
    const visits = Storage.getDoctorVisits(pid);
    const customs = Object.values(data.importedPrograms || {});
    const progList = [...BUILT_IN_PROGRAMS, ...customs]
      .map(p => `- ${p.id}${p.id === prog.id ? ' (active)' : ''}${BUILT_IN_PROGRAMS.some(b => b.id === p.id) ? ' [built-in, read-only]' : ' [custom]'}: ${p.name}`)
      .join('\n');

    return `You are a knowledgeable, encouraging strength & conditioning coach embedded in a personal health-tracker app. You help the user understand their training and health data and design or adjust workout programs.

User profile
- Name: ${prof.name || pid}
- Sex: ${prof.gender || 'unspecified'}
- Today: ${todayISO()}
- Active program: ${prog.name} (id: ${prog.id})
- Current cycle: ${cfg.cycleNumber || 1}${cfg.startDate ? `, started ${cfg.startDate}` : ''}
- Logged workouts: ${sessions.length} · Health reports: ${reports.length} · Doctor visits: ${visits.length}

Available programs
${progList || '(none)'}

Tools
- get_workout_history — read logged training sessions (weights, sets, RPE, heart rate). Call this before commenting on the user's training.
- get_health_history — read health reports (blood tests, etc.) and doctor visits.
- get_current_program — read the full active program structure plus the user's Week-1 baseline weights. Call this BEFORE creating or modifying a program so you mirror the exact JSON shape.
- create_program — save a NEW custom program. Provide a complete program object matching the shape returned by get_current_program: { name, description, weeks: {1:{phase,rpe,rest},...}, weekDefaultReps: {1:8,...}, days: [{day, weekday, name, type, purpose|notes, blocks: [{kind, name, superset?, roundsByWeek?, exercises:[{id, name, weightType, ...}]}]}] }. weightType is one of: none, db-pair, db-single, kb, barbell. Use stable lowercase-hyphen ids for weighted exercises.
- modify_program — replace an existing CUSTOM program (provide its programId and a full replacement program object). Built-in programs cannot be modified.
- activate_program — switch the user's active program. This changes what they see on the Today/Setup screens, so it ALWAYS asks the user to confirm first; report back what they chose.

Guidance
- Ground every claim in tool data — don't invent numbers. If unsure, fetch it.
- Be concise and practical. Use Markdown (headings, bold, lists, tables) for plans.
- When designing a program, briefly explain the rationale, then create it with create_program and offer to activate it. Never activate without the user clearly asking.`;
  }

  function systemBlocks(pid) {
    return [{ type: 'text', text: buildSystemPrompt(pid), cache_control: { type: 'ephemeral' } }];
  }

  /* ── Tool definitions ──────────────────────────────────────────────────── */
  const TOOLS = [
    {
      name: 'get_workout_history',
      description: 'List the user\'s logged workout sessions (most recent first) with weights, set counts, RPE and heart-rate data.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max sessions to return (default 20).' },
          since: { type: 'string', description: 'Only sessions on/after this YYYY-MM-DD date.' },
          until: { type: 'string', description: 'Only sessions on/before this YYYY-MM-DD date.' },
        },
      },
    },
    {
      name: 'get_health_history',
      description: 'List the user\'s health reports (blood tests, imaging, checkups) and doctor visits, most recent first.',
      input_schema: {
        type: 'object',
        properties: { limit: { type: 'integer', description: 'Max items of each kind to return (default 20).' } },
      },
    },
    {
      name: 'get_current_program',
      description: 'Return the full active program structure (weeks, days, blocks, exercises) plus the user\'s Week-1 baseline weights for the current cycle.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'create_program',
      description: 'Create and save a NEW custom workout program. Mirror the JSON shape from get_current_program.',
      input_schema: {
        type: 'object',
        properties: {
          program: { type: 'object', description: 'Full program object: { name, description, weeks, weekDefaultReps, days }. id is assigned automatically.' },
        },
        required: ['program'],
      },
    },
    {
      name: 'modify_program',
      description: 'Replace an existing CUSTOM program with a full updated program object. Built-in programs cannot be modified.',
      input_schema: {
        type: 'object',
        properties: {
          programId: { type: 'string', description: 'The id of the custom program to replace.' },
          program: { type: 'object', description: 'Full replacement program object (same shape as create_program).' },
        },
        required: ['programId', 'program'],
      },
    },
    {
      name: 'activate_program',
      description: 'Switch the user\'s active program (built-in or custom). Asks the user to confirm before applying.',
      input_schema: {
        type: 'object',
        properties: { programId: { type: 'string', description: 'The id of the program to activate.' } },
        required: ['programId'],
      },
    },
  ];

  /* ── Tool execution (client-side) ──────────────────────────────────────── */
  function exNameMap() {
    const map = {};
    try {
      const prog = getActiveProgram();
      for (const d of (prog.days || [])) {
        for (const b of (d.blocks || [])) {
          for (const ex of (b.exercises || [])) {
            if (ex.id) map[ex.id] = ex.name;
          }
        }
      }
    } catch (e) { /* ignore */ }
    return map;
  }

  function summarizeSession(s, names) {
    const exercises = Object.entries(s.exercises || {}).map(([id, ex]) => ({
      exercise: names[id] || id,
      actualWeight: ex.actualWeight != null ? ex.actualWeight : ex.plannedWeight,
      sets: (ex.sets || []).filter(st => st.endedAt).length,
      setDetail: (ex.sets || []).filter(st => st.endedAt).sort((a, b) => a.setIndex - b.setIndex).map(st => ({
        index: st.setIndex,
        rpe: st.rpe ?? null,
        durationSec: st.startedAt && st.endedAt ? Math.round((st.endedAt - st.startedAt) / 1000) : null,
        hr: st.hrAvg != null ? { avg: st.hrAvg, max: st.hrMax, min: st.hrMin ?? null } : null,
        rest: st.restHrAvg != null ? { avg: st.restHrAvg, max: st.restHrMax ?? null, min: st.restHrMin ?? null, durationSec: st.restSeconds ?? null } : null,
        hrRecovery: st.hrRecovery ?? null,
      })),
    }));
    return {
      date: s.date, week: s.week, day: s.day,
      completed: !!s.completedAt,
      exercises,
      cardio: s.cardio ? { distanceMeters: s.cardio.distanceMeters, hrAvg: s.cardio.hrAvg, hrMax: s.cardio.hrMax, hrMin: s.cardio.hrMin ?? null } : null,
      warmupHr: s.warmup ? { hrAvg: s.warmup.hrAvg, hrMax: s.warmup.hrMax, hrMin: s.warmup.hrMin ?? null } : null,
    };
  }

  function validateProgram(p) {
    if (!p || typeof p !== 'object') throw new Error('program must be an object');
    if (!p.name || typeof p.name !== 'string') throw new Error('program.name is required');
    if (!Array.isArray(p.days) || p.days.length === 0) throw new Error('program.days must be a non-empty array');
  }
  function normalizeProgram(p, id) {
    validateProgram(p);
    const out = { ...p };
    out.id = id || ('custom-' + (String(p.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'program') + '-' + uid().slice(0, 4));
    if (!out.weeks || typeof out.weeks !== 'object') out.weeks = { 1: { phase: '', rpe: '', rest: 60 } };
    if (!out.weekDefaultReps || typeof out.weekDefaultReps !== 'object') {
      out.weekDefaultReps = {};
      Object.keys(out.weeks).forEach(w => { out.weekDefaultReps[w] = 8; });
    }
    out.description = out.description || '';
    return out;
  }
  function isBuiltIn(id) { return BUILT_IN_PROGRAMS.some(p => p.id === id); }
  function programName(id) {
    const b = BUILT_IN_PROGRAMS.find(p => p.id === id);
    if (b) return b.name;
    const imp = Storage.getImportedProgram(id);
    return imp ? imp.name : null;
  }

  async function execTool(name, input) {
    const pid = Storage.getActiveProfile();
    input = input || {};
    if (name === 'get_workout_history') {
      const names = exNameMap();
      let list = Storage.listSessions(pid);
      if (input.since) list = list.filter(s => s.date >= input.since);
      if (input.until) list = list.filter(s => s.date <= input.until);
      const limit = Math.max(1, Math.min(input.limit || 20, 200));
      list = list.slice(0, limit);
      return JSON.stringify({ count: list.length, sessions: list.map(s => summarizeSession(s, names)) });
    }
    if (name === 'get_health_history') {
      const limit = Math.max(1, Math.min(input.limit || 20, 200));
      return JSON.stringify({
        healthReports: Storage.getHealthReports(pid).slice(0, limit),
        doctorVisits: Storage.getDoctorVisits(pid).slice(0, limit),
      });
    }
    if (name === 'get_current_program') {
      const prog = getActiveProgram();
      const cfg = Storage.getConfig(pid) || {};
      return JSON.stringify({
        program: prog,
        currentCycle: cfg.cycleNumber || 1,
        baselines: Storage.getBaselines(cfg.cycleNumber || 1, pid),
        builtIn: isBuiltIn(prog.id),
      });
    }
    if (name === 'create_program') {
      const prog = normalizeProgram(input.program);
      Storage.saveImportedProgram(prog);
      return JSON.stringify({ ok: true, id: prog.id, name: prog.name, note: 'Saved as a custom program. Use activate_program to make it active (the user will be asked to confirm).' });
    }
    if (name === 'modify_program') {
      const id = input.programId;
      if (!id) throw new Error('programId is required');
      if (isBuiltIn(id)) throw new Error('Built-in programs cannot be modified. Create a custom copy instead.');
      if (!Storage.getImportedProgram(id)) throw new Error('No custom program with id "' + id + '".');
      const prog = normalizeProgram(input.program, id);
      Storage.saveImportedProgram(prog);
      return JSON.stringify({ ok: true, id: prog.id, name: prog.name });
    }
    if (name === 'activate_program') {
      const id = input.programId;
      const nm = programName(id);
      if (!nm) throw new Error('No program with id "' + id + '".');
      const ok = await chatConfirm(`Switch your active program to “${nm}”?`, 'This changes your Today and Setup screens.');
      if (!ok) return JSON.stringify({ ok: false, activated: false, reason: 'User declined to switch programs.' });
      const cfg = Storage.getConfig(pid) || { startDate: todayISO(), cycleNumber: 1 };
      Storage.setConfig({ ...cfg, programId: id }, pid);
      return JSON.stringify({ ok: true, activated: true, id, name: nm });
    }
    throw new Error('Unknown tool: ' + name);
  }

  /* ── Confirm dialog (promise-based, built on showModal) ────────────────── */
  function chatConfirm(question, detail) {
    return new Promise(resolve => {
      showModal(`
        <p style="margin:4px 0 14px;">${escapeHtml(question)}</p>
        ${detail ? `<p class="text-xs text-muted" style="margin-bottom:16px;">${escapeHtml(detail)}</p>` : ''}
        <div class="row" style="display:flex;gap:10px;">
          <button class="btn block" id="chat-confirm-yes">Yes, switch</button>
          <button class="btn secondary block" id="chat-confirm-no">Cancel</button>
        </div>`, 'Confirm');
      const done = (v) => { closeModal(); resolve(v); };
      document.getElementById('chat-confirm-yes').onclick = () => done(true);
      document.getElementById('chat-confirm-no').onclick = () => done(false);
    });
  }

  /* ── Agent loop ────────────────────────────────────────────────────────── */
  function toApiMessages(messages) {
    // Strip UI metadata; tag the last content block for prefix caching.
    const api = messages.map(m => ({ role: m.role, content: m.content }));
    if (api.length) {
      const last = api[api.length - 1];
      const blocks = Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content) }];
      const tagged = blocks.map((b, i) => (i === blocks.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b));
      api[api.length - 1] = { role: last.role, content: tagged };
    }
    return api;
  }

  function friendlyError(e) {
    const status = e && e.status;
    if (status === 401) return 'Authentication failed — check your API key in Setup.';
    if (status === 429) return 'Rate limited — wait a moment and try again.';
    if (status === 400) return 'Request rejected: ' + (e.message || 'bad request');
    if (status >= 500) return 'Claude service error — try again shortly.';
    return e && e.message ? e.message : 'Something went wrong.';
  }

  async function runTurn(userText) {
    const s = currentSession();
    s.messages.push({ role: 'user', content: [{ type: 'text', text: userText }] });
    s.updatedAt = Date.now();
    if (!s.title || s.title === 'New chat') s.title = userText.slice(0, 48);
    Storage.save();
    ChatState.notes = [];
    renderThread();

    ChatState.busy = true;
    updateComposer();

    try {
      let guard = 0;
      while (guard++ < TOOL_LOOP_GUARD) {
        const client = await getAnthropic();
        const controller = new AbortController();
        ChatState.controller = controller;

        const stream = client.messages.stream({
          model: s.model,
          max_tokens: MAX_TOKENS,
          system: systemBlocks(ChatState.pid),
          tools: TOOLS,
          messages: toApiMessages(s.messages),
        }, { signal: controller.signal });
        ChatState.stream = stream;

        const live = liveBubble();
        let liveText = '';
        stream.on('text', t => { liveText += t; live.innerHTML = renderMarkdownLite(liveText); scrollBottom(); });

        const final = await stream.finalMessage();
        const meta = { model: s.model, usage: final.usage, cost: costOf(final.usage, s.model) };
        s.messages.push({ role: 'assistant', content: final.content, _meta: meta });
        s.totalCost = (s.totalCost || 0) + meta.cost;
        s.totalTokens = (s.totalTokens || 0) + tokensOf(final.usage);
        s.updatedAt = Date.now();
        Storage.save();
        renderThread();

        if (final.stop_reason !== 'tool_use') break;

        const toolUses = final.content.filter(b => b.type === 'tool_use');
        const results = [];
        for (const tu of toolUses) {
          let content, isErr = false;
          try { content = await execTool(tu.name, tu.input); }
          catch (e) { content = 'Error: ' + (e.message || e); isErr = true; }
          results.push({ type: 'tool_result', tool_use_id: tu.id, content, ...(isErr ? { is_error: true } : {}) });
        }
        s.messages.push({ role: 'user', content: results });
        Storage.save();
        renderThread();
      }
    } catch (e) {
      if (e && (e.name === 'APIUserAbortError' || /abort/i.test(e.message || ''))) {
        appendNote('⏹ Stopped.');
      } else {
        appendNote('⚠️ ' + friendlyError(e));
      }
    } finally {
      ChatState.busy = false;
      ChatState.stream = null;
      ChatState.controller = null;
      Storage.save();
      updateComposer();
      renderThread();
    }
  }

  function stopTurn() {
    try { if (ChatState.controller) ChatState.controller.abort(); } catch (e) { /* ignore */ }
    try { if (ChatState.stream && ChatState.stream.abort) ChatState.stream.abort(); } catch (e) { /* ignore */ }
  }

  /* ── Markdown (escape-first, XSS-safe) ─────────────────────────────────── */
  function renderMarkdownLite(md) {
    if (!md) return '';
    const esc = t => String(t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const inline = t => esc(t)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    const lines = String(md).replace(/\r\n/g, '\n').split('\n');
    let html = '', i = 0;
    const list = []; // stack of 'ul'|'ol'
    const closeLists = () => { while (list.length) html += list.pop() === 'ol' ? '</ol>' : '</ul>'; };

    while (i < lines.length) {
      const line = lines[i];

      // fenced code block
      const fence = line.match(/^```(.*)$/);
      if (fence) {
        closeLists();
        i++; let code = '';
        while (i < lines.length && !/^```/.test(lines[i])) { code += lines[i] + '\n'; i++; }
        i++; // skip closing fence
        html += '<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>';
        continue;
      }
      // table (header | --- | rows)
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        closeLists();
        const cells = r => r.replace(/^\s*\|?|\|?\s*$/g, '').split('|').map(c => c.trim());
        const head = cells(line);
        i += 2;
        let rows = '';
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
          rows += '<tr>' + cells(lines[i]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
          i++;
        }
        html += '<table class="md-table"><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table>';
        continue;
      }
      // heading
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeLists(); const lvl = h[1].length + 1; html += `<h${lvl}>` + inline(h[2]) + `</h${lvl}>`; i++; continue; }
      // hr
      if (/^\s*([-*_])\1\1+\s*$/.test(line)) { closeLists(); html += '<hr>'; i++; continue; }
      // unordered list
      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      if (ul) {
        if (list[list.length - 1] !== 'ul') { closeLists(); list.push('ul'); html += '<ul>'; }
        html += '<li>' + inline(ul[1]) + '</li>'; i++; continue;
      }
      // ordered list
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        if (list[list.length - 1] !== 'ol') { closeLists(); list.push('ol'); html += '<ol>'; }
        html += '<li>' + inline(ol[1]) + '</li>'; i++; continue;
      }
      // blank
      if (line.trim() === '') { closeLists(); i++; continue; }
      // paragraph (merge consecutive non-blank lines)
      closeLists();
      let para = line; i++;
      while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+[.)]\s|\s*([-*_])\2\2)/.test(lines[i]) && !/\|/.test(lines[i])) {
        para += '\n' + lines[i]; i++;
      }
      html += '<p>' + inline(para).replace(/\n/g, '<br>') + '</p>';
    }
    closeLists();
    return html;
  }

  /* ── Rendering ─────────────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('chat-styles')) return;
    const css = `
      .chat-wrap { display:flex; flex-direction:column; }
      .chat-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
      .chat-bar select { padding:6px 8px; border-radius:8px; border:1px solid var(--border); background:var(--card); color:var(--text); font-size:0.85rem; }
      .chat-bar .spacer { flex:1; }
      .chat-bar .chat-sum { font-size:0.72rem; color:var(--muted); white-space:nowrap; }
      .chat-bar button { padding:6px 10px; border-radius:8px; font-size:0.8rem; font-weight:600; border:1px solid var(--border); color:var(--accent); }
      .chat-bar button:active { background: color-mix(in srgb, var(--accent) 12%, transparent); }
      #chat-thread { display:flex; flex-direction:column; gap:12px; padding-bottom:130px; }
      .chat-empty { text-align:center; color:var(--muted); padding:40px 16px; font-size:0.9rem; }
      .msg { max-width:88%; padding:10px 12px; border-radius:14px; font-size:0.92rem; line-height:1.5; overflow-wrap:anywhere; }
      .msg.user { align-self:flex-end; background:var(--accent); color:#fff; border-bottom-right-radius:4px; }
      .msg.user a { color:#fff; text-decoration:underline; }
      .msg.assistant { align-self:flex-start; background:var(--card); border:1px solid var(--border); border-bottom-left-radius:4px; }
      .msg.assistant p:first-child { margin-top:0; } .msg.assistant p:last-child { margin-bottom:0; }
      .msg.assistant p { margin:0 0 8px; } .msg.assistant ul,.msg.assistant ol { margin:4px 0 8px; padding-left:20px; }
      .msg.assistant h2,.msg.assistant h3,.msg.assistant h4,.msg.assistant h5 { margin:10px 0 6px; color:var(--accent-d); font-size:0.95rem; }
      .msg.assistant code { background:var(--paper); padding:1px 5px; border-radius:5px; font-family:var(--mono); font-size:0.85em; }
      .msg.assistant pre { background:var(--paper); padding:10px; border-radius:8px; overflow-x:auto; margin:6px 0; }
      .msg.assistant pre code { background:none; padding:0; }
      .md-table { border-collapse:collapse; width:100%; margin:6px 0; font-size:0.82rem; }
      .md-table th,.md-table td { border:1px solid var(--border); padding:4px 7px; text-align:left; }
      .msg-note { align-self:center; color:var(--muted); font-size:0.8rem; padding:4px 10px; }
      .tool-card { align-self:flex-start; max-width:88%; border:1px solid var(--border); border-radius:10px; background:var(--paper); font-size:0.78rem; overflow:hidden; }
      .tool-card summary { cursor:pointer; padding:7px 10px; font-weight:600; color:var(--accent-d); user-select:none; }
      .tool-card pre { margin:0; padding:8px 10px; border-top:1px solid var(--border); overflow-x:auto; font-family:var(--mono); font-size:0.72rem; white-space:pre-wrap; overflow-wrap:anywhere; max-height:280px; }
      .tool-card.err summary { color:var(--red, #c0392b); }
      .msg-foot { align-self:flex-start; font-size:0.68rem; color:var(--muted); margin:-6px 0 2px 2px; }
      .chat-composer { position:fixed; left:0; right:0; bottom:calc(64px + var(--safe-b)); z-index:40; background:var(--bg); border-top:1px solid var(--border); padding:8px 16px; }
      .chat-composer .inner { max-width:640px; margin:0 auto; display:flex; gap:8px; align-items:flex-end; }
      .chat-composer textarea { flex:1; resize:none; max-height:120px; padding:10px 12px; border-radius:12px; border:1px solid var(--border); background:var(--card); color:var(--text); font-size:0.92rem; line-height:1.4; }
      .chat-composer button { min-width:64px; height:42px; border-radius:12px; background:var(--accent); color:#fff; font-weight:700; }
      .chat-composer button.stop { background:var(--red, #c0392b); }
      .chat-composer button:disabled { opacity:0.5; }
    `;
    const el = document.createElement('style');
    el.id = 'chat-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function blockHtml(role, block, meta) {
    if (role === 'user') {
      if (block.type === 'tool_result') {
        const body = typeof block.content === 'string' ? block.content
          : (Array.isArray(block.content) ? block.content.map(c => c.text || '').join('\n') : JSON.stringify(block.content));
        return `<details class="tool-card${block.is_error ? ' err' : ''}"><summary>↩ tool result${block.is_error ? ' (error)' : ''}</summary><pre>${escapeHtml(prettyJson(body))}</pre></details>`;
      }
      if (block.type === 'text') return `<div class="msg user">${escapeHtml(block.text)}</div>`;
      return '';
    }
    // assistant
    if (block.type === 'text') {
      return block.text && block.text.trim() ? `<div class="msg assistant">${renderMarkdownLite(block.text)}</div>` : '';
    }
    if (block.type === 'tool_use') {
      return `<details class="tool-card"><summary>🔧 ${escapeHtml(block.name)}</summary><pre>${escapeHtml(JSON.stringify(block.input, null, 2))}</pre></details>`;
    }
    return '';
  }

  function prettyJson(s) {
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return s; }
  }

  function footHtml(meta) {
    if (!meta || !meta.usage) return '';
    const u = meta.usage;
    const cache = u.cache_read_input_tokens ? ` · cache ${u.cache_read_input_tokens}` : '';
    return `<div class="msg-foot">${escapeHtml(CHAT_MODELS[meta.model]?.label || meta.model)} · in ${u.input_tokens || 0} · out ${u.output_tokens || 0}${cache} · ${fmtCost(meta.cost)}</div>`;
  }

  function threadHtml(s) {
    if (!s.messages.length) {
      return `<div class="chat-empty">Ask your coach anything — e.g. <em>“How have my squats progressed?”</em> or <em>“Design me a 3-day dumbbell program.”</em></div>`;
    }
    let html = '';
    for (const m of s.messages) {
      const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }];
      for (const b of blocks) html += blockHtml(m.role, b, m._meta);
      if (m.role === 'assistant') html += footHtml(m._meta);
    }
    return html;
  }

  function renderThread() {
    const thread = document.getElementById('chat-thread');
    if (!thread) return;
    const s = currentSession();
    const notes = (ChatState.notes || []).map(n => `<div class="msg-note">${escapeHtml(n)}</div>`).join('');
    thread.innerHTML = threadHtml(s) + notes;
    updateSummary(s);
    scrollBottom();
  }

  function liveBubble() {
    const thread = document.getElementById('chat-thread');
    const el = document.createElement('div');
    el.className = 'msg assistant';
    el.innerHTML = '<em style="opacity:.6">…</em>';
    thread.appendChild(el);
    scrollBottom();
    return el;
  }

  function appendNote(text) {
    ChatState.notes = ChatState.notes || [];
    ChatState.notes.push(text);
    renderThread();
  }

  function scrollBottom() {
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  }

  function updateSummary(s) {
    const el = document.getElementById('chat-sum');
    if (el) el.textContent = `${fmtCost(s.totalCost || 0)} · ${s.totalTokens || 0} tok`;
  }

  function updateComposer() {
    const ta = document.getElementById('chat-input');
    const btn = document.getElementById('chat-send');
    if (!btn) return;
    if (ChatState.busy) {
      btn.textContent = 'Stop';
      btn.classList.add('stop');
      btn.disabled = false;
      btn.onclick = stopTurn;
      if (ta) ta.disabled = true;
    } else {
      btn.textContent = 'Send';
      btn.classList.remove('stop');
      btn.disabled = false;
      btn.onclick = sendFromInput;
      if (ta) { ta.disabled = false; }
    }
  }

  function sendFromInput() {
    if (ChatState.busy) return;
    const ta = document.getElementById('chat-input');
    const text = (ta.value || '').trim();
    if (!text) return;
    ta.value = '';
    ta.style.height = 'auto';
    if (!hasApiKey()) { appendNote('⚠️ Add your Claude API key in Setup → AI Chat first.'); return; }
    runTurn(text);
  }

  function openSessionList() {
    const pid = Storage.getActiveProfile();
    const list = getSessions(pid);
    const cur = currentSession().id;
    const rows = list.map(s => `
      <div class="row" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
        <button data-open="${s.id}" style="flex:1;text-align:left;${s.id === cur ? 'font-weight:700;color:var(--accent-d);' : ''}">
          ${escapeHtml(s.title || 'Untitled')}
          <div class="text-xs text-muted">${escapeHtml(fmtDate(new Date(s.updatedAt).toISOString().slice(0, 10)))} · ${fmtCost(s.totalCost || 0)}</div>
        </button>
        <button data-del="${s.id}" class="iconbtn" title="Delete">✕</button>
      </div>`).join('') || '<div class="text-muted" style="padding:8px 0;">No chats yet.</div>';
    showModal(`<div>${rows}</div>`, 'Chats');
    document.querySelectorAll('#modal-sheet [data-open]').forEach(b => {
      b.onclick = () => { ChatState.sessionId = b.dataset.open; ChatState.notes = []; closeModal(); renderChat(); };
    });
    document.querySelectorAll('#modal-sheet [data-del]').forEach(b => {
      b.onclick = () => {
        deleteSession(b.dataset.del, pid);
        if (ChatState.sessionId === b.dataset.del) ChatState.sessionId = null;
        closeModal();
        renderChat();
      };
    });
  }

  function renderChat() {
    injectStyles();
    document.querySelectorAll('.bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.route === 'chat'));
    document.getElementById('topbar-title').textContent = 'Chat';

    const s = currentSession();
    document.getElementById('topbar-sub').textContent = s.title && s.title !== 'New chat' ? s.title : 'AI coach';

    const view = document.getElementById('view');

    if (!hasApiKey()) {
      view.innerHTML = `
        <div class="card">
          <h2>AI Chat</h2>
          <p class="note">Add your Claude API key to start chatting with your AI coach. It can read your workout and health history and design programs for you.</p>
          <button class="btn block mt-2" id="chat-go-setup">Go to Setup</button>
          <div class="text-xs text-muted mt-1">Your key is stored only in this browser. Get one at console.anthropic.com.</div>
        </div>`;
      document.getElementById('chat-go-setup').onclick = () => go('/setup');
      return;
    }

    const modelOpts = Object.entries(CHAT_MODELS)
      .map(([id, m]) => `<option value="${id}" ${id === s.model ? 'selected' : ''}>${escapeHtml(m.label)} ($${m.in}/$${m.out})</option>`).join('');

    view.innerHTML = `
      <div class="chat-wrap">
        <div class="chat-bar">
          <select id="chat-model" title="Model">${modelOpts}</select>
          <button id="chat-sessions">Chats</button>
          <button id="chat-new">＋ New</button>
          <span class="spacer"></span>
          <span class="chat-sum" id="chat-sum"></span>
        </div>
        <div id="chat-thread"></div>
      </div>
      <div class="chat-composer">
        <div class="inner">
          <textarea id="chat-input" rows="1" placeholder="Message your coach…"></textarea>
          <button id="chat-send">Send</button>
        </div>
      </div>`;

    document.getElementById('chat-model').onchange = e => {
      const sess = currentSession();
      sess.model = e.target.value;
      sess.updatedAt = Date.now();
      Storage.save();
      localStorage.setItem(MODEL_STORE, e.target.value);
    };
    document.getElementById('chat-sessions').onclick = openSessionList;
    document.getElementById('chat-new').onclick = () => {
      const ns = newSession(Storage.getActiveProfile());
      ChatState.sessionId = ns.id;
      ChatState.notes = [];
      renderChat();
    };

    const ta = document.getElementById('chat-input');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromInput(); }
    });

    renderThread();
    updateComposer();
  }

  window.renderChat = renderChat;
})();
