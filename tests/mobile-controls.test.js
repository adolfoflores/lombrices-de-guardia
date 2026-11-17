import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileJoystick, normalizeJoystick } from '../client/mobile-controls.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≈ ${expected}`);

class Stick extends EventTarget {
  constructor() {
    super();
    this.capture = new Set();
    this.attributes = new Map();
    this.properties = new Map();
    this.classes = new Set();
    this.dataset = {};
    this.style = { setProperty: (key, value) => this.properties.set(key, value) };
    this.classList = { add: (key) => this.classes.add(key), remove: (key) => this.classes.delete(key) };
    this.label = { textContent: '' };
    this.hint = { textContent: '' };
    this.parentElement = {
      querySelector: (selector) => (selector === '.stick-label' ? this.label : this.hint),
    };
  }
  querySelector() {
    return { offsetWidth: 44 };
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 120, height: 120 };
  }
  setAttribute(key, value) {
    this.attributes.set(key, value);
  }
  setPointerCapture(id) {
    this.capture.add(id);
  }
  hasPointerCapture(id) {
    return this.capture.has(id);
  }
  releasePointerCapture(id) {
    this.capture.delete(id);
    this.point('lostpointercapture', id);
  }
  point(type, pointerId = 1, clientX = 60, clientY = 60) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId, clientX, clientY, button: 0 });
    this.dispatchEvent(event);
    return event;
  }
}

test('joystick has a quiet center, continuous analog strength, and bounded diagonals', () => {
  assert.deepEqual(normalizeJoystick(4, -3, 40), { x: 0, y: 0 });
  for (const args of [
    [0, 0, 0],
    [NaN, 0, 40],
    [10, Infinity, 40],
    [10, 0, 40, 1],
  ])
    assert.deepEqual(normalizeJoystick(...args), { x: 0, y: 0 });
  const partial = normalizeJoystick(18, 0, 40),
    stronger = normalizeJoystick(30, 0, 40);
  assert.ok(partial.x > 0 && partial.x < stronger.x && stronger.x < 1);
  for (const [dx, dy, x, y] of [
    [80, 0, 1, 0],
    [-80, 0, -1, 0],
    [0, 80, 0, 1],
    [0, -80, 0, -1],
  ])
    assert.deepEqual(normalizeJoystick(dx, dy, 40), { x, y });
  for (let direction = 0; direction < Math.PI * 2; direction += 0.07) {
    const value = normalizeJoystick(Math.cos(direction) * 80, Math.sin(direction) * 80, 40);
    near(Math.hypot(value.x, value.y), 1);
  }
  const diagonal = normalizeJoystick(12, -12, 40);
  assert.ok(diagonal.x > 0 && diagonal.x < 1);
  near(diagonal.x, -diagonal.y);
});

test('small sideways thumb drift during climb or descent never turns the worm', () => {
  assert.deepEqual(normalizeJoystick(2, 40, 40), { x: 0, y: 1 });
  assert.deepEqual(normalizeJoystick(-2, -40, 40), { x: 0, y: -1 });
  assert.deepEqual(normalizeJoystick(40, -2, 40), { x: 1, y: 0 });
  assert.ok(normalizeJoystick(10, 40, 40).x > 0);
});

