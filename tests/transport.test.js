import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../client/session/transport.js';
import { readPreferences } from '../client/session/storage.js';
import { resultSummary } from '../client/ui/results.js';
import { rulesMarkup } from '../client/ui/rules.js';

function fixture(t, handlers = {}) {
  const sockets = [],
    timers = [],
    acks = [],
    messages = [];
  let clock = 0,
    serial = 0;
  class Socket extends EventTarget {
    readyState = 0;
    sent = [];
    constructor() {
      super();
      sockets.push(this);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    receive(message) {
      const event = new Event('message');
      event.data = typeof message === 'string' ? message : JSON.stringify(message);
      this.dispatchEvent(event);
    }
    open() {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    }
    close(code = 1000) {
      this.readyState = 3;
      const event = new Event('close');
      event.code = code;
      this.dispatchEvent(event);
    }
  }
  const transport = createTransport({
    url: 'ws://example.test/socket',
    WebSocketClass: Socket,
    now: () => clock,
    uid: () => `request-${++serial}`,
    schedule(fn, ms) {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    cancel(timer) {
      if (timer) timer.cancelled = true;
    },
    onAck(...args) {
      acks.push(args);
    },
    onMessage(message) {
      messages.push(message);
    },
    ...handlers,
  });
  t.after(() => transport.close());
  transport.connect();
  return {
    transport,
    sockets,
    timers,
    acks,
    messages,
    advance(ms) {
      clock += ms;
    },
  };
}

test('transport synchronizes sequence at welcome, correlates acks and measures quiet action latency', (t) => {
  const { transport, sockets, acks, advance } = fixture(t);
  const socket = sockets[0];
  socket.open();
  const create = transport.send('create', { name: 'A' });
  assert.equal(socket.sent[0].seq, undefined);
  socket.receive({ type: 'welcome', sequence: 41 });
  const id = transport.send('action', { action: { type: 'input', move: 1 } }, true);
  assert.equal(socket.sent[1].seq, 42);
  let confirmed;
  transport.expect(id, (message) => {
    confirmed = message.ok;
  });
  advance(85);
  socket.receive({ type: 'ack', id, ok: true });
  assert.equal(confirmed, true);
  assert.equal(acks[0][1].rtt, 85);
  assert.equal(acks[0][1].quiet, true);
  assert.equal(acks[0][1].type, 'action');
  socket.receive({ type: 'ack', id: create, ok: true });
  transport.send('ready', { ready: true });
  assert.equal(socket.sent[2].seq, 43);
});

test('reconnection discards old pending callbacks and resumes from the server high-water mark', (t) => {
  const { transport, sockets, timers } = fixture(t);
  sockets[0].open();
  sockets[0].receive({ type: 'welcome', sequence: 0 });
  const id = transport.send('action', { action: { type: 'end' } });
  let called = false;
  transport.expect(id, () => {
    called = true;
  });
  sockets[0].close();
  assert.equal(timers.at(-1).ms, 700);
  timers.at(-1).fn();
  sockets[1].open();
  sockets[1].receive({ type: 'welcome', sequence: 54 });
  sockets[1].receive({ type: 'ack', id, ok: true });
  assert.equal(called, false);
  transport.send('ready', { ready: true });
  assert.equal(sockets[1].sent.at(-1).seq, 55);
});

test('connection takeover stops reconnecting and explicit close cancels a scheduled retry', (t) => {
  let replaced = 0;
  const { transport, sockets, timers } = fixture(t, {
    onReplaced() {
      replaced++;
    },
  });
  sockets[0].open();
  sockets[0].close(4001);
  assert.equal(replaced, 1);
  assert.equal(timers.length, 0);
  transport.connect();
  assert.equal(sockets.length, 1);
});

test('idle disconnect stops retries, ignores stale frames and permits a new entry connection', (t) => {
  const { transport, sockets, timers, messages } = fixture(t);
  transport.connect();
  assert.equal(sockets.length, 1, 'a pending connection is reused');
  sockets[0].open();
  transport.disconnect();
  assert.equal(transport.isOpen, false);
  assert.equal(timers.length, 0);
  sockets[0].receive({ type: 'welcome', sequence: 999 });
  assert.equal(messages.length, 0);
  transport.connect();
  sockets[1].open();
  assert.equal(transport.isOpen, true);
});

test('unacknowledged requests and callbacks are bounded; expired work cannot run later', (t) => {
  const { transport, sockets, advance } = fixture(t);
  const socket = sockets[0];
  socket.open();
  const expired = transport.send('ready', { ready: true });
  let called = false;
  transport.expect(expired, () => {
    called = true;
  });
  advance(10001);
  transport.send('ready', { ready: false });
  socket.receive({ type: 'ack', id: expired, ok: true });
  assert.equal(called, false);
  for (let i = 0; i < 255; i++) assert.ok(transport.send('action', { action: { type: 'input', move: 0 } }));
  assert.equal(transport.send('ready', { ready: true }), null);
  assert.equal(socket.readyState, 3);
});

test('missing acknowledgements close and retry; explicit shutdown cancels the retry', (t) => {
  const { transport, sockets, timers } = fixture(t);
  sockets[0].open();
  transport.send('create', { name: 'A' });
  assert.equal(timers.at(-1).ms, 10000);
  timers.at(-1).fn();
  assert.equal(sockets[0].readyState, 3);
  assert.equal(timers.at(-1).ms, 700);
  transport.close();
  assert.equal(timers.at(-1).cancelled, true);
  timers.at(-1).fn();
  assert.equal(sockets.length, 1);
});

test('malformed and unknown frames do not fire acknowledgement callbacks', (t) => {
  const { sockets, acks } = fixture(t);
  sockets[0].open();
  for (const frame of ['{broken', 'null', '42', { type: 'ack', id: 'unknown', ok: true }])
    assert.doesNotThrow(() => sockets[0].receive(frame));
  assert.equal(acks.length, 0);
});

test('preferences reject stored HTML, invalid types and nonfinite numbers', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let stored;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => stored } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  stored = JSON.stringify({
    sensitivity: '\"><img src=x>',
    music: 90,
    sfx: -2,
    hand: 'sideways',
    quality: 'unknown',
    reducedMotion: 'false',
  });
  assert.deepEqual(readPreferences(true), {
    sensitivity: 1,
    music: 1,
    sfx: 0,
    hand: 'right',
    quality: 'auto',
    reducedMotion: true,
  });
  stored = '{invalid';
  assert.equal(readPreferences().sensitivity, 1);
  stored = 'null';
  assert.equal(readPreferences().quality, 'auto');
});

test('extracted result presentation keeps the local-player marker and escapes player names', () => {
  const state = { players: [{ id: 'p', name: '<img src=x onerror=alert(1)>', color: '#123456' }] };
  const result = {
    winnerIds: ['p'],
    mvpId: 'p',
    stats: [
      {
        playerId: 'p',
        damageDealt: 10,
        kills: 1,
        teamKills: 0,
        shots: 1,
        bestShot: { damage: 10, weapon: 'bazooka' },
        longestShot: 100,
      },
    ],
  };
  const html = resultSummary(result, state, 'p');
  assert.match(html, /is-self/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Bazuca/);
  assert.match(rulesMarkup(45), /45 segundos/);
});
