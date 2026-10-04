import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { patchBundle, installAddonSession, SUPPORTED_BUNDLE_HASH, REQUEST_BINDING, MAX_RPC_PAYLOAD_CHARS } from '../src/injector.js';
import { discoverInstallation, readInstalledBundle } from '../src/steam.js';

const hash = source => createHash('sha256').update(source).digest('hex');
class MockClient {
  constructor(source = 'unsupported fixture') { this.source = source; this.calls = []; this.events = new Map(); }
  on(name, fn) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(fn);
    return () => this.events.get(name).delete(fn);
  }
  async emit(name, event) { await Promise.all([...(this.events.get(name) || [])].map(fn => fn(event))); }
  async send(method, params = {}) {
    this.calls.push({ method, params });
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'app-frame', url: 'file:///game/distBuild/app.html' }, childFrames: [
      { frame: { id: 'game-frame', url: 'file:///game/distBuild/static/game/index.html' } },
      { frame: { id: 'other-frame', url: 'about:blank' } },
    ] } };
    if (method === 'Runtime.enable') await this.emit('Runtime.executionContextCreated', { context: { id: 7, auxData: { frameId: 'game-frame', isDefault: true } } });
    if (method === 'Fetch.getResponseBody') return { body: this.source, base64Encoded: false };
    if (method === 'Runtime.evaluate') return { result: { value: true } };
    return {};
  }
  close() { this.closed = true; }
}
const request = (changes = {}) => ({ requestId: 'request-1', frameId: 'game-frame', resourceType: 'Script',
  request: { url: 'file:///game/N.js' }, responseStatusCode: 200,
  responseHeaders: [{ name: 'Content-Encoding', value: 'gzip' }, { name: 'ETag', value: 'old' }], ...changes });
const setup = (client, extra = {}) => installAddonSession({ client, browserSource: 'window.fixtureAddon=true;', onRpc: async () => null, ...extra });

test('only the exact hash and unique root can be patched', () => {
  const source = 'var $game={};$game.ApplicationMain = {};';
  assert.throws(() => patchBundle(source), /Unsupported/);
  const patched = patchBundle(source, hash(source));
  const window = { addEventListener() {} };
  vm.runInNewContext(patched, { window });
  assert.deepEqual(Object.keys(window.__idleonCardProfilesGame), ['ApplicationMain']);
  const ambiguous = 'x.ApplicationMain = {}; y.ApplicationMain = {};';
  assert.throws(() => patchBundle(ambiguous, hash(ambiguous)), /uniquely/);
});

test('early keyboard capture routes editing actions while preserving native text defaults', () => {
  const source = 'var g={};g.ApplicationMain = {};';
  const registrations = [];
  const window = { addEventListener: (...args) => registrations.push(args) };
  vm.runInNewContext(patchBundle(source, hash(source)), { window });
  assert.deepEqual(registrations.map(item => item[0]), ['keydown', 'keyup', 'keypress', 'blur']);
  assert.ok(registrations.every(item => item[2] === true));
  let stopped = 0;
  let handled = 0;
  let defaultsPrevented = 0;
  const event = { stopImmediatePropagation: () => stopped++, preventDefault: () => defaultsPrevented++ };
  registrations[0][1](event);
  assert.equal(stopped, 0);
  window.__idleonCardProfilesInputActive = true;
  window.__idleonCardProfilesHandleInput = () => handled++;
  registrations[0][1](event);
  assert.equal(handled, 1);
  assert.equal(stopped, 1);
  assert.equal(defaultsPrevented, 0);
});

