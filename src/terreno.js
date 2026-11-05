// Terreno del mapa, pintado una sola vez al empezar la partida:
// - el mar, azul marino plano con manchas muy suaves;
// - la tierra en colores planos de mapa de juego según la altura y el clima:
//   llanura verde oliva, meseta y desierto color arena, montaña gris claro y
//   cumbres casi blancas, mezcladas en los bordes con un moteado de píxeles;
//   la costa, con un contorno oscuro; los ríos, en azul;
// Mar y tierra se juntan en una sola imagen opaca (barata de dibujar).
// Todo esto es solo visual: no afecta a la simulación.
import { RES, TERRAIN } from './config.js';
import { hash2, valueNoise } from './noise.js';

const { WATER } = TERRAIN;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Desenfoque de caja (radio r) en el sitio, por filas y luego por columnas. */
function boxBlur(a, W, H, r) {
  const line = new Float32Array(Math.max(W, H));
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += a[o + clamp(x, 0, W - 1)];
    for (let x = 0; x < W; x++) {
      line[x] = sum / n;
      sum += a[o + Math.min(W - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
    }
    a.set(line.subarray(0, W), o);
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += a[clamp(y, 0, H - 1) * W + x];
    for (let y = 0; y < H; y++) {
      line[y] = sum / n;
      sum += a[Math.min(H - 1, y + r + 1) * W + x] - a[Math.max(0, y - r) * W + x];
    }
    for (let y = 0; y < H; y++) a[y * W + x] = line[y];
  }
}

let cr = 0;
let cg = 0;
let cb = 0;

// Paleta plana de mapa de juego: llanura verde oliva, meseta color arena,
// montaña gris claro y cumbres casi blancas. Las zonas se mezclan en los
// bordes con un moteado de píxeles (sin degradados ni sombreado).
const TERRAIN_COLORS = [
  [118, 146, 74], // llanura
  [192, 170, 122], // meseta / desierto
  [174, 174, 170], // montaña
  [214, 214, 210], // cumbre
];
const COAST = [46, 49, 55]; // contorno de la costa
const SEA = [27, 45, 82]; // mar

/**
 * Color plano de una casilla en (cr, cg, cb): según su altura `e` (m), lo
 * seca que es la zona (0-1) y dos ruidos: `speck` (por casilla, para el
 * moteado de los bordes entre zonas) y `patch` (manchas grandes).
 */
function flatColor(e, dry, speck, patch) {
  const v = e + dry * 650 + (speck - 0.5) * 520 + (patch - 0.5) * 260;
  const k = v < 320 ? 0 : v < 1450 ? 1 : v < 2700 ? 2 : 3;
  const c = TERRAIN_COLORS[k];
  // Un pelín de variación de brillo por casilla (textura de píxel)
  const b = 1 + (speck - 0.5) * 0.07;
  cr = c[0] * b;
  cg = c[1] * b;
  cb = c[2] * b;
}
// Ríos: azul de agua dulce (algo más claro que el mar) y el de los grandes, más hondo
const RIVER = [52, 86, 140];
const RIVER_BIG = [40, 70, 122];

/** ¿Toca la casilla de río `i` tierra sin río? (orilla, algo más oscura) */
function riverEdge(i, W, H, river) {
  const x = i % W;
  return (x > 0 && !river[i - 1]) || (x < W - 1 && !river[i + 1]) || (i >= W && !river[i - W]) || (i < W * (H - 1) && !river[i + W]);
}

/** Píxeles de terreno por casilla: más en mapas pequeños, sin pasarse de memoria. */
export function terrainScale(map) {
  return clamp(Math.floor(Math.sqrt(3.2e6 / map.size)), 1, 4);
}

/**
 * Devuelve { water, land, scale }: `water` mide lo mismo que el mapa y `land`
 * es `scale` veces mayor (transparente sobre el agua salvo la espuma).
 */
let lastPaint = null; // el terreno pintado del último mapa (mismo mapa = mismo dibujo)

export function paintTerrain(map) {
  if (lastPaint && lastPaint.map === map) return lastPaint.result;
  const result = paintTerrainNow(map);
  lastPaint = { map, result };
  return result;
}

function paintTerrainNow(map) {
  const { width: W, height: H, size, terrain } = map;
  const S = terrainScale(map);
  const seed = (W * 73856093) ^ (H * 19349663);

  // ---- Mapa físico: color según la altura (verde en las tierras bajas, arena
  // en mesetas, gris y blanco en las montañas) y sombreado del relieve con luz
  // del noroeste. La altura sale de map.relief (mapas reales: datos de NOAA;
  // aleatorios: el ruido del generador) más un detalle de crestas en las
  // montañas. En los mapas reales, la franja de desiertos tira a arena.
  const latOf = (() => {
    if (!map.lat) return null;
    const miller = (d) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * ((d * Math.PI) / 180)));
    const yTop = miller(map.lat[1]);
    const yBottom = miller(map.lat[0]);
    const lats = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      const m = yTop - ((y + 0.5) / H) * (yTop - yBottom);
      lats[y] = (2.5 * (Math.atan(Math.exp(0.8 * m)) - Math.PI / 4) * 180) / Math.PI;
    }
    return lats;
  })();
  const rel = map.relief;
  const FALLBACK_M = [0, 150, 1200, 2600]; // por tipo, si el mapa no trae relieve
  // Relieve visual (sin unidades) para el sombreado: pendiente real exagerada
  // según los km por casilla + crestas de ruido que no dependen de la escala
  const kz = 26 / (Math.max(0.5, map.tileKm || 4) * 1000);
  const relief = new Float32Array(size);
  const detail = new Uint8Array(size); // crestas (0-255), se suman tras suavizar
  const R = new Uint8ClampedArray(size);
  const G = new Uint8ClampedArray(size);
  const B = new Uint8ClampedArray(size);
  for (let y = 0; y < H; y++) {
    const lat = latOf ? Math.abs(latOf[y]) : -1;
    const sub = lat >= 0 ? smooth(10, 17, lat) * (1 - smooth(31, 38, lat)) : 0; // franja de desiertos
    const fy = rel ? y / rel.step : 0;
    const y0 = rel ? Math.min(rel.h - 2, fy | 0) : 0;
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = terrain[i];
      if (t === WATER) continue;
      let e;
      if (rel) {
        const fx = x / rel.step;
        const x0 = Math.min(rel.w - 2, fx | 0);
        const tx = fx - x0;
        const k = y0 * rel.w + x0;
        const d = rel.data;
        const a = d[k];
        const b = d[k + 1];
        const c = d[k + rel.w];
        const dd = d[k + rel.w + 1];
        e = a + (b - a) * tx + (c - a) * ty + (a - b - c + dd) * tx * ty;
      } else e = FALLBACK_M[t];
      // Crestas: solo en las tierras altas, más marcadas cuanto más alto
      const rough = smooth(500, 2800, e);
      let ridge = 0;
      if (rough > 0) {
        const r1 = 1 - Math.abs(valueNoise(x, y, 2.4 * RES, seed + 21) * 2 - 1);
        const r2 = 1 - Math.abs(valueNoise(x, y, 1 * RES, seed + 22) * 2 - 1);
        ridge = (r1 * 0.65 + r2 * 0.35) * rough;
      }
      relief[i] = e * kz;
      detail[i] = Math.round(ridge * 230 + valueNoise(x, y, 1.5 * RES, seed + 23) * 25);
      // Aridez: en la franja de desiertos (o según la humedad en los mapas
      // aleatorios) las tierras bajas tiran a arena
      const moist = valueNoise(x, y, 30 * RES, seed);
      const dry = lat >= 0 ? clamp(sub * (1.3 - moist * 0.8), 0, 1) : smooth(0.34, 0.16, moist);
      flatColor(e + ridge * 420, dry, hash2(x, y, seed + 17), valueNoise(x, y, 3 * RES, seed + 5));
      R[i] = cr;
      G[i] = cg;
      B[i] = cb;
    }
  }
  // La rejilla del relieve es más gruesa que las casillas: se suaviza para que
  // el sombreado no muestre facetas, y luego se añaden las crestas
  const br = rel ? Math.max(1, Math.round(rel.step * 0.75)) : 1;
  boxBlur(relief, W, H, br);
  boxBlur(relief, W, H, br);
  for (let i = 0; i < size; i++) if (detail[i]) relief[i] += detail[i] * (2 / 255);
  // Sombreado: luz del noroeste; las laderas al sureste, más oscuras
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (terrain[i] === WATER) continue;
      const h0 = relief[i];
      const hl = terrain[i - 1] === WATER ? h0 : relief[i - 1];
      const hr = terrain[i + 1] === WATER ? h0 : relief[i + 1];
      const hu = terrain[i - W] === WATER ? h0 : relief[i - W];
      const hd = terrain[i + W] === WATER ? h0 : relief[i + W];
      const dx = (hr - hl) * 0.5;
      const dy = (hd - hu) * 0.5;
      const lit = (dx + dy + 1) / Math.sqrt(1 + dx * dx + dy * dy); // 1 en llano
      // Mapa plano: el relieve apenas se insinúa
      const m = clamp(1 + (lit - 1) * 0.08, 0.92, 1.05);
      R[i] = R[i] * m;
      G[i] = G[i] * m;
      B[i] = B[i] * m;
    }
  }

  // ---- Qué vecinos son de otro tipo (agua/tierra), para playas y espuma
  //  bits: 1 O, 2 E, 4 N, 8 S, 16 NO, 32 NE, 64 SO, 128 SE
  const edge = new Uint8Array(size);
  const isW = new Uint8Array(size);
  for (let i = 0; i < size; i++) isW[i] = terrain[i] === WATER ? 1 : 0;
  for (let y = 0; y < H; y++) {
    const up = y > 0;
    const down = y < H - 1;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const w = isW[i];
      const left = x > 0;
      const right = x < W - 1;
      let m = 0;
      if (left && isW[i - 1] !== w) m |= 1;
      if (right && isW[i + 1] !== w) m |= 2;
      if (up && isW[i - W] !== w) m |= 4;
      if (down && isW[i + W] !== w) m |= 8;
      if (up && left && isW[i - W - 1] !== w) m |= 16;
      if (up && right && isW[i - W + 1] !== w) m |= 32;
      if (down && left && isW[i + W - 1] !== w) m |= 64;
      if (down && right && isW[i + W + 1] !== w) m |= 128;
      edge[i] = m;
    }
  }
  /** Distancia (en casillas) desde (fx, fy) dentro de la casilla al borde con el otro tipo. */
  const edgeDist = (m, fx, fy) => {
    let d = 9;
    if (m & 1) d = Math.min(d, fx);
    if (m & 2) d = Math.min(d, 1 - fx);
    if (m & 4) d = Math.min(d, fy);
    if (m & 8) d = Math.min(d, 1 - fy);
    if (m & 16) d = Math.min(d, Math.hypot(fx, fy));
    if (m & 32) d = Math.min(d, Math.hypot(1 - fx, fy));
    if (m & 64) d = Math.min(d, Math.hypot(fx, 1 - fy));
    if (m & 128) d = Math.min(d, Math.hypot(1 - fx, 1 - fy));
    return d;
  };

  // ---- Tierra a alta resolución
  const river = map.river && map.river.some((v) => v) ? map.river : null;
  const LW = W * S;
  const LH = H * S;
  const land = makeCanvas(LW, LH);
  const lctx = land.getContext('2d');
  const img = lctx.createImageData(LW, LH);
  const px = new Uint32Array(img.data.buffer);
  for (let py = 0; py < LH; py++) {
    const ty = (py + 0.5) / S;
    const cy = Math.floor(ty);
    const fy = ty - cy;
    for (let pxl = 0; pxl < LW; pxl++) {
      const tx = (pxl + 0.5) / S;
      const cx = Math.floor(tx);
      const fx = tx - cx;
      const i = cy * W + cx;
      const o = py * LW + pxl;
      const m = edge[i];
      if (terrain[i] === WATER) continue; // el mar va en su propia capa
      const rv = river ? river[i] : 0;
      if (rv) {
        // Río: azul algo más claro que el mar (los grandes, un poco más hondos),
        // con la orilla un pelín más oscura y algo de grano
        const bank = (riverEdge(i, W, H, river) ? 0.86 : 1) + (hash2(pxl, py, seed + 41) - 0.5) * 0.05;
        const c = rv === 2 ? RIVER_BIG : RIVER;
        px[o] = ((255 << 24) | ((clamp(c[2] * bank, 0, 255) | 0) << 16) | ((clamp(c[1] * bank, 0, 255) | 0) << 8) | (clamp(c[0] * bank, 0, 255) | 0)) >>> 0;
        continue;
      }
      // Color plano de la casilla
      let r = R[i];
      let g = G[i];
      let b = B[i];
      if (m & 15) {
        // Costa: contorno oscuro de una casilla (con varios píxeles por
        // casilla, solo la franja pegada al agua)
        if (S === 1 || edgeDist(m, fx, fy) < 0.5) {
          r = COAST[0];
          g = COAST[1];
          b = COAST[2];
        }
      }
      r = clamp(r, 0, 255) | 0;
      g = clamp(g, 0, 255) | 0;
      b = clamp(b, 0, 255) | 0;
      px[o] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
  }
  lctx.putImageData(img, 0, 0);

  // ---- Mar: distancia a la costa → color
  const dist = new Uint8Array(size).fill(255);
  const queue = new Int32Array(size);
  const nb = new Int32Array(4);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < size; i++) {
    if (terrain[i] !== WATER) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const t = queue[head++];
    if (dist[t] >= 60 * RES) continue;
    const c = map.neighbors(t, nb);
    for (let k = 0; k < c; k++) {
      const n = nb[k];
      if (dist[n] === 255) {
        dist[n] = dist[t] + 1;
        queue[tail++] = n;
      }
    }
  }
  const water = makeCanvas(W, H);
  const wctx = water.getContext('2d');
  const wimg = wctx.createImageData(W, H);
  const wd = wimg.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = i * 4;
      // Mar azul marino plano, con manchas muy suaves y algo de grano
      const n = (valueNoise(x, y, 14 * RES, seed + 31) - 0.5) * 7 + (hash2(x, y, seed + 29) - 0.5) * 3;
      wd[o] = clamp(SEA[0] + n * 0.6, 0, 255);
      wd[o + 1] = clamp(SEA[1] + n * 0.8, 0, 255);
      wd[o + 2] = clamp(SEA[2] + n, 0, 255);
      wd[o + 3] = 255;
    }
  }
  wctx.putImageData(wimg, 0, 0);
  // Mar y tierra en una sola imagen opaca: en cada fotograma se dibuja una
  // vez (y solo la parte visible), en lugar de dos capas con transparencia
  const base = makeCanvas(W * S, H * S);
  const bctx = base.getContext('2d');
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(water, 0, 0, W * S, H * S);
  bctx.drawImage(land, 0, 0);
  return { base, scale: S };
}

