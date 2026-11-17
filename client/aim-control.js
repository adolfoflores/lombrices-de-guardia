/** Native keyboard input and captured relative pointer aiming share one lifecycle. */
export function bindAimControl(
  element,
  { canAct, getAngle, onAim, refresh, onChange = () => {}, sensitivity = () => 1 },
) {
  let gesture = null;
  const listeners = [];
  const listen = (type, handler) => {
    element.addEventListener(type, handler);
    listeners.push([type, handler]);
  };
  const reset = () => {
    const current = gesture;
    gesture = null;
    if (current && element.hasPointerCapture?.(current.id)) element.releasePointerCapture(current.id);
    if (current) onChange();
  };
  listen('input', (event) => {
    if (gesture) refresh();
    else onAim((Number(event.target.value) * Math.PI) / 180);
  });
  listen('pointerdown', (event) => {
    if (!canAct() || gesture) return;
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      originX: event.clientX,
      lastX: event.clientX,
      dragged: false,
      angle: getAngle(),
    };
    onChange();
  });
  listen('pointermove', (event) => {
    if (gesture?.id !== event.pointerId) return;
    event.preventDefault();
    gesture.lastX = event.clientX;
    if (Math.abs(event.clientX - gesture.originX) >= 4) gesture.dragged = true;
    const width = element.getBoundingClientRect().width;
    if (width <= 0) return;
    onAim(
      Math.max(
        -Math.PI,
        Math.min(
          Math.PI,
          gesture.angle + ((event.clientX - gesture.x) / width) * Math.PI * 2 * sensitivity(),
        ),
      ),
    );
  });
  listen('pointerup', (event) => {
    if (gesture?.id !== event.pointerId) return;
    if (!gesture.dragged && Math.abs(event.clientX - gesture.originX) < 4) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0)
        onAim(
          Math.max(
            -Math.PI,
            Math.min(Math.PI, (((event.clientX - rect.left) / rect.width) * 2 - 1) * Math.PI),
          ),
        );
    }
    reset();
  });
  for (const type of ['pointercancel', 'lostpointercapture'])
    listen(type, (event) => {
      if (event.pointerId === gesture?.id) reset();
    });
  return {
    get active() {
      return !!gesture;
    },
    mirror(angle) {
      if (!gesture) return;
      gesture.angle = angle;
      gesture.x = gesture.lastX;
      gesture.dragged = true;
    },
    reset,
    destroy() {
      reset();
      listeners.forEach(([type, handler]) => element.removeEventListener(type, handler));
    },
  };
}