test('a real release for a key held before editing reaches the game while new typing remains isolated', () => {
  const source = 'var g={};g.ApplicationMain = {};';
  const handlers = new Map();
  const window = { addEventListener: (type, handler) => handlers.set(type, handler) };
  vm.runInNewContext(patchBundle(source, hash(source)), { window });
  let handled = 0;
  window.__idleonCardProfilesHandleInput = () => handled++;
  const event = (type, code) => ({ type, code, stopped: false, stopImmediatePropagation() { this.stopped = true; } });
  const heldPress = event('keydown', 'ArrowRight');
  handlers.get('keydown')(heldPress);
  assert.equal(heldPress.stopped, false);
  handlers.get('blur')({ target: { tagName: 'INPUT' } });
  window.__idleonCardProfilesInputActive = true;
  const heldRelease = event('keyup', 'ArrowRight');
  handlers.get('keyup')(heldRelease);
  assert.equal(heldRelease.__idleonCardProfilesPassThrough, true);
  assert.equal(heldRelease.stopped, false);
  assert.equal(handled, 0);
  const typedPress = event('keydown', 'KeyM');
  const typedRelease = event('keyup', 'KeyM');
  handlers.get('keydown')(typedPress);
  handlers.get('keyup')(typedRelease);
  assert.equal(typedPress.stopped, true);
  assert.equal(typedRelease.stopped, true);
  assert.equal(typedRelease.__idleonCardProfilesPassThrough, undefined);
  assert.equal(handled, 2);
  const repeatedRelease = event('keyup', 'ArrowRight');
  handlers.get('keyup')(repeatedRelease);
  assert.equal(repeatedRelease.stopped, true);
});

test('an editor key release stays isolated after Enter closes editing on keydown', () => {
  const source = 'var g={};g.ApplicationMain = {};';
  const handlers = new Map();
  const window = { addEventListener: (type, handler) => handlers.set(type, handler) };
  vm.runInNewContext(patchBundle(source, hash(source)), { window });
  let handled = 0;
  window.__idleonCardProfilesInputActive = true;
  window.__idleonCardProfilesHandleInput = event => {
    handled++;
    if (event.type === 'keydown' && event.code === 'Enter') window.__idleonCardProfilesInputActive = false;
  };
  const event = type => ({ type, code: 'Enter', stopped: false, stopImmediatePropagation() { this.stopped = true; } });
  const press = event('keydown');
  handlers.get('keydown')(press);
  assert.equal(press.stopped, true);
  handlers.get('blur')({ target: { tagName: 'INPUT' } });
  for (const type of ['keydown', 'keypress', 'keyup']) {
    const remaining = event(type);
    handlers.get(type)(remaining);
    assert.equal(remaining.stopped, true, `${type} from the editor must not reach the game`);
    assert.equal(remaining.__idleonCardProfilesPassThrough, undefined);
  }
  assert.equal(handled, 1);
  const newGamePress = event('keydown');
  handlers.get('keydown')(newGamePress);
  assert.equal(newGamePress.stopped, false);
  const newGameRelease = event('keyup');
  handlers.get('keyup')(newGameRelease);
  assert.equal(newGameRelease.__idleonCardProfilesPassThrough, true);
  assert.equal(newGameRelease.stopped, false);
});

test('only an actual window blur clears remembered held keys', () => {
  const source = 'var g={};g.ApplicationMain = {};';
  const handlers = new Map();
  const window = { addEventListener: (type, handler) => handlers.set(type, handler) };
  vm.runInNewContext(patchBundle(source, hash(source)), { window });
  const event = type => ({ type, code: 'ArrowRight', stopped: false, stopImmediatePropagation() { this.stopped = true; } });
  handlers.get('keydown')(event('keydown'));
  handlers.get('blur')({ target: window });
  window.__idleonCardProfilesInputActive = true;
  const release = event('keyup');
  handlers.get('keyup')(release);
  assert.equal(release.__idleonCardProfilesPassThrough, undefined);
  assert.equal(release.stopped, true);
});

