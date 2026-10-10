'use strict';
// Connectors: a small client for MCP (Model Context Protocol) servers over stdio.
// Each connector is a program you choose to run (for example a GitHub, database or
// email MCP server). Its tools become crew tools that, by default, ask before running.
const { spawn } = require('child_process');
const EventEmitter = require('events');

const IS_WIN = process.platform === 'win32';
const toolName = (cid, name) => ('mcp_' + cid + '_' + name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

class Server extends EventEmitter {
  constructor(cfg, env) { super(); this.cfg = cfg; this.env = env; this.proc = null; this.seq = 0; this.waiting = new Map(); this.buf = ''; this.tools = []; this.ready = null; this.stderr = ''; }
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const env = { ...process.env, ...this.env };
      const args = Array.isArray(this.cfg.args) ? this.cfg.args.map(String) : [];
      try {
        if (IS_WIN) for (const a of [this.cfg.command, ...args]) if (/["%\r\n]/.test(a)) throw new Error('On Windows, connector settings cannot contain " or % characters. Put that value in a secret (environment) instead.');
        // quote every piece for cmd.exe, so & | < > ^ inside values stay text
        this.proc = IS_WIN ? spawn([this.cfg.command, ...args].map(a => /^[\w.:\\/@=+-]+$/.test(a) ? a : `"${a}"`).join(' '), { shell: true, env, windowsHide: true })
          : spawn(this.cfg.command, args, { env });
      } catch (e) { this.ready = null; return reject(e); }
      const proc = this.proc;
      proc.on('error', e => { if (proc === this.proc) this.fail(e); reject(e); });
      // a late exit from an old process must not break a restarted one
      proc.on('exit', code => { if (proc === this.proc) this.fail(new Error(`connector stopped (exit ${code}). ${this.stderr.slice(-300)}`)); });
      proc.stdin.on('error', e => { if (proc === this.proc) this.fail(new Error('the connector closed: ' + (this.stderr.slice(-300) || e.message))); });
      proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
      proc.stdout.on('data', d => {
        this.buf += d;
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
          if (!line) continue;
          let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
          if (msg.method !== undefined) continue; // a request or notification from the server, not an answer
          if (msg.id != null && this.waiting.has(msg.id)) { const w = this.waiting.get(msg.id); this.waiting.delete(msg.id); clearTimeout(w.t); msg.error ? w.reject(new Error(msg.error.message || 'connector error')) : w.resolve(msg.result); }
        }
      });
      (async () => {
        await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'starcrew', version: '1.0' } }, 20000);
        this.notify('notifications/initialized', {});
        const r = await this.request('tools/list', {}, 20000);
        this.tools = (r && r.tools) || [];
        resolve(this.tools);
      })().catch(e => { this.stop(); reject(e); });
    });
    return this.ready;
  }
  send(obj) { if (!this.proc || !this.proc.stdin.writable) throw new Error('connector is not running'); this.proc.stdin.write(JSON.stringify(obj) + '\n'); }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  request(method, params, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const t = setTimeout(() => { this.waiting.delete(id); reject(new Error(`connector did not answer ${method} in time`)); }, timeoutMs);
      this.waiting.set(id, { resolve, reject, t });
      try { this.send({ jsonrpc: '2.0', id, method, params }); } catch (e) { clearTimeout(t); this.waiting.delete(id); reject(e); }
    });
  }
  fail(err) { for (const w of this.waiting.values()) { clearTimeout(w.t); w.reject(err); } this.waiting.clear(); this.ready = null; this.proc = null; }
  stop() { try { if (this.proc) IS_WIN ? spawn('taskkill', ['/pid', String(this.proc.pid), '/t', '/f']) : this.proc.kill(); } catch (e) { /* ignore */ } this.fail(new Error('stopped')); }
}

class Connectors {
  constructor() { this.servers = new Map(); }
  async start(cfg, env) {
    let s = this.servers.get(cfg.id);
    if (s && (s.cfg.command !== cfg.command || JSON.stringify(s.cfg.args) !== JSON.stringify(cfg.args))) { s.stop(); s = null; }
    if (!s) { s = new Server(cfg, env); this.servers.set(cfg.id, s); }
    const tools = await s.start();
    return tools.map(t => ({ name: toolName(cfg.id, t.name), mcpName: t.name, description: `[${cfg.name}] ${t.description || t.name}`.slice(0, 1000), schema: t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} } }));
  }
  async call(cfg, env, mcpName, args) {
    await this.start(cfg, env);
    const r = await this.servers.get(cfg.id).request('tools/call', { name: mcpName, arguments: args || {} });
    const text = ((r && r.content) || []).map(c => c.type === 'text' ? c.text : c.type === 'resource' && c.resource ? (c.resource.text || c.resource.uri) : `[${c.type}]`).join('\n');
    if (r && r.isError) throw new Error(text || 'connector tool failed');
    return text || '(no output)';
  }
  stop(id) { const s = this.servers.get(id); if (s) { s.stop(); this.servers.delete(id); } }
  stopAll() { for (const id of [...this.servers.keys()]) this.stop(id); }
}

module.exports = { Connectors, toolName };
