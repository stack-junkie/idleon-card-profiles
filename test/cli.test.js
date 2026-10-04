import test from 'node:test';
import assert from 'node:assert/strict';
import { main, parseArgs, managedShutdown } from '../src/cli.js';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { SUPPORTED_BUNDLE_HASH } from '../src/injector.js';

function fixture(overrides = {}) {
  const calls = [];
  const api = {
    discoverInstallation: async () => ({ directory: 'fixture' }),
    readInstalledBundle: async () => ({ hash: SUPPORTED_BUNDLE_HASH, source: '' }),
    detectRunningGame: async () => [],
    openStore: async () => ({ file: 'fixture/profiles.json', close: async () => calls.push('store-close') }),
    launchGame: async () => ({ unref: () => calls.push('unref') }),
    waitForGamePage: async () => ({ webSocketDebuggerUrl: 'ws://fixture' }),
    connectCdp: async () => { calls.push('connect'); return { close: () => calls.push('client-close'), on() {} }; },
    installAddonSession: async () => { calls.push('install'); return { ready: Promise.resolve(), cleanup: async () => calls.push('cleanup') }; },
    installWindowClose: async () => async () => {},
    ...overrides,
  };
  return { calls, api };
}

test('live flag and running game guards prevent all attachment and storage operations', async () => {
  await assert.rejects(main(['launch']), /requires --live/);
  const { calls, api } = fixture({ detectRunningGame: async () => [{ pid: 1 }], openStore: async () => { calls.push('store-open'); } });
  await assert.rejects(main(['launch', '--live'], api), /already running/);
  assert.deepEqual(calls, []);
});

test('Steam wrapper requires its game path and forwards arguments without interpreting them', async () => {
  const exe = path.resolve('fixture', 'LegendsOfIdleon.exe');
  assert.throws(() => parseArgs(['steam', '--', 'wrong.exe']), /Steam did not supply/);
  assert.throws(() => parseArgs(['steam', exe]), /Steam did not supply/);
  assert.throws(() => parseArgs(['steam', '--', path.resolve('other.exe')]), /Steam did not supply/);
  const gameArgs = ['--example', 'value with spaces', 'literal&value', '--live'];
  let selected, forwarded;
  const { api } = fixture({
    discoverInstallation: async value => { selected = value; return { directory: 'fixture', exePath: exe }; },
    launchGame: async (_install, options) => { forwarded = options; return { unref() {} }; },
  });
  const session = await main(['steam', '--', exe, ...gameArgs], api);
  assert.equal(selected, exe);
  assert.deepEqual(forwarded.gameArgs, gameArgs);
  assert.equal(forwarded.launchApproved, true);
  await session.close();
});

test('helper unreferences game and cleans up without terminating it', async () => {
  const { calls, api } = fixture();
  const result = await main(['launch', '--live', '--data-dir', 'fixture'], api);
  await result.close();
  assert.deepEqual(calls, ['unref', 'connect', 'install', 'cleanup', 'store-close']);
});

test('game close disconnects before cleanup and never waits for the closing renderer', async () => {
  let nativeClose;
  const { calls, api } = fixture({
    installWindowClose: async (_client, callback) => {
      nativeClose = callback;
      return () => { assert.fail('Must not request listener removal from a closing renderer'); };
    },
    installAddonSession: async () => ({ ready: Promise.resolve(), cleanup: async () => {
      assert.ok(calls.includes('client-close'), 'Disconnect must precede renderer cleanup');
      calls.push('cleanup');
    } }),
  });
  await main(['launch', '--live', '--data-dir', 'fixture'], api);
  await nativeClose();
  assert.deepEqual(calls, ['unref', 'connect', 'client-close', 'cleanup', 'store-close']);
});

test('cancelling during debugger discovery prevents connection and releases storage', async () => {
  const { calls, api } = fixture({ waitForGamePage: async () => { process.emit('SIGINT'); return { webSocketDebuggerUrl: 'ws://fixture' }; } });
  await assert.rejects(main(['launch', '--live', '--data-dir', 'fixture'], api), /startup cancelled/);
  assert.deepEqual(calls, ['unref', 'store-close']);
});

test('cancelling during connection closes the new client without injection', async () => {
  const { calls, api } = fixture({ connectCdp: async () => { process.emit('SIGINT'); return { close: () => calls.push('client-close') }; } });
  await assert.rejects(main(['launch', '--live', '--data-dir', 'fixture'], api), /startup cancelled/);
  assert.deepEqual(calls, ['unref', 'store-close', 'client-close']);
});

test('closing the launched game during discovery releases storage without waiting for timeout', async () => {
  const child = new EventEmitter(); child.unref = () => {};
  const { calls, api } = fixture({
    launchGame: async () => child,
    waitForGamePage: async (_port, signal) => {
      const cancelled = new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      child.emit('exit', 0);
      return cancelled;
    },
  });
  await main(['launch', '--live', '--data-dir', 'fixture'], api);
  assert.deepEqual(calls, ['store-close']);
  assert.equal(child.listenerCount('exit'), 0);
});

test('native X is watched before injection and closes cleanly while initialization is pending', async () => {
  let nativeClose, observed = false;
  const { calls, api } = fixture({
    installWindowClose: async (_client, callback, options) => {
      assert.equal(options.deferUnload, true);
      observed = true; nativeClose = callback;
      return async () => { assert.fail('Closing renderer must not be queried'); };
    },
    installAddonSession: async ({ signal }) => {
      assert.equal(observed, true);
      const ready = new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      setImmediate(nativeClose);
      return { ready, cleanup: async () => calls.push('cleanup') };
    },
  });
  await main(['launch', '--live', '--data-dir', 'fixture'], api);
  assert.deepEqual(calls, ['unref', 'connect', 'client-close', 'cleanup', 'store-close']);
});

test('managed launcher disconnect handles split lines and removes pipe listeners', () => {
  const input = new PassThrough();
  const control = managedShutdown(input);
  input.write('discon'); assert.equal(control.signal.aborted, false);
  input.write('nect\r\n'); assert.equal(control.signal.aborted, true);
  control.dispose(); assert.equal(input.listenerCount('data'), 0);
  assert.equal(input.listenerCount('end'), 0);
});

test('managed launcher pipe loss disconnects the helper', async () => {
  const input = new PassThrough();
  const control = managedShutdown(input);
  input.end(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(control.signal.aborted, true); control.dispose();
});

test('managed disconnect during discovery releases storage and cancels launch polling', async () => {
  const input = new PassThrough();
  const control = managedShutdown(input);
  const { calls, api } = fixture({
    shutdownSignal: control.signal, onClosed: () => control.dispose(),
    waitForGamePage: async (_port, signal) => {
      const cancelled = new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      input.write('disconnect\n'); return cancelled;
    },
  });
  await assert.rejects(main(['launch', '--live', '--data-dir', 'fixture'], api), /startup cancelled/);
  assert.deepEqual(calls, ['unref', 'store-close']);
  assert.equal(input.listenerCount('data'), 0);
});