test('session leaves other frames, nonbundles and failed responses untouched', async () => {
  const client = new MockClient();
  const session = await setup(client);
  assert.equal(session.frameId, 'game-frame');
  for (const changed of [{ frameId: 'other-frame' }, { request: { url: 'file:///game/OTHER.js' } }, { responseStatusCode: 404 }]) {
    await client.emit('Fetch.requestPaused', request(changed));
  }
  assert.equal(client.calls.filter(call => call.method === 'Fetch.continueRequest').length, 3);
  assert.equal(client.calls.filter(call => call.method === 'Fetch.getResponseBody').length, 0);
  assert.equal(client.calls.filter(call => call.method === 'Page.reload').length, 0);
  await session.cleanup();
  assert.equal(client.closed, true);
  assert.ok(client.calls.some(call => call.method === 'Fetch.disable'));
  assert.ok(!client.calls.some(call => ['Page.close', 'Browser.close'].includes(call.method)));
});

test('unknown build continues original request and disables addon without evaluation', async () => {
  const client = new MockClient();
  const session = await setup(client);
  await client.emit('Fetch.requestPaused', request());
  await assert.rejects(session.ready, /Unsupported Idleon bundle/);
  assert.ok(client.calls.some(call => call.method === 'Fetch.continueRequest'));
  assert.ok(!client.calls.some(call => call.method === 'Fetch.fulfillRequest' || call.method === 'Runtime.evaluate'));
  await session.cleanup();
});

test('reload requires explicit approval for a newly launched session', async () => {
  const client = new MockClient();
  await assert.rejects(setup(client, { allowReload: true }), /newly launched/);
  assert.equal(client.calls.length, 0);
  const session = await setup(client, { allowReload: true, launchedByAddon: true });
  assert.equal(client.calls.filter(call => call.method === 'Page.reload').length, 1);
  await session.cleanup();
});

test('cancellation before setup disconnects without sending setup or reload commands', async () => {
  const client = new MockClient();
  const cancellation = new AbortController();
  cancellation.abort();
  await assert.rejects(setup(client, { signal: cancellation.signal, allowReload: true, launchedByAddon: true }), { name: 'AbortError' });
  assert.deepEqual(client.calls, []);
  assert.equal(client.closed, true);
});

test('cancellation during setup cleans interception and prevents a later reload', async () => {
  const client = new MockClient();
  const cancellation = new AbortController();
  const send = client.send.bind(client);
  let releaseFetch;
  let fetchStarted;
  const started = new Promise(resolve => { fetchStarted = resolve; });
  client.send = async (method, params) => {
    const result = await send(method, params);
    if (method === 'Fetch.enable') {
      fetchStarted();
      await new Promise(resolve => { releaseFetch = resolve; });
    }
    return result;
  };
  const installing = setup(client, { signal: cancellation.signal, allowReload: true, launchedByAddon: true });
  await started;
  cancellation.abort();
  releaseFetch();
  await assert.rejects(installing, { name: 'AbortError' });
  assert.ok(client.calls.some(call => call.method === 'Fetch.disable'));
  assert.ok(client.calls.some(call => call.method === 'Runtime.removeBinding'));
  assert.ok(!client.calls.some(call => call.method === 'Page.reload'));
  assert.equal(client.closed, true);
});

test('cancellation while waiting for a game bundle rejects ready and closes only the connection', async () => {
  const client = new MockClient();
  const cancellation = new AbortController();
  const session = await setup(client, { signal: cancellation.signal });
  cancellation.abort();
  await assert.rejects(session.ready, { name: 'AbortError' });
  await session.cleanup();
  assert.equal(client.closed, true);
  assert.ok(!client.calls.some(call => ['Page.reload', 'Page.close', 'Browser.close'].includes(call.method)));
});

