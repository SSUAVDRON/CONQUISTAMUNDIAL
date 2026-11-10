// Minimapa: todo el mapa en pequeño (relieve y territorios), con el recuadro
// de lo que ves y tu nación marcada. Un clic (o arrastrar) lleva la cámara
// a ese punto, sin tener que alejarse para ver cómo va la partida.

export class Minimap {
  /**
   * @param canvas lienzo del minimapa
   * @param onJump (wx, wy) → centra la cámara en esas coordenadas del mapa
   */
  constructor(canvas, onJump) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onJump = onJump;
    this.game = null;
    this.renderer = null;
    this.camera = null;
    this.maxW = 220;
    this.maxH = 170;
    this._lastTerritory = 0;
    let dragging = false;
    // `first`: el primer toque vuela hasta allí; al arrastrar, la vista sigue al dedo
    const jump = (e, first = false) => {
      if (!this.game) return;
      const r = canvas.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      this.onJump(fx * this.game.map.width, fy * this.game.map.height, first);
    };
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      jump(e, true);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) jump(e);
    });
    const stop = () => {
      dragging = false;
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  /** Tamaño máximo en píxeles CSS (más pequeño en el móvil). */
  setMaxSize(w, h) {
    this.maxW = w;
    this.maxH = h;
    if (this.game) this._layout();
  }

  setGame(game, renderer, camera) {
    this.game = game;
    this.renderer = renderer;
    this.camera = camera;
    this._layout();
  }

  _layout() {
    const map = this.game.map;
    const s = Math.min(this.maxW / map.width, this.maxH / map.height);
    this.w = Math.max(40, Math.round(map.width * s));
    this.h = Math.max(30, Math.round(map.height * s));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.pw = Math.round(this.w * dpr);
    this.ph = Math.round(this.h * dpr);
    this.canvas.width = this.pw;
    this.canvas.height = this.ph;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    // Relieve: el mapa base del juego reducido una sola vez
    this.base = document.createElement('canvas');
    this.base.width = this.pw;
    this.base.height = this.ph;
    const b = this.base.getContext('2d');
    b.imageSmoothingEnabled = true;
    b.imageSmoothingQuality = 'high';
    const src = this.renderer.baseCanvas;
    b.drawImage(src, 0, 0, src.width, src.height, 0, 0, this.pw, this.ph);
    // Territorios: una muestra por píxel del minimapa (rápido aunque el mapa sea enorme)
    this.terr = document.createElement('canvas');
    this.terr.width = this.pw;
    this.terr.height = this.ph;
    this.terrImg = this.terr.getContext('2d').createImageData(this.pw, this.ph);
    this._lastTerritory = 0;
  }

  _paintTerritory() {
    const g = this.game;
    const map = g.map;
    const owner = g.owner;
    const data = this.terrImg.data;
    const W = this.pw;
    const H = this.ph;
    const sx = map.width / W;
    const sy = map.height / H;
    const human = g.human ? g.human.id : -1;
    const cols = (this._cols ??= []);
    cols.length = 0;
    for (let y = 0; y < H; y++) {
      const row = Math.min(map.height - 1, Math.floor((y + 0.5) * sy)) * map.width;
      for (let x = 0; x < W; x++) {
        const o = owner[row + Math.min(map.width - 1, Math.floor((x + 0.5) * sx))];
        const i = (y * W + x) * 4;
        if (!o) {
          data[i + 3] = 0;
          continue;
        }
        let c = cols[o];
        if (!c) {
          const p = g.players[o];
          c = cols[o] = p ? p.color : [128, 128, 128];
        }
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
        // Tu territorio, opaco; el resto, algo transparente (se ve el relieve)
        data[i + 3] = o === human ? 255 : 175;
      }
    }
    this.terr.getContext('2d').putImageData(this.terrImg, 0, 0);
  }

  /** Cada fotograma: territorios cada 0,4 s; recuadro de la cámara y tu marca, siempre. */
  draw(now) {
    if (!this.game || !this.base) return;
    if (now - this._lastTerritory > 400) {
      this._lastTerritory = now;
      this._paintTerritory();
    }
    const { ctx, pw, ph, dpr } = this;
    const map = this.game.map;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.drawImage(this.terr, 0, 0);
    const k = pw / map.width;
    // Tu nación: un círculo que late donde está su nombre
    const h = this.game.human;
    const L = h && this.renderer.labelById.get(h.id);
    if (L && h.alive) {
      const r = (4 + Math.sin(now / 300) * 1.5) * dpr;
      ctx.beginPath();
      ctx.arc(L.x * k, L.y * k, r, 0, Math.PI * 2);
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    // Lo que ves ahora mismo
    const c = this.camera;
    const x = c.x * k;
    const y = c.y * k;
    const w = (c.viewW / c.zoom) * k;
    const hh = (c.viewH / c.zoom) * k;
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = 'rgba(255, 220, 120, 0.95)';
    ctx.strokeRect(Math.max(0, x), Math.max(0, y), Math.min(pw, x + w) - Math.max(0, x), Math.min(ph, y + hh) - Math.max(0, y));
  }
}
