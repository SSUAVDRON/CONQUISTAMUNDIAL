// Mapa del mundo: rejilla de casillas con tipo de terreno. Se genera de forma
// procedural a partir de una semilla (continentes + islas + cordilleras).
import { AREA, RES, TERRAIN } from './config.js';
import { Rng, hashString } from './rng.js';
import { createNoise2D, fbm } from './noise.js';
import { REAL_MAP_DATA } from './mapas-reales.js';
import { RIVERS } from './rios.js';

const { WATER, PLAINS, HIGHLAND, MOUNTAIN } = TERRAIN;

const LAND_SHARE = 0.42; // fracción aproximada de tierra
const HIGHLAND_Q = 0.66; // percentil de altura (dentro de la tierra) para mesetas
const MOUNTAIN_Q = 0.9; // percentil para montañas
const MIN_ISLAND = 40 * AREA; // islas más pequeñas se hunden (jugabilidad)
const MAX_LAKE = 15 * AREA; // lagos más pequeños se rellenan

export class GameMap {
  constructor(width, height, terrain, shade, river = null) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.terrain = terrain; // Uint8Array, valores de TERRAIN
    this.shade = shade; // Uint8Array 0..255: altura relativa (tierra) o profundidad (agua)
    // 0 = sin río, 1 = río, 2 = río grande. Los ríos son agua (fronteras que no
    // se cruzan por tierra); esto solo dice cómo dibujarlos
    this.river = river || new Uint8Array(width * height);
    this._computeDerived();
  }

  isLand(i) {
    return this.terrain[i] !== WATER;
  }

  /** Agua por la que navegan los barcos: un mar o lago, o un río que llega a uno. */
  navigable(i) {
    return this.terrain[i] === WATER && this.waterOpen[this.waterBody[i]] === 1;
  }

  x(i) {
    return i % this.width;
  }

  y(i) {
    return (i / this.width) | 0;
  }

  index(x, y) {
    return y * this.width + x;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Escribe en `out` los vecinos ortogonales de `i` y devuelve cuántos hay. */
  neighbors(i, out) {
    const w = this.width;
    const x = i % w;
    let c = 0;
    if (x > 0) out[c++] = i - 1;
    if (x < w - 1) out[c++] = i + 1;
    if (i >= w) out[c++] = i - w;
    if (i < this.size - w) out[c++] = i + w;
    return c;
  }

  _computeDerived() {
    const { size, terrain, river, width: w } = this;
    // Una sola cola para las dos búsquedas (en el mundo son 18 MB)
    const queue = new Int32Array(size);
    const land = labelComponents(this, true, queue);
    this.landBody = land.labels;
    this.landBodySizes = land.sizes;
    const water = labelComponents(this, false, queue);
    const wl = water.labels;
    this.waterBody = wl;
    this.waterBodySizes = water.sizes;
    // Masas de agua navegables: las que tienen mar o lago (no solo río). Un río
    // que no llega a ninguno es solo frontera: ni puertos ni barcos
    const open = new Uint8Array(water.sizes.length);
    let landCount = 0;
    for (let i = 0; i < size; i++) {
      if (terrain[i] !== WATER) landCount++;
      else if (!river[i]) open[wl[i]] = 1;
    }
    this.waterOpen = open;
    // Costa = tierra junto a agua navegable (puertos, desembarcos, comercio)
    const nav = (n) => terrain[n] === WATER && open[wl[n]] === 1;
    const coastal = new Uint8Array(size);
    const landTiles = new Int32Array(landCount);
    let li = 0;
    let coastCount = 0;
    for (let i = 0; i < size; i++) {
      if (terrain[i] === WATER) continue;
      landTiles[li++] = i;
      const x = i % w;
      if ((x > 0 && nav(i - 1)) || (x < w - 1 && nav(i + 1)) || (i >= w && nav(i - w)) || (i < size - w && nav(i + w))) {
        coastal[i] = 1;
        coastCount++;
      }
    }
    const coastTiles = new Int32Array(coastCount);
    for (let k = 0, c = 0; k < landCount; k++) if (coastal[landTiles[k]]) coastTiles[c++] = landTiles[k];
    this.landCount = landCount;
    this.landTiles = landTiles;
    this.coastal = coastal;
    this.coastTiles = coastTiles;
  }
}