test('another touch cannot take over or release a held joystick', () => {
  const element = new Stick(),
    values = [];
  let starts = 0;
  const controller = createMobileJoystick(element, {
    onChange: (value) => values.push(value),
    onStart: () => starts++,
  });
  const down = element.point('pointerdown', 7, 110, 60);
  assert.ok(down.defaultPrevented);
  assert.deepEqual(values, [{ x: 1, y: 0 }]);
  element.point('pointerdown', 8, 10, 60);
  element.point('pointermove', 8, 10, 60);
  element.point('pointerup', 8);
  assert.equal(starts, 1);
  assert.equal(values.length, 1);
  assert.ok(element.hasPointerCapture(7));
  controller.setEnabled(true);
  controller.setEnabled(true);
  assert.equal(values.length, 1);
  assert.ok(element.hasPointerCapture(7));
  element.point('pointercancel', 7);
  element.point('lostpointercapture', 7);
  assert.deepEqual(values, [
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert.equal(element.properties.get('--stick-x'), '0px');
  assert.equal(element.capture.size, 0);
});

test('release, lost capture, disabling, and destruction each neutralize exactly once', () => {
  for (const finish of ['pointerup', 'lostpointercapture', 'disable', 'destroy']) {
    const element = new Stick(),
      values = [];
    const controller = createMobileJoystick(element, { axis: 'y', onChange: (value) => values.push(value) });
    element.point('pointerdown', 3, 60, 110);
    if (finish === 'disable') controller.setEnabled(false);
    else if (finish === 'destroy') controller.destroy();
    else element.point(finish, 3);
    controller.reset();
    element.point('pointerup', 3);
    assert.deepEqual(
      values,
      [
        { x: 0, y: 1 },
        { x: 0, y: 0 },
      ],
      finish,
    );
    if (finish === 'destroy') {
      element.point('pointerdown', 4, 110, 60);
      assert.equal(values.length, 2);
    }
    if (finish === 'disable') {
      assert.equal(element.disabled, true);
      element.point('pointerdown', 4, 110, 60);
      assert.equal(values.length, 2);
    }
  }
});

test('turn permission and contextual labels are reflected without stale movement', () => {
  const element = new Stick(),
    values = [];
  let allowed = false;
  const controller = createMobileJoystick(element, {
    canStart: () => allowed,
    onChange: (value) => values.push(value),
  });
  element.point('pointerdown', 1, 110, 60);
  assert.equal(values.length, 0);
  allowed = true;
  element.point('pointerdown', 1, 110, 60);
  allowed = false;
  element.point('pointermove', 1, 110, 60);
  assert.deepEqual(values, [
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ]);
  controller.setMode('rope');
  assert.equal(element.label.textContent, 'BALANCEAR');
  assert.match(element.hint.textContent, /Balancear/);
  controller.setMode('jetpack');
  assert.equal(element.label.textContent, 'VUELO');
  assert.match(element.hint.textContent, /Volar/);
  controller.setMode('move');
  assert.equal(element.label.textContent, 'MOVER');
  assert.match(element.attributes.get('aria-label'), /Izquierda o derecha/);
});

test('each circular stick ignores the other axis without weakening its allowed axis', () => {
  for (const axis of ['x', 'y']) {
    const element = new Stick(),
      values = [];
    createMobileJoystick(element, { axis, onChange: (value) => values.push(value) });
    element.point('pointerdown', 1, axis === 'x' ? 60 : 110, axis === 'y' ? 60 : 110);
    assert.deepEqual(values, [], 'Cross-axis drag stays neutral');
    assert.equal(element.properties.get('--stick-x'), '0px');
    assert.equal(element.properties.get('--stick-y'), '0px');
    element.point('pointermove', 1, axis === 'x' ? 80 : 160, axis === 'y' ? 80 : 160);
    const partial = values.at(-1);
    assert.ok(partial[axis] > 0 && partial[axis] < 1);
    assert.equal(partial[axis === 'x' ? 'y' : 'x'], 0);
    element.point('pointermove', 1, axis === 'x' ? 80 : -100, axis === 'y' ? 80 : -100);
    assert.deepEqual(values, [partial], 'Off-axis distance does not alter strength');
    assert.equal(element.properties.get(axis === 'x' ? '--stick-y' : '--stick-x'), '0px');
    element.point('pointermove', 1, 110, 110);
    assert.equal(values.at(-1)[axis], 1);
    element.point('pointerup', 1);
    assert.deepEqual(values.at(-1), { x: 0, y: 0 });
  }
});

test('two independently captured sticks combine axes and release without canceling the other', () => {
  const horizontal = new Stick(),
    vertical = new Stick(),
    input = { x: 0, y: 0 };
  const x = createMobileJoystick(horizontal, {
    axis: 'x',
    onChange: (value) => {
      input.x = value.x;
    },
  });
  const y = createMobileJoystick(vertical, {
    axis: 'y',
    onChange: (value) => {
      input.y = value.y;
    },
  });
  horizontal.point('pointerdown', 11, 110, 60);
  vertical.point('pointerdown', 12, 60, 10);
  assert.deepEqual(input, { x: 1, y: -1 });
  vertical.point('pointerup', 12);
  assert.deepEqual(input, { x: 1, y: 0 });
  assert.ok(horizontal.hasPointerCapture(11));
  vertical.point('pointerdown', 13, 60, 110);
  horizontal.point('pointercancel', 11);
  assert.deepEqual(input, { x: 0, y: 1 });
  y.setMode('jetpack');
  assert.match(vertical.attributes.get('aria-label'), /descender/);
  y.setMode('rope');
  assert.match(vertical.attributes.get('aria-label'), /alargar/);
  y.setMode('move');
  assert.match(vertical.attributes.get('aria-label'), /apuntar/);
  x.reset();
  y.reset();
  assert.deepEqual(input, { x: 0, y: 0 });
});
