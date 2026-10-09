'use strict';
// Tiny JSON-file store. Every write goes to a temp file first and is then renamed,
// so a crash never leaves a half-written file behind.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cache = new Map();
    this.timers = new Map();
  }
  file(name) { return path.join(this.dir, name + '.json'); }
  get(name, fallback) {
    if (this.cache.has(name)) return this.cache.get(name);
    let value = fallback;
    try { value = JSON.parse(fs.readFileSync(this.file(name), 'utf8')); } catch (e) { /* first run */ }
    this.cache.set(name, value);
    return value;
  }
  set(name, value) { this.cache.set(name, value); this.save(name); return value; }
  save(name, now = false) {
    clearTimeout(this.timers.get(name));
    const write = () => {
      const tmp = this.file(name) + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.cache.get(name), null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file(name));
    };
    if (now) return write();
    this.timers.set(name, setTimeout(write, 150));
  }
  flush() { for (const name of this.cache.keys()) { clearTimeout(this.timers.get(name)); this.save(name, true); } }
  appendLog(name, obj) {
    fs.appendFileSync(path.join(this.dir, name + '.log'), JSON.stringify(obj) + '\n', { mode: 0o600 });
  }
  readLog(name, limit = 200) {
    try {
      const lines = fs.readFileSync(path.join(this.dir, name + '.log'), 'utf8').trim().split('\n');
      return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).reverse();
    } catch (e) { return []; }
  }
}

const uid = (p = '') => p + crypto.randomBytes(6).toString('hex');
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s; };
const today = () => new Date().toISOString().slice(0, 10);

module.exports = { Store, uid, clip, today };