/** Etiqueta componentes conexas (4-vecindad) de tierra o de agua (vecinas en línea: es de lo más lento al cargar un mapa). */
function labelComponents(map, wantLand, queue = new Int32Array(map.size)) {
  const { size, terrain, width: w } = map;
  const labels = new Int32Array(size).fill(-1);
  const sizes = [];
  const want = wantLand ? 1 : 0;
  // 1 = del tipo buscado (tierra o agua)
  const kind = new Uint8Array(size);
  for (let i = 0; i < size; i++) kind[i] = (terrain[i] !== WATER ? 1 : 0) === want ? 1 : 0;
  for (let s = 0; s < size; s++) {
    if (labels[s] !== -1 || !kind[s]) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    labels[s] = id;
    while (head < tail) {
      const t = queue[head++];
      const x = t % w;
      let n = t - 1;
      if (x > 0 && kind[n] && labels[n] === -1) {
        labels[n] = id;
        queue[tail++] = n;
      }
      n = t + 1;
      if (x < w - 1 && kind[n] && labels[n] === -1) {
        labels[n] = id;
        queue[tail++] = n;
      }
      n = t - w;
      if (n >= 0 && kind[n] && labels[n] === -1) {
        labels[n] = id;
        queue[tail++] = n;
      }
      n = t + w;
      if (n < size && kind[n] && labels[n] === -1) {
        labels[n] = id;
        queue[tail++] = n;
      }
    }
    sizes.push(tail);
  }
  return { labels, sizes };
}

/** Genera un mapa determinista a partir de la semilla. */
export function generateMap(width, height, seed) {
  const rng = new Rng(seed >>> 0);
  const base = createNoise2D(rng.int(0, 0x7fffffff));
  const warp = createNoise2D(rng.int(0, 0x7fffffff));
  const rough = createNoise2D(rng.int(0, 0x7fffffff));
  const size = width * height;
  const elev = new Float32Array(size);
  const scale = Math.min(width, height) / 3.2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / scale;
      const ny = y / scale;
      // Deformación del dominio: costas y continentes menos "redondos"
      const wx = nx + (fbm(warp, nx * 0.7, ny * 0.7, 3) - 0.5) * 1.6;
      const wy = ny + (fbm(warp, nx * 0.7 + 19.1, ny * 0.7 + 7.3, 3) - 0.5) * 1.6;
      let e = fbm(base, wx, wy, 6);
      // Los bordes del mapa son océano
      const dx = Math.abs((x / (width - 1)) * 2 - 1);
      const dy = Math.abs((y / (height - 1)) * 2 - 1);
      const edge = Math.max(dx, dy);
      e -= Math.max(0, edge - 0.72) * 1.8;
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) e = -1;
      elev[y * width + x] = e;
    }
  }

  const sorted = Float32Array.from(elev).sort();
  const sea = sorted[Math.floor(size * (1 - LAND_SHARE))];
  const minElev = sorted[0] < -0.5 ? sorted[Math.floor(size * 0.02)] : sorted[0];
  const landSorted = sorted.subarray(Math.floor(size * (1 - LAND_SHARE)));
  const hi = landSorted[Math.floor(landSorted.length * HIGHLAND_Q)];
  const mt = landSorted[Math.floor(landSorted.length * MOUNTAIN_Q)];
  const top = landSorted[landSorted.length - 1];

  const terrain = new Uint8Array(size);
  const shade = new Uint8Array(size);
  const band = (v, a, b) => Math.max(0, Math.min(255, Math.round(((v - a) / Math.max(1e-6, b - a)) * 255)));

  for (let i = 0; i < size; i++) {
    const e = elev[i];
    const x = i % width;
    const y = (i / width) | 0;
    const grain = (fbm(rough, x / (5 * RES), y / (5 * RES), 2) - 0.5) * 50;
    if (e < sea) {
      terrain[i] = WATER;
      shade[i] = band(sea - Math.max(e, minElev), 0, (sea - minElev) * 0.6);
    } else if (e < hi) {
      terrain[i] = PLAINS;
      shade[i] = clampByte(band(e, sea, hi) + grain);
    } else if (e < mt) {
      terrain[i] = HIGHLAND;
      shade[i] = clampByte(band(e, hi, mt) + grain);
    } else {
      terrain[i] = MOUNTAIN;
      shade[i] = band(e, mt, top);
    }
  }

  cleanup(width, height, terrain, shade);
  const map = new GameMap(width, height, terrain, shade);
  // Relieve para el dibujo: la altura relativa pasa a «metros» parecidos a los
  // de los mapas reales (llanuras sobre todo bajas y verdes, mesetas de arena,
  // montañas grises con nieve solo en lo más alto)
  const step = 2;
  const rw = Math.ceil(width / step) + 1;
  const rh = Math.ceil(height / step) + 1;
  const data = new Float32Array(rw * rh);
  const lerp = (v, a, b, m0, m1) => m0 + ((v - a) / Math.max(1e-6, b - a)) * (m1 - m0);
  for (let gy = 0; gy < rh; gy++) {
    const y = Math.min(height - 1, gy * step);
    for (let gx = 0; gx < rw; gx++) {
      const x = Math.min(width - 1, gx * step);
      const i = y * width + x;
      const e = elev[i];
      const t = terrain[i];
      data[gy * rw + gx] =
        t === WATER ? 0 : t === PLAINS ? Math.max(1, 420 * pow15(Math.max(0, lerp(e, sea, hi, 0, 1)))) : t === HIGHLAND ? lerp(e, hi, mt, 480, 1700) : lerp(e, mt, top, 1800, 4300);
    }
  }
  map.relief = { w: rw, h: rh, step, data };
  map.tileKm = 7; // relieve algo más suave que en los mapas reales
  traceRivers(map, elev, rng);
  riversToWater(width, height, terrain, map.river, shade);
  map._computeDerived();
  return map;
}

