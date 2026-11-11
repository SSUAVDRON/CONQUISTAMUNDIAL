// Toques con el dedo: un dedo tapa varias casillas, así que el objetivo de un
// toque no es solo la casilla exacta. Todo esto pasa en este navegador antes
// de mandar la orden (la orden lleva ya su casilla): no toca la simulación.

/** Radio de tolerancia de un toque, en píxeles de pantalla. */
export const TAP_RADIUS_PX = 24;
/** Tope del radio en casillas (con el mapa muy alejado). */
export const TAP_RADIUS_MAX = 60;

/**
 * ¿Se puede atacar `tile` por tierra? Tierra, ni tuya ni de un aliado, y con
 * frontera tuya en esa masa de tierra (si no, la orden mandaría un barco).
 * `cache`: Map de «dueño:masa» → sí/no (la frontera se mira una vez).
 */
export function attackableByLand(game, p, tile, cache = new Map()) {
  const map = game.map;
  if (tile < 0 || tile >= map.size || !map.isLand(tile)) return false;
  const o = game.owner[tile];
  if (o === p.id || game.isAllied(p.id, o)) return false;
  const body = map.landBody[tile];
  const key = `${o}:${body}`;
  let ok = cache.get(key);
  if (ok === undefined) {
    ok = game.hasLandBorder(p, o, body);
    cache.set(key, ok);
  }
  return ok;
}

/**
 * Casilla a la que va un toque en `tile`, con `radius` casillas de tolerancia.
 * - Si la casilla tocada ya se puede atacar por tierra, esa.
 * - En el agua, en tu territorio o en un aliado (la orden no haría nada): la
 *   más cercana del radio que sí se pueda atacar por tierra.
 * - En tierra a la que irías en barco (un país o tierra libre sin frontera
 *   contigo): solo un país con frontera a menos de medio radio (el dedo que
 *   se pasa de la frontera); si no, la tocada (el barco es a propósito).
 */
export function resolveTap(game, p, tile, radius) {
  const map = game.map;
  const cache = new Map();
  if (attackableByLand(game, p, tile, cache)) return tile;
  if (tile < 0 || tile >= map.size || radius < 1) return tile;
  const o = game.owner[tile];
  const boat = map.isLand(tile) && o !== p.id && !game.isAllied(p.id, o);
  if (boat) radius *= 0.5;
  if (radius < 1) return tile;
  const cx = map.x(tile);
  const cy = map.y(tile);
  const R = Math.ceil(radius);
  const r2 = radius * radius;
  let best = -1;
  let bestD = Infinity;
  for (let dy = -R; dy <= R; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= map.height) continue;
    for (let dx = -R; dx <= R; dx++) {
      const d = dx * dx + dy * dy;
      if (d > r2 || d >= bestD) continue;
      const x = cx + dx;
      if (x < 0 || x >= map.width) continue;
      const t = y * map.width + x;
      if ((!boat || game.owner[t] !== 0) && attackableByLand(game, p, t, cache)) {
        best = t;
        bestD = d;
      }
    }
  }
  return best >= 0 ? best : tile;
}

/**
 * Casilla de `ownerId` más cercana al punto (`wx`, `wy`) del mundo, hasta
 * `radius` casillas (para un toque sobre el nombre de un país). -1 si no hay.
 */
export function nearestTileOf(game, ownerId, wx, wy, radius) {
  const map = game.map;
  const cx = Math.floor(wx);
  const cy = Math.floor(wy);
  const R = Math.ceil(radius);
  let best = -1;
  let bestD = Infinity;
  for (let dy = -R; dy <= R; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= map.height) continue;
    for (let dx = -R; dx <= R; dx++) {
      const d = dx * dx + dy * dy;
      if (d > R * R || d >= bestD) continue;
      const x = cx + dx;
      if (x < 0 || x >= map.width) continue;
      const t = y * map.width + x;
      if (game.owner[t] === ownerId) {
        best = t;
        bestD = d;
      }
    }
  }
  return best;
}
