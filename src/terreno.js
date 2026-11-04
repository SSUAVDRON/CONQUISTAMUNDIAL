// Terreno del mapa, pintado una sola vez al empezar la partida:
// - el mar a 1 píxel por casilla (se dibuja suavizado): turquesa en la orilla
//   y cada vez más profundo mar adentro;
// - la tierra en colores planos de mapa (2D) según su tipo y su clima:
//   praderas, selva, sabana, desiertos, tundra, mesetas y montañas gris claro
//   con cumbres nevadas, en zonas planas con bordes tramados y playa;
// - una textura que se repite para las olas, que el renderizador mueve en
//   cada frame.
// Todo esto es solo visual: no afecta a la simulación.
import { RES, TERRAIN } from './config.js';
import { hash2, valueNoise } from './noise.js';

const { WATER, PLAINS, HIGHLAND } = TERRAIN;

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
  // Paleta plana (r, g, b): un color por zona, como un mapa dibujado. Las
  // zonas no se funden en degradados: el paso de una a otra se hace con un
  // tramado de píxeles (cada casilla elige una u otra según un umbral con azar).
  const C = {
    selva: [96, 138, 82],
    pradera: [118, 150, 92],
    estepa: [148, 158, 108],
    sabana: [172, 166, 112],
    desierto: [206, 190, 142],
    tundra: [164, 170, 150],
    meseta: [166, 160, 118],
    mesetaSeca: [190, 174, 130],
    mesetaFria: [168, 168, 154],
    montaña: [184, 178, 168],
    cumbre: [236, 238, 240],
  };
  const R = new Float32Array(size);
  const G = new Float32Array(size);
  const B = new Float32Array(size);
  for (let y = 0; y < H; y++) {
    const lat = latOf ? Math.abs(latOf[y]) : -1;
    // Lo que depende solo de la fila (latitud)
    const sub = lat >= 0 ? smooth(10, 17, lat) * (1 - smooth(31, 38, lat)) : 0; // franja de desiertos
    const rowCold = lat >= 0 ? smooth(52, 68, lat) : 0;
    const tropical = lat >= 0 ? 1 - smooth(8, 16, lat) : 0;
    const tropic = lat >= 0 ? 1 - smooth(30, 45, lat) : 0.5;
    const snowLine = 0.7 + tropic * 0.2 - rowCold * 0.35;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = terrain[i];
      if (t === WATER) continue;
      const moist = valueNoise(x, y, 30 * RES, seed);
      // Aridez (0 húmedo, 1 desierto) y frío (0 templado, 1 helado)
      const dry = lat >= 0 ? clamp(sub * (1.25 - moist * 0.9), 0, 1) : smooth(0.32, 0.18, moist);
      // Umbral con un ruido suave más un pelín de azar por casilla: bordes de
      // zona ondulados y apenas tramados, nunca degradados ni moteados
      const j = (valueNoise(x, y, 3 * RES, seed + 5) - 0.5) * 0.16 + (hash2(x, y, seed + 6) - 0.5) * 0.025;
      let c;
      if (t === PLAINS) {
        if (rowCold + j > 0.55) c = C.tundra;
        else if (rowCold + j > 0.3) c = C.estepa;
        else if (dry + j > 0.62) c = C.desierto;
        else if (dry + j > 0.38) c = C.sabana;
        else if (tropical + j > 0.5) c = C.selva;
        else c = C.pradera;
      } else if (t === HIGHLAND) {
        if (rowCold + j > 0.5) c = C.mesetaFria;
        else if (dry + j > 0.5) c = C.mesetaSeca;
        else c = C.meseta;
      } else {
        // Montaña: gris claro, con nieve en las cumbres altas (más abajo en el norte)
        c = shade[i] / 255 + j > snowLine ? C.cumbre : C.montaña;
      }
      // Grano de píxel muy leve: el mapa sigue siendo plano
      const px = (hash2(x, y, seed + 17) - 0.5) * 4;
      R[i] = c[0] + px;
      G[i] = c[1] + px;
      B[i] = c[2] + px;
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
        const k = smooth(0.46, 0.12, d) * 0.5;
        r += (204 - r) * k;
        g += (194 - g) * k;
        b += (158 - b) * k;
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
      // Variación muy suave y un grano de píxel apenas visible
      const n = (valueNoise(x, y, 18 * RES, seed + 7) - 0.5) * 5 * k2 + (hash2(x, y, seed + 29) - 0.5) * 3;
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
