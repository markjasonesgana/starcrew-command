'use strict';
// "Use my plan" providers. Starcrew runs the official Claude Code and Codex
// command-line programs that YOU installed and signed in to with your own account.
// Starcrew never sees or stores your Claude / ChatGPT login: sign-in happens in
// their own window, and usage counts against your own plan.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { uid } = require('./store');

const IS_WIN = process.platform === 'win32';

// Run a CLI. On Windows npm installs these as .cmd shims, which need the shell,
// so every argument is quoted and validated before it gets there.
function run(cmd, args, { input = null, cwd, timeoutMs = 300000, signal, env, onData } = {}) {
  return new Promise((resolve, reject) => {
    if (IS_WIN) for (const a of args) if (/["%^&|<>!\r\n]/.test(a)) return reject(new Error('This folder path contains a special character (" % ^ & | < > !). Move Starcrew to a simpler folder path.'));
    const q = a => (a === '' ? '""' : /[\s"]/.test(a) ? '"' + a.replace(/"/g, '') + '"' : a);
    const child = IS_WIN
      ? spawn([cmd, ...args.map(q)].join(' '), { cwd, shell: true, windowsHide: true, env: env || process.env })
      : spawn(cmd, args, { cwd, env: env || process.env });
    let out = '', err = '', done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(t); fn(v); };
    const kill = () => { try { IS_WIN ? spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']) : child.kill('SIGKILL'); } catch (e) { /* ignore */ } };
    const t = setTimeout(() => { kill(); finish(reject, new Error('timed out')); }, timeoutMs);
    signal && signal.addEventListener('abort', () => { kill(); finish(reject, Object.assign(new Error('stopped'), { stop: true })); }, { once: true });
    // decode as UTF-8 text, so letters split across two chunks are not garbled
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { out += d; if (onData) onData(d); if (out.length > 5e6) out = out.slice(-5e6); });
    child.stderr.on('data', d => { err += d; if (err.length > 2e5) err = err.slice(-2e5); });
    child.on('error', e => finish(reject, e));
    child.on('close', code => finish(resolve, { code, out, err }));
    if (input != null) { child.stdin.on('error', () => {}); child.stdin.end(input); } else child.stdin.end();
  });
}

// ---------- text tool protocol (these CLIs run with their own tools switched off) ----------
function toolProtocol(tools) {
  if (!tools || !tools.length) return '';
  return `\n\n# Tools
You can use these tools. To use one, reply with one or more blocks exactly like this and nothing after them:
<tool_call>{"name": "tool_name", "arguments": { ... }}</tool_call>
You will get the results back as <tool_result> blocks in the next message. When you are finished, reply normally with no tool_call blocks.
Do not use any other tools or features you may have. Only these:
${tools.map(t => `- ${t.name}: ${t.description}\n  arguments: ${JSON.stringify(t.parameters.properties || {})}${(t.parameters.required || []).length ? ' (required: ' + t.parameters.required.join(', ') + ')' : ''}`).join('\n')}`;
}
function transcript(messages) {
  const parts = [];
  for (const m of messages) {
    if (m.role === 'user') parts.push(`<user>\n${m.content}\n</user>`);
    else if (m.role === 'assistant') {
      let s = m.content || '';
      for (const c of m.toolCalls || []) s += `\n<tool_call>${JSON.stringify({ name: c.name, arguments: c.args || {} })}</tool_call>`;
      parts.push(`<assistant>\n${s.trim()}\n</assistant>`);
    } else if (m.role === 'tool') parts.push(`<tool_result name="${m.name}">\n${m.content}\n</tool_result>`);
  }
  return parts.join('\n\n') + '\n\nWrite the next <assistant> message. Reply with only its content (no <assistant> tags).';
}
function parseReply(text) {
  const calls = [];
  const clean = String(text || '').replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (m, body) => {
    try {
      const j = JSON.parse(body.replace(/^```(json)?|```$/g, '').trim());
      if (j && j.name) calls.push({ id: uid('cli_'), name: String(j.name), args: j.arguments || j.args || {} });
    } catch (e) { /* ignore malformed block */ }
    return '';
  }).replace(/^<assistant>|<\/assistant>$/g, '').trim();
  return { text: clean, toolCalls: calls };
}

// ---------- Claude Code ----------
function claudeBin() { return process.env.STARCREW_CLAUDE_BIN || 'claude'; }
let claudeStreamOk = true; // older Claude Code versions may not support live output
async function claudeChat({ model, system, messages, tools, signal, scratch, onDelta }) {
  fs.mkdirSync(scratch, { recursive: true });
  const spFile = path.join(scratch, 'system-' + uid() + '.txt');
  fs.writeFileSync(spFile, system + toolProtocol(tools));
  const stream = !!onDelta && claudeStreamOk;
  const args = ['-p', '--output-format', stream ? 'stream-json' : 'json', ...(stream ? ['--verbose', '--include-partial-messages'] : []), '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--system-prompt-file', spFile];
  if (model && /^[\w.\-:]{1,80}$/.test(model)) args.push('--model', model);
  try {
    // live output: one JSON event per line; text arrives as content_block_delta events
    let pend = '', result = null;
    const onData = stream ? chunk => {
      pend += chunk; let i;
      while ((i = pend.indexOf('\n')) >= 0) {
        const line = pend.slice(0, i).trim(); pend = pend.slice(i + 1); if (!line) continue;
        let o; try { o = JSON.parse(line); } catch (e) { continue; }
        if (o.type === 'stream_event' && o.event && o.event.type === 'content_block_delta' && o.event.delta && o.event.delta.type === 'text_delta') onDelta(o.event.delta.text);
        else if (o.type === 'result') result = o;
      }
    } : null;
    const r = await run(claudeBin(), args, { input: transcript(messages), cwd: scratch, signal, onData });
    if (stream && !result && /unknown option|unrecognized|requires --verbose|stream-json/i.test(r.err + r.out)) { claudeStreamOk = false; return claudeChat({ model, system, messages, tools, signal, scratch, onDelta: null }); }
    let j = result;
    const lines = r.out.trim().split('\n');
    for (let i = lines.length - 1; i >= 0 && !j; i--) { try { const o = JSON.parse(lines.slice(i).join('\n')); if (o && typeof o === 'object' && (!stream || o.type === 'result')) j = o; } catch (e) { /* keep looking */ } }
    if (!j) throw new Error(friendlyClaudeError(r.err || r.out || 'Claude Code returned nothing (exit ' + r.code + ')'));
    if (j.is_error || j.subtype && j.subtype !== 'success') throw new Error(friendlyClaudeError(j.result || j.error || JSON.stringify(j).slice(0, 300)));
    const reply = parseReply(j.result);
    const u = j.usage || {};
    return { ...reply, usage: { in: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), out: u.output_tokens || 0 }, planRequests: 1, apiEquivalentUsd: j.total_cost_usd || 0 };
  } finally { fs.rm(spFile, { force: true }, () => {}); }
}
function friendlyClaudeError(s) {
  s = String(s).trim();
  if (/ENOENT|not recognized|not found/i.test(s)) return 'Claude Code is not installed. Open Settings › Setup and press "Install Claude Code".';
  if (/log ?in|auth|credential|unauthori[sz]ed|401/i.test(s)) return 'Claude Code is not signed in. Open Settings › Setup and press "Sign in to Claude".';
  if (/limit|quota|usage cap|rate/i.test(s)) return 'Your Claude plan usage limit was reached: ' + s.slice(0, 200);
  if (/unknown option|unrecognized/i.test(s)) return 'Your Claude Code is too old for Starcrew. Run "claude update" in a terminal. (' + s.slice(0, 120) + ')';
  return 'Claude Code: ' + s.slice(0, 400);
}

// ---------- Codex (ChatGPT plan) ----------
function codexBin() { return process.env.STARCREW_CODEX_BIN || 'codex'; }
async function codexChat({ model, system, messages, tools, signal, scratch }) {
  fs.mkdirSync(scratch, { recursive: true });
  const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '-C', scratch];
  if (model && /^[\w.\-:]{1,80}$/.test(model)) args.push('-m', model);
  args.push('-');
  const prompt = `<instructions>\n${system}${toolProtocol(tools)}\nDo not run shell commands or edit files yourself; use only the tools listed above.\n</instructions>\n\n${transcript(messages)}`;
  const r = await run(codexBin(), args, { input: prompt, cwd: scratch, signal });
  let text = '', usage = { in: 0, out: 0 }, error = '';
  for (const line of r.out.split('\n')) {
    let e; try { e = JSON.parse(line); } catch (x) { continue; }
    const item = e.item || {};
    const type = item.type || item.item_type;
    if (e.type === 'item.completed' && (type === 'agent_message' || type === 'assistant_message')) text = item.text || text;
    if (e.type === 'turn.completed' && e.usage) usage = { in: e.usage.input_tokens || 0, out: e.usage.output_tokens || 0 };
    if (e.type === 'turn.failed' || e.type === 'error') error = (e.error && (e.error.message || e.error)) || e.message || 'error';
  }
  if (!text && (error || r.code)) {
    const s = String(error || r.err || 'exit ' + r.code);
    if (/ENOENT|not recognized|not found/i.test(s)) throw new Error('Codex is not installed. Open Settings › Setup and press "Install Codex".');
    if (/log ?in|auth|401/i.test(s)) throw new Error('Codex is not signed in. Open Settings › Setup and press "Sign in to ChatGPT".');
    throw new Error('Codex: ' + s.slice(0, 400));
  }
  return { ...parseReply(text), usage, planRequests: 1 };
}

