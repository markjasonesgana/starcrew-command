#!/usr/bin/env node
'use strict';
// Starcrew Command — local server. Listens on 127.0.0.1 only and needs the
// one-time login link printed below. No third-party packages required.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Store, clip } = require('./lib/store');
const { Crew } = require('./lib/crew');
const { TOOLS, CREW_TOOLS, playwrightAvailable } = require('./lib/tools');
const { MODES, resolveInWorkspace, checkUrl } = require('./lib/safety');
const cli = require('./lib/cli');

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) { console.error('Starcrew needs Node.js 18 or newer. Download it from https://nodejs.org'); process.exit(1); }

const ROOT = __dirname;
const PORT = Number(process.env.STARCREW_PORT) || 4777;
const HOST = '127.0.0.1';
const DATA = path.join(ROOT, 'data');
const WORKSPACE = path.join(ROOT, 'workspace');
const PUBLIC = path.join(ROOT, 'public');
fs.mkdirSync(WORKSPACE, { recursive: true });

const store = new Store(DATA);
const crew = new Crew({ store, workspace: WORKSPACE, dataDir: DATA });

const LOGIN_TOKEN = crypto.randomBytes(24).toString('hex');
const SESSION = crypto.randomBytes(32).toString('hex');
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'cache-control': 'no-store', 'content-type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
function cookies(req) { const o = {}; for (const p of String(req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } return o; }
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// ---------- live events (Server-Sent Events) ----------
const clients = new Set();
function broadcast(type, data) { const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(msg); }
for (const ev of ['live', 'agent', 'mission', 'approval', 'chat', 'audit', 'spend', 'notify', 'killed', 'levelup', 'browserview', 'playbooks', 'skills', 'huddle', 'chatreset', 'chatdelta', 'coach', 'onboard']) crew.on(ev, d => broadcast(ev, d));
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);

// ---------- helpers for state ----------
function publicSettings() {
  const s = crew.settings();
  const secrets = store.get('secrets');
  const envNames = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY' };
  return {
    ...s,
    connectors: (s.connectors || []).map(c => ({ ...c, envKeys: Object.keys(crew.connectorEnv(c.id)) })),
    endpoints: s.endpoints.map(e => {
      const k = secrets[e.id] || (envNames[e.id] && process.env[envNames[e.id]]) || '';
      return { ...e, keySet: !!k, keyHint: k ? '••••' + k.slice(-4) : '' };
    }),
  };
}
function state() {
  return {
    agents: crew.agents().map(a => crew.publicAgent(a)),
    missions: crew.missions().slice(0, 60),
    approvals: crew.pendingApprovals(),
    settings: publicSettings(),
    skills: crew.skills(),
    tools: Object.fromEntries(Object.entries(TOOLS).map(([k, t]) => { let r = 'medium'; try { r = t.risk({}, { workspace: WORKSPACE }); } catch (e) { /* */ } return [k, { description: t.description, risk: r }]; })),
    modes: Object.keys(MODES),
    spend: crew.spend(), killed: crew.killed, browser: playwrightAvailable(),
    workspace: WORKSPACE, platform: process.platform,
    playbooks: crew.playbooks(), handbook: store.get('handbook').text || '', templates: crew.templates(),
    huddles: crew.huddles, version: require('./package.json').version,
  };
}

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
function patchAgent(a, b) {
  if (b.name != null) a.name = str(b.name, 40).trim() || a.name;
  if (b.role != null) a.role = str(b.role, 40).trim() || a.role;
  if (b.persona != null) a.persona = str(b.persona, 4000);
  if (b.model !== undefined) { if (b.model === null || b.model === '' || crew.settings().models.some(m => m.key === b.model)) a.model = b.model || null; }
  if (b.permission != null && MODES[b.permission]) a.permission = b.permission;
  if (b.enabled != null && !a.captain) { a.enabled = !!b.enabled; crew.setLive(a.id, a.enabled ? 'idle' : 'sleeping', ''); }
  if (b.look && typeof b.look === 'object') { const l = {}; for (const [k, v] of Object.entries(b.look)) if (/^(suit|hat|face|neck|back|color)$/.test(k) && /^[a-z]{1,20}$/.test(String(v))) l[k] = String(v); a.look = l; }
  if (Array.isArray(b.skills)) {
    const cat = crew.skills();
    a.skills = b.skills.filter(id => cat[id]).slice(0, 12).map(id => (a.skills || []).find(s => s.id === id) || { id, level: 1, xp: 0 });
  }
  if (b.sprite != null && /^[a-z]{2,12}$/.test(b.sprite)) a.sprite = b.sprite;
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[\\w-]+)') + '$'), fn, ...opts });
const RAW = Symbol('raw'); // a route that wrote its own response

