// Mapa del mundo: rejilla de casillas con tipo de terreno. Se genera de forma
// procedural a partir de una semilla (continentes + islas + cordilleras).
import { TERRAIN } from './config.js';
import { Rng } from './rng.js';
import { createNoise2D, fbm } from './noise.js';

const { WATER, PLAINS, HIGHLAND, MOUNTAIN } = TERRAIN;

const LAND_SHARE = 0.42; // fracción aproximada de tierra
const HIGHLAND_Q = 0.66; // percentil de altura (dentro de la tierra) para mesetas
const MOUNTAIN_Q = 0.9; // percentil para montañas
const MIN_ISLAND = 25; // islas más pequeñas se hunden
const MAX_LAKE = 15; // lagos más pequeños se rellenan

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
    const grain = (fbm(rough, x / 5, y / 5, 2) - 0.5) * 50;
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
  return new GameMap(width, height, terrain, shade);
}

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
