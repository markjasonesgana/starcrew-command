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
  [/remove-item[^\n]*-recurse[^\n]*[a-z]:\\(\s|$|\*)/i, 'deleting a whole drive'],
  [/\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^\n|]*\|\s*(sh|bash|iex|invoke-expression|powershell|pwsh|cmd)\b/i, 'downloading and running a script'],
  [/-enc(odedcommand)?\s+[a-z0-9+/=]{16,}/i, 'running an encoded (hidden) command'],
  [/\bnet\s+(user|localgroup)\b.*\/(add|delete)/i, 'changing user accounts'],
  [/\bschtasks\b.*\/create|\bnew-scheduledtask/i, 'creating scheduled tasks'],
  [/\bset-executionpolicy\b/i, 'changing the PowerShell security policy'],
  [/\bmimikatz\b|\bsekurlsa\b|lsass/i, 'touching credentials'],
  [/\.ssh[\\/]|\bid_rsa\b|\.aws[\\/]credentials|\\appdata\\local\\google\\chrome\\user data/i, 'reading private keys or browser data'],
  [/\b(vssadmin|wbadmin)\b.*delete/i, 'deleting backups'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'a fork bomb'],
];

function checkCommand(cmd) {
  const c = String(cmd || '');
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
  // walk up to the nearest existing ancestor and make sure it really lives inside the workspace
  let probe = full;
  while (!fs.existsSync(probe) && probe !== root) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (!inside(real, rootReal)) return { ok: false, reason: 'that path leads outside the workspace' };
  return { ok: true, full, rel: path.relative(root, full) || '.' };
}

function isPrivateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '0.0.0.0') return true;
  if (net.isIP(h) === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIP(h) === 6) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:');
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