/** Hueco máximo (casillas por tierra) que se abre para unir un tramo de río al agua o a otro río. */
const RIVER_LINK = 24;
/** La tierra que los ríos dejan aislada y mide menos que esto pasa a ser río. */
const RIVER_SLIVER = 12;

/**
 * Los ríos pasan a ser agua: fronteras que no se cruzan por tierra y, si
 * llegan al mar (o a un lago), vías por las que navegan los barcos.
 *  1. Cada tramo suelto (no toca agua) se une por el camino más corto por
 *     tierra, de como mucho RIVER_LINK casillas, al agua o a otro tramo. Cada
 *     unión junta dos grupos distintos, así que no se cierran anillos que
 *     dejen tierra encerrada. Los datos traen los ríos troceados (al cruzar
 *     lagos que el mapa ya no tiene, deltas…) y así vuelven a ser continuos.
 *  2. Las casillas de río pasan a ser agua (`river` sigue diciendo cómo dibujarlas).
 *  3. La tierra que queda aislada junto a un río y mide menos de
 *     RIVER_SLIVER casillas pasa a ser río (sin islotes imposibles).
 * Todo determinista (mismo orden de recorrido en todos los equipos).
 * Devuelve cuántos tramos se quedaron sin salida (solo frontera).
 */
export function riversToWater(w, h, terrain, river, shade) {
  const size = w * h;
  const tmp = { width: w, height: h, size, terrain, neighbors: GameMap.prototype.neighbors };
  const nb = new Int32Array(4);
  const lab = new Int32Array(size).fill(-1);
  const seen = new Uint8Array(size);
  // Solo se recorren las casillas de río (no todo el mapa en cada vuelta)
  const list = [];
  for (let i = 0; i < size; i++) if (river[i]) list.push(i);
  let stranded = 0;
  // Tramos que no encontraron salida, por su primera casilla y tamaño: si no
  // han cambiado, no se vuelven a buscar en la vuelta siguiente
  const dry = new Map();
  for (let round = 0; round < 16; round++) {
    // Tramos (4 vecinas) y si tocan agua
    for (const t of list) lab[t] = -1;
    const comps = [];
    for (const s of list) {
      if (lab[s] >= 0) continue;
      const id = comps.length;
      const tiles = [s];
      lab[s] = id;
      let touch = false;
      for (let q = 0; q < tiles.length; q++) {
        const c = tmp.neighbors(tiles[q], nb);
        for (let k = 0; k < c; k++) {
          const n = nb[k];
          if (river[n]) {
            if (lab[n] < 0) {
              lab[n] = id;
              tiles.push(n);
            }
          } else if (terrain[n] === WATER) touch = true;
        }
      }
      comps.push({ tiles, touch });
    }
    // Grupos ya unidos en esta vuelta (para no unir dos veces lo mismo)
    const group = comps.map((_, i) => i);
    const find = (i) => {
      while (group[i] !== i) i = group[i] = group[group[i]];
      return i;
    };
    const wet = comps.map((c) => c.touch);
    let linked = 0;
    stranded = 0;
    for (let id = 0; id < comps.length; id++) {
      if (wet[find(id)]) continue;
      const me = find(id);
      const tiles = comps[id].tiles;
      if (dry.get(tiles[0]) === tiles.length) {
        stranded++;
        continue;
      }
      // Búsqueda en anchura por tierra sin río desde todo el tramo. En `seen`
      // va de qué lado se llegó (1 desde la derecha, 2 izquierda, 3 abajo,
      // 4 arriba) para rehacer el camino sin otra tabla del tamaño del mapa
      const visited = [];
      let frontier = tiles;
      let hit = -1;
      let hitTarget = -1;
      for (let d = 0; d < RIVER_LINK && hit < 0 && frontier.length; d++) {
        const next = [];
        for (const t of frontier) {
          const c = tmp.neighbors(t, nb);
          for (let k = 0; k < c; k++) {
            const n = nb[k];
            if (river[n]) {
              if (d > 0 && find(lab[n]) !== me) {
                hit = t;
                hitTarget = find(lab[n]);
                break;
              }
              continue;
            }
            if (terrain[n] === WATER) {
              if (d > 0) {
                hit = t;
                hitTarget = -1;
                break;
              }
              continue;
            }
            if (seen[n]) continue;
            seen[n] = t === n + 1 ? 1 : t === n - 1 ? 2 : t === n + w ? 3 : 4;
            visited.push(n);
            next.push(n);
          }
          if (hit >= 0) break;
        }
        frontier = next;
      }
      const path = [];
      if (hit >= 0) {
        for (let t = hit; !river[t]; ) {
          path.push(t);
          const dir = seen[t];
          t = dir === 1 ? t + 1 : dir === 2 ? t - 1 : dir === 3 ? t + w : t - w;
        }
      }
      for (const t of visited) seen[t] = 0;
      if (hit < 0) {
        dry.set(tiles[0], tiles.length);
        stranded++;
        continue;
      }
      for (const t of path) {
        river[t] = 1;
        lab[t] = me; // el camino nuevo es ya de este grupo
        list.push(t);
      }
      if (hitTarget >= 0) {
        group[me] = hitTarget;
        if (wet[me]) wet[hitTarget] = true;
      } else wet[me] = true;
      linked++;
    }
    if (!linked) break;
  }
  // Los ríos pasan a ser agua
  for (const i of list) {
    terrain[i] = WATER;
    shade[i] = 0;
  }
  // Islotes que dejan los ríos → río: desde cada orilla se rellena la tierra
  // hasta RIVER_SLIVER casillas; si se acaba antes, es un islote
  // (seen: 1 = ya mirada, forma parte de una tierra grande)
  const region = [];
  const nb2 = new Int32Array(4);
  for (const r of list) {
    const c0 = tmp.neighbors(r, nb);
    for (let k0 = 0; k0 < c0; k0++) {
      const s = nb[k0];
      if (terrain[s] === WATER || seen[s]) continue;
      region.length = 0;
      region.push(s);
      seen[s] = 1;
      let big = false;
      for (let q = 0; q < region.length && !big; q++) {
        const c = tmp.neighbors(region[q], nb2);
        for (let k = 0; k < c; k++) {
          const n = nb2[k];
          if (terrain[n] === WATER) continue;
          if (seen[n]) {
            // Tocar tierra ya mirada (grande) o la propia
            if (!region.includes(n)) big = true;
            continue;
          }
          seen[n] = 1;
          region.push(n);
          if (region.length >= RIVER_SLIVER) big = true;
        }
      }
      if (!big) {
        for (const t of region) {
          terrain[t] = WATER;
          shade[t] = 0;
          river[t] = 1;
        }
      }
    }
  }
  return stranded;
}

