// Self-contained factory, shared by the real injected UI and the offline preview.
export function createProfileController(adapter, rpc, options = {}) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const contextKey = context => context ? JSON.stringify([context.accountId, context.characterId]) : '';
  let accountKey = '', loadingKey = '', destroyed = false, busy = false, error = '', warning = '';
  let data = { names: [], profiles: [], canRestore: false, pending: false };
  let state = { ready: false, visible: false };
  let view = { ...state, ...data, busy: false, error: '', anchor: null };
  const listeners = new Set();
  let lastSerialized = '';

  function emit() {
    view = { ready: state.ready, visible: state.visible, context: state.context, selected: state.selected, slotCount: state.slotCount, capacity: state.capacity, ...data, busy, error: error || warning || (!state.ready ? state.error : ''), anchor: state.ready && state.visible ? adapter.getAnchor() : null };
    // Never leave another character's names visible while fetching its assignments.
    view.ready = Boolean(state.ready && accountKey === contextKey(state.context));
    const serialized = JSON.stringify(view);
    if (serialized !== lastSerialized) {
      lastSerialized = serialized;
      listeners.forEach(listener => listener(clone(view)));
    }
  }

  function accept(result, expectedKey) {
    if (destroyed || contextKey(adapter.getState().context) !== expectedKey) return;
    data = result;
    warning = result.warning || '';
    accountKey = expectedKey;
    state = adapter.getState();
    emit();
  }

  async function refresh() {
    if (destroyed) return;
    state = adapter.getState();
    const key = contextKey(state.context);
    if (state.ready && key !== accountKey && loadingKey !== key && !busy) {
      loadingKey = key;
      error = '';
      try { accept(await rpc('getAccount', { snapshot: state }), key); }
      catch (failure) { if (contextKey(adapter.getState().context) === key) error = failure.message || String(failure); }
      finally { if (loadingKey === key) loadingKey = ''; }
    }
    emit();
  }

  function capture() {
    const snapshot = adapter.getState();
    if (!snapshot.ready || !snapshot.visible) throw new Error(snapshot.error || 'Open the Cards panel first.');
    if (accountKey !== contextKey(snapshot.context)) throw new Error('Character names are still loading. Try again in a moment.');
    return clone(snapshot);
  }

  async function run(action) {
    if (destroyed) throw new Error('The add-on is disconnected.');
    if (busy) throw new Error('Wait for the current operation to finish.');
    busy = true; error = ''; emit();
    try { return await action(); }
    catch (failure) { error = failure.message || String(failure); throw failure; }
    finally { busy = false; await refresh(); }
  }

  async function load(profileId, restore = false) {
    return run(async () => {
      const before = capture();
      const key = contextKey(before.context);
      const prepared = await rpc('prepareLoad', { snapshot: before, profileId, restore });
      let applied = false;
      try {
        adapter.validate(prepared.presets, before);
        const after = adapter.apply(prepared.presets, before);
        applied = true;
        if (!equal(after.cardSet, before.cardSet)) throw new Error('The card-set bonus changed unexpectedly.');
        const result = await rpc('finishLoad', { snapshot: after, transactionId: prepared.transactionId });
        accept(result, key);
      } catch (failure) {
        // A lost acknowledgement does not mean the storage commit failed.
        if (applied) {
          try {
            const current = adapter.getState();
            if (current.ready && contextKey(current.context) === key && equal(current.presets, prepared.presets)) {
              const reconciled = await rpc('getAccount', { snapshot: current });
              if (!reconciled.pending && equal(reconciled.names, prepared.names)) { accept(reconciled, key); return; }
            }
          } catch { /* The explicit rollback below keeps the durable recovery record. */ }
        }
        let recoveryError = null;
        try {
          let current = adapter.getState();
          if (applied) {
            if (!current.ready || contextKey(current.context) !== key) throw new Error('The character changed before recovery could run.');
            current = adapter.apply(before.presets, current);
          }
          if (!current.ready || contextKey(current.context) !== key || !equal(current.presets, before.presets)) throw new Error('The previous game setup could not be verified.');
          const result = await rpc('cancelLoad', { snapshot: current, transactionId: prepared.transactionId });
          accept(result, key);
        } catch (rollbackFailure) { recoveryError = rollbackFailure; }
        if (recoveryError) throw new Error(`${failure.message} Recovery is still pending: ${recoveryError.message}. The backup is preserved; do not retry another load yet.`);
        throw failure;
      }
    });
  }

  const timer = setInterval(() => { refresh().catch(() => {}); }, options.pollMs ?? 180);
  refresh().catch(() => {});
  return {
    getView: () => clone(view),
    cardLabel: id => adapter.cardLabel?.(id) || id,
    renderName: (canvas, text, settings) => adapter.renderName?.(canvas, text, settings) ?? false,
    subscribe(listener) { listeners.add(listener); listener(clone(view)); return () => listeners.delete(listener); },
    refresh,
    rename(name, context, slot) {
      return run(async () => {
        const snapshot = capture();
        if (contextKey(snapshot.context) !== contextKey(context) || snapshot.selected !== slot) throw new Error('The selected character or preset changed. The edit was cancelled.');
        adapter.validateName?.(name.trim());
        accept(await rpc('rename', { snapshot, slot, name }), contextKey(snapshot.context));
      });
    },
    saveProfile(title, profileId = null) {
      return run(async () => {
        const snapshot = capture();
        accept(await rpc('saveProfile', { snapshot, title, profileId }), contextKey(snapshot.context));
      });
    },
    deleteProfile(profileId) {
      return run(async () => {
        const snapshot = capture();
        accept(await rpc('deleteProfile', { snapshot, profileId }), contextKey(snapshot.context));
      });
    },
    loadProfile: id => load(id, false),
    restore: () => load(null, true),
    exportLibrary() { return run(() => rpc('exportLibrary', { snapshot: capture() })); },
    importLibrary(text) {
      return run(async () => {
        const snapshot = capture();
        accept(await rpc('importLibrary', { snapshot, text }), contextKey(snapshot.context));
      });
    },
    destroy() { destroyed = true; clearInterval(timer); listeners.clear(); adapter.destroy?.(); }
  };
}

// This bridge uses CDP bindings instead of exposing a local HTTP account API.
export function createRuntimeRpc(options = {}) {
  const pending = new Map();
  let sequence = 0;
  let closed = false;
  const prefix = Math.random().toString(36).slice(2);
  const previous = window.__idleonCardProfilesReply;
  window.__idleonCardProfilesReply = (id, response) => {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer); pending.delete(id);
    if (response?.ok) entry.resolve(response.result);
    else entry.reject(new Error(response?.error || 'The profile helper could not complete the operation.'));
  };
  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('The profile helper is disconnected.')); return; }
    if (typeof window.__idleonCardProfilesRequest !== 'function') { reject(new Error('The profile helper is not available.')); return; }
    const id = `${prefix}-${++sequence}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The profile helper did not respond. Check that it is still running.')); }, options.timeoutMs ?? 15000);
    pending.set(id, { resolve, reject, timer });
    try { window.__idleonCardProfilesRequest(JSON.stringify({ id, method, params })); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  rpc.destroy = () => {
    closed = true;
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('The profile helper disconnected.')); }
    pending.clear();
    if (previous === undefined) delete window.__idleonCardProfilesReply; else window.__idleonCardProfilesReply = previous;
  };
  return rpc;
}
