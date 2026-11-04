// Terreno del mapa, pintado una sola vez al empezar la partida:
// - el mar a 1 píxel por casilla (se dibuja suavizado): turquesa en la orilla
//   y cada vez más profundo mar adentro;
// - la tierra a varios píxeles por casilla, con relieve iluminado desde el
//   noroeste, bosques, nieve en las cumbres, playas y espuma en la orilla;
// - texturas que se repiten para las olas y las sombras de las nubes, que el
//   renderizador mueve en cada frame.
// Todo esto es solo visual: no afecta a la simulación.
import { TERRAIN } from './config.js';

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

/** Desenfoque de caja 3×3 en el sitio. */
function blur(a, w, h) {
  const tmp = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += a[yy * w + xx];
          n++;
        }
      }
      tmp[y * w + x] = s / n;
    }
  }
  a.set(tmp);
}

/** Píxeles de terreno por casilla: más en mapas pequeños, sin pasarse de memoria. */
export function terrainScale(map) {
  return clamp(Math.floor(Math.sqrt(3.2e6 / map.size)), 1, 4);
}

/**
 * Devuelve { water, land, scale }: `water` mide lo mismo que el mapa y `land`
 * es `scale` veces mayor (transparente sobre el agua salvo la espuma).
 */
export function paintTerrain(map) {
  const { width: W, height: H, size, terrain, shade } = map;
  const S = terrainScale(map);
  const seed = (W * 73856093) ^ (H * 19349663);

  // ---- Altura suavizada e iluminación por casilla
  const h = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const t = terrain[i];
    const s = shade[i] / 255;
    h[i] = t === WATER ? -0.05 : t === PLAINS ? 0.03 + 0.14 * s : t === HIGHLAND ? 0.24 + 0.22 * s : 0.52 + 0.48 * s;
  }
  blur(h, W, H);
  blur(h, W, H);
  const L = [-0.58, -0.66, 0.48];
  const ll = Math.hypot(L[0], L[1], L[2]);
  const Lx = L[0] / ll;
  const Ly = L[1] / ll;
  const Lz = L[2] / ll;
  const E = 9; // exageración del relieve

  // ---- Color iluminado de cada casilla de tierra
  const R = new Float32Array(size);
  const G = new Float32Array(size);
  const B = new Float32Array(size);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = terrain[i];
      if (t === WATER) continue;
      const s = shade[i] / 255;
      const hl = h[x > 0 ? i - 1 : i];
      const hr = h[x < W - 1 ? i + 1 : i];
      const hu = h[y > 0 ? i - W : i];
      const hd = h[y < H - 1 ? i + W : i];
      const dx = (hr - hl) * 0.5 * E;
      const dy = (hd - hu) * 0.5 * E;
      const nl = Math.hypot(dx, dy, 1);
      const lam = (-dx * Lx - dy * Ly + Lz) / nl;
      const light = clamp(1 + (lam - Lz) * 1.7, 0.5, 1.45);
      const moist = valueNoise(x, y, 26, seed);
      const forest = valueNoise(x, y, 7, seed + 11) * 0.65 + valueNoise(x, y, 3, seed + 23) * 0.35;
      const tex = (hash2(x, y, seed + 5) - 0.5) * 0.06;
      let r;
      let g;
      let b;
      if (t === PLAINS) {
        const k = clamp(moist * 1.1 - 0.05, 0, 1);
        r = 84 + (166 - 84) * k;
        g = 142 + (164 - 142) * k;
        b = 64 + (96 - 64) * k;
        const f = smooth(0.56, 0.72, forest) * (1 - k * 0.6) * 0.8;
        r += (52 - r) * f;
        g += (100 - g) * f;
        b += (50 - b) * f;
      } else if (t === HIGHLAND) {
        const k = clamp(s * 0.8 + moist * 0.3, 0, 1);
        r = 154 + (118 - 154) * k;
        g = 146 + (104 - 146) * k;
        b = 96 + (76 - 96) * k;
      } else {
        r = 112 + 34 * s;
        g = 104 + 34 * s;
        b = 100 + 34 * s;
        const snow = smooth(0.5, 0.78, s);
        r += (238 - r) * snow;
        g += (242 - g) * snow;
        b += (248 - b) * snow;
      }
      const m = light * (1 + tex);
      R[i] = r * m;
      G[i] = g * m;
      B[i] = b * m;
    }
  }

  // ---- Qué vecinos son de otro tipo (agua/tierra), para playas y espuma
  //  bits: 1 O, 2 E, 4 N, 8 S, 16 NO, 32 NE, 64 SO, 128 SE
  const edge = new Uint8Array(size);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const water = terrain[i] === WATER;
      const other = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H && (terrain[yy * W + xx] === WATER) !== water;
      let m = 0;
      if (other(x - 1, y)) m |= 1;
      if (other(x + 1, y)) m |= 2;
      if (other(x, y - 1)) m |= 4;
      if (other(x, y + 1)) m |= 8;
      if (other(x - 1, y - 1)) m |= 16;
      if (other(x + 1, y - 1)) m |= 32;
      if (other(x - 1, y + 1)) m |= 64;
      if (other(x + 1, y + 1)) m |= 128;
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
    const vy = ty - 0.5;
    const y0 = clamp(Math.floor(vy), 0, H - 1);
    const y1 = clamp(y0 + 1, 0, H - 1);
    const wy = clamp(vy - y0, 0, 1);
    for (let pxl = 0; pxl < LW; pxl++) {
      const tx = (pxl + 0.5) / S;
      const cx = Math.floor(tx);
      const fx = tx - cx;
      const i = cy * W + cx;
      const o = py * LW + pxl;
      const m = edge[i];
      if (terrain[i] === WATER) {
        if (!m) continue;
        // Espuma pegada a la orilla y un velo turquesa algo más lejos
        const d = edgeDist(m, fx, fy);
        const wob = (hash2(pxl, py, seed + 3) - 0.5) * 0.08;
        const foam = smooth(0.3, 0.04, d + wob);
        const veil = smooth(0.75, 0.25, d) * 0.22;
        const a = Math.max(foam * 0.75, veil);
        if (a <= 0.01) continue;
        const k = foam * 0.75 >= veil ? 1 : 0;
        const r = k ? 236 : 120;
        const g = k ? 246 : 214;
        const b = k ? 250 : 222;
        px[o] = ((Math.round(a * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;
        continue;
      }
      // Interpolación bilineal del color entre centros de casilla (sin coger agua)
      const vx = tx - 0.5;
      const x0 = clamp(Math.floor(vx), 0, W - 1);
      const x1 = clamp(x0 + 1, 0, W - 1);
      const wx = clamp(vx - x0, 0, 1);
      const a00 = y0 * W + x0;
      const a10 = y0 * W + x1;
      const a01 = y1 * W + x0;
      const a11 = y1 * W + x1;
      const q00 = terrain[a00] === WATER ? i : a00;
      const q10 = terrain[a10] === WATER ? i : a10;
      const q01 = terrain[a01] === WATER ? i : a01;
      const q11 = terrain[a11] === WATER ? i : a11;
      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;
      let r = R[q00] * w00 + R[q10] * w10 + R[q01] * w01 + R[q11] * w11;
      let g = G[q00] * w00 + G[q10] * w10 + G[q01] * w01 + G[q11] * w11;
      let b = B[q00] * w00 + B[q10] * w10 + B[q01] * w01 + B[q11] * w11;
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
      const grain = (hash2(pxl, py, seed) - 0.5) * 10;
      r = clamp(r + grain, 0, 255) | 0;
      g = clamp(g + grain, 0, 255) | 0;
      b = clamp(b + grain * 0.8, 0, 255) | 0;
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
    if (dist[t] >= 60) continue;
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
      const d = terrain[i] === WATER ? dist[i] : 0;
      // turquesa → azul medio → azul profundo
      const k1 = smooth(0.5, 4, d);
      const k2 = smooth(3, 26, d);
      let r = 74 + (40 - 74) * k1;
      let g = 168 + (104 - 168) * k1;
      let b = 184 + (160 - 184) * k1;
      r += (12 - r) * k2;
      g += (32 - g) * k2;
      b += (72 - b) * k2;
      const n = (valueNoise(x, y, 18, seed + 7) - 0.5) * 18 * k2;
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
