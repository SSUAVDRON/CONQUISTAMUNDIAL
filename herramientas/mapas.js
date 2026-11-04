// Genera src/mapas-reales.js a partir de datos de Natural Earth (dominio público,
// https://www.naturalearthdata.com). Sin dependencias.
//
//   node herramientas/mapas.js <carpeta con los .geojson>
//
// Necesita, en esa carpeta (descargables de github.com/nvkelso/natural-earth-vector):
//   ne_50m_admin_0_countries.geojson   países (nombre en español: NAME_ES)
//   ne_50m_geography_regions_polys.geojson   cordilleras (Range/mtn) y mesetas (Plateau)
//   ne_50m_lakes.geojson               lagos
//
// Para cada mapa se rasteriza en proyección de Miller: agua, llanura, meseta y
// montaña (codificado por tramos y en base64), más la lista de países con la
// casilla más interior de cada uno (donde aparece su bot).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREA, RES } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WATER = 0;
const PLAINS = 1;
const HIGHLAND = 2;
const MOUNTAIN = 3;
// Medidas pensadas para la rejilla original: RES las adapta a la resolución actual
const MIN_COUNTRY_TILES = 40 * AREA;
// Jugabilidad: nada de islas ni lagos de unas pocas casillas
const MIN_ISLAND_TILES = 40 * AREA;
const MAX_LAKE_TILES = 12 * AREA;
const MAX_COUNTRIES = 90;

export const DEFS = [
  { id: 'mundo', name: 'Mundo', lon: [-180, 180], lat: [-56, 78], w: 880 * RES },
  { id: 'europa', name: 'Europa', lon: [-25, 45], lat: [34, 71], w: 640 * RES },
  { id: 'norteamerica', name: 'Norteamérica', lon: [-170, -50], lat: [7, 72], w: 720 * RES },
  { id: 'sudamerica', name: 'Sudamérica', lon: [-92, -30], lat: [-56, 14], w: 480 * RES },
  { id: 'africa', name: 'África', lon: [-20, 55], lat: [-36, 38], w: 560 * RES },
  { id: 'asia', name: 'Asia', lon: [25, 150], lat: [-11, 62], w: 760 * RES },
];

// Nombres demasiado largos para la etiqueta de una nación
const SHORT_NAMES = {
  'República Democrática del Congo': 'R. D. del Congo',
  'República del Congo': 'Congo',
  'República Centroafricana': 'Centroáfrica',
  'Bosnia y Herzegovina': 'Bosnia',
  'República Dominicana': 'R. Dominicana',
  'Emiratos Árabes Unidos': 'Emiratos Árabes',
  'Estados Federados de Micronesia': 'Micronesia',
  'Islas Malvinas': 'Malvinas',
  'Tierras Australes y Antárticas Francesas': 'Tierras Australes',
  'Islas Georgias del Sur y Sandwich del Sur': 'Georgias del Sur',
};

/** Nombre corto para la etiqueta: tabla propia o recorte por palabras. */
function shortName(name) {
  if (SHORT_NAMES[name]) return SHORT_NAMES[name];
  if (name.length <= 22) return name;
  let out = '';
  for (const word of name.split(' ')) {
    if ((out + ' ' + word).trim().length > 22) break;
    out = (out + ' ' + word).trim();
  }
  return out || name.slice(0, 22);
}

const miller = (latDeg) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * ((latDeg * Math.PI) / 180)));

function makeProjection(def) {
  const [lon0, lon1] = def.lon;
  const yTop = miller(def.lat[1]);
  const yBottom = miller(def.lat[0]);
  const spanX = ((lon1 - lon0) * Math.PI) / 180;
  const w = def.w;
  const h = Math.round((w * (yTop - yBottom)) / spanX);
  return {
    w,
    h,
    project: ([lon, lat]) => [((lon - lon0) / (lon1 - lon0)) * w, ((yTop - miller(Math.max(-85, Math.min(85, lat)))) / (yTop - yBottom)) * h],
  };
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** Rellena un polígono (con agujeros, regla par-impar) llamando a paint(i). */
function fillPolygon(rings, proj, paint) {
  const projected = rings.map((ring) => ring.map(proj.project));
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const ring of projected) {
    for (const [x, y] of ring) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (maxX < 0 || minX > proj.w || maxY < 0 || minY > proj.h) return;
  const r0 = Math.max(0, Math.ceil(minY - 0.5));
  const r1 = Math.min(proj.h - 1, Math.floor(maxY - 0.5));
  const xs = [];
  for (let r = r0; r <= r1; r++) {
    const yc = r + 0.5;
    xs.length = 0;
    for (const ring of projected) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > yc) !== (yj > yc)) xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const c1 = Math.min(proj.w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let c = c0; c <= c1; c++) paint(r * proj.w + c);
    }
  }
}