/**
 * Ríos de un mapa aleatorio: nacen en tierras altas y bajan siempre por la
 * casilla vecina más baja hasta el mar (o hasta otro río, que desde ahí pasa
 * a ser un río grande). Si se quedan en un hoyo, lo cruzan subiendo un poco;
 * si no llegan, se descartan. Todo con la semilla: igual en todos los equipos.
 */
function traceRivers(map, elev, rng) {
  const { width: W, height: H, size, terrain, river } = map;
  const want = Math.max(4, Math.round(map.landCount / (2600 * AREA)));
  const minLen = 14 * RES;
  const spacing = 22 * RES;
  const nb = new Int32Array(4);
  const visit = new Int32Array(size); // sello por río (evita que dé vueltas)
  const owner = new Int32Array(size).fill(-1); // qué río pasa por cada casilla
  const paths = [];
  const sources = [];
  // Candidatas: tierra alta; se prueban en orden aleatorio (con la semilla)
  const high = [];
  for (let i = 0; i < size; i++) if (terrain[i] === HIGHLAND || terrain[i] === MOUNTAIN) high.push(i);
  if (!high.length) return;
  for (let attempt = 0; attempt < want * 12 && paths.length < want; attempt++) {
    const s = high[rng.int(0, high.length - 1)];
    const sx = s % W;
    const sy = (s / W) | 0;
    if (sources.some((t) => Math.abs((t % W) - sx) + Math.abs(((t / W) | 0) - sy) < spacing)) continue;
    const stamp = attempt + 1;
    const path = [s];
    visit[s] = stamp;
    let t = s;
    let uphill = 0;
    let end = -1; // -1 = no llegó; -2 = al mar; ≥0 = río al que se une
    for (let step = 0; step < 6000; step++) {
      const c = map.neighbors(t, nb);
      let best = -1;
      let bestE = Infinity;
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (terrain[n] === WATER) {
          best = n;
          bestE = -Infinity;
          break;
        }
        if (visit[n] === stamp) continue;
        if (elev[n] < bestE) {
          bestE = elev[n];
          best = n;
        }
      }
      if (best < 0) break;
      if (bestE === -Infinity) {
        end = -2;
        break;
      }
      if (bestE > elev[t] && ++uphill > 30 * RES) break;
      t = best;
      visit[t] = stamp;
      if (owner[t] >= 0) {
        end = owner[t];
        break;
      }
      path.push(t);
    }
    if (end === -1 || path.length < minLen) continue;
    const id = paths.length;
    for (const p of path) {
      owner[p] = id;
      riverBrush(W, H, terrain, river, p % W, (p / W) | 0, 1);
    }
    paths.push(path);
    sources.push(s);
    if (end >= 0) {
      // Se une a otro río: desde ahí abajo, río grande
      const other = paths[end];
      const at = other.indexOf(t);
      for (let k = Math.max(0, at); k < other.length; k++) riverBrush(W, H, terrain, river, other[k] % W, (other[k] / W) | 0, 2);
    }
  }
}

