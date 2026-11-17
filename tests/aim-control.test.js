import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAimControl } from '../client/aim-control.js';

function fixture(t) {
  class Range extends EventTarget {
    value = '0';
    captured = null;
    setPointerCapture(id) {
      this.captured = id;
    }
    hasPointerCapture(id) {
      return this.captured === id;
    }
    releasePointerCapture() {
      this.captured = null;
    }
    getBoundingClientRect() {
      return { left: 100, width: 200 };
    }
  }
  const element = new Range();
  let angle = 0,
    allowed = true,
    refreshed = 0;
  const control = bindAimControl(element, {
    canAct: () => allowed,
    getAngle: () => angle,
    onAim: (value) => {
      angle = value;
    },
    refresh: () => {
      refreshed++;
    },
  });
  t.after(() => control.destroy());
  const dispatch = (type, x = 200, id = 1) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX: x, pointerId: id });
    element.dispatchEvent(event);
  };
  return {
    control,
    element,
    dispatch,
    get angle() {
      return angle;
    },
    get refreshed() {
      return refreshed;
    },
    disallow() {
      allowed = false;
    },
  };
}

test('captured aiming ignores other pointers and native input until the drag ends', (t) => {
  const f = fixture(t);
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 250, 2);
  assert.equal(f.angle, 0);
  f.element.value = '90';
  f.dispatch('input');
  assert.equal(f.angle, 0);
  assert.equal(f.refreshed, 1);
  f.dispatch('pointermove', 250);
  assert.equal(f.angle, Math.PI / 2);
  f.dispatch('pointerup', 250, 2);
  assert.equal(f.control.active, true);
  f.dispatch('pointerup', 250);
  assert.equal(f.control.active, false);
  assert.equal(f.element.captured, null);
  f.element.value = '-45';
  f.dispatch('input');
  assert.equal(f.angle, -Math.PI / 4);
});

test('facing changes rebase a held drag and reset cancels it without a late tap', (t) => {
  const f = fixture(t);
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 210);
  f.control.mirror(-Math.PI / 2);
  f.dispatch('pointermove', 220);
  assert.ok(Math.abs(f.angle - (-Math.PI / 2 + Math.PI / 10)) < 1e-10);
  const before = f.angle;
  f.control.reset();
  f.dispatch('pointerup', 300);
  assert.equal(f.angle, before);
  assert.equal(f.control.active, false);
  f.disallow();
  f.dispatch('pointerdown');
  assert.equal(f.control.active, false);
});

test('tap aiming, capture loss and destruction release the same controller cleanly', (t) => {
  const f = fixture(t);
  f.dispatch('pointerdown', 250);
  f.dispatch('pointerup', 250);
  assert.equal(f.angle, Math.PI / 2);
  f.dispatch('pointerdown');
  f.dispatch('lostpointercapture');
  assert.equal(f.control.active, false);
  f.control.destroy();
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 100);
  assert.equal(f.control.active, false);
  assert.equal(f.angle, Math.PI / 2);
});
