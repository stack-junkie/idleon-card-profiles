import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../src/store.js';
import { mergeProfile, normalizeName, parseLibrary, portableProfile } from '../src/model.js';

function snapshot(name = 'Archer', account = 'account-one') {
  return { ready: true, visible: true, context: { accountId: account, characterId: `${name}-id`, characterName: name }, selected: 1, slotCount: 3, capacity: 4, ownedCards: ['frog', 'slime', 'bean'], cardSet: { original: 1 }, presets: Array.from({ length: 7 }, (_, i) => [i === 1 ? 'frog' : 'B', 'B', 'B', 'B', 'reserved', 'B', 'B', 'B', 'B', 'B', 'B', 'B']) };
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'idleon-profiles-'));
  const store = await new ProfileStore(directory, options).open();
  t.after(async () => { await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, store };
}

test('names persist independently by account, character and preset', async t => {
  const { directory, store } = await fixture(t);
  const first = snapshot();
  await store.rename({ snapshot: first, slot: 0, name: '  Mining  ' });
  await store.rename({ snapshot: first, slot: 1, name: 'Bossing' });
  assert.deepEqual((await store.getAccount({ snapshot: first })).names, ['Mining', 'Bossing', '']);
  assert.deepEqual((await store.getAccount({ snapshot: snapshot('Mage') })).names, ['', '', '']);
  assert.deepEqual((await store.getAccount({ snapshot: snapshot('Archer', 'account-two') })).names, ['', '', '']);
  await store.close();
  const reopened = await new ProfileStore(directory).open();
  try { assert.equal((await reopened.getAccount({ snapshot: first })).names[1], 'Bossing'); }
  finally { await reopened.close(); }
});

test('shared profile replaces all unlocked slots but preserves reserved and locked data', async t => {
  const { store } = await fixture(t);
  const archer = snapshot();
  archer.presets[0] = ['frog', 'B', 'bean', 'B', ...archer.presets[0].slice(4)];
  await store.rename({ snapshot: archer, slot: 0, name: 'Accuracy' });
  await store.saveProfile({ snapshot: archer, title: 'General' });
  const mage = snapshot('Mage'); mage.presets[0][0] = 'slime'; mage.presets[0][4] = 'mage-tail'; mage.presets[5][0] = 'locked-value';
  const profile = (await store.getAccount({ snapshot: mage })).profiles[0];
  const before = structuredClone(mage.presets);
  const prepared = await store.prepareLoad({ snapshot: mage, profileId: profile.id });
  assert.deepEqual(prepared.presets[0].slice(0, 4), ['frog', 'B', 'bean', 'B']);
  assert.equal(prepared.presets[0][4], 'mage-tail');
  assert.deepEqual(prepared.presets[5], before[5]);
  const after = { ...mage, presets: prepared.presets };
  assert.equal((await store.finishLoad({ snapshot: after, transactionId: prepared.transactionId })).names[0], 'Accuracy');
  const recover = await store.prepareLoad({ snapshot: after, restore: true });
  assert.deepEqual(recover.presets, before);
  assert.deepEqual((await store.finishLoad({ snapshot: { ...mage, presets: recover.presets }, transactionId: recover.transactionId })).names, ['', '', '']);
  assert.equal((await store.getAccount({ snapshot: archer })).names[0], 'Accuracy');
});

test('saving a new profile with the same title never silently overwrites; update is explicit', async t => {
  const { store } = await fixture(t); const current = snapshot();
  await store.saveProfile({ snapshot: current, title: 'Same' });
  await store.saveProfile({ snapshot: current, title: 'Same' });
  const library = (await store.getAccount({ snapshot: current })).profiles;
  assert.equal(library.length, 2);
  await store.saveProfile({ snapshot: current, title: 'Updated', profileId: library[0].id });
  assert.equal((await store.getAccount({ snapshot: current })).profiles.length, 2);
});

