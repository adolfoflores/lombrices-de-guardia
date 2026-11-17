const SEGMENTS = 13;
const point = (angle, radius) => {
  const radians = (angle * Math.PI) / 180;
  return `${(50 + Math.cos(radians) * radius).toFixed(3)} ${(50 + Math.sin(radians) * radius).toFixed(3)}`;
};

export function chargeIndicatorMarkup() {
  const segments = Array.from({ length: SEGMENTS }, (_, index) => {
    const start = 142 + index * 20,
      end = start + 16;
    const path = `M ${point(start, 40)} A 40 40 0 0 1 ${point(end, 40)}`;
    return `<path class="charge-slot" d="${path}"/><path class="charge-segment" pathLength="1" style="--segment:${index}" d="${path}"/>`;
  }).join('');
  return `<svg class="charge-indicator" data-slot="charge-indicator" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle class="charge-shell" cx="50" cy="50" r="47"/><circle class="charge-liner" cx="50" cy="50" r="33"/>${segments}<path class="charge-index" d="M 42 90 H 58 M 46 94 H 54"/><g class="charge-marker"><path d="M 97 46 L 89 50 L 97 54 Z"/><path class="charge-marker-tail" d="M 96 50 H 99"/></g></svg>`;
}

/** Presentation only. The caller owns charging, shot acceptance and captions. */
export function createChargeIndicator(button) {
  let state = 'idle',
    lastPower = -1,
    enabled = false,
    reducedMotion = false,
    timer = null,
    destroyed = false;

  function setState(next) {
    if (state === next) return;
    state = next;
    button.classList.toggle('is-charging', next === 'charging');
    button.classList.toggle('is-fired', next === 'fired');
  }

  function setPower(value) {
    const next = Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 1000) / 1000;
    if (next === lastPower) return;
    lastPower = next;
    button.style.setProperty('--charge-power', String(next));
    button.classList.toggle('is-hot', next >= 0.8);
    button.classList.toggle('is-full', next >= 0.995);
  }

  function stopTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function cancel() {
    stopTimer();
    setState('idle');
  }

  return {
    update({
      charging = false,
      power = 0,
      enabled: nextEnabled = false,
      reducedMotion: nextReduced = false,
    }) {
      if (destroyed) return;
      enabled = !!nextEnabled;
      if (reducedMotion !== !!nextReduced) {
        reducedMotion = !!nextReduced;
        button.classList.toggle('charge-reduced', reducedMotion);
      }
      if (charging && enabled) {
        stopTimer();
        setPower(power);
        setState('charging');
      } else if (state === 'charging') cancel();
      // A completed shot keeps its short confirmation even when the ensuing
      // retreat disables the button. Explicit cancellation always clears it.
    },
    release({ power = 0 } = {}) {
      if (destroyed || !enabled) return;
      stopTimer();
      setPower(power);
      setState('fired');
      timer = setTimeout(() => {
        timer = null;
        setState('idle');
      }, 220);
    },
    cancel,
    destroy() {
      cancel();
      destroyed = true;
    },
  };
}
