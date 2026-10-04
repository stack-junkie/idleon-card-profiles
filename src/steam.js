import { open, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';

const execute = promisify(execFile);
const EXE = 'LegendsOfIdleon.exe';

async function isFile(file) {
  try { return (await stat(file)).isFile(); } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
    throw error;
  }
}

export async function discoverInstallation(optionalPath) {
  const directories = [];
  if (optionalPath) {
    const supplied = path.resolve(optionalPath);
    directories.push(path.basename(supplied).toLowerCase() === EXE.toLowerCase() ? path.dirname(supplied) : supplied);
  } else {
    const steamRoots = new Set([
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam'),
    ]);
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execute('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true });
        const match = stdout.match(/SteamPath\s+REG_SZ\s+([^\r\n]+)/i);
        if (match) steamRoots.add(match[1].trim());
      } catch { /* Explicit paths and standard Steam locations remain available. */ }
    }
    for (const root of [...steamRoots]) {
      try {
        const vdf = await readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        for (const match of vdf.matchAll(/"path"\s*"((?:\\.|[^"\\])*)"/g)) {
          steamRoots.add(match[1].replace(/\\\\/g, '\\'));
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const root of steamRoots) directories.push(path.join(root, 'steamapps', 'common', 'Legends of Idleon'));
  }
  for (const directory of directories) {
    const exePath = path.join(directory, EXE);
    const asarPath = path.join(directory, 'resources', 'app.asar');
    if (await isFile(exePath) && await isFile(asarPath)) return { directory, exePath, asarPath };
  }
  throw new Error('Idleon installation not found. Supply the Steam game directory with --game-dir.');
}

async function readExactly(handle, size, position) {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, position + offset);
    if (!bytesRead) throw new Error('Truncated ASAR archive.');
    offset += bytesRead;
  }
  return buffer;
}

/** Read one packed N.js entry. Never extracts or modifies the installation. */
export async function readInstalledBundle(install) {
  const asarPath = typeof install === 'string' ? install : install.asarPath;
  const handle = await open(asarPath, 'r');
  try {
    const archive = await handle.stat();
    const sizePickle = await readExactly(handle, 8, 0);
    const headerSize = sizePickle.readUInt32LE(4);
    if (sizePickle.readUInt32LE(0) !== 4 || headerSize < 8 || headerSize > 32 * 1024 * 1024
        || headerSize + 8 > archive.size) throw new Error('Invalid ASAR header.');
    const header = await readExactly(handle, headerSize, 8);
    const jsonSize = header.readUInt32LE(4);
    if (jsonSize > headerSize - 8) throw new Error('Invalid ASAR header string.');
    const root = JSON.parse(header.subarray(8, 8 + jsonSize).toString('utf8'));
    const candidates = [];
    const visit = (node, prefix = '') => {
      for (const [name, entry] of Object.entries(node.files || {})) {
        const entryPath = prefix ? `${prefix}/${name}` : name;
        if (entry.files) visit(entry, entryPath);
        else if (name === 'N.js') candidates.push({ entry, entryPath });
      }
    };
    visit(root);
    if (candidates.length !== 1) throw new Error('Expected exactly one N.js bundle in the game archive.');
    const { entry, entryPath } = candidates[0];
    const offset = Number(entry.offset);
    if (entry.unpacked || entry.link || !Number.isSafeInteger(offset) || offset < 0
        || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 128 * 1024 * 1024
        || 8 + headerSize + offset + entry.size > archive.size) throw new Error('Unsupported or invalid N.js ASAR entry.');
    const bytes = await readExactly(handle, entry.size, 8 + headerSize + offset);
    return { source: bytes.toString('utf8'), hash: createHash('sha256').update(bytes).digest('hex'), entryPath, asarPath };
  } finally { await handle.close(); }
}

export async function detectRunningGame({ executeImpl = execute, platform = process.platform } = {}) {
  if (platform !== 'win32') throw new Error('The Steam addon launcher currently supports Windows only.');
  const { stdout } = await executeImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "@(Get-Process -Name 'LegendsOfIdleon' -ErrorAction SilentlyContinue | Select-Object @{Name='pid';Expression={$_.Id}},@{Name='name';Expression={$_.ProcessName}}) | ConvertTo-Json -Compress"],
  { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout);
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  if (processes.some(item => !Number.isSafeInteger(item.pid) || typeof item.name !== 'string')) {
    throw new Error('Could not verify the current Idleon process state.');
  }
  return processes;
}

export async function assertDebuggerPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', error => reject(new Error(`Debugger port ${port} is unavailable: ${error.code || error.message}`)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(error => error ? reject(error) : resolve()));
  });
}

export async function launchGame(install, {
  port = 32123, launchApproved = false, detectRunning = detectRunningGame, spawnImpl = spawn,
  checkPortAvailable = assertDebuggerPortAvailable,
  signal, gameArgs = [],
} = {}) {
  if (!launchApproved) throw new Error('Launching the game requires explicit live-session approval.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local debugger port.');
  if (!Array.isArray(gameArgs) || gameArgs.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new Error('Invalid game launch arguments.');
  }
  if (gameArgs.some(arg => /^--(?:remote-debugging(?:-[a-z-]+)?|inspect(?:-[a-z-]+)?)(?:=|$)/i.test(arg))) {
    throw new Error('Remove debugger flags from Steam Launch Options. Card Profiles manages its own local connection.');
  }
  signal?.throwIfAborted();
  const running = await detectRunning();
  signal?.throwIfAborted();
  if (running.length) throw new Error('Idleon is already running. The addon will not attach, restart, reload, or close it.');
  if (!install?.exePath) throw new Error('A verified Idleon executable is required.');
  const executableExists = await isFile(install.exePath);
  signal?.throwIfAborted();
  if (!executableExists) throw new Error('A verified Idleon executable is required.');
  await checkPortAvailable(port);
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawnImpl(install.exePath, [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${port}`, ...gameArgs],
      // The helper is hidden, but the requested interactive game must be visible.
      { cwd: install.directory || path.dirname(install.exePath), windowsHide: false, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => resolve(child));
  });
}
