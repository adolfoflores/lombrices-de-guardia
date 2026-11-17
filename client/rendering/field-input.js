import { slingshot, GRAB_RADIUS } from '../slingshot.js';
import { WORLD_W, WORLD_H, clamp } from './primitives.js';

export function canStartAim(renderer, point) {
  if (
    renderer.aimDrag ||
    renderer.pointers.size ||
    renderer.view.targeting ||
    !renderer.state ||
    !renderer.canAim()
  )
    return false;
  const worm = renderer.state.worms.find((w) => w.id === renderer.state.turn?.wormId && w.hp > 0);
  if (!worm) return false;
  const s = renderer.screenPoint(renderer.position(worm, performance.now()));
  return Math.hypot(s.x - point.x, s.y - point.y) <= GRAB_RADIUS;
}

export function updateAim(renderer, point) {
  const drag = renderer.aimDrag;
  drag.x = point.x;
  drag.y = point.y;
  Object.assign(
    drag,
    slingshot(point.x - drag.startX, point.y - drag.startY, renderer.view.sensitivity, drag.angle),
  );
  renderer.onAim({ angle: drag.angle, power: drag.power, cancel: drag.cancel });
}

export function endAim(renderer, fire, keepCapture = false) {
  const drag = renderer.aimDrag;
  if (!drag) return;
  renderer.aimDrag = null;
  // A finger that goes on panning keeps its capture; releasing it would fire lostpointercapture and drop the pan.
  if (!keepCapture)
    try {
      renderer.canvas.releasePointerCapture(drag.id);
    } catch {
      /* Capture may already be gone. */
    }
  renderer.onAimEnd(
    fire && !drag.cancel ? { fire: true, angle: drag.angle, power: drag.power } : { fire: false },
  );
}

export function cancelAim(renderer) {
  const drag = renderer.aimDrag;
  if (!drag) return;
  renderer.aimDrag = null;
  try {
    renderer.canvas.releasePointerCapture(drag.id);
  } catch {
    /* Capture may already be gone. */
  }
}

export function pointerDown(renderer, event) {
  if (event.button != null && event.button !== 0) return;
  event.preventDefault();
  const p = renderer.localPoint(event);
  if (renderer.canStartAim(p)) {
    renderer.aimDrag = {
      id: event.pointerId,
      startX: p.x,
      startY: p.y,
      x: p.x,
      y: p.y,
      angle: renderer.view.angle,
      power: 0.08,
      cancel: true,
    };
    try {
      renderer.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* Pointer may already have been interrupted. */
    }
    renderer.onAimStart();
    return;
  }
  // A second finger during the gesture means a camera gesture: no shot, both pointers pan or pinch.
  if (renderer.aimDrag) {
    const drag = renderer.aimDrag;
    renderer.pointers.set(drag.id, {
      x: drag.x,
      y: drag.y,
      startX: drag.startX,
      startY: drag.startY,
      time: performance.now(),
      moved: true,
    });
    renderer.endAim(false, true);
  }
  renderer.pointers.set(event.pointerId, {
    ...p,
    startX: p.x,
    startY: p.y,
    time: performance.now(),
    moved: false,
  });
  try {
    renderer.canvas.setPointerCapture(event.pointerId);
  } catch {
    /* Pointer may already have been interrupted. */
  }
  if (renderer.pointers.size > 1) {
    const points = [...renderer.pointers.values()];
    points.forEach((p) => {
      p.moved = true;
    });
    renderer.pinch = {
      distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
      center: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
    };
  }
}

export function pointerMove(renderer, event) {
  if (renderer.aimDrag?.id === event.pointerId) {
    event.preventDefault();
    renderer.updateAim(renderer.localPoint(event));
    return;
  }
  const prev = renderer.pointers.get(event.pointerId);
  if (!prev) return;
  event.preventDefault();
  const p = renderer.localPoint(event);
  const dx = p.x - prev.x,
    dy = p.y - prev.y;
  Object.assign(prev, p);
  prev.moved ||= Math.hypot(p.x - prev.startX, p.y - prev.startY) > 7;
  if (renderer.pointers.size > 1) {
    const points = [...renderer.pointers.values()],
      a = points[0],
      b = points[1];
    const distance = Math.hypot(a.x - b.x, a.y - b.y),
      center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (renderer.pinch?.distance > 0) {
      renderer.zoomAt(distance / renderer.pinch.distance, center);
      renderer.cameraGoal.x -= (center.x - renderer.pinch.center.x) / renderer.cameraGoal.zoom;
      renderer.cameraGoal.y -= (center.y - renderer.pinch.center.y) / renderer.cameraGoal.zoom;
    }
    renderer.pinch = { distance, center };
  } else if (prev.moved) {
    renderer.autoFollow = false;
    renderer.fullView = false;
    renderer.cameraGoal.x -= dx / renderer.camera.zoom;
    renderer.cameraGoal.y -= dy / renderer.camera.zoom;
    renderer.clampCamera(renderer.cameraGoal);
    renderer.onCamera();
  }
}

export function pointerUp(renderer, event) {
  if (renderer.aimDrag?.id === event.pointerId) {
    renderer.updateAim(renderer.localPoint(event));
    renderer.endAim(true);
    return;
  }
  const p = renderer.pointers.get(event.pointerId);
  if (!p) return;
  renderer.pointers.delete(event.pointerId);
  renderer.pinch = null;
  if (!p.moved && performance.now() - p.time < 500 && renderer.view.targeting && renderer.state) {
    const world = renderer.worldPoint(renderer.localPoint(event));
    renderer.target = { x: clamp(world.x, 0, WORLD_W), y: clamp(world.y, 0, WORLD_H) };
    renderer.onTarget(renderer.target.x, renderer.target.y);
  }
  try {
    renderer.canvas.releasePointerCapture(event.pointerId);
  } catch {
    /* Cancellation is harmless. */
  }
}

export function cancelPointer(renderer, event) {
  if (renderer.aimDrag?.id === event.pointerId) {
    renderer.endAim(false);
    return;
  }
  renderer.pointers.delete(event.pointerId);
  renderer.pinch = null;
}
