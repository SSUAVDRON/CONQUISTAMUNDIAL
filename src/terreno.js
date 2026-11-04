// Terreno del mapa, pintado una sola vez al empezar la partida:
// - el mar a 1 píxel por casilla (se dibuja suavizado): turquesa en la orilla
//   y cada vez más profundo mar adentro;
// - la tierra en colores planos de mapa (2D) según su tipo y su clima:
//   praderas, bosques, desiertos, tundra, mesetas y montañas nevadas, con playa;
// - texturas que se repiten para las olas y las sombras de las nubes, que el
//   renderizador mueve en cada frame.
// Todo esto es solo visual: no afecta a la simulación.
import { RES, TERRAIN } from './config.js';

const { WATER, PLAINS, HIGHLAND, MOUNTAIN } = TERRAIN;

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

/** Generador pseudoaleatorio pequeño (solo para texturas). */
function rand32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash2 = (x, y, s) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Ruido de valor suave (no periódico) con celdas de `cell` casillas. */
function valueNoise(x, y, cell, seed) {
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
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
  const { width: W, height: H, size, terrain, shade } = map;
  const S = terrainScale(map);
  const seed = (W * 73856093) ^ (H * 19349663);

  // ---- Color plano (2D) de cada casilla de tierra según su tipo y su clima.
  // Sin relieve iluminado ni grano: colores de mapa, con transiciones suaves
  // entre climas. En los mapas reales el clima sale de la latitud (desiertos
  // subtropicales, selva ecuatorial, tundra y nieve en el norte).
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
  // Paleta (r, g, b) de cada clima
  const C = {
    selva: [62, 122, 58],
    pradera: [111, 160, 78],
    seca: [150, 166, 92],
    bosque: [76, 128, 64],
    sabana: [170, 168, 98],
    desierto: [214, 194, 138],
    estepa: [140, 160, 104],
    tundra: [178, 186, 162],
    nieve: [230, 236, 240],
    meseta: [176, 156, 108],
    mesetaSeca: [198, 168, 116],
    mesetaFria: [168, 164, 148],
    roca: [140, 127, 115],
    rocaOscura: [104, 94, 86],
  };
  const R = new Float32Array(size);
  const G = new Float32Array(size);
  const B = new Float32Array(size);
  // Sin crear arreglos por casilla (son millones): mezcla sobre r, g, b
  let r = 0;
  let g = 0;
  let b = 0;
  const set = (c) => {
    r = c[0];
    g = c[1];
    b = c[2];
  };
  const mix = (c, k) => {
    if (k <= 0) return;
    r += (c[0] - r) * k;
    g += (c[1] - g) * k;
    b += (c[2] - b) * k;
  };
  for (let y = 0; y < H; y++) {
    const lat = latOf ? Math.abs(latOf[y]) : -1;
    // Lo que depende solo de la fila (latitud)
    const sub = lat >= 0 ? smooth(10, 17, lat) * (1 - smooth(31, 38, lat)) : 0; // franja de desiertos
    const rowCold = lat >= 0 ? smooth(52, 68, lat) : 0;
    const tropical = lat >= 0 ? 1 - smooth(8, 16, lat) : 0;
    const tropic = lat >= 0 ? 1 - smooth(30, 45, lat) : 0.5;
    const steppe = smooth(0, 0.5, rowCold) * (1 - smooth(0.5, 1, rowCold));
    const tundra = smooth(0.45, 0.85, rowCold);
    const polar = smooth(0.9, 1, rowCold);
    const snowA = 0.66 + tropic * 0.22 - rowCold * 0.35;
    const snowB = 0.8 + tropic * 0.18 - rowCold * 0.35;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = terrain[i];
      if (t === WATER) continue;
      const moist = valueNoise(x, y, 30 * RES, seed);
      // Aridez (0 húmedo, 1 desierto) y frío (0 templado, 1 helado)
      const dry = lat >= 0 ? clamp(sub * (1.25 - moist * 0.9), 0, 1) : smooth(0.32, 0.18, moist);
      if (t === PLAINS) {
        set(C.pradera);
        mix(C.seca, smooth(0.35, 0.75, moist) * 0.6);
        mix(C.selva, tropical * 0.85);
        const fk = (1 - dry) * (1 - rowCold) * 0.85;
        if (fk > 0.01) mix(C.bosque, smooth(0.6, 0.7, valueNoise(x, y, 9 * RES, seed + 11)) * fk);
        mix(dry > 0.55 ? C.desierto : C.sabana, smooth(0.25, 0.75, dry));
        mix(C.estepa, steppe);
        mix(C.tundra, tundra);
        mix(C.nieve, polar * smooth(0.3, 0.6, moist));
      } else if (t === HIGHLAND) {
        set(C.meseta);
        mix(C.mesetaSeca, dry);
        mix(C.mesetaFria, rowCold);
      } else {
        // Montaña: roca con nieve solo en las cumbres altas (más abajo en el norte)
        const sh = shade[i] / 255;
        set(C.roca);
        mix(C.rocaOscura, smooth(0.2, 0.6, sh) * 0.5);
        mix(C.nieve, smooth(snowA, snowB, sh));
      }
      // Contorno suave entre tipos de terreno: más «mapa dibujado»
      if (t !== PLAINS) {
        const l = x > 0 ? terrain[i - 1] : t;
        const rr = x < W - 1 ? terrain[i + 1] : t;
        const u = y > 0 ? terrain[i - W] : t;
        const dd = y < H - 1 ? terrain[i + W] : t;
        if ((l !== WATER && l !== t) || (rr !== WATER && rr !== t) || (u !== WATER && u !== t) || (dd !== WATER && dd !== t)) {
          const k = t === MOUNTAIN ? 0.82 : 0.92;
          r *= k;
          g *= k;
          b *= k;
        }
      }
      R[i] = r;
      G[i] = g;
      B[i] = b;
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
        // Playa (o acantilado en la montaña) junto al agua
        const d = edgeDist(m, fx, fy);
        if (terrain[i] === MOUNTAIN) {
          const k = smooth(0.4, 0.05, d) * 0.45;
          r += (70 - r) * k;
          g += (66 - g) * k;
          b += (64 - b) * k;
        } else {
          const k = smooth(0.46, 0.12, d) * 0.85;
          r += (220 - r) * k;
          g += (202 - g) * k;
          b += (150 - b) * k;
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
      const d = terrain[i] === WATER ? dist[i] / RES : 0;
      // Mar oscuro y casi uniforme: la orilla apenas un poco más clara que el fondo
      const k1 = smooth(0.5, 4, d);
      const k2 = smooth(3, 26, d);
      let r = 26 + (19 - 26) * k1;
      let g = 64 + (50 - 64) * k1;
      let b = 102 + (90 - 102) * k1;
      r += (12 - r) * k2;
      g += (34 - g) * k2;
      b += (70 - b) * k2;
      const n = (valueNoise(x, y, 18 * RES, seed + 7) - 0.5) * 7 * k2;
      wd[o] = clamp(r + n * 0.5, 0, 255);
      wd[o + 1] = clamp(g + n * 0.8, 0, 255);
      wd[o + 2] = clamp(b + n, 0, 255);
      wd[o + 3] = 255;
    }
  }
  wctx.putImageData(wimg, 0, 0);
  return { water, land, scale: S };
}

