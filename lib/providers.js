'use strict';
// One chat() call for every AI provider. Messages use a simple shared format:
//   { role: 'user', content }  { role: 'assistant', content, toolCalls: [{ id, name, args }] }
//   { role: 'tool', toolCallId, name, content }
const { uid } = require('./store');

const parseArgs = s => { if (s && typeof s === 'object') return s; try { return JSON.parse(s || '{}'); } catch (e) { return {}; } };
const approxTokens = s => Math.ceil(String(s || '').length / 4);

// A run that was stopped mid-tool leaves a tool call without a result. Both APIs reject such a
// history, which would break the chat for good, so give every unanswered call a placeholder result.
function closeToolCalls(messages) {
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]; out.push(m);
    if (m.role === 'assistant' && (m.toolCalls || []).length) {
      const answered = new Set();
      let j = i + 1;
      for (; j < messages.length && messages[j].role === 'tool'; j++) answered.add(messages[j].toolCallId);
      const tools = messages.slice(i + 1, j); out.push(...tools); i = j - 1;
      for (const c of m.toolCalls) if (!answered.has(c.id)) out.push({ role: 'tool', toolCallId: c.id, name: c.name, content: '(not run: the user stopped this)' });
    }
  }
  return out;
}
// a reply cut off at the length limit may contain a half-written tool call: never run that
function dropCutCalls(r, cut) {
  if (!cut || !r.toolCalls.length) return r;
  return { ...r, toolCalls: [], text: (r.text ? r.text + '\n\n' : '') + '(My reply was too long and got cut off before I could finish an action. I will continue in smaller pieces.)' };
}