test('deleting one group persists without changing character names, recovery, or other accounts', async t => {
  const { store, directory } = await fixture(t); const current = snapshot();
  await store.rename({ snapshot: current, slot: 0, name: 'Keep me' });
  await store.saveProfile({ snapshot: current, title: 'Delete me' });
  await store.saveProfile({ snapshot: current, title: 'Keep group' });
  const id = (await store.getAccount({ snapshot: current })).profiles[0].id;
  const load = await store.prepareLoad({ snapshot: current, profileId: id });
  await store.finishLoad({ snapshot: { ...current, presets: load.presets }, transactionId: load.transactionId });
  const charactersBefore = structuredClone(Object.values(store.db.accounts)[0].characters);
  await assert.rejects(store.dispatch('deleteProfile', { snapshot: snapshot('Archer', 'other-account'), profileId: id }), /no longer exists/);
  const result = await store.dispatch('deleteProfile', { snapshot: current, profileId: id });
  assert.deepEqual(result.profiles.map(profile => profile.title), ['Keep group']);
  assert.equal(result.names[0], 'Keep me'); assert.equal(result.canRestore, true);
  assert.deepEqual(Object.values(store.db.accounts)[0].characters, charactersBefore);
  await store.close(); const reopened = await new ProfileStore(directory).open();
  try { assert.deepEqual((await reopened.getAccount({ snapshot: current })).profiles.map(profile => profile.title), ['Keep group']); }
  finally { await reopened.close(); }
});

test('incompatible profile does not create a pending load or modify assignments', async t => {
  const { store } = await fixture(t); const current = snapshot();
  await store.saveProfile({ snapshot: current, title: 'Old capacity' });
  const profile = (await store.getAccount({ snapshot: current })).profiles[0];
  const upgraded = { ...current, capacity: 5 };
  await assert.rejects(store.prepareLoad({ snapshot: upgraded, profileId: profile.id }), /Nothing was loaded/);
  const state = await store.getAccount({ snapshot: upgraded });
  assert.equal(state.pending, false); assert.equal(state.canRestore, false);
});

test('cancelled apply retains previous names and backup; applied transaction recovers after restart', async t => {
  const { store, directory } = await fixture(t); const current = snapshot();
  await store.saveProfile({ snapshot: current, title: 'Saved' });
  const id = (await store.getAccount({ snapshot: current })).profiles[0].id;
  current.presets[0][0] = 'slime';
  const cancelled = await store.prepareLoad({ snapshot: current, profileId: id });
  await store.cancelLoad({ snapshot: current, transactionId: cancelled.transactionId });
  assert.equal((await store.getAccount({ snapshot: current })).pending, false);
  const prepared = await store.prepareLoad({ snapshot: current, profileId: id });
  await store.close();
  const reopened = await new ProfileStore(directory).open();
  try {
    const state = await reopened.getAccount({ snapshot: { ...current, presets: prepared.presets } });
    assert.equal(state.pending, false); assert.equal(state.canRestore, true);
  } finally { await reopened.close(); }
});

test('interrupted restore keeps its pending record until the old cards actually return', async t => {
  const { store } = await fixture(t); const current = snapshot();
  await store.rename({ snapshot: current, slot: 0, name: 'Target name' });
  await store.saveProfile({ snapshot: current, title: 'Target' });
  const id = (await store.getAccount({ snapshot: current })).profiles[0].id;
  await store.rename({ snapshot: current, slot: 0, name: 'Previous name' });
  current.presets[0][0] = 'slime';
  const prepared = await store.prepareLoad({ snapshot: current, profileId: id });
  // Make an unresolved partial state so the normal read does not auto-finalize.
  const partial = structuredClone(current); partial.presets[2][0] = 'bean';
  const recovery = await store.prepareLoad({ snapshot: partial, restore: true });
  const stillTarget = await store.getAccount({ snapshot: { ...current, presets: prepared.presets } });
  assert.equal(stillTarget.pending, true); assert.equal(stillTarget.names[0], 'Previous name');
  const restored = await store.finishLoad({ snapshot: { ...current, presets: recovery.presets }, transactionId: recovery.transactionId });
  assert.equal(restored.pending, false); assert.equal(restored.names[0], 'Previous name');
});

test('lost finish acknowledgement can roll back names as well as cards', async t => {
  const { store } = await fixture(t); const current = snapshot();
  await store.rename({ snapshot: current, slot: 0, name: 'Saved name' });
  await store.saveProfile({ snapshot: current, title: 'Saved' });
  const id = (await store.getAccount({ snapshot: current })).profiles[0].id;
  await store.rename({ snapshot: current, slot: 0, name: 'Before name' }); current.presets[0][0] = 'slime';
  const prepared = await store.prepareLoad({ snapshot: current, profileId: id });
  await store.finishLoad({ snapshot: { ...current, presets: prepared.presets }, transactionId: prepared.transactionId });
  await store.cancelLoad({ snapshot: current, transactionId: prepared.transactionId });
  assert.equal((await store.getAccount({ snapshot: current })).names[0], 'Before name');
});

