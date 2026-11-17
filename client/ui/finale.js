import { escape } from './text.js';

/** Own only the verdict/replay presentation; room state remains authoritative. */
export function playFinale({ renderer, copy, reducedMotion = false, onEnd }) {
  const game = document.querySelector('.game');
  const run = renderer.prepareReplay({ seconds: reducedMotion ? 2 : 4 });
  const overlay = document.createElement('div');
  overlay.className = 'finale';
  overlay.id = 'finale';
  overlay.dataset.phase = 'verdict';
  overlay.dataset.tone = copy.tone;
  overlay.setAttribute('role', 'status');
  overlay.innerHTML = `<div class="finale-card"><span class="finale-kicker">FIN DE LA PARTIDA</span><h2 class="finale-title">${escape(copy.title)}</h2><p class="finale-sub">${escape(copy.sub)}</p></div><div class="finale-replay"><span class="finale-dot" aria-hidden="true"></span><strong>REPETICIÓN</strong></div>`;
  document.querySelector('.battlefield').append(overlay);
  game.classList.add('is-finale');
  const timers = [];
  let closed = false;
  const destroy = () => {
    closed = true;
    timers.forEach(clearTimeout);
    overlay.remove();
    game.classList.remove('is-finale');
  };
  const end = () => {
    if (closed) return;
    destroy();
    onEnd();
  };
  const after = (ms, fn) => timers.push(setTimeout(fn, ms));
  overlay.addEventListener('click', () => {
    if (renderer.replaying) renderer.skipReplay();
    else end();
  });
  const verdictMs = reducedMotion ? 1200 : 1900;
  const introMs = reducedMotion ? 500 : 900;
  if (!run) after(verdictMs, end);
  else {
    after(verdictMs, () => {
      overlay.dataset.phase = 'intro';
    });
    after(verdictMs + introMs, () => {
      overlay.dataset.phase = 'playing';
      const playback = renderer.startReplay(run, { rate: 0.75 });
      if (playback) playback.then(end);
      else end();
    });
  }
  return { destroy };
}
