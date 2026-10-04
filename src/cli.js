#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverInstallation, readInstalledBundle, detectRunningGame, launchGame } from './steam.js';
import { listCdpTargets, connectCdp } from './cdp.js';
import { installAddonSession, SUPPORTED_BUNDLE_HASH } from './injector.js';
import { ProfileStore } from './store.js';
import { buildBrowserSource } from './bootstrap.js';
import { startPreview } from './preview-server.js';
import { installWindowClose } from './window-close.js';

export function parseArgs(args) {
  const [command = 'help', ...rest] = args;
  if (command === 'steam') {
    const [separator, executable, ...gameArgs] = rest;
    if (separator !== '--' || !executable || !path.isAbsolute(executable)
        || path.basename(executable).toLowerCase() !== 'legendsofidleon.exe') {
      throw new Error('Steam did not supply the Idleon executable. Use the launch option shown in Card Profiles setup, including %command%.');
    }
    return { command: 'launch', live: true, 'game-dir': executable, gameArgs, steam: true };
  }
  const result = { command, live: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--live') result.live = true;
    else if (['--game-dir', '--data-dir', '--port'].includes(flag)) {
      const value = rest[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
      result[flag.slice(2)] = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (result.port !== undefined && (!/^\d+$/.test(result.port) || Number(result.port) < 1 || Number(result.port) > 65535)) throw new Error('Use a port between 1 and 65535.');
  return result;
}

async function waitForGamePage(port, signal) {
  const endpoint = `http://127.0.0.1:${port}`;
  const end = Date.now() + 45000;
  let lastError;
  while (Date.now() < end) {
    signal?.throwIfAborted();
    try {
      const pages = (await listCdpTargets(endpoint, { timeoutMs: 2000 })).filter(page => {
        try { const url = new URL(page.url); return url.protocol === 'file:' && /\/distBuild\/app\.html$/i.test(url.pathname); } catch { return false; }
      });
      if (pages.length === 1) return pages[0];
      if (pages.length > 1) throw new Error('Multiple Idleon windows were found. Close them normally before trying again.');
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`The newly launched game did not expose its expected local page. ${lastError?.message || ''}`.trim());
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const api = { discoverInstallation, readInstalledBundle, detectRunningGame, launchGame, connectCdp, installAddonSession, installWindowClose, waitForGamePage, openStore: directory => new ProfileStore(directory).open(), ...dependencies };
  const options = parseArgs(args);
  dependencies.shutdownSignal?.throwIfAborted();
  if (options.command === 'help' || options.command === '--help') {
    console.log('Idleon Card Profiles\n\n  node src/cli.js inspect                 Read installed compatibility only\n  node src/cli.js preview                 Start an isolated offline preview\n  node src/cli.js launch --live            Launch a new add-on session after leaving the game\n\nOptions: --game-dir <folder>, --data-dir <folder>, --port <number>\nThe helper never attaches to or closes an already-running game.');
    return;
  }
  if (options.command === 'preview') {
    const preview = await startPreview({ port: Number(options.port || 0), dataDirectory: options['data-dir'] });
    console.log(`Offline preview, no game connection:\n${preview.url}`);
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await preview.close(); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
    return preview;
  }
  if (options.command !== 'inspect' && options.command !== 'launch') throw new Error('Unknown command. Run with --help.');
  if (options.command === 'launch' && !options.live) throw new Error('Live launch requires --live. Finish your play session and exit Idleon normally first.');
  const install = await api.discoverInstallation(options['game-dir']);
  const bundle = await api.readInstalledBundle(install);
  if (options.command === 'inspect') {
    console.log(JSON.stringify({ installation: install.directory, sourceBytes: Buffer.byteLength(bundle.source), bundleHash: bundle.hash, supported: bundle.hash === SUPPORTED_BUNDLE_HASH, gameRunning: (await api.detectRunningGame()).length > 0, liveConnectionAttempted: false }, null, 2));
    return;
  }
  if (bundle.hash !== SUPPORTED_BUNDLE_HASH) throw new Error(`This Idleon update is not supported (${bundle.hash}). No game was launched or changed.`);
  if ((await api.detectRunningGame()).length) throw new Error('Idleon is already running. No connection was attempted. Exit the game normally when ready, then run the launcher again.');
  const dataDirectory = options['data-dir'] || path.join(process.env.LOCALAPPDATA || (() => { throw new Error('LOCALAPPDATA is unavailable. Supply --data-dir.'); })(), 'IdleonCardProfiles');
  const store = await api.openStore(dataDirectory);
  const port = Number(options.port || 32123);
  let client, session, removeWindowClose, launchedChild, closingPromise, gameClosedNormally = false, shuttingDown = false;
  const startup = new AbortController();
  const close = (gameClosing = false) => {
    if (shuttingDown) return closingPromise;
    shuttingDown = true;
    closingPromise = Promise.resolve().then(async () => {
      const disconnectDeadline = setTimeout(() => client?.close(), 1500);
      disconnectDeadline.unref();
      try {
      // A closing renderer may stop answering CDP. Release it before cleanup.
      if (gameClosing === true) client?.close();
      else if (removeWindowClose) await removeWindowClose();
      startup.abort(new Error('Add-on startup cancelled.'));
      process.removeListener('SIGINT', close); process.removeListener('SIGTERM', close);
      dependencies.shutdownSignal?.removeEventListener('abort', onManagedStop);
      launchedChild?.removeListener?.('exit', onGameExit);
      if (session) await session.cleanup().catch(() => {}); else client?.close();
      await store.close();
      } finally { clearTimeout(disconnectDeadline); dependencies.onClosed?.(); }
    });
    return closingPromise;
  };
  const onGameExit = code => { gameClosedNormally = code === 0; return close(true).catch(error => console.error(error.message)); };
  const onManagedStop = () => { close().catch(error => console.error(error.message)); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  dependencies.shutdownSignal?.addEventListener('abort', onManagedStop, { once: true });
  try {
    if (dependencies.shutdownSignal?.aborted) { await close(); return { close }; }
    const child = await api.launchGame(install, { port, launchApproved: true, signal: startup.signal, gameArgs: options.gameArgs || [] });
    launchedChild = child;
    child.once?.('exit', onGameExit);
    child.unref();
    if (child.exitCode !== undefined && child.exitCode !== null) await onGameExit(child.exitCode);
    startup.signal.throwIfAborted();
    console.log('Started a new Idleon session. Initializing the card add-on; this initial game page may reload once.');
    const target = await api.waitForGamePage(port, startup.signal);
    startup.signal.throwIfAborted();
    client = await api.connectCdp(target.webSocketDebuggerUrl);
    if (shuttingDown) { client.close(); startup.signal.throwIfAborted(); }
    client.on('disconnect', close);
    removeWindowClose = await api.installWindowClose(client, () => { gameClosedNormally = true; return close(true); }, { deferUnload: true });
    startup.signal.throwIfAborted();
    session = await api.installAddonSession({ client, browserSource: buildBrowserSource(), onRpc: (method, params) => store.dispatch(method, params), allowReload: true, launchedByAddon: true, signal: startup.signal });
    startup.signal.throwIfAborted();
    await session.ready;
    startup.signal.throwIfAborted();
    removeWindowClose.armUnload?.();
    startup.signal.throwIfAborted();
    console.log(`Card Profiles is connected. Open Codex > Cards.\nLocal library: ${store.file}\nPress Ctrl+C to remove the add-on and disconnect; Idleon stays open.`);
    return { close };
  } catch (error) {
    await close();
    if (gameClosedNormally) return { close };
    throw new Error(`${error.message}\nNo game process was terminated. Any launched game can be closed normally.`);
  }
}

export function managedShutdown(input) {
  const controller = new AbortController();
  let pending = '';
  const stop = () => controller.abort(new Error('Card Profiles disconnected.'));
  const onData = chunk => {
    pending += chunk.toString('utf8');
    if (pending.length > 1024) { stop(); return; }
    let boundary;
    while ((boundary = pending.indexOf('\n')) !== -1) {
      const command = pending.slice(0, boundary).trim();
      pending = pending.slice(boundary + 1);
      if (command === 'disconnect') stop();
    }
  };
  input.on('data', onData); input.on('end', stop); input.on('error', stop);
  return { signal: controller.signal, dispose() {
    input.removeListener('data', onData); input.removeListener('end', stop); input.removeListener('error', stop); input.pause();
  } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const managed = process.env.IDLEON_CARD_PROFILES_MANAGED === '1' ? managedShutdown(process.stdin) : null;
  main(process.argv.slice(2), { shutdownSignal: managed?.signal, onClosed: () => managed?.dispose() })
    .then(result => { if (!result) managed?.dispose(); })
    .catch(error => {
      managed?.dispose();
      if (!managed?.signal.aborted) { console.error(error.message); process.exitCode = 1; }
    });
}