test('failed disk replacement preserves the last primary and memory state', async t => {
  let fail = false;
  const { store, directory } = await fixture(t, { beforeReplace() { if (fail) throw new Error('Simulated disk failure'); } });
  const current = snapshot();
  await store.rename({ snapshot: current, slot: 0, name: 'Saved' });
  const prior = await fs.readFile(path.join(directory, 'profiles.json'), 'utf8'); fail = true;
  await assert.rejects(store.rename({ snapshot: current, slot: 0, name: 'Lost' }), /disk failure/);
  assert.equal(await fs.readFile(path.join(directory, 'profiles.json'), 'utf8'), prior);
  assert.equal((await store.getAccount({ snapshot: current })).names[0], 'Saved');
});

test('corrupt primary restores a validated backup without destroying corrupt files at open', async t => {
  const { store, directory } = await fixture(t); const current = snapshot();
  await store.rename({ snapshot: current, slot: 0, name: 'Backup value' });
  await store.rename({ snapshot: current, slot: 0, name: 'Latest value' });
  await store.close(); await fs.writeFile(path.join(directory, 'profiles.json'), '{broken');
  const reopened = await new ProfileStore(directory).open();
  try {
    assert.equal((await reopened.getAccount({ snapshot: current })).names[0], 'Backup value');
    assert.equal(await fs.readFile(path.join(directory, 'profiles.json'), 'utf8'), '{broken');
  } finally { await reopened.close(); }
});

test('two helpers cannot write the same library simultaneously', async t => {
  const { directory } = await fixture(t);
  await assert.rejects(new ProfileStore(directory).open(), /already using/);
});

test('export/import adds independent copies without account assignments or overwrite', async t => {
  const { store } = await fixture(t); const current = snapshot();
  await store.rename({ snapshot: current, slot: 0, name: 'Mining' });
  await store.saveProfile({ snapshot: current, title: 'Setup' });
  const exported = await store.exportLibrary({ snapshot: current });
  const other = snapshot('Other', 'different-account');
  const imported = await store.importLibrary({ snapshot: other, text: exported });
  assert.deepEqual(imported.names, ['', '', '']); assert.equal(imported.profiles.length, 1);
  assert.notEqual(imported.profiles[0].id, JSON.parse(exported).profiles[0].id);
  assert.ok(!exported.includes('account-one'));
  await assert.rejects(store.importLibrary({ snapshot: other, text: '{invalid' }), /valid JSON/);
  assert.equal((await store.getAccount({ snapshot: other })).profiles.length, 1);
});

test('maximum supported exported library can be imported and malformed profiles fail as a whole', () => {
  const current = snapshot(); current.slotCount = 7; current.capacity = 8;
  current.presets = Array.from({ length: 7 }, () => Array.from({ length: 12 }, (_, i) => i < 8 ? `${i}${'x'.repeat(90)}` : 'B'));
  const profiles = Array.from({ length: 500 }, (_, i) => portableProfile(current, Array(7).fill('n'.repeat(32)), `Profile ${i}`));
  const text = JSON.stringify({ format: 'idleon-card-profiles', schemaVersion: 1, profiles }, null, 2);
  assert.ok(text.length > 2 * 1024 * 1024); assert.equal(parseLibrary(text).length, 500);
  profiles[499].presets[1].cards[2] = profiles[499].presets[1].cards[0];
  assert.throws(() => parseLibrary(JSON.stringify({ format: 'idleon-card-profiles', schemaVersion: 1, profiles })), /duplicate card/);
});

test('names accept 32 Unicode codepoints and reject controls or oversized input', () => {
  assert.equal([...normalizeName('😀'.repeat(32))].length, 32);
  assert.throws(() => normalizeName('x'.repeat(33)), /32/);
  assert.throws(() => normalizeName('Mining\nBossing'), /line breaks/);
  assert.equal(normalizeName('   '), '');
});
