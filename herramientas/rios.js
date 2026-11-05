// Genera src/rios.js: los ríos de cada mapa real a partir de Natural Earth
// (dominio público, https://www.naturalearthdata.com). Sin dependencias.
//
//   node herramientas/rios.js <ne_50m_rivers_lake_centerlines.geojson>
//
// Descargable de github.com/nvkelso/natural-earth-vector (carpeta geojson).
// Cada río se proyecta igual que los mapas (Miller, ver herramientas/mapas.js),
// se simplifica a casillas enteras y se guarda como [clase, x0, y0, x1, y1, …]
// (clase 2 = río grande, de dos casillas de ancho; 1 = normal). El juego los
// dibuja y los marca en el mapa al cargarlo (map.js).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RES } from '../src/config.js';
import { REAL_MAP_DATA } from '../src/mapas-reales.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Los mismos recortes que herramientas/mapas.js
const DEFS = [
  { id: 'mundo', lon: [-180, 180], lat: [-56, 78], w: 880 * RES, maxRank: 4 },
  { id: 'europa', lon: [-25, 45], lat: [34, 71], w: 640 * RES, maxRank: 6 },
  { id: 'norteamerica', lon: [-170, -50], lat: [7, 72], w: 720 * RES, maxRank: 6 },
  { id: 'sudamerica', lon: [-92, -30], lat: [-56, 14], w: 480 * RES, maxRank: 6 },
  { id: 'africa', lon: [-20, 55], lat: [-36, 38], w: 560 * RES, maxRank: 6 },
  { id: 'asia', lon: [25, 150], lat: [-11, 62], w: 760 * RES, maxRank: 5 },
];
// Ríos grandes (dos casillas de ancho): los de rango 1-2 de Natural Earth
const MAJOR_RANK = 2;
// Menos de esto (en casillas, ya proyectado) no merece la pena
const MIN_LENGTH = 6 * RES;

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

/** Douglas-Peucker: quita los puntos que se desvían menos de `tol` casillas. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function linesOf(geometry) {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function buildRivers(def, features) {
  const proj = makeProjection(def);
  const real = REAL_MAP_DATA[def.id];
  if (real.w !== proj.w || real.h !== proj.h) throw new Error(`${def.id}: el tamaño no coincide con mapas-reales.js`);
  const out = [];
  for (const f of features) {
    const rank = f.properties.scalerank;
    if (rank > def.maxRank) continue;
    const cls = rank <= MAJOR_RANK ? 2 : 1;
    for (const line of linesOf(f.geometry)) {
      // Solo lo que cae dentro del recorte (con un margen)
      const pts = line.map(proj.project);
      if (!pts.some(([x, y]) => x >= -2 && y >= -2 && x <= proj.w + 2 && y <= proj.h + 2)) continue;
      const simple = simplify(pts, 0.6).map(([x, y]) => [Math.round(x), Math.round(y)]);
      let length = 0;
      for (let i = 1; i < simple.length; i++) length += Math.hypot(simple[i][0] - simple[i - 1][0], simple[i][1] - simple[i - 1][1]);
      if (length < MIN_LENGTH) continue;
      const flat = [cls];
      for (const [x, y] of simple) {
        const n = flat.length;
        // Sin puntos repetidos tras redondear
        if (n > 1 && flat[n - 2] === x && flat[n - 1] === y) continue;
        flat.push(x, y);
      }
      if (flat.length >= 5) out.push(flat);
    }
  }
  return out;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node herramientas/rios.js <ne_50m_rivers_lake_centerlines.geojson>');
    process.exit(1);
  }
  const features = JSON.parse(await readFile(file, 'utf8')).features;
  const rivers = {};
  for (const def of DEFS) rivers[def.id] = buildRivers(def, features);
  const out = `// GENERADO por herramientas/rios.js — no editar a mano.
// Datos: Natural Earth (dominio público), https://www.naturalearthdata.com
// Por mapa: ríos como [clase, x0, y0, x1, y1, …] en casillas (clase 2 = grande).
export const RIVERS = ${JSON.stringify(rivers)};
`;
  await writeFile(join(ROOT, 'src', 'rios.js'), out);
  const counts = Object.entries(rivers).map(([k, v]) => `${k} ${v.length}`).join(', ');
  console.log(`src/rios.js: ${Math.round(Buffer.byteLength(out) / 1024)} KB (${counts})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
