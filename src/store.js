import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SCHEMA_VERSION, copy, contextKeys, normalizeName, portableProfile, validateProfile, validateBank, validateSnapshot, mergeProfile, recoverySnapshot, sameBank, parseLibrary } from './model.js';

const empty = () => ({ schemaVersion: SCHEMA_VERSION, revision: 0, accounts: {} });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function checkRecovery(item) {
  if (item === null) return;
  if (!object(item) || !Number.isInteger(item.slotCount) || item.slotCount < 2 || item.slotCount > 7 || !Number.isInteger(item.capacity) || item.capacity < 4 || item.capacity > 8) throw new Error('Invalid recovery data.');
  validateBank(item.presets);
  if (!Array.isArray(item.names) || item.names.length !== item.slotCount) throw new Error('Invalid recovery names.');
  item.names.forEach(normalizeName);
}
function checkDatabase(db) {
  if (!object(db) || db.schemaVersion !== SCHEMA_VERSION || !Number.isInteger(db.revision) || !object(db.accounts)) throw new Error('Unsupported storage format.');
  for (const [key, account] of Object.entries(db.accounts)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !object(account) || !object(account.characters) || !Array.isArray(account.profiles) || account.profiles.length > 500) throw new Error('Invalid account storage.');
    account.profiles.forEach(validateProfile);
    for (const [characterKey, char] of Object.entries(account.characters)) {
      if (!/^[a-f0-9]{64}$/.test(characterKey) || !object(char) || !Array.isArray(char.names) || char.names.length > 7) throw new Error('Invalid character storage.');
      char.names.forEach(normalizeName);
      checkRecovery(char.recovery);
      if (char.pending !== null) {
        if (!object(char.pending) || typeof char.pending.id !== 'string') throw new Error('Invalid pending load.');
        checkRecovery(char.pending.previous);
        checkRecovery(char.pending.previousRecovery);
        validateBank(char.pending.targetPresets);
        if (!Array.isArray(char.pending.targetNames)) throw new Error('Invalid pending names.');
        char.pending.targetNames.forEach(normalizeName);
      }
    }
  }
  return db;
}

