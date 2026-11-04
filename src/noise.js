// Ruido de valor 2D con semilla + fBm (suma de octavas). Suficiente para generar
// continentes, costas irregulares y cordilleras.
import { Rng } from './rng.js';

export function createNoise2D(seed) {
  const rng = new Rng(seed);
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const values = new Float32Array(256);
  for (let i = 0; i < 256; i++) values[i] = rng.float();

  const lattice = (ix, iy) => values[perm[(ix & 255) + perm[iy & 255]]];

  return function noise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const v00 = lattice(x0, y0);
    const v10 = lattice(x0 + 1, y0);
    const v01 = lattice(x0, y0 + 1);
    const v11 = lattice(x0 + 1, y0 + 1);
    const a = v00 + (v10 - v00) * sx;
    const b = v01 + (v11 - v01) * sx;
    return a + (b - a) * sy;
  };
}

/** fBm normalizado a [0, 1]. */
export function fbm(noise, x, y, octaves, lacunarity = 2, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Sin estado (no hace falta crear un generador): lo usan el pintado del
// terreno y la simulación (formas irregulares de expansión). Determinista.

/** Hash entero de (x, y, semilla) → [0, 1). */
export function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ruido de valor suave (no periódico) con celdas de `cell` casillas → [0, 1]. */
export function valueNoise(x, y, cell, seed) {
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
