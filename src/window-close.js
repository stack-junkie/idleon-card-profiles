const BINDING = '__idleonCardProfilesWindowClosing';
const WORLD = 'idleon-card-profiles-close';
const REMOVE_HANDLERS = 'document.removeEventListener("click", window.__idleonCloseHandler, true); window.removeEventListener("beforeunload", window.__idleonUnloadHandler); delete window.__idleonCloseHandler; delete window.__idleonUnloadHandler;';
const OBSERVE_CLOSE = `(() => {
  const url = new URL(location.href);
  if (window !== window.top || url.protocol !== 'file:' || !/\\/distBuild\\/app\\.html$/i.test(url.pathname)) return;
  ${REMOVE_HANDLERS}
  window.__idleonCloseHandler = event => {
    if (event.target?.closest?.('button.closeButton')) window.${BINDING}('close');
  };
  document.addEventListener('click', window.__idleonCloseHandler, true);
  window.__idleonUnloadHandler = () => window.${BINDING}('unload');
  window.addEventListener('beforeunload', window.__idleonUnloadHandler);
})()`;

function isShell(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'file:' && /\/distBuild\/app\.html$/i.test(parsed.pathname); }
  catch { return false; }
}

// Observe the shell's native close controls in a world recreated after reload.
// Startup may defer unload handling while the add-on performs its one reload.
export async function installWindowClose(client, onClose, { deferUnload = false } = {}) {
  await client.send('Page.enable');
  // Target discovery can report app.html while its initial document is still
  // navigating. Wait for the verified shell before installing any handlers.
  let frameTree;
  const shellDeadline = Date.now() + 3000;
  do {
    ({ frameTree } = await client.send('Page.getFrameTree'));
    if (isShell(frameTree.frame.url)) break;
    if (Date.now() >= shellDeadline) throw new Error(`Unexpected game shell: ${frameTree.frame.url || '(not loaded yet)'}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (true);
  const frameId = frameTree.frame.id;
  let shellValid = true;
  let closing = false;
  let disposed = false;
  let unloadArmed = !deferUnload;
  let scriptId;
  let bindingRequested = false;
  let cleanupPromise;
  const contexts = new Set();
  const subscriptions = [];
  const subscribe = (event, callback) => subscriptions.push(client.on(event, callback));
  subscribe('Runtime.executionContextCreated', ({ context }) => {
    if (context.name === WORLD && context.auxData?.frameId === frameId && context.auxData?.isDefault !== true) contexts.add(context.id);
  });
  subscribe('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
  subscribe('Runtime.executionContextsCleared', () => contexts.clear());
  subscribe('Page.frameNavigated', ({ frame }) => { if (frame.id === frameId) shellValid = isShell(frame.url); });
  subscribe('Page.frameDetached', ({ frameId: detachedId }) => { if (detachedId === frameId) { shellValid = false; contexts.clear(); } });
  subscribe('Runtime.bindingCalled', event => {
    if (disposed || closing || !shellValid || event.name !== BINDING || !contexts.has(event.executionContextId)) return;
    if (event.payload !== 'close' && !(event.payload === 'unload' && unloadArmed)) return;
    closing = true;
    Promise.resolve().then(onClose).catch(error => console.error(`Helper shutdown: ${error.message}`));
  });
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    disposed = true;
    for (const unsubscribe of subscriptions) unsubscribe();
    cleanupPromise = (async () => {
      if (scriptId !== undefined) await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }).catch(() => {});
      await Promise.all([...contexts].map(contextId => client.send('Runtime.evaluate', { contextId, expression: REMOVE_HANDLERS }).catch(() => {})));
      contexts.clear();
      if (bindingRequested) await client.send('Runtime.removeBinding', { name: BINDING }).catch(() => {});
    })();
    return cleanupPromise;
  };
  cleanup.armUnload = () => { if (!disposed) unloadArmed = true; };
  try {
    await client.send('Runtime.enable');
    bindingRequested = true;
    await client.send('Runtime.addBinding', { name: BINDING, executionContextName: WORLD });
    ({ identifier: scriptId } = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVE_CLOSE, worldName: WORLD }));
    const { executionContextId } = await client.send('Page.createIsolatedWorld', { frameId, worldName: WORLD });
    contexts.add(executionContextId);
    const result = await client.send('Runtime.evaluate', { contextId: executionContextId, expression: OBSERVE_CLOSE });
    if (result.exceptionDetails) throw new Error('Could not observe the game close button.');
    return cleanup;
  } catch (error) { await cleanup(); throw error; }
}