/** Ancho del río en casillas según su clase (con casillas pequeñas, algo más ancho para que se vea). */
const RIVER_WIDTH = [0, Math.max(1, RES >> 2), Math.max(2, RES >> 1)];

/** Pinta un trazo de río centrado en (x, y), solo sobre tierra. */
function riverBrush(w, h, terrain, river, x, y, cls) {
  const size = RIVER_WIDTH[cls];
  const x0 = x - ((size - 1) >> 1);
  const y0 = y - ((size - 1) >> 1);
  for (let yy = y0; yy < y0 + size; yy++) {
    if (yy < 0 || yy >= h) continue;
    for (let xx = x0; xx < x0 + size; xx++) {
      if (xx < 0 || xx >= w) continue;
      const i = yy * w + xx;
      if (terrain[i] !== WATER && river[i] < cls) river[i] = cls;
    }
  }
}

/**
 * Marca sobre la tierra los ríos dados como polilíneas [clase, x0, y0, x1, y1, …]
 * (clase 2 = río grande, dos casillas de ancho). Las líneas van de casilla en
 * casilla sin saltos en diagonal: un río no deja pasar entre dos casillas.
 */
export function markRivers(w, h, terrain, lines, river = new Uint8Array(w * h)) {
  const mark = (x, y, cls) => riverBrush(w, h, terrain, river, x, y, cls);
  for (const line of lines) {
    const cls = line[0];
    for (let k = 1; k + 3 < line.length; k += 2) {
      let x = line[k];
      let y = line[k + 1];
      const x1 = line[k + 2];
      const y1 = line[k + 3];
      const dx = Math.abs(x1 - x);
      const dy = Math.abs(y1 - y);
      const sx = x < x1 ? 1 : -1;
      const sy = y < y1 ? 1 : -1;
      let ix = 0;
      let iy = 0;
      for (let n = 0; n <= dx + dy; n++) {
        mark(x, y, cls);
        if (n === dx + dy) break;
        // Avanza en x o en y (enteros: igual en todos los navegadores)
        if ((1 + 2 * ix) * dy < (1 + 2 * iy) * dx) {
          x += sx;
          ix++;
        } else {
          y += sy;
          iy++;
        }
      }
    }
  }
  return river;
}

