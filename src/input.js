// Ratón, táctil y teclado. Arrastrar = mover el mapa; rueda/pellizco = zoom;
// clic sin arrastrar = acción sobre la casilla.

const DRAG_THRESHOLD = 6;

export class Input {
  constructor(canvas, camera, handlers) {
    this.canvas = canvas;
    this.camera = camera;
    this.h = handlers;
    this.pointers = new Map();
    this.dragging = false;
    this.pinchDist = 0;
    this.keys = new Set();

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._up(e, true));
    canvas.addEventListener('pointerleave', () => this.h.onHover?.(-1, -1));
    canvas.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _down(e) {
    const [x, y] = this._pos(e);
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x, y, sx: x, sy: y, button: e.button });
    if (this.pointers.size === 1) this.dragging = false;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.dragging = true; // un pellizco nunca es un clic
    }
  }

  _move(e) {
    const [x, y] = this._pos(e);
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) {
      this.h.onHover?.(x, y);
      return;
    }
    if (this.pointers.size === 1) {
      if (!this.dragging && Math.hypot(x - ptr.sx, y - ptr.sy) > DRAG_THRESHOLD) this.dragging = true;
      if (this.dragging) this.camera.pan(x - ptr.x, y - ptr.y);
      ptr.x = x;
      ptr.y = y;
      if (e.pointerType === 'mouse') this.h.onHover?.(x, y);
    } else if (this.pointers.size === 2) {
      ptr.x = x;
      ptr.y = y;
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) this.camera.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / this.pinchDist);
      this.pinchDist = dist;
    }
  }

  _up(e, cancelled = false) {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    this.pointers.delete(e.pointerId);
    if (!cancelled && !this.dragging && this.pointers.size === 0) {
      if (ptr.button === 0) this.h.onClick?.(ptr.x, ptr.y);
      else if (ptr.button === 2) this.h.onRightClick?.(ptr.x, ptr.y);
    }
    if (this.pointers.size === 0) this.dragging = false;
  }

  _wheel(e) {
    e.preventDefault();
    const [x, y] = this._pos(e);
    if (e.shiftKey) {
      this.h.onRatioStep?.(e.deltaY > 0 ? -0.05 : 0.05);
      return;
    }
    this.camera.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
  }

  _key(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (!down) return;
    if (/^Digit[0-9]$/.test(e.code)) {
      const d = Number(e.code.slice(5));
      this.h.onRatio?.(d === 0 ? 1 : d / 10);
    } else if (e.code === 'Space') {
      e.preventDefault();
      this.h.onTogglePause?.();
    } else if (e.code === 'KeyC') {
      this.h.onCenter?.();
    } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
      this.camera.zoomAt(this.camera.viewW / 2, this.camera.viewH / 2, 1.25);
    } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
      this.camera.zoomAt(this.camera.viewW / 2, this.camera.viewH / 2, 0.8);
    }
  }

  /** Desplazamiento continuo con WASD / flechas; se llama cada frame. */
  update(dt) {
    const speed = 0.8 * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx += speed;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx -= speed;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dy += speed;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dy -= speed;
    if (dx || dy) this.camera.pan(dx, dy);
  }
}
