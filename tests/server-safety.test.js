import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpHandler, requestPath, rejectUpgrade } from '../server/http.js';
import { CommandJournal } from '../server/command-journal.js';
import { createRoomService } from '../server/rooms.js';
import { ConnectionPolicy, TokenBucket, clientIp } from '../server/limits.js';
import { MemoryPeer } from './helpers/memory-peer.js';

function fixture(t, options = {}) {
  let clock = 1000;
  const app = createRoomService({ now: () => clock, ...options });
  t.after(() => app.close());
  const connect = (ip = '127.0.0.1') => {
    const peer = new MemoryPeer();
    app.connect(peer, ip);
    return peer;
  };
  const host = connect();
  assert.equal(host.command('create', { name: 'A' }).ok, true);
  const room = host.room;
  const guest = connect();
  assert.equal(guest.command('join', { name: 'B', code: room.code }).ok, true);
  return {
    app,
    host,
    guest,
    room,
    connect,
    advance(ms) {
      clock += ms;
      app.maintain();
    },
  };
}

test('malformed HTTP paths return 400 without throwing or breaking the next health request', () => {
  const handler = createHttpHandler({ root: process.cwd() });
  const response = () => ({
    status: null,
    body: '',
    setHeader() {},
    writeHead(status) {
      this.status = status;
    },
    end(body = '') {
      this.body = body;
    },
  });
  for (const url of ['//', '///', 'http://[', '/%', '/%00', '/%5cevil', '/\\evil', '/bad\npath']) {
    const res = response();
    assert.doesNotThrow(() => handler({ url, method: 'GET' }, res));
    assert.equal(res.status, 400, url);
    assert.equal(requestPath(url), null);
  }
  const res = response();
  handler({ url: '/health', method: 'GET' }, res);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  let raw;
  assert.doesNotThrow(() =>
    rejectUpgrade(
      {
        end(value) {
          raw = value;
        },
      },
      400,
    ),
  );
  assert.match(raw, /^HTTP\/1.1 400 Bad Request\r\n/);
});

test('leaving after the other guest disconnected starts expiry in an active match', (t) => {
  const { app, host, guest, room, advance } = fixture(t, { disconnectMs: 1000, emptyRoomMs: 3000 });
  for (const peer of [host, guest]) peer.command('ready', { ready: true });
  host.command('start');
  for (const peer of [host, guest]) peer.command('loaded');
  assert.equal(room.phase, 'playing');
  guest.close();
  assert.equal(room.emptySince, null);
  host.command('leave');
  assert.equal(room.emptySince, 1000);
  advance(1500);
  assert.equal(app.rooms.has(room.code), true);
  advance(1500);
  assert.equal(app.rooms.has(room.code), false);
});

test('lobby cleanup deletes the zero-player orphan immediately', (t) => {
  const { app, host, guest, room, advance } = fixture(t, { disconnectMs: 1000, emptyRoomMs: 3000 });
  guest.close();
  host.command('leave');
  advance(1000);
  assert.equal(room.players.length, 0);
  assert.equal(app.rooms.has(room.code), false);
});

test('reconnection clears empty-room expiry and a subsequent disconnect restarts it', (t) => {
  const { app, host, guest, room, connect, advance } = fixture(t, { disconnectMs: 10000, emptyRoomMs: 3000 });
  const token = guest.player.token;
  guest.close();
  host.command('leave');
  advance(2000);
  const resumed = connect();
  assert.equal(resumed.command('resume', { code: room.code, token }).ok, true);
  assert.equal(room.emptySince, null);
  advance(2000);
  assert.equal(app.rooms.has(room.code), true);
  resumed.close();
  advance(2999);
  assert.equal(app.rooms.has(room.code), true);
  advance(1);
  assert.equal(app.rooms.has(room.code), false);
});

test('thousands of commands use bounded memory and identical readiness causes no broadcast storm', (t) => {
  const { host, guest } = fixture(t, { limits: { messageBurst: 20000 } });
  const before = guest.messages.length;
  for (let i = 0; i < 10000; i++) assert.equal(host.command('ready', { ready: true }).ok, true);
  assert.equal(host.player.journal.commands.size, 240);
  assert.equal(host.player.journal.sequence, 10000);
  assert.equal(guest.messages.length - before, 1);
});

test('sequence journal keeps a shot through input churn and rejects it after eviction and reconnect', (t) => {
  const { host, guest, room, connect } = fixture(t, { limits: { messageBurst: 2000 } });
  for (const peer of [host, guest]) peer.command('ready', { ready: true });
  host.command('start');
  for (const peer of [host, guest]) peer.command('loaded');
  const shot = { action: { type: 'fire', weapon: 'shotgun', angle: -0.8, power: 0.5 } };
  const ack = host.command('action', shot, 'shot');
  assert.equal(ack.ok, true);
  const seq = host.requests.get('shot').seq;
  for (let i = 0; i < 300; i++) host.command('action', { action: { type: 'input', move: 0 } });
  assert.deepEqual(host.command('action', shot, 'shot'), ack);
  assert.equal(room.game.turn.shots, 1);
  for (let i = 0; i < 260; i++) host.command('action', { action: { type: 'release' } });
  assert.equal(host.player.journal.commands.has('shot'), false);
  const token = host.player.token;
  const resumed = connect();
  resumed.command('resume', { code: room.code, token });
  assert.equal(resumed.sequence, host.player.journal.sequence);
  assert.equal(resumed.command('action', { ...shot, seq }, 'shot').ok, false);
  assert.equal(room.game.turn.shots, 1);
  assert.equal(resumed.command('action', { action: { type: 'release' } }).ok, true);
});

