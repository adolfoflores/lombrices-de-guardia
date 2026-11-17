import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';
import { CONFIG, TURN_DURATIONS } from '../shared/config.js';
import { NetworkClient, waitFor, runNetworkSmoke } from '../scripts/network-smoke.js';

async function fixture(t, count = 2, options = {}) {
  const app = await createServer(options);
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.close();
    await app.close();
  });
  for (let index = 0; index < count; index++) clients.push(await NetworkClient.connect(app.port));
  assert.equal((await clients[0].command('create', { name: 'A' })).ok, true);
  const code = clients[0].identity.code;
  for (let index = 1; index < count; index++)
    assert.equal((await clients[index].command('join', { name: `Player ${index}`, code })).ok, true);
  return { app, clients, code, room: app.rooms.get(code) };
}
async function start(clients) {
  for (const client of clients) assert.equal((await client.command('ready', { ready: true })).ok, true);
  assert.equal((await clients[0].command('start')).ok, true);
  for (const client of clients) assert.equal((await client.command('loaded')).ok, true);
  await waitFor(() => clients.every((client) => client.state));
}

test('six independent clients: crater, reconnection, host succession, result and rematch', async () => {
  const result = await runNetworkSmoke();
  assert.equal(result.length, 3);
});

test('private room capacity, sanitized state, names, settings and host authority', async (t) => {
  const { app, clients, code } = await fixture(t, 6);
  const guest = await NetworkClient.connect(app.port);
  clients.push(guest);
  assert.equal((await guest.command('join', { code: 'XXXXXX', name: 'Nobody' })).ok, false);
  assert.equal((await guest.command('join', { code, name: 'Seventh' })).ok, false);
  assert.equal(
    (await clients[1].command('settings', { settings: { mapId: 'cavern', mode: 'ffa', worms: 4 } })).ok,
    false,
  );
  assert.equal(
    (await clients[0].command('settings', { settings: { mapId: 'bogus', mode: 'ffa', worms: 4 } })).ok,
    false,
  );
  assert.equal((await clients[0].command('start')).ok, false);
  assert.equal(
    (await clients[0].command('settings', { settings: { mapId: 'cavern', mode: 'ffa', worms: 4 } })).ok,
    true,
  );
  assert.equal(clients[0].room.settings.worms, 4);
  const publicPayload = JSON.stringify(clients[0].room);
  for (const client of clients.slice(0, 6))
    assert.equal(publicPayload.includes(client.identity.token), false);
  const response = await fetch(`http://127.0.0.1:${app.port}/health`);
  assert.deepEqual(await response.json(), { ok: true });
});

test('only the lobby host can set a numeric turn preset; legacy settings retain the selected duration', async (t) => {
  const { clients, room } = await fixture(t);
  const settings = { mapId: 'hills', mode: 'ffa', worms: 2 };
  assert.equal(room.settings.turnSeconds, CONFIG.turnSeconds);
  assert.equal(clients[1].room.settings.turnSeconds, CONFIG.turnSeconds);
  for (const turnSeconds of TURN_DURATIONS) {
    assert.equal(
      (await clients[1].command('settings', { settings: { ...settings, turnSeconds } })).ok,
      false,
    );
    assert.equal((await clients[0].command('settings', { settings: { ...settings, turnSeconds } })).ok, true);
    await waitFor(() => clients.every((client) => client.room.settings.turnSeconds === turnSeconds));
    assert.equal(room.settings.turnSeconds, turnSeconds);
  }
  for (const client of clients) await client.command('ready', { ready: true });
  for (const turnSeconds of [null, '30', true, 25, 0, -30, 31, 30.5, {}, []]) {
    assert.equal(
      (await clients[0].command('settings', { settings: { ...settings, turnSeconds } })).ok,
      false,
      JSON.stringify(turnSeconds),
    );
    assert.equal(room.settings.turnSeconds, 60);
    assert.ok(
      room.players.every((player) => player.ready),
      'a rejected setting must not clear readiness',
    );
  }
  assert.equal(
    (await clients[0].command('settings', { settings: { ...settings, mapId: 'cavern' } })).ok,
    true,
  );
  assert.equal(
    room.settings.turnSeconds,
    60,
    'older clients may change another setting without resetting the duration',
  );
  assert.ok(room.players.every((player) => !player.ready));
  for (const client of clients) await client.command('ready', { ready: true });
  assert.equal((await clients[0].command('start')).ok, true);
  assert.equal(
    (await clients[0].command('settings', { settings: { ...settings, turnSeconds: 30 } })).ok,
    false,
    'loading settings are read-only',
  );
  for (const client of clients) await client.command('loaded');
  await waitFor(() => clients.every((client) => client.state));
  assert.equal(
    (await clients[0].command('settings', { settings: { ...settings, turnSeconds: 30 } })).ok,
    false,
    'playing settings are read-only',
  );
  assert.equal(room.game.turnSeconds, 60);
  for (const client of clients) {
    assert.equal(client.state.turnSeconds, 60);
    assert.ok(client.state.turn.remaining > 59 && client.state.turn.remaining <= 60);
  }
});