/** Codifica por tramos: cada byte = valor (2 bits) + longitud-1 (6 bits). */
function encodeRle(grid) {
  const bytes = [];
  let i = 0;
  while (i < grid.length) {
    const v = grid[i];
    let n = 1;
    while (i + n < grid.length && grid[i + n] === v) n++;
    i += n;
    while (n > 0) {
      const chunk = Math.min(64, n);
      bytes.push((v << 6) | (chunk - 1));
      n -= chunk;
    }
  }
  return Buffer.from(bytes).toString('base64');
}

/**
 * Componentes conexas (4-vecindad) de tierra o agua: devuelve, por casilla, el
 * tamaño de su componente y si toca el borde del mapa.
 */
function componentSizes(terrain, w, h, wantLand) {
  const size = w * h;
  const comp = new Int32Array(size).fill(-1);
  const sizes = [];
  const edge = [];
  const queue = new Int32Array(size);
  for (let s = 0; s < size; s++) {
    if (comp[s] !== -1 || (terrain[s] !== WATER) !== wantLand) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    let touches = false;
    queue[tail++] = s;
    comp[s] = id;
    while (head < tail) {
      const t = queue[head++];
      const x = t % w;
      if (x === 0 || x === w - 1 || t < w || t >= size - w) touches = true;
      for (const n of [x > 0 ? t - 1 : -1, x < w - 1 ? t + 1 : -1, t - w, t + w]) {
        if (n < 0 || n >= size || comp[n] !== -1 || (terrain[n] !== WATER) !== wantLand) continue;
        comp[n] = id;
        queue[tail++] = n;
      }
    }
    sizes.push(tail);
    edge.push(touches);
  }
  return { comp, sizes, edge };
}

/** Hunde islas pequeñas y rellena lagos pequeños (in situ). */
function removeSpecks(terrain, owner, w, h) {
  let sunk = 0;
  let filled = 0;
  const land = componentSizes(terrain, w, h, true);
  for (let i = 0; i < terrain.length; i++) {
    const c = land.comp[i];
    if (c >= 0 && land.sizes[c] < MIN_ISLAND_TILES) {
      terrain[i] = WATER;
      owner[i] = 0;
      sunk++;
    }
  }
  const water = componentSizes(terrain, w, h, false);
  for (let i = 0; i < terrain.length; i++) {
    const c = water.comp[i];
    if (c >= 0 && !water.edge[c] && water.sizes[c] < MAX_LAKE_TILES) {
      terrain[i] = PLAINS;
      // El hueco pasa al país de alguna casilla vecina
      const x = i % w;
      owner[i] = (x > 0 && owner[i - 1]) || (x < w - 1 && owner[i + 1]) || (i >= w && owner[i - w]) || owner[i + w] || 0;
      filled++;
    }
  }
  return { sunk, filled };
}

/** Distancia (4-vecindad) al borde de la región de cada casilla. */
function interiorDistance(labels, w, h) {
  const size = w * h;
  const d = new Uint16Array(size);
  for (let i = 0; i < size; i++) {
    const o = labels[i];
    if (!o) continue;
    const x = i % w;
    const edge = x === 0 || x === w - 1 || i < w || i >= size - w ||
      labels[i - 1] !== o || labels[i + 1] !== o || labels[i - w] !== o || labels[i + w] !== o;
    d[i] = edge ? 1 : 65535;
  }
  for (let i = 0; i < size; i++) {
    if (d[i] <= 1) continue;
    d[i] = Math.min(d[i], d[i - 1] + 1, d[i - w] + 1);
  }
  for (let i = size - 1; i >= 0; i--) {
    if (d[i] <= 1) continue;
    d[i] = Math.min(d[i], d[i + 1] + 1, d[i + w] + 1);
  }
  return d;
}

