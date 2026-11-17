import { clamp, REPLAY_TAIL_MS, SNAPSHOT_MS, BLOW_EVENTS } from './primitives.js';

export function prepareReplay(renderer, { seconds = 4 } = {}) {
  const live = renderer.state;
  if (renderer.replaying || renderer.destroyed || !renderer.finalBlow || live?.phase !== 'finished')
    return null;
  const finishedAt = renderer.finalBlow.at;
  renderer.finalBlow = null;
  const frames = renderer.history.filter((entry) => entry.at >= finishedAt - seconds * 1000);
  frames.push({ state: live, at: finishedAt });
  if (frames.length < 2 || !renderer._hasBlow(frames)) return null;
  const run = {
    frames,
    index: 0,
    start: null,
    rate: 1,
    eventIds: renderer.eventIds,
    playerId: renderer.view.playerId,
    live: null,
    resolve: null,
  };
  run.promise = new Promise((resolve) => {
    run.resolve = resolve;
  });
  return run;
}

export function replayFinalBlow(renderer, options = {}) {
  const run = renderer.prepareReplay(options);
  return run ? renderer.startReplay(run, options) : null;
}

export function startReplay(renderer, run, { rate = 1 } = {}) {
  if (renderer.replaying || renderer.destroyed || !run) return null;
  run.rate = clamp(Number(rate) || 1, 0.25, 1);
  renderer.snapshotWindow = SNAPSHOT_MS / run.rate;
  renderer.replaying = run;
  // Events inside the window fire again; the first frame's history counts as already seen.
  renderer.eventIds = new Set((run.frames[0].state.events || []).map((event) => event.id));
  renderer.effects = [];
  renderer.impactFocus = null;
  renderer.shake = 0;
  renderer.pixi?.clear();
  // The viewer watches as a spectator: recorded poses, every health plate and no local aim guide.
  renderer.view.playerId = null;
  renderer.focus();
  renderer._mountSkip();
  return run.promise;
}

export function skipReplay(renderer) {
  renderer.endReplay();
}

export function endReplay(renderer) {
  const run = renderer.replaying;
  if (!run) return;
  renderer.replaying = null;
  renderer.snapshotWindow = SNAPSHOT_MS;
  renderer.eventIds = run.eventIds;
  renderer.view.playerId = run.playerId;
  renderer.skipButton?.remove();
  renderer.skipButton = null;
  // Back to the final authoritative state; its events are already known, so nothing plays twice.
  if (!renderer.destroyed) renderer._apply(run.live || run.frames.at(-1).state, performance.now(), 'restore');
  run.resolve();
}

export function _hasBlow(renderer, frames) {
  const seen = new Set((frames[0].state.events || []).map((event) => event.id));
  for (const { state } of frames.slice(1))
    for (const event of state.events || []) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      if (BLOW_EVENTS.has(event.type)) return true;
    }
  return false;
}

export function _mountSkip(renderer) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'replay-skip';
  button.className = 'replay-skip';
  button.setAttribute('aria-label', 'Saltar la repetición');
  button.innerHTML = '<span>Saltar</span><span aria-hidden="true">▸▸</span>';
  button.addEventListener('click', () => renderer.endReplay());
  (renderer.canvas.parentElement || document.body).append(button);
  renderer.skipButton = button;
}

export function stepReplay(renderer, now) {
  const run = renderer.replaying;
  if (run.start === null) run.start = now;
  const elapsed = (now - run.start) * run.rate,
    origin = run.frames[0].at;
  while (run.index < run.frames.length && run.frames[run.index].at - origin <= elapsed)
    renderer._apply(run.frames[run.index++].state, now, 'replay');
  if (run.index >= run.frames.length && elapsed >= run.frames.at(-1).at - origin + REPLAY_TAIL_MS)
    renderer.endReplay();
}
