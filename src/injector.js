import { createHash } from 'node:crypto';

export const SUPPORTED_BUNDLE_HASH = '49a106e5ea60bd6eb3ec36173b7f43720a2805329d1fe08a4fada822c617165c';
export const REQUEST_BINDING = '__idleonCardProfilesRequest';
export const MAX_RPC_PAYLOAD_CHARS = 20 * 1024 * 1024;

// Install before the game registers keyboard capture listeners. Stopping event
// propagation preserves native input defaults while preventing game hotkeys.
const INPUT_GUARD = `;(() => {
  if (window.__idleonCardProfilesKeyboardGuard) return;
  const gamePressedKeys = new Set();
  const editorPressedKeys = new Set();
  const guard = event => {
    const key = event.code || event.keyCode || event.which || event.key;
    // The game saw these presses before editing began, so it must also see the
    // real releases. Never synthesize input or route these releases to the UI.
    if (event.type === 'keyup' && gamePressedKeys.has(key)) {
      gamePressedKeys.delete(key);
      event.__idleonCardProfilesPassThrough = true;
      return;
    }
    if (window.__idleonCardProfilesInputActive !== true) {
      // Enter/Escape can close the editor on keydown. Keep that physical key's
      // remaining events isolated until its real release, including repeats.
      if (editorPressedKeys.has(key)) {
        if (event.type === 'keyup') editorPressedKeys.delete(key);
        event.stopImmediatePropagation();
        return;
      }
      if (event.type === 'keydown') gamePressedKeys.add(key);
      return;
    }
    if (event.type === 'keydown' && !gamePressedKeys.has(key)) editorPressedKeys.add(key);
    if (event.type === 'keyup') editorPressedKeys.delete(key);
    try { window.__idleonCardProfilesHandleInput?.(event); }
    finally { event.stopImmediatePropagation(); }
  };
  for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, guard, true);
  window.addEventListener('blur', event => {
    // Capture also observes descendant inputs losing focus. Those transitions
    // must not erase keys which are still physically held in the game.
    if (event.target === window) { gamePressedKeys.clear(); editorPressedKeys.clear(); }
  }, true);
  window.__idleonCardProfilesKeyboardGuard = guard;
})();\n`;

/** Pure transform. The live installer always uses the pinned supported hash. */
export function patchBundle(source, expectedHash = SUPPORTED_BUNDLE_HASH) {
  if (typeof source !== 'string') throw new Error('Expected a UTF-8 game bundle.');
  const hash = createHash('sha256').update(source, 'utf8').digest('hex');
  if (hash !== expectedHash) throw new Error(`Unsupported Idleon bundle (${hash}). No game code was changed.`);
  const matches = [...source.matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)\.ApplicationMain\s*=/g)];
  if (matches.length !== 1) throw new Error('The supported game root was not uniquely identified.');
  const match = matches[0];
  const patched = source.slice(0, match.index) + `window.__idleonCardProfilesGame=${match[1]};`
    + source.slice(match.index);
  return INPUT_GUARD + patched;
}

function isBundleRequest(event, frameId) {
  if (!frameId) return false;
  if (event.frameId !== frameId || event.resourceType !== 'Script' || event.responseErrorReason
      || event.responseStatusCode !== 200) return false;
  try { return /(?:^|\/)N\.js$/.test(new URL(event.request.url).pathname); }
  catch { return false; }
}

function isSteamGameFrame(frame) {
  try {
    const url = new URL(frame.url);
    return url.protocol === 'file:' && /\/static\/game\/index\.html$/.test(url.pathname);
  } catch { return false; }
}

/**
 * Installs an in-memory adapter in one page/frame. Never launches or stops a
 * process. Reload requires both explicit approval and a newly launched session.
 * onRpc(method, params, { id, executionContextId }) handles local storage only.
 */
