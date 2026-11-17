import test from 'node:test';
import assert from 'node:assert/strict';
import { aimFacing, aimForFacing, normalizeAngle } from '../shared/aim.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≈ ${expected}`);

test('normalization preserves shot direction and already normalized values', () => {
  for (const angle of [-Math.PI, -2.4, -0.7, 0, 0.7, 2.4, Math.PI])
    assert.equal(normalizeAngle(angle), angle);
  for (const angle of [-4 * Math.PI, -3 * Math.PI, -5.2, 4.3, 3 * Math.PI, 4 * Math.PI]) {
    const normalized = normalizeAngle(angle);
    assert.ok(normalized >= -Math.PI && normalized <= Math.PI);
    near(Math.sin(normalized), Math.sin(angle));
    near(Math.cos(normalized), Math.cos(angle));
  }
});

test('turning left and right preserves upward and downward shot inclination', () => {
  for (const angle of [
    -Math.PI,
    -2.8,
    -2.1,
    -Math.PI / 2,
    -0.7,
    -0.1,
    0,
    0.1,
    0.7,
    Math.PI / 2,
    2.1,
    2.8,
    Math.PI,
  ]) {
    for (const facing of [-1, 1]) {
      const reflected = aimForFacing(angle, facing);
      assert.ok(reflected >= -Math.PI && reflected <= Math.PI);
      near(Math.sin(reflected), Math.sin(angle));
      near(Math.abs(Math.cos(reflected)), Math.abs(Math.cos(angle)));
      assert.equal(aimFacing(reflected, facing), facing);
      const restored = aimForFacing(reflected, aimFacing(angle, facing));
      near(Math.sin(restored), Math.sin(angle));
    }
  }
  near(aimForFacing(-Math.PI / 4, -1), (-3 * Math.PI) / 4);
  near(aimForFacing(Math.PI / 4, -1), (3 * Math.PI) / 4);
});

test('near-vertical aim keeps its deliberate side without pointing the weapon across it', () => {
  for (const facing of [-1, 1]) {
    for (const angle of [
      -Math.PI / 2 - 0.02,
      -Math.PI / 2,
      -Math.PI / 2 + 0.02,
      Math.PI / 2 - 0.02,
      Math.PI / 2,
      Math.PI / 2 + 0.02,
    ]) {
      const direction = aimFacing(angle, facing);
      assert.equal(direction, facing);
      const reflected = aimForFacing(angle, direction);
      near(Math.sin(reflected), Math.sin(angle));
      if (Math.abs(Math.cos(angle)) > 1e-12) assert.equal(Math.sign(Math.cos(reflected)), facing);
    }
  }
  assert.equal(aimFacing(-Math.PI / 2 - 0.06, 1), -1);
  assert.equal(aimFacing(-Math.PI / 2 + 0.06, -1), 1);
});
