// Aspectos de los edificios colocados, los barcos y las bombas, y las
// rarezas de todo lo coleccionable. Solo datos (sin DOM): los usan el perfil
// (desbloqueos y tienda), el dibujo del mapa y la colección.
//
// `look` describe cómo se pinta cada aspecto; «owner» es el color del dueño.

/** Rarezas, de la más común a la más difícil de conseguir. */
export const RARITIES = {
  comun: { id: 'comun', name: 'Común', color: '#c9cdd3', order: 0 },
  poco: { id: 'poco', name: 'Poco común', color: '#3fd65a', order: 1 },
  raro: { id: 'raro', name: 'Raro', color: '#3d9cff', order: 2 },
  epico: { id: 'epico', name: 'Épico', color: '#b866ff', order: 3 },
  legendario: { id: 'legendario', name: 'Legendario', color: '#ff9d2e', order: 4 },
};
export const RARITY_IDS = Object.keys(RARITIES);

/** Logros de prestigio: lo que desbloquean es épico. */
const EPIC_ACHIEVEMENTS = new Set(['emperador', 'gran_victoria', 'millonario', 'almirante', 'magnate_oro', 'liga_maestro', 'imperio', 'urbanista', 'lluvia_fuego']);

/** Rareza de un objeto: la suya o, si no la tiene, según cómo se consigue. */
export function rarityOf(item) {
  if (item && item.rarity && RARITIES[item.rarity]) return RARITIES[item.rarity];
  const u = item && item.unlock;
  if (!u) return RARITIES.comun;
  if (u.level) return u.level <= 3 ? RARITIES.comun : u.level <= 6 ? RARITIES.poco : RARITIES.raro;
  if (u.price) return u.price < 300 ? RARITIES.poco : u.price < 600 ? RARITIES.raro : u.price < 1000 ? RARITIES.epico : RARITIES.legendario;
  if (u.ach) return EPIC_ACHIEVEMENTS.has(u.ach) ? RARITIES.epico : RARITIES.raro;
  return RARITIES.comun;
}

/** Edificios colocados en el mapa: placa, aros, pictograma y adornos. */
export const BUILDING_SKINS = [
  { id: 'estandar', name: 'Estándar', rarity: 'comun', unlock: null, desc: 'El de siempre: disco oscuro con el aro de tu color.', look: null },
  { id: 'piedra', name: 'Piedra labrada', rarity: 'poco', unlock: { level: 5 }, desc: 'Placa hexagonal de piedra con remaches.', look: { shape: 'hex', plate: ['#9a9fa6', '#5b5f66'], rim2: '#34373d', glyph: '#f6f1e6', ornament: 'rivets' } },
  { id: 'bronce', name: 'Bronce bruñido', rarity: 'poco', unlock: { price: 300 }, desc: 'Medallón de bronce con borde oscuro.', look: { shape: 'disc', plate: ['#d4914a', '#7a4a1d'], rim2: '#3d2410', glyph: '#fff1d6' } },
  { id: 'marmol', name: 'Mármol y oro', rarity: 'raro', unlock: { level: 12 }, desc: 'Mármol blanco con filo dorado.', look: { shape: 'disc', plate: ['#f7f4ee', '#cdc6b8'], rim2: '#d6ac3a', glyph: '#2b2f36' } },
  { id: 'obsidiana', name: 'Obsidiana', rarity: 'raro', unlock: { price: 700 }, desc: 'Piedra volcánica negra con destellos violeta.', look: { shape: 'hex', plate: ['#33244d', '#0b0812'], rim2: '#9b7bff', glyph: '#e6d9ff', glow: '#9b7bff' } },
  { id: 'imperial', name: 'Imperial', rarity: 'epico', unlock: { ach: 'urbanista' }, desc: 'Escudo de oro con corona de laurel.', look: { shape: 'shield', plate: ['#f8d873', '#b07d1e'], rim2: '#5a3b05', glyph: '#3a2604', ornament: 'laurel' } },
  { id: 'arcano', name: 'Arcano', rarity: 'legendario', unlock: { price: 2000 }, desc: 'Sello azul profundo con un anillo de runas que brilla.', look: { shape: 'disc', plate: ['#163463', '#050c1a'], rim2: '#5ff2ff', glyph: '#c4fbff', ornament: 'runes', glow: '#5ff2ff' } },
];