for (const [mode, count, teams] of [
  ['2v2', 4, [0, 0, 1, 1]],
  ['3v3', 6, [0, 0, 0, 1, 1, 1]],
  ['2v2v2', 6, [0, 0, 1, 1, 2, 2]],
]) {
  test(`team composition ${mode} validates exact teams and waits for every loaded client`, async (t) => {
    const { clients, room } = await fixture(t, count);
    await clients[0].command('settings', { settings: { mapId: 'islands', mode, worms: 3 } });
    for (const client of clients) {
      await client.command('team', { team: 0 });
      await client.command('ready', { ready: true });
    }
    assert.equal((await clients[0].command('start')).ok, false);
    for (let index = 0; index < clients.length; index++) {
      await clients[index].command('team', { team: teams[index] });
      await clients[index].command('ready', { ready: true });
    }
    assert.equal((await clients[0].command('start')).ok, true);
    for (const client of clients.slice(0, -1)) assert.equal((await client.command('loaded')).ok, true);
    assert.equal(room.phase, 'loading');
    assert.equal(room.game, null);
    assert.equal((await clients.at(-1).command('loaded')).ok, true);
    await waitFor(() => clients.every((client) => client.state));
    assert.equal(room.phase, 'playing');
    assert.equal(clients[0].state.worms.length, count * 3);
    assert.equal(clients[0].state.mode, mode);
  });
}

test('repeated action identifiers execute once; inactive clients and malformed actions rejected', async (t) => {
  const { clients, room } = await fixture(t);
  await start(clients);
  const active = clients.find((client) => client.identity.playerId === room.game.turn.playerId);
  const inactive = clients.find((client) => client !== active);
  assert.equal(
    (
      await inactive.command('action', {
        action: { type: 'fire', weapon: 'shotgun', angle: -0.5, power: 0.5 },
      })
    ).ok,
    false,
  );
  assert.equal((await active.command('action', { action: { type: 'input', move: 999 } })).ok, false);
  assert.equal(
    (await active.command('action', { action: { type: 'fire', weapon: 'bazooka', angle: -0.5, power: 3 } }))
      .ok,
    false,
  );
  assert.equal(
    (await active.command('action', { action: { type: 'fire', weapon: 'not-a-weapon', angle: 0 } })).ok,
    false,
  );
  const command = { action: { type: 'fire', weapon: 'shotgun', angle: -0.8, power: 0.5 } };
  const first = await active.command('action', command, 'duplicate-shot');
  assert.equal(first.ok, true);
  const shotsAfter = room.game.turn.shots;
  for (let index = 0; index < 280; index++)
    await active.command('action', { action: { type: 'input', move: 0 } });
  assert.deepEqual(await active.command('action', command, 'duplicate-shot'), first);
  assert.equal(room.game.turn.shots, shotsAfter);
  await new Promise((resolveWait) => setTimeout(resolveWait, 550));
  assert.equal((await active.command('action', command, 'second-shot')).ok, true);
  assert.equal(room.game.turn.shots, 2);
  assert.equal(room.game.players.find((player) => player.id === active.identity.playerId).ammo.shotgun, -1);
});

