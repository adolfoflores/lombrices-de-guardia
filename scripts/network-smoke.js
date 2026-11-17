import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { createServer } from '../server/index.js';
import { Terrain } from '../shared/terrain.js';

export { NetworkClient, waitFor } from '../tests/helpers/network-client.js';
import { NetworkClient, waitFor } from '../tests/helpers/network-client.js';

/** Independent sockets through the real HTTP/WebSocket service, with no direct game mutations. */
export async function runNetworkSmoke() {
  const app = await createServer();
  const clients = [];
  const evidence = [];
  try {
    for (let index = 0; index < 6; index++) clients.push(await NetworkClient.connect(app.port));
    assert.equal((await clients[0].command('create', { name: 'Capitana' })).ok, true);
    const code = clients[0].identity.code;
    for (const [index, client] of clients.entries())
      if (index)
        assert.equal((await client.command('join', { code, name: `Tripulación ${index + 1}` })).ok, true);
    await waitFor(() => clients.every((client) => client.room?.players.length === 6));
    assert.equal(new Set(clients.map((client) => client.identity.playerId)).size, 6);
    for (const client of clients) assert.equal((await client.command('ready', { ready: true })).ok, true);
    assert.equal((await clients[0].command('start')).ok, true);
    for (const client of clients) assert.equal((await client.command('loaded')).ok, true);
    await waitFor(() => clients.every((client) => client.state?.worms.length === 12));
    const initialRevision = clients[0].state.terrainRevision;
    const active = clients.find((client) => client.identity.playerId === clients[0].state.turn.playerId);
    assert.equal(
      (await active.command('action', { action: { type: 'input', move: 1, aim: -0.9 } })).ok,
      true,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    assert.equal((await active.command('action', { action: { type: 'input', move: 0 } })).ok, true);
    assert.equal(
      (
        await active.command('action', {
          action: { type: 'fire', weapon: 'bazooka', angle: 1.1, power: 0.15 },
        })
      ).ok,
      true,
    );
    await waitFor(() => clients.every((client) => client.state.terrainRevision > initialRevision), 8000);
    const collisionTerrain = app.rooms.get(code).game.terrain.data;
    for (const client of clients) assert.deepEqual(Terrain.decode(client.terrain), collisionTerrain);
    evidence.push({
      check: 'six-independent-clients',
      clients: clients.length,
      worms: clients[0].state.worms.length,
      terrainRevision: clients[0].state.terrainRevision,
      terrainMatchesCollisions: true,
    });
    const saved = clients[5].identity;
    clients[5].close();
    await waitFor(() =>
      clients[0].room.players.some((player) => player.id === saved.playerId && !player.connected),
    );
    const reconnected = await NetworkClient.connect(app.port);
    clients[5] = reconnected;
    assert.equal((await reconnected.command('resume', { code, token: saved.token })).ok, true);
    assert.equal(reconnected.identity.playerId, saved.playerId);
    assert.ok(reconnected.terrain);
    assert.ok(reconnected.state.terrainRevision > initialRevision);
    evidence.push({
      check: 'reconnect',
      identityPreserved: true,
      fullTerrain: true,
      revision: reconnected.state.terrainRevision,
    });
    // Explicit surrender is a supported finish path; the five departed players forfeit.
    for (let index = 0; index < 5; index++) assert.equal((await clients[index].command('leave')).ok, true);
    await waitFor(() => reconnected.room?.phase === 'finished');
    assert.deepEqual(reconnected.state.result.winnerIds, [saved.playerId]);
    assert.equal((await reconnected.command('rematch')).ok, true);
    assert.equal(reconnected.room.phase, 'lobby');
    evidence.push({ check: 'host-transfer-finish-rematch', winner: true, lobbyRetained: true });
    return evidence;
  } finally {
    for (const client of clients) client.close();
    await app.close();
  }
}

/** Accelerates only authoritative simulation time; transport uses the live 15 Hz broadcaster. */
export async function runNetworkStress() {
  const app = await createServer();
  const clients = [];
  const evidence = [];
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  try {
    for (let index = 0; index < 6; index++) clients.push(await NetworkClient.connect(app.port));
    await clients[0].command('create', { name: 'Stress 1' });
    const code = clients[0].identity.code;
    for (let index = 1; index < 6; index++)
      await clients[index].command('join', { name: `Stress ${index + 1}`, code });
    const room = app.rooms.get(code);
    for (const [mapId, mode] of [
      ['hills', 'ffa'],
      ['cavern', '3v3'],
      ['islands', '2v2v2'],
    ]) {
      if (room.phase === 'finished') assert.equal((await clients[0].command('rematch')).ok, true);
      assert.equal((await clients[0].command('settings', { settings: { mapId, mode, worms: 4 } })).ok, true);
      for (let index = 0; index < 6; index++) {
        await clients[index].command('team', {
          team: mode === '2v2v2' ? Math.floor(index / 2) : Math.floor(index / 3),
        });
        await clients[index].command('ready', { ready: true });
      }
      await clients[0].command('start');
      for (const client of clients) await client.command('loaded');
      const initialBytes = clients.reduce((sum, client) => sum + client.bytes, 0);
      const initialSnapshots = clients.reduce((sum, client) => sum + client.states, 0);
      const started = performance.now();
      const initialCpu = process.cpuUsage();
      delay.reset();
      let attacks = 0;
      let peakRss = process.memoryUsage().rss;
      while (room.phase === 'playing' && room.game.elapsed < 1250) {
        const game = room.game;
        const actor = clients.find((client) => client.identity.playerId === game.turn.playerId);
        const worm = game.worms.find((worm) => worm.id === game.turn.wormId);
        if (game.turn.stage === 'action' && worm?.hp > 0) {
          const player = game.players.find((player) => player.id === actor.identity.playerId);
          const target = game.worms
            .filter((worm) => worm.hp > 0 && worm.team !== player.team)
            .sort((a, b) => Math.abs(a.x - worm.x) - Math.abs(b.x - worm.x))[0];
          const weapon =
            mapId !== 'cavern' && player.ammo.airstrike > 0
              ? 'airstrike'
              : player.ammo.cluster > 0
                ? 'cluster'
                : 'bazooka';
          const angle = target && target.x < worm.x ? -Math.PI + 0.7 : -0.7;
          const power = Math.max(0.3, Math.min(0.85, Math.abs((target?.x || 800) - worm.x) / 800));
          const result = await actor.command('action', {
            action: { type: 'fire', weapon, angle, power, x: target?.x || 800, y: target?.y || 450 },
          });
          if (result.ok) attacks++;
        }
        // 300 exact fixed steps per batch (5s game time), then give HTTP/WS their normal cadence.
        for (let step = 0; step < 20 && game.phase === 'playing'; step++) game.step(0.25);
        await new Promise((resolveWait) => setTimeout(resolveWait, 70));
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
      }
      await waitFor(() => clients.every((client) => client.room.phase === 'finished'));
      for (const client of clients) assert.deepEqual(Terrain.decode(client.terrain), room.game.terrain.data);
      assert.equal(room.players.length, 6);
      assert.ok(room.game.result);
      assert.ok(room.game.terrain.revision > 5);
      const cpu = process.cpuUsage(initialCpu);
      evidence.push({
        mapId,
        mode,
        independentClients: 6,
        worms: 24,
        completed: true,
        simulatedSeconds: Number(room.game.elapsed.toFixed(1)),
        wallSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
        attacks,
        terrainRevision: room.game.terrain.revision,
        terrainMatchesCollisions: true,
        receivedSnapshots: clients.reduce((sum, client) => sum + client.states, 0) - initialSnapshots,
        receivedMiB: Number(
          ((clients.reduce((sum, client) => sum + client.bytes, 0) - initialBytes) / 1048576).toFixed(2),
        ),
        cpuSeconds: Number(((cpu.user + cpu.system) / 1e6).toFixed(2)),
        peakRssMiB: Number((peakRss / 1048576).toFixed(1)),
        eventLoopP95Ms: Number((delay.percentile(95) / 1e6).toFixed(2)),
        eventLoopMaxMs: Number((delay.max / 1e6).toFixed(2)),
      });
    }
    return evidence;
  } finally {
    delay.disable();
    for (const client of clients) client.close();
    await app.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(
    JSON.stringify(
      process.argv.includes('--stress')
        ? {
            scenario:
              'Accelerated full-match server stress; real six-client sockets, synthetic simulation time',
            evidence: await runNetworkStress(),
          }
        : { scenario: 'Real six-client network smoke', evidence: await runNetworkSmoke() },
      null,
      2,
    ),
  );
}