test('late game iframe is selected after interception is installed and refreshed on parent reload', async () => {
  const client = new MockClient();
  const send = client.send.bind(client);
  client.send = async (method, params) => method === 'Page.getFrameTree'
    ? { frameTree: { frame: { id: 'app-frame', url: 'file:///game/distBuild/app.html' } } } : send(method, params);
  const session = await setup(client);
  assert.equal(session.frameId, undefined);
  assert.ok(client.calls.some(call => call.method === 'Fetch.enable'));
  await client.emit('Page.frameNavigated', { frame: { id: 'untrusted', url: 'https://example.com/static/game/index.html' } });
  assert.equal(session.frameId, undefined);
  await client.emit('Page.frameNavigated', { frame: { id: 'game-frame', url: 'file:///game/distBuild/static/game/index.html' } });
  assert.equal(session.frameId, 'game-frame');
  await client.emit('Page.frameNavigated', { frame: { id: 'app-frame', url: 'file:///game/distBuild/app.html' } });
  assert.equal(session.frameId, undefined);
  await client.emit('Page.frameNavigated', { frame: { id: 'new-game-frame', url: 'file:///game/distBuild/static/game/index.html' } });
  assert.equal(session.frameId, 'new-game-frame');
  await session.cleanup();
});

test('unsupported or unverified execution contexts cannot invoke storage RPC', async () => {
  const client = new MockClient();
  let rpcCalls = 0;
  const session = await setup(client, { onRpc: async () => rpcCalls++ });
  await client.emit('Runtime.bindingCalled', { name: REQUEST_BINDING, executionContextId: 7,
    payload: JSON.stringify({ id: 1, method: 'save', params: {} }) });
  assert.equal(rpcCalls, 0);
  await session.cleanup();
});

test('pinned installed source is transformed and RPC replies stay in the verified frame (read-only optional fixture)', async t => {
  if (process.env.IDLEON_TEST_INSTALLED_FIXTURE !== '1') return t.skip('Set IDLEON_TEST_INSTALLED_FIXTURE=1 to read the installed ASAR without launching it.');
  let bundle;
  try { bundle = await readInstalledBundle(await discoverInstallation()); }
  catch (error) { return t.skip(`Installed fixture unavailable: ${error.message}`); }
  if (bundle.hash !== SUPPORTED_BUNDLE_HASH) return t.skip('Installed bundle is a different version.');
  const client = new MockClient(bundle.source);
  const rpc = [];
  const session = await setup(client, { onRpc: async (method, params) => { rpc.push({ method, params }); return { saved: true }; } });
  t.after(() => session.cleanup());
  await client.emit('Fetch.requestPaused', request());
  const ready = await session.ready;
  assert.equal(ready.executionContextId, 7);
  const fulfilled = client.calls.find(call => call.method === 'Fetch.fulfillRequest');
  assert.ok(fulfilled);
  assert.ok(!fulfilled.params.responseHeaders.some(header => ['etag', 'content-encoding'].includes(header.name.toLowerCase())));
  assert.match(Buffer.from(fulfilled.params.body, 'base64').toString('utf8'), /window\.__idleonCardProfilesGame=/);
  for (const executionContextId of [99, 7]) {
    await client.emit('Runtime.bindingCalled', { name: REQUEST_BINDING, executionContextId,
      payload: JSON.stringify({ id: 'request-a', method: 'save', params: { name: 'Mining' } }) });
  }
  assert.deepEqual(rpc, [{ method: 'save', params: { name: 'Mining' } }]);
  const reply = client.calls.find(call => call.method === 'Runtime.evaluate' && call.params.expression.includes('__idleonCardProfilesReply'));
  assert.equal(reply.params.contextId, 7);
  assert.match(reply.params.expression, /"ok":true/);
  assert.match(reply.params.expression, /"saved":true/);
  await client.emit('Runtime.bindingCalled', { name: REQUEST_BINDING, executionContextId: 7,
    payload: JSON.stringify({ id: 'oversized', method: 'import', params: 'x'.repeat(MAX_RPC_PAYLOAD_CHARS) }) });
  assert.equal(rpc.length, 1);
  const rejected = client.calls.find(call => call.method === 'Runtime.evaluate' && call.params.expression.includes('oversized'));
  assert.match(rejected.params.expression, /transport limit/);
});
