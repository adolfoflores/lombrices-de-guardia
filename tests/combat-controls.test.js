import test from 'node:test';
import assert from 'node:assert/strict';
import { controlMode, advanceAim } from '../client/combat-controls.js';
import { WEAPONS } from '../shared/config.js';
import { aimForFacing } from '../shared/aim.js';

test('only the selected deployed mobility tool owns the vertical joystick', () => {
  for (const { id } of WEAPONS) {
    assert.equal(controlMode({}, id), 'move');
    assert.equal(controlMode({ jetpack: true }, id), id === 'jetpack' ? 'jetpack' : 'move');
    assert.equal(controlMode({ rope: { length: 100 } }, id), id === 'rope' ? 'rope' : 'move');
  }
});

test('up/down change elevation proportionally and retain the chosen side', () => {
  for (const side of [-1, 1]) {
    const start = aimForFacing(-0.5, side);
    const up = advanceAim(start, side, -1, 0, 0.2);
    const down = advanceAim(start, side, 1, 0, 0.2);
    const fine = advanceAim(start, side, -0.25, 0, 0.2);
    assert.ok(Math.sin(up) < Math.sin(fine) && Math.sin(fine) < Math.sin(start));
    assert.ok(Math.sin(down) > Math.sin(start));
    assert.equal(Math.sign(Math.cos(up)), side);
    assert.ok(Math.abs(advanceAim(start, side, 0, 0, 0.2) - start) < 1e-12);
  }
});

test('aim is frame-rate independent and cannot wrap past either vertical limit', () => {
  const run = (hz) => {
    let angle = -0.3;
    for (let i = 0; i < hz; i++) angle = advanceAim(angle, 1, -0.4, 0, 1 / hz);
    return angle;
  };
  assert.ok(Math.abs(run(30) - run(120)) < 1e-12);
  for (const side of [-1, 1])
    for (const direction of [-1, 1]) {
      const angle = advanceAim(aimForFacing(0, side), side, direction, 0, 10);
      assert.ok(Math.abs(Math.sin(angle) - direction) < 1e-12);
      assert.ok(Math.abs(Math.cos(angle)) < 1e-12);
    }
  assert.ok(Math.abs(advanceAim(0, 1, 0, -1, 1) + 0.6) < 1e-12);
  assert.ok(Math.abs(advanceAim(0, 1, 0.2, 0, 1, 2) - 0.54) < 1e-12);
});
