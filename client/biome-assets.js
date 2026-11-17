import { loadImage, prepareHillsArt } from './hills-assets.js';

const SOURCES = Object.freeze({
  cavern: { earth: '/art/cavern-rock.webp', backdrop: '/art/cavern-backdrop.webp' },
  islands: { earth: '/art/islands-earth.webp', backdrop: '/art/islands-backdrop.webp' },
});
const pending = new Map();

// Download only the selected map, and reuse its two images on a rematch.
// Each image has the same bounded, playable fallback as Lomas de bronce.
export function prepareBiomeArt(mapId = 'hills') {
  if (!SOURCES[mapId]) return prepareHillsArt();
  if (!pending.has(mapId))
    pending.set(
      mapId,
      Promise.all(Object.entries(SOURCES[mapId]).map(async ([key, src]) => [key, await loadImage(src)])).then(
        (entries) => Object.fromEntries(entries),
      ),
    );
  return pending.get(mapId);
}
