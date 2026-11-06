// Montículo mínimo con claves numéricas y valores enteros (índices de casilla).
// Se usa como frente de cada ataque: sale primero la casilla con menor prioridad.

export class MinHeap {
  constructor(capacity = 64) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.size = 0;
  }

  push(key, val) {
    if (this.size === this.keys.length) this._grow();
    const keys = this.keys;
    const vals = this.vals;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** Valor con la menor clave, sin sacarlo (el montículo no puede estar vacío). */
  peek() {
    return this.vals[0];
  }

  pop() {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n];
      const val = vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }

  clear() {
    this.size = 0;
  }

  _grow() {
    const cap = this.keys.length * 2;
    const keys = new Float64Array(cap);
    const vals = new Int32Array(cap);
    keys.set(this.keys);
    vals.set(this.vals);
    this.keys = keys;
    this.vals = vals;
  }
}