// ---------- detection + sign-in helpers for the setup wizard ----------
async function detect() {
  const out = {};
  const probe = async (bin, verArgs, statusArgs, parse) => {
    const res = { installed: false, version: '', signedIn: null, detail: '' };
    try { const v = await run(bin, verArgs, { timeoutMs: 20000 }); if (v.code === 0) { res.installed = true; res.version = (v.out || v.err).trim().split('\n')[0].slice(0, 60); } } catch (e) { /* not installed */ }
    if (res.installed && statusArgs) {
      try { const s = await run(bin, statusArgs, { timeoutMs: 20000 }); Object.assign(res, parse(s)); } catch (e) { res.detail = 'Could not check sign-in'; }
    }
    return res;
  };
  out.claude = await probe(claudeBin(), ['--version'], ['auth', 'status'], s => {
    try { const j = JSON.parse(s.out); return { signedIn: !!j.loggedIn || (j.authMethod && j.authMethod !== 'none'), detail: j.authMethod === 'claude.ai' ? 'Signed in with your Claude plan' : j.authMethod ? 'Signed in (' + j.authMethod + ')' : '' }; }
    catch (e) { return { signedIn: s.code === 0, detail: s.code === 0 ? 'Signed in' : 'Not signed in' }; }
  });
  out.codex = await probe(codexBin(), ['--version'], ['login', 'status'], s => ({ signedIn: s.code === 0 && !/not logged in/i.test(s.out + s.err), detail: (s.out + s.err).trim().split('\n')[0].slice(0, 80) }));
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: ctrl.signal }); clearTimeout(t);
    const j = await r.json(); out.ollama = { installed: true, running: true, models: (j.models || []).map(m => m.name).slice(0, 30) };
  } catch (e) { out.ollama = { installed: false, running: false, models: [] }; }
  out.platform = process.platform;
  return out;
}

