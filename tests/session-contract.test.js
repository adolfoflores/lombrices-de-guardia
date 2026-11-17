import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../client/session/session.js';
import { createRoomService } from '../server/rooms.js';
import { MemoryPeer } from './helpers/memory-peer.js';

const drain = () => new Promise((resolve) => setImmediate(resolve));

test('the real client transport and room service agree on create, start, fire and resume sequences', async (t) => {
  const service = createRoomService();
  const transports = [];
  t.after(() => {
    transports.forEach((connection) => connection.close());
    service.close();
  });
  function connect(identity = null) {
    const messages = [];
    class Socket extends EventTarget {
      readyState = 1;
      constructor() {
        super();
        this.peer = new MemoryPeer();
        this.peer.send = (data) => {
          queueMicrotask(() => {
            const event = new Event('message');
            event.data = data;
            this.dispatchEvent(event);
          });
        };
        this.peer.close = (code) => {
          if (this.readyState === 3) return;
          this.readyState = 3;
          this.peer.readyState = 3;
          this.peer.emit('close');
          const event = new Event('close');
          event.code = code;
          this.dispatchEvent(event);
        };
        service.connect(this.peer, '127.0.0.1');
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send(data) {
        this.peer.emit('message', Buffer.from(data));
      }
      close() {
        this.peer.close(1000);
      }
    }
    const transport = createSession({
      identity,
      url: 'ws://memory/socket',
      WebSocketClass: Socket,
      onMessage(message) {
        messages.push(message);
      },
    });
    transports.push(transport);
    transport.restore();
    return { transport, messages };
  }
  const host = connect(),
    guest = connect();
  await drain();
  assert.equal(host.transport.isOpen, false);
  assert.equal(service.rooms.size, 0);
  host.transport.enter('create', { name: 'Host' });
  await drain();
  const identity = host.messages.find((message) => message.type === 'welcome');
  guest.transport.enter('join', { name: 'Guest', code: identity.code });
  await drain();
  host.transport.send('ready', { ready: true });
  guest.transport.send('ready', { ready: true });
  await drain();
  host.transport.send('start');
  await drain();
  host.transport.send('loaded');
  guest.transport.send('loaded');
  await drain();
  const room = service.rooms.get(identity.code);
  assert.equal(room.phase, 'playing');
  const shot = host.transport.send('action', {
    action: { type: 'fire', weapon: 'shotgun', angle: -0.8, power: 0.5 },
  });
  let shotAccepted = false;
  host.transport.expect(shot, (response) => {
    shotAccepted = response.ok;
  });
  await drain();
  assert.equal(shotAccepted, true);
  assert.equal(room.game.turn.shots, 1);
  const sequence = room.players[0].journal.sequence;
  const resumed = connect({ code: identity.code, token: identity.token });
  await drain();
  assert.equal(resumed.messages.find((message) => message.type === 'welcome').sequence, sequence);
  const release = resumed.transport.send('action', { action: { type: 'release' } });
  let releaseAccepted = false;
  resumed.transport.expect(release, (response) => {
    releaseAccepted = response.ok;
  });
  await drain();
  assert.equal(releaseAccepted, true);
  assert.equal(room.players[0].journal.sequence, sequence + 1);
  assert.equal(room.game.turn.shots, 1);
  resumed.transport.send('leave');
  await drain();
  assert.equal(resumed.transport.isOpen, false);
  assert.equal(resumed.transport.identity, null);
});