test('resume takes over one slot and restores terrain, health, inventory, turn; host disconnect transfers authority', async (t) => {
  const { app, clients, code, room } = await fixture(t, 3);
  await clients[0].command('settings', { settings: { ...room.settings, turnSeconds: 45 } });
  await start(clients);
  const old = clients[0];
  room.game.terrain.circle(780, 650, 45);
  room.game.worms[0].hp = 67;
  const next = await NetworkClient.connect(app.port);
  clients.push(next);
  assert.equal((await next.command('resume', { code, token: old.identity.token })).ok, true);
  await waitFor(() => old.closed);
  assert.equal(old.closeCode, 4001);
  assert.equal(room.players.length, 3);
  assert.equal(next.identity.playerId, old.identity.playerId);
  assert.ok(next.terrain);
  assert.ok(next.fullStates >= 1);
  assert.equal(next.state.terrainRevision, room.game.terrain.revision);
  assert.equal(next.state.worms[0].hp, 67);
  assert.ok(next.state.players[0].ammo);
  assert.ok(next.state.turn.remaining > 0);
  assert.equal(next.state.turnSeconds, 45);
  assert.equal(next.room.settings.turnSeconds, 45);
  next.close();
  await waitFor(() => clients[1].room.hostId === clients[1].identity.playerId);
  assert.equal(room.phase, 'playing');
  const final = await NetworkClient.connect(app.port);
  clients.push(final);
  assert.equal((await final.command('resume', { code, token: old.identity.token })).ok, true);
  assert.equal(final.room.hostId, clients[1].identity.playerId);
  assert.equal(final.room.players.length, 3);
  assert.equal(final.state.turnSeconds, 45);
  assert.equal(final.room.settings.turnSeconds, 45);
});

test('loading disconnect cancels barrier; timeout returns to lobby without an incomplete game', async (t) => {
  const { app, clients, room } = await fixture(t, 2, { loadingMs: 100 });
  for (const client of clients) await client.command('ready', { ready: true });
  await clients[0].command('start');
  await clients[0].command('loaded');
  await waitFor(() => room.phase === 'lobby');
  assert.equal(room.game, null);
  assert.equal(
    room.players.every((player) => !player.ready),
    true,
  );
  await waitFor(() => clients[0].errors.some((error) => error.includes('carga')));
  assert.ok(clients[0].errors.some((error) => error.includes('carga')));
  for (const client of clients) await client.command('ready', { ready: true });
  await clients[0].command('start');
  clients[1].close();
  await waitFor(() => room.phase === 'lobby');
  assert.equal(app.rooms.size, 1);
});

test('absent active player times out; prolonged absence forfeits and preserves spectator reconnection', async (t) => {
  const { app, clients, room, code } = await fixture(t, 3, { disconnectMs: 450 });
  await start(clients);
  const activeIndex = clients.findIndex((client) => client.identity.playerId === room.game.turn.playerId);
  const active = clients[activeIndex];
  const oldTurn = room.game.turn.number;
  room.game.turn.remaining = 0.05;
  active.close();
  await waitFor(() => room.game.turn.number > oldTurn);
  await waitFor(() => room.players.find((player) => player.id === active.identity.playerId).forfeited);
  assert.ok(
    room.game.worms
      .filter((worm) => worm.playerId === active.identity.playerId)
      .every((worm) => worm.hp <= 0),
  );
  const resumed = await NetworkClient.connect(app.port);
  clients.push(resumed);
  assert.equal((await resumed.command('resume', { code, token: active.identity.token })).ok, true);
  assert.equal((await resumed.command('action', { action: { type: 'end' } })).ok, false);
  assert.ok(resumed.state);
});

