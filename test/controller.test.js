import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProfileController } from '../src/controller.js';
import { ProfileStore } from '../src/store.js';

async function setup(t, rpcDecorator = fn => fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'idleon-controller-'));
  const store = await new ProfileStore(directory).open();
  let current = { ready: true, visible: true, context: { accountId: 'demo', characterId: '0:first', characterName: 'First' }, selected: 0, capacity: 4, slotCount: 2, cardSet: { forest: 1 }, presets: Array.from({ length: 7 }, () => Array(12).fill('B')) };
  let shouldFail = false;
  const adapter = {
    getState: () => structuredClone(current), getAnchor: () => ({ left: 0, top: 0, width: 253, height: 20, scale: 1 }),
    validate() {},
    apply(bank, expected) { if (shouldFail) throw new Error('Native refresh failed'); assert.deepEqual(current, expected); current.presets = structuredClone(bank); return this.getState(); },
    destroy() {},
  };
  const controller = createProfileController(adapter, rpcDecorator((method, params) => store.dispatch(method, params)), { pollMs: 60000 });
  await controller.refresh();
  for (let i = 0; i < 20 && !controller.getView().ready; i++) await new Promise(resolve => setTimeout(resolve, 2));
  t.after(async () => { controller.destroy(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { controller, store, adapter, change(fn) { fn(current); }, failApply(value) { shouldFail = value; } };
}

test('controller applies all names/cards and leaves card set and selection intact', async t => {
  const { controller, adapter, change } = await setup(t);
  await controller.rename('Bossing', adapter.getState().context, 0);
  change(state => { state.presets[0][0] = 'frog'; });
  await controller.saveProfile('General');
  const profile = controller.getView().profiles[0];
  change(state => { state.context = { ...state.context, characterId: '1:second', characterName: 'Second' }; state.selected = 1; state.presets[0][0] = 'slime'; });
  await controller.refresh();
  assert.equal(controller.getView().names[0], '');
  await controller.loadProfile(profile.id);
  assert.equal(controller.getView().names[0], 'Bossing'); assert.equal(adapter.getState().presets[0][0], 'frog');
  assert.equal(adapter.getState().selected, 1); assert.deepEqual(adapter.getState().cardSet, { forest: 1 });
  await controller.restore(); assert.equal(controller.getView().names[0], ''); assert.equal(adapter.getState().presets[0][0], 'slime');
});

test('stale edit is rejected when the active character or preset changes', async t => {
  const { controller, adapter, change } = await setup(t); const before = adapter.getState();
  change(state => { state.selected = 1; });
  await assert.rejects(controller.rename('Wrong slot', before.context, before.selected), /cancelled/);
  assert.deepEqual(controller.getView().names, ['', '']);
});

test('failed game application cancels durable load and retains original names', async t => {
  const { controller, adapter, failApply, change } = await setup(t);
  await controller.rename('Saved', adapter.getState().context, 0); await controller.saveProfile('Target');
  const profile = controller.getView().profiles[0];
  await controller.rename('Before', adapter.getState().context, 0); change(state => { state.presets[0][0] = 'frog'; });
  failApply(true); await assert.rejects(controller.loadProfile(profile.id), /Native refresh failed/);
  assert.equal(controller.getView().names[0], 'Before'); assert.equal(controller.getView().pending, false);
});

test('lost storage acknowledgement reconciles committed load without undoing cards', async t => {
  const { controller, adapter, change } = await setup(t, dispatch => async (method, params) => { const result = await dispatch(method, params); if (method === 'finishLoad') throw new Error('Lost reply'); return result; });
  change(state => { state.presets[0][0] = 'frog'; });
  await controller.rename('Saved', adapter.getState().context, 0); await controller.saveProfile('Target');
  const profile = controller.getView().profiles[0];
  change(state => { state.presets[0][0] = 'slime'; }); await controller.rename('Before', adapter.getState().context, 0);
  await controller.loadProfile(profile.id);
  assert.equal(controller.getView().names[0], 'Saved'); assert.equal(adapter.getState().presets[0][0], 'frog');
});

test('factory is serializable for injection and exposed views omit private game arrays', async t => {
  const { controller } = await setup(t);
  assert.equal(typeof (0, eval)(`(${createProfileController.toString()})`), 'function');
  assert.equal(Object.hasOwn(controller.getView(), 'presets'), false);
});
