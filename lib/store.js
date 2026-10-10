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
    let value = fallback, raw = null;
    try { raw = fs.readFileSync(this.file(name), 'utf8'); } catch (e) { /* first run */ }
    if (raw != null) {
      try { value = JSON.parse(raw); }
      catch (e) {
        // a damaged file (power cut, disk full) is kept aside instead of being silently replaced
        const keep = this.file(name) + '.corrupt-' + Date.now();
        try { fs.renameSync(this.file(name), keep); } catch (x) { /* ignore */ }
        console.error(`\n  ! ${name}.json was damaged and could not be read. It was kept as ${path.basename(keep)}; starting that part fresh.\n`);
        this.damaged = [...(this.damaged || []), name];
      }
    }
    this.cache.set(name, value);
    return value;
  }
  set(name, value) { this.cache.set(name, value); this.save(name); return value; }
  save(name, now = false) {
    clearTimeout(this.timers.get(name));
    const write = (attempt = 0) => {
      const tmp = this.file(name) + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
      try {
        const fd = fs.openSync(tmp, 'w', 0o600);
        try { fs.writeSync(fd, JSON.stringify(this.cache.get(name), null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, this.file(name));
      } catch (e) {
        try { fs.unlinkSync(tmp); } catch (x) { /* ignore */ }
        // Windows: antivirus, indexing or OneDrive can hold the file for a moment; try again shortly
        if (attempt < 6 && ['EPERM', 'EBUSY', 'EACCES', 'EAGAIN'].includes(e.code)) { setTimeout(() => write(attempt + 1), 100 * (attempt + 1)); return; }
        console.error(`  ! Could not save ${name}: ${e.message}`);
      }
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
