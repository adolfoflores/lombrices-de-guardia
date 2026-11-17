import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomService } from '../server/rooms.js';
import { MemoryPeer } from './helpers/memory-peer.js';
import { publicRoom } from '../server/messages.js';
import { mountLobby } from '../client/ui/entry.js';
import { lobbyMarkup } from '../client/lobby.js';

function fixture(t, count = 6) {
  const service = createRoomService();
  t.after(() => service.close());
  const peers = Array.from({ length: count }, () => {
    const peer = new MemoryPeer();
    service.connect(peer);
    return peer;
  });
  const host = peers[0];
  assert.equal(host.command('create', { name: 'Host' }).ok, true);
  for (const [index, peer] of peers.entries())
    if (index) assert.equal(peer.command('join', { name: `Guest ${index}`, code: host.room.code }).ok, true);
  return { peers, host, room: host.room };
}

for (const mode of ['3v3', '2v2']) {
  test(`switching three alliances to ${mode} keeps every selection valid and permits a new game`, (t) => {
    const { peers, host, room } = fixture(t);
    host.command('settings', { settings: { mode: '2v2v2' } });
    peers.forEach((peer, index) => peer.command('team', { team: Math.floor(index / 2) }));
    peers.forEach((peer) => peer.command('ready', { ready: true }));
    assert.equal(host.command('settings', { settings: { mode } }).ok, true);
    assert.deepEqual(
      room.players.map((player) => player.team),
      [0, 0, 1, 1, 0, 1],
    );
    assert.ok(room.players.every((player) => !player.ready));
    for (const peer of peers) {
      const markup = lobbyMarkup({ room: publicRoom(room), me: peer.player.id });
      const select = markup.match(/<select id="team">(.*?)<\/select>/s)[1];
      assert.match(select, new RegExp(`value="${peer.player.team}" selected`));
      assert.doesNotMatch(select, /value="2"/);
    }
    assert.equal(peers[4].command('team', { team: 2 }).ok, false);
    assert.equal(peers[4].player.team, 0);
    if (mode === '2v2') {
      peers[4].command('leave');
      peers[5].command('leave');
    }
    const remaining = mode === '2v2' ? peers.slice(0, 4) : peers;
    remaining.forEach((peer) => peer.command('ready', { ready: true }));
    assert.equal(host.command('start').ok, true);
    remaining.forEach((peer) => assert.equal(peer.command('loaded').ok, true));
    assert.equal(room.phase, 'playing');
  });
}

test('rapid independent lobby controls preserve all choices before the next server broadcast', (t) => {
  const { host, room } = fixture(t, 4);
  const original = globalThis.document;
  t.after(() => {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  });
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {});
    return elements.get(selector);
  };
  const mapButton = { dataset: { map: 'islands' } };
  globalThis.document = {
    querySelector: element,
    querySelectorAll: (selector) => (selector === 'button[data-map]' ? [mapButton] : []),
  };
  const pending = [];
  mountLobby({
    room: publicRoom(room),
    me: host.player.id,
    send: (type, body) => pending.push({ type, body }),
    onUnlock() {},
    onCopy() {},
    onShare() {},
    onRules() {},
    onSettings() {},
  });
  element('#mode').onchange({ target: { value: '2v2' } });
  element('#worms').onchange({ target: { value: '3' } });
  element('#turn-seconds').onchange({ target: { value: '45' } });
  mapButton.onclick();
  for (const { type, body } of pending) assert.equal(host.command(type, body).ok, true);
  assert.deepEqual(room.settings, { mapId: 'islands', mode: '2v2', worms: 3, turnSeconds: 45 });
});

test('partial settings reject invalid and unknown fields atomically while legacy full updates still work', (t) => {
  const { host, peers, room } = fixture(t, 2);
  assert.equal(host.command('settings', { settings: { turnSeconds: 60 } }).ok, true);
  for (const peer of peers) peer.command('ready', { ready: true });
  const before = { ...room.settings };
  for (const settings of [
    null,
    [],
    {},
    { worms: 9 },
    { mode: 'invalid' },
    { mapId: 'islands', worms: 1 },
    { turnSeconds: null },
    { extra: true },
    JSON.parse('{"__proto__":{}}'),
  ]) {
    assert.equal(host.command('settings', { settings }).ok, false);
    assert.deepEqual(room.settings, before);
    assert.ok(room.players.every((player) => player.ready));
  }
  assert.equal(peers[1].command('settings', { settings: { worms: 4 } }).ok, false);
  assert.deepEqual(room.settings, before);
  assert.equal(host.command('settings', { settings: { mapId: 'cavern', mode: 'ffa', worms: 4 } }).ok, true);
  assert.deepEqual(room.settings, { mapId: 'cavern', mode: 'ffa', worms: 4, turnSeconds: 60 });
});