/** x^1,5 sin Math.pow (mismo resultado en todos los navegadores). */
const pow15 = (x) => x * Math.sqrt(x);

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Hunde islotes y rellena charcos para que el mapa sea jugable. */
function cleanup(width, height, terrain, shade) {
  const tmp = { width, height, size: width * height, terrain };
  tmp.neighbors = GameMap.prototype.neighbors;

  const land = labelComponents(tmp, true);
  for (let i = 0; i < tmp.size; i++) {
    const id = land.labels[i];
    if (id >= 0 && land.sizes[id] < MIN_ISLAND) {
      terrain[i] = WATER;
      shade[i] = 40;
    }
  }

  const water = labelComponents(tmp, false);
  const touchesEdge = new Uint8Array(water.sizes.length);
  for (let x = 0; x < width; x++) {
    markEdge(water.labels[x], touchesEdge);
    markEdge(water.labels[(height - 1) * width + x], touchesEdge);
  }
  for (let y = 0; y < height; y++) {
    markEdge(water.labels[y * width], touchesEdge);
    markEdge(water.labels[y * width + width - 1], touchesEdge);
  }
  for (let i = 0; i < tmp.size; i++) {
    const id = water.labels[i];
    if (id >= 0 && !touchesEdge[id] && water.sizes[id] < MAX_LAKE) {
      terrain[i] = PLAINS;
      shade[i] = 30;
    }
  }
}

function markEdge(id, arr) {
  if (id >= 0) arr[id] = 1;
}

// ------------------------------------------------------------ mapas reales

/**
 * Carga un mapa del mundo real. Devuelve { map, countries } donde countries =
 * [{ name, tile, area, iso }] de mayor a menor (la casilla es la más interior).
 */
/** El último mapa real cargado: el terreno no cambia y así no se recalcula (el del menú y la partida rápida son el mismo). */
let lastReal = null;

export function loadRealMap(id) {
  if (lastReal && lastReal.id === id) return { map: lastReal.map, countries: lastReal.countries.map((c) => ({ ...c })) };
  const data = REAL_MAP_DATA[id];
  if (!data) throw new Error(`Mapa desconocido: ${id}`);
  const { w, h } = data;
  const size = w * h;
  const terrain = new Uint8Array(size);
  const bin = atob(data.rle);
  let i = 0;
  for (let k = 0; k < bin.length; k++) {
    const b = bin.charCodeAt(k);
    const n = (b & 63) + 1;
    terrain.fill(b >> 6, i, i + n);
    i += n;
  }
  if (i !== size) throw new Error(`Mapa ${id} dañado`);
  carveStraits(data, terrain);
  const shade = realShade(id, w, h, terrain);
  // Ríos: se marcan sobre la tierra y pasan a ser agua antes de calcular costas y masas
  const river = markRivers(w, h, terrain, [...(RIVERS[id] || []), ...mouthLines(data)]);
  riversToWater(w, h, terrain, river, shade);
  const map = new GameMap(w, h, terrain, shade, river);
  map.lat = data.lat || null; // [sur, norte] en grados: clima del terreno (desiertos, tundra…)
  map.relief = data.relief ? decodeRelief(data.relief) : null;
  // Kilómetros por casilla (a media latitud): para la fuerza del sombreado del relieve
  if (data.lon && data.lat) {
    const mid = (((data.lat[0] + data.lat[1]) / 2) * Math.PI) / 180;
    map.tileKm = ((data.lon[1] - data.lon[0]) * 111 * Math.max(0.3, Math.cos(mid))) / w;
  }
  map.rowWeight = data.lat ? rowWeights(data.lat, h) : null;
  // Un punto real que ahora cae en un río (Burundi, Bangladés…) pasa a la tierra más cercana
  const countries = data.countries.map(([name, tile, area, iso]) => ({ name, tile: map.isLand(tile) ? tile : nearestLand(map, tile), area, iso: iso || '' }));
  lastReal = { id, map, countries };
  return { map, countries: countries.map((c) => ({ ...c })) };
}