test('explicit host leave during combat forfeits; remaining participants finish and return to lobby', async (t) => {
  const { clients, room } = await fixture(t, 3);
  await start(clients);
  assert.equal((await clients[0].command('leave')).ok, true);
  await waitFor(() => clients[1].room.hostId === clients[1].identity.playerId);
  assert.equal(room.phase, 'playing');
  assert.equal((await clients[1].command('leave')).ok, true);
  await waitFor(() => clients[2].room.phase === 'finished');
  assert.equal(clients[2].state.result.draw, false);
  assert.deepEqual(clients[2].state.result.winnerIds, [clients[2].identity.playerId]);
  assert.equal((await clients[2].command('lobby')).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.settings.mapId, 'hills');
  assert.equal(room.players[0].ready, false);
});

test('empty rooms expire and invalid or missing message IDs do not alter state', async (t) => {
  const { app, clients, room } = await fixture(t, 2, { emptyRoomMs: 100 });
  clients[0].ws.send('{broken');
  clients[0].ws.send(JSON.stringify({ type: 'ready', ready: true }));
  await waitFor(() => clients[0].errors.length === 2);
  assert.equal(room.players[0].ready, false);
  for (const client of clients) client.close();
  await waitFor(() => app.rooms.size === 0);
});

test('eliminated connected players spectate and six-player group starts a rematch with the same settings', async (t) => {
  const { clients, room } = await fixture(t, 6);
  await clients[0].command('settings', {
    settings: { mapId: 'cavern', mode: 'ffa', worms: 4, turnSeconds: 60 },
  });
  await start(clients);
  const ids = clients.map((client) => client.identity.playerId);
  // Arrange elimination in the authoritative engine; validate every lifecycle transition over real sockets.
  for (const id of ids.slice(1)) room.game.forfeit(id);
  await waitFor(() => clients.every((client) => client.room.phase === 'finished'));
  assert.equal(clients[5].room.players.length, 6);
  assert.equal((await clients[5].command('action', { action: { type: 'end' } })).ok, false);
  assert.equal((await clients[5].command('rematch-request', {}, 'guest-rematch')).ok, true);
  assert.equal((await clients[5].command('rematch-request', {}, 'guest-rematch')).ok, true);
  await waitFor(() => clients[0].room.rematchRequests.includes(ids[5]));
  assert.equal(clients[0].room.rematchRequests.length, 1);
  assert.equal(room.phase, 'finished');
  assert.equal((await clients[5].command('rematch')).ok, false);
  assert.equal((await clients[0].command('rematch')).ok, true);
  await waitFor(() => clients.every((client) => client.room.phase === 'lobby'));
  assert.deepEqual(clients[0].room.rematchRequests, []);
  assert.deepEqual(
    room.players.map((player) => player.id),
    ids,
  );
  assert.deepEqual(room.settings, { mapId: 'cavern', mode: 'ffa', worms: 4, turnSeconds: 60 });
  assert.ok(room.players.every((player) => !player.ready));
  for (const client of clients) client.state = null;
  await start(clients);
  assert.equal(clients[0].state.worms.length, 24);
  assert.ok(clients[0].state.worms.every((worm) => worm.hp === 100));
  assert.equal(clients[0].state.mapId, 'cavern');
  assert.equal(clients[0].state.turnSeconds, 60);
  assert.ok(clients[0].state.turn.remaining > 59 && clients[0].state.turn.remaining <= 60);
});