// Opens a terminal window that runs the official command, so YOU complete
// installation or sign-in in their own flow. Only these fixed commands are allowed.
const ACTIONS = {
  'install-claude': { title: 'Install Claude Code', cmd: 'npm install -g @anthropic-ai/claude-code' },
  'login-claude': { title: 'Sign in to Claude', cmd: claudeBin() + ' auth login' },
  'install-codex': { title: 'Install Codex', cmd: 'npm install -g @openai/codex' },
  'login-codex': { title: 'Sign in to ChatGPT', cmd: codexBin() + ' login' },
};
function openTerminal(action) {
  const a = ACTIONS[action]; if (!a) throw new Error('Unknown setup action');
  if (IS_WIN) spawn('cmd.exe', ['/c', 'start', `"${a.title}"`, 'cmd', '/k', a.cmd], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  else if (process.platform === 'darwin') spawn('osascript', ['-e', `tell application "Terminal" to do script "${a.cmd}"`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref();
  else {
    const p = spawn('x-terminal-emulator', ['-e', 'sh', '-c', a.cmd + '; echo; echo Done; read x'], { detached: true, stdio: 'ignore' });
    p.on('error', () => {}); p.unref();
  }
  return { ok: true, command: a.cmd };
}

module.exports = { claudeChat, codexChat, detect, openTerminal, parseReply, transcript, toolProtocol, scratchDir: d => path.join(d || os.tmpdir(), 'cli-scratch') };
