import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { discoverInstallation, readInstalledBundle, detectRunningGame, launchGame } from '../src/steam.js';

async function fixture(t, headerOverride) {
  const directory = await mkdtemp(path.join(tmpdir(), 'idleon-addon-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = 'var g={};g.ApplicationMain = {};';
  const json = Buffer.from(JSON.stringify(headerOverride || { files: { dist: { files: { 'N.js': { size: Buffer.byteLength(source), offset: '0' } } } } }));
  const header = Buffer.alloc(8 + Math.ceil(json.length / 4) * 4);
  header.writeUInt32LE(header.length - 4, 0);
  header.writeUInt32LE(json.length, 4);
  json.copy(header, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(header.length, 4);
  await mkdir(path.join(directory, 'resources'));
  await writeFile(path.join(directory, 'LegendsOfIdleon.exe'), 'test fixture, never execute');
  await writeFile(path.join(directory, 'resources', 'app.asar'), Buffer.concat([size, header, Buffer.from(source)]));
  return { directory, source };
}

test('finds an explicit installation and reads only the packed bundle', async t => {
  const { directory, source } = await fixture(t);
  const install = await discoverInstallation(path.join(directory, 'LegendsOfIdleon.exe'));
  const bundle = await readInstalledBundle(install);
  assert.equal(bundle.source, source);
  assert.equal(bundle.entryPath, 'dist/N.js');
  assert.equal(bundle.hash, createHash('sha256').update(source).digest('hex'));
});

test('ASAR reader rejects ambiguous and out-of-bounds entries', async t => {
  const duplicate = await fixture(t, { files: { 'N.js': { size: 5, offset: '0' }, x: { files: { 'N.js': { size: 5, offset: '0' } } } } });
  await assert.rejects(readInstalledBundle(await discoverInstallation(duplicate.directory)), /exactly one/);
  const invalid = await fixture(t, { files: { 'N.js': { size: 5, offset: '999999999' } } });
  await assert.rejects(readInstalledBundle(await discoverInstallation(invalid.directory)), /invalid N.js/);
});

test('process detection uses a read-only process listing and fails closed on invalid output', async () => {
  let invocation;
  const running = await detectRunningGame({ platform: 'win32', executeImpl: async (...args) => {
    invocation = args; return { stdout: '[{"pid":42,"name":"LegendsOfIdleon"}]' };
  } });
  assert.equal(running[0].pid, 42);
  assert.match(invocation[1].at(-1), /Get-Process/);
  assert.doesNotMatch(invocation[1].at(-1), /Stop-Process|Start-Process/);
  await assert.rejects(detectRunningGame({ platform: 'win32', executeImpl: async () => ({ stdout: '{"pid":"bad"}' }) }), /verify/);
});

test('launch refuses existing games and lacks automatic approval or restart behavior', async t => {
  const { directory } = await fixture(t);
  const install = await discoverInstallation(directory);
  let spawns = 0;
  let portChecks = 0;
  const deps = { spawnImpl: () => { spawns++; }, checkPortAvailable: async () => { portChecks++; } };
  await assert.rejects(launchGame(install, deps), /explicit/);
  await assert.rejects(launchGame(install, { ...deps, launchApproved: true, detectRunning: async () => [{ pid: 1 }] }), /already running/);
  assert.equal(spawns, 0);
  assert.equal(portChecks, 0);
});

test('approved launch checks port and spawns only once without kill handlers', async t => {
  const { directory } = await fixture(t);
  const install = await discoverInstallation(directory);
  const calls = [];
  let spawned;
  const result = await launchGame(install, {
    launchApproved: true, detectRunning: async () => { calls.push('detect'); return []; },
    checkPortAvailable: async port => { calls.push(`port:${port}`); },
    spawnImpl: (exe, args, options) => {
      calls.push('spawn'); spawned = { exe, args, options };
      const child = new EventEmitter(); queueMicrotask(() => child.emit('spawn')); return child;
    },
  });
  assert.deepEqual(calls, ['detect', 'port:32123', 'spawn']);
  assert.deepEqual(spawned.args, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=32123']);
  assert.equal(spawned.options.windowsHide, false, 'the interactive game must not inherit a hidden launch');
  assert.equal(result.listenerCount('exit'), 0);
  await assert.rejects(launchGame(install, {
    launchApproved: true, detectRunning: async () => [], checkPortAvailable: async () => { throw new Error('Port occupied'); },
    spawnImpl: () => { throw new Error('Must not spawn'); },
  }), /Port occupied/);
});

test('Steam game arguments stay separate and cannot override the debugger listener', async t => {
  const { directory } = await fixture(t);
  const install = await discoverInstallation(directory);
  const forwarded = ['--example', 'with spaces', 'literal&argument'];
  const options = { launchApproved: true, detectRunning: async () => [], checkPortAvailable: async () => {},
    spawnImpl: (_exe, args, settings) => {
      assert.deepEqual(args.slice(2), forwarded);
      assert.notEqual(settings.shell, true);
      const child = new EventEmitter(); queueMicrotask(() => child.emit('spawn')); return child;
    },
  };
  await launchGame(install, { ...options, gameArgs: forwarded });
  for (const flag of ['--remote-debugging-port=9999', '--remote-debugging-address=0.0.0.0', '--remote-debugging-pipe', '--inspect']) {
    await assert.rejects(launchGame(install, { ...options, gameArgs: [flag] }), /Remove debugger flags/);
  }
});

test('cancellation during a launch preflight prevents spawning', async t => {
  const { directory } = await fixture(t);
  const install = await discoverInstallation(directory);
  let spawns = 0;
  const cancellation = new AbortController();
  await assert.rejects(launchGame(install, {
    launchApproved: true, signal: cancellation.signal, detectRunning: async () => [],
    checkPortAvailable: async () => { cancellation.abort(); },
    spawnImpl: () => { spawns++; throw new Error('Must not spawn after cancellation.'); },
  }), { name: 'AbortError' });
  assert.equal(spawns, 0);
  const processCancellation = new AbortController();
  let portChecks = 0;
  await assert.rejects(launchGame(install, {
    launchApproved: true, signal: processCancellation.signal,
    detectRunning: async () => { processCancellation.abort(); return []; },
    checkPortAvailable: async () => { portChecks++; },
    spawnImpl: () => { spawns++; },
  }), { name: 'AbortError' });
  assert.equal(portChecks, 0);
  assert.equal(spawns, 0);
});
