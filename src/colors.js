// Utilidades de color para los jugadores.

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Colores bien repartidos en el círculo cromático (ángulo áureo), en tonos
 * pálidos de mapa: pizarra, salvia, malva, rosa viejo… (Dos tiradas de `rng`,
 * siempre: el resto de la partida depende de esa secuencia.)
 */
export function botColor(index, rng) {
  const hue = (index * 137.508 + 20) % 360;
  const sat = 0.18 + rng.float() * 0.16;
  const light = 0.58 + rng.float() * 0.12;
  return hslToRgb(hue, sat, light);
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [47, 125, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToCss([r, g, b], a = 1) {
  return a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

/** [h (grados), s, l] de un color [r, g, b]. */
export function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/**
 * El mismo tono, más vivo: la saturación sube `ds` y la luz se multiplica por
 * `fl` (acotada a [lo, hi]). Para fronteras con color, no grises.
 */
export function vividRgb(rgb, ds, fl, lo = 0.12, hi = 0.8) {
  const [h, s, l] = rgbToHsl(rgb);
  return hslToRgb(h, Math.min(1, s + ds), Math.max(lo, Math.min(hi, l * fl)));
}

/**
 * El mismo tono, apagado: saturación como mucho `maxS` y luz entre `lo` y
 * `hi`. Para el relleno de los territorios (también el de un color vivo
 * elegido por el jugador).
 */
export function mutedRgb(rgb, maxS = 0.42, lo = 0.5, hi = 0.62) {
  const [h, s, l] = rgbToHsl(rgb);
  return hslToRgb(h, Math.min(s, maxS), Math.max(lo, Math.min(hi, l)));
}

export function shadeRgb([r, g, b], f) {
  if (f < 1) return [Math.round(r * f), Math.round(g * f), Math.round(b * f)];
  const t = f - 1;
  return [Math.round(r + (255 - r) * t), Math.round(g + (255 - g) * t), Math.round(b + (255 - b) * t)];
}

// ---------------------------------------------------------------- naciones

/** [L, a, b] (CIELAB, D65) de un color [r, g, b]: para medir cuánto se parecen dos colores a la vista. */
export function rgbToLab([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Diferencia de color (ΔE de 1976): por debajo de ~10 cuesta distinguirlos en un mapa. */
export function deltaE(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Relleno con el que se pinta el territorio de una nación (render.js): el
 * mismo tono algo apagado. Aquí para comparar los colores tal como se ven.
 */
export function territoryRgb(rgb) {
  return mutedRgb(rgb, 0.46, 0.5, 0.72);
}

/**
 * Paleta de las naciones: 36 tonos repartidos en el círculo cromático, cada
 * uno con tres luces (oscuro, medio y claro): 108 colores. Con 90 naciones
 * casi no se repite ninguno.
 */
export const NATION_PALETTE = (() => {
  const out = [];
  for (const [s, l, off] of [[0.62, 0.5, 0], [0.55, 0.62, 3.3], [0.5, 0.72, 6.6]]) {
    for (let h = 0; h < 360; h += 10) out.push(hslToRgb(h + off, s, l));
  }
  return out;
})();

/**
 * Colores de las naciones según quién tienen al lado: cada una elige de la
 * paleta el que más se distingue (tal como se pinta) de sus vecinas ya
 * coloreadas, de los jugadores (`fixed`, que no se mueven de su color) y,
 * a igualdad, el menos repetido. Sin azar: el mismo resultado en todos los
 * navegadores de una partida en línea.
 *   nations: [{ id, x, y }] · fixed: [[r, g, b]] · radius: distancia (en
 *   casillas) a la que dos naciones cuentan como vecinas.
 * Devuelve Map id → [r, g, b].
 */
export function assignNationColors(nations, fixed, radius) {
  const labs = NATION_PALETTE.map((c) => rgbToLab(territoryRgb(c)));
  const fixedLabs = fixed.map((c) => rgbToLab(territoryRgb(c)));
  const n = nations.length;
  const r2 = radius * radius;
  const near = nations.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d2 = (nations[i].x - nations[j].x) ** 2 + (nations[i].y - nations[j].y) ** 2;
      if (d2 < r2) {
        const closeness = 1 - Math.sqrt(d2) / radius; // 1 pegadas, 0 en el límite
        near[i].push([j, closeness]);
        near[j].push([i, closeness]);
      }
    }
  }
  // Primero las que más vecinas tienen (las difíciles), luego por id
  const order = nations.map((_, i) => i).sort((a, b) => near[b].length - near[a].length || nations[a].id - nations[b].id);
  const chosen = new Array(n).fill(-1);
  const uses = new Array(NATION_PALETTE.length).fill(0);
  const out = new Map();
  for (const i of order) {
    let best = 0;
    let bestScore = -Infinity;
    for (let c = 0; c < labs.length; c++) {
      // La vecina más parecida manda (las más cercanas pesan más)
      let worst = 999;
      for (const [j, closeness] of near[i]) {
        if (chosen[j] < 0) continue;
        const v = deltaE(labs[c], labs[chosen[j]]) - 18 * closeness;
        if (v < worst) worst = v;
      }
      // Los jugadores: que ninguna nación se confunda con ellos
      for (const fl of fixedLabs) {
        const v = deltaE(labs[c], fl) - 12;
        if (v < worst) worst = v;
      }
      // Pasado un ΔE de 40 ya se distinguen bien: entonces manda no repetir
      // (y, a igualdad, uno que dependa de la nación)
      const score = Math.min(worst, 40) - uses[c] * 12 - ((c * 7 + nations[i].id * 13) % 17) * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    chosen[i] = best;
    uses[best]++;
    out.set(nations[i].id, NATION_PALETTE[best]);
  }
  return out;
}
