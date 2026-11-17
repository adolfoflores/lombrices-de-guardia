export function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be unavailable in private mode or under quota. */
  }
}

export function readPreferences(reducedMotion = false) {
  const raw = read('ldg-prefs', {});
  const prefs = raw && typeof raw === 'object' ? raw : {};
  const number = (key, fallback, min, max) =>
    typeof prefs[key] === 'number' && Number.isFinite(prefs[key])
      ? Math.max(min, Math.min(max, prefs[key]))
      : fallback;
  return {
    hand: prefs.hand === 'left' ? 'left' : 'right',
    sensitivity: number('sensitivity', 1, 0.4, 2),
    music: number('music', 0.16, 0, 1),
    sfx: number('sfx', 0.65, 0, 1),
    quality: ['auto', 'high', 'low'].includes(prefs.quality) ? prefs.quality : 'auto',
    reducedMotion: typeof prefs.reducedMotion === 'boolean' ? prefs.reducedMotion : reducedMotion,
  };
}