/** Barcos de transporte y buques de guerra: casco, filete y puente. */
export const SHIP_SKINS = [
  { id: 'estandar', name: 'Estándar', rarity: 'comun', unlock: null, desc: 'Gris naval con la cubierta de tu color.', look: null },
  { id: 'madera', name: 'Roble', rarity: 'poco', unlock: { level: 4 }, desc: 'Casco de madera de roble con filete dorado.', look: { hull: '#7d522c', warHull: '#8a5c33', trim: '#d6a65e', bridge: '#efe0c0' } },
  { id: 'acero', name: 'Acero pavonado', rarity: 'poco', unlock: { price: 250 }, desc: 'Acero oscuro de buque de línea.', look: { hull: '#323b45', warHull: '#56616d', trim: '#8a98a6', bridge: '#c3ccd5' } },
  { id: 'artico', name: 'Rompehielos', rarity: 'raro', unlock: { level: 14 }, desc: 'Blanco polar con franja azul.', look: { hull: '#eef3f7', warHull: '#f4f8fb', trim: '#2f7dff', bridge: '#ffffff' } },
  { id: 'corsario', name: 'Corsario', rarity: 'raro', unlock: { price: 700 }, desc: 'Casco negro con franja roja.', look: { hull: '#1b1b20', warHull: '#26262c', trim: '#d0362f', bridge: '#ece4d2' } },
  { id: 'real', name: 'Armada real', rarity: 'epico', unlock: { ach: 'almirante' }, desc: 'Azul de gala con filetes de oro.', look: { hull: '#1f2f5c', warHull: '#2a3d72', trim: '#ebc65c', bridge: '#f6eed6' } },
  { id: 'espectral', name: 'Flota espectral', rarity: 'legendario', unlock: { price: 2200 }, desc: 'Cascos translúcidos que brillan sobre el agua.', look: { hull: 'rgba(70, 225, 205, 0.55)', warHull: 'rgba(90, 235, 215, 0.6)', trim: '#a8fff2', bridge: '#e0fffa', glow: '#5fffe0' } },
];

/** Misiles y bombas: cuerpo, ojiva, aletas, franja y color de la llama. */
export const BOMB_SKINS = [
  { id: 'estandar', name: 'Estándar', rarity: 'comun', unlock: null, desc: 'Cuerpo blanco con la ojiva de tu color.', look: null },
  { id: 'camuflaje', name: 'Camuflaje', rarity: 'poco', unlock: { level: 6 }, desc: 'Verde oliva con manchas.', look: { body: '#6b7a4a', nose: '#3f4a2a', stripe: '#3f4a2a', flame: 'fire' } },
  { id: 'carmesi', name: 'Carmesí', rarity: 'poco', unlock: { price: 300 }, desc: 'Rojo intenso con ojiva negra.', look: { body: '#c3283a', nose: '#1c1c20', fins: '#1c1c20', stripe: '#ffffff', flame: 'red' } },
  { id: 'tormenta', name: 'Tormenta', rarity: 'raro', unlock: { level: 16 }, desc: 'Gris tormenta con un rayo amarillo y llama azul.', look: { body: '#3a3f48', stripe: '#ffd23f', flame: 'blue' } },
  { id: 'dorada', name: 'Ojiva dorada', rarity: 'epico', unlock: { ach: 'lluvia_fuego' }, desc: 'Oro de punta a cola, con llama dorada.', look: { body: '#f4cf5e', nose: '#ffffff', fins: '#b8862a', flame: 'gold' } },
  { id: 'plasma', name: 'Plasma', rarity: 'legendario', unlock: { price: 2500 }, desc: 'Cuerpo violeta con llama de plasma.', look: { body: '#2a1846', nose: '#e3c7ff', stripe: '#c08bff', flame: 'violet', glow: '#b06bff' } },
];

const BY = {
  edificio: new Map(BUILDING_SKINS.map((s) => [s.id, s])),
  barco: new Map(SHIP_SKINS.map((s) => [s.id, s])),
  bomba: new Map(BOMB_SKINS.map((s) => [s.id, s])),
};

/** Cómo se pinta el aspecto `id` de `kind` ('edificio' | 'barco' | 'bomba'): null = el estándar. */
export function skinLook(kind, id) {
  const s = BY[kind] && BY[kind].get(id);
  return s ? s.look : null;
}

/** Aspectos de un jugador (datos de otro jugador: se limpian). */
export function cleanSkins(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const pick = (kind, v) => (typeof v === 'string' && BY[kind].has(v) ? v : 'estandar');
  return { edificio: pick('edificio', r.edificio), barco: pick('barco', r.barco), bomba: pick('bomba', r.bomba) };
}
