// Mapa del mundo: rejilla de casillas con tipo de terreno. Se genera de forma
// procedural a partir de una semilla (continentes + islas + cordilleras).
import { AREA, RES, TERRAIN } from './config.js';
import { Rng, hashString } from './rng.js';
import { createNoise2D, fbm } from './noise.js';
import { REAL_MAP_DATA } from './mapas-reales.js';

const { WATER, PLAINS, HIGHLAND, MOUNTAIN } = TERRAIN;

const LAND_SHARE = 0.42; // fracción aproximada de tierra
const HIGHLAND_Q = 0.66; // percentil de altura (dentro de la tierra) para mesetas
const MOUNTAIN_Q = 0.9; // percentil para montañas
const MIN_ISLAND = 40 * AREA; // islas más pequeñas se hunden (jugabilidad)
const MAX_LAKE = 15 * AREA; // lagos más pequeños se rellenan

export class GameMap {
  constructor(width, height, terrain, shade) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.terrain = terrain; // Uint8Array, valores de TERRAIN
    this.shade = shade; // Uint8Array 0..255: altura relativa (tierra) o profundidad (agua)
    this._computeDerived();
  }

  isLand(i) {
    return this.terrain[i] !== WATER;
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
    const { size, terrain } = this;
    const nb = new Int32Array(4);
    const coastal = new Uint8Array(size);
    const landList = [];
    const coastList = [];
    for (let i = 0; i < size; i++) {
      if (terrain[i] === WATER) continue;
      landList.push(i);
      const c = this.neighbors(i, nb);
      for (let k = 0; k < c; k++) {
        if (terrain[nb[k]] === WATER) {
          coastal[i] = 1;
          break;
        }
      }
      if (coastal[i]) coastList.push(i);
    }
    this.landCount = landList.length;
    this.landTiles = Int32Array.from(landList);
    this.coastal = coastal;
    this.coastTiles = Int32Array.from(coastList);

    const land = labelComponents(this, true);
    this.landBody = land.labels;
    this.landBodySizes = land.sizes;
    const water = labelComponents(this, false);
    this.waterBody = water.labels;
    this.waterBodySizes = water.sizes;
  }
}

/** Etiqueta componentes conexas (4-vecindad) de tierra o de agua. */
function labelComponents(map, wantLand) {
  const { size, terrain } = map;
  const labels = new Int32Array(size).fill(-1);
  const sizes = [];
  const queue = new Int32Array(size);
  const nb = new Int32Array(4);
  for (let s = 0; s < size; s++) {
    if (labels[s] !== -1 || (terrain[s] !== WATER) !== wantLand) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    labels[s] = id;
    while (head < tail) {
      const t = queue[head++];
      const c = map.neighbors(t, nb);
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (labels[n] === -1 && (terrain[n] !== WATER) === wantLand) {
          labels[n] = id;
          queue[tail++] = n;
        }
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
  return map;
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
  const map = new GameMap(w, h, terrain, realShade(id, w, h, terrain));
  map.lat = data.lat || null; // [sur, norte] en grados: clima del terreno (desiertos, tundra…)
  map.relief = data.relief ? decodeRelief(data.relief) : null;
  // Kilómetros por casilla (a media latitud): para la fuerza del sombreado del relieve
  if (data.lon && data.lat) {
    const mid = (((data.lat[0] + data.lat[1]) / 2) * Math.PI) / 180;
    map.tileKm = ((data.lon[1] - data.lon[0]) * 111 * Math.max(0.3, Math.cos(mid))) / w;
  }
  const countries = data.countries.map(([name, tile, area, iso]) => ({ name, tile, area, iso: iso || '' }));
  lastReal = { id, map, countries };
  return { map, countries: countries.map((c) => ({ ...c })) };
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
