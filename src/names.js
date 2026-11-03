// Nombres de naciones ficticias para los bots, generados por sílabas.

const PREFIXES = [
  'Al', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gal', 'Hes', 'Ir', 'Kar', 'Lum',
  'Mar', 'Nor', 'Ost', 'Pal', 'Quel', 'Ros', 'Sar', 'Tal', 'Ul', 'Val', 'Zen',
  'Ar', 'Bra', 'Cal', 'Ezr', 'Gor', 'Lor', 'Mir', 'Tor',
];

const SUFFIXES = [
  'doria', 'mar', 'heim', 'tania', 'vania', 'gard', 'lia', 'ronia', 'stan',
  'quia', 'landia', 'ora', 'ium', 'ena', 'esia', 'mund', 'thal', 'ara',
];

export function generateNames(rng, count, exclude = []) {
  const used = new Set(exclude.map((n) => n.toLowerCase()));
  const names = [];
  let guard = 0;
  while (names.length < count && guard++ < count * 50) {
    const name = rng.pick(PREFIXES) + rng.pick(SUFFIXES);
    if (used.has(name.toLowerCase())) continue;
    used.add(name.toLowerCase());
    names.push(name);
  }
  // Si se agotan las combinaciones, numeramos
  let n = 2;
  while (names.length < count) names.push(`${rng.pick(PREFIXES)}${rng.pick(SUFFIXES)} ${n++}`);
  return names;
}