/** Textura de olas (se repite): crestas cortas y claras. */
export function makeWaveTexture(size = 256) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rnd = rand32(4242);
  ctx.lineCap = 'round';
  for (let k = 0; k < 150; k++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 6 + rnd() * 14;
    const a = 0.07 + rnd() * 0.16;
    ctx.strokeStyle = `rgba(220, 240, 255, ${a})`;
    ctx.lineWidth = 1 + rnd() * 1.2;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.moveTo(x + ox - len / 2, y + oy);
        ctx.quadraticCurveTo(x + ox, y + oy - len * 0.22, x + ox + len / 2, y + oy);
        ctx.stroke();
      }
    }
  }
  return c;
}

/** Textura de sombras de nubes (se repite): ruido de valor periódico. */
export function makeCloudTexture(size = 256) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rnd = rand32(777);
  const octaves = [
    [4, 0.55],
    [8, 0.27],
    [16, 0.13],
    [32, 0.05],
  ];
  const grids = octaves.map(([p]) => {
    const g = new Float32Array(p * p);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return g;
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      octaves.forEach(([p, amp], k) => {
        const g = grids[k];
        const fx = (x / size) * p;
        const fy = (y / size) * p;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const at = (xx, yy) => g[(yy % p) * p + (xx % p)];
        const a = at(x0, y0);
        const b = at(x0 + 1, y0);
        const cc = at(x0, y0 + 1);
        const dd = at(x0 + 1, y0 + 1);
        v += (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + dd) * sx * sy) * amp;
      });
      const o = (y * size + x) * 4;
      d[o] = 8;
      d[o + 1] = 14;
      d[o + 2] = 24;
      d[o + 3] = Math.round(smooth(0.5, 0.78, v) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
