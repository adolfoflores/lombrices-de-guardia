// Reproduce with: node scripts/simulation-benchmark.js
// This is a deterministic acceptance fixture, not a playable bot or game mode.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Game } from '../shared/engine.js';
import { CONFIG, MAPS } from '../shared/config.js';
import { Terrain } from '../shared/terrain.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, process.argv[2] || 'docs/evidence/simulation.json');
const seed = 71;
const sourceHashes = {};
for (const filename of [
  'shared/engine.js',
  'shared/config.js',
  'shared/terrain.js',
  'shared/actions.js',
  'shared/physics.js',
  'shared/statistics.js',
]) {
  sourceHashes[filename] = createHash('sha256')
    .update(await readFile(path.join(root, filename)))
    .digest('hex');
}
const report = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  command: 'node scripts/simulation-benchmark.js',
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
  },
  sourceHashes,
  method: {
    seed,
    maps: MAPS.map((map) => map.id),
    mode: 'ffa',
    players: 6,
    wormsPerPlayer: 4,
    initialHealth: CONFIG.initialHealth,
    fixedTickHz: CONFIG.tickRate,
    snapshotsHz: 15,
    maximumSimulatedSeconds: 1000,
    actionPolicy:
      'Immediately on each new turn, aim toward the nearest enemy by horizontal distance. Every third attack is a grenade; otherwise bazooka. Angle is -0.65 or -PI+0.65; power cycles 0.32, 0.43, 0.54, 0.65, 0.76. All attacks go through Game.action.',
    snapshots:
      'Serialize an authoritative snapshot every four simulation ticks, including terrain only after a revision. Byte counts are UTF-8 JSON payload sizes for one recipient, before transport compression.',
    timing:
      'Accelerated local simulation. Tick samples wrap Game.step only; total wall time also includes action choice, snapshots, serialization, and sampling.',
    memory:
      'Peak JavaScript heap sampled every 600 ticks. This process also holds benchmark timing samples and prior-game allocations pending garbage collection; these values do not demonstrate or rule out a memory leak.',
    limitations: [
      'Instant-action scripted match durations are technical fixture results, not human playtesting or a promise of 10–15 minute matches.',
      'This measures local simulation and serialization, not browser FPS, network throughput, mobile memory, or real-time sustained server load.',
      'All three games use six players and four worms per player; the default roster has two worms.',
    ],
  },
  games: [],
};

for (const map of MAPS) {
  const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Crew ${i}`, team: i % 3 }));
  const game = new Game(players, { mapId: map.id, mode: 'ffa', worms: 4 }, { seed });
  const samples = [];
  const started = performance.now();
  let actedTurn = 0,
    attacks = 0,
    steps = 0,
    snapshots = 0,
    bytes = 0;
  let lastRevision = -1,
    peakHeap = 0,
    maxSettling = 0,
    settling = 0;
  while (game.phase === 'playing' && steps < 1000 * CONFIG.tickRate) {
    if (game.turn.number !== actedTurn && game.turn.stage === 'action') {
      actedTurn = game.turn.number;
      const shooter = game._active();
      const target = game.worms
        .filter((worm) => worm.hp > 0 && worm.team !== shooter.team)
        .sort((a, b) => Math.abs(a.x - shooter.x) - Math.abs(b.x - shooter.x))[0];
      if (target) {
        const action = game.action(game.turn.playerId, {
          type: 'fire',
          weapon: attacks % 3 ? 'bazooka' : 'grenade',
          angle: target.x > shooter.x ? -0.65 : -Math.PI + 0.65,
          power: 0.32 + (attacks % 5) * 0.11,
        });
        assert.equal(action.ok, true, action.error);
        attacks++;
      }
    }
    const beforeTick = performance.now();
    game.step();
    samples.push(performance.now() - beforeTick);
    steps++;
    settling = game.turn.stage === 'settling' ? settling + 1 / CONFIG.tickRate : 0;
    maxSettling = Math.max(maxSettling, settling);
    assert.ok(settling < 20, `${map.id}: prolonged physics settlement`);
    if (steps % 4 === 0) {
      const state = game.snapshot(lastRevision !== game.terrain.revision);
      lastRevision = game.terrain.revision;
      bytes += Buffer.byteLength(JSON.stringify(state), 'utf8');
      snapshots++;
    }
    if (steps % 600 === 0) peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  }
  assert.equal(game.phase, 'finished', `${map.id}: match exceeded simulation horizon`);
  assert.equal(game._hasPending(), false, 'result cannot precede pending effects');
  assert.deepEqual(Terrain.decode(game.snapshot().terrain), game.terrain.data);
  for (const worm of game.worms)
    assert.ok([worm.x, worm.y, worm.vx, worm.vy, worm.hp].every(Number.isFinite));
  samples.sort((a, b) => a - b);
  const round = (value, digits) => Number(value.toFixed(digits));
  const entry = {
    mapId: map.id,
    phase: game.phase,
    simulatedSeconds: round(game.elapsed, 1),
    attacks,
    turns: game.turn.number,
    terrainRevisions: game.terrain.revision,
    maxSettlingSeconds: round(maxSettling, 2),
    steps,
    snapshots,
    wallMs: round(performance.now() - started, 1),
    tickMeanMs: round(samples.reduce((sum, time) => sum + time, 0) / samples.length, 4),
    tickP95Ms: round(samples[Math.floor(samples.length * 0.95)], 4),
    tickP99Ms: round(samples[Math.floor(samples.length * 0.99)], 4),
    meanSnapshotBytes: Math.round(bytes / snapshots),
    peakHeapMiB: round(peakHeap / 1048576, 1),
    result: game.result,
    verified: {
      allEffectsResolved: true,
      terrainRoundTripExact: true,
      finiteWormState: true,
      noSettlementStalls: true,
    },
  };
  report.games.push(entry);
  console.log(
    `${entry.mapId}: ${entry.simulatedSeconds}s simulated, ${entry.attacks} attacks, p95 ${entry.tickP95Ms}ms`,
  );
}

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Saved ${path.relative(root, output)}`);
