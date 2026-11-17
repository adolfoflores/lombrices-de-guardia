const MODES = {
  move: {
    x: {
      label: 'MOVER',
      hint: '← Mover →',
      description: 'Control horizontal. Izquierda o derecha para moverte. Conserva la inclinación del tiro.',
    },
    y: {
      label: 'APUNTAR',
      hint: '↑ Apuntar ↓',
      description: 'Control vertical. Arriba o abajo para apuntar. Al centrarlo conservas el tiro.',
    },
  },
  rope: {
    x: {
      label: 'BALANCEAR',
      hint: '← Balancear →',
      description: 'Control horizontal de cuerda. Izquierda o derecha para balancearte.',
    },
    y: {
      label: 'CUERDA',
      hint: '↑ Acortar · ↓ Alargar',
      description: 'Control vertical de cuerda. Arriba para acortar; abajo para alargar.',
    },
  },
  jetpack: {
    x: {
      label: 'VUELO',
      hint: '← Volar →',
      description: 'Control horizontal de vuelo. Izquierda o derecha para desplazar el jetpack.',
    },
    y: {
      label: 'VUELO',
      hint: '↑ Subir · ↓ Bajar',
      description: 'Control vertical de vuelo. Arriba para subir; abajo para descender con el jetpack.',
    },
  },
};

export function mobileJoystickMarkup(axis = 'x') {
  const vertical = axis === 'y',
    id = vertical ? 'aim-stick' : 'move-stick',
    prefix = vertical ? 'aim-stick' : 'stick';
  const presentation = MODES.move[vertical ? 'y' : 'x'];
  return `<div class="mobile-joystick" data-axis="${vertical ? 'y' : 'x'}" data-slot="joystick"><span id="${prefix}-label" class="stick-label">${presentation.label}</span><button type="button" id="${id}" class="stick-pad" data-axis="${vertical ? 'y' : 'x'}" data-slot="joystick-pad" aria-label="${presentation.description}" aria-describedby="${prefix}-hint"><span class="stick-axis stick-axis-x" aria-hidden="true"></span><span class="stick-axis stick-axis-y" aria-hidden="true"></span><span class="stick-knob" data-slot="joystick-thumb" aria-hidden="true"><span></span></span></button><span id="${prefix}-hint" class="stick-hint">${presentation.hint}</span></div>`;
}

// A radial dead zone keeps resting thumbs still without favoring diagonals.
// Beyond it, the full travel maps continuously to a unit circle.
export function normalizeJoystick(dx, dy, radius, deadzone = 0.14) {
  if (![dx, dy, radius, deadzone].every(Number.isFinite) || radius <= 0 || deadzone < 0 || deadzone >= 1)
    return { x: 0, y: 0 };
  const distance = Math.hypot(dx, dy),
    magnitude = Math.min(1, distance / radius);
  if (magnitude <= deadzone) return { x: 0, y: 0 };
  const strength = (magnitude - deadzone) / (1 - deadzone);
  let x = dx / distance,
    y = dy / distance;
  // A small cardinal lock prevents thumb drift during a vertical climb from
  // flipping the worm and weapon. Partial diagonal travel remains analog.
  if (Math.abs(x) < 0.1) {
    x = 0;
    y = Math.sign(y);
  } else if (Math.abs(y) < 0.1) {
    y = 0;
    x = Math.sign(x);
  }
  return { x: x * strength, y: y * strength };
}

export function createMobileJoystick(
  element,
  { axis = 'x', canStart = () => true, onChange, onStart = () => {} },
) {
  const knob = element.querySelector('.stick-knob');
  const label = element.parentElement.querySelector('.stick-label');
  const hint = element.parentElement.querySelector('.stick-hint');
  const vertical = axis === 'y';
  let enabled = true,
    pointerId = null,
    origin = null,
    value = { x: 0, y: 0 };
  const handlers = new Map();

  function show(x, y) {
    element.style.setProperty('--stick-x', `${x}px`);
    element.style.setProperty('--stick-y', `${y}px`);
  }

  function reset() {
    const id = pointerId,
      engaged = id !== null || value.x !== 0 || value.y !== 0;
    pointerId = null;
    origin = null;
    value = { x: 0, y: 0 };
    element.classList.remove('is-held');
    show(0, 0);
    if (id !== null && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    if (engaged) onChange({ x: 0, y: 0 });
  }

  function update(event) {
    // Project before the dead zone and visual travel: drifting across the other
    // axis cannot change strength, facing or the independent stick's input.
    const dx = vertical ? 0 : event.clientX - origin.x,
      dy = vertical ? event.clientY - origin.y : 0;
    const distance = Math.hypot(dx, dy),
      visualScale = distance > origin.radius ? origin.radius / distance : 1;
    show(dx * visualScale, dy * visualScale);
    const next = normalizeJoystick(dx, dy, origin.radius);
    if (Math.abs(next.x - value.x) > 0.0001 || Math.abs(next.y - value.y) > 0.0001) {
      value = next;
      onChange({ ...value });
    }
  }

  function listen(type, handler) {
    handlers.set(type, handler);
    element.addEventListener(type, handler);
  }
  listen('pointerdown', (event) => {
    if (!enabled || pointerId !== null || event.button !== 0 || !canStart()) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = element.getBoundingClientRect();
    origin = {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
      radius: Math.max(1, (Math.min(bounds.width, bounds.height) - knob.offsetWidth) / 2),
    };
    pointerId = event.pointerId;
    element.setPointerCapture(pointerId);
    element.classList.add('is-held');
    onStart();
    update(event);
  });
  listen('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (!enabled || !canStart()) {
      reset();
      return;
    }
    update(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    listen(type, (event) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
    });
  }

  return {
    reset,
    destroy() {
      reset();
      for (const [type, handler] of handlers) element.removeEventListener(type, handler);
    },
    setEnabled(next) {
      enabled = !!next;
      if (!enabled) reset();
      element.disabled = !enabled;
      element.setAttribute('aria-disabled', String(!enabled));
    },
    setMode(mode) {
      const presentation = (MODES[mode] || MODES.move)[vertical ? 'y' : 'x'];
      if (label.textContent !== presentation.label) label.textContent = presentation.label;
      if (hint.textContent !== presentation.hint) hint.textContent = presentation.hint;
      element.setAttribute('aria-label', presentation.description);
      element.dataset.mode = mode in MODES ? mode : 'move';
    },
  };
}
