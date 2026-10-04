import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalEndpoint, listCdpTargets, connectCdp } from '../src/cdp.js';

class FakeSocket extends EventTarget {
  static instances = [];
  constructor(url) { super(); this.url = url; this.sent = []; FakeSocket.instances.push(this); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
  send(value) { this.sent.push(JSON.parse(value)); }
  receive(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  close() { this.didClose = true; this.dispatchEvent(new Event('close')); }
}

test('debugger endpoints reject remote hosts, credentials and unsupported protocols', () => {
  for (const url of ['ws://example.com:32123/x', 'http://127.0.0.1/x', 'ws://user@localhost:32123/x', 'https://localhost:32123', 'file:///x']) {
    assert.throws(() => assertLocalEndpoint(url));
  }
  assert.equal(assertLocalEndpoint('ws://127.0.0.1:32123/devtools/page/1').hostname, '127.0.0.1');
});

test('target discovery rejects remote debugger URLs and ambiguous pages', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => [
    { type: 'page', id: 'a', webSocketDebuggerUrl: 'ws://127.0.0.1:32123/a' },
    { type: 'page', id: 'b', webSocketDebuggerUrl: 'ws://127.0.0.1:32123/b' },
  ] });
  await assert.rejects(connectCdp('http://127.0.0.1:32123', { fetchImpl, WebSocketImpl: FakeSocket }), /exactly one/);
  await assert.rejects(listCdpTargets('http://127.0.0.1:32123', { fetchImpl: async () => ({ ok: true, json: async () => [
    { type: 'page', webSocketDebuggerUrl: 'ws://remote.example:32123/a' },
  ] }) }), /loopback/);
});

test('CDP correlates replies and routes events without sending game lifecycle commands', async () => {
  const client = await connectCdp('ws://127.0.0.1:32123/page/1', { WebSocketImpl: FakeSocket });
  const socket = FakeSocket.instances.at(-1);
  const request = client.send('Runtime.evaluate', { expression: '1' });
  socket.receive({ id: socket.sent[0].id, result: { result: { value: 1 } } });
  assert.equal((await request).result.value, 1);
  const events = [];
  const remove = client.on('Page.loadEventFired', event => events.push(event));
  socket.receive({ method: 'Page.loadEventFired', params: { timestamp: 3 } });
  await new Promise(resolve => setImmediate(resolve));
  remove();
  assert.deepEqual(events, [{ timestamp: 3 }]);
  const pending = client.send('Runtime.enable');
  client.close();
  await assert.rejects(pending, /closed/);
  assert.equal(socket.didClose, true);
  assert.deepEqual(socket.sent.map(item => item.method), ['Runtime.evaluate', 'Runtime.enable']);
});

test('protocol errors and deadlines reject individual commands', async () => {
  const client = await connectCdp('ws://localhost:32123/page/1', { WebSocketImpl: FakeSocket, timeoutMs: 20 });
  const socket = FakeSocket.instances.at(-1);
  const bad = client.send('Bad.method');
  socket.receive({ id: socket.sent[0].id, error: { message: 'Unknown method' } });
  await assert.rejects(bad, /Unknown method/);
  await assert.rejects(client.send('Runtime.enable'), /timed out/);
  client.close();
});
