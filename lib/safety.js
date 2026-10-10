'use strict';
// Guard rails shared by every tool. Each check returns { ok, reason }.
const fs = require('fs');
const path = require('path');
const net = require('net');

// Commands the crew may never run, even with approval.
const BLOCKED_COMMANDS = [
  [/\bformat(\.com)?\s+[a-z]:/i, 'formatting a drive'],
  [/\bdiskpart\b/i, 'disk partitioning'],
  [/\bbcdedit\b|\bbootrec\b/i, 'changing boot settings'],
  [/\bcipher\s+\/w/i, 'wiping free space'],
  [/\b(shutdown|restart-computer|stop-computer)\b/i, 'shutting down the computer'],
  [/\breg(\.exe)?\s+(delete|add|import)\b|\b(remove|set|new)-item(property)?\s+.*hk(lm|cu):/i, 'editing the Windows registry'],
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(\/|~|\*|\.\.)/i, 'deleting files recursively outside the workspace'],
  [/\b(del|erase|rd|rmdir)\b[^\n]*\s\/s\b[^\n]*\s[a-z]:\\?(\s|$|\*)/i, 'deleting a whole drive'],
  [/\b(remove-item|ri|rm|rmdir|del|erase|rd)\b[^\n]*\s(-r\w*|\/s)\b[^\n]*(\s|['"])([a-z]:\\?|~|\$env:\w+|\$home|%\w+%)(['"]?)(\s|$|\*)/i, 'deleting a whole drive or your home folder'],
  [/\b(remove-item|ri|rm|rmdir|del|erase|rd)\b[^\n]*(\s|['"])([a-z]:\\?|~|\$env:\w+|\$home|%\w+%)(['"]?)\s[^\n]*(-r\w*|\/s)\b/i, 'deleting a whole drive or your home folder'],
  [/\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^\n|]*\|\s*(sh|bash|iex|invoke-expression|powershell|pwsh|cmd)\b/i, 'downloading and running a script'],
  [/\b(iex|invoke-expression)\b[^\n]*\b(iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget|downloadstring|net\.webclient)\b/i, 'downloading and running a script'],
  [/\b(downloadstring|downloadfile)\b|\bbitsadmin\b|\bcertutil\b[^\n]*-urlcache/i, 'downloading and running a script'],
  [/\s-e(c|nc|nco|ncod|ncode|ncoded|ncodedc\w*)?\s+[a-z0-9+/=]{16,}/i, 'running an encoded (hidden) command'],
  [/\bnet\s+(user|localgroup)\b.*\/(add|delete)/i, 'changing user accounts'],
  [/\bschtasks\b.*\/create|\bnew-scheduledtask/i, 'creating scheduled tasks'],
  [/\bset-executionpolicy\b/i, 'changing the PowerShell security policy'],
  [/\bmimikatz\b|\bsekurlsa\b|lsass/i, 'touching credentials'],
  [/\.s['"`+\s]*s['"`+\s]*h[\\/]|\bid_(rsa|ed25519|ecdsa|dsa)\b|\.aws[\\/]credentials|\.git-credentials|\\appdata\\(local|roaming)\\(google|microsoft|mozilla|brave)|login data|\bcookies\.sqlite\b/i, 'reading private keys or browser data'],
  [/\b(vssadmin|wbadmin)\b.*delete/i, 'deleting backups'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'a fork bomb'],
];

function checkCommand(cmd) {
  // strip PowerShell/cmd escape characters so `r`m or r^m cannot dodge the patterns
  const c = String(cmd || '').replace(/[`^]/g, '');
  if (!c.trim()) return { ok: false, reason: 'empty command' };
  if (c.length > 2000) return { ok: false, reason: 'command is too long' };
  for (const [re, why] of BLOCKED_COMMANDS) if (re.test(c)) return { ok: false, reason: 'blocked for safety: ' + why };
  return { ok: true };
}

const norm = s => (process.platform === 'win32' ? s.toLowerCase() : s);

// Every file path must stay inside the workspace, including through symlinks.
function resolveInWorkspace(root, p) {
  const rel = String(p || '.').replace(/^[/\\]+/, '');
  if (path.isAbsolute(rel) || /^[a-z]:/i.test(rel)) return { ok: false, reason: 'use a path inside the workspace, not an absolute path' };
  root = path.resolve(root);
  const full = path.resolve(root, rel);
  const rootReal = fs.realpathSync(root);
  const inside = (p, r) => { const a = norm(p), b = norm(r); return a === b || a.startsWith(b + path.sep); };
  if (!inside(full, root)) return { ok: false, reason: 'that path is outside the workspace' };
  // check every existing piece of the path: links must resolve, and resolve inside the workspace
  // (a broken link would otherwise let a write land wherever it points)
  const parts = path.relative(root, full).split(path.sep).filter(Boolean);
  let cur = root;
  for (const part of parts) {
    cur = path.join(cur, part);
    let st; try { st = fs.lstatSync(cur); } catch (e) { break; } // the rest does not exist yet
    if (st.isSymbolicLink()) {
      let real; try { real = fs.realpathSync(cur); } catch (e) { return { ok: false, reason: 'that path goes through a broken link' }; }
      if (!inside(real, rootReal)) return { ok: false, reason: 'that path leads outside the workspace' };
    }
  }
  let probe = full;
  while (!fs.existsSync(probe) && probe !== root) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (!inside(real, rootReal)) return { ok: false, reason: 'that path leads outside the workspace' };
  // a file with several hard links could be a door to a file elsewhere; refuse to touch those
  try { const st = fs.statSync(full); if (st.isFile() && st.nlink > 1) return { ok: false, reason: 'that file is a hard link to somewhere else' }; } catch (e) { /* new file */ }
  return { ok: true, full, rel: path.relative(root, full) || '.' };
}

function isPrivateHost(host) {
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return true;
  if (net.isIP(h) === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0);
  }
  if (net.isIP(h) === 6) {
    if (h === '::' || h === '::1') return true;
    if (/^::ffff:/.test(h) || /^64:ff9b:/.test(h) || /^2002:/.test(h)) return true; // IPv4 mapped / translated: treat as private to be safe
    const first = parseInt(h.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00;
  }
  return false;
}

// Only public http(s) sites. Local network addresses are off limits so a web page
// can never trick an agent into poking at this app or other machines on your network.
function checkUrl(url, blockedDomains = []) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return { ok: false, reason: 'not a valid URL' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: 'only http and https links are allowed' };
  if (u.username || u.password) return { ok: false, reason: 'links with embedded passwords are not allowed' };
  if (isPrivateHost(u.hostname)) return { ok: false, reason: 'local and private network addresses are blocked' };
  const host = u.hostname.toLowerCase();
  for (const d of blockedDomains) {
    const b = String(d).trim().toLowerCase().replace(/^\*\./, '');
    if (b && (host === b || host.endsWith('.' + b))) return { ok: false, reason: host + ' is on your blocked list' };
  }
  return { ok: true, url: u.toString() };
}

// Approval policy: which risk levels run on their own for each permission mode.
const MODES = {
  careful: { low: 'auto', medium: 'ask', high: 'ask' },
  balanced: { low: 'auto', medium: 'auto', high: 'ask' },
  autopilot: { low: 'auto', medium: 'auto', high: 'auto' },
  readonly: { low: 'auto', medium: 'deny', high: 'deny' },
};
function decide(mode, risk, readonlyTool) {
  const m = MODES[mode] || MODES.balanced;
  if (mode === 'readonly') return readonlyTool ? 'auto' : 'deny';
  return m[risk] || 'ask';
}

// Environment for child processes: never hand API keys to commands the crew runs.
function safeEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/key|token|secret|password|passwd|credential|auth/i.test(k)) continue;
    env[k] = v;
  }
  return env;
}

module.exports = { checkCommand, resolveInWorkspace, checkUrl, decide, MODES, safeEnv, isPrivateHost };
