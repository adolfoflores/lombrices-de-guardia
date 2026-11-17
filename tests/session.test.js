import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../client/session/session.js';

function fixture(t, options = {}) {
  const sockets = [],
    timers = [],
    acks = [];
  let serial = 0;
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
    open() {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    }
    receive(message) {
      const event = new Event('message');
      event.data = JSON.stringify(message);
      this.dispatchEvent(event);
    }
    close(code = 1000) {
      this.readyState = 3;
      const event = new Event('close');
      event.code = code;
      this.dispatchEvent(event);
    }
  }
  const session = createSession({
    identity: null,
    url: 'ws://memory/socket',
    WebSocketClass: Socket,
    uid: () => `request-${++serial}`,
    schedule(fn, ms) {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    cancel(timer) {
      if (timer) timer.cancelled = true;
    },
    onAck(message) {
      acks.push(message);
    },
    ...options,
  });
  t.after(() => session.close());
  return { session, sockets, timers, acks };
}

test('the home screen and a different invitation allocate no socket or reconnect timer', (t) => {
  const { session, sockets, timers } = fixture(t, {
    identity: { code: 'ABC123', token: 'secret' },
    inviteCode: 'OTHER1',
  });
  session.restore();
  assert.equal(sockets.length, 0);
  assert.equal(timers.length, 0);
});

test('entry opens on demand, successful welcome is reused on reconnect, and reset stays idle', (t) => {
  const { session, sockets, timers } = fixture(t);
  session.restore();
  assert.equal(sockets.length, 0);
  session.enter('create', { name: 'Host' });
  assert.equal(sockets.length, 1);
  sockets[0].open();
  assert.equal(sockets[0].sent[0].type, 'create');
  sockets[0].receive({ type: 'welcome', code: 'ABC123', token: 'secret', playerId: 'p', sequence: 0 });
  sockets[0].receive({ type: 'ack', id: 'request-1', ok: true });
  sockets[0].close(1006);
  assert.equal(timers.at(-1).ms, 700);
  timers.at(-1).fn();
  sockets[1].open();
  assert.deepEqual(sockets[1].sent[0], { type: 'resume', id: 'request-2', code: 'ABC123', token: 'secret' });
  session.reset();
  assert.equal(session.identity, null);
  assert.equal(session.isOpen, false);
  assert.ok(timers.every((timer) => timer.cancelled));
  session.enter('join', { code: 'OTHER1', name: 'Guest' });
  sockets[2].open();
  assert.equal(sockets[2].sent[0].type, 'join');
});

test('rejected room entry returns to idle without a reconnection loop', (t) => {
  const { session, sockets, timers, acks } = fixture(t);
  session.enter('join', { code: 'MISSING', name: 'Guest' });
  sockets[0].open();
  sockets[0].receive({ type: 'ack', id: 'request-1', ok: false, error: 'Missing room' });
  assert.equal(session.isOpen, false);
  assert.equal(acks[0].ok, false);
  assert.ok(timers.every((timer) => timer.cancelled));
});

test('an expired saved identity resets once and stops automatic reconnects', (t) => {
  let resets = 0;
  const { session, sockets, timers } = fixture(t, {
    identity: { code: 'ABC123', token: 'secret' },
    onReset() {
      resets++;
    },
  });
  session.restore();
  sockets[0].open();
  assert.equal(sockets[0].sent[0].type, 'resume');
  sockets[0].receive({ type: 'ack', id: 'request-1', ok: false });
  assert.equal(resets, 1);
  assert.equal(session.identity, null);
  assert.ok(timers.every((timer) => timer.cancelled));
});