async function post(url, headers, body, signal) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 400);
    try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || j.message || msg; } catch (e) { /* keep text */ }
    const err = new Error(`${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    err.status = res.status; throw err;
  }
  return JSON.parse(text);
}

// Server-sent events from a fetch() response, one parsed JSON object at a time.
async function* sse(res) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      const data = chunk.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if (!data || data === '[DONE]') continue;
      try { yield JSON.parse(data); } catch (e) { /* skip keep-alives */ }
    }
  }
}
async function postStream(url, headers, body, signal) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const text = await res.text(); let msg = text.slice(0, 400);
    try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || j.message || msg; } catch (e) { /* keep text */ }
    const err = new Error(`${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`); err.status = res.status; throw err;
  }
  return res;
}

async function openaiChat({ baseUrl, apiKey, model, system, messages, tools, signal, endpointId, onDelta }) {
  const msgs = [{ role: 'system', content: system }];
  for (const m of closeToolCalls(messages)) {
    if (m.role === 'user') msgs.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const o = { role: 'assistant', content: m.content || '' };
      if (m.toolCalls && m.toolCalls.length) {
        o.tool_calls = m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
        if (!m.content) o.content = null;
      }
      msgs.push(o);
    } else if (m.role === 'tool') msgs.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }
  const body = { model, messages: msgs };
  if (tools && tools.length) body.tools = tools.map(t => ({ type: 'function', function: t }));
  const headers = apiKey ? { authorization: 'Bearer ' + apiKey } : {};
  if (endpointId === 'openrouter') { headers['x-title'] = 'Starcrew Command'; headers['http-referer'] = 'http://localhost'; }
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  if (onDelta) {
    try {
      const res = await postStream(url, headers, { ...body, stream: true, stream_options: { include_usage: true } }, signal);
      let text = ''; const calls = []; let usage = null, cut = false;
      for await (const ev of sse(res)) {
        if (ev.usage) usage = ev.usage;
        if (ev.choices && ev.choices[0] && ev.choices[0].finish_reason === 'length') cut = true;
        const d = ev.choices && ev.choices[0] && ev.choices[0].delta; if (!d) continue;
        if (d.content) { text += d.content; onDelta(d.content); }
        for (const tc of d.tool_calls || []) {
          const k = tc.index != null ? tc.index : calls.length;
          const c = calls[k] = calls[k] || { id: '', name: '', args: '' };
          if (tc.id) c.id = tc.id; if (tc.function && tc.function.name) c.name += tc.function.name; if (tc.function && tc.function.arguments) c.args += tc.function.arguments;
        }
      }
      return dropCutCalls({ text, toolCalls: calls.filter(c => c && c.name).map(c => ({ id: c.id || uid('call_'), name: c.name, args: parseArgs(c.args) })),
        usage: usage ? { in: usage.prompt_tokens || 0, out: usage.completion_tokens || 0 } : { in: approxTokens(system) + messages.reduce((n, m) => n + approxTokens(m.content), 0), out: approxTokens(text) } }, cut);
    } catch (e) { if (e.name === 'AbortError' || (signal && signal.aborted) || e.status !== 400) throw e; /* some servers reject streaming options: fall back */ }
  }
  const j = await post(url, headers, body, signal);
  const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
  return dropCutCalls({
    text: msg.content || '',
    toolCalls: (msg.tool_calls || []).map(c => ({ id: c.id || uid('call_'), name: c.function.name, args: parseArgs(c.function.arguments) })),
    usage: { in: (j.usage && j.usage.prompt_tokens) || 0, out: (j.usage && j.usage.completion_tokens) || 0 },
  }, j.choices && j.choices[0] && j.choices[0].finish_reason === 'length');
}

async function anthropicChat({ baseUrl, apiKey, model, system, messages, tools, signal, onDelta }) {
  const out = [];
  const push = (role, blocks) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks); else out.push({ role, content: blocks });
  };
  for (const m of closeToolCalls(messages)) {
    if (m.role === 'user') push('user', [{ type: 'text', text: m.content || '(empty)' }]);
    else if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls || []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
      if (blocks.length) push('assistant', blocks);
    } else if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]);
  }
  const body = { model, max_tokens: 8192, system, messages: out };
  if (tools && tools.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const url = baseUrl.replace(/\/+$/, '') + '/v1/messages', hdr = { 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01' };
  if (onDelta) {
    const res = await postStream(url, hdr, { ...body, stream: true }, signal);
    const blocks = []; const usage = { in: 0, out: 0 }; let cut = false;
    for await (const ev of sse(res)) {
      if (ev.type === 'message_start' && ev.message && ev.message.usage) usage.in = (ev.message.usage.input_tokens || 0) + (ev.message.usage.cache_read_input_tokens || 0) + (ev.message.usage.cache_creation_input_tokens || 0);
      else if (ev.type === 'content_block_start') blocks[ev.index] = { ...ev.content_block, text: ev.content_block.text || '', json: '' };
      else if (ev.type === 'content_block_delta' && blocks[ev.index]) {
        if (ev.delta.type === 'text_delta') { blocks[ev.index].text += ev.delta.text; onDelta(ev.delta.text); }
        else if (ev.delta.type === 'input_json_delta') blocks[ev.index].json += ev.delta.partial_json;
      } else if (ev.type === 'message_delta') { if (ev.usage) usage.out = ev.usage.output_tokens || usage.out; if (ev.delta && ev.delta.stop_reason === 'max_tokens') cut = true; }
      else if (ev.type === 'error') throw new Error((ev.error && ev.error.message) || 'stream error');
    }
    return dropCutCalls({ text: blocks.filter(b => b && b.type === 'text').map(b => b.text).join('\n'), toolCalls: blocks.filter(b => b && b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: parseArgs(b.json) })), usage }, cut);
  }
  const j = await post(url, hdr, body, signal);
  const blocks = j.content || [];
  return dropCutCalls({
    text: blocks.filter(b => b.type === 'text').map(b => b.text).join('\n'),
    toolCalls: blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input || {} })),
    usage: { in: (j.usage && j.usage.input_tokens) || 0, out: (j.usage && j.usage.output_tokens) || 0 },
  }, j.stop_reason === 'max_tokens');
}

// ---------------------------------------------------------------------------
// Demo crew: no API key needed. It follows the same protocol as a real model
// (plans, tool calls, reflections) so every part of the app can be tried out.
// ---------------------------------------------------------------------------
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal && signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('stopped')); }, { once: true });
});
const has = (s, words) => words.some(w => new RegExp('\\b' + w, 'i').test(s));
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mission';

function demoPlan(goal, roster, board = []) {
  const ids = new Set(roster.map(r => r.id));
  const steps = [], hires = [];
  const pick = (...cands) => cands.find(c => ids.has(c));
  // after: names of earlier agents whose work this step needs; [] = can start right away
  const add = (agent, task, complexity, after = []) => { if (!agent) return; const nums = after.map(a => steps.map(s => s.agent).lastIndexOf(a) + 1).filter(n => n > 0); steps.push({ agent, task, complexity, after: [...new Set(nums)] }); };
  const want = (tpl, why) => { if (board.includes(tpl)) hires.push({ template: tpl, why }); };
  const risky = has(goal, ['password', 'pay', 'buy', 'purchase', 'delete', 'send', 'bank', 'login', 'install']);
  const guard = pick('rex', 'ribbit');
  if (risky) add(guard, 'Review the mission for security risks before anyone acts, and list safe ways to do the risky parts.', 'S');
  const gate = risky && guard ? [guard] : [];
  const researcher = pick('nova', 'pip'), analyst = pick('pip', 'sprig', 'nova');
  if (has(goal, ['research', 'find', 'compare', 'look', 'search', 'news', 'price', 'market', 'competitor', 'latest', 'best'])) {
    add(researcher, `Search the web for: ${goal}. Collect the most useful sources with links.`, 'M', gate);
    if (analyst !== researcher) add(analyst, 'Analyse what was found and pull out the key facts, numbers and trade-offs.', 'M', [researcher]);
  }
  if (has(goal, ['data', 'csv', 'excel', 'spreadsheet', 'table', 'numbers', 'analy', 'chart'])) { if (!steps.some(s => s.agent === analyst)) add(analyst, `Organise and analyse the data for: ${goal}. Deliver a tidy .xlsx file.`, 'M', gate); }
  const builder = pick('zorp', 'gizmo');
  if (has(goal, ['code', 'script', 'app', 'build', 'automat', 'fix', 'bug', 'program', 'website', 'tool'])) add(builder, `Build what is needed for: ${goal}. Save the files in the mission folder and test them.`, 'L', gate);
  if (has(goal, ['design', 'mockup', 'layout', 'landing', 'ui', 'logo', 'page'])) {
    const d = pick('inky'); if (d) add(d, `Sketch a simple design for: ${goal}.`, 'M', gate);
    else {
      want('inky', 'A designer would make the layout look professional.');
      const b = steps.find(s => s.agent === builder);
      if (b) b.task += ' Start with a simple, clean layout.'; else add(builder, `Draft a simple HTML layout for: ${goal}.`, 'M', gate);
    }
  }
  if (has(goal, ['open', 'launch', 'folder', 'organi', 'computer', 'desktop', 'run'])) add(pick('gizmo', 'zorp'), `Do the computer work needed for: ${goal}.`, 'M', gate);
  const writer = pick('mochi');
  if (has(goal, ['write', 'draft', 'email', 'post', 'report', 'summary', 'summar', 'blog', 'letter', 'plan', 'brief']) || steps.filter(s => s.agent !== guard).length === 0) {
    const feeders = [...new Set(steps.map(s => s.agent))].filter(a => a !== guard && !(a === researcher && steps.some(s => s.agent === analyst && analyst !== researcher)));
    add(writer || researcher, `Write the final deliverable for: ${goal}. Save it as a Markdown file.`, 'M', feeders.length ? feeders : gate);
  }
  if (risky && !ids.has('rex')) want('rex', 'This mission touches sensitive actions; a security chief could review it.');
  const reviewer = pick('ribbit', 'rex');
  if (reviewer) add(reviewer, 'Review everything the crew produced against the original request and fix or flag any gaps.', 'S', [...new Set(steps.map(s => s.agent))]);
  return {
    summary: `I will ${steps.length > 2 ? 'run this as a ' + steps.length + '-step mission' : 'handle this in ' + steps.length + ' steps'}: ${steps.map(s => roster.find(r => r.id === s.agent).name).join(' → ')}.`,
    steps,
    risks: risky ? [`The goal mentions sensitive actions (accounts, money, deletion or sending). ${guard ? (roster.find(r => r.id === guard) || {}).name + ' reviews it first, and ' : ''}every risky action will wait for your approval.`] : ['Low risk: the crew only reads the web and writes files in its workspace.'],
    questions: [], hires,
  };
}

const DEMO_LESSONS = {
  cortex: 'Missions go faster when each step names its expected output file.',
  ribbit: 'Check the deliverable against the original wording of the request, not my memory of it.',
  nova: 'Open two or three sources and compare them before trusting one.',
  zorp: 'Write a tiny test before calling a script finished.',
  cortex: 'Give each step one owner and one expected output file.',
  pip: 'State how confident I am next to each finding.',
  koda: 'Always write down the exact steps to reproduce a problem.',
  gizmo: 'Read-only commands first; changing commands only after a check.',
  mochi: 'Lead with the answer, then the detail.',
  inky: 'Start a layout from the one action the user must take.',
  sprig: 'Note the unit and source next to every number.',
  rex: 'Flag anything touching money, passwords or deletion before work starts.',
};

async function demoChat(opts) {
  const r = await demoReply(opts);
  if (opts.onDelta && r.text && !(r.toolCalls || []).length && ['chat', 'task'].includes(opts.purpose)) {
    const words = r.text.split(/(?<=\s)/);
    const per = Math.max(1, Math.ceil(words.length / 30));
    for (let i = 0; i < words.length; i += per) { await sleep(35, opts.signal); opts.onDelta(words.slice(i, i + per).join('')); }
  }
  return r;
}
async function demoReply({ system, messages, tools, signal, purpose, meta = {} }) {
  await sleep(900 + Math.random() * 1200, signal);
  const usage = { in: approxTokens(system) + messages.reduce((n, m) => n + approxTokens(m.content), 0) + 200, out: 0 };
  const done = text => { usage.out = approxTokens(text) + 20; return { text, toolCalls: [], usage }; };
  const call = (name, args, text = '') => { usage.out = approxTokens(JSON.stringify(args)) + 40; return { text, toolCalls: [{ id: uid('demo_'), name, args }], usage }; };
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const steps = messages.filter(m => m.role === 'assistant').length;
  const toolNames = (tools || []).map(t => t.name);
  const name = meta.agentName || 'Crew member';

  if (purpose === 'ping') return done('pong');
  if (purpose === 'plan') return done('```json\n' + JSON.stringify(demoPlan(meta.goal || '', meta.roster || []), null, 2) + '\n```');
  if (purpose === 'reflect') return done(JSON.stringify({ lesson: DEMO_LESSONS[meta.agentId] || 'Keep notes short and specific.', skill_idea: null }));
  if (purpose === 'report') {
    const rs = meta.results || [];
    return done(`## Mission report: ${meta.title}\n\n**Result:** the crew completed ${rs.filter(r => r.ok).length} of ${rs.length} steps.\n\n` +
      rs.map(r => `- **${r.agentName}**: ${String(r.output || '').split('\n')[0].slice(0, 160)}`).join('\n') +
      `\n\n**Files:** ${(meta.files || []).length ? meta.files.map(f => '`' + f + '`').join(', ') : 'none'}\n\n_This is the demo crew. Pick a real model in Settings › Setup (your Claude or ChatGPT plan, an API key, or Ollama) to get real work done._`);
  }
  if (purpose === 'chat') {
    const msg = (lastUser && lastUser.content) || '';
    const toolsSoFar = messages.filter(m => m.role === 'tool');
    // the trainer's training session
    if (toolNames.includes('teach') && /training session/i.test(msg)) {
      if (steps === 0) return call('crew_report', {});
      if (steps === 1) {
        const rep = String(toolsSoFar[0] && toolsSoFar[0].content || '');
        const weak = (rep.match(/^- (.+?) \(id (\w+)\).*success (\d+)%/m) || [])[2] || 'nova';
        return call('teach', { agent: weak, lesson: 'Before finishing a step, re-read the original request and check every part of it is covered.' }, 'Looking at the results, one habit will help most:');
      }
      return done(`## Training report\n\n- **Coached:** ${String(toolsSoFar[1] && toolsSoFar[1].content || 'nobody needed coaching today').replace(/learned:.*/, 'got a new lesson')}.\n- **Lesson:** re-read the original request before finishing a step.\n- **How you can help:** give 👍 or 👎 on replies so I know what to coach.\n\n_(Demo crew: a real model studies the crew report and your feedback in detail.)_`);
    }
    // the captain building the crew
    if (toolNames.includes('hire_crew') && /\b(hire|onboard|recruit|new (crew|agent|member)|designer|security)\b/i.test(msg)) {
      if (steps === 0) return call('crew_report', {});
      if (steps === 1) {
        const rep = String(toolsSoFar[0] && toolsSoFar[0].content || '');
        const want = /design/i.test(msg) ? 'inky' : /secur/i.test(msg) ? 'rex' : /data|excel|sheet/i.test(msg) ? 'excel' : /email|inbox/i.test(msg) ? 'inbox' : /research/i.test(msg) ? 'research' : 'gizmo';
        if (new RegExp('^- ' + want + ':.*already on the crew', 'm').test(rep)) return done('That specialist is already on the crew. Give me a goal and I\'ll put them to work.');
        return call('hire_crew', { template: want, why: 'The request needs this specialist and nobody on the crew covers it yet.' }, 'Nobody on the crew covers that yet, so I\'d like to hire a specialist:');
      }
      const t = String(toolsSoFar[toolsSoFar.length - 1] && toolsSoFar[toolsSoFar.length - 1].content || '');
      return done(/declined/i.test(t) ? 'Understood, no new hire. The current crew will manage.' : `Done! ${t.split(' joined')[0]} is aboard and onboarded. Coach Koda will help them settle in. What's their first job?`);
    }
    const link = (msg.match(/https?:\/\/[^\s)>"']+/) || [])[0];
    if (steps === 0 && link && (toolNames.includes('browser_open') || toolNames.includes('web_fetch'))) return call(toolNames.includes('browser_open') && meta.browserReady ? 'browser_open' : 'web_fetch', { url: link });
    if (steps > 0 && link && (toolNames.includes('browser_open') || toolNames.includes('web_fetch'))) { const t = [...messages].reverse().find(m => m.role === 'tool'); return done(`I opened ${link}. ${t && /^Tool error|Blocked/.test(t.content) ? 'It did not load: ' + t.content.split('\n')[0] : 'Here is the top of the page: ' + String(t && t.content || '').replace(/\[UNTRUSTED[^\]]*\]\n?/, '').slice(0, 160).replace(/\s+/g, ' ') + '…'} (Demo crew: a real model would read and summarise it for you.)`); }
    if (steps === 0 && toolNames.includes('create_mission') && msg.length > 20 && !/\?\s*$/.test(msg)) return call('create_mission', { title: msg.slice(0, 48), goal: msg });
    if (steps > 0) return done('Mission drafted! Open it in the Missions panel to see the plan, cost and time estimate, then approve it when you are happy.');
    return done(`Hi, I'm ${name}${meta.role ? ', ' + meta.role : ''}. I'm running as the demo crew right now, so my answers are scripted. Pick a real brain for the crew in Settings › Setup (your Claude or ChatGPT plan, an API key, or free Ollama) and I'll think for real.${toolNames.includes('create_mission') ? ' Tell me a goal in a sentence or two and I\'ll draft a mission for it.' : ''}`);
  }
  // task
  const task = (lastUser && lastUser.content) || '';
  const folder = 'missions/' + slug(meta.missionTitle || 'chat');
  if (steps === 0) {
    if (toolNames.includes('run_command') && (meta.agentId === 'gizmo' || /computer work/i.test(task))) return call('run_command', { command: process.platform === 'win32' ? 'Get-ChildItem | Select-Object -First 10 Name' : 'ls | head', why: 'Look at what is already in the workspace (read-only).' });
    if (toolNames.includes('web_fetch') && meta.agentId === 'nova') return call('web_fetch', { url: 'https://example.com' });
    if (toolNames.includes('write_file')) {
      const goal = task.split('\n').find(l => l.startsWith('Your step:')) || task.slice(0, 200);
      return call('write_file', { path: `${folder}/${meta.agentId}.md`, content: `# ${name} · ${meta.role || ''}\n\n${goal.replace('Your step:', '').trim()}\n\n- Demo note: this file was written by the demo crew.\n- With a real model, this is where the actual work appears.\n` });
    }
    if (toolNames.includes('list_files')) return call('list_files', { path: '.' });
  }
  const lastTool = [...messages].reverse().find(m => m.role === 'tool');
  return done(`Done. ${lastTool ? 'I ' + (/Saved/.test(lastTool.content) ? 'saved my notes to ' + folder + '/' + meta.agentId + '.md' : 'checked the result: ' + String(lastTool.content).split('\n')[0].slice(0, 80)) + '.' : 'I reviewed the work so far.'} (Demo crew: simulated result.)`);
}

async function chat(opts) {
  const { endpoint } = opts;
  switch (endpoint.type) {
    case 'demo': return demoChat(opts);
    case 'claude-code': return require('./cli').claudeChat({ ...opts, scratch: opts.scratch });
    case 'codex': return require('./cli').codexChat({ ...opts, scratch: opts.scratch });
    case 'anthropic': return anthropicChat({ ...opts, baseUrl: endpoint.baseUrl });
    case 'openai': case 'compatible': return openaiChat({ ...opts, baseUrl: endpoint.baseUrl, endpointId: endpoint.id });
    default: throw new Error('Unknown provider type ' + endpoint.type);
  }
}

module.exports = { chat, approxTokens, demoPlan };