test('invalid, missing and old sequences cannot mutate a room', (t) => {
  const { host } = fixture(t);
  for (const seq of [undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(host.command('ready', { ready: true, seq }).ok, false);
    assert.equal(host.player.ready, false);
  }
  const journal = new CommandJournal();
  assert.equal(journal.accept(5), true);
  assert.equal(journal.accept(4), false);
  assert.equal(journal.accept(5), false);
  assert.equal(journal.accept(6), true);
});

test('a superseded connection cannot advance the surviving identity sequence', (t) => {
  const { host, room, connect } = fixture(t);
  const player = host.player;
  const next = connect();
  next.command('resume', { code: room.code, token: player.token });
  host.command('ready', { ready: true, seq: 999999 });
  assert.equal(player.journal.sequence, 0);
  assert.equal(next.command('ready', { ready: true }).ok, true);
});

test('message floods close the peer and entry deadlines release anonymous connections', (t) => {
  const { host, connect, advance } = fixture(t, { limits: { messageBurst: 3, handshakeTimeoutMs: 1000 } });
  host.command('ready', { ready: true });
  host.command('ready', { ready: false });
  host.command('ready', { ready: true });
  assert.equal(host.closeCode, 1008);
  const anonymous = connect();
  advance(1000);
  assert.equal(anonymous.closeCode, 1008);
});

test('room caps reject additional rooms and release capacity after leaving', (t) => {
  const { connect, room } = fixture(t, { limits: { maxRooms: 2, maxRoomsPerIp: 1 } });
  const same = connect();
  assert.equal(same.command('create', { name: 'Limit' }).ok, false);
  const other = connect('other');
  assert.equal(other.command('create', { name: 'Other' }).ok, true);
  const third = connect('third');
  assert.equal(third.command('create', { name: 'Third' }).ok, false);
  other.command('leave');
  assert.equal(third.command('create', { name: 'Third' }).ok, true);
  assert.ok(room.players.length);
});

test('leaving an established room gives a fresh anonymous deadline and permits immediate re-entry', (t) => {
  const { host, advance } = fixture(t);
  advance(30_000);
  assert.equal(host.command('leave').ok, true);
  advance(14_999);
  assert.equal(host.readyState, 1);
  assert.equal(host.command('create', { name: 'Again' }).ok, true);
  advance(30_000);
  assert.equal(host.readyState, 1);
  assert.equal(host.command('leave').ok, true);
  advance(15_000);
  assert.equal(host.closeCode, 1008);
});

test('connection limits release reservations once and do not retain departed IPs', () => {
  const policy = new ConnectionPolicy({ limits: { maxConnections: 2, maxConnectionsPerIp: 1 } });
  const request = (ip) => ({ headers: { host: 'game.test' }, socket: { remoteAddress: ip } });
  const first = policy.reserve(request('a'));
  assert.equal(policy.reserve(request('a')).status, 429);
  const second = policy.reserve(request('b'));
  assert.equal(policy.reserve(request('c')).status, 429);
  first.release();
  first.release();
  second.release();
  assert.equal(policy.total, 0);
  assert.equal(policy.byIp.size, 0);
  const third = policy.reserve(request('c'));
  assert.ok(third.release);
  third.release();
});

test('browser origins and forwarded addresses must match explicit proxy policy', () => {
  const policy = new ConnectionPolicy({ allowedOrigins: ['https://invite.test'] });
  const request = (origin) => ({
    headers: { host: 'game.test', origin, 'x-forwarded-for': 'spoofed, 192.0.2.1' },
    socket: { remoteAddress: '::ffff:127.0.0.1' },
  });
  for (const origin of ['null', 'https://evil.test', 'file://game.test', 'https://['])
    assert.equal(policy.reserve(request(origin)).status, 403);
  for (const origin of [undefined, 'https://game.test', 'https://invite.test']) {
    const admission = policy.reserve(request(origin));
    assert.ok(admission.release);
    admission.release();
  }
  assert.equal(clientIp(request(), false), '127.0.0.1');
  assert.equal(clientIp(request(), true), '192.0.2.1');
});

test('token buckets recover with time and tolerate a backwards clock', () => {
  let time = 1000;
  const bucket = new TokenBucket(2, 1, () => time);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false);
  time += 1000;
  assert.equal(bucket.take(), true);
  time -= 1000;
  assert.equal(bucket.take(), false);
});
