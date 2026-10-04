import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { accountFromLogins, launchOptions, managedCommand, parseVdf, replaceLaunchOptions, setupSteam } from '../src/steam-setup.js';

const logins = '"users" { "76561197960265851" { "MostRecent" "1" } "76561197960266184" { "MostRecent" "0" } }';
const config = '"UserLocalConfigStore"\r\n{\r\n"Software" { "Valve" { "Steam" { "apps" { "1476970" { "LastPlayed" "123" } "42" { "LaunchOptions" "KEEP" } } } } }\r\n"1476970" { "OverlayAppEnable" "1" }\r\n}\r\n';
async function fixture(t, original = null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'card-steam-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const steamRoot = path.join(root, 'Steam'), dataRoot = path.join(root, 'data'), installRoot = path.join(root, 'Card Profiles');
  const file = path.join(steamRoot, 'userdata', '123', 'config', 'localconfig.vdf');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.mkdir(path.join(steamRoot, 'config'), { recursive: true });
  await fs.writeFile(path.join(steamRoot, 'config', 'loginusers.vdf'), logins);
  await fs.writeFile(file, replaceLaunchOptions(config, original));
  const options = { steamRoot, dataRoot, installRoot };
  return { ...options, file, run: (action, extra = {}) => setupSteam({ ...options, action, ...extra }) };
}

test('scoped VDF changes preserve unrelated games, account blocks, comments and escaped strings', () => {
  const text = '\ufeff// comment\n' + config;
  const value = '"C:\\Test\\Card Profiles.exe" --steam %command% -test "hello"';
  const changed = replaceLaunchOptions(text, value);
  assert.equal(launchOptions(changed), value);
  assert.ok(changed.includes('"42" { "LaunchOptions" "KEEP" }'));
  assert.ok(changed.includes('"1476970" { "OverlayAppEnable" "1" }'));
  assert.ok(changed.startsWith('\ufeff// comment\n'));
  assert.equal(launchOptions(replaceLaunchOptions(changed, null)), null);
  const replaced = replaceLaunchOptions(changed, 'new');
  assert.equal(launchOptions(replaced), 'new');
  assert.equal(changed.slice(0, changed.indexOf('"LaunchOptions"')), replaced.slice(0, replaced.indexOf('"LaunchOptions"')));
});

test('ambiguous, malformed or unfamiliar VDF and ambiguous account selection are rejected', () => {
  for (const text of ['"root" {', '"root" { "key" "unfinished', 'unquoted { }', '"root" { } }', '"root" "\0"']) assert.throws(() => parseVdf(text));
  assert.throws(() => launchOptions(config.replace('"LastPlayed" "123"', '"LaunchOptions" "one" "launchoptions" "two"')));
  assert.throws(() => accountFromLogins(logins.replace('"MostRecent" "0"', '"MostRecent" "1"')));
  assert.equal(accountFromLogins(logins), '123');
  assert.equal(accountFromLogins(logins.replaceAll('MostRecent', 'AutoLogin')), '123');
  assert.equal(accountFromLogins('"users" { "76561197960265851" { "AccountName" "fixture" } }'), '123');
  assert.throws(() => managedCommand('C:\\bad%path', null));
  assert.throws(() => managedCommand('C:\\ok', 'other %command%'));
  assert.throws(() => managedCommand('C:\\ok', '--remote-debugging-port=9000'));
});

test('check is read-only, enable preserves arguments, repairs idempotently, and restore keeps later unrelated edits', async t => {
  const f = await fixture(t, '-windowed "two words"');
  await f.run('check');
  await assert.rejects(fs.access(f.dataRoot));
  await f.run('enable');
  assert.equal(launchOptions(await fs.readFile(f.file, 'utf8')), managedCommand(f.installRoot, '-windowed "two words"'));
  await f.run('enable');
  await f.run('status');
  const backups = (await fs.readdir(path.dirname(f.file))).filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.equal(launchOptions(await fs.readFile(path.join(path.dirname(f.file), backups[0]), 'utf8')), '-windowed "two words"');
  await fs.writeFile(f.file, (await fs.readFile(f.file, 'utf8')).replace('"123"', '"456"'));
  await f.run('disable');
  const restored = await fs.readFile(f.file, 'utf8');
  assert.equal(launchOptions(restored), '-windowed "two words"');
  assert.ok(restored.includes('"LastPlayed" "456"'));
  await f.run('disable');
  await assert.rejects(f.run('status'), /not configured/);
});

