import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installWindowClose } from '../src/window-close.js';

const BINDING = '__idleonCardProfilesWindowClosing';
const WORLD = 'idleon-card-profiles-close';
const SHELL_URL = 'file:///game/distBuild/app.html';

function fixture() {
  const listeners = new Map(), scopes = new Map(), calls = [];
  let script;
  let binding;
  const emit = (event, value) => { for (const listener of listeners.get(event) || []) listener(value); };
  const createContext = (id, { name = WORLD, frameId = 'shell', url = SHELL_URL, isDefault = false } = {}) => {
    const scope = { URL, location: { href: url }, click: null, unload: null };
    scope.window = {
      addEventListener(type, callback) { assert.equal(type, 'beforeunload'); scope.unload = callback; },
      removeEventListener(_type, callback) { if (scope.unload === callback) scope.unload = null; },
    };
    scope.window.top = frameId === 'shell' ? scope.window : {};
    scope.document = {
      addEventListener(type, callback, capture) { assert.equal(type, 'click'); assert.equal(capture, true); scope.click = callback; },
      removeEventListener(_type, callback) { if (scope.click === callback) scope.click = null; },
    };
    if (binding?.executionContextName === name) scope.window[BINDING] = payload => emit('Runtime.bindingCalled', { name: BINDING, executionContextId: id, payload });
    scopes.set(id, scope);
    emit('Runtime.executionContextCreated', { context: { id, name, auxData: { frameId, isDefault } } });
    return scope;
  };
  const client = {
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
      return () => listeners.get(event).delete(callback);
    },
    async send(method, params) {
      calls.push({ method, params });
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'shell', url: SHELL_URL } } };
      if (method === 'Runtime.addBinding') binding = params;
      if (method === 'Page.addScriptToEvaluateOnNewDocument') { script = params; return { identifier: 'observer-script' }; }
      if (method === 'Page.removeScriptToEvaluateOnNewDocument') script = undefined;
      if (method === 'Runtime.removeBinding') { binding = undefined; for (const scope of scopes.values()) delete scope.window[BINDING]; }
      if (method === 'Page.createIsolatedWorld') { createContext(7); return { executionContextId: 7 }; }
      if (method === 'Runtime.evaluate') vm.runInNewContext(params.expression, scopes.get(params.contextId));
      return {};
    },
  };
  return {
    client, calls, listeners, scopes, emit, createContext,
    reload(id = 8, options) {
      emit('Runtime.executionContextsCleared', {});
      scopes.clear();
      emit('Page.frameNavigated', { frame: { id: 'shell', url: options?.url || SHELL_URL } });
      const scope = createContext(id, options);
      if (script) vm.runInNewContext(script.source, scope);
      return scope;
    },
  };
}

const closeClick = {
  target: { closest: selector => selector === 'button.closeButton' },
  preventDefault() { assert.fail('Must preserve native close'); },
  stopPropagation() { assert.fail('Must preserve native click'); },
  stopImmediatePropagation() { assert.fail('Must preserve native click'); },
};

test('initial shell navigation finishes before any close handlers are installed', async () => {
  const f = fixture();
  const originalSend = f.client.send;
  let polls = 0;
  f.client.send = async (method, params) => {
    if (method === 'Page.getFrameTree' && polls++ === 0) return { frameTree: { frame: { id: 'shell', url: 'about:blank' } } };
    return originalSend(method, params);
  };
  const cleanup = await installWindowClose(f.client, () => {});
  assert.equal(polls, 2);
  assert.ok(f.scopes.get(7).click);
  await cleanup();
});

for (const trigger of ['click', 'unload']) test(`${trigger} releases helper once without cancelling native close`, async () => {
  const f = fixture(); let closes = 0;
  const cleanup = await installWindowClose(f.client, () => { closes++; });
  const scope = f.scopes.get(7);
  scope.click({ target: { closest: () => null } });
  await Promise.resolve(); assert.equal(closes, 0);
  if (trigger === 'unload') scope.unload();
  scope.click(closeClick); scope.click(closeClick);
  await Promise.resolve(); assert.equal(closes, 1);
  await cleanup(); assert.equal(scope.click, null); assert.equal(scope.unload, null);
});

test('deferred unload ignores startup reload and a recreated world still observes X', async () => {
  const f = fixture(); let closes = 0;
  const cleanup = await installWindowClose(f.client, () => { closes++; }, { deferUnload: true });
  f.scopes.get(7).unload();
  const next = f.reload();
  next.unload();
  await Promise.resolve(); assert.equal(closes, 0);
  next.click(closeClick);
  await Promise.resolve(); assert.equal(closes, 1);
  await cleanup();
});

test('arming unload enables normal window exit after startup and reload', async () => {
  const f = fixture(); let closes = 0;
  const cleanup = await installWindowClose(f.client, () => { closes++; }, { deferUnload: true });
  const next = f.reload();
  next.unload(); await Promise.resolve(); assert.equal(closes, 0);
  cleanup.armUnload();
  next.unload(); await Promise.resolve(); assert.equal(closes, 1);
  await cleanup();
});

test('rejects stale, default, unrelated world, and child frame binding contexts', async () => {
  const f = fixture(); let closes = 0;
  const cleanup = await installWindowClose(f.client, () => { closes++; });
  f.reload(8);
  f.createContext(9, { name: 'unrelated' });
  f.createContext(10, { frameId: 'child' });
  f.createContext(11, { isDefault: true });
  f.createContext(12);
  f.emit('Runtime.executionContextDestroyed', { executionContextId: 12 });
  for (const id of [7, 9, 10, 11, 12, 99]) f.emit('Runtime.bindingCalled', { name: BINDING, executionContextId: id, payload: 'close' });
  await Promise.resolve(); assert.equal(closes, 0);
  f.scopes.get(8).click(closeClick);
  await Promise.resolve(); assert.equal(closes, 1);
  await cleanup();
});

test('top frame navigation away from verified shell cannot request shutdown', async () => {
  const f = fixture(); let closes = 0;
  const cleanup = await installWindowClose(f.client, () => { closes++; });
  const other = f.reload(8, { url: 'file:///other/app.html' });
  assert.equal(other.click, null);
  f.emit('Runtime.bindingCalled', { name: BINDING, executionContextId: 8, payload: 'close' });
  await Promise.resolve(); assert.equal(closes, 0);
  await cleanup();
});

test('cleanup removes current handlers, subscriptions, binding, and future document script', async () => {
  const f = fixture(); let closes = 0;
  const cleanup = await installWindowClose(f.client, () => { closes++; }, { deferUnload: true });
  const next = f.reload();
  await cleanup(); await cleanup(); cleanup.armUnload();
  assert.equal(next.click, null); assert.equal(next.unload, null);
  assert.equal([...f.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
  assert.equal(f.calls.filter(call => call.method === 'Page.removeScriptToEvaluateOnNewDocument').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'Runtime.removeBinding').length, 1);
  assert.equal(f.reload(9).click, null);
  f.emit('Runtime.bindingCalled', { name: BINDING, executionContextId: 8, payload: 'unload' });
  await Promise.resolve(); assert.equal(closes, 0);
});
