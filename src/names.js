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

const COLONY_KINDS = ['Colonia de', 'Aldea de', 'Asentamiento de', 'Misión de', 'Feudo de', 'Puesto de', 'Caserío de', 'Factoría de'];
const PLACES = [
  'Valdeoro', 'Robledal', 'la Ribera', 'Santa Clara', 'Arenales', 'los Pinos', 'Brezal', 'Altamira', 'Encinar',
  'Piedrahita', 'Villaverde', 'Riscal', 'Matorral', 'Salinas', 'Olmedo', 'Torrecilla', 'Valmayor', 'Cañaveral',
  'Hondonada', 'Mirasol', 'Lagunilla', 'Pedregal', 'Rocafría', 'Sotobosque', 'Peñasco', 'Puerto Viejo', 'San Telmo',
  'Monteclaro', 'Fuentefría', 'Navarredonda', 'Aguasvivas', 'Campoalto',
  'Valdelobos', 'Robleda', 'Peñarroja', 'Valverde', 'Fresneda', 'Castrillo', 'Almenara', 'Vegaluz', 'Cerroblanco',
  'Losares', 'Quintanar', 'Pozoseco', 'Arroyofrío', 'Villalba', 'Torreblanca', 'Hoyalta', 'Morales', 'Pinarejo',
  'Sauceda', 'Valdemora', 'Llanoverde', 'Castañar', 'Rivera Baja', 'Campillo', 'Serranía', 'Navaluenga', 'Cantalobos',
  'Villacierva', 'Robregordo', 'Albarrán', 'Majadahonda', 'Fuenterrubia', 'Valtierra', 'Montenegro', 'Escobar',
];

/** Nombres de colonias: «Colonia de Valdeoro», «Aldea de Brezal»… */
export function generateColonyNames(rng, count, exclude = []) {
  const used = new Set(exclude.map((n) => n.toLowerCase()));
  const names = [];
  let guard = 0;
  while (names.length < count && guard++ < count * 60) {
    const name = `${rng.pick(COLONY_KINDS)} ${rng.pick(PLACES)}`;
    if (used.has(name.toLowerCase())) continue;
    used.add(name.toLowerCase());
    names.push(name);
  }
  while (names.length < count) names.push(`Colonia ${names.length + 1}`);
  return names;
}
