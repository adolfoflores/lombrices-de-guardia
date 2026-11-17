import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputChannel } from '../client/session/input-channel.js';

test('high-refresh pointer traffic stays below the server budget without dropping the latest aim', () => {
  let time = 0;
  const accepted = [];
  const channel = createInputChannel(
    (input) => {
      accepted.push(input);
      return String(accepted.length);
    },
    { now: () => time },
  );
  for (let i = 0; i < 2400; i++) {
    time = (i / 240) * 1000;
    channel.send({ type: 'input', move: 1, aim: i });
  }
  assert.ok(accepted.length <= 300);
  channel.flush();
  assert.equal(accepted.at(-1).aim, 2399);
});

test('releasing movement is immediate and resetting cannot flush an old held direction', () => {
  const accepted = [];
  const channel = createInputChannel(
    (input) => {
      accepted.push(input);
      return 'id';
    },
    { now: () => 0 },
  );
  channel.send({ type: 'input', move: 1 });
  channel.send({ type: 'input', move: 0 });
  assert.equal(accepted.length, 2);
  assert.equal(accepted.at(-1).move, 0);
  channel.reset();
  assert.equal(channel.flush(), null);
});