/** Casilla de tierra más cercana a `tile` (búsqueda en anchura determinista; prefiere la tierra más grande en un empate). */
function nearestLand(map, tile) {
  const nb = new Int32Array(4);
  const seen = new Set([tile]);
  let frontier = [tile];
  while (frontier.length) {
    let best = -1;
    for (const t of frontier) {
      if (map.isLand(t) && (best < 0 || map.landBodySizes[map.landBody[t]] > map.landBodySizes[map.landBody[best]])) best = t;
    }
    if (best >= 0) return best;
    const next = [];
    for (const t of frontier) {
      const c = map.neighbors(t, nb);
      for (let k = 0; k < c; k++) {
        if (seen.has(nb[k])) continue;
        seen.add(nb[k]);
        next.push(nb[k]);
      }
    }
    frontier = next;
  }
  return tile;
}

/**
 * Estrechos que la resolución del mapa cierra pero por los que deben pasar
 * los barcos, como líneas [lon, lat] (de mar a mar). El Bósforo y los
 * Dardanelos miden 1-2 km: a ~13 km por casilla desaparecían y el Mar Negro
 * quedaba aislado.
 */
const STRAITS = [
  // Mar Negro → Bósforo → Mármara → Dardanelos → Egeo
  [
    [29.2, 41.35],
    [29.07, 41.15],
    [28.99, 40.98],
    [28.6, 40.85],
    [27.6, 40.7],
    [26.9, 40.45],
    [26.55, 40.2],
    [26.2, 40.02],
    [25.9, 39.95],
  ],
];

/**
 * Desembocaduras que los datos no traen (el río acaba unas casillas tierra
 * adentro) y que la unión automática al agua más cercana resolvería mal: el
 * Nilo llegaba al golfo de Suez y el Rin se unía al Danubio (una barrera de
 * mar a mar que no existe). Líneas [lon, lat] que empiezan sobre los últimos
 * vértices del río (para que se toquen seguro) y acaban en el mar; se pintan
 * como río grande.
 */
const MOUTHS = [
  // Nilo: de El Cairo al Mediterráneo por el brazo de Rosetta
  [
    [31.26, 29.18],
    [31.26, 30.06],
    [30.95, 30.55],
    [30.6, 31.1],
    [30.38, 31.45],
    [30.3, 31.75],
  ],
  // Rin: por el Waal hasta el mar del Norte (Hoek van Holland)
  [
    [6.18, 51.81],
    [5.1, 51.81],
    [4.45, 51.9],
    [4.05, 51.98],
    [3.75, 52.02],
  ],
];

/** Las desembocaduras de MOUTHS que caben en el mapa, como polilíneas de río en casillas. */
function mouthLines(data) {
  if (!data.lon || !data.lat) return [];
  const { w, h } = data;
  const [lon0, lon1] = data.lon;
  const [lat0, lat1] = data.lat;
  const top = millerY(lat1);
  const span = top - millerY(lat0);
  const out = [];
  for (const line of MOUTHS) {
    if (!line.every(([lon, lat]) => lon >= lon0 && lon <= lon1 && lat >= lat0 && lat <= lat1)) continue;
    const pts = [2];
    for (const [lon, lat] of line) {
      pts.push(Math.min(w - 1, Math.floor(((lon - lon0) / (lon1 - lon0)) * w)), Math.min(h - 1, Math.floor(((top - millerY(lat)) / span) * h)));
    }
    out.push(pts);
  }
  return out;
}

/** Miller (como herramientas/mapas.js): la y del mapa crece hacia el sur. */
const millerY = (lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * ((lat * Math.PI) / 180)));

/**
 * Peso de cada fila (0-1): superficie real de una casilla de esa fila frente
 * a la del ecuador. En Miller, una casilla mide cos φ · cos(0,8 φ) veces lo
 * del ecuador: el norte sale estirado y, colocando al azar por casillas, se
 * llenaba de colonias (Groenlandia, el Ártico) y África se quedaba corta.
 */
