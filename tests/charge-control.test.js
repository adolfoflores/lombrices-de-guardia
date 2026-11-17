import test from 'node:test';
import assert from 'node:assert/strict';
import { chargeIndicatorMarkup, createChargeIndicator } from '../client/charge-control.js';

function button() {
  const classes = new Set(),
    properties = new Map();
  return {
    classes,
    properties,
    classList: {
      toggle(key, on) {
        if (on) classes.add(key);
        else classes.delete(key);
      },
    },
    style: {
      setProperty(key, value) {
        properties.set(key, value);
      },
    },
  };
}

test('charge dial remains decorative and never replaces the fire button caption', () => {
  const markup = chargeIndicatorMarkup();
  assert.match(markup, /aria-hidden="true"/);
  assert.match(markup, /focusable="false"/);
  assert.equal((markup.match(/class="charge-segment"/g) || []).length, 13);
  assert.doesNotMatch(markup, /<button|id="fire-text"|id="power-text"/);
});

test('only chargeable weapons show the dial; progress is clamped and repeated frames do not rewrite it', () => {
  const element = button();
  let writes = 0;
  element.style.setProperty = (key, value) => {
    writes++;
    element.properties.set(key, value);
  };
  const dial = createChargeIndicator(element);
  dial.update({ enabled: false, charging: true, power: 0.6 });
  assert.ok(!element.classes.has('is-charging'));
  assert.equal(writes, 0);
  dial.update({ enabled: true, charging: true, power: 0.25 });
  assert.ok(element.classes.has('is-charging'));
  assert.equal(element.properties.get('--charge-power'), '0.25');
  for (let i = 0; i < 60; i++) dial.update({ enabled: true, charging: true, power: 0.25 });
  assert.equal(writes, 1);
  dial.update({ enabled: true, charging: true, power: 8 });
  assert.equal(element.properties.get('--charge-power'), '1');
  assert.ok(element.classes.has('is-hot'));
  assert.ok(element.classes.has('is-full'));
  dial.update({ enabled: true, charging: false, power: 1 });
  assert.ok(!element.classes.has('is-charging'));
  assert.ok(!element.classes.has('is-fired'));
});

test('a shot confirms briefly through the retreat transition, then clears itself', async () => {
  const element = button(),
    dial = createChargeIndicator(element);
  dial.update({ enabled: true, charging: true, power: 0.7 });
  dial.release({ power: 0.7 });
  dial.update({ enabled: false, charging: false, power: 0.7 });
  assert.ok(element.classes.has('is-fired'));
  assert.ok(!element.classes.has('is-charging'));
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok(!element.classes.has('is-fired'));
});

test('cancel, reduced motion and destruction cannot leave a flashing or stale charge', async () => {
  const element = button(),
    dial = createChargeIndicator(element);
  dial.update({ enabled: true, charging: true, power: 0.9, reducedMotion: true });
  assert.ok(element.classes.has('charge-reduced'));
  dial.release({ power: 0.9 });
  dial.cancel();
  assert.ok(!element.classes.has('is-fired'));
  assert.ok(!element.classes.has('is-charging'));
  dial.update({ enabled: true, charging: true, power: 0.2, reducedMotion: false });
  assert.ok(!element.classes.has('charge-reduced'));
  assert.ok(!element.classes.has('is-hot'));
  dial.destroy();
  dial.update({ enabled: true, charging: true, power: 1 });
  dial.release({ power: 1 });
  await new Promise((resolve) => setTimeout(resolve, 230));
  assert.ok(!element.classes.has('is-fired'));
  assert.ok(!element.classes.has('is-charging'));
});