export class ProfileStore {
  constructor(directory, options = {}) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, 'profiles.json');
    this.backup = `${this.file}.bak`;
    this.lockFile = path.join(this.directory, 'helper.lock');
    this.db = empty();
    this.queue = Promise.resolve();
    this.options = options;
    this.recoveredFromBackup = false;
    this.closed = false;
  }

  async open() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      this.lock = await fs.open(this.lockFile, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(await fs.readFile(this.lockFile, 'utf8')); } catch { throw new Error('Storage is locked. Check that another helper is not running before removing helper.lock.'); }
      if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('Invalid storage lock; refusing to overwrite it.');
      try { process.kill(owner.pid, 0); throw new Error('Another profile helper is already using this storage.'); }
      catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      await fs.unlink(this.lockFile);
      this.lock = await fs.open(this.lockFile, 'wx');
    }
    await this.lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    try {
      let primary;
      try { primary = await fs.readFile(this.file, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (primary !== undefined) {
        try { this.db = checkDatabase(JSON.parse(primary)); }
        catch (error) {
          try { this.db = checkDatabase(JSON.parse(await fs.readFile(this.backup, 'utf8'))); this.recoveredFromBackup = true; }
          catch { throw new Error(`Profile storage could not be read and no valid backup exists. The files were preserved. ${error.message}`); }
        }
      } else {
        // A missing primary with an existing backup should not discard the library.
        try { this.db = checkDatabase(JSON.parse(await fs.readFile(this.backup, 'utf8'))); this.recoveredFromBackup = true; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      return this;
    } catch (error) { await this.close(); throw error; }
  }

  async persist(db) {
    checkDatabase(db);
    const temp = `${this.file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temp, 'wx');
      await handle.writeFile(`${JSON.stringify(db, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      if (this.options.beforeReplace) await this.options.beforeReplace(db);
      // Back up the last validated in-memory state, never a possibly corrupt primary.
      const backupTemp = `${this.backup}.${randomUUID()}.tmp`;
      try {
        const backupHandle = await fs.open(backupTemp, 'wx');
        try { await backupHandle.writeFile(`${JSON.stringify(this.db, null, 2)}\n`, 'utf8'); await backupHandle.sync(); }
        finally { await backupHandle.close(); }
        await fs.rename(backupTemp, this.backup);
      } finally { await fs.unlink(backupTemp).catch(() => {}); }
      await fs.rename(temp, this.file);
      this.recoveredFromBackup = false;
    } finally {
      if (handle) await handle.close();
      await fs.unlink(temp).catch(() => {});
    }
  }

  mutate(fn) {
    const run = this.queue.then(async () => {
      if (this.closed) throw new Error('Profile storage is closed.');
      const next = copy(this.db);
      const result = await fn(next);
      next.revision += 1;
      await this.persist(next);
      this.db = next;
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  character(db, context) {
    const keys = contextKeys(context);
    const account = db.accounts[keys.account] ??= { characters: {}, profiles: [] };
    const char = account.characters[keys.character] ??= { displayName: context.characterName, names: [], recovery: null, pending: null };
    char.displayName = context.characterName;
    return { account, char };
  }

  view(db, snapshot) {
    const { account, char } = this.character(db, snapshot.context);
    return {
      names: Array.from({ length: snapshot.slotCount }, (_, i) => char.names[i] ?? ''),
      profiles: copy(account.profiles), canRestore: Boolean(char.recovery || char.pending),
      pending: Boolean(char.pending),
      warning: char.pending ? 'An interrupted load needs recovery. Use Restore previous setup before making more changes.' : this.recoveredFromBackup ? 'Storage was recovered from its backup.' : null,
    };
  }

  async getAccount({ snapshot }) {
    validateSnapshot(snapshot);
    await this.queue;
    const { char } = this.character(this.db, snapshot.context);
    const pending = char.pending;
    if (pending && (sameBank(snapshot.presets, pending.previous.presets) || (!pending.resolving && sameBank(snapshot.presets, pending.targetPresets)))) {
      await this.mutate(db => {
        const { char } = this.character(db, snapshot.context);
        if (!char.pending || char.pending.id !== pending.id) return;
        const loaded = !pending.resolving && sameBank(snapshot.presets, pending.targetPresets);
        char.names = copy(loaded ? pending.targetNames : pending.previous.names);
        char.recovery = copy(loaded ? pending.previous : pending.previousRecovery);
        char.pending = null;
      });
    }
    return this.view(this.db, snapshot);
  }

  async rename({ snapshot, slot, name }) {
    validateSnapshot(snapshot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= snapshot.slotCount) throw new Error('That preset is not available.');
    const normalized = normalizeName(name);
    await this.mutate(db => {
      const { char } = this.character(db, snapshot.context);
      if (char.pending) throw new Error('Restore the interrupted load before renaming presets.');
      char.names = Array.from({ length: snapshot.slotCount }, (_, i) => char.names[i] ?? '');
      char.names[slot] = normalized;
    });
    return this.view(this.db, snapshot);
  }

  async saveProfile({ snapshot, title, profileId = null }) {
    validateSnapshot(snapshot);
    await this.mutate(db => {
      const { account, char } = this.character(db, snapshot.context);
      if (char.pending) throw new Error('Restore the interrupted load before saving a profile.');
      const index = profileId === null ? -1 : account.profiles.findIndex(profile => profile.id === profileId);
      if (profileId !== null && index < 0) throw new Error('That saved profile no longer exists.');
      if (index < 0 && account.profiles.length >= 500) throw new Error('The library is full (500 profiles).');
      const profile = portableProfile(snapshot, char.names, title, profileId ?? randomUUID());
      if (index >= 0) account.profiles[index] = profile; else account.profiles.push(profile);
    });
    return this.view(this.db, snapshot);
  }

  async deleteProfile({ snapshot, profileId }) {
    validateSnapshot(snapshot);
    await this.mutate(db => {
      const { account } = this.character(db, snapshot.context);
      const index = account.profiles.findIndex(profile => profile.id === profileId);
      if (index < 0) throw new Error('That saved group no longer exists.');
      account.profiles.splice(index, 1);
    });
    return this.view(this.db, snapshot);
  }

  async prepareLoad({ snapshot, profileId, restore = false }) {
    validateSnapshot(snapshot);
    return this.mutate(db => {
      const { account, char } = this.character(db, snapshot.context);
      if (char.pending) {
        if (!restore) throw new Error('Restore the interrupted load before loading another profile.');
        const previous = char.pending.previous;
        if (previous.slotCount !== snapshot.slotCount || previous.capacity !== snapshot.capacity) throw new Error('The recovery snapshot no longer matches the available slots.');
        char.pending.resolving = true;
        return { transactionId: char.pending.id, presets: copy(previous.presets), names: copy(previous.names) };
      }
      let target;
      if (restore) {
        if (!char.recovery) throw new Error('There is no previous setup to restore.');
        if (char.recovery.slotCount !== snapshot.slotCount || char.recovery.capacity !== snapshot.capacity) throw new Error('The previous setup no longer matches the available slots.');
        target = { presets: copy(char.recovery.presets), names: copy(char.recovery.names) };
      } else {
        const profile = account.profiles.find(profile => profile.id === profileId);
        if (!profile) throw new Error('Choose a saved profile.');
        target = mergeProfile(profile, snapshot);
      }
      const names = Array.from({ length: snapshot.slotCount }, (_, i) => char.names[i] ?? '');
      const previous = recoverySnapshot(snapshot, names);
      const id = randomUUID();
      char.pending = { id, previous, previousRecovery: copy(char.recovery), targetPresets: copy(target.presets), targetNames: copy(target.names), resolving: false };
      char.recovery = previous;
      return { transactionId: id, ...copy(target) };
    });
  }

  async finishLoad({ snapshot, transactionId }) {
    validateSnapshot(snapshot);
    await this.mutate(db => {
      const { char } = this.character(db, snapshot.context);
      const pending = char.pending;
      if (!pending || pending.id !== transactionId) throw new Error('The pending load could not be found.');
      const expected = pending.resolving ? pending.previous.presets : pending.targetPresets;
      if (!sameBank(snapshot.presets, expected)) throw new Error('The game did not retain the complete loaded setup.');
      char.names = copy(pending.resolving ? pending.previous.names : pending.targetNames);
      if (pending.resolving) char.recovery = copy(pending.previousRecovery);
      char.lastCommitted = copy(pending);
      char.pending = null;
    });
    return this.view(this.db, snapshot);
  }

  async cancelLoad({ snapshot, transactionId }) {
    validateSnapshot(snapshot);
    await this.mutate(db => {
      const { char } = this.character(db, snapshot.context);
      const pending = char.pending ?? (char.lastCommitted?.id === transactionId ? char.lastCommitted : null);
      if (!pending || pending.id !== transactionId) return;
      if (pending.resolving) { pending.resolving = false; return; }
      if (!sameBank(snapshot.presets, pending.previous.presets)) throw new Error('Recovery remains pending because the game state could not be restored.');
      char.names = copy(pending.previous.names);
      char.recovery = copy(pending.previousRecovery);
      char.pending = null;
      char.lastCommitted = null;
    });
    return this.view(this.db, snapshot);
  }

  async exportLibrary({ snapshot }) {
    validateSnapshot(snapshot); await this.queue;
    const { account } = this.character(this.db, snapshot.context);
    return `${JSON.stringify({ format: 'idleon-card-profiles', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), profiles: account.profiles }, null, 2)}\n`;
  }

  async importLibrary({ snapshot, text }) {
    validateSnapshot(snapshot);
    const imported = parseLibrary(text);
    await this.mutate(db => {
      const { account } = this.character(db, snapshot.context);
      if (account.profiles.length + imported.length > 500) throw new Error('Import would exceed the 500-profile library limit.');
      account.profiles.push(...imported);
    });
    return this.view(this.db, snapshot);
  }

  async dispatch(method, params) {
    if (!object(params)) throw new Error('Invalid add-on request.');
    switch (method) {
      case 'getAccount': return this.getAccount(params);
      case 'rename': return this.rename(params);
      case 'saveProfile': return this.saveProfile(params);
      case 'deleteProfile': return this.deleteProfile(params);
      case 'prepareLoad': return this.prepareLoad(params);
      case 'finishLoad': return this.finishLoad(params);
      case 'cancelLoad': return this.cancelLoad(params);
      case 'exportLibrary': return this.exportLibrary(params);
      case 'importLibrary': return this.importLibrary(params);
      default: throw new Error('Unknown add-on operation.');
    }
  }

  async close() {
    await this.queue;
    this.closed = true;
    if (this.lock) { await this.lock.close(); this.lock = null; await fs.unlink(this.lockFile).catch(() => {}); }
  }
}
