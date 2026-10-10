/* Starcrew Command — browser app. Talks only to the local server (same origin). */
(() => {
  'use strict';
  const SC = window.Starcrew;
  const $ = s => document.querySelector(s);

  // ---------- tiny DOM helper (text is always set as text, never as HTML) ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'selected') el.selected = !!v;
      else if (k === 'disabled') el.disabled = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  async function api(path, body) {
    const opt = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-starcrew': '1' }, body: JSON.stringify(body) };
    const r = await fetch('/api' + path, opt);
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = '/'; throw new Error('Signed out'); }
    // a 404 on an API route means the page is newer than the running server (files updated, server not restarted)
    if (r.status === 404) throw new Error('Starcrew was updated but is still running the old version. Close the Starcrew window, start it again, then reload this page.');
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  // ---------- formatting ----------
  const money = v => { v = Number(v) || 0; return v === 0 ? '$0.00' : v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2); };
  const range$ = (a, b) => money(a) + '–' + money(b);
  const dur = s => { s = Math.max(0, Math.round(s)); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + 'm ' + (s % 60 ? (s % 60) + 's' : ''); return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
  const durRange = (lo, hi) => dur(lo * 60) + ' – ' + dur(hi * 60);
  const tokens = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
  const ago = t => { const s = (Date.now() - new Date(t).getTime()) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : new Date(t).toLocaleDateString(); };
  const STATUS = { planning: 'Planning', awaiting_approval: 'Needs approval', running: 'Running', done: 'Done', failed: 'Problem', cancelled: 'Cancelled', rejected: 'Rejected', interrupted: 'Interrupted' };
  const STATE = { idle: 'Idle', thinking: 'Thinking', working: 'Working', browsing: 'Browsing', waiting: 'Waiting for you', done: 'Done', error: 'Problem', learning: 'Learning', training: 'Training', sleeping: 'Off duty' };
  const MODE_INFO = {
    careful: 'Asks before anything beyond reading files.',
    balanced: 'Reads the web and writes workspace files on its own; asks before commands, clicks, typing and opening apps.',
    autopilot: 'Clicks, typing and opening apps run without asking. Commands and crew changes still always ask; blocked actions stay blocked. Use only for crew you trust with this computer.',
    readonly: 'Can only read. Writing, commands and browsing are refused.',
  };
  const TOOL_TITLE = {
    crew_report: 'wants to look at the crew report', teach: 'wants to teach a lesson', tidy_lessons: 'wants to tidy a crew member\'s lessons',
    create_skill: 'wants to create a new skill', assign_skills: 'wants to change someone\'s skills', hire_crew: 'wants to hire a crew member', create_agent: 'wants to create and onboard a new crew member',
    run_command: 'wants to run a command', write_file: 'wants to write a file', web_fetch: 'wants to read a web page', browser_open: 'wants to open a page in the crew browser',
    browser_click: 'wants to click on a page', browser_type: 'wants to type on a page', browser_read: 'wants to read the page', browser_screenshot: 'wants a screenshot',
    open_url: 'wants to open a website on your screen', open_app: 'wants to open something on your computer', list_files: 'wants to list files', read_file: 'wants to read a file',
  };

  // safe Markdown → HTML (everything is escaped first; links only http(s))
  function md(src) {
    const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const inline = s => {
      const codes = [], links = [];
      s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
      // pull links out first, so bold/italic never touches a URL and links never nest
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => { links.push([t, u]); return '\u0001' + (links.length - 1) + '\u0001'; })
        .replace(/(^|[\s(])(https?:\/\/[^\s<)\u0000\u0001]+[^\s<).,!?:;'"\u0000\u0001])/g, (m, pre, u) => { links.push([u, u]); return pre + '\u0001' + (links.length - 1) + '\u0001'; });
      s = esc(s)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g, '$1<em>$2</em>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>');
      return s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + esc(codes[+i]) + '</code>')
        .replace(/\u0001(\d+)\u0001/g, (m, i) => `<a href="${esc(links[+i][1])}" target="_blank" rel="noopener noreferrer">${esc(links[+i][0])}</a>`);
    };
    const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const out = []; let list = null, code = null, lang = '';
    const lines = String(src || '').split('\n');
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if ((m = line.match(/^\s*```\s*([\w+-]*)/))) { if (code) { out.push(`<pre data-lang="${esc(lang)}"><code>` + esc(code.join('\n')) + '</code></pre>'); code = null; } else { closeList(); code = []; lang = m[1] || ''; } continue; }
      if (code) { code.push(line); continue; }
      // table: header row, then a |---| separator row
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        closeList();
        const head = cells(line); i++;
        const rows = [];
        while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) rows.push(cells(lines[++i]));
        out.push('<div class="table-wrap"><table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] || '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      if ((m = line.match(/^(#{1,4})\s+(.*)/))) { closeList(); const n = Math.min(4, m[1].length + 1); out.push(`<h${n}>${inline(m[2])}</h${n}>`); }
      else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); }
      else if ((m = line.match(/^>\s?(.*)/))) { closeList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); }
      else if ((m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)/))) { if (list !== 'ul') { closeList(); out.push('<ul class="tasks">'); list = 'ul'; } out.push(`<li>${m[1] === ' ' ? '☐' : '☑'} ${inline(m[2])}</li>`); }
      else if ((m = line.match(/^\s*[-*+]\s+(.*)/))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); }
      else if (!line.trim()) closeList();
      else { closeList(); out.push('<p>' + inline(line) + '</p>'); }
    }
    if (code) out.push(`<pre data-lang="${esc(lang)}"><code>` + esc(code.join('\n')) + '</code></pre>');
    closeList();
    return out.join('');
  }
  const copyText = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); } catch (e) { const t = h('textarea', { value: text }); document.body.append(t); t.select(); try { document.execCommand('copy'); } catch (x) { /* */ } t.remove(); }
    if (btn) { const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = old; }, 1200); }
  };
  const mdEl = (src, cls = 'md') => {
    const d = h('div', { class: cls }); d.innerHTML = md(src);
    for (const pre of d.querySelectorAll('pre')) {
      const bar = h('div', { class: 'code-bar' }, h('span', { text: pre.dataset.lang || 'code' }), h('button', { type: 'button', class: 'btn ghost small', onclick: e => copyText(pre.querySelector('code').textContent, e.currentTarget) }, 'Copy'));
      pre.before(bar);
    }
    return d;
  };

  // ---------- animated portraits ----------
  const portraits = new Set();
  function portrait(agent, size, action = 'idle') {
    const c = h('canvas', { width: 48, height: 48, 'aria-hidden': 'true' });
    portraits.add({ c, agentId: agent.id, sprite: agent.sprite, look: agent.look, action });
    return c;
  }
  let tNow = 0;
  function frameAt(id, action, t) { const A = SC.anim(id, action); const f = Math.floor(t * A.fps); return A.loop ? f % A.frames : Math.min(f, A.frames - 1); }
  function drawPortraits() {
    for (const p of portraits) {
      if (!p.c.isConnected) { portraits.delete(p); continue; }
      if (!p.c.offsetParent) continue; // hidden (closed dialog or tab): no need to draw
      const a = S.agents.find(x => x.id === p.agentId);
      const sprite = a && SC.characters[a.sprite] ? a.sprite : p.sprite;
      const g = p.c.getContext('2d'); g.clearRect(0, 0, 48, 48);
      SC.draw(g, sprite, p.action, 'front', frameAt(sprite, p.action, tNow + (p.agentId || '').length * 0.37), 0, 0, 1, a ? a.look : p.look);
    }
  }

  // ---------- state ----------
  let S = null, office = null, sel = 'cortex', agentTab = 'chat', wantFocus = false;
  const chats = {}, drafts = {}, views = {};
  let chatFill = null, chatSync = null, chatDraft = null;
  let openMissionId = null, auditItems = [];

  const agentById = id => S.agents.find(a => a.id === id);
  const toast = (text, onClick) => {
    const t = h('div', { class: 'toast', role: 'status', text });
    if (onClick) { t.classList.add('clickable'); t.addEventListener('click', onClick); }
    $('#toasts').append(t); setTimeout(() => t.remove(), 5000);
  };
  const fail = e => toast('⚠ ' + e.message);

  // ---------- header ----------
  function renderSpend() {
    const sp = S.spend, st = S.settings;
    const def = st.models.find(m => m.key === st.defaultModel) || {};
    const ep = st.endpoints.find(e => e.id === def.endpoint) || {};
    const planMode = ep.billing === 'plan' || (sp.planToday > 0 && !sp.today);
    const pct = planMode ? Math.min(100, sp.planToday / Math.max(1, sp.planDaily) * 100) : sp.daily > 0 ? Math.min(100, sp.today / sp.daily * 100) : 0;
    $('#usageLabel').textContent = planMode ? 'Plan usage today' : ep.billing === 'demo' ? 'Demo crew' : ep.billing === 'free' ? 'Local models' : 'Spent today';
    $('#spendVal').textContent = planMode ? String(sp.planToday) : ep.billing === 'free' && !sp.today ? 'Free' : money(sp.today);
    $('#spendCap').textContent = planMode ? `of ${sp.planDaily} req.` : ep.billing === 'free' && !sp.today ? '' : 'of ' + money(sp.daily);
    const bar = $('#spendBar'); bar.style.width = pct + '%'; bar.className = pct > 90 ? 'bad' : pct > 70 ? 'warn' : '';
    $('#spend').title = [`Plan requests today: ${sp.planToday} of ${sp.planDaily} (Starcrew's own limit)`, `API spend today: ${money(sp.today)} of ${money(sp.daily)}`, sp.simulatedToday ? `Demo crew (simulated): ${money(sp.simulatedToday)}` : '', 'Click for usage details'].filter(Boolean).join('\n');
  }
  function renderKilled() {
    $('#killedBanner').hidden = !S.killed;
    $('#stopBtn').disabled = S.killed;
  }

  // ---------- roster ----------
  function renderRoster() {
    const r = $('#roster');
    const focused = r.contains(document.activeElement) ? document.activeElement.dataset.agent : null;
    clear(r);
    for (const a of S.agents) {
      const st = a.enabled ? (a.live && a.live.state) || 'idle' : 'sleeping';
      r.append(h('button', { type: 'button', 'data-agent': a.id, class: 'chip' + (a.enabled ? '' : ' off'), 'aria-pressed': String(a.id === sel), title: `${a.name} · ${a.role} · ${STATE[st] || st}`, onclick: () => { select(a.id); office.poke(a.id); } },
        h('span', { class: 'dot ' + st }), a.name.replace(/^Captain /, '')));
    }
    r.append(h('button', { type: 'button', 'data-agent': '+', class: 'chip', title: 'Add a crew member', onclick: openNewAgent }, '+ Add'));
    if (focused) { const b = r.querySelector(`[data-agent="${CSS.escape(focused)}"]`); if (b) b.focus({ preventScroll: true }); }
  }

  function select(id) {
    sel = id; wantFocus = true; office && office.select(id);
    switchTab('agent'); renderRoster(); renderAgent();
  }

  // ---------- agent card ----------
  function statusText(a) { const l = a.live || {}; const st = a.enabled ? l.state || 'idle' : 'sleeping'; return [st, (STATE[st] || st) + (l.detail ? ' · ' + l.detail : '')]; }
  function renderAgentHeader() {
    const a = agentById(sel); if (!a) return;
    const root = $('#tab-agent');
    const q = s => root.querySelector(s);
    if (!q('.agent-top')) return;
    q('.ag-role').textContent = a.role + (a.captain ? ' · leads every mission' : '');
    q('.ag-name').textContent = a.name;
    const need = a.stats.level * 100;
    q('.ag-lv').textContent = 'LV ' + a.stats.level;
    q('.ag-xp i').style.width = Math.min(100, a.stats.xp / need * 100) + '%';
    q('.ag-xptext').textContent = `${a.stats.xp}/${need} XP`;
    q('.ag-energy i').style.width = (a.energy || 0) + '%';
    q('.ag-energytext').textContent = `${Math.round(a.energy || 0)}% energy`;
    const [st, txt] = statusText(a);
    q('.ag-dot').className = 'dot ag-dot ' + st;
    q('.ag-status').textContent = txt;
    q('.ag-model').textContent = a.modelLabel + ' · ' + (a.permission || 'balanced');
    const tb = q('.ag-train'); if (tb) tb.disabled = !!(chatOf(a.id) && chatOf(a.id).busy) || (a.live && a.live.state === 'training');
    if (chatSync && agentTab === 'chat') chatSync();
  }
  function renderAgent() {
    const a = agentById(sel) || S.agents[0]; if (!a) return; sel = a.id;
    const root = clear($('#tab-agent'));
    const top = h('div', { class: 'agent-top' },
      h('div', {}, (() => { const c = portrait(a, 96); c.className = 'portrait'; return c; })()),
      h('div', { class: 'min0' },
        h('div', { class: 'eyebrow ag-role' }),
        h('h2', { class: 'ag-name' }),
        h('div', { class: 'lvl' }, h('b', { class: 'ag-lv' }), h('div', { class: 'bar-track ag-xp' }, h('i')), h('span', { class: 'ag-xptext num' })),
        h('div', { class: 'lvl' }, h('div', { class: 'bar-track energy ag-energy' }, h('i')), h('span', { class: 'ag-energytext num' })),
        h('div', { class: 'status-line' }, h('span', { class: 'dot ag-dot' }), h('span', { class: 'ag-status' })),
        h('div', { class: 'hint ag-model' }),
        (a.skills || []).some(k => k.id === 'coaching') ? h('button', { type: 'button', class: 'btn small gold ag-train', title: 'Coach studies how everyone is doing and teaches them lessons', onclick: startTraining }, '🏋 Run training session') : null,
        h('button', { type: 'button', class: 'btn small ag-dance', title: 'Make them dance (or double-click them in the office)', onclick: () => office.dance(a.id) }, '💃 Dance'),
        a.captain ? h('button', { type: 'button', class: 'btn small ag-hire', title: 'Open the hiring board', onclick: openNewAgent }, '+ Hire or onboard crew') : null));
    const tabs = h('div', { class: 'subtabs', role: 'tablist' }, ...['chat', 'profile', 'skills', 'memory', 'stats'].map(t =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(t === agentTab), onclick: () => { agentTab = t; renderAgent(); } }, t[0].toUpperCase() + t.slice(1))));
    root.append(top, h('div', { id: 'browserView' }), tabs, h('div', { class: 'sub', id: 'agentSub' }));
    renderBrowserView(a);
    if (!(a.id in views)) api(`/agent/${a.id}/browser`).then(v => { views[a.id] = v && v.img ? v : null; if (sel === a.id) renderBrowserView(a); }).catch(() => {});
    renderAgentHeader(); renderSub();
  }
  async function startTraining() {
    try { const r = await api('/training', {}); const k = agentById(r.trainer); if (k) { if (sel !== k.id) select(k.id); agentTab = 'chat'; delete chats[k.id]; renderAgent(); toast(`${k.name} started a training session`); } }
    catch (e) { fail(e); }
  }
  function renderBrowserView(a) {
    const box = $('#browserView'); if (!box) return; clear(box);
    const v = views[a.id]; if (!v || !v.img) return;
    const live = a.live && a.live.state === 'browsing';
    box.append(h('details', { class: 'bview', open: true },
      h('summary', {}, h('span', { class: 'eyebrow', text: live ? '● Crew browser · live' : 'Crew browser · last view' }), h('span', { class: 'hint', text: ' ' + ago(v.at) })),
      h('img', { src: v.img, alt: `What ${a.name} sees: ${v.title || v.url}` }),
      h('div', { class: 'hint mono bview-url', text: v.url })));
  }
  function renderSub() {
    const a = agentById(sel); const box = clear($('#agentSub'));
    ({ chat: subChat, profile: subProfile, skills: subSkills, memory: subMemory, stats: subStats }[agentTab])(a, box);
  }

  // ---------- chat ----------
  const SUGGEST = {
    planning: ['What can the crew do for me?', 'Plan a mission: compare 3 budget laptops and make an Excel table'],
    research: ['Find the 3 most useful sources on a topic I give you', 'What changed in the news about AI this week?'],
    office: ['Make an Excel tracker for my monthly expenses', 'Summarise the document I attach'],
    writing: ['Draft a friendly email asking for a meeting next week', 'Turn my notes into a one-page brief'],
    coding: ['Write a Python script that renames photos by date', 'Explain what the scripts in my workspace do'],
    browser: ['Open example.com and tell me what is on it'],
    analysis: ['Analyse the spreadsheet I attach and list the top trends'],
    review: ['Check the file I attach for mistakes'],
    design: ['Sketch a simple landing page for a bakery as HTML'],
    desktop: ['Open my workspace folder'], security: ['Is it safe to let the crew run commands?'], testing: ['Test the newest script in the workspace'],
  };
  // every chat command, used by the / popup, the chat and the Commands tab
  const COMMANDS = [
    { cmd: '/mission', arg: 'goal', desc: 'Turn a goal into a mission plan with a usage and time estimate', group: 'Work' },
    { cmd: '/new', desc: 'Start a new chat with this crew member', group: 'Chat' },
    { cmd: '/clear', desc: 'Clear the messages in this chat', group: 'Chat' },
    { cmd: '/retry', desc: 'Ask again for the last answer', group: 'Chat' },
    { cmd: '/export', desc: 'Download this chat as a Markdown file', group: 'Chat' },
    { cmd: '/train', desc: 'Start a training session with the crew trainer', group: 'Crew' },
    { cmd: '/hire', desc: 'Open the hiring board to hire or onboard crew', group: 'Crew' },
    { cmd: '/dance', desc: 'Make this crew member dance', group: 'Fun' },
    { cmd: '/party', desc: 'Everyone who is free dances (and the music starts)', group: 'Fun' },
    { cmd: '/music', desc: 'Play or pause the background music', group: 'Fun' },
    { cmd: '/next', desc: 'Skip to the next music track', group: 'Fun' },
    { cmd: '/help', desc: 'Open this list of commands', group: 'Chat' },
  ];
  const SLASH = COMMANDS.map(c => [c.cmd + (c.arg ? ' ' : ''), c.desc]);
  // runs a slash command for crew member `a`; returns false if `text` is not a command
  async function runCommand(a, text) {
    const [cmd, ...rest] = text.trim().split(/\s+/); const arg = rest.join(' ').trim();
    switch (cmd) {
      case '/new': loadChat(a.id, await api(`/agent/${a.id}/chat/new`, {})); renderSub(); return true;
      case '/clear': loadChat(a.id, await api(`/agent/${a.id}/chat/clear`, {})); renderSub(); return true;
      case '/export': if (!chatOf(a.id)) loadChat(a.id, await api(`/agent/${a.id}/chat`)); exportChat(a); return true;
      case '/retry': { const c = chatOf(a.id); if (c) c.busy = true; if (chatSync) chatSync(); await api(`/agent/${a.id}/chat`, { mode: 'retry' }).catch(e => { if (c) c.busy = false; if (chatSync) chatSync(); throw e; }); return true; }
      case '/dance': office.dance(a.id); return true;
      case '/party': { const n = office.dance('all', 10); if (!radio.state().playing) radio.play(); toast(n ? `Dance party! ${n} on the floor` : 'Everyone is busy working right now'); return true; }
      case '/music': radio.toggle(); savePrefs(); toast(radio.state().playing ? `♫ Now playing: ${radio.state().title}` : 'Music paused'); return true;
      case '/next': radio.next(); savePrefs(); toast(`♫ ${radio.state().title}`); return true;
      case '/train': await startTraining(); return true;
      case '/hire': openNewAgent(); return true;
      case '/help': switchTab('commands'); return true;
      case '/mission': { if (!arg) { toast('Write the goal after /mission, e.g. /mission compare 3 laptops'); return true; } const m = await api('/mission', { goal: arg }); upsert(S.missions, m); renderMissions(); openMission(m.id); return true; }
      default: return false;
    }
  }

  // ---------- commands tab ----------
  function renderCommands() {
    const box = clear($('#tab-commands'));
    const a = agentById(sel) || S.agents[0];
    const useInChat = text => { select(a.id); agentTab = 'chat'; const d = drafts[a.id] || (drafts[a.id] = { text: '', files: [], editing: false }); d.text = text; wantFocus = true; renderAgent(); setTimeout(() => { const i = document.querySelector('.composer2 textarea'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 50); };
    const row = (code, desc, action, label) => h('div', { class: 'cmd-row' }, h('code', { text: code }), h('span', { class: 'hint', text: desc }), action ? h('button', { type: 'button', class: 'btn small', onclick: action }, label || 'Run') : h('span'));
    box.append(h('p', { class: 'hint cmd-intro' }, 'Type these in any chat box. Commands act on the crew member whose card is open (now: ', h('b', { text: a.name }), '). Type ', h('code', { text: '/' }), ' in a chat to see them as you type.'));
    for (const g of ['Work', 'Chat', 'Crew', 'Fun']) {
      box.append(h('div', { class: 'eyebrow cmd-group', text: g }));
      for (const c of COMMANDS.filter(x => x.group === g && x.cmd !== '/help'))
        box.append(row(c.cmd + (c.arg ? ' <' + c.arg + '>' : ''), c.desc, c.arg || ['/clear', '/retry'].includes(c.cmd) ? () => useInChat(c.cmd + ' ') : () => runCommand(a, c.cmd).catch(fail), c.arg || ['/clear', '/retry'].includes(c.cmd) ? 'Use' : 'Run'));
    }
    box.append(h('div', { class: 'eyebrow cmd-group', text: 'Talking to the crew' }),
      row('@name message', 'Hand a message to another crew member, e.g. @Nova find the latest prices', () => useInChat('@'), 'Use'),
      row('📎 / drag / paste', 'Attach files to a chat message (up to 25 MB each)'),
      row('👍 👎', 'Rate a reply or a mission. 👍 gives XP; 👎 tells the trainer what to coach'));
    box.append(h('div', { class: 'eyebrow cmd-group', text: 'Keyboard' }),
      row('Enter', 'Send a chat message'), row('Shift + Enter', 'New line in a message'),
      row('↑', 'Edit your last message (in an empty chat box)'), row('Esc', 'Cancel editing, close a popup or dialog'),
      row('Ctrl + Enter', 'Draft a plan from the New mission box'), row('Media keys', 'Play, pause and skip music'));
    box.append(h('div', { class: 'eyebrow cmd-group', text: 'In the office' }),
      row('Click', 'Select a crew member; they answer with a bubble'), row('Double-click', 'Make a crew member dance'),
      row('Click the jukebox', 'Play or pause the music'), row('Click a pet', 'Say hi'));
  }

  const chatOf = id => chats[id];
  function loadChat(id, view) { chats[id] = { ...(chats[id] || {}), ...view, busy: !!view.busy || !!(chats[id] && chats[id].busy && chats[id].thread && chats[id].thread.id === view.thread.id) }; }
  function billingText(meta) {
    if (!meta) return '';
    const parts = [meta.model];
    if (meta.ms) parts.push((meta.ms / 1000).toFixed(1) + 's');
    if (meta.billing === 'plan') parts.push(`${meta.requests || 1} plan request${meta.requests === 1 ? '' : 's'}`);
    else if (meta.billing === 'api') parts.push(money(meta.cost));
    else if (meta.billing === 'demo') parts.push('demo');
    else if (meta.billing === 'free') parts.push('free (local)');
    if (meta.tokens) parts.push(tokens(meta.tokens) + ' tokens');
    return parts.filter(Boolean).join(' · ');
  }
  const isImg = p => /\.(png|jpe?g|gif|webp)$/i.test(p);
  const attachChip = (p, onRemove) => h('span', { class: 'att' },
    isImg(p) ? h('img', { src: '/api/raw?path=' + encodeURIComponent(p), alt: '' }) : h('span', { class: 'att-ic', text: (p.split('.').pop() || 'file').slice(0, 4).toUpperCase() }),
    h('button', { type: 'button', class: 'att-name', title: p, onclick: () => openFiles(p) }, p.split('/').pop()),
    onRemove ? h('button', { type: 'button', class: 'att-x', 'aria-label': 'Remove attachment', onclick: onRemove }, '×') : null);
  function chatNode(m, ctx) {
    if (m.role === 'user') {
      return h('div', { class: 'msg-wrap user' },
        h('div', { class: 'msg user' }, h('div', { text: m.content }), (m.attachments || []).length ? h('div', { class: 'atts' }, m.attachments.map(p => attachChip(p))) : null),
        h('div', { class: 'msg-actions' },
          h('button', { type: 'button', class: 'btn ghost small', onclick: e => copyText(m.content, e.currentTarget) }, 'Copy'),
          ctx.lastUser && !ctx.busy ? h('button', { type: 'button', class: 'btn ghost small', onclick: ctx.edit }, 'Edit') : null));
    }
    if (m.role === 'tool') return h('div', { class: 'msg toolnote' }, h('details', {}, h('summary', {}, `Result of ${m.name.replace(/_/g, ' ')}`), h('pre', { text: String(m.content || '').slice(0, 2500) })));
    if (m.toolCalls && m.toolCalls.length) {
      const frag = document.createDocumentFragment();
      if (m.content) frag.append(mdEl(m.content, 'msg md thin'));
      for (const c of m.toolCalls) {
        const arg = c.args ? (c.args.url || c.args.path || c.args.command || c.args.title || c.args.name || c.args.question || '') : '';
        frag.append(h('div', { class: 'msg toolnote' }, h('span', { class: 'tn-ic', text: '⚙' }), ` Used ${c.name.startsWith('mcp_') ? 'connector tool ' + c.name.split('_').slice(2).join(' ') : c.name.replace(/_/g, ' ')}${arg ? ': ' + String(arg).slice(0, 80) : ''}`));
      }
      return frag;
    }
    const files = (m.meta && m.meta.files) || [];
    return h('div', { class: 'msg-wrap' },
      mdEl(m.content || '', 'msg md' + (m.error ? ' error' : '') + (m.stopped ? ' stopped' : '')),
      files.length ? h('div', { class: 'atts' }, files.map(p => attachChip(p))) : null,
      h('div', { class: 'msg-actions' },
        m.meta ? h('span', { class: 'meta', text: billingText(m.meta) }) : null,
        h('button', { type: 'button', class: 'btn ghost small', onclick: e => copyText(m.content || '', e.currentTarget) }, 'Copy'),
        m.at && !m.error && !m.stopped ? h('button', { type: 'button', class: 'btn ghost small rate' + (m.rating > 0 ? ' on' : ''), title: 'Good answer (helps the trainer)', 'aria-pressed': String(m.rating > 0), onclick: () => ctx.rate(m, 1) }, '👍') : null,
        m.at && !m.error && !m.stopped ? h('button', { type: 'button', class: 'btn ghost small rate' + (m.rating < 0 ? ' on' : ''), title: 'Not good (the trainer will coach this)', 'aria-pressed': String(m.rating < 0), onclick: () => ctx.rate(m, -1) }, '👎') : null,
        ctx.lastAssistant && !ctx.busy ? h('button', { type: 'button', class: 'btn ghost small', onclick: ctx.retry }, 'Retry') : null));
  }
  function exportChat(a) {
    const c = chatOf(a.id); if (!c) return;
    const lines = [`# Chat with ${a.name}: ${c.thread.title}`, `_Exported ${new Date().toLocaleString()}_`, ''];
    for (const m of c.thread.messages) {
      if (m.role === 'user') lines.push('**You:** ' + m.content + ((m.attachments || []).length ? `\n\n_Attached: ${m.attachments.join(', ')}_` : ''), '');
      else if (m.role === 'assistant' && !(m.toolCalls || []).length) lines.push(`**${a.name}:** ${m.content}`, '');
      else if (m.role === 'assistant') lines.push(`_${a.name} used ${(m.toolCalls || []).map(t => t.name).join(', ')}_`, '');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const link = h('a', { href: URL.createObjectURL(blob), download: `chat-${a.name.toLowerCase().replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.md` });
    document.body.append(link); link.click(); setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  }
  function readFileB64(file) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('Could not read ' + file.name)); r.readAsDataURL(file); });
  }
  function findAgentByMention(word) {
    const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
    const keys = x => { const n = x.name.toLowerCase(); return [x.id, n.replace(/[^a-z0-9]/g, ''), n.replace(/^(captain|coach) /, '').replace(/[^a-z0-9]/g, ''), n.split(/\s+/).pop()]; };
    return S.agents.find(x => keys(x).includes(w));
  }

  function subChat(a, box) {
    const c = chatOf(a.id);
    const draft = drafts[a.id] || (drafts[a.id] = { text: '', files: [], editing: false });
    const head = h('div', { class: 'chat-head' });
    const list = h('div', { class: 'chat', id: 'chatList', 'aria-live': 'polite' });
    const jump = h('button', { type: 'button', class: 'jump', hidden: true, onclick: () => { list.scrollTop = list.scrollHeight; } }, '↓ Newest');
    const inline = h('div', { class: 'chat-approvals', id: 'chatApprovals' });
    const typing = h('div', { class: 'typing-row' }, h('span', { class: 'typing', text: `${a.name} is working on it` }), h('button', { type: 'button', class: 'btn small danger', onclick: () => api(`/agent/${a.id}/chat/stop`, {}).catch(fail) }, 'Stop'));
    const editBar = h('div', { class: 'edit-bar' }, h('span', { text: 'Editing your last message. Sending replaces it and the answer after it.' }), h('button', { type: 'button', class: 'btn ghost small', onclick: () => cancelEdit() }, 'Cancel'));
    const cancelEdit = () => { draft.editing = false; draft.text = ''; draft.files = []; input.value = ''; grow(); sync(); };
    const atts = h('div', { class: 'atts pending' });
    const input = h('textarea', { rows: 1, maxlength: 12000, value: draft.text, placeholder: a.captain ? `Message ${a.name}, or describe a goal for a mission` : `Message ${a.name}`, 'aria-label': 'Message' });
    const fileIn = h('input', { type: 'file', multiple: true, hidden: true });
    const sendBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => send() }, 'Send');
    const pop = h('div', { class: 'slash-pop', hidden: true });
    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(200, input.scrollHeight + 2) + 'px'; };
    const busy = () => !!(chatOf(a.id) && chatOf(a.id).busy);

    function sync() {
      typing.hidden = !busy(); editBar.hidden = !draft.editing;
      sendBtn.disabled = busy(); sendBtn.textContent = draft.editing ? 'Save & send' : 'Send';
      clear(atts); atts.hidden = !draft.files.length;
      draft.files.forEach((f, i) => atts.append(attachChip(f.path, () => { draft.files.splice(i, 1); sync(); })));
    }
    async function upload(files) {
      for (const file of [...files].slice(0, 10)) {
        if (file.size > 25 * 1024 * 1024) { toast(`${file.name} is over 25 MB.`); continue; }
        const tmp = { path: 'uploads/…/' + file.name, uploading: true }; draft.files.push(tmp); sync();
        try { const r = await api('/upload', { name: file.name, data: await readFileB64(file) }); tmp.path = r.path; tmp.uploading = false; }
        catch (e) { const i = draft.files.indexOf(tmp); if (i >= 0) draft.files.splice(i, 1); fail(e); }
        sync();
      }
    }
    async function runSlash(text) {
      if (text.trim().split(/\s+/)[0] === '/retry') { retry(); return true; }
      return runCommand(a, text);
    }
    async function send(mode = 'send') {
      if (busy()) return;
      let text = input.value.trim();
      if (draft.files.some(f => f.uploading)) return toast('Wait for the upload to finish.');
      if (mode === 'send' && text.startsWith('/')) { try { if (await runSlash(text)) { input.value = ''; draft.text = ''; grow(); pop.hidden = true; return; } } catch (e) { return fail(e); } }
      if (!text && mode !== 'retry') return;
      let target = a;
      const at = text.match(/^@([\w-]+)\s+([\s\S]+)/);
      if (at && mode === 'send') { const other = findAgentByMention(at[1]); if (other && other.id !== a.id) { target = other; text = at[2]; } }
      const files = draft.files.map(f => f.path);
      const typed = input.value, keptFiles = draft.files.slice(), wasEditing = draft.editing;
      const m = draft.editing ? 'edit' : mode;
      const t = chatOf(target.id); if (t) t.busy = true;
      input.value = ''; draft.text = ''; draft.files = []; draft.editing = false; grow(); sync();
      try {
        await api(`/agent/${target.id}/chat`, { text, attachments: files, mode: m });
        if (target !== a) { toast(`Handed to ${target.name}`); select(target.id); }
      } catch (e) { if (t) t.busy = false; fail(e); input.value = typed; draft.text = typed; draft.files = keptFiles; draft.editing = wasEditing; grow(); sync(); }
    }
    function retry() { const t = chatOf(a.id); if (t) t.busy = true; sync(); api(`/agent/${a.id}/chat`, { mode: 'retry' }).catch(e => { if (t) t.busy = false; sync(); fail(e); }); }
    function edit() {
      const msgs = chatOf(a.id).thread.messages; const lu = [...msgs].reverse().find(x => x.role === 'user'); if (!lu) return;
      draft.editing = true; input.value = lu.content; draft.text = lu.content; draft.files = (lu.attachments || []).map(p => ({ path: p })); grow(); sync(); input.focus();
    }

    async function rate(m, r) {
      const cc = chatOf(a.id);
      try { await api(`/agent/${a.id}/feedback`, { threadId: cc.thread.id, at: m.at, rating: r }); m.rating = r; fill(); toast(r > 0 ? `Thanks! ${a.name} earned +10 XP` : `Noted. ${S.agents.find(x => (x.skills || []).some(k => k.id === 'coaching')) ? 'The trainer will work on it.' : ''}`); }
      catch (e) { fail(e); }
    }
    function drawDraft() {
      const cc = chatOf(a.id); let el = list.querySelector('.msg-wrap.draft');
      let text = cc && cc.draft != null ? String(cc.draft) : null;
      if (text != null) {
        const k = text.indexOf('<tool_call'); if (k >= 0) text = text.slice(0, k);
        const tail = text.match(/<[a-z_]*$/); if (tail && '<tool_call'.startsWith(tail[0])) text = text.slice(0, tail.index); // a tag still being typed
        text = text.replace(/^\s*<assistant>\s*/, '');
      }
      if (!text || !text.trim()) { if (el) el.remove(); return; }
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      if (!el) { el = h('div', { class: 'msg-wrap draft' }); list.append(el); }
      clear(el).append(mdEl(text, 'msg md streaming'));
      if (nearBottom) list.scrollTop = list.scrollHeight;
    }
    chatDraft = drawDraft;
    function fill() {
      const cc = chatOf(a.id); if (!cc) return;
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      clear(list);
      const msgs = cc.thread.messages;
      if (!msgs.length) {
        const ideas = [...new Set((a.skills || []).flatMap(s => SUGGEST[s.id] || []))].slice(0, 4);
        list.append(h('div', { class: 'chat-empty' },
          h('p', { class: 'hint', text: a.captain ? 'Say hi, ask a question, or give Cortex a goal. A goal becomes a mission plan you approve before anything happens.' : `Chat with ${a.name} directly. They can use their tools here too; risky actions still ask you first.` }),
          h('div', { class: 'suggest' }, ideas.map(t => h('button', { type: 'button', class: 'chip', onclick: () => { input.value = t; draft.text = t; grow(); input.focus(); } }, t)))));
      }
      const lastU = msgs.map(x => x.role).lastIndexOf('user');
      let lastA = -1; msgs.forEach((x, i) => { if (x.role === 'assistant' && !(x.toolCalls || []).length) lastA = i; });
      msgs.forEach((m, i) => list.append(chatNode(m, { lastUser: i === lastU, lastAssistant: i === lastA && lastA > lastU, busy: cc.busy, edit, retry, rate })));
      drawDraft();
      if (nearBottom || list.dataset.first !== '0') list.scrollTop = list.scrollHeight;
      list.dataset.first = '0';
      // thread picker
      clear(head);
      const pick = h('select', { 'aria-label': 'Chat thread' }, cc.list.threads.map(t => h('option', { value: t.id, selected: t.id === cc.thread.id }, `${t.title}${t.count ? '' : ' (empty)'}`)));
      pick.addEventListener('change', async () => { try { loadChat(a.id, await api(`/agent/${a.id}/chat/switch`, { id: pick.value })); renderSub(); } catch (e) { fail(e); } });
      let armed = false;
      head.append(pick,
        h('button', { type: 'button', class: 'btn small', title: 'Start a new chat (/new)', onclick: () => runSlash('/new').catch(fail) }, '+ New'),
        h('button', { type: 'button', class: 'btn ghost small', title: 'Download as Markdown (/export)', onclick: () => exportChat(a) }, 'Export'),
        h('button', { type: 'button', class: 'btn ghost small', title: 'Delete this chat', onclick: async e => {
          if (!armed) { armed = true; e.currentTarget.textContent = 'Sure?'; return; }
          try { loadChat(a.id, await api(`/agent/${a.id}/chat/delete`, { id: cc.thread.id })); renderSub(); } catch (err) { fail(err); }
        } }, 'Delete'));
      sync(); renderChatApprovals();
    }
    chatFill = fill; chatSync = sync;

    input.addEventListener('input', () => {
      draft.text = input.value; grow();
      const v = input.value;
      if (/^\/\w*$/.test(v)) { clear(pop); const opts = SLASH.filter(([c]) => c.startsWith(v)); pop.hidden = !opts.length; opts.forEach(([c, d]) => pop.append(h('button', { type: 'button', onclick: () => { input.value = c; draft.text = c; pop.hidden = true; input.focus(); if (!c.endsWith(' ')) send(); } }, h('b', { text: c.trim() }), ' ', h('span', { class: 'hint', text: d })))); }
      else if (/^@\w*$/.test(v)) { clear(pop); const opts = S.agents.filter(x => x.id !== a.id && x.enabled && (q => x.name.toLowerCase().startsWith(q) || x.name.toLowerCase().replace(/^(captain|coach) /, '').startsWith(q) || x.id.startsWith(q))(v.slice(1).toLowerCase())).slice(0, 6); pop.hidden = !opts.length; opts.forEach(x => pop.append(h('button', { type: 'button', onclick: () => { input.value = '@' + x.id + ' '; draft.text = input.value; pop.hidden = true; input.focus(); } }, portrait(x), h('b', { text: x.name }), ' ', h('span', { class: 'hint', text: x.role })))); }
      else pop.hidden = true;
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      else if (e.key === 'ArrowUp' && !input.value && !busy()) { e.preventDefault(); edit(); }
      else if (e.key === 'Escape') { pop.hidden = true; if (draft.editing) cancelEdit(); }
    });
    input.addEventListener('paste', e => { const fs = [...(e.clipboardData && e.clipboardData.files || [])]; if (fs.length) { e.preventDefault(); upload(fs); } });
    fileIn.addEventListener('change', () => { upload(fileIn.files); fileIn.value = ''; });
    list.addEventListener('scroll', () => { jump.hidden = list.scrollHeight - list.scrollTop - list.clientHeight < 120; });
    box.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); box.classList.add('drop'); } });
    box.addEventListener('dragleave', e => { if (!box.contains(e.relatedTarget)) box.classList.remove('drop'); });
    box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('drop'); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); });

    const composer = h('div', { class: 'composer2' },
      h('button', { type: 'button', class: 'btn ghost attach', title: 'Attach files (or drop / paste them)', 'aria-label': 'Attach files', onclick: () => fileIn.click() }, '📎'),
      input, sendBtn, fileIn, pop);
    const foot = h('div', { class: 'hint chat-foot', text: a.enabled ? `Enter to send · / for commands · @ to hand off · can use: ${a.tools.filter(t => !['remember', 'ask_user'].includes(t)).map(t => t.startsWith('mcp_') ? t.split('_').slice(2).join(' ') : t.replace(/_/g, ' ')).join(', ') || 'no tools'}` : `${a.name} is off duty. Turn them on in Profile.` });
    box.classList.add('chatbox');
    box.append(head, h('div', { class: 'chat-wrap' }, list, jump), inline, typing, editBar, atts, composer, foot);
    sync(); grow();
    if (c) fill(); else api(`/agent/${a.id}/chat`).then(v => { loadChat(a.id, v); if (sel === a.id && agentTab === 'chat') fill(); }).catch(fail);
    renderAgentHeader();
    if (wantFocus && matchMedia('(min-width: 1101px)').matches) setTimeout(() => input.focus({ preventScroll: true }), 0);
    wantFocus = false;
  }
  function renderChatApprovals() {
    const box = document.getElementById('chatApprovals'); if (!box) return;
    clear(box);
    for (const ap of S.approvals.filter(x => x.agentId === sel && !x.missionId)) box.append(approvalCard(ap, true));
  }

  // profile
  function subProfile(a, box) {
    const models = S.settings.models;
    const def = models.find(m => m.key === S.settings.defaultModel);
    const f = {
      name: h('input', { value: a.name, maxlength: 40 }), role: h('input', { value: a.role, maxlength: 40 }),
      model: h('select', {}, h('option', { value: '', selected: !a.model }, `Crew default (${def ? def.label : '?'})`), models.map(m => h('option', { value: m.key, selected: a.model === m.key }, m.label + (m.model || m.endpoint === 'demo' ? '' : ' — not set up')))),
      permission: h('select', {}, S.modes.map(m => h('option', { value: m, selected: (a.permission || 'balanced') === m }, m[0].toUpperCase() + m.slice(1)))),
      enabled: h('input', { type: 'checkbox', checked: a.enabled, disabled: a.captain }),
      persona: h('textarea', { rows: 5, maxlength: 4000, value: a.persona }),
      sprite: h('select', {}, SC.crew.map(id => h('option', { value: id, selected: a.sprite === id }, SC.characters[id].name))),
    };
    const modeHint = h('span', { class: 'hint', text: MODE_INFO[f.permission.value] });
    f.permission.addEventListener('change', () => { modeHint.textContent = MODE_INFO[f.permission.value]; });
    const look = { ...(a.look || {}) };
    const outfit = h('div', { class: 'form-grid' });
    const drawOutfit = () => {
      clear(outfit);
      const opts = SC.options(f.sprite.value);
      for (const [slot, values] of Object.entries(opts)) {
        const s = h('select', {}, values.map(v => h('option', { value: v, selected: (look[slot] || (slot === 'suit' || slot === 'color' ? 'default' : 'none')) === v }, SC.label(slot, v))));
        s.addEventListener('change', () => { look[slot] = s.value; });
        outfit.append(h('label', { class: 'field' }, h('span', {}, slot[0].toUpperCase() + slot.slice(1)), s));
      }
    };
    f.sprite.addEventListener('change', drawOutfit); drawOutfit();
    const save = async () => {
      try {
        await api(`/agent/${a.id}`, { name: f.name.value, role: f.role.value, model: f.model.value || null, permission: f.permission.value, enabled: f.enabled.checked, persona: f.persona.value, sprite: f.sprite.value, look });
        toast('Saved ' + f.name.value);
      } catch (e) { fail(e); }
    };
    let armed = false;
    const del = a.captain ? null : h('button', { type: 'button', class: 'btn ghost', onclick: async e => {
      if (!armed) { armed = true; e.target.textContent = 'Click again to remove ' + a.name; return; }
      try { await api(`/agent/${a.id}/delete`, {}); S.agents = S.agents.filter(x => x.id !== a.id); office.sync(S.agents); select('cortex'); toast(a.name + ' left the crew'); } catch (err) { fail(err); }
    } }, 'Remove from crew');
    box.append(
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Name'), f.name),
        h('label', { class: 'field' }, h('span', {}, 'Role'), f.role),
        h('label', { class: 'field' }, h('span', {}, 'AI model'), f.model),
        h('label', { class: 'field' }, h('span', {}, 'Permission'), f.permission),
        h('div', { class: 'full' }, modeHint),
        h('label', { class: 'check full' }, f.enabled, h('span', {}, a.captain ? 'The Head Captain is always on duty' : 'On duty (off-duty crew rest in the nap pods and get no work)')),
        h('label', { class: 'field full' }, h('span', {}, 'Personality and instructions'), f.persona)),
      h('div', { class: 'eyebrow', text: 'Look' }),
      h('label', { class: 'field' }, h('span', {}, 'Character'), f.sprite),
      outfit,
      h('div', { class: 'row-between' }, del || h('span'), h('button', { type: 'button', class: 'btn primary', onclick: save }, 'Save profile')));
  }

  // skills
  function subSkills(a, box) {
    const cat = S.skills;
    const toolChip = t => h('span', { class: 'tool-chip ' + ((S.tools[t] && S.tools[t].risk) || ''), title: (S.tools[t] && S.tools[t].description) || '' }, t.replace(/_/g, ' '));
    const setSkills = async ids => { try { await api(`/agent/${a.id}`, { skills: ids }); } catch (e) { fail(e); } };
    box.append(h('p', { class: 'hint', text: 'Skills decide which tools a crew member may use and add expert instructions to their prompt. Skills level up as they are used.' }));
    for (const s of a.skills) {
      const k = cat[s.id]; if (!k) continue;
      const need = s.level * 60;
      box.append(h('div', { class: 'skill' },
        h('div', { class: 'skill-head' }, h('b', {}, k.name), h('span', { class: 'lvl' }, h('b', {}, 'LV ' + s.level), h('span', { class: 'bar-track' }, (() => { const i = h('i'); i.style.width = Math.min(100, s.xp / need * 100) + '%'; return i; })())),
          h('button', { type: 'button', class: 'btn ghost small', title: 'Remove skill', onclick: () => setSkills(a.skills.map(x => x.id).filter(x => x !== s.id)) }, 'Remove')),
        h('span', { class: 'hint', text: k.description }),
        k.tools.length ? h('div', { class: 'tools' }, k.tools.map(toolChip)) : h('span', { class: 'hint', text: 'Instructions only, no tools' })));
    }
    const available = Object.entries(cat).filter(([id]) => !a.skills.some(s => s.id === id) && !(id === 'planning' && !a.captain));
    const pick = h('select', { 'aria-label': 'Skill to add' }, available.map(([id, k]) => h('option', { value: id }, k.name + (k.custom ? ' (custom)' : ''))));
    box.append(h('div', { class: 'chat-input' }, pick, h('button', { type: 'button', class: 'btn', disabled: !available.length, onclick: () => setSkills([...a.skills.map(x => x.id), pick.value]) }, 'Add skill')));
    // custom skill
    const name = h('input', { placeholder: 'e.g. Excel wizard', maxlength: 40 }), desc = h('input', { placeholder: 'One line: what it is for', maxlength: 200 });
    const instr = h('textarea', { rows: 4, maxlength: 3000, placeholder: 'How to do the job well. This text is added to the crew member\'s instructions.' });
    const toolBoxes = Object.keys(S.tools).filter(t => !['create_mission', 'remember', 'ask_user'].includes(t)).map(t => { const c = h('input', { type: 'checkbox', value: t }); return h('label', { class: 'check' }, c, toolChip(t)); });
    box.append(h('details', {}, h('summary', { class: 'btn ghost' }, 'Create a new skill'),
      h('div', { class: 'sub' },
        h('label', { class: 'field' }, h('span', {}, 'Skill name'), name), h('label', { class: 'field' }, h('span', {}, 'Description'), desc),
        h('label', { class: 'field' }, h('span', {}, 'Instructions'), instr),
        h('div', { class: 'eyebrow', text: 'Tools this skill unlocks' }), h('div', { class: 'tools' }, toolBoxes),
        h('button', { type: 'button', class: 'btn primary', onclick: async () => {
          if (!name.value.trim()) return toast('Give the skill a name first.');
          try {
            const r = await api('/skill', { name: name.value, description: desc.value, instructions: instr.value, tools: toolBoxes.map(l => l.querySelector('input')).filter(c => c.checked).map(c => c.value) });
            S.skills = r.skills; await setSkills([...a.skills.map(x => x.id), r.id]); toast('Skill created and added');
          } catch (e) { fail(e); }
        } }, 'Create and add to ' + a.name))));
  }

  // memory (self-improvement)
  function subMemory(a, box) {
    box.append(h('p', { class: 'hint', text: `${a.name} reflects after every mission step and keeps short lessons. The newest 12 are added to their instructions, so they improve over time. You can add or remove lessons yourself.` }));
    const add = h('input', { placeholder: 'Teach a lesson, e.g. "Always save reports as Markdown"', maxlength: 300 });
    box.append(h('div', { class: 'chat-input' }, add, h('button', { type: 'button', class: 'btn', onclick: async () => { if (!add.value.trim()) return; try { await api(`/agent/${a.id}/lesson/add`, { text: add.value }); add.value = ''; } catch (e) { fail(e); } } }, 'Add')));
    const lessons = (a.lessons || []).map((l, i) => ({ ...l, i })).reverse();
    if (!lessons.length) box.append(h('div', { class: 'empty', text: 'No lessons yet. They appear after the first mission.' }));
    for (const l of lessons) box.append(h('div', { class: 'lesson' }, h('div', {}, l.text, h('small', { text: `${l.source === 'you' ? 'Added by you' : l.source === 'self' ? 'Saved while working' : l.source === 'trainer' ? 'Taught by ' + (l.by || 'the trainer') : l.source === 'onboarding' ? 'Onboarding' + (l.by ? ' with ' + l.by : '') : 'Learned from a mission'} · ${ago(l.at)}` })),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => api(`/agent/${a.id}/lesson/delete`, { index: l.i }).catch(fail) }, 'Forget')));
    if ((a.ideas || []).length) {
      box.append(h('div', { class: 'eyebrow', text: 'Skill ideas from ' + a.name }));
      a.ideas.forEach((idea, i) => box.append(h('div', { class: 'skill' }, h('b', {}, idea.name), h('span', { class: 'hint', text: idea.instructions }),
        h('div', { class: 'row-gap' }, h('button', { type: 'button', class: 'btn small primary', onclick: () => api(`/agent/${a.id}/idea/${i}/adopt`, {}).then(() => api('/state')).then(s => { S.skills = s.skills; }).catch(fail) }, 'Adopt skill'),
          h('button', { type: 'button', class: 'btn small ghost', onclick: () => api(`/agent/${a.id}/idea/${i}/dismiss`, {}).catch(fail) }, 'Dismiss')))));
    }
  }

  function subStats(a, box) {
    const st = a.stats;
    const rate = st.tasks ? Math.round(st.success / st.tasks * 100) + '%' : '–';
    const tile = (v, l) => h('div', { class: 'stat' }, h('b', { text: v }), h('span', { text: l }));
    box.append(h('div', { class: 'stats' },
      tile('LV ' + st.level, `${st.xp}/${st.level * 100} XP to next level`), tile(String(st.tasks), 'mission steps done'),
      tile(rate, 'success rate'), tile(money(st.cost), 'spent on AI'),
      tile(tokens(st.tokensIn + st.tokensOut), 'tokens used'), tile(dur(st.ms / 1000), 'time working'),
      tile(String((a.lessons || []).length), 'lessons learned'), tile(String(a.skills.length), 'skills')));
  }

  // ---------- missions ----------
  const usesPlan = E => (E.billings || []).includes('plan');
  const usesApi = E => (E.billings || []).includes('api') || E.simulated;
  const reqRange = T => T.requestsLow === T.requestsHigh ? String(T.requestsHigh) : `${T.requestsLow}–${T.requestsHigh}`;
  function estLabel(m) {
    const E = m.estimate; if (!E) return '';
    const parts = [];
    if (usesPlan(E)) parts.push(reqRange(E.total) + ' plan req.');
    if (usesApi(E) || !parts.length) parts.push(range$(E.total.costLow, E.total.costHigh));
    return parts.join(' + ');
  }
  function actualLabel(m) {
    const parts = [];
    if (m.actual.requests) parts.push(`${m.actual.requests} plan req.`);
    if (m.actual.cost || !parts.length) parts.push(money(m.actual.cost));
    return parts.join(' + ');
  }
  function renderMissions() {
    const list = clear($('#missionList'));
    $('#missionCount').textContent = S.missions.length ? `${S.missions.filter(m => m.status === 'running').length} running · ${S.missions.length} total` : '';
    if (!S.missions.length) list.append(h('li', { class: 'empty', text: 'No missions yet. Describe a goal above and Captain Cortex will plan it.' }));
    for (const m of S.missions) {
      list.append(h('li', { class: 'mission-item', tabindex: 0, role: 'button', onclick: () => openMission(m.id), onkeydown: e => { if (e.key === 'Enter') openMission(m.id); } },
        h('div', { class: 'title' }, m.source === 'schedule' ? h('span', { class: 'tag-s', title: 'Started by a schedule', text: '⏰ ' }) : null, m.title), h('span', { class: 'pill ' + m.status, text: STATUS[m.status] || m.status }),
        h('div', { class: 'meta' }, h('div', { class: 'steps-dots' }, (m.steps || []).map(s => h('i', { class: s.status, title: `${(agentById(s.agent) || {}).name || s.agent}: ${s.status}` }))),
          h('span', { class: 'num', text: m.status === 'awaiting_approval' ? 'est. ' + estLabel(m) : 'used ' + actualLabel(m) }), h('span', { text: ago(m.createdAt) }))));
    }
  }

  function openMission(id) {
    openMissionId = id;
    const dlg = $('#missionDlg');
    renderMissionDlg(true);
    if (!dlg.open) dlg.showModal();
  }
  function stepAgent(s) { return agentById(s.agent) || { id: s.agent, name: s.agent, sprite: 'nova' }; }
  function renderMissionDlg(force) {
    const dlg = $('#missionDlg'); const m = S.missions.find(x => x.id === openMissionId);
    if (!m) { if (dlg.open) dlg.close(); return; }
    if (!force && m.status === 'awaiting_approval' && dlg.dataset.status === 'awaiting_approval' && dlg.dataset.id === m.id) return;
    if (!force && dlg.dataset.editing === m.id && m.status === 'awaiting_approval') return;
    if (m.status !== 'awaiting_approval' || force) delete dlg.dataset.editing;
    const scroll = dlg.dataset.id === m.id ? (dlg.querySelector('.dlg-body') || {}).scrollTop || 0 : 0;
    const openSteps = dlg.dataset.id === m.id ? new Set([...dlg.querySelectorAll('details[data-step][open]')].map(d => d.dataset.step)) : new Set();
    const closedSteps = dlg.dataset.id === m.id ? new Set([...dlg.querySelectorAll('details[data-step]:not([open])')].map(d => d.dataset.step)) : new Set();
    dlg.dataset.status = m.status; dlg.dataset.id = m.id;
    clear(dlg);
    const close = h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Close');
    dlg.append(h('div', { class: 'dlg-head' }, h('div', { class: 'min0' }, h('span', { class: 'pill ' + m.status, text: STATUS[m.status] || m.status }), ' ', h('h2', { class: 'inline', text: m.title })), close));
    const body = h('div', { class: 'dlg-body' }); const foot = h('div', { class: 'dlg-foot' });
    dlg.append(body, foot);
    body.append(h('div', { class: 'goal', text: m.goal }));
    if (m.status === 'planning') {
      body.append(h('div', { class: 'notice' }, h('div', { class: 'who' }, portrait(agentById('cortex') || S.agents[0]), h('span', {}, 'Captain Cortex is drafting the plan and estimating cost, usage and time…'))));
      foot.append(h('button', { type: 'button', class: 'btn ghost', onclick: () => api(`/mission/${m.id}/cancel`, {}).catch(fail) }, 'Cancel'));
    } else if (m.status === 'awaiting_approval') estimateReport(m, body, foot);
    else if (m.status === 'running') progressView(m, body, foot);
    else if (m.status === 'interrupted') interruptedView(m, body, foot);
    else finalView(m, body, foot);
    for (const d of body.querySelectorAll('details[data-step]')) { if (openSteps.has(d.dataset.step)) d.open = true; else if (closedSteps.has(d.dataset.step)) d.open = false; }
    body.scrollTop = scroll;
  }

  function estimateReport(m, body, foot) {
    const E = m.estimate, T = E.total, plan = usesPlan(E), paid = usesApi(E);
    body.append(h('div', { class: 'eyebrow', text: 'Pre-mission report from Captain Cortex' }));
    if (m.plan.summary) body.append(h('p', { text: m.plan.summary }));
    const tiles = [];
    if (plan) tiles.push(h('div', { class: 'tile key' }, h('span', { text: 'Plan usage' }), h('b', { text: reqRange(T) + ' requests' }), h('span', { text: `from your plan · today ${S.spend.planToday}/${S.spend.planDaily} used` })));
    if (paid || !plan) tiles.push(h('div', { class: 'tile key' }, h('span', { text: 'Estimated cost' }), h('b', { text: range$(T.costLow, T.costHigh) }), h('span', { text: E.simulated ? 'simulated (demo crew)' : 'real money, from model prices' })));
    tiles.push(h('div', { class: 'tile key' }, h('span', { text: 'Estimated time' }), h('b', { text: durRange(T.minutesLow, T.minutesHigh) }), h('span', { text: E.parallel ? `steps run side by side (one by one: ~${dur(T.serialMinutes * 60)})` : 'not counting time waiting for you' })));
    tiles.push(h('div', { class: 'tile' }, h('span', { text: 'Steps' }), h('b', { text: String(m.steps.length) }), h('span', { text: 'crew: ' + [...new Set(m.steps.map(s => stepAgent(s).name))].length + (plan ? '' : ' · ' + tokens(T.tokensLow) + '–' + tokens(T.tokensHigh) + ' tokens') })));
    body.append(h('div', { class: 'tiles' }, tiles));
    if (plan) body.append(h('div', { class: 'notice', text: 'Plan steps use your own Claude or ChatGPT subscription, so they cost no extra money but count toward your plan\'s usage limits, just like chatting. Starcrew also keeps its own daily request limit (Settings › Budget).' }));
    if (E.routingSaved > 0.0001) body.append(h('div', { class: 'notice ok', text: `Model routing saves about ${money(E.routingSaved)} on this mission by giving small steps to a cheaper model.` }));
    if (E.priceMissing.length) body.append(h('div', { class: 'notice warn', text: `Prices are not set for ${E.priceMissing.join(', ')}, so those steps count as $0. Add prices in Settings › AI models for a real cost estimate.` }));
    if (m.planNote) body.append(h('div', { class: 'notice warn', text: m.planNote }));
    if (m.plan.edited) body.append(h('div', { class: 'notice', text: 'You edited this plan. The estimate below is for your version.' }));
    const hires = (m.plan.hires || []).map(x => ({ ...x, t: (S.templates || []).find(t => t.id === x.template) })).filter(x => x.t && !S.agents.some(a => a.hiredFrom === x.t.id || a.id === x.t.agentId));
    if (hires.length) body.append(h('div', { class: 'notice' }, h('b', { text: 'Cortex suggests adding to the crew' }),
      h('div', { class: 'hire-grid mt8' }, hires.map(x => h('div', { class: 'hire' },
        h('div', { class: 'who' }, (() => { const c = portrait({ id: 'tpl-' + x.t.id, sprite: x.t.sprite, look: x.t.look }, 48); c.className = 'hire-pic'; return c; })(), h('div', {}, h('b', { text: x.t.name }), h('div', { class: 'eyebrow', text: x.t.role }))),
        h('p', { class: 'hint', text: x.why || x.t.pitch }),
        h('button', { type: 'button', class: 'btn small primary', onclick: async () => { try { const a = await api('/hire', { id: x.t.id }); if (!agentById(a.id)) S.agents.push(a); office.sync(S.agents); await api(`/mission/${m.id}/revise`, { feedback: `${a.name} (${a.role}, id ${a.id}) just joined the crew. Use them where they fit.` }); toast(`${a.name} hired. Cortex is updating the plan.`); } catch (e) { fail(e); } } }, 'Hire & re-plan')))),
      h('span', { class: 'hint', text: 'Or approve as is: the current crew will do the work.' })));
    const num = id => m.steps.findIndex(s => s.id === id) + 1;
    const rows = m.steps.map((s, i) => {
      const p = E.perStep.find(x => x.stepId === s.id) || {};
      const a = stepAgent(s);
      return h('tr', {}, h('td', { class: 'num', text: String(i + 1) }), h('td', {}, h('div', { class: 'who' }, portrait(a), h('div', {}, h('b', { text: a.name }), h('div', { class: 'hint', text: p.model || '' })))),
        h('td', {}, s.task, h('div', { class: 'hint', text: (s.after || []).length ? 'Starts after step ' + s.after.map(num).join(', ') : 'Starts right away' }), p.mayAsk && p.mayAsk.length ? h('div', { class: 'hint', text: 'May ask you before: ' + p.mayAsk.map(t => t.replace(/_/g, ' ')).join(', ') }) : null),
        h('td', { class: 'r', text: s.complexity }), h('td', { class: 'r', text: p.billing === 'plan' ? '≈' + p.requests + ' req.' : p.billing === 'free' ? 'free' : money(p.cost) }), h('td', { class: 'r', text: dur(p.seconds || 0) }));
    });
    body.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: '#' }), h('th', { text: 'Crew' }), h('th', { text: 'Task' }), h('th', { class: 'r', text: 'Size' }), h('th', { class: 'r', text: 'Est. usage' }), h('th', { class: 'r', text: 'Est. time' }))),
      h('tbody', {}, rows, h('tr', {}, h('td'), h('td', {}, h('b', { text: 'Captain Cortex' })), h('td', { text: 'Final mission report' }), h('td'), h('td', { class: 'r', text: E.report.requests ? '≈1 req.' : money(E.report.cost) }), h('td', { class: 'r', text: '15s' }))))));
    if (m.plan.risks.length) body.append(h('div', { class: 'notice' + (m.plan.risks.some(r => /money|password|delet|account|send|private/i.test(r)) ? ' bad' : '') }, h('b', { text: 'Risks' }), h('ul', {}, m.plan.risks.map(r => h('li', { text: r })))));
    if (E.approvals.length) body.append(h('div', { class: 'notice warn' }, h('b', { text: 'These actions will pause and wait for your OK' }), h('ul', {}, E.approvals.map(r => h('li', { text: r })))));
    if (m.plan.questions && m.plan.questions.length) body.append(h('div', { class: 'notice' }, h('b', { text: 'Questions from Cortex' }), h('ul', {}, m.plan.questions.map(q => h('li', { text: q }))), h('span', { class: 'hint', text: 'Answer them with “Request changes”.' })));
    body.append(h('p', { class: 'hint', text: `Estimate basis: ${E.basis}. Planning used ${E.planningRequests ? E.planningRequests + ' plan request(s)' : money(E.planningCost)}. An undo snapshot of the workspace is taken before the crew starts.` }));
    const budget = h('input', { type: 'number', min: 0.01, max: 1000, step: 0.05, value: m.budgetUsd });
    const reqs = h('input', { type: 'number', min: 1, max: 5000, step: 1, value: m.budgetRequests });
    body.append(h('div', { class: 'form-grid' },
      paid || !plan ? h('label', { class: 'field' }, h('span', {}, 'Spending cap for this mission (USD). The crew pauses and asks you if it is reached.'), budget) : null,
      plan ? h('label', { class: 'field' }, h('span', {}, 'Plan request limit for this mission. The crew pauses and asks you if it is reached.'), reqs) : null));
    const fb = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'What should Cortex change? e.g. "Skip the design step and use Nova for research only."' });
    const fbBox = h('div', { class: 'field' }, fb, h('div', { class: 'row-gap' }, h('button', { type: 'button', class: 'btn', onclick: async () => { if (!fb.value.trim()) return; try { await api(`/mission/${m.id}/revise`, { feedback: fb.value }); } catch (e) { fail(e); } } }, 'Send to Cortex')));
    fbBox.hidden = true; body.append(fbBox);
    foot.append(
      h('button', { type: 'button', class: 'btn ghost', onclick: () => api(`/mission/${m.id}/cancel`, {}).catch(fail) }, 'Cancel mission'),
      h('button', { type: 'button', class: 'btn', onclick: () => { fbBox.hidden = false; fb.focus(); } }, 'Request changes'),
      h('button', { type: 'button', class: 'btn', title: 'Change steps, crew, order and what runs in parallel', onclick: () => { $('#missionDlg').dataset.editing = m.id; planEditor(m); } }, '✎ Edit plan'),
      h('button', { type: 'button', class: 'btn gold', onclick: async () => { try { await api(`/mission/${m.id}/approve`, { budgetUsd: Number(budget.value), budgetRequests: Number(reqs.value) }); toast('Mission launched'); sound('launch'); } catch (e) { fail(e); } } }, 'Approve & launch'));
  }

  function planEditor(m) {
    const dlg = $('#missionDlg'); clear(dlg);
    const crew = S.agents.filter(a => a.enabled && !a.captain);
    let rows = m.steps.map(st => ({ agent: st.agent, task: st.task, complexity: st.complexity, after: (st.after || []).map(id => m.steps.findIndex(x => x.id === id) + 1) }));
    const body = h('div', { class: 'dlg-body' }), list = h('div', { class: 'plan-edit' });
    const draw = () => {
      clear(list);
      rows.forEach((r, i) => {
        const owner = crew.some(a => a.id === r.agent) ? [] : [h('option', { value: r.agent, selected: true, disabled: true }, `${(agentById(r.agent) || { name: r.agent }).name} (not available: pick someone)`)];
        const agentSel = h('select', { 'aria-label': `Step ${i + 1} crew member` }, owner, crew.map(a => h('option', { value: a.id, selected: r.agent === a.id }, `${a.name} · ${a.role}`)));
        agentSel.addEventListener('change', () => { r.agent = agentSel.value; });
        const task = h('textarea', { rows: 2, maxlength: 1500, value: r.task, 'aria-label': `Step ${i + 1} task` }); task.addEventListener('input', () => { r.task = task.value; });
        const size = h('select', { 'aria-label': 'Size' }, [['S', 'Small'], ['M', 'Medium'], ['L', 'Large']].map(([v, l]) => h('option', { value: v, selected: r.complexity === v }, l))); size.addEventListener('change', () => { r.complexity = size.value; });
        const deps = h('div', { class: 'row-gap deps' }, h('span', { class: 'hint', text: i ? 'Wait for:' : 'Starts right away' }), rows.slice(0, i).map((_, k) => {
          const c = h('input', { type: 'checkbox', checked: r.after.includes(k + 1) });
          c.addEventListener('change', () => { r.after = c.checked ? [...r.after, k + 1] : r.after.filter(n => n !== k + 1); });
          return h('label', { class: 'check' }, c, h('span', { text: 'step ' + (k + 1) }));
        }));
        const move = (d) => { const j = i + d; if (j < 0 || j >= rows.length) return; const map = n => n === i + 1 ? j + 1 : n === j + 1 ? i + 1 : n; [rows[i], rows[j]] = [rows[j], rows[i]]; rows.forEach((x, idx) => { x.after = x.after.map(map).filter(n => n < idx + 1); }); draw(); };
        list.append(h('div', { class: 'pe-row' },
          h('div', { class: 'pe-num', text: String(i + 1) }),
          h('div', { class: 'grid-gap' }, h('div', { class: 'pe-top' }, agentSel, size), task, deps),
          h('div', { class: 'pe-tools' },
            h('button', { type: 'button', class: 'btn ghost small', title: 'Move up', disabled: !i, onclick: () => move(-1) }, '↑'),
            h('button', { type: 'button', class: 'btn ghost small', title: 'Move down', disabled: i === rows.length - 1, onclick: () => move(1) }, '↓'),
            h('button', { type: 'button', class: 'btn ghost small', title: 'Remove step', disabled: rows.length === 1, onclick: () => { rows.splice(i, 1); rows.forEach(x => { x.after = x.after.filter(n => n !== i + 1).map(n => n > i + 1 ? n - 1 : n); }); draw(); } }, '✕'))));
      });
    };
    draw();
    body.append(h('p', { class: 'hint', text: 'Change who does each step, what they do, and which steps must finish first. Steps that wait for nothing run at the same time. Cortex re-estimates when you save.' }), list,
      h('button', { type: 'button', class: 'btn', disabled: rows.length >= 12 || !crew.length, title: crew.length ? '' : 'Turn a crew member on duty first', onclick: () => { rows.push({ agent: crew[0].id, task: '', complexity: 'M', after: rows.length ? [rows.length] : [] }); draw(); } }, '+ Add step'));
    const close = () => { delete dlg.dataset.editing; renderMissionDlg(true); };
    dlg.append(h('div', { class: 'dlg-head' }, h('h2', { text: 'Edit plan: ' + m.title }), h('button', { type: 'button', class: 'btn ghost', onclick: close }, 'Cancel')), body,
      h('div', { class: 'dlg-foot' }, h('button', { type: 'button', class: 'btn ghost', onclick: close }, 'Cancel'),
        h('button', { type: 'button', class: 'btn primary', onclick: async () => { try { const mm = await api(`/mission/${m.id}/plan`, { steps: rows }); upsert(S.missions, mm); toast('Plan updated and re-estimated'); close(); } catch (e) { fail(e); } } }, 'Save plan')));
  }

  function interruptedView(m, body, foot) {
    const done = m.steps.filter(s => s.status === 'done').length;
    body.append(h('div', { class: 'notice warn' }, h('b', { text: 'Starcrew closed while this mission was ' + (m.interruptedPhase === 'planning' ? 'being planned.' : 'running.') }),
      h('p', { text: m.interruptedPhase === 'planning' ? 'Resume to let Cortex finish the plan.' : `${done} of ${m.steps.length} steps were finished and are kept. Resume to continue from the next step; anyone who was mid-step picks up their partial work.` })));
    if (m.steps.length) stepList(m, body);
    foot.append(h('button', { type: 'button', class: 'btn ghost', onclick: () => api(`/mission/${m.id}/cancel`, {}).then(() => toast('Mission closed')).catch(fail) }, 'Close mission'),
      h('button', { type: 'button', class: 'btn gold', onclick: () => api(`/mission/${m.id}/resume`, {}).then(() => { toast('Mission resumed'); sound('launch'); }).catch(fail) }, '▶ Resume mission'));
  }

  function stepList(m, body) {
    const num = id => m.steps.findIndex(s => s.id === id) + 1;
    for (const [i, s] of m.steps.entries()) {
      const a = stepAgent(s);
      const waitingOn = s.status === 'pending' && (s.after || []).length ? ' · waits for step ' + s.after.map(num).join(', ') : '';
      body.append(h('div', { class: 'step-row ' + s.status },
        h('div', { class: 'top' }, h('div', { class: 'who' }, portrait(a, 32, s.status === 'running' ? 'work' : 'idle'), h('b', { text: `${i + 1}. ${a.name}` })),
          h('span', { class: 'pill ' + (s.status === 'pending' ? 'cancelled' : s.status), text: s.status === 'pending' ? 'Waiting' : s.status === 'running' ? 'Working' : STATUS[s.status] || s.status })),
        h('span', {}, s.task, waitingOn ? h('span', { class: 'hint', text: waitingOn }) : null),
        s.output ? h('details', { open: s.status === 'failed', 'data-step': s.id }, h('summary', {}, 'Result' + (s.actual ? ` · ${s.actual.requests ? s.actual.requests + ' req.' : money(s.actual.cost)} · ${dur((s.ms || 0) / 1000)}` : '')), mdEl(s.output)) : null));
    }
  }
  function progressView(m, body, foot) {
    const done = m.steps.filter(s => s.status === 'done').length, running = m.steps.filter(s => s.status === 'running').length;
    const el = (Date.now() - new Date(m.startedAt).getTime()) / 1000;
    const plan = usesPlan(m.estimate);
    body.append(h('div', { class: 'tiles' },
      plan ? h('div', { class: 'tile key' }, h('span', { text: 'Plan requests' }), h('b', { text: String(m.actual.requests || 0) }), h('span', { text: 'limit ' + m.budgetRequests })) : null,
      !plan || usesApi(m.estimate) ? h('div', { class: 'tile key' }, h('span', { text: 'Spent so far' }), h('b', { text: money(m.actual.cost) }), h('span', { text: 'cap ' + money(m.budgetUsd) })) : null,
      h('div', { class: 'tile' }, h('span', { text: 'Progress' }), h('b', { text: `${done}/${m.steps.length}` }), h('span', { text: running > 1 ? `${running} steps running together` : 'steps done' })),
      h('div', { class: 'tile' }, h('span', { text: 'Running for' }), h('b', { text: dur(el) }), h('span', { text: 'est. ' + durRange(m.estimate.total.minutesLow, m.estimate.total.minutesHigh) }))));
    if (m.snapshot && m.snapshot.at) body.append(h('p', { class: 'hint', text: `Undo snapshot taken (${m.snapshot.files} files). You can roll the workspace back when the mission ends.` }));
    stepList(m, body);
    foot.append(h('button', { type: 'button', class: 'btn danger', onclick: () => api(`/mission/${m.id}/cancel`, {}).catch(fail) }, 'Cancel mission'));
  }
  function finalView(m, body, foot) {
    if (m.error) body.append(h('div', { class: 'notice bad', text: m.error }));
    const unfinished = (m.steps || []).filter(x => x.status !== 'done').length;
    if (['failed', 'cancelled'].includes(m.status) && unfinished && m.plan) body.append(h('div', { class: 'row-gap' }, h('button', { type: 'button', class: 'btn gold', onclick: () => api(`/mission/${m.id}/resume`, {}).then(() => toast('Retrying the unfinished steps')).catch(fail) }, `↻ Retry the ${unfinished} unfinished step${unfinished === 1 ? '' : 's'}`), h('span', { class: 'hint', text: 'Finished steps are kept.' })));
    if (m.status === 'done' || m.status === 'failed') {
      const rateBtn = (r, label) => h('button', { type: 'button', class: 'btn small rate' + (m.rating === r ? ' on' : ''), 'aria-pressed': String(m.rating === r), onclick: async () => { try { await api(`/mission/${m.id}/feedback`, { rating: r }); toast(r > 0 ? 'Thanks! The crew earned XP.' : 'Noted. The trainer will coach the crew on this.'); } catch (e) { fail(e); } } }, label);
      body.append(h('div', { class: 'row-gap rate-row' }, h('span', { class: 'hint', text: 'How did the crew do?' }), rateBtn(1, '👍 Good'), rateBtn(-1, '👎 Needs work')));
    }
    if (m.rolledBackAt) body.append(h('div', { class: 'notice warn', text: `The workspace was rolled back to before this mission (${ago(m.rolledBackAt)}).` }));
    if (m.report) body.append(h('div', { class: 'card pad' }, mdEl(m.report)));
    if (m.estimate) {
      const T = m.estimate.total, plan = usesPlan(m.estimate);
      body.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Estimate vs actual' }), h('th', { class: 'r', text: 'Estimated' }), h('th', { class: 'r', text: 'Actual' }))),
        h('tbody', {},
          plan ? h('tr', {}, h('td', { text: 'Plan requests' }), h('td', { class: 'r', text: reqRange(T) }), h('td', { class: 'r', text: String(m.actual.requests || 0) })) : null,
          plan && !usesApi(m.estimate) && !m.actual.cost ? null : h('tr', {}, h('td', { text: 'Cost' + (m.estimate.simulated ? ' (simulated)' : '') }), h('td', { class: 'r', text: range$(T.costLow, T.costHigh) }), h('td', { class: 'r', text: money(m.actual.cost) })),
          h('tr', {}, h('td', { text: 'Time' }), h('td', { class: 'r', text: durRange(T.minutesLow, T.minutesHigh) }), h('td', { class: 'r', text: dur(m.actual.ms / 1000) })),
          h('tr', {}, h('td', { text: 'Tokens' }), h('td', { class: 'r', text: tokens(T.tokensLow) + '–' + tokens(T.tokensHigh) }), h('td', { class: 'r', text: tokens(m.actual.tokens) }))))));
    }
    if ((m.files || []).length) body.append(h('div', {}, h('div', { class: 'eyebrow', text: 'Files the crew made' }), h('div', { class: 'tools' }, m.files.map(f => h('button', { type: 'button', class: 'btn small', onclick: () => openFiles(f) }, f)))));
    if (m.steps && m.steps.length) { body.append(h('div', { class: 'eyebrow', text: 'Steps' })); stepList(m, body); }
    let armed = false, armedRb = false;
    foot.append(
      h('button', { type: 'button', class: 'btn ghost', onclick: async e => {
        if (!armed) { armed = true; e.currentTarget.textContent = 'Click again to remove'; return; }
        try { await api(`/mission/${m.id}/delete`, {}); S.missions = S.missions.filter(x => x.id !== m.id); renderMissions(); $('#missionDlg').close(); } catch (err) { fail(err); }
      } }, 'Remove from list'),
      m.snapshot && m.snapshot.at && !m.rolledBackAt ? h('button', { type: 'button', class: 'btn', title: 'Put the workspace back the way it was before this mission started', onclick: async e => {
        if (!armedRb) { armedRb = true; e.currentTarget.textContent = 'Click again: undo all file changes since this mission started'; return; }
        try { await api(`/mission/${m.id}/rollback`, {}); toast('Workspace rolled back'); } catch (err) { fail(err); }
      } }, '↶ Undo file changes') : null,
      h('button', { type: 'button', class: 'btn', onclick: async () => { try { const p = await api(`/mission/${m.id}/playbook`, {}); toast('Saved as a playbook'); $('#missionDlg').close(); openPlaybooks(p.id); } catch (e) { fail(e); } } }, 'Save as playbook'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => { $('#goal').value = m.goal; $('#missionDlg').close(); $('#goal').focus(); } }, 'Run again'));
  }

  // ---------- approvals ----------
  function approvalCard(ap, inChat) {
    const a = agentById(ap.agentId) || { id: ap.agentId, name: ap.agentId, sprite: 'nova' };
    const mis = ap.missionId && S.missions.find(m => m.id === ap.missionId);
    const card = h('div', { class: 'ap ' + (ap.risk || '') + (inChat ? ' inchat' : '') });
    const title = ap.type === 'question' ? 'has a question' : ap.type === 'budget' ? 'needs more budget' : TOOL_TITLE[ap.tool] || `wants to use ${String(ap.tool).startsWith('mcp_') ? 'a connector tool: ' + ap.tool.split('_').slice(2).join(' ') : ap.tool}`;
    card.append(h('div', { class: 'ap-head' }, portrait(a, 40), h('div', {}, h('b', { text: `${a.name} ${title}` }), h('span', { class: 'hint', text: mis ? 'Mission: ' + mis.title : 'Direct chat' })), ap.risk ? h('span', { class: 'pill ' + ap.risk, text: ap.risk + ' risk' }) : null));
    const args = ap.args || {};
    const go = body => api(`/approval/${ap.id}`, body).then(() => sound('click')).catch(fail);
    if (ap.type === 'question') {
      card.append(h('p', { text: ap.question }));
      const ans = h('textarea', { rows: 2, maxlength: 2000, placeholder: 'Your answer' });
      ans.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go({ answer: ans.value || '(no answer)' }); } });
      card.append(ans, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn gold', onclick: () => go({ answer: ans.value || '(no answer)' }) }, 'Answer'), h('button', { type: 'button', class: 'btn ghost', onclick: () => go({ answer: '' }) }, 'Skip')));
      return card;
    }
    if (ap.type === 'budget') card.append(h('p', { text: ap.reason }));
    if (args.command) card.append(h('pre', { text: args.command }));
    if (args.url) card.append(h('pre', { text: args.url }));
    if (args.name && !args.command) card.append(h('pre', { text: args.name }));
    if (args.path) card.append(h('pre', { text: 'workspace/' + args.path + (args.content ? '\n\n' + String(args.content).slice(0, 600) + (String(args.content).length > 600 ? '\n…' : '') : '') }));
    if (args.field) card.append(h('pre', { text: `Field: ${args.field}\nText: ${args.text || ''}${args.press_enter ? '\n(then press Enter)' : ''}` }));
    if (args.text && !args.field) card.append(h('pre', { text: 'Click: ' + args.text }));
    if (args.selector && !args.field) card.append(h('pre', { text: 'Click: ' + args.selector }));
    if (String(ap.tool || '').startsWith('mcp_') && Object.keys(args).length) card.append(h('pre', { text: JSON.stringify(args, null, 2).slice(0, 1200) }));
    if (ap.reason && ap.type !== 'budget') card.append(h('p', { class: 'hint', text: 'Why: ' + ap.reason }));
    card.append(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn gold', onclick: () => go({ decision: 'approve' }) }, ap.type === 'budget' ? 'Allow more' : 'Approve'),
      h('button', { type: 'button', class: 'btn', onclick: () => go({ decision: 'deny' }) }, ap.type === 'budget' ? 'Stop mission' : 'Deny'),
      ap.missionId && ap.tool ? h('button', { type: 'button', class: 'btn ghost', title: 'Approve this tool for the rest of this mission', onclick: () => go({ decision: 'approve', scope: 'mission' }) }, 'Allow for this mission') : null,
      !ap.missionId && ap.chatThread && ap.tool ? h('button', { type: 'button', class: 'btn ghost', title: 'Approve this tool for the rest of this chat', onclick: () => go({ decision: 'approve', scope: 'chat' }) }, 'Allow in this chat') : null));
    return card;
  }
  function renderApprovals() {
    const n = S.approvals.length;
    $('#apCount').hidden = !n; $('#apCount').textContent = String(n);
    document.title = (n ? `(${n}) ` : '') + 'Starcrew Command';
    const box = clear($('#tab-approvals'));
    if (!n) box.append(h('div', { class: 'empty', text: 'Nothing waiting. When a crew member wants to do something risky, it shows up here and they wait for you.' }));
    for (const ap of S.approvals) box.append(approvalCard(ap));
    renderChatApprovals();
  }

  // ---------- activity ----------
  function activityNode(e) {
    const a = e.agentId && agentById(e.agentId);
    let what = '';
    if (e.type === 'tool') what = `${e.tool.replace(/_/g, ' ')}${e.args && (e.args.url || e.args.path || e.args.command) ? ': ' + (e.args.url || e.args.path || e.args.command) : ''} · ${e.error ? 'error: ' + e.error : e.decision}`;
    else if (e.type === 'blocked') what = `BLOCKED ${e.tool || ''}: ${e.note}`;
    else if (e.type === 'approval') what = `You ${e.decision} ${String(e.tool || 'the request').replace(/_/g, ' ')}${e.scope === 'mission' ? ' for the whole mission' : ''}`;
    else what = e.note || e.type;
    const cls = e.type === 'blocked' || e.error || e.decision === 'denied' ? 'bad' : e.type === 'progress' || e.decision === 'approved' ? 'ok' : '';
    return h('li', {}, h('time', { text: new Date(e.at).toLocaleTimeString() + (a ? ' · ' + a.name : '') + ' · ' + e.type }), h('span', { class: 'what ' + cls, text: what }));
  }
  function renderActivity() {
    const list = clear($('#activityList'));
    if (!auditItems.length) list.append(h('li', { class: 'empty', text: 'Every action the crew takes is logged here, including anything blocked.' }));
    for (const e of auditItems.slice(0, 200)) list.append(activityNode(e));
  }

  // ---------- tabs ----------
  function switchTab(t) {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    for (const id of ['agent', 'approvals', 'activity', 'commands']) $('#tab-' + id).hidden = id !== t;
    if (t === 'commands') renderCommands();
    if (t === 'activity' && !auditItems.length) api('/audit').then(x => { auditItems = x; renderActivity(); }).catch(fail);
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // ---------- sound + notifications ----------
  let actx = null;
  function sound(kind) {
    if (!S || !S.settings.office || !S.settings.office.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const notes = { click: [880], poke: [660, 990], notify: [784, 1047], launch: [392, 523, 659, 784], done: [523, 659, 784, 1047], level: [659, 784, 988, 1319], error: [330, 247] }[kind] || [660];
      notes.forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.09;
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.14);
      });
    } catch (e) { /* audio is optional */ }
  }
  function browserNotify(text) {
    const n = S.settings.notifications || {};
    if (!n.browser || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
    try { const x = new Notification('Starcrew', { body: text, icon: 'favicon.svg', tag: 'starcrew' }); x.onclick = () => { window.focus(); x.close(); }; } catch (e) { /* ignore */ }
  }

  // ---------- setup: pick how the crew thinks ----------
  async function setupPanel(body, { wizard } = {}) {
    const box = h('div', { class: 'setup' }, h('p', { class: 'hint', text: 'Checking what is installed on this computer…' }));
    body.append(box);
    let det;
    try { det = await api('/setup/detect'); } catch (e) { clear(box).append(h('div', { class: 'notice bad', text: e.message })); return; }
    const st = S.settings;
    const term = action => api('/setup/terminal', { action }).then(r => toast(`A window opened running "${r.command}". Finish there, then press Check again.`)).catch(fail);
    const choose = async (model, extra = {}) => {
      try { S.settings = await api('/setup/choose', { model, ...extra }); refreshAgents(); toast('The crew now uses ' + (S.settings.models.find(m => m.key === model) || {}).label); sound('done'); if (wizard) $('#setupDlg').close(); else renderSettings(); }
      catch (e) { fail(e); }
    };
    const check = (ok, text) => h('div', { class: 'check-line ' + (ok ? 'ok' : '') }, h('span', { class: 'ck', text: ok ? '✓' : '○' }), h('span', { text }));
    const isWin = det.platform === 'win32';
    const cur = st.models.find(m => m.key === st.defaultModel) || {};
    clear(box);
    const card = (title, badge, desc, ...kids) => h('div', { class: 'setup-card' + (badge === 'In use' ? ' current' : '') }, h('div', { class: 'row-between' }, h('h3', { text: title }), badge ? h('span', { class: 'pill ' + (badge === 'In use' ? 'done' : 'awaiting_approval'), text: badge }) : null), h('p', { class: 'hint', text: desc }), ...kids);
    // Claude plan
    const cl = det.claude, cm = h('select', { 'aria-label': 'Claude model' }, [['plan-claude-sonnet', 'Sonnet: fast, great for most work'], ['plan-claude-opus', 'Opus: strongest, uses more of your plan'], ['plan-claude-haiku', 'Haiku: quickest, lightest on usage']].map(([k, l]) => h('option', { value: k, selected: cur.key === k }, l)));
    const clRoute = h('input', { type: 'checkbox', checked: true });
    box.append(card('Claude plan (Pro or Max)', cur.endpoint === 'claude-plan' ? 'In use' : 'Recommended', 'Uses your Claude subscription through Claude Code, Anthropic\'s official app. No API key, no per-token bills: it counts toward your plan\'s usage limits, like chatting on claude.ai.',
      check(cl.installed, cl.installed ? `Claude Code installed (${cl.version})` : 'Claude Code is not installed yet'),
      cl.installed ? null : h('button', { type: 'button', class: 'btn', onclick: () => term('install-claude') }, 'Install Claude Code'),
      check(!!cl.signedIn, cl.signedIn ? (cl.detail || 'Signed in') : 'Not signed in yet'),
      cl.installed && !cl.signedIn ? h('button', { type: 'button', class: 'btn', onclick: () => term('login-claude') }, 'Sign in to Claude') : null,
      h('label', { class: 'field' }, h('span', {}, 'Model'), cm),
      h('label', { class: 'check' }, clRoute, h('span', {}, 'Save usage: Haiku for small steps, Opus for planning and big steps')),
      h('button', { type: 'button', class: 'btn primary', disabled: !(cl.installed && cl.signedIn), onclick: () => choose(cm.value, { routing: clRoute.checked ? { enabled: true, cheapModel: 'plan-claude-haiku', strongModel: 'plan-claude-opus' } : { enabled: false } }) }, 'Use my Claude plan')));
    // ChatGPT plan
    const cx = det.codex;
    box.append(card('ChatGPT plan (Plus or Pro)', cur.endpoint === 'chatgpt-plan' ? 'In use' : '', 'Uses your ChatGPT subscription through Codex, OpenAI\'s official command-line app. Counts toward your ChatGPT plan\'s Codex usage limits.',
      check(cx.installed, cx.installed ? `Codex installed (${cx.version})` : 'Codex is not installed yet'),
      cx.installed ? null : h('button', { type: 'button', class: 'btn', onclick: () => term('install-codex') }, 'Install Codex'),
      check(!!cx.signedIn, cx.signedIn ? 'Signed in' : 'Not signed in yet'),
      cx.installed && !cx.signedIn ? h('button', { type: 'button', class: 'btn', onclick: () => term('login-codex') }, 'Sign in with ChatGPT') : null,
      h('button', { type: 'button', class: 'btn primary', disabled: !(cx.installed && cx.signedIn), onclick: () => choose('plan-chatgpt', { routing: { enabled: false } }) }, 'Use my ChatGPT plan')));
    // Ollama
    const ol = det.ollama, om = h('select', { 'aria-label': 'Local model' }, (ol.models.length ? ol.models : ['llama3.1']).map(n => h('option', { value: n }, n)));
    box.append(card('Free local models (Ollama)', cur.endpoint === 'ollama' ? 'In use' : '', 'Runs open models on your own computer: free and private, but slower and less capable. Needs a good computer.',
      check(ol.running, ol.running ? `Ollama is running · ${ol.models.length} model(s)` : 'Ollama is not running. Install it from ollama.com, then run: ollama pull llama3.1'),
      ol.running ? h('label', { class: 'field' }, h('span', {}, 'Model'), om) : null,
      h('button', { type: 'button', class: 'btn primary', disabled: !ol.running, onclick: async () => {
        try { const models = S.settings.models.map(m => m.key === 'ollama-llama' ? { ...m, model: om.value, label: om.value + ' on Ollama' } : m); S.settings = await api('/settings', { models }); await choose('ollama-llama', { routing: { enabled: false } }); } catch (e) { fail(e); }
      } }, 'Use Ollama')));
    // API key + demo
    box.append(card('API key (pay per use)', ['openai', 'anthropic', 'openrouter', 'gemini'].includes(cur.endpoint) ? 'In use' : '', 'For developers with an Anthropic, OpenAI, OpenRouter or Google API key. Billed per token; Starcrew estimates the dollars before every mission.',
      h('button', { type: 'button', class: 'btn', onclick: () => { if (wizard) $('#setupDlg').close(); settingsTab = 'models'; openSettings(); } }, 'Add an API key')));
    box.append(card('Demo crew', cur.endpoint === 'demo' ? 'In use' : '', 'Scripted answers, no account needed. Good for a tour: everything works except real thinking.',
      h('button', { type: 'button', class: 'btn', onclick: () => choose('demo', { routing: { enabled: false } }) }, wizard ? 'Just look around first' : 'Use the demo crew')));
    box.append(h('div', { class: 'row-between full' },
      h('p', { class: 'hint', text: 'Starcrew never asks for or stores your Claude or ChatGPT password: you sign in inside the official app\'s own window, and each person uses their own account.' }),
      h('button', { type: 'button', class: 'btn', onclick: () => { clear(body); if (wizard) body.append(wizardIntro()); setupPanel(body, { wizard }); } }, 'Check again')));
    if (!isWin) box.append(h('p', { class: 'hint full', text: 'If the Install or Sign in buttons do not open a window on your system, run the same command in a terminal: npm install -g @anthropic-ai/claude-code, then: claude auth login' }));
  }
  const wizardIntro = () => h('div', { class: 'wizard-intro' }, h('h2', { text: 'Welcome aboard, Commander!' }), h('p', { text: 'Pick how your crew thinks. You can change this any time in Settings › Setup, and give each crew member their own model.' }));
  function openSetupWizard() {
    const dlg = clear($('#setupDlg'));
    const body = h('div', { class: 'dlg-body' });
    dlg.append(h('div', { class: 'dlg-head' }, h('h2', { text: 'Set up Starcrew' }), h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Later')), body);
    body.append(wizardIntro());
    setupPanel(body, { wizard: true });
    dlg.showModal();
  }
  function refreshAgents() { api('/state').then(s => { S.agents = s.agents; S.settings = s.settings; S.skills = s.skills; office.sync(S.agents); renderRoster(); renderAgent(); renderSpend(); }).catch(() => {}); }

  // ---------- settings ----------
  let settingsTab = 'setup';
  function openSettings() { renderSettings(); if (!$('#settingsDlg').open) $('#settingsDlg').showModal(); }
  function renderSettings() {
    const dlg = clear($('#settingsDlg')); const st = S.settings;
    const TABS = [['setup', 'Setup'], ['models', 'AI models'], ['budget', 'Usage & budget'], ['safety', 'Safety'], ['connectors', 'Connectors'], ['handbook', 'Handbook'], ['alerts', 'Alerts & office'], ['about', 'About']];
    const tabs = h('div', { class: 'settings-tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(settingsTab === k), onclick: () => { settingsTab = k; renderSettings(); } }, l)));
    dlg.append(h('div', { class: 'dlg-head' }, h('h2', { text: 'Settings' }), tabs, h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Close')));
    const body = h('div', { class: 'dlg-body' }); dlg.append(body);
    const save = (patch, msg) => api('/settings', patch).then(s => { S.settings = s; toast(msg || 'Saved'); renderSpend(); office.setOptions(s.office); renderSettings(); }).catch(fail);
    const modelSel = (value, blank) => h('select', {}, blank ? h('option', { value: '', selected: !value }, blank) : null, st.models.map(m => h('option', { value: m.key, selected: value === m.key }, m.label)));

    if (settingsTab === 'setup') setupPanel(body);

    if (settingsTab === 'models') {
      const defSel = modelSel(st.defaultModel);
      defSel.addEventListener('change', () => save({ defaultModel: defSel.value }, 'Default model saved'));
      body.append(h('label', { class: 'field narrow' }, h('span', {}, 'Default model for the crew (each crew member can override it in their profile)'), defSel));
      // routing + parallel
      const rOn = h('input', { type: 'checkbox', checked: st.routing.enabled }), rCheap = modelSel(st.routing.cheapModel, '(same as default)'), rStrong = modelSel(st.routing.strongModel, '(same as default)');
      const pOn = h('input', { type: 'checkbox', checked: st.parallel.enabled }), pMax = h('input', { type: 'number', min: 1, max: 6, value: st.parallel.maxConcurrent });
      body.append(h('div', { class: 'notice' }, h('b', { text: 'Smart routing and teamwork' }),
        h('div', { class: 'form-grid mt8' },
          h('label', { class: 'check full' }, rOn, h('span', {}, 'Route by difficulty: small steps and reflections use the light model; planning, reports and big steps use the strong model. Crew members with their own model keep it.')),
          h('label', { class: 'field' }, h('span', {}, 'Light model (small steps)'), rCheap), h('label', { class: 'field' }, h('span', {}, 'Strong model (plans, reports, big steps)'), rStrong),
          h('label', { class: 'check' }, pOn, h('span', {}, 'Run independent steps at the same time')), h('label', { class: 'field' }, h('span', {}, 'At most this many at once'), pMax)),
        h('button', { type: 'button', class: 'btn primary', onclick: () => save({ routing: { enabled: rOn.checked, cheapModel: rCheap.value, strongModel: rStrong.value }, parallel: { enabled: pOn.checked, maxConcurrent: Number(pMax.value) } }, 'Routing saved') }, 'Save routing')));
      body.append(h('div', { class: 'eyebrow', text: 'Providers and API keys' }), h('p', { class: 'hint', text: 'Keys are stored only on this computer, in the Starcrew data folder, and are never sent to the browser or to the crew\'s commands. Plans (Claude, ChatGPT) need no key: set them up in the Setup tab.' }));
      for (const e of st.endpoints.filter(x => !['demo', 'claude-code', 'codex'].includes(x.type))) {
        const key = h('input', { type: 'password', placeholder: e.id === 'ollama' ? 'No key needed' : (e.keySet ? 'Saved: ' + e.keyHint : 'Paste API key'), autocomplete: 'off', 'aria-label': e.label + ' API key' });
        const url = e.type === 'compatible' ? h('input', { value: e.baseUrl, 'aria-label': e.label + ' address' }) : h('span', { class: 'hint mono', text: e.baseUrl });
        body.append(h('div', { class: 'provider' }, h('div', {}, h('b', { text: e.label }), h('div', { class: 'hint', text: e.keySet ? 'Key saved ' + e.keyHint : e.id === 'ollama' ? 'Local' : 'No key yet' })),
          h('div', { class: 'grid-gap' }, url, e.id === 'ollama' ? null : key),
          h('div', { class: 'row-gap' },
            h('button', { type: 'button', class: 'btn small', onclick: async () => {
              try {
                if (e.type === 'compatible' && url.value !== e.baseUrl) S.settings = await api('/settings', { endpoints: [{ id: e.id, baseUrl: url.value }] });
                if (key.value) S.settings = await api('/secret', { endpoint: e.id, key: key.value });
                toast('Saved ' + e.label); renderSettings();
              } catch (err) { fail(err); }
            } }, 'Save'),
            e.keySet ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => api('/secret', { endpoint: e.id, key: '' }).then(s => { S.settings = s; renderSettings(); }).catch(fail) }, 'Remove key') : null)));
      }
      body.append(h('div', { class: 'eyebrow', text: 'Models' }), h('p', { class: 'hint', text: 'Prices are US dollars per 1 million tokens (input / output) and power the cost estimates for API models. Plan and local models need no price.' }));
      const rows = st.models.map(m => ({ ...m }));
      const tbody = h('tbody');
      const drawRows = () => {
        clear(tbody);
        rows.forEach((m, i) => {
          const ep = st.endpoints.find(x => x.id === m.endpoint) || {};
          const noPrice = ['demo', 'plan', 'free'].includes(ep.billing);
          const inp = (k, attrs = {}) => { const el = h('input', { value: m[k] == null ? '' : m[k], ...attrs }); el.addEventListener('input', () => { m[k] = el.value; }); return el; };
          const sel = h('select', {}, st.endpoints.map(e => h('option', { value: e.id, selected: m.endpoint === e.id }, e.label))); sel.addEventListener('change', () => { m.endpoint = sel.value; drawRows(); });
          const result = h('span', { class: 'hint' });
          tbody.append(h('tr', {}, h('td', {}, inp('label', { maxlength: 60, 'aria-label': 'Label' })), h('td', {}, sel), h('td', {}, inp('model', { placeholder: ep.type === 'codex' ? '(Codex default)' : 'model name', disabled: m.endpoint === 'demo', 'aria-label': 'Model name' })),
            h('td', {}, noPrice ? h('span', { class: 'hint', text: ep.billing === 'plan' ? 'plan' : ep.billing === 'free' ? 'free' : 'demo' }) : inp('inPrice', { type: 'number', min: 0, step: 0.01, 'aria-label': 'Input price' })),
            h('td', {}, noPrice ? null : inp('outPrice', { type: 'number', min: 0, step: 0.01, 'aria-label': 'Output price' })),
            h('td', {}, h('div', { class: 'row-gap' },
              h('button', { type: 'button', class: 'btn small', onclick: async () => { result.textContent = 'Testing…'; try { const r = await api('/test-model', { key: m.key }); result.textContent = `OK in ${(r.ms / 1000).toFixed(1)}s: “${r.reply.slice(0, 30)}”`; } catch (e) { result.textContent = e.message; } } }, 'Test'),
              m.key === 'demo' ? null : h('button', { type: 'button', class: 'btn small ghost', onclick: () => { rows.splice(i, 1); drawRows(); } }, 'Remove')), result)));
        });
      };
      drawRows();
      body.append(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Label', 'Provider', 'Model name', '$ in / 1M', '$ out / 1M', ''].map(t => h('th', { text: t })))), tbody)),
        h('div', { class: 'row-gap' },
          h('button', { type: 'button', class: 'btn', onclick: () => { rows.push({ key: 'm-' + Math.random().toString(36).slice(2, 8), endpoint: 'openai', model: '', label: 'New model', inPrice: '', outPrice: '' }); drawRows(); } }, 'Add model'),
          h('button', { type: 'button', class: 'btn primary', onclick: () => save({ models: rows }, 'Models saved') }, 'Save models')));
    }

    if (settingsTab === 'budget') {
      const sp = S.spend;
      const daily = h('input', { type: 'number', min: 0, step: 0.5, value: st.budget.dailyUsd }), mission = h('input', { type: 'number', min: 0.01, step: 0.1, value: st.budget.missionUsd });
      const planDaily = h('input', { type: 'number', min: 1, step: 10, value: st.budget.dailyPlanRequests });
      const by = Object.entries(sp.planByEndpoint || {}).map(([k, v]) => `${(st.endpoints.find(e => e.id === k) || { label: k }).label}: ${v}`).join(' · ');
      body.append(h('div', { class: 'tiles' },
        h('div', { class: 'tile key' }, h('span', { text: 'Plan requests today' }), h('b', { text: `${sp.planToday} / ${sp.planDaily}` }), h('span', { text: by || 'none yet' })),
        h('div', { class: 'tile' }, h('span', { text: 'Plan work if paid by API' }), h('b', { text: money(sp.planApiEquiv) }), h('span', { text: 'what Claude Code reports; you are not charged this' })),
        h('div', { class: 'tile key' }, h('span', { text: 'API spend today' }), h('b', { text: money(sp.today) }), h('span', { text: 'real money, limit ' + money(sp.daily) })),
        h('div', { class: 'tile' }, h('span', { text: 'Demo crew today' }), h('b', { text: money(sp.simulatedToday) }), h('span', { text: 'simulated, not charged' }))),
        h('p', { class: 'hint', text: 'Plans have their own usage limits that reset over time (Claude and ChatGPT decide these, and they are shared with your normal chats). Starcrew cannot see how much of your plan is left, so it counts its own requests and stops at your daily limit below. If your plan runs out, the crew shows the plan\'s message and waits.' }),
        h('div', { class: 'form-grid' },
          h('label', { class: 'field' }, h('span', {}, 'Daily plan request limit. Each crew "turn" (think → act) is one request.'), planDaily), h('div'),
          h('label', { class: 'field' }, h('span', {}, 'Daily API limit (USD). The whole crew stops when it is reached.'), daily),
          h('label', { class: 'field' }, h('span', {}, 'Default cap per mission (USD). You can change it on each pre-mission report.'), mission)),
        h('button', { type: 'button', class: 'btn primary', onclick: () => save({ budget: { dailyUsd: Number(daily.value), missionUsd: Number(mission.value), dailyPlanRequests: Number(planDaily.value) } }, 'Limits saved') }, 'Save limits'));
    }

    if (settingsTab === 'safety') {
      const mode = h('select', {}, S.modes.map(m => h('option', { value: m, selected: st.safety.defaultPermission === m }, m[0].toUpperCase() + m.slice(1))));
      const modeHint = h('span', { class: 'hint', text: MODE_INFO[st.safety.defaultPermission] }); mode.addEventListener('change', () => { modeHint.textContent = MODE_INFO[mode.value]; });
      const blocked = h('textarea', { rows: 4, value: st.safety.blockedDomains.join('\n'), placeholder: 'one domain per line, e.g. mybank.com' });
      const timeout = h('input', { type: 'number', min: 5, max: 600, value: st.safety.commandTimeoutSec });
      const steps = h('input', { type: 'number', min: 2, max: 40, value: st.safety.maxStepsPerTask });
      const headless = h('input', { type: 'checkbox', checked: st.safety.browserHeadless });
      const reflect = h('input', { type: 'checkbox', checked: st.learning.reflectAfterTasks });
      const trainEvery = h('input', { type: 'number', min: 0, max: 100, value: st.learning.trainEvery == null ? 5 : st.learning.trainEvery });
      body.append(h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Permission for new crew members'), mode), h('div', {}, modeHint),
        h('label', { class: 'field full' }, h('span', {}, 'Blocked websites (the crew can never open these)'), blocked),
        h('label', { class: 'field' }, h('span', {}, 'Command time limit (seconds)'), timeout),
        h('label', { class: 'field' }, h('span', {}, 'Max AI steps per task'), steps),
        h('label', { class: 'check full' }, headless, h('span', {}, 'Hide the crew browser window (headless)')),
        h('label', { class: 'check full' }, reflect, h('span', {}, 'Let the crew reflect after each step and save lessons (self-improvement, uses a little extra)')),
        h('label', { class: 'field' }, h('span', {}, 'Training session after every N finished missions (0 = only when you press the button). Uses a few requests each time.'), trainEvery)),
        h('div', { class: S.browser ? 'notice ok' : 'notice warn', text: S.browser ? 'Crew browser installed. The crew uses its own separate browser profile, never your personal browser or passwords.' : 'Crew browser not installed. Web reading still works. To let the crew click and type on websites, close Starcrew, run INSTALL-BROWSER.bat (Windows) or ./start.sh --browser, and start again.' }),
        h('button', { type: 'button', class: 'btn primary', onclick: () => save({ safety: { defaultPermission: mode.value, blockedDomains: blocked.value.split('\n'), commandTimeoutSec: Number(timeout.value), maxStepsPerTask: Number(steps.value), browserHeadless: headless.checked }, learning: { reflectAfterTasks: reflect.checked, trainEvery: Number(trainEvery.value) } }, 'Safety settings saved') }, 'Save safety settings'),
        h('div', { class: 'notice' }, h('b', { text: 'How Starcrew keeps you safe' }), h('ul', {}, [
          'Runs only on this computer (127.0.0.1) and opens only through a private one-time link.',
          'API keys and connector secrets stay on the server; the page and the crew\'s commands never see them.',
          'Claude and ChatGPT plans: you sign in inside the official apps. Starcrew never sees those passwords, and their own tools are switched off so only Starcrew\'s checked tools run.',
          'Risky actions (clicking, typing, opening apps, connector tools) wait for your approval unless you choose Autopilot. Terminal commands and crew changes always ask, even on Autopilot.',
          'Dangerous commands (formatting, wiping, registry edits, download-and-run, reading passwords or keys) are always blocked.',
          'Files can only be read and written inside the workspace folder, and every mission takes an undo snapshot first.',
          'The crew cannot reach your home network or this app, and web pages are treated as untrusted data.',
          'Usage limits per day and per mission, plus Stop all to halt everything instantly.',
          'Every action is written to the Activity log.',
        ].map(t => h('li', { text: t })))));
    }

    if (settingsTab === 'connectors') {
      body.append(h('p', { class: 'hint', text: 'Connectors plug other apps into the crew using MCP (Model Context Protocol), the same plug-in standard Claude uses. Each connector is a small program that runs on this computer; its tools become a skill you can give to crew members. Only add connectors you trust.' }));
      const list = st.connectors || [];
      if (!list.length) body.append(h('div', { class: 'empty', text: 'No connectors yet.' }));
      for (const c of list) {
        const sk = S.skills['connector-' + c.id];
        const res = h('span', { class: 'hint', text: sk ? `${(sk.tools || []).length} tools: ${(sk.tools || []).map(t => t.split('_').slice(2).join('_')).slice(0, 8).join(', ')}` : c.enabled ? 'Not connected' : 'Off' });
        const give = h('select', { 'aria-label': 'Crew member' }, S.agents.map(a => h('option', { value: a.id }, a.name)));
        let armed = false;
        body.append(h('div', { class: 'skill' },
          h('div', { class: 'skill-head' }, h('b', { text: c.name }), h('span', { class: 'pill ' + (c.enabled ? 'done' : 'cancelled'), text: c.enabled ? 'on' : 'off' })),
          h('code', { class: 'hint mono', text: [c.command, ...(c.args || [])].join(' ') }),
          h('span', { class: 'hint', text: `Approval: ${c.approval === 'auto' ? 'runs without asking (balanced mode)' : 'always asks'}${(c.envKeys || []).length ? ' · secrets: ' + c.envKeys.join(', ') : ''}` }), res,
          h('div', { class: 'row-gap' },
            h('button', { type: 'button', class: 'btn small', onclick: () => editConnector(c) }, 'Edit'),
            h('button', { type: 'button', class: 'btn small', onclick: async () => { res.textContent = 'Connecting…'; const r = await api(`/connector/${c.id}/refresh`, {}).catch(e => ({ error: e.message })); res.textContent = r.error ? 'Problem: ' + r.error : `${r.tools.length} tools ready`; } }, 'Reconnect'),
            sk ? h('span', { class: 'row-gap' }, give, h('button', { type: 'button', class: 'btn small primary', onclick: async () => { const a = agentById(give.value); try { await api(`/agent/${a.id}`, { skills: [...new Set([...a.skills.map(x => x.id), 'connector-' + c.id])] }); toast(`${a.name} can now use ${c.name}`); } catch (e) { fail(e); } } }, 'Give to')) : null,
            h('button', { type: 'button', class: 'btn small ghost', onclick: async e => { if (!armed) { armed = true; e.currentTarget.textContent = 'Click again to remove'; return; } try { await api(`/connector/${c.id}/delete`, {}); toast('Connector removed'); } catch (err) { fail(err); } } }, 'Remove'))));
      }
      const presets = [
        ['Files in a folder', 'npx', ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users\\you\\Documents'], ''],
        ['GitHub', 'npx', ['-y', '@modelcontextprotocol/server-github'], 'GITHUB_PERSONAL_ACCESS_TOKEN='],
        ['Memory notes', 'npx', ['-y', '@modelcontextprotocol/server-memory'], ''],
      ];
      body.append(h('div', { class: 'row-gap' }, h('button', { type: 'button', class: 'btn primary', onclick: () => editConnector(null) }, '+ Add connector'), h('span', { class: 'hint', text: 'Examples:' }), presets.map(([n, cmd, args, env]) => h('button', { type: 'button', class: 'btn small ghost', onclick: () => editConnector({ name: n, command: cmd, args, approval: 'ask', enabled: true, preset: env }) }, n))));
      const form = h('div', { id: 'connForm' }); body.append(form);
      function editConnector(c) {
        clear(form);
        const name = h('input', { value: c ? c.name : '', maxlength: 40, placeholder: 'e.g. GitHub' }), cmd = h('input', { value: c ? c.command : '', placeholder: 'e.g. npx' });
        const args = h('textarea', { rows: 3, value: c ? (c.args || []).join('\n') : '', placeholder: 'One argument per line' });
        const env = h('textarea', { rows: 3, value: c && c.id ? (c.envKeys || []).map(k => k + '=••••').join('\n') : (c && c.preset) || '', placeholder: 'SECRET_NAME=value (one per line). Stored only on this computer.' });
        const appr = h('select', {}, h('option', { value: 'ask', selected: !c || c.approval !== 'auto' }, 'Always ask before each tool call'), h('option', { value: 'auto', selected: c && c.approval === 'auto' }, 'Balanced crew may use it without asking'));
        const on = h('input', { type: 'checkbox', checked: !c || c.enabled !== false });
        const out = h('span', { class: 'hint' });
        form.append(h('div', { class: 'notice' }, h('b', { text: c && c.id ? 'Edit connector' : 'New connector' }), h('div', { class: 'form-grid mt8' },
          h('label', { class: 'field' }, h('span', {}, 'Name'), name), h('label', { class: 'field' }, h('span', {}, 'Command'), cmd),
          h('label', { class: 'field' }, h('span', {}, 'Arguments'), args), h('label', { class: 'field' }, h('span', {}, 'Secrets (environment)'), env),
          h('label', { class: 'field' }, h('span', {}, 'Approval'), appr), h('label', { class: 'check' }, on, h('span', {}, 'On'))),
          h('div', { class: 'row-gap' }, h('button', { type: 'button', class: 'btn primary', onclick: async () => {
            const envObj = {}; for (const l of env.value.split('\n')) { const i = l.indexOf('='); if (i > 0) envObj[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
            if (c && c.id) for (const k of c.envKeys || []) if (!(k in envObj)) envObj[k] = null;
            out.textContent = 'Starting the connector…';
            try { const r = await api('/connector', { id: c && c.id, name: name.value, command: cmd.value, args: args.value.split('\n'), env: envObj, approval: appr.value, enabled: on.checked }); out.textContent = r.error ? 'Saved, but it did not start: ' + r.error : `Connected: ${r.tools.length} tools`; if (!r.error) setTimeout(renderSettings, 900); }
            catch (e) { out.textContent = e.message; }
          } }, 'Save & connect'), out)));
        name.focus();
      }
    }

    if (settingsTab === 'handbook') {
      const ta = h('textarea', { rows: 16, maxlength: 20000, value: S.handbook || '', placeholder: '# Crew handbook\n\n- Our company is …\n- Write in a friendly, plain style. Use Philippine peso (₱).\n- Save client files under clients/<name>/\n- Never email anyone without asking me first.' });
      const count = h('span', { class: 'hint num', text: (S.handbook || '').length + ' / 20000' });
      ta.addEventListener('input', () => { count.textContent = ta.value.length + ' / 20000'; });
      body.append(h('p', { class: 'hint', text: 'Shared knowledge every crew member reads before working: facts about you or your business, house style, folders, rules. Keep it short and specific; it is added to every request.' }),
        ta, h('div', { class: 'row-between' }, count, h('button', { type: 'button', class: 'btn primary', onclick: () => api('/handbook', { text: ta.value }).then(() => { S.handbook = ta.value; toast('Handbook saved'); }).catch(fail) }, 'Save handbook')));
    }

    if (settingsTab === 'alerts') {
      const n = st.notifications;
      const br = h('input', { type: 'checkbox', checked: n.browser }), ap = h('input', { type: 'checkbox', checked: n.onApproval }), md2 = h('input', { type: 'checkbox', checked: n.onMissionDone });
      const hook = h('input', { value: n.webhookUrl || '', placeholder: 'https://hooks.slack.com/… or a Discord webhook' });
      const dn = h('input', { type: 'checkbox', checked: st.office.dayNight }), snd = h('input', { type: 'checkbox', checked: st.office.sound });
      const perm = 'Notification' in window ? Notification.permission : 'unsupported';
      body.append(h('div', { class: 'form-grid' },
        h('div', { class: 'eyebrow full', text: 'Notifications' }),
        h('label', { class: 'check full' }, br, h('span', {}, 'Desktop notifications when this tab is in the background')),
        h('div', { class: 'full row-gap' }, h('span', { class: 'hint', text: 'Browser permission: ' + perm }), perm === 'default' ? h('button', { type: 'button', class: 'btn small', onclick: () => Notification.requestPermission().then(() => renderSettings()) }, 'Allow notifications') : null),
        h('label', { class: 'check' }, ap, h('span', {}, 'When a crew member needs my OK')), h('label', { class: 'check' }, md2, h('span', {}, 'When a mission finishes')),
        h('label', { class: 'field full' }, h('span', {}, 'Also send to a webhook (Slack, Discord, Teams, ntfy…). Only the short message text is sent.'), hook),
        h('div', { class: 'eyebrow full', text: 'Office' }),
        h('label', { class: 'check full' }, dn, h('span', {}, 'Day and night: the office lights follow your clock')),
        h('label', { class: 'check full' }, snd, h('span', {}, 'Sound effects (little bleeps for clicks, approvals and finished missions)'))),
        h('button', { type: 'button', class: 'btn primary', onclick: () => save({ notifications: { browser: br.checked, onApproval: ap.checked, onMissionDone: md2.checked, webhookUrl: hook.value }, office: { dayNight: dn.checked, sound: snd.checked } }, 'Saved') }, 'Save'));
    }

    if (settingsTab === 'about') {
      body.append(h('div', { class: 'notice' }, h('b', { text: 'Starcrew Command ' + (S.version || '') }), h('p', { class: 'hint', text: 'A local crew of AI agents with a pixel office. Runs on your computer; works with your Claude or ChatGPT plan, API keys, free local models, or the demo crew.' })),
        h('div', { class: 'form-grid' }, h('div', {}, h('div', { class: 'eyebrow', text: 'Workspace folder' }), h('p', { class: 'mono hint', text: S.workspace })),
          h('div', {}, h('button', { type: 'button', class: 'btn', onclick: () => api('/open-workspace', {}).catch(fail) }, 'Open workspace folder'))),
        (() => { let armed = false; return h('div', { class: 'notice' }, h('b', { text: 'Default team' }), h('p', { class: 'hint', text: 'Captain Cortex, Ribbit, Nova, Pip, Zorp, Mochi and Coach Koda. Resetting removes everyone else from the crew (their chats stay) and restores the default roles and skills. Levels, lessons and outfits are kept for default members.' }),
          h('button', { type: 'button', class: 'btn small', onclick: async e => { if (!armed) { armed = true; e.currentTarget.textContent = 'Click again to reset the crew'; return; } try { const r = await api('/team/reset', {}); S.agents = r.agents; office.sync(S.agents); select('cortex'); toast('Crew reset to the default team'); } catch (err) { fail(err); } } }, 'Reset to the default team')); })(),
        mdEl('### Share Starcrew with a friend\n1. Zip the Starcrew folder **without** the `data` and `workspace` folders (those hold your keys, chats and files).\n2. They unzip it and double-click **SETUP.bat** (Windows) or run `./start.sh` (Mac/Linux).\n3. Setup installs what is missing and opens Starcrew. They sign in with **their own** Claude or ChatGPT account, or add their own key.\n\n### Keyboard\n- **Enter** sends a chat message, **Shift+Enter** adds a line, **↑** edits your last message.\n- **Ctrl+Enter** in the mission box drafts a plan.'));
    }
  }

  // ---------- playbooks (saved + scheduled missions) ----------
  const EVERY = { none: 'Only when I press Run', hourly: 'Every hour', daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week' };
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let pbEdit = null;
  function openPlaybooks(editId) { pbEdit = editId || null; renderPlaybooks(); if (!$('#playbooksDlg').open) $('#playbooksDlg').showModal(); }
  function renderPlaybooks() {
    const dlg = $('#playbooksDlg'); if (!dlg.open && !pbEdit && dlg.dataset.ready) { /* keep */ }
    clear(dlg); dlg.dataset.ready = '1';
    const body = h('div', { class: 'dlg-body' });
    dlg.append(h('div', { class: 'dlg-head' }, h('h2', { text: 'Playbooks' }), h('div', { class: 'row-gap' }, h('button', { type: 'button', class: 'btn primary small', onclick: () => { pbEdit = 'new'; renderPlaybooks(); } }, '+ New playbook'), h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Close'))), body);
    body.append(h('p', { class: 'hint', text: 'A playbook is a mission you run again and again: a weekly report, a daily news brief, a monthly clean-up. Run it with one click, or put it on a schedule. Starcrew must be open for schedules to run.' }));
    const pbs = S.playbooks || [];
    if (pbEdit) body.append(playbookForm(pbEdit === 'new' ? null : pbs.find(p => p.id === pbEdit)));
    if (!pbs.length && !pbEdit) body.append(h('div', { class: 'empty', text: 'No playbooks yet. Finish a mission and press "Save as playbook", or create one here.' }));
    for (const p of pbs) {
      let armed = false;
      const sc = p.schedule || { every: 'none' };
      const when = sc.every === 'none' ? 'Manual' : `${EVERY[sc.every]}${sc.every === 'weekly' ? ' on ' + DAYS[sc.day] : ''}${sc.every === 'hourly' ? ' at :' + String(sc.time).split(':')[1] : ' at ' + sc.time}`;
      body.append(h('div', { class: 'skill pb' + (p.enabled ? '' : ' off') },
        h('div', { class: 'skill-head' }, h('b', { text: p.title }), h('span', { class: 'row-gap' }, p.lastStatus ? h('span', { class: 'pill ' + p.lastStatus, text: 'last: ' + (STATUS[p.lastStatus] || p.lastStatus) }) : null, h('span', { class: 'pill ' + (sc.every === 'none' ? 'cancelled' : 'running'), text: when }))),
        h('span', { class: 'hint clamp', text: p.goal }),
        h('span', { class: 'hint', text: [p.nextRunAt && p.enabled ? 'Next run: ' + new Date(p.nextRunAt).toLocaleString() : null, p.runs ? `Ran ${p.runs}×, last ${ago(p.lastRunAt)}` : 'Never run', p.autoApprove ? `Runs on its own if under ${money(p.budgetUsd)} / ${p.budgetRequests} plan requests` : 'Waits for your approval each time'].filter(Boolean).join(' · ') }),
        h('div', { class: 'row-gap' },
          h('button', { type: 'button', class: 'btn small primary', onclick: async () => { try { const m = await api(`/playbook/${p.id}/run`, {}); upsert(S.missions, m); renderMissions(); dlg.close(); openMission(m.id); } catch (e) { fail(e); } } }, '▶ Run now'),
          h('button', { type: 'button', class: 'btn small', onclick: () => { pbEdit = p.id; renderPlaybooks(); } }, 'Edit'),
          p.lastMissionId && S.missions.some(m => m.id === p.lastMissionId) ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => { dlg.close(); openMission(p.lastMissionId); } }, 'Last run') : null,
          h('button', { type: 'button', class: 'btn small ghost', onclick: async e => { if (!armed) { armed = true; e.currentTarget.textContent = 'Click again to delete'; return; } try { await api(`/playbook/${p.id}/delete`, {}); } catch (err) { fail(err); } } }, 'Delete'))));
    }
  }
  function playbookForm(p) {
    const sc = (p && p.schedule) || { every: 'none', time: '08:00', day: 1 };
    const title = h('input', { value: p ? p.title : '', maxlength: 80, placeholder: 'e.g. Monday market brief' });
    const goal = h('textarea', { rows: 4, maxlength: 8000, value: p ? p.goal : '', placeholder: 'What the crew should do each time, as you would tell Captain Cortex.' });
    const every = h('select', {}, Object.entries(EVERY).map(([k, l]) => h('option', { value: k, selected: sc.every === k }, l)));
    const time = h('input', { type: 'time', value: sc.time || '08:00' });
    const day = h('select', {}, DAYS.map((d, i) => h('option', { value: i, selected: Number(sc.day) === i }, d)));
    const auto = h('input', { type: 'checkbox', checked: p ? p.autoApprove : false });
    const usd = h('input', { type: 'number', min: 0.01, step: 0.05, value: p ? p.budgetUsd : S.settings.budget.missionUsd });
    const req = h('input', { type: 'number', min: 1, step: 5, value: p ? p.budgetRequests : 60 });
    const on = h('input', { type: 'checkbox', checked: p ? p.enabled : true });
    const dayF = h('label', { class: 'field' }, h('span', {}, 'Day'), day), timeF = h('label', { class: 'field' }, h('span', {}, 'Time'), time);
    const vis = () => { dayF.hidden = every.value !== 'weekly'; timeF.hidden = every.value === 'none'; };
    every.addEventListener('change', vis); vis();
    return h('div', { class: 'notice' }, h('b', { text: p ? 'Edit playbook' : 'New playbook' }),
      h('div', { class: 'form-grid mt8' },
        h('label', { class: 'field full' }, h('span', {}, 'Name'), title), h('label', { class: 'field full' }, h('span', {}, 'Goal'), goal),
        h('label', { class: 'field' }, h('span', {}, 'Repeat'), every), timeF, dayF,
        h('label', { class: 'check full' }, auto, h('span', {}, 'Scheduled runs may start on their own when the estimate is inside these limits (otherwise they wait for your approval):')),
        h('label', { class: 'field' }, h('span', {}, 'Max cost per run (USD)'), usd), h('label', { class: 'field' }, h('span', {}, 'Max plan requests per run'), req),
        h('label', { class: 'check full' }, on, h('span', {}, 'Schedule is on'))),
      h('div', { class: 'row-gap' },
        h('button', { type: 'button', class: 'btn primary', onclick: async () => { try { await api('/playbook', { id: p && p.id, title: title.value, goal: goal.value, every: every.value, time: time.value, day: Number(day.value), autoApprove: auto.checked, budgetUsd: Number(usd.value), budgetRequests: Number(req.value), enabled: on.checked }); pbEdit = null; toast('Playbook saved'); } catch (e) { fail(e); } } }, 'Save playbook'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { pbEdit = null; renderPlaybooks(); } }, 'Cancel')));
  }

  // ---------- insights ----------
  async function openInsights() {
    const dlg = clear($('#insightsDlg'));
    const body = h('div', { class: 'dlg-body' }, h('p', { class: 'hint', text: 'Loading…' }));
    dlg.append(h('div', { class: 'dlg-head' }, h('h2', { text: 'Crew insights' }), h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Close')), body);
    if (!dlg.open) dlg.showModal();
    let d; try { d = await api('/insights'); } catch (e) { clear(body).append(h('div', { class: 'notice bad', text: e.message })); return; }
    clear(body);
    const pct = r => r == null ? '–' : Math.round(r * 100) + '%';
    const acc = r => r == null ? 'needs finished missions' : r > 1.15 ? 'the crew uses more than estimated' : r < 0.85 ? 'the crew uses less than estimated' : 'estimates are on target';
    body.append(h('div', { class: 'tiles' },
      h('div', { class: 'tile key' }, h('span', { text: 'Missions done' }), h('b', { text: `${d.totals.done} / ${d.totals.missions}` }), h('span', { text: 'all time' })),
      h('div', { class: 'tile' }, h('span', { text: 'Usage vs estimate' }), h('b', { text: pct(d.accuracy.cost) }), h('span', { text: acc(d.accuracy.cost) })),
      h('div', { class: 'tile' }, h('span', { text: 'Time vs estimate' }), h('b', { text: pct(d.accuracy.time) }), h('span', { text: acc(d.accuracy.time) })),
      h('div', { class: 'tile' }, h('span', { text: 'Plan requests (14 days)' }), h('b', { text: String(d.days.reduce((n, x) => n + x.requests, 0)) }), h('span', { text: money(d.days.reduce((n, x) => n + x.usd, 0)) + ' API spend' }))));
    // 14-day chart
    const max = Math.max(1, ...d.days.map(x => x.requests)), maxU = Math.max(0.0001, ...d.days.map(x => x.usd + x.simulated));
    body.append(h('div', {}, h('div', { class: 'eyebrow', text: 'Last 14 days' }), h('div', { class: 'bars' }, d.days.map(x => {
      const col = h('div', { class: 'bar-col', title: `${x.date}: ${x.requests} plan requests · ${money(x.usd)} API · ${money(x.simulated)} demo` });
      const r = h('i', { class: 'r' }); r.style.height = (x.requests / max * 100) + '%';
      const u = h('i', { class: 'u' }); u.style.height = ((x.usd + x.simulated) / maxU * 100) + '%';
      col.append(h('div', { class: 'bar-pair' }, r, u), h('span', { text: x.date.slice(8) }));
      return col;
    })), h('div', { class: 'legend hint' }, h('span', { class: 'sw r' }), ' plan requests ', h('span', { class: 'sw u' }), ' API + demo cost')));
    // agents leaderboard
    const agents = [...d.agents].sort((a, b) => b.level - a.level || b.tasks - a.tasks);
    body.append(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Crew', 'Level', 'Steps', 'Success', 'Plan req.', 'API $', 'Time', 'Lessons'].map((t, i) => h('th', { class: i ? 'r' : '', text: t })))),
      h('tbody', {}, agents.map(a => h('tr', {}, h('td', {}, h('div', { class: 'who' }, portrait(agentById(a.id) || a), h('b', { text: a.name }))), h('td', { class: 'r', text: 'LV ' + a.level }), h('td', { class: 'r', text: String(a.tasks) }),
        h('td', { class: 'r', text: a.tasks ? Math.round(a.success / a.tasks * 100) + '%' : '–' }), h('td', { class: 'r', text: String(a.requests) }), h('td', { class: 'r', text: money(a.cost) }), h('td', { class: 'r', text: dur(a.ms / 1000) }), h('td', { class: 'r', text: String(a.lessons) })))))));
    if (d.missions.length) body.append(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Recent mission', 'Est.', 'Actual', 'Est. time', 'Actual time'].map((t, i) => h('th', { class: i ? 'r' : '', text: t })))),
      h('tbody', {}, d.missions.map(m => { const f = v => m.unit === 'requests' ? Math.round(v) + ' req.' : money(v); return h('tr', {}, h('td', {}, h('button', { type: 'button', class: 'linkish', onclick: () => { dlg.close(); openMission(m.id); } }, m.title)), h('td', { class: 'r', text: f(m.est) }), h('td', { class: 'r ' + (m.act > m.est * 1.3 ? 'over' : ''), text: f(m.act) }), h('td', { class: 'r', text: dur(m.estMin * 60) }), h('td', { class: 'r', text: dur(m.actMin * 60) })); })))));
  }

  // ---------- files ----------
  async function openFiles(focusPath) {
    const dlg = clear($('#filesDlg'));
    const list = h('ul', { class: 'file-list' }), preview = h('div', { class: 'preview' }, h('p', { class: 'hint', text: 'Pick a file to preview it.' }));
    dlg.append(h('div', { class: 'dlg-head' }, h('h2', { text: 'Workspace files' }), h('div', { class: 'row-gap' }, h('button', { type: 'button', class: 'btn small', onclick: () => api('/open-workspace', {}).catch(fail) }, 'Open folder'), h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Close'))),
      h('div', { class: 'dlg-body' }, h('div', { class: 'files' }, list, preview)));
    if (!dlg.open) dlg.showModal();
    const show = async (p, btn) => {
      list.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      try {
        const f = await api('/file?path=' + encodeURIComponent(p)); clear(preview);
        preview.append(h('div', { class: 'eyebrow', text: f.path }));
        preview.append(f.binary ? h('p', { class: 'hint', text: 'Binary file (image or other). Open the workspace folder to view it.' }) : /\.md$/i.test(p) ? mdEl(f.text) : h('pre', { text: f.text }));
      } catch (e) { clear(preview).append(h('p', { class: 'hint', text: e.message })); }
    };
    try {
      const files = await api('/files');
      if (!files.length) list.append(h('li', { class: 'dir', text: 'Empty. Files the crew makes appear here.' }));
      for (const f of files) {
        const depth = f.path.split('/').length - 1;
        const label = f.path.split('/').pop();
        const pad = (10 + depth * 14) + 'px';
        if (f.dir) { const li = h('li', { class: 'dir', text: label + '/' }); li.style.paddingLeft = pad; list.append(li); }
        else { const b = h('button', { type: 'button', title: f.path, onclick: () => show(f.path, b) }, label); b.style.paddingLeft = pad; list.append(h('li', {}, b)); if (focusPath === f.path) show(f.path, b); }
      }
    } catch (e) { fail(e); }
  }

  // ---------- new crew member: hiring board or build your own ----------
  let hireTab = 'board';
  function openNewAgent() {
    const dlg = clear($('#newAgentDlg'));
    const tabs = h('div', { class: 'settings-tabs', role: 'tablist' }, [['board', 'Hiring board'], ['custom', 'Create your own']].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(hireTab === k), onclick: () => { hireTab = k; openNewAgent(); } }, l)));
    dlg.append(h('div', { class: 'dlg-head' }, h('h2', { text: 'New crew member' }), tabs, h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Close')));
    const body = h('div', { class: 'dlg-body' }); dlg.append(body);
    if (hireTab === 'board') {
      body.append(h('p', { class: 'hint', text: 'Ready-made specialists with the right skills and personality. Hire one, then tweak them in their profile.' }));
      body.append(h('div', { class: 'hire-grid' }, (S.templates || []).map(t => {
        const fake = { id: 'tpl-' + t.id, sprite: t.sprite, look: t.look };
        const hired = S.agents.filter(a => a.hiredFrom === t.id).length;
        return h('div', { class: 'hire' }, h('div', { class: 'who' }, (() => { const c = portrait(fake, 48, 'dance'); c.className = 'hire-pic'; return c; })(), h('div', {}, h('b', { text: t.name }), h('div', { class: 'eyebrow', text: t.role }))),
          h('p', { class: 'hint', text: t.pitch }),
          h('div', { class: 'tools' }, t.skills.filter(s => S.skills[s]).map(s => h('span', { class: 'tool-chip', text: S.skills[s].name }))),
          h('button', { type: 'button', class: 'btn primary small', onclick: async () => { try { const a = await api('/hire', { id: t.id }); if (!agentById(a.id)) S.agents.push(a); office.sync(S.agents); dlg.close(); select(a.id); office.say(a.id, `${a.name}: Reporting for duty!`); sound('level'); toast(`${a.name} joined the crew`); } catch (e) { fail(e); } } }, hired ? 'Hire another' : 'Hire'));
      })));
      return dlg.open || dlg.showModal();
    }
    const name = h('input', { maxlength: 40, placeholder: 'e.g. Luna' }), role = h('input', { maxlength: 40, placeholder: 'e.g. Market Analyst' });
    const sprite = h('select', {}, SC.crew.map(id => h('option', { value: id }, SC.characters[id].name + ' · ' + SC.characters[id].species)));
    const persona = h('textarea', { rows: 4, maxlength: 4000, placeholder: 'Who they are and how they work. e.g. "You are Luna, a careful market analyst who always cites sources."' });
    const boxes = Object.entries(S.skills).filter(([id]) => id !== 'planning').map(([id, k]) => { const c = h('input', { type: 'checkbox', value: id }); return h('label', { class: 'check' }, c, h('span', {}, k.name)); });
    body.append(h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', {}, 'Name'), name), h('label', { class: 'field' }, h('span', {}, 'Role'), role),
      h('label', { class: 'field' }, h('span', {}, 'Character'), sprite), h('div'), h('label', { class: 'field full' }, h('span', {}, 'Personality and instructions'), persona)),
      h('div', { class: 'eyebrow', text: 'Skills' }), h('div', { class: 'form-grid' }, boxes));
    dlg.append(h('div', { class: 'dlg-foot' }, h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      if (!name.value.trim()) return toast('Give them a name first.');
      try {
        const a = await api('/agent', { name: name.value, role: role.value, sprite: sprite.value, persona: persona.value, skills: boxes.map(l => l.querySelector('input')).filter(c => c.checked).map(c => c.value) });
        if (!S.agents.some(x => x.id === a.id)) S.agents.push(a);
        office.sync(S.agents); dlg.close(); select(a.id); toast(a.name + ' joined the crew');
      } catch (e) { fail(e); }
    } }, 'Add to crew')));
    if (!dlg.open) dlg.showModal();
  }

  // ---------- live updates ----------
  function upsert(list, item, key = 'id') { const i = list.findIndex(x => x[key] === item[key]); if (i >= 0) list[i] = item; else list.unshift(item); }
  function chatEvent(d) {
    const c = chatOf(d.agentId);
    if (d.message.role === 'assistant' && !(d.message.toolCalls || []).length && c) c.busy = false;
    if (c && d.message.role === 'assistant') c.draft = null;
    if (!c || !c.thread || (d.threadId && c.thread.id !== d.threadId)) {
      if (c && d.threadId && c.thread && c.thread.id !== d.threadId) api(`/agent/${d.agentId}/chat`).then(v => { loadChat(d.agentId, v); if (d.agentId === sel && agentTab === 'chat' && chatFill) chatFill(); }).catch(() => {});
      return;
    }
    c.thread.messages.push(d.message);
    const t = c.list && c.list.threads.find(x => x.id === c.thread.id);
    if (t) { t.count++; if (t.title === 'New chat' && d.message.role === 'user') t.title = d.message.content.split('\n')[0].slice(0, 60); }
    if (d.agentId === sel && agentTab === 'chat' && chatFill) chatFill();
    if (d.message.role === 'assistant' && !(d.message.toolCalls || []).length && (d.agentId !== sel || document.hidden)) {
      const a = agentById(d.agentId); if (a) { toast(`${a.name} replied`, () => { select(a.id); agentTab = 'chat'; renderAgent(); }); browserNotify(`${a.name} replied: ${String(d.message.content).slice(0, 120)}`); }
    }
  }
  function connect() {
    const es = new EventSource('/api/events');
    const on = (type, fn) => es.addEventListener(type, ev => { try { fn(JSON.parse(ev.data)); } catch (e) { console.error(e); } });
    on('live', d => { const a = agentById(d.id); if (!a) return; const was = a.live && a.live.state; a.live = d.live; office.sync(S.agents); renderRoster(); if (d.id === sel) { renderAgentHeader(); if ((was === 'browsing') !== (d.live.state === 'browsing')) renderBrowserView(a); } });
    on('agent', a => { const old = agentById(a.id); upsert(S.agents, a); if (!old) S.agents.push(S.agents.shift()); office.sync(S.agents); renderRoster();
      if (a.id === sel) { renderAgentHeader(); if (['skills', 'memory', 'stats'].includes(agentTab) && !$('#agentSub').contains(document.activeElement)) renderSub(); } });
    on('mission', m => {
      const prev = S.missions.find(x => x.id === m.id);
      if (prev && prev.status !== m.status && ['done', 'failed'].includes(m.status)) sound(m.status === 'done' ? 'done' : 'error');
      upsert(S.missions, m); renderMissions(); if (openMissionId === m.id && $('#missionDlg').open) renderMissionDlg(false);
    });
    on('approval', d => {
      if (d.action === 'add') { S.approvals.push(d.approval); sound('notify'); } else S.approvals = S.approvals.filter(x => x.id !== d.id);
      renderApprovals();
    });
    on('chat', chatEvent);
    on('chatreset', d => { const c = chatOf(d.agentId); if (c && c.thread && c.thread.id === d.threadId) { c.thread.messages = d.messages; if (d.agentId === sel && agentTab === 'chat' && chatFill) chatFill(); } });
    on('audit', e => { auditItems.unshift(e); if (auditItems.length > 300) auditItems.length = 300; if (!$('#tab-activity').hidden) { const list = $('#activityList'); const empty = list.querySelector('.empty'); if (empty) empty.remove(); list.prepend(activityNode(e)); } });
    on('spend', sp => { S.spend = sp; renderSpend(); });
    on('notify', n => {
      if (n.quiet) return;
      browserNotify(n.text);
      toast(n.text, () => { if (n.kind === 'approval') switchTab('approvals'); else if (n.missionId) openMission(n.missionId); });
    });
    on('killed', k => { S.killed = k; renderKilled(); if (k) for (const c of Object.values(chats)) c.busy = false; if (chatSync && agentTab === 'chat') chatSync(); });
    on('levelup', d => { const a = agentById(d.id); sound('level'); office.levelUp(d.id, d.level && d.skills && !d.skills.length ? 'LEVEL UP! LV ' + d.level : 'SKILL UP!'); if (a) toast(`${a.name} ${d.skills && d.skills.length ? 'improved ' + d.skills.join(', ') : 'reached level ' + d.level}!`); });
    on('settings', s => { S.settings = s; office.setOptions(s.office); renderSpend(); });
    on('skills', sk => { S.skills = sk; if (agentTab === 'skills') renderSub(); if ($('#settingsDlg').open && settingsTab === 'connectors') renderSettings(); });
    on('playbooks', list => { S.playbooks = list; if ($('#playbooksDlg').open) renderPlaybooks(); });
    on('huddle', d => { office.huddle(d.lines); });
    on('chatdelta', d => { const c = chatOf(d.agentId); if (!c || !c.thread || c.thread.id !== d.threadId) return; c.draft = d.text; if (d.agentId === sel && agentTab === 'chat' && chatDraft) chatDraft(); });
    on('coach', d => { const t = agentById(d.trainerId), a = agentById(d.agentId); office.coach(d.trainerId, d.agentId, t ? `${t.name}: Tip for ${a ? a.name : 'you'}!` : 'Tip!', a ? `${a.name}: Got it, coach!` : ''); if (a) toast(`${a.name} learned: ${d.lesson}`); sound('level'); });
    on('onboard', d => { office.arrive(d.agentId, d.captainId); const a = agentById(d.agentId); if (a) toast(`${a.name} (${a.role}) joined the crew${d.by ? ', onboarded by ' + d.by : ''}`); sound('level'); });
    on('browserview', v => { views[v.agentId] = v; if (v.agentId === sel) renderBrowserView(agentById(sel)); });
    es.onopen = () => { if (connect.lost) { connect.lost = false; api('/state').then(s => { Object.assign(S, s); office.sync(S.agents); renderSpend(); renderKilled(); renderRoster(); renderMissions(); renderApprovals(); }).catch(() => {}); } };
    es.onerror = () => { connect.lost = true; };
  }

  // ---------- boot ----------
  $('#composer').addEventListener('submit', async e => {
    e.preventDefault();
    const goal = $('#goal').value.trim(); if (!goal) { $('#goal').focus(); return; }
    $('#draftBtn').disabled = true;
    try { const m = await api('/mission', { goal }); upsert(S.missions, m); renderMissions(); $('#goal').value = ''; openMission(m.id); }
    catch (err) { fail(err); } finally { $('#draftBtn').disabled = false; }
  });
  $('#goal').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#composer').requestSubmit(); });
  $('#stopBtn').addEventListener('click', () => api('/stop', {}).then(() => toast('Everything stopped')).catch(fail));
  $('#resumeBtn').addEventListener('click', () => api('/resume', {}).catch(fail));
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#filesBtn').addEventListener('click', () => openFiles());
  $('#playbooksBtn').addEventListener('click', () => openPlaybooks());
  $('#insightsBtn').addEventListener('click', openInsights);
  $('#spend').addEventListener('click', () => { settingsTab = 'budget'; openSettings(); });
  $('#soundBtn').addEventListener('click', () => {
    const on = !(S.settings.office && S.settings.office.sound);
    api('/settings', { office: { sound: on } }).then(s => { S.settings = s; renderSoundBtn(); if (on) sound('poke'); }).catch(fail);
  });
  // ---------- background music (Starcrew radio) ----------
  const radio = window.StarRadio;
  const MKEY = 'starcrew.music';
  const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(MKEY) || 'null'); } catch (e) { return null; } };
  let autoplay = true, waitingForClick = false;
  const savePrefs = () => { try { const s = radio.state(); localStorage.setItem(MKEY, JSON.stringify({ on: s.playing, volume: s.volume, track: s.track, shuffle: s.shuffle, repeat: s.repeat, autoplay })); } catch (e) { /* storage is optional */ } };
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function renderMusic() {
    const s = radio.state(), panel = $('#musicPanel'), btn = $('#musicBtn');
    btn.textContent = s.playing ? `♫ ${s.title}` : waitingForClick ? '♫ Click anywhere for music' : '♫ Music';
    btn.classList.toggle('on', s.playing);
    office && office.setOptions({ music: s.playing });
    if (panel.hidden) return;
    clear(panel);
    const vol = h('input', { type: 'range', min: 0, max: 100, value: Math.round(s.volume * 100), 'aria-label': 'Music volume' });
    vol.addEventListener('input', () => {
      radio.setVolume(vol.value / 100); savePrefs();
      const v = radio.state().volume, lab = panel.querySelector('.m-vol');
      if (lab) { lab.firstChild.textContent = v === 0 ? '🔇' : v < 0.4 ? '🔈' : '🔊'; lab.lastChild.textContent = Math.round(v * 100) + '%'; }
    });
    const bar = h('div', { class: 'm-progress' }, h('i')); bar.firstChild.style.width = (s.elapsed / s.seconds * 100).toFixed(1) + '%';
    panel.append(
      h('div', { class: 'm-now' }, h('div', { class: 'eq' + (s.playing ? ' on' : '') }, h('i'), h('i'), h('i'), h('i')),
        h('div', { class: 'min0' }, h('b', { text: s.title }), h('div', { class: 'hint', text: `${s.mood} · ${s.bpm} bpm` }))),
      bar, h('div', { class: 'row-between hint num m-time' }, h('span', { text: mmss(s.elapsed) }), h('span', { text: mmss(s.seconds) })),
      h('div', { class: 'm-controls' },
        h('button', { type: 'button', class: 'btn small', title: 'Previous track', 'aria-label': 'Previous track', onclick: () => { radio.prev(); savePrefs(); } }, '⏮'),
        h('button', { type: 'button', class: 'btn small primary m-play', title: s.playing ? 'Pause' : 'Play', 'aria-label': s.playing ? 'Pause' : 'Play', onclick: () => { radio.toggle(); savePrefs(); } }, s.playing ? '❚❚ Pause' : '▶ Play'),
        h('button', { type: 'button', class: 'btn small', title: 'Next track', 'aria-label': 'Next track', onclick: () => { radio.next(); savePrefs(); } }, '⏭'),
        h('button', { type: 'button', class: 'btn small ghost' + (s.shuffle ? ' on' : ''), 'aria-pressed': String(s.shuffle), title: 'Shuffle', onclick: () => { radio.setShuffle(!s.shuffle); savePrefs(); } }, '⤨ Shuffle'),
        h('button', { type: 'button', class: 'btn small ghost' + (s.repeat !== 'off' ? ' on' : ''), title: { all: 'Repeat: the whole playlist loops. Click to loop this track.', one: 'Repeat: this track loops. Click to turn repeat off.', off: 'Repeat off: stops after the last track. Click to loop the playlist.' }[s.repeat],
          onclick: () => { radio.setRepeat({ all: 'one', one: 'off', off: 'all' }[s.repeat]); savePrefs(); } }, { all: '🔁 Loop all', one: '🔂 Loop one', off: '↪ Loop off' }[s.repeat])),
      h('label', { class: 'm-vol' }, h('span', { class: 'hint', text: s.volume === 0 ? '🔇' : s.volume < 0.4 ? '🔈' : '🔊' }), vol, h('span', { class: 'hint num', text: Math.round(s.volume * 100) + '%' })),
      h('ol', { class: 'm-list' }, radio.tracks.map(t => h('li', {}, h('button', { type: 'button', 'aria-current': String(t.index === s.track), onclick: () => { radio.select(t.index); savePrefs(); } },
        h('span', { class: 'num', text: String(t.index + 1).padStart(2, '0') }), h('span', { class: 'min0' }, h('b', { text: t.title }), h('span', { class: 'hint', text: ' · ' + t.mood })), h('span', { class: 'hint num', text: mmss(t.seconds) }))))),
      (() => { const c = h('input', { type: 'checkbox', checked: autoplay }); c.addEventListener('change', () => { autoplay = c.checked; savePrefs(); }); return h('label', { class: 'check m-auto' }, c, h('span', {}, 'Play automatically when Starcrew opens')); })(),
      h('p', { class: 'hint m-note', text: 'Original music, composed live by your computer. Tip: click the jukebox in the office. Media keys work too.' }));
  }
  function toggleMusicPanel(show) {
    const panel = $('#musicPanel'); panel.hidden = show == null ? !panel.hidden : !show;
    $('#musicBtn').setAttribute('aria-expanded', String(!panel.hidden)); renderMusic();
  }
  $('#musicBtn').addEventListener('click', e => { e.stopPropagation(); toggleMusicPanel(); });
  // composedPath is fixed when the click starts, so a button that re-rendered still counts as inside the player
  document.addEventListener('click', e => { if (!e.composedPath().includes($('#radio'))) { if (!$('#musicPanel').hidden) toggleMusicPanel(false); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#musicPanel').hidden) toggleMusicPanel(false); });
  radio.on('change', renderMusic);
  let lastProg = 0;
  radio.on('progress', () => { if (Date.now() - lastProg > 500 && !$('#musicPanel').hidden) { lastProg = Date.now(); const s = radio.state(); const i = $('#musicPanel .m-progress i'); if (i) i.style.width = (s.elapsed / s.seconds * 100).toFixed(1) + '%'; const tm = $('#musicPanel .m-time span'); if (tm) tm.textContent = mmss(s.elapsed); } });
  radio.on('beat', b => office && office.beat && office.beat(b.pos));
  (async function restoreMusic() {
    const p = loadPrefs(); radio.restore(p);
    autoplay = !p || p.autoplay !== false;
    if (!autoplay) return;
    // Browsers block sound until you interact with a page (unless you have played media here often).
    // So: start now if allowed, otherwise start on the first click or key press anywhere.
    if (await radio.tryAutoplay()) return;
    const arm = () => { waitingForClick = true; renderMusic(); window.addEventListener('pointerdown', go, true); window.addEventListener('keydown', go, true); };
    const go = e => {
      if (e.type === 'keydown' && ['Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return; // these keys do not unlock sound
      window.removeEventListener('pointerdown', go, true); window.removeEventListener('keydown', go, true);
      waitingForClick = false;
      if (e.target && e.target.closest && e.target.closest('#radio')) { renderMusic(); return; } // they are using the player themselves
      if (!radio.state().playing) radio.play();
      // if the browser still kept the sound locked, wait for the next click
      setTimeout(() => { if (!radio.audible()) { if (radio.state().playing) radio.pause(); arm(); } else renderMusic(); }, 300);
    };
    arm();
  })();
  function renderSoundBtn() { const on = S.settings.office && S.settings.office.sound; const b = $('#soundBtn'); b.textContent = on ? '♪ On' : '♪ Off'; b.setAttribute('aria-pressed', String(!!on)); }
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => { if (e.target === d) d.close(); });

  async function boot() {
    try { await document.fonts.ready; } catch (e) { /* fonts optional */ }
    S = await api('/state');
    office = window.StarOffice.create($('#office'), $('#overlay'), { onSelect: select, onPoke: (id, kind) => sound(kind === 'pet' ? 'click' : 'poke'), onDance: id => office.dance(id), onJukebox: () => { radio.toggle(); savePrefs(); toast(radio.state().playing ? `♫ Now playing: ${radio.state().title}` : 'Music paused'); } });
    office.setOptions(S.settings.office || {});
    office.sync(S.agents); office.select(sel);
    renderSpend(); renderKilled(); renderRoster(); renderAgent(); renderMissions(); renderApprovals(); renderActivity(); renderSoundBtn(); renderMusic();
    connect();
    if (!S.settings.setupDone) openSetupWizard();
    const stopped = S.missions.filter(m => m.status === 'interrupted');
    if (stopped.length) toast(`${stopped.length} mission${stopped.length > 1 ? 's were' : ' was'} interrupted when Starcrew closed. Click to resume.`, () => openMission(stopped[0].id));
    const logo = $('#logo').getContext('2d');
    let last = performance.now();
    const loop = ms => {
      tNow += (ms - last) / 1000; last = ms;
      logo.clearRect(0, 0, 48, 48);
      const cap = S.agents.find(a => a.captain);
      if (cap) SC.draw(logo, cap.sprite, 'idle', 'front', frameAt(cap.sprite, 'idle', tNow), 0, 0, 1, cap.look);
      drawPortraits();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    setInterval(() => { if (openMissionId && $('#missionDlg').open) { const m = S.missions.find(x => x.id === openMissionId); if (m && m.status === 'running') renderMissionDlg(false); } }, 5000);
  }
  boot().catch(e => { document.body.append(h('div', { class: 'notice bad', text: 'Starcrew could not start: ' + e.message })); });
})();