route('GET', '/api/state', () => state());
route('POST', '/api/mission', b => crew.createMission({ title: b.title, goal: b.goal }));
route('POST', '/api/mission/:id/rollback', (b, p) => crew.rollback(p.id));
route('POST', '/api/mission/:id/resume', (b, p) => crew.resumeMission(p.id));
route('POST', '/api/mission/:id/plan', (b, p) => crew.editPlan(p.id, b.steps));
route('POST', '/api/mission/:id/feedback', (b, p) => crew.rateMission(p.id, b.rating > 0 ? 1 : -1, str(b.note, 300)));
route('POST', '/api/agent/:id/feedback', (b, p) => crew.rateChat(p.id, str(b.threadId, 40), b.at, b.rating > 0 ? 1 : -1, str(b.note, 300)));
route('POST', '/api/training', async () => {
  const run = crew.trainingSession('you asked for one');
  run.catch(e => broadcast('notify', { kind: 'training', text: 'Training session: ' + e.message }));
  await Promise.race([run, new Promise(r => setTimeout(r, 300))]); // report start-up problems right away
  return { ok: true, trainer: (crew.trainer() || {}).id };
});
route('POST', '/api/team/reset', () => { if (crew.runs.size) throw new Error('Wait until the crew is idle (or press Stop all) before resetting the team.'); const team = crew.resetTeam(); return { agents: team.map(a => crew.publicAgent(a)) }; });
route('POST', '/api/mission/:id/playbook', (b, p) => { const m = crew.mission(p.id); if (!m) throw new Error('No such mission'); return crew.savePlaybook({ title: m.title, goal: m.goal, every: 'none', budgetUsd: m.budgetUsd, budgetRequests: m.budgetRequests }); });
route('POST', '/api/mission/:id/approve', (b, p) => crew.approveMission(p.id, b.budgetUsd, b.budgetRequests).then(() => ({ ok: true })));
route('POST', '/api/mission/:id/revise', (b, p) => { crew.reviseMission(p.id, b.feedback); return { ok: true }; });
route('POST', '/api/mission/:id/cancel', (b, p) => { crew.cancelMission(p.id); return { ok: true }; });
route('POST', '/api/mission/:id/delete', (b, p) => {
  const list = crew.missions(); const i = list.findIndex(m => m.id === p.id);
  if (i >= 0 && ['running', 'planning'].includes(list[i].status)) throw new Error('Stop the mission before removing it.');
  if (i >= 0) list.splice(i, 1); store.save('missions'); return { ok: true };
});
route('POST', '/api/agent/:id', (b, p) => { const a = crew.agent(p.id); if (!a) throw new Error('No such crew member'); patchAgent(a, b); store.save('agents'); crew.emit('agent', crew.publicAgent(a)); return crew.publicAgent(a); });
route('POST', '/api/agent', b => {
  const id = (str(b.name, 20).toLowerCase().replace(/[^a-z]/g, '') || 'agent') + crypto.randomBytes(2).toString('hex');
  const a = { id, name: str(b.name, 40) || 'New crew member', role: str(b.role, 40) || 'Specialist', sprite: /^[a-z]{2,12}$/.test(b.sprite) ? b.sprite : 'nova', look: {}, model: null, persona: str(b.persona, 4000) || `You are ${str(b.name, 40) || 'a new crew member'}, a helpful member of the Starcrew.`, enabled: true, permission: crew.settings().safety.defaultPermission, skills: [], stats: { level: 1, xp: 0, tasks: 0, success: 0, fail: 0, tokensIn: 0, tokensOut: 0, cost: 0, ms: 0 }, energy: 100, lessons: [], ideas: [] };
  patchAgent(a, { skills: b.skills || ['writing'] });
  crew.agents().push(a); crew.live[a.id] = { state: 'idle', detail: '', since: Date.now() };
  store.save('agents'); crew.emit('agent', crew.publicAgent(a)); return crew.publicAgent(a);
});
route('POST', '/api/agent/:id/delete', (b, p) => { const list = crew.agents(); const i = list.findIndex(a => a.id === p.id); if (i < 0) throw new Error('No such crew member'); if (list[i].captain) throw new Error('The Head Captain cannot be removed.'); list.splice(i, 1); store.save('agents'); return { ok: true }; });
route('GET', '/api/agent/:id/browser', (b, p) => crew.browserViews[p.id] || {});
const needAgent = id => { const a = crew.agent(id); if (!a) throw new Error('No such crew member'); return a; };
const chatView = id => { const t = crew.thread(id); return { thread: { id: t.id, title: t.title, messages: t.messages.slice(-150) }, list: crew.threadList(id), busy: crew.chatCtrl.has(id) }; };
route('GET', '/api/agent/:id/chat', (b, p) => { needAgent(p.id); return chatView(p.id); });
route('POST', '/api/agent/:id/chat', (b, p) => {
  needAgent(p.id);
  const mode = ['send', 'retry', 'edit'].includes(b.mode) ? b.mode : 'send';
  const text = str(b.text, 12000).trim();
  if (!text && mode !== 'retry') throw new Error('Type a message first.');
  if (crew.killed) throw new Error('The crew is stopped. Press Resume first.');
  if (crew.chatCtrl.has(p.id)) throw new Error('Still answering your last message. Press Stop to interrupt.');
  const attachments = (Array.isArray(b.attachments) ? b.attachments : []).map(x => str(x, 300)).filter(x => { const r = resolveInWorkspace(WORKSPACE, x); return r.ok && /^uploads\//.test(r.rel.replace(/\\/g, '/')); });
  crew.chatWith(p.id, text, { attachments, mode }).catch(e => broadcast('chat', { agentId: p.id, threadId: crew.thread(p.id).id, message: { role: 'assistant', content: 'Problem: ' + e.message, error: true, at: Date.now() } }));
  return { ok: true };
});
route('POST', '/api/agent/:id/chat/stop', (b, p) => { needAgent(p.id); crew.stopChat(p.id); return { ok: true }; });
route('POST', '/api/agent/:id/chat/new', (b, p) => { needAgent(p.id); crew.newThread(p.id); return chatView(p.id); });
route('POST', '/api/agent/:id/chat/switch', (b, p) => { needAgent(p.id); crew.switchThread(p.id, str(b.id, 40)); return chatView(p.id); });
route('POST', '/api/agent/:id/chat/delete', (b, p) => { needAgent(p.id); if (crew.chatCtrl.has(p.id)) throw new Error('Stop the current answer first.'); crew.deleteThread(p.id, str(b.id, 40)); return chatView(p.id); });
route('POST', '/api/agent/:id/chat/clear', (b, p) => { needAgent(p.id); if (crew.chatCtrl.has(p.id)) throw new Error('Stop the current answer first.'); const t = crew.thread(p.id); t.messages.length = 0; t.title = 'New chat'; store.save('chats'); return chatView(p.id); });
route('POST', '/api/agent/:id/lesson/delete', (b, p) => { const a = crew.agent(p.id); a.lessons.splice(Number(b.index), 1); store.save('agents'); crew.emit('agent', crew.publicAgent(a)); return { ok: true }; });
route('POST', '/api/agent/:id/lesson/add', (b, p) => { const a = crew.agent(p.id); crew.addLesson(a, str(b.text, 300), 'you'); return { ok: true }; });
route('POST', '/api/agent/:id/idea/:index/:action', (b, p) => {
  const a = crew.agent(p.id); const idea = (a.ideas || [])[Number(p.index)]; if (!idea) throw new Error('No such idea');
  a.ideas.splice(Number(p.index), 1);
  if (p.action === 'adopt') {
    const sid = 'custom-' + (str(idea.name, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-') || crypto.randomBytes(3).toString('hex'));
    crew.skills()[sid] = { name: str(idea.name, 40), description: str(idea.instructions, 200), instructions: str(idea.instructions, 2000), tools: [], custom: true };
    a.skills.push({ id: sid, level: 1, xp: 0 }); store.save('skills');
  }
  store.save('agents'); crew.emit('agent', crew.publicAgent(a)); return { ok: true };
});
route('POST', '/api/skill', b => {
  const id = b.id && crew.skills()[b.id] ? b.id : 'custom-' + (str(b.name, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomBytes(3).toString('hex'));
  const tools = (Array.isArray(b.tools) ? b.tools : []).filter(t => TOOLS[t] && !CREW_TOOLS.includes(t));
  crew.skills()[id] = { name: str(b.name, 40) || 'Custom skill', description: str(b.description, 200), instructions: str(b.instructions, 3000), tools, custom: true };
  store.save('skills'); return { id, skills: crew.skills() };
});
route('POST', '/api/approval/:id', (b, p) => ({ ok: crew.resolveApproval(p.id, { decision: b.decision === 'approve' ? 'approve' : 'deny', answer: str(b.answer, 2000), scope: ['mission', 'chat'].includes(b.scope) ? b.scope : 'once' }) }));
route('POST', '/api/stop', () => { crew.stopAll(); return { ok: true }; });
route('POST', '/api/resume', () => { crew.resume(); return { ok: true }; });
route('POST', '/api/settings', b => {
  const s = crew.settings();
  if (b.notifications && b.notifications.webhookUrl) { const u = str(b.notifications.webhookUrl, 500).trim(); const c = checkUrl(u); if (!c.ok || !/^https:/i.test(u)) throw new Error('The webhook must be a public https:// address.'); }
  if (b.defaultModel && s.models.some(m => m.key === b.defaultModel)) s.defaultModel = b.defaultModel;
  if (b.budget) {
    const d = Number(b.budget.dailyUsd), m = Number(b.budget.missionUsd), r = Number(b.budget.dailyPlanRequests);
    if (isFinite(d) && d >= 0 && d <= 10000) s.budget.dailyUsd = d; if (isFinite(m) && m > 0 && m <= 1000) s.budget.missionUsd = m;
    if (isFinite(r) && r >= 1 && r <= 100000) s.budget.dailyPlanRequests = Math.round(r);
  }
  const modelOk = k => k === '' || s.models.some(m => m.key === k);
  if (b.routing) { if (b.routing.enabled != null) s.routing.enabled = !!b.routing.enabled; if (b.routing.cheapModel != null && modelOk(b.routing.cheapModel)) s.routing.cheapModel = b.routing.cheapModel; if (b.routing.strongModel != null && modelOk(b.routing.strongModel)) s.routing.strongModel = b.routing.strongModel; }
  if (b.parallel) { if (b.parallel.enabled != null) s.parallel.enabled = !!b.parallel.enabled; const n = Number(b.parallel.maxConcurrent); if (isFinite(n) && n >= 1 && n <= 6) s.parallel.maxConcurrent = Math.round(n); }
  if (b.notifications) {
    const n = b.notifications;
    for (const k of ['browser', 'onApproval', 'onMissionDone']) if (n[k] != null) s.notifications[k] = !!n[k];
    if (n.webhookUrl != null) {
      const u = str(n.webhookUrl, 500).trim();
      if (u) { const c = checkUrl(u); if (!c.ok || !/^https:/.test(u)) throw new Error('The webhook must be a public https:// address.'); }
      s.notifications.webhookUrl = u;
    }
  }
  if (b.office) { if (b.office.dayNight != null) s.office.dayNight = !!b.office.dayNight; if (b.office.sound != null) s.office.sound = !!b.office.sound; }
  if (b.setupDone != null) s.setupDone = !!b.setupDone;
  if (b.safety) {
    if (MODES[b.safety.defaultPermission]) s.safety.defaultPermission = b.safety.defaultPermission;
    if (Array.isArray(b.safety.blockedDomains)) s.safety.blockedDomains = b.safety.blockedDomains.map(d => str(d, 100).trim()).filter(Boolean).slice(0, 200);
    if (b.safety.browserHeadless != null) s.safety.browserHeadless = !!b.safety.browserHeadless;
    const t = Number(b.safety.commandTimeoutSec); if (isFinite(t) && t >= 5 && t <= 600) s.safety.commandTimeoutSec = t;
    const ms = Number(b.safety.maxStepsPerTask); if (isFinite(ms) && ms >= 2 && ms <= 40) s.safety.maxStepsPerTask = ms;
  }
  if (b.learning) { if (b.learning.reflectAfterTasks != null) s.learning.reflectAfterTasks = !!b.learning.reflectAfterTasks; const te = Number(b.learning.trainEvery); if (isFinite(te) && te >= 0 && te <= 100) s.learning.trainEvery = Math.round(te); }
  if (s.routing.cheapModel && !s.models.some(m => m.key === s.routing.cheapModel)) s.routing.cheapModel = '';
  if (s.routing.strongModel && !s.models.some(m => m.key === s.routing.strongModel)) s.routing.strongModel = '';
  if (Array.isArray(b.models)) {
    const eps = new Set(s.endpoints.map(e => e.id));
    s.models = b.models.filter(m => m && eps.has(m.endpoint)).slice(0, 60).map(m => ({
      key: /^[\w-]{1,40}$/.test(m.key) ? m.key : 'm-' + crypto.randomBytes(3).toString('hex'), endpoint: m.endpoint, model: str(m.model, 120).trim(), label: str(m.label, 60) || str(m.model, 60) || 'Model',
      inPrice: m.inPrice === '' || m.inPrice == null || !isFinite(Number(m.inPrice)) ? null : Math.max(0, Number(m.inPrice)),
      outPrice: m.outPrice === '' || m.outPrice == null || !isFinite(Number(m.outPrice)) ? null : Math.max(0, Number(m.outPrice)),
      simulated: m.endpoint === 'demo',
    }));
    if (!s.models.some(m => m.key === s.defaultModel)) s.defaultModel = s.models[0] ? s.models[0].key : 'demo';
  }
  if (Array.isArray(b.endpoints)) for (const e of b.endpoints) { const ex = s.endpoints.find(x => x.id === e.id); if (ex && ex.type === 'compatible' && /^https?:\/\//.test(e.baseUrl || '')) ex.baseUrl = str(e.baseUrl, 300); }
  store.save('settings'); broadcast('settings', publicSettings()); return publicSettings();
});
route('POST', '/api/secret', b => {
  const ep = crew.settings().endpoints.find(e => e.id === b.endpoint); if (!ep || ep.type === 'demo') throw new Error('Unknown provider');
  const secrets = store.get('secrets');
  const key = str(b.key, 400).trim();
  if (key) secrets[ep.id] = key; else delete secrets[ep.id];
  store.save('secrets', true);
  crew.audit({ type: 'security', note: `API key for ${ep.label} ${key ? 'saved' : 'removed'}` });
  return publicSettings();
});
route('POST', '/api/test-model', async b => {
  const model = crew.settings().models.find(m => m.key === b.key); if (!model) throw new Error('Unknown model');
  const probe = { id: 'probe', name: 'Probe', persona: '', model: model.key, stats: { tokensIn: 0, tokensOut: 0, cost: 0 } };
  const t0 = Date.now();
  const r = await crew.llm(probe, { system: 'Reply with the single word: pong', messages: [{ role: 'user', content: 'ping' }], tools: [], purpose: 'ping' });
  return { ok: true, reply: clip(r.text, 200), ms: Date.now() - t0 };
});
route('GET', '/api/audit', () => store.readLog('audit', 300));

// ---------- setup (sign-in happens in the official tools, never here) ----------
route('GET', '/api/setup/detect', () => cli.detect());
route('POST', '/api/setup/terminal', b => { const r = cli.openTerminal(str(b.action, 30)); crew.audit({ type: 'security', note: 'Opened a terminal for: ' + r.command }); return r; });
route('POST', '/api/setup/choose', b => {
  const s = crew.settings();
  if (!s.models.some(m => m.key === b.model)) throw new Error('Unknown model');
  s.defaultModel = b.model; s.setupDone = true;
  if (b.routing && typeof b.routing === 'object') { s.routing.enabled = !!b.routing.enabled; for (const k of ['cheapModel', 'strongModel']) if (s.models.some(m => m.key === b.routing[k])) s.routing[k] = b.routing[k]; }
  store.save('settings'); broadcast('settings', publicSettings()); return publicSettings();
});

// ---------- playbooks ----------
route('POST', '/api/playbook', b => crew.savePlaybook(b));
route('POST', '/api/playbook/:id/delete', (b, p) => { crew.deletePlaybook(p.id); return { ok: true }; });
route('POST', '/api/playbook/:id/run', (b, p) => { if (crew.killed) throw new Error('The crew is stopped. Press Resume first.'); return crew.runPlaybook(p.id); });

// ---------- handbook ----------
route('POST', '/api/handbook', b => { store.get('handbook').text = str(b.text, 20000); store.save('handbook'); crew.audit({ type: 'progress', note: 'Crew handbook updated' }); return { ok: true }; });

// ---------- connectors (MCP) ----------
route('POST', '/api/connector', async b => {
  const s = crew.settings(); s.connectors = s.connectors || [];
  let c = b.id && s.connectors.find(x => x.id === b.id);
  const name = str(b.name, 40).trim(); const command = str(b.command, 300).trim();
  if (!name || !command) throw new Error('A connector needs a name and a command.');
  if (!c) { c = { id: (name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'mcp') + crypto.randomBytes(2).toString('hex') }; s.connectors.push(c); }
  Object.assign(c, { name, command, args: (Array.isArray(b.args) ? b.args : String(b.args || '').split('\n')).map(a => str(a, 400).trim()).filter(Boolean).slice(0, 30), approval: b.approval === 'auto' ? 'auto' : 'ask', enabled: b.enabled !== false });
  if (b.env && typeof b.env === 'object') {
    const secrets = store.get('secrets'); const cur = secrets['connector:' + c.id] || {};
    for (const [k, v] of Object.entries(b.env)) { if (!/^[A-Z_][A-Z0-9_]{0,60}$/i.test(k)) continue; if (v === null || v === '') delete cur[k]; else if (v !== '••••') cur[k] = str(v, 2000); }
    secrets['connector:' + c.id] = cur; store.save('secrets', true);
  }
  store.save('settings');
  crew.audit({ type: 'security', note: `Connector "${name}" saved (${command}${c.enabled ? '' : ', off'})` });
  let tools = [], error = '';
  try { tools = await crew.refreshConnector(c.id); } catch (e) { error = e.message; }
  broadcast('settings', publicSettings());
  return { id: c.id, tools, error };
});
route('POST', '/api/connector/:id/refresh', async (b, p) => { try { return { tools: await crew.refreshConnector(p.id) }; } catch (e) { return { tools: [], error: e.message }; } });
route('POST', '/api/connector/:id/delete', (b, p) => {
  const s = crew.settings(); const i = (s.connectors || []).findIndex(c => c.id === p.id); if (i < 0) throw new Error('No such connector');
  s.connectors[i].enabled = false; crew.refreshConnector(p.id).catch(() => {});
  s.connectors.splice(i, 1); delete store.get('secrets')['connector:' + p.id]; store.save('secrets', true);
  const sk = crew.skills(); delete sk['connector-' + p.id]; store.save('skills');
  for (const a of crew.agents()) a.skills = (a.skills || []).filter(x => x.id !== 'connector-' + p.id);
  store.save('agents'); store.save('settings'); broadcast('settings', publicSettings()); broadcast('skills', crew.skills()); return { ok: true };
});

// ---------- hiring board + insights ----------
route('POST', '/api/hire', b => crew.hire(str(b.id, 30)));
route('GET', '/api/insights', () => crew.insights());
route('GET', '/api/files', () => {
  const out = [];
  const walk = (dir, rel, depth) => {
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length > 500) return;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { out.push({ path: r, dir: true }); if (depth < 4) walk(path.join(dir, e.name), r, depth + 1); }
      else { const st = fs.statSync(path.join(dir, e.name)); out.push({ path: r, size: st.size, at: st.mtimeMs }); }
    }
  };
  walk(WORKSPACE, '', 0); return out;
});
route('GET', '/api/file', (b, p, q) => {
  const r = resolveInWorkspace(WORKSPACE, q.get('path')); if (!r.ok) throw new Error(r.reason);
  const st = fs.statSync(r.full); if (st.size > 400_000) throw new Error('File is too large to preview.');
  const buf = fs.readFileSync(r.full); if (buf.includes(0)) return { path: r.rel, binary: true };
  return { path: r.rel, text: buf.toString('utf8') };
});
const UPLOAD_MAX = 25 * 1024 * 1024;
route('POST', '/api/upload', b => {
  const name = str(b.name, 120).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').trim() || 'file';
  const data = Buffer.from(String(b.data || ''), 'base64');
  if (!data.length) throw new Error('The file is empty.');
  if (data.length > UPLOAD_MAX) throw new Error('Files can be up to 25 MB.');
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(WORKSPACE, 'uploads', day); fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length).slice(0, 80);
  let file = base + ext, n = 1; while (fs.existsSync(path.join(dir, file))) file = `${base} (${++n})${ext}`;
  fs.writeFileSync(path.join(dir, file), data);
  const rel = `uploads/${day}/${file}`;
  crew.audit({ type: 'tool', tool: 'upload', note: `You attached ${rel} (${Math.round(data.length / 1024)} KB)` });
  return { path: rel, name: file, size: data.length };
}, { limit: Math.ceil(UPLOAD_MAX * 1.4) + 4096 });
const RAW_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
route('GET', '/api/raw', (b, p, q, res) => {
  const r = resolveInWorkspace(WORKSPACE, q.get('path')); if (!r.ok) throw new Error(r.reason);
  const st = fs.statSync(r.full); if (!st.isFile()) throw new Error('Not a file');
  const type = RAW_TYPES[path.extname(r.full).toLowerCase()];
  // images display inline; everything else always downloads (never runs in the page)
  res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': type || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store',
    'content-disposition': `${type ? 'inline' : 'attachment'}; filename="${path.basename(r.full).replace(/[^\w. ()-]/g, '_')}"`, 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" });
  fs.createReadStream(r.full).pipe(res);
  return RAW;
});
route('POST', '/api/open-workspace', () => { const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'; spawn(cmd, [WORKSPACE], { detached: true, stdio: 'ignore' }).unref(); return { ok: true }; });

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  try {
    // DNS-rebinding protection: only answer to our own address
    if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) return send(res, 403, 'Forbidden host');
    const url = new URL(req.url, `http://${req.headers.host}`);
    const authed = same(cookies(req).sc_session || '', SESSION);

    if (url.pathname === '/auth') {
      if (!same(url.searchParams.get('token') || '', LOGIN_TOKEN)) return send(res, 403, 'This login link is not valid. Use the link shown in the Starcrew window.');
      return send(res, 302, '', { location: '/', 'set-cookie': `sc_session=${SESSION}; HttpOnly; SameSite=Strict; Path=/` });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!authed) return send(res, 401, { error: 'Not signed in. Open Starcrew with the link in the Starcrew window.' });
      if (req.method !== 'GET') {
        // CSRF protection: a custom header (other sites cannot send it) and a matching Origin
        if (req.headers['x-starcrew'] !== '1') return send(res, 403, { error: 'Missing request header' });
        const origin = req.headers.origin;
        if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, '').toLowerCase())) return send(res, 403, { error: 'Bad origin' });
      }
      if (url.pathname === '/api/events') {
        res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('retry: 2000\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const mt = url.pathname.match(r.re); if (!mt) continue;
        let body = {};
        if (req.method === 'POST') { try { body = await readBody(req, r.limit); } catch (e) { return send(res, 413, { error: e.message }); } }
        try { const out = await r.fn(body, mt.groups || {}, url.searchParams, res); if (out === RAW) return; return send(res, 200, out == null ? { ok: true } : out); }
        catch (e) { return send(res, 400, { error: e.message }); }
      }
      return send(res, 404, { error: 'Not found' });
    }

    // static files
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = authed ? '/index.html' : '/locked.html';
    const full = path.resolve(PUBLIC, '.' + p);
    if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, 'Not found');
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': TYPES[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    try { send(res, 500, { error: 'Server error: ' + e.message }); } catch (x) { /* already sent */ }
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Starcrew may already be running. Close the other window, or set STARCREW_PORT to another number.\n`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const link = `http://${HOST}:${PORT}/auth?token=${LOGIN_TOKEN}`;
  console.log('\n  ★ STARCREW COMMAND is running on your computer only.\n');
  console.log('  Open this private link (it opens automatically):');
  console.log('  ' + link + '\n');
  console.log('  Keep this window open while you use Starcrew. Press Ctrl+C to shut it down.\n');
  if (!process.env.STARCREW_NO_BROWSER) {
    const cmd = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', link]] : process.platform === 'darwin' ? ['open', [link]] : ['xdg-open', [link]];
    try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch (e) { /* print only */ }
  }
});
const shutdown = () => { try { store.flush(); } catch (e) { /* ignore */ } process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown); process.on('SIGHUP', shutdown); if (process.platform === 'win32') process.on('SIGBREAK', shutdown);