test('old commands cannot execute after response-cache eviction, a later turn and reconnection', async (t) => {
  const { app, clients, room, code } = await fixture(t);
  await start(clients);
  const actor = clients.find((client) => client.identity.playerId === room.game.turn.playerId);
  const saved = actor.identity;
  const original = { action: { type: 'fire', weapon: 'shotgun', angle: -0.8, power: 0.5 } };
  assert.equal((await actor.command('action', original, 'old-successful-shot')).ok, true);
  for (let index = 0; index < 260; index++)
    assert.equal((await actor.command('action', { action: { type: 'release' } })).ok, true);
  const player = room.players.find((player) => player.id === saved.playerId);
  assert.equal(player.journal.commands.has('old-successful-shot'), false);
  const seq = actor.requests.get('old-successful-shot').seq;
  assert.ok(player.journal.sequence >= seq);
  assert.equal((await actor.command('action', { action: { type: 'end' } })).ok, true);
  await waitFor(() => room.game.turn.playerId !== saved.playerId);
  const other = clients.find((client) => client.identity.playerId === room.game.turn.playerId);
  assert.equal((await other.command('action', { action: { type: 'end' } })).ok, true);
  await waitFor(() => room.game.turn.playerId === saved.playerId);
  const resumed = await NetworkClient.connect(app.port);
  clients.push(resumed);
  assert.equal((await resumed.command('resume', { code, token: saved.token })).ok, true);
  assert.equal(room.game.turn.shots, 0);
  assert.equal((await resumed.command('action', { ...original, seq }, 'old-successful-shot')).ok, false);
  assert.equal(room.game.turn.shots, 0);
});

test('absence forfeiture resets for rematch and applies again in the next round', async (t) => {
  const { app, clients, room, code } = await fixture(t, 2, { disconnectMs: 120 });
  await start(clients);
  const saved = clients[1].identity;
  clients[1].close();
  await waitFor(() => room.players.find((player) => player.id === saved.playerId).forfeited);
  await waitFor(() => room.phase === 'finished');
  const resumed = await NetworkClient.connect(app.port);
  clients.push(resumed);
  assert.equal((await resumed.command('resume', { code, token: saved.token })).ok, true);
  assert.equal((await clients[0].command('rematch')).ok, true);
  assert.equal(room.players.find((player) => player.id === saved.playerId).forfeited, false);
  clients[0].state = null;
  resumed.state = null;
  await start([clients[0], resumed]);
  assert.ok(
    room.game.worms.filter((worm) => worm.playerId === saved.playerId).every((worm) => worm.hp === 100),
  );
  resumed.close();
  await waitFor(() => room.players.find((player) => player.id === saved.playerId).forfeited);
  await waitFor(() => room.phase === 'finished');
  assert.ok(
    room.game.worms.filter((worm) => worm.playerId === saved.playerId).every((worm) => worm.hp === 0),
  );
});

test('the socket accepts analog tool axes and rejects malformed ranges without mutating accepted input', async (t) => {
  const { clients, room } = await fixture(t);
  await start(clients);
  const actor = clients.find((client) => client.identity.playerId === room.game.turn.playerId);
  const input = { move: -0.35, thrustX: -0.6, thrustY: 0.45, reel: 0.2 };
  assert.equal((await actor.command('action', { action: { type: 'input', ...input } })).ok, true);
  assert.deepEqual(room.game._input, input);
  assert.equal(room.game._active().facing, -1);
  for (const key of Object.keys(input))
    for (const value of [-1.01, 1.01, '0.5', null, true]) {
      const response = await actor.command('action', { action: { type: 'input', [key]: value } });
      assert.equal(response.ok, false, `${key}: ${value}`);
      assert.deepEqual(
        room.game._input,
        input,
        'a rejected message does not replace the last accepted command',
      );
    }
  const release = { move: 0, thrustX: 0, thrustY: 0, reel: 0 };
  assert.equal((await actor.command('action', { action: { type: 'input', ...release } })).ok, true);
  assert.deepEqual(room.game._input, release);
  assert.equal(room.game._active().facing, -1);
});
