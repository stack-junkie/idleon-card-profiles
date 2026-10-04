/** Minimal, loopback-only Chrome DevTools Protocol transport. */
export function assertLocalEndpoint(value, protocols = ['http:', 'ws:']) {
  const url = new URL(value);
  if (!protocols.includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
      || url.username || url.password || !url.port) {
    throw new Error('CDP endpoints must use an explicit loopback address and port.');
  }
  return url;
}

export async function listCdpTargets(endpoint, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const url = assertLocalEndpoint(endpoint, ['http:']);
  url.pathname = '/json/list';
  url.search = '';
  url.hash = '';
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`CDP target discovery failed (${response.status}).`);
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error('CDP target discovery returned invalid data.');
  return targets.filter(target => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string')
    .map(target => {
      const socket = assertLocalEndpoint(target.webSocketDebuggerUrl, ['ws:']);
      if (socket.port !== url.port) throw new Error('CDP target returned an unexpected port.');
      return target;
    });
}

export async function connectCdp(endpoint, {
  WebSocketImpl = WebSocket, fetchImpl = fetch, timeoutMs = 10000, targetId,
} = {}) {
  let url = assertLocalEndpoint(endpoint);
  if (url.protocol === 'http:') {
    let targets = await listCdpTargets(url, { fetchImpl, timeoutMs });
    if (targetId) targets = targets.filter(target => target.id === targetId);
    if (targets.length !== 1) throw new Error('Select exactly one Idleon page target before connecting.');
    url = assertLocalEndpoint(targets[0].webSocketDebuggerUrl, ['ws:']);
  }
  const socket = new WebSocketImpl(url.href);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;
  let closed = false;
  const rejectPending = error => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  };
  const emit = (method, params) => {
    for (const listener of listeners.get(method) || []) {
      Promise.resolve().then(() => listener(params)).catch(error => {
        if (method !== 'clientError') emit('clientError', error);
      });
    }
  };
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`CDP ${entry.method}: ${message.error.message || 'request failed'}`));
      else entry.resolve(message.result ?? {});
    } else if (message.method) emit(message.method, message.params ?? {});
  });
  socket.addEventListener('close', () => {
    closed = true;
    rejectPending(new Error('CDP connection closed.'));
    emit('disconnect', {});
  });
  socket.addEventListener('error', () => rejectPending(new Error('CDP socket error.')));
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
      if (error) { socket.close(); reject(error); } else resolve();
    };
    const onOpen = () => finish();
    const onError = () => finish(new Error('Could not connect to the local game debugger.'));
    const onClose = () => finish(new Error('CDP connection closed before opening.'));
    const timer = setTimeout(() => finish(new Error('Local debugger connection timed out.')), timeoutMs);
    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
  });
  return {
    send(method, params = {}) {
      if (closed) return Promise.reject(new Error('CDP connection is closed.'));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP ${method} timed out.`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    on(method, listener) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(listener);
      return () => listeners.get(method)?.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      rejectPending(new Error('CDP connection closed by addon.'));
      socket.close();
    },
  };
}
