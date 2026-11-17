// Original worm names with character. Short Spanish nicknames, no real brands
// and nothing borrowed from other games; each fits the 14-character nameplate.
export const WORM_NAMES = Object.freeze([
  'Chispa',
  'Doña Pólvora',
  'Tito Mecha',
  'Lombrisol',
  'Capitana Barro',
  'Pepa Trueno',
  'Don Fango',
  'Candela',
  'Tornillo',
  'La Brasa',
  'Rufo Granizo',
  'Mamá Lodo',
  'Tía Metralla',
  'Nubecita',
  'Bombín',
  'Sargento Migas',
  'Lupe Volcán',
  'Perico Humo',
  'Cabo Ceniza',
  'Cuco Dinamita',
  'Chencho',
  'Malaspina',
  'Bigotes',
  'Pancha Ráfaga',
  'Jacinto Pum',
  'Rosquilla',
  'Terremoto',
  'Doña Rosca',
  'Nico Cráter',
  'La Centella',
  'Trueno Chico',
  'Vito Mortero',
  'Guindilla',
  'Abuela Fusil',
  'Charquito',
  'Rayo Lento',
  'Don Estruendo',
  'Pelusa',
  'Garbancito',
  'Tormenta',
  'Calamidad',
  'Perla Petardo',
  'Lucho Tizón',
  'Cachito',
  'La Ventisca',
  'Bruma',
  'Trompeta',
  'Sandía',
  'Fulminante',
  'Chamusquina',
  'Ñoqui',
  'Telaraña',
  'Merengue',
  'Alcachofa',
  'Pelotazo',
  'Zumbido',
  'Bufanda',
  'Caracola',
  'Chimenea',
  'Picatoste',
  'Barullo',
  'Trabuco',
  'Moflete',
  'Churrasco',
  'Zarzamora',
  'Pimentón',
  'Tapón',
  'Chicharra',
  'Remolino',
  'Pedrusco',
  'Mari Cohete',
  'Benito Bomba',
]);

/** Longest name the nameplates show without clipping. */
export const WORM_NAME_LENGTH = 14;

/**
 * Picks `count` distinct names using the caller's random source, so the engine's
 * seeded generator makes the roster reproducible per match. The pool only
 * restarts if a match ever asks for more worms than there are names.
 */
export function pickWormNames(count, random = Math.random) {
  const pool = [];
  const picked = [];
  for (let i = 0; i < count; i++) {
    if (!pool.length) pool.push(...WORM_NAMES);
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return picked;
}