function buildMap(def, countries, regions, lakes) {
  const proj = makeProjection(def);
  const size = proj.w * proj.h;
  const terrain = new Uint8Array(size);
  const owner = new Int16Array(size); // índice de país + 1

  countries.forEach((f, idx) => {
    for (const poly of polygonsOf(f.geometry)) {
      fillPolygon(poly, proj, (i) => {
        terrain[i] = PLAINS;
        owner[i] = idx + 1;
      });
    }
  });
  for (const f of lakes) {
    for (const poly of polygonsOf(f.geometry)) {
      fillPolygon(poly, proj, (i) => {
        terrain[i] = WATER;
        owner[i] = 0;
      });
    }
  }
  for (const f of regions) {
    const cls = f.properties.FEATURECLA;
    const value = cls === 'Range/mtn' ? MOUNTAIN : cls === 'Plateau' ? HIGHLAND : 0;
    if (!value) continue;
    for (const poly of polygonsOf(f.geometry)) {
      fillPolygon(poly, proj, (i) => {
        if (terrain[i] !== WATER && terrain[i] < value) terrain[i] = value;
      });
    }
  }
  const cleaned = removeSpecks(terrain, owner, proj.w, proj.h);

  // Las cordilleras de Natural Earth son zonas amplias: su borde pasa a meseta
  const mt = interiorDistance(Uint8Array.from(terrain, (t) => (t === MOUNTAIN ? 1 : 0)), proj.w, proj.h);
  for (let i = 0; i < size; i++) if (terrain[i] === MOUNTAIN && mt[i] <= 2 * RES) terrain[i] = HIGHLAND;

  // Países: tamaño y casilla más interior (donde aparecerá su bot)
  const dist = interiorDistance(owner, proj.w, proj.h);
  const stats = new Map();
  for (let i = 0; i < size; i++) {
    const o = owner[i];
    if (!o) continue;
    let s = stats.get(o);
    if (!s) stats.set(o, (s = { area: 0, best: -1, bestD: 0 }));
    s.area++;
    if (dist[i] > s.bestD) {
      s.bestD = dist[i];
      s.best = i;
    }
  }
  const list = [...stats.entries()]
    .filter(([, s]) => s.area >= MIN_COUNTRY_TILES)
    .sort((a, b) => b[1].area - a[1].area)
    .slice(0, MAX_COUNTRIES)
    .map(([o, s]) => {
      const p = countries[o - 1].properties;
      const name = p.NAME_ES || p.NAME;
      const iso = /^[A-Z]{2}$/.test(p.ISO_A2_EH || '') ? p.ISO_A2_EH.toLowerCase() : '';
      return [shortName(name), s.best, s.area, iso];
    });

  let land = 0;
  for (let i = 0; i < size; i++) if (terrain[i] !== WATER) land++;
  console.log(`${def.id}: ${proj.w}×${proj.h}, tierra ${((100 * land) / size).toFixed(0)} %, ${list.length} países, ${cleaned.sunk} casillas de islotes hundidas, ${cleaned.filled} de charcas rellenas`);
  return { name: def.name, w: proj.w, h: proj.h, rle: encodeRle(terrain), countries: list };
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Uso: node herramientas/mapas.js <carpeta con los .geojson de Natural Earth>');
    process.exit(1);
  }
  const load = async (name) => JSON.parse(await readFile(join(dir, name), 'utf8')).features;
  const countries = (await load('ne_50m_admin_0_countries.geojson')).filter((f) => f.properties.CONTINENT !== 'Antarctica');
  const regions = await load('ne_50m_geography_regions_polys.geojson');
  const lakes = await load('ne_50m_lakes.geojson');

  const maps = {};
  for (const def of DEFS) maps[def.id] = buildMap(def, countries, regions, lakes);

  const out = `// GENERADO por herramientas/mapas.js — no editar a mano.
// Datos: Natural Earth (dominio público), https://www.naturalearthdata.com
// Por mapa: ancho, alto, terreno codificado por tramos (base64) y países
// [nombre, casilla más interior, casillas, código ISO] de mayor a menor.
export const REAL_MAP_DATA = ${JSON.stringify(maps)};
`;
  await writeFile(join(ROOT, 'src', 'mapas-reales.js'), out);
  console.log(`src/mapas-reales.js: ${Math.round(Buffer.byteLength(out) / 1024)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
