// Generador pseudoaleatorio con semilla (mulberry32). Toda la aleatoriedad de la
// simulación pasa por aquí: con la misma semilla y las mismas acciones, la
// partida es idéntica. Eso es lo que permitirá multijugador en "lockstep".

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this._next = mulberry32(seed);
  }

  /** Número en [0, 1). */
  float() {
    return this._next();
  }

  /** Entero en [min, max], ambos incluidos. */
  int(min, max) {
    return min + Math.floor(this._next() * (max - min + 1));
  }

  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }

  chance(p) {
    return this._next() < p;
  }
}

/** Convierte un texto (p. ej. una semilla escrita por el usuario) en uint32. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