function rowWeights([lat0, lat1], h) {
  const top = millerY(lat1);
  const span = top - millerY(lat0);
  const out = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    // Latitud del centro de la fila (Miller inversa)
    const m = top - ((y + 0.5) / h) * span;
    const lat = 2.5 * Math.atan(Math.exp(0.8 * m)) - (5 * Math.PI) / 8;
    out[y] = Math.max(0, Math.cos(lat) * Math.cos(0.8 * lat));
  }
  return out;
}

/** Abre en `terrain` un canal de 2 casillas a lo largo de cada estrecho que cae dentro del mapa. */
function carveStraits(data, terrain) {
  if (!data.lon || !data.lat) return;
  const { w, h } = data;
  const [lon0, lon1] = data.lon;
  const [lat0, lat1] = data.lat;
  const top = millerY(lat1);
  const span = top - millerY(lat0);
  const toXY = ([lon, lat]) => [((lon - lon0) / (lon1 - lon0)) * w, ((top - millerY(lat)) / span) * h];
  for (const line of STRAITS) {
    if (!line.every(([lon, lat]) => lon >= lon0 && lon <= lon1 && lat >= lat0 && lat <= lat1)) continue;
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, ay] = toXY(line[k]);
      const [bx, by] = toXY(line[k + 1]);
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 4));
      for (let s = 0; s <= steps; s++) {
        const x = Math.floor(ax + ((bx - ax) * s) / steps);
        const y = Math.floor(ay + ((by - ay) * s) / steps);
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h) terrain[yy * w + xx] = 0;
          }
        }
      }
    }
  }
}

/** Máxima altura representable en el relieve (como en herramientas/mapas.js). */
const RELIEF_MAX_M = 6500;

/**
 * Relieve de un mapa real: { w, h, step, data } con la altura en metros cada
 * `step` casillas. Formato: un byte por muestra (raíz de la altura); un 0 va
 * seguido de cuántos ceros repite.
 */
export function decodeRelief({ w, h, step, data }) {
  const bin = atob(data);
  const out = new Float32Array(w * h);
  let o = 0;
  for (let k = 0; k < bin.length; k++) {
    const b = bin.charCodeAt(k);
    if (b === 0) {
      o += bin.charCodeAt(++k); // ya son ceros
      continue;
    }
    const q = (b - 1) / 254;
    out[o++] = q * q * RELIEF_MAX_M;
  }
  return { w, h, step, data: out };
}

/** Tonos: profundidad del mar por distancia a la costa; textura y cumbres en tierra. */
function realShade(id, w, h, terrain) {
  const size = w * h;
  const shade = new Uint8Array(size);
  const rough = createNoise2D(hashString(id));
  // Distancia al tipo de terreno distinto (agua→costa, montaña→falda)
  const dist = new Uint8Array(size).fill(255);
  const queue = new Int32Array(size);
  const nb = new Int32Array(4);
  const tmp = { width: w, size, neighbors: GameMap.prototype.neighbors };
  let head = 0;
  let tail = 0;
  for (let t = 0; t < size; t++) {
    const c = tmp.neighbors(t, nb);
    for (let k = 0; k < c; k++) {
      if (terrain[nb[k]] !== terrain[t] && (terrain[t] === WATER || terrain[t] === MOUNTAIN)) {
        dist[t] = 1;
        queue[tail++] = t;
        break;
      }
    }
  }
  while (head < tail) {
    const t = queue[head++];
    const c = tmp.neighbors(t, nb);
    for (let k = 0; k < c; k++) {
      const n = nb[k];
      if (terrain[n] === terrain[t] && dist[n] === 255 && dist[t] < 254) {
        dist[n] = dist[t] + 1;
        queue[tail++] = n;
      }
    }
  }
  for (let t = 0; t < size; t++) {
    const d = dist[t] / RES;
    if (terrain[t] === WATER) shade[t] = Math.min(255, d * 14);
    else if (terrain[t] === MOUNTAIN) {
      // El ruido solo hace falta en las montañas (cumbres irregulares); el resto es plano
      const grain = fbm(rough, (t % w) / (6 * RES), ((t / w) | 0) / (6 * RES), 3);
      shade[t] = clampByte(Math.min(d, 8) * 26 + (grain - 0.5) * 60);
    } else shade[t] = 128;
  }
  return shade;
}
