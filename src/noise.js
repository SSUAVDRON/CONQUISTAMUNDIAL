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
