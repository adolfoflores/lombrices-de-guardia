// Original, local art shared across renderer lifetimes. A missing asset falls
// back to the painted Canvas layers and never blocks the room indefinitely.
const SOURCES = Object.freeze({ earth: '/art/hills-earth.webp', backdrop: '/art/hills-backdrop.webp' });
let pending;

export function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 6000);
    image.onload = () => finish(image.naturalWidth > 0 ? image : null);
    image.onerror = () => finish(null);
    image.src = src;
  });
}

export function prepareHillsArt() {
  if (!pending)
    pending = Promise.all(
      Object.entries(SOURCES).map(async ([key, src]) => [key, await loadImage(src)]),
    ).then((entries) => Object.fromEntries(entries));
  return pending;
}