test('absent options and old manual Card Profiles commands restore without leaving a wrapper', async t => {
  const f = await fixture(t);
  await f.run('enable'); await f.run('disable');
  assert.equal(launchOptions(await fs.readFile(f.file, 'utf8')), null);
  await fs.writeFile(f.file, replaceLaunchOptions(config, managedCommand(f.installRoot, null)));
  await f.run('enable'); await f.run('disable');
  assert.equal(launchOptions(await fs.readFile(f.file, 'utf8')), null);
});

test('running Steam prevents changes and an interrupted enable can be retried', async t => {
  const f = await fixture(t, '-test'), original = await fs.readFile(f.file, 'utf8');
  await assert.rejects(f.run('enable', { assertIdle: async () => { throw new Error('Steam running'); } }), /Steam running/);
  assert.equal(await fs.readFile(f.file, 'utf8'), original);
  let checks = 0;
  await assert.rejects(f.run('enable', { assertIdle: async () => { if (++checks === 2) throw new Error('Steam started'); } }), /Steam started/);
  assert.equal(await fs.readFile(f.file, 'utf8'), original);
  await f.run('enable');
  await f.run('disable');
  assert.equal(launchOptions(await fs.readFile(f.file, 'utf8')), '-test');
});

test('custom wrappers are refused and user edits after setup are never overwritten', async t => {
  const f = await fixture(t, 'other-launcher %command%');
  const before = await fs.readFile(f.file, 'utf8');
  await assert.rejects(f.run('check'), /custom launcher/);
  assert.equal(await fs.readFile(f.file, 'utf8'), before);
  await fs.writeFile(f.file, config); await f.run('enable');
  const changed = replaceLaunchOptions(await fs.readFile(f.file, 'utf8'), '-new-user-option');
  await fs.writeFile(f.file, changed);
  await assert.rejects(f.run('enable'), /changed after setup/);
  await f.run('disable');
  assert.equal(await fs.readFile(f.file, 'utf8'), changed);
});

test('restoration handles multiple configured accounts without touching unconfigured accounts', async t => {
  const f = await fixture(t, '-first'); await f.run('enable');
  const second = path.join(f.steamRoot, 'userdata', '456', 'config', 'localconfig.vdf');
  await fs.mkdir(path.dirname(second), { recursive: true }); await fs.writeFile(second, replaceLaunchOptions(config, '-second'));
  await fs.writeFile(path.join(f.steamRoot, 'config', 'loginusers.vdf'), logins.replace('"MostRecent" "1"', '"MostRecent" "x"').replace('"MostRecent" "0"', '"MostRecent" "1"').replace('"MostRecent" "x"', '"MostRecent" "0"'));
  await f.run('enable'); await f.run('disable');
  assert.equal(launchOptions(await fs.readFile(f.file, 'utf8')), '-first');
  assert.equal(launchOptions(await fs.readFile(second, 'utf8')), '-second');
});

test('corrupt recovery data blocks mutation instead of losing the original option', async t => {
  const f = await fixture(t); await f.run('enable');
  const before = await fs.readFile(f.file, 'utf8');
  await fs.writeFile(path.join(f.dataRoot, 'steam-setup.json'), '{}');
  await assert.rejects(f.run('enable'), /backup is unreadable/);
  assert.equal(await fs.readFile(f.file, 'utf8'), before);
});

test('uninstall refuses edited wrappers regardless of case and wrappers with missing recovery records', async t => {
  const f = await fixture(t); await f.run('enable');
  const edited = replaceLaunchOptions(await fs.readFile(f.file, 'utf8'), managedCommand(f.installRoot, null).toLowerCase() + ' -changed');
  await fs.writeFile(f.file, edited);
  await assert.rejects(f.run('disable'), /changed after setup/);
  await fs.unlink(path.join(f.dataRoot, 'steam-setup.json'));
  await assert.rejects(f.run('disable'), /backup is missing/);
  assert.equal(await fs.readFile(f.file, 'utf8'), edited);
});

test('simultaneous or interrupted setup lock prevents writes', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.dataRoot); await fs.writeFile(path.join(f.dataRoot, 'steam-setup.lock'), '1');
  await assert.rejects(f.run('enable'), /running or was interrupted/);
  assert.equal(await fs.readFile(f.file, 'utf8'), config);
});