export async function installAddonSession({
  client, browserSource, onRpc, frameId: requestedFrameId,
  allowReload = false, launchedByAddon = false, initializationTimeoutMs = 60000,
  signal,
}) {
  if (!client || typeof client.send !== 'function' || typeof client.on !== 'function') throw new Error('A CDP client is required.');
  if (typeof browserSource !== 'string' || !browserSource.trim()) throw new Error('The addon browser source is required.');
  if (typeof onRpc !== 'function') throw new Error('An addon RPC handler is required.');
  if (allowReload && !launchedByAddon) throw new Error('Only a newly launched, explicitly approved addon session may reload.');
  let frameId = requestedFrameId;
  let topFrameId;
  let executionContextId;
  let verified = false;
  let injected = false;
  let injecting = false;
  let disposed = false;
  let failed = false;
  let failureError;
  let settled = false;
  let probeTimer;
  let deadline;
  let cleanupPromise;
  let abortListener;
  let bindingRequested = false;
  let fetchRequested = false;
  const subscriptions = [];
  const pendingRequests = new Set();
  const activeRpc = new Set();
  const contexts = new Map();
  const gameFrameIds = new Set();
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Callers may finish their setup before awaiting ready.
  ready.catch(() => {});
  const fail = error => {
    if (disposed || failed) return;
    failed = true;
    failureError = error;
    clearTimeout(probeTimer);
    clearTimeout(deadline);
    if (!settled) { settled = true; rejectReady(error); }
  };
  const abortError = () => {
    const error = new Error('Addon initialization was cancelled.');
    error.name = 'AbortError';
    return error;
  };
  const assertActive = () => {
    if (signal?.aborted || disposed) throw abortError();
    if (failed) throw failureError;
  };
  const setupCommand = async (method, params) => {
    assertActive();
    const result = await client.send(method, params);
    assertActive();
    return result;
  };
  const subscribe = (method, listener) => subscriptions.push(client.on(method, listener));
  const chooseContext = () => {
    executionContextId = [...contexts.values()].findLast(context => context.auxData?.frameId === frameId
      && context.auxData?.isDefault === true)?.id;
  };
  const scheduleProbe = () => {
    if (!disposed && !failed && !injected) {
      clearTimeout(probeTimer);
      probeTimer = setTimeout(() => { probe().catch(fail); }, 100);
    }
  };
  const probe = async () => {
    if (disposed || failed || injected || injecting || !verified) return;
    if (executionContextId === undefined) { chooseContext(); scheduleProbe(); return; }
    const contextId = executionContextId;
    injecting = true;
    try {
      const result = await client.send('Runtime.evaluate', {
        expression: `(() => { if (!window.__idleonCardProfilesGame) return false;\n${browserSource}\nreturn true; })()\n//# sourceURL=idleon-card-profiles-addon.js`,
        contextId, returnByValue: true, awaitPromise: true,
      });
      if (disposed || failed || contextId !== executionContextId) return;
      if (result.exceptionDetails) throw new Error(`Addon initialization failed: ${result.exceptionDetails.text || 'runtime exception'}`);
      if (result.result?.value === true) {
        injected = true;
        clearTimeout(deadline);
        if (!settled) { settled = true; resolveReady({ frameId, executionContextId }); }
      } else scheduleProbe();
    } finally { injecting = false; }
  };
  const continueRequest = async requestId => {
    try { await client.send('Fetch.continueRequest', { requestId }); }
    finally { pendingRequests.delete(requestId); }
  };
  const onRequest = async event => {
    const { requestId } = event;
    pendingRequests.add(requestId);
    if (disposed || failed || !isBundleRequest(event, frameId)) {
      await continueRequest(requestId);
      return;
    }
    try {
      const response = await client.send('Fetch.getResponseBody', { requestId });
      if (disposed) { await continueRequest(requestId); return; }
      const bytes = response.base64Encoded ? Buffer.from(response.body, 'base64') : Buffer.from(response.body, 'utf8');
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== SUPPORTED_BUNDLE_HASH) throw new Error(`Unsupported Idleon bundle (${hash}). Addon disabled.`);
      const replacement = patchBundle(bytes.toString('utf8'));
      const headers = (event.responseHeaders || []).filter(header => ![
        'content-length', 'content-encoding', 'transfer-encoding', 'etag', 'content-md5',
      ].includes(header.name.toLowerCase()));
      headers.push({ name: 'Content-Length', value: String(Buffer.byteLength(replacement, 'utf8')) });
      if (!headers.some(header => header.name.toLowerCase() === 'content-type')) {
        headers.push({ name: 'Content-Type', value: 'text/javascript; charset=utf-8' });
      }
      await client.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: headers,
        body: Buffer.from(replacement, 'utf8').toString('base64') });
      pendingRequests.delete(requestId);
      verified = true;
      scheduleProbe();
    } catch (error) {
      fail(error);
      await continueRequest(requestId);
    }
  };
  const reply = async (contextId, id, response) => {
    if (disposed || contextId !== executionContextId || !contexts.has(contextId)) return;
    await client.send('Runtime.evaluate', {
      expression: `window.__idleonCardProfilesReply?.(${JSON.stringify(id)},${JSON.stringify(response)})`,
      contextId, returnByValue: true,
    });
  };
  const onBinding = async event => {
    if (disposed || failed || !verified || event.name !== REQUEST_BINDING
        || event.executionContextId !== executionContextId || typeof event.payload !== 'string') return;
    if (event.payload.length > MAX_RPC_PAYLOAD_CHARS) {
      // Browser envelopes serialize id first. Recover only that bounded prefix,
      // avoiding a full parse of an oversized import while replying to its caller.
      const prefix = /^\s*\{\s*"id"\s*:\s*("(?:[^"\\]|\\.){0,1024}"|-?\d{1,16})\s*[,}]/.exec(event.payload.slice(0,4096));
      if (prefix) {
        try { await reply(event.executionContextId, JSON.parse(prefix[1]), { ok: false, error: 'Addon request exceeds the 20 MB transport limit.' }); }
        catch { /* Malformed identifiers cannot be replied to. */ }
      }
      return;
    }
    let request;
    try { request = JSON.parse(event.payload); } catch { return; }
    if (!request || (typeof request.id !== 'string' && !Number.isSafeInteger(request.id))
        || String(request.id).length > 128 || typeof request.method !== 'string' || request.method.length > 100) return;
    const key = `${event.executionContextId}:${typeof request.id}:${request.id}`;
    if (activeRpc.has(key)) return;
    if (activeRpc.size >= 64) {
      await reply(event.executionContextId, request.id, { ok: false, error: 'Too many pending addon requests.' });
      return;
    }
    activeRpc.add(key);
    try {
      const result = await onRpc(request.method, request.params, { id: request.id, executionContextId: event.executionContextId });
      await reply(event.executionContextId, request.id, { ok: true, result: result ?? null });
    } catch (error) {
      await reply(event.executionContextId, request.id, { ok: false, error: String(error?.message || 'Addon request failed.') });
    } finally { activeRpc.delete(key); }
  };
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    disposed = true;
    clearTimeout(probeTimer);
    clearTimeout(deadline);
    if (abortListener) signal?.removeEventListener('abort', abortListener);
    if (!settled) { settled = true; rejectReady(new Error('Addon session closed before initialization.')); }
    cleanupPromise = (async () => {
      const attempt = async (method, params) => { try { await client.send(method, params); } catch { /* Connection may already be gone. */ } };
      if (executionContextId !== undefined && verified) {
        await attempt('Runtime.evaluate', {
          expression: 'window.__idleonCardProfilesInputActive=false;window.__idleonCardProfilesCleanup?.();',
          contextId: executionContextId,
        });
      }
      await Promise.all([...pendingRequests].map(requestId => attempt('Fetch.continueRequest', { requestId })));
      if (fetchRequested) await attempt('Fetch.disable', {});
      if (bindingRequested) await attempt('Runtime.removeBinding', { name: REQUEST_BINDING });
      for (const unsubscribe of subscriptions) unsubscribe();
      client.close();
    })();
    return cleanupPromise;
  };
  abortListener = () => { fail(abortError()); cleanup().catch(() => {}); };
  try {
    assertActive();
    signal?.addEventListener('abort', abortListener, { once: true });
    subscribe('Runtime.executionContextCreated', ({ context }) => {
      contexts.set(context.id, context);
      chooseContext();
      if (verified) scheduleProbe();
    });
    subscribe('Runtime.executionContextDestroyed', ({ executionContextId: id }) => {
      contexts.delete(id);
      if (executionContextId === id) { executionContextId = undefined; injected = false; }
    });
    subscribe('Runtime.executionContextsCleared', () => { contexts.clear(); executionContextId = undefined; injected = false; });
    subscribe('Page.frameNavigated', ({ frame }) => {
      if (!requestedFrameId && frame.id === topFrameId) {
        gameFrameIds.clear(); frameId = undefined; verified = false; injected = false; executionContextId = undefined;
      }
      if (!requestedFrameId && isSteamGameFrame(frame)) {
        gameFrameIds.add(frame.id);
        if (gameFrameIds.size > 1) { fail(new Error('More than one Idleon game frame exists in this target.')); return; }
        frameId = frame.id; chooseContext();
      }
      if (frame.id === frameId) { verified = false; injected = false; }
    });
    subscribe('Page.frameDetached', ({ frameId: detachedId }) => {
      gameFrameIds.delete(detachedId);
      if (frameId === detachedId) {
        frameId = undefined; executionContextId = undefined; verified = false; injected = false;
      }
    });
    subscribe('Fetch.requestPaused', event => onRequest(event).catch(fail));
    subscribe('Runtime.bindingCalled', event => onBinding(event).catch(fail));
    subscribe('disconnect', () => fail(new Error('The game debugger disconnected.')));
    await setupCommand('Page.enable');
    const { frameTree } = await setupCommand('Page.getFrameTree');
    topFrameId = frameTree.frame.id;
    const frames = [];
    const visit = tree => { frames.push(tree.frame); for (const child of tree.childFrames || []) visit(child); };
    visit(frameTree);
    if (requestedFrameId && !frames.some(frame => frame.id === requestedFrameId)) throw new Error('Requested game frame does not exist in this target.');
    if (!requestedFrameId) {
      const gameFrames = frames.filter(isSteamGameFrame);
      if (gameFrames.length > 1) throw new Error('More than one Idleon game frame exists in this target.');
      frameId = gameFrames[0]?.id;
      for (const frame of gameFrames) gameFrameIds.add(frame.id);
      // The Steam shell may not have created its game iframe yet. Its later
      // frameNavigated event selects the known local game document before N.js.
    }
    await setupCommand('Runtime.enable');
    chooseContext();
    bindingRequested = true;
    await setupCommand('Runtime.addBinding', { name: REQUEST_BINDING });
    fetchRequested = true;
    await setupCommand('Fetch.enable', { patterns: [{ urlPattern: '*N.js*', resourceType: 'Script', requestStage: 'Response' }] });
    deadline = setTimeout(() => fail(new Error('Addon initialization timed out. No supported game bundle was initialized.')), initializationTimeoutMs);
    if (allowReload) await setupCommand('Page.reload', { ignoreCache: true });
    assertActive();
    return { ready, cleanup, get frameId() { return frameId; } };
  } catch (error) {
    fail(error);
    await cleanup();
    throw signal?.aborted ? abortError() : error;
  }
}
