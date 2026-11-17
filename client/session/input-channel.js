const moving = (input) => ['move', 'thrustX', 'thrustY', 'reel'].some((key) => !!input?.[key]);

/** Coalesce high-refresh pointer events; attacks flush their latest aim before firing. */
export function createInputChannel(send, { now = () => performance.now(), frequency = 30 } = {}) {
  let latest = null,
    previous = null,
    sentAt = -Infinity;
  const flush = () => {
    if (!latest) return null;
    const id = send(latest);
    if (id) {
      previous = latest;
      sentAt = now();
    }
    return id;
  };
  return {
    send(input) {
      latest = { ...input };
      if (now() - sentAt < 1000 / frequency && !(moving(previous) && !moving(latest))) return null;
      return flush();
    },
    flush,
    reset() {
      latest = null;
      previous = null;
      sentAt = -Infinity;
    },
  };
}