/**
 * Vista previa ligera de un mapa (miniaturas y portada del inicio), con el
 * mismo estilo que la partida: color por altura, relieve sombreado, filo claro
 * en la costa y mar azul marino. Muestrea casillas en vez de pintarlas todas.
 * `data`: { w, h, terrain, relief, tileKm }; `crop`: [x0, y0, x1, y1] en casillas.
 */
export function paintMapPreview(canvas, data, crop = null) {
  const { w, h, terrain, relief } = data;
  const [x0, y0, x1, y1] = crop || [0, 0, w, h];
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const sx = (x1 - x0) / W;
  const sy = (y1 - y0) / H;
  const FALLBACK_M = [0, 150, 1200, 2600];
  const elev = (tx, ty) => {
    const xi = Math.max(0, Math.min(w - 1, tx | 0));
    const yi = Math.max(0, Math.min(h - 1, ty | 0));
    const t = terrain[yi * w + xi];
    if (t === WATER) return 0;
    if (!relief) return FALLBACK_M[t];
    const fx = tx / relief.step;
    const fy = ty / relief.step;
    const gx = Math.max(0, Math.min(relief.w - 2, fx | 0));
    const gy = Math.max(0, Math.min(relief.h - 2, fy | 0));
    const ax = fx - gx;
    const ay = fy - gy;
    const k = gy * relief.w + gx;
    const r = relief.data;
    return r[k] + (r[k + 1] - r[k]) * ax + (r[k + relief.w] - r[k]) * ay + (r[k] - r[k + 1] - r[k + relief.w] + r[k + relief.w + 1]) * ax * ay;
  };
  // Latitud de cada fila (mapas reales): para pintar los desiertos
  if (data.lat && !data.latOf) {
    const miller = (deg) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * ((deg * Math.PI) / 180)));
    const yTop = miller(data.lat[1]);
    const yBottom = miller(data.lat[0]);
    data.latOf = (ty) => {
      const m = yTop - (ty / h) * (yTop - yBottom);
      return (2.5 * (Math.atan(Math.exp(0.8 * m)) - Math.PI / 4) * 180) / Math.PI;
    };
  }
  for (let py = 0; py < H; py++) {
    const ty = y0 + (py + 0.5) * sy;
    for (let px = 0; px < W; px++) {
      const tx = x0 + (px + 0.5) * sx;
      const i = Math.min(h - 1, ty | 0) * w + Math.min(w - 1, tx | 0);
      const o = (py * W + px) * 4;
      d[o + 3] = 255;
      if (terrain[i] === WATER) {
        d[o] = SEA[0];
        d[o + 1] = SEA[1];
        d[o + 2] = SEA[2];
        continue;
      }
      if (data.river && data.river[i]) {
        const c = data.river[i] === 2 ? RIVER_BIG : RIVER;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        continue;
      }
      const e = elev(tx, ty);
      // Costa: contorno oscuro
      const coast = terrain[Math.min(h - 1, (ty + sy) | 0) * w + Math.min(w - 1, tx | 0)] === WATER || terrain[Math.min(h - 1, ty | 0) * w + Math.min(w - 1, (tx + sx) | 0)] === WATER;
      if (coast) {
        d[o] = COAST[0];
        d[o + 1] = COAST[1];
        d[o + 2] = COAST[2];
        continue;
      }
      // Desiertos en la franja subtropical (como en la partida)
      const lat = data.latOf ? Math.abs(data.latOf(ty)) : -1;
      const dry = lat >= 0 ? smooth(10, 17, lat) * (1 - smooth(31, 38, lat)) * 0.9 : 0;
      flatColor(e, dry, hash2(px, py, 17), 0.5);
      d[o] = clamp(cr, 0, 255);
      d[o + 1] = clamp(cg, 0, 255);
      d[o + 2] = clamp(cb, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}
