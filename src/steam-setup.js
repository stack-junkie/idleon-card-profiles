import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);
const APP = '1476970';
const CONFIG_PATH = ['UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps', APP];

// Keep source spans so changing one value preserves every unrelated byte.
// Accept the quoted KeyValues subset Steam writes; reject unfamiliar syntax.
export function parseVdf(source) {
  if (source.length > 32 * 1024 * 1024 || source.includes('\0')) throw new Error('Unsupported Steam settings file.');
  let pos = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const skip = () => {
    while (pos < source.length) {
      if (/\s/.test(source[pos])) { pos++; continue; }
      if (source.startsWith('//', pos)) { const end = source.indexOf('\n', pos); pos = end < 0 ? source.length : end; continue; }
      break;
    }
  };
  const token = () => {
    skip(); const start = pos;
    if (source[pos++] !== '"') throw new Error('Unsupported Steam settings syntax.');
    let value = '';
    while (pos < source.length) {
      const char = source[pos++];
      if (char === '"') return { value, start, end: pos };
      if (char !== '\\') { value += char; continue; }
      const escaped = source[pos++];
      if (escaped === undefined) break;
      value += ({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' })[escaped] ?? ('\\' + escaped);
    }
    throw new Error('Incomplete Steam settings string.');
  };
  const block = (nested, depth = 0) => {
    if (depth > 100) throw new Error('Steam settings are too deeply nested.');
    const entries = [];
    while (true) {
      skip();
      if (pos === source.length) {
        if (nested) throw new Error('Incomplete Steam settings block.');
        return { entries, close: pos };
      }
      if (source[pos] === '}') {
        if (!nested) throw new Error('Unexpected Steam settings closing brace.');
        return { entries, close: pos++ };
      }
      const key = token(); skip();
      if (source[pos] === '{') {
        pos++; const child = block(true, depth + 1);
        entries.push({ key: key.value, start: key.start, end: pos, ...child });
      } else {
        const value = token();
        entries.push({ key: key.value, start: key.start, end: pos, value: value.value, token: value });
      }
    }
  };
  return block(false);
}

function child(node, key, required = true) {
  const matches = node.entries?.filter(entry => entry.key.toLowerCase() === key.toLowerCase()) ?? [];
  if (matches.length > 1) throw new Error('Ambiguous Steam settings; no changes made.');
  if (!matches.length && required) throw new Error('Open Idleon once in Steam, exit both apps, then run setup again.');
  return matches[0];
}
function appNode(source, required = true) {
  let node = parseVdf(source);
  for (const key of CONFIG_PATH) { node = child(node, key, required); if (!node) return null; }
  if (!node.entries) throw new Error('Unsupported Steam app settings.');
  return node;
}
export function launchOptions(source, allowMissingApp = false) {
  const app = appNode(source, !allowMissingApp);
  if (!app) return null;
  const entry = child(app, 'LaunchOptions', false);
  if (entry && typeof entry.value !== 'string') throw new Error('Unsupported Steam launch options.');
  return entry?.value ?? null;
}
function quote(value) { return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t') + '"'; }
export function replaceLaunchOptions(source, value) {
  const app = appNode(source), entry = child(app, 'LaunchOptions', false);
  if (value === null) return entry ? source.slice(0, entry.start) + source.slice(entry.end) : source;
  if (entry) return source.slice(0, entry.token.start) + quote(value) + source.slice(entry.token.end);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source.slice(0, app.close) + '\t"LaunchOptions"\t\t' + quote(value) + newline + source.slice(app.close);
}

export function accountFromLogins(source) {
  const users = child(parseVdf(source), 'users');
  let recent = users.entries.filter(entry => child(entry, 'MostRecent', false)?.value === '1');
  if (!recent.length) recent = users.entries.filter(entry => child(entry, 'AutoLogin', false)?.value === '1');
  if (!recent.length && users.entries.length === 1) recent = users.entries;
  if (recent.length !== 1 || !/^\d{17}$/.test(recent[0].key)) throw new Error('Sign into the Steam account you want to use, exit Steam, then try again.');
  const id = BigInt(recent[0].key) - 76561197960265728n;
  if (id < 1n || id > 4294967295n) throw new Error('Unsupported Steam account identifier.');
  return String(id);
}
export function managedCommand(installRoot, original) {
  const launcher = path.join(installRoot, 'IdleonCardProfiles.exe');
  if (/["\r\n%]/.test(launcher)) throw new Error('Unsupported installation path for Steam launch options.');
  const command = `"${launcher}" --steam %command%`;
  if (original === command) return command; // Adopt the older manual configuration.
  if (original && (original.includes('%command%') || /IdleonCardProfiles\.exe|--(?:remote-debugging|inspect)/i.test(original))) {
    throw new Error('Idleon already uses a custom launcher or debugger option. Remove that option in Steam before enabling Card Profiles.');
  }
  return command + (original ? ' ' + original : '');
}

async function readText(file) {
  const bytes = await fs.readFile(file);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Steam settings are not valid UTF-8. No changes made.');
  return text;
}
async function replaceFile(file, text) {
  const temp = file + '.tmp-' + randomUUID();
  try { await fs.writeFile(temp, text, { flag: 'wx', mode: 0o600 }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}
async function assertContained(file, root) {
  const actual = await fs.realpath(file), base = await fs.realpath(root);
  const relative = path.relative(base, actual);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Linked Steam settings outside the Steam folder are not supported.');
}

export async function setupSteam(options) {
  if (!['enable', 'disable'].includes(options.action)) return setupSteamLocked(options);
  await options.assertIdle?.();
  await fs.mkdir(options.dataRoot, { recursive: true });
  const lock = path.join(options.dataRoot, 'steam-setup.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Do not race another process to reclaim a stale lock. Keep recovery explicit.
    throw new Error('Another Steam setup is running or was interrupted. Close other installers; if this persists, request help with steam-setup.lock.');
  }
  try { await handle.writeFile(String(process.pid)); return await setupSteamLocked(options); }
  finally { await handle.close(); await fs.unlink(lock); }
}

async function setupSteamLocked({ action, steamRoot, installRoot, dataRoot, assertIdle = async () => {} }) {
  if (!['check', 'enable', 'disable', 'status'].includes(action)) throw new Error('Unknown Steam setup action.');
  if (![steamRoot, installRoot, dataRoot].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('Steam setup requires absolute paths.');
  const journalFile = path.join(dataRoot, 'steam-setup.json');
  let journal = { version: 1, steamRoot, accounts: {} };
  try {
    journal = JSON.parse(await readText(journalFile));
    if (journal.version !== 1 || path.resolve(journal.steamRoot).toLowerCase() !== path.resolve(steamRoot).toLowerCase() || !journal.accounts || Array.isArray(journal.accounts)) throw new Error('Invalid backup');
    for (const [id, record] of Object.entries(journal.accounts)) {
      if (!/^\d{1,10}$/.test(id) || !record || !(record.original === null || typeof record.original === 'string') || typeof record.managed !== 'string') throw new Error('Invalid backup');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('Steam setup backup is unreadable. Keep it and request help before changing settings.'); }
  if (action !== 'status') await assertIdle();
  const configFor = id => path.join(steamRoot, 'userdata', id, 'config', 'localconfig.vdf');
  const readConfig = async id => { const file = configFor(id); await assertContained(file, steamRoot); return { file, source: await readText(file) }; };
  const writeConfig = async (file, source, updated) => {
    if (source === updated) return;
    await assertIdle();
    if (await readText(file) !== source) throw new Error('Steam settings changed during setup. Exit Steam and try again.');
    // Store full recovery copy beside Steam's original file, never in a public log.
    await fs.copyFile(file, file + '.card-profiles-' + randomUUID() + '.bak', 1);
    await replaceFile(file, updated);
  };
  if (action === 'disable') {
    // A missing journal must not let uninstall strand any Steam account's wrapper.
    for (const dir of await fs.readdir(path.join(steamRoot, 'userdata'), { withFileTypes: true })) {
      if (!dir.isDirectory() || !/^\d{1,10}$/.test(dir.name) || journal.accounts[dir.name]) continue;
      let source;
      try { ({ source } = await readConfig(dir.name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (/IdleonCardProfiles\.exe/i.test(launchOptions(source, true) ?? '')) throw new Error('A Steam account still uses Card Profiles but its backup is missing. Remove the Card Profiles launch option in that account before uninstalling.');
    }
    // Validate every affected account before restoring the first one.
    const changes = [];
    for (const [id, record] of Object.entries(journal.accounts)) {
      const { file, source } = await readConfig(id), current = launchOptions(source);
      if (current !== record.managed && current !== record.original && /IdleonCardProfiles\.exe/i.test(current ?? '')) throw new Error('An Idleon launch option was changed after setup. Remove the Card Profiles command in Steam before uninstalling.');
      if (current === record.managed) changes.push({ file, source, updated: replaceLaunchOptions(source, record.original) });
    }
    for (const change of changes) await writeConfig(change.file, change.source, change.updated);
    if (Object.keys(journal.accounts).length) await replaceFile(journalFile, JSON.stringify({ ...journal, accounts: {} }, null, 2));
    return 'Previous Steam settings restored.';
  }
  const id = accountFromLogins(await readText(path.join(steamRoot, 'config', 'loginusers.vdf')));
  const { file, source } = await readConfig(id), current = launchOptions(source);
  const record = journal.accounts[id];
  if (record && current !== record.managed && current !== record.original) throw new Error('Idleon launch options changed after setup. Restore the previous setting before repairing Card Profiles.');
  const base = managedCommand(installRoot, null);
  // An old manual wrapper had no recorded original; removing it restores an empty option.
  const original = record ? record.original : current === base ? null : current;
  const managed = managedCommand(installRoot, original);
  if (action === 'status') {
    if (current !== managed) throw new Error('Steam Play is not configured for this account. Exit Idleon and Steam, then open Steam Setup from the Start menu.');
    return 'Steam Play is configured.';
  }
  if (action === 'check') return 'Steam settings are ready.';
  await fs.mkdir(dataRoot, { recursive: true });
  // Record intent before changing Steam, allowing retry after interrupted setup.
  journal.accounts[id] = { original, managed };
  await replaceFile(journalFile, JSON.stringify(journal, null, 2));
  await writeConfig(file, source, replaceLaunchOptions(source, managed));
  return 'Steam Play is configured.';
}

async function requireIdle() {
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-Process -Name steam,LegendsOfIdleon -ErrorAction SilentlyContinue).Count"], { windowsHide: true, timeout: 10000 });
  if (!/^0\s*$/.test(stdout)) throw new Error('Exit Idleon and Steam normally, then try again. In Steam, choose Steam > Exit.');
}
async function main() {
  if (process.platform !== 'win32') throw new Error('Steam setup supports Windows only.');
  const { stdout } = await execute('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 10000 });
  const steamRoot = stdout.match(/SteamPath\s+REG_SZ\s+([^\r\n]+)/i)?.[1].trim();
  if (!steamRoot || !process.env.LOCALAPPDATA) throw new Error('Steam was not found. Install Steam and sign in before running setup.');
  console.log(await setupSteam({ action: process.argv[2], steamRoot: path.resolve(steamRoot), installRoot: process.argv[3], dataRoot: path.join(process.env.LOCALAPPDATA, 'IdleonCardProfiles'), assertIdle: requireIdle }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  // Do not print Steam file contents, account IDs, command arguments, or secrets.
  console.error(error.code ? 'Could not access Steam settings. Sign into Steam once, exit it, then try setup again.' : error.message);
  process.exitCode = 1;
});
