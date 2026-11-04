// Terreno del mapa, pintado una sola vez al empezar la partida:
// - el mar a 1 píxel por casilla (se dibuja suavizado): turquesa en la orilla
//   y cada vez más profundo mar adentro;
// - la tierra en colores planos de mapa (2D) según su tipo y su clima:
//   praderas, selva, sabana, desiertos, tundra, mesetas y montañas gris claro
//   con cumbres nevadas, en zonas planas con bordes tramados y playa;
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

// Paleta del mapa físico por altura (m): verde → arena → pardo → gris → nieve
const HYPSO = [
  [0, 98, 138, 64],
  [120, 112, 147, 70],
  [260, 146, 153, 86],
  [430, 176, 160, 104],
  [800, 188, 165, 115],
  [1300, 194, 171, 127],
  [1900, 186, 174, 154],
  [2600, 206, 204, 198],
  [3400, 232, 232, 232],
  [4600, 247, 247, 247],
];
let cr = 0;
let cg = 0;
let cb = 0;
/** Color de la altura `e` en (cr, cg, cb), sin crear arreglos (son millones de casillas). */
function hypso(e) {
  let k = 1;
  while (k < HYPSO.length - 1 && HYPSO[k][0] < e) k++;
  const a = HYPSO[k - 1];
  const b = HYPSO[k];
  const t = clamp((e - a[0]) / (b[0] - a[0]), 0, 1);
  cr = a[1] + (b[1] - a[1]) * t;
  cg = a[2] + (b[2] - a[2]) * t;
  cb = a[3] + (b[3] - a[3]) * t;
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
      hypso(e + dry * 320 + ridge * 120);
      const px = (hash2(x, y, seed + 17) - 0.5) * 4;
      R[i] = cr + px;
      G[i] = cg + px;
      B[i] = cb + px;
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
      const m = clamp(1 + (lit - 1) * 0.55, 0.62, 1.2);
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
      if (terrain[i] === WATER) {
        if (!m) continue;
        // Una línea de espuma tenue pegada a la orilla (el mar es casi uniforme)
        const d = edgeDist(m, fx, fy);
        const wob = (hash2(pxl, py, seed + 3) - 0.5) * 0.08;
        const foam = smooth(0.24, 0.03, d + wob);
        const veil = smooth(0.6, 0.2, d) * 0.05;
        const a = Math.max(foam * 0.3, veil);
        if (a <= 0.01) continue;
        const k = foam * 0.3 >= veil ? 1 : 0;
        const r = k ? 170 : 60;
        const g = k ? 196 : 100;
        const b = k ? 214 : 140;
        px[o] = ((Math.round(a * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;
        continue;
      }
      // Color plano de la casilla
      let r = R[i];
      let g = G[i];
      let b = B[i];
      if (m) {
        // Orilla: un filo fino más claro junto al agua
        const d = edgeDist(m, fx, fy);
        const k = smooth(0.5, 0.1, d) * 0.45;
        r += (190 - r) * k;
        g += (188 - g) * k;
        b += (124 - b) * k;
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
      const d = terrain[i] === WATER ? dist[i] / RES : 0;
      // Mar liso azul marino; solo pegado a la costa, un pelín más claro
      const k1 = smooth(0.4, 2.5, d);
      const r = 26 + (18 - 26) * k1;
      const g = 56 + (45 - 56) * k1;
      const b = 102 + (92 - 102) * k1;
      // Grano de píxel apenas visible
      const n = (hash2(x, y, seed + 29) - 0.5) * 2.5;
      wd[o] = clamp(r + n * 0.5, 0, 255);
      wd[o + 1] = clamp(g + n * 0.8, 0, 255);
      wd[o + 2] = clamp(b + n, 0, 255);
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
  // Pendiente exagerada según los km que abarca cada píxel de la vista previa
  const kz = 22 / (Math.max(sx, sy) * Math.max(0.5, data.tileKm || 5) * 1000);
  for (let py = 0; py < H; py++) {
    const ty = y0 + (py + 0.5) * sy;
    for (let px = 0; px < W; px++) {
      const tx = x0 + (px + 0.5) * sx;
      const i = Math.min(h - 1, ty | 0) * w + Math.min(w - 1, tx | 0);
      const o = (py * W + px) * 4;
      d[o + 3] = 255;
      if (terrain[i] === WATER) {
        d[o] = 18;
        d[o + 1] = 45;
        d[o + 2] = 90;
        continue;
      }
      const e = elev(tx, ty);
      hypso(e);
      const dx = (elev(tx + sx, ty) - elev(tx - sx, ty)) * 0.5 * kz;
      const dy = (elev(tx, ty + sy) - elev(tx, ty - sy)) * 0.5 * kz;
      const lit = (dx + dy + 1) / Math.sqrt(1 + dx * dx + dy * dy);
      let m = clamp(1 + (lit - 1) * 0.55, 0.62, 1.2);
      // Filo claro junto al agua
      const coast = terrain[Math.min(h - 1, (ty + sy) | 0) * w + Math.min(w - 1, tx | 0)] === WATER || terrain[Math.min(h - 1, ty | 0) * w + Math.min(w - 1, (tx + sx) | 0)] === WATER;
      if (coast) m = Math.max(m, 1.12);
      d[o] = clamp(cr * m, 0, 255);
      d[o + 1] = clamp(cg * m, 0, 255);
      d[o + 2] = clamp(cb * m, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}
