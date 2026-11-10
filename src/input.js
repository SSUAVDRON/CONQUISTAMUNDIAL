// Ratón, táctil y teclado. Arrastrar = mover el mapa (con inercia al
// soltar); rueda/pellizco = zoom (la rueda, suave); clic sin arrastrar =
// acción sobre la casilla.

const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 500;
const FLING_WINDOW_MS = 90; // la velocidad al soltar se mide con los últimos movimientos
/** Píxeles por unidad de `deltaY` según `deltaMode` (píxeles, líneas, páginas). */
const WHEEL_UNIT = [1, 16, 400];

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
    // La posición del lienzo solo cambia al girar o redimensionar: leerla en
    // cada movimiento del dedo obligaba al navegador a recalcular la página
    window.addEventListener('resize', () => {
      this._rect = null;
    });
  }

  _pos(e) {
    const r = (this._rect ??= this.canvas.getBoundingClientRect());
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _down(e) {
    const [x, y] = this._pos(e);
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x, y, sx: x, sy: y, button: e.button, shift: e.shiftKey });
    if (this.pointers.size === 1) {
      this.dragging = false;
      this.longPressed = false;
      this.trail = [{ t: e.timeStamp, x, y }];
      this.camera.stop(); // tocar el mapa para la inercia o el vuelo en curso
      // Mantener pulsado (táctil) equivale al clic derecho
      clearTimeout(this.longPressTimer);
      if (e.pointerType !== 'mouse') {
        this.longPressTimer = setTimeout(() => {
          if (!this.dragging && this.pointers.size === 1) {
            this.longPressed = true;
            this.h.onRightClick?.(x, y);
          }
        }, LONG_PRESS_MS);
      }
    } else {
      clearTimeout(this.longPressTimer);
    }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchMid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      this.dragging = true; // un pellizco nunca es un clic
      this.trail = null; // tras un pellizco no hay inercia
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
      if (!this.dragging && Math.hypot(x - ptr.sx, y - ptr.sy) > DRAG_THRESHOLD) {
        this.dragging = true;
        clearTimeout(this.longPressTimer);
      }
      if (this.dragging) this.camera.pan(x - ptr.x, y - ptr.y);
      ptr.x = x;
      ptr.y = y;
      if (this.trail) {
        this.trail.push({ t: e.timeStamp, x, y });
        while (this.trail.length > 2 && e.timeStamp - this.trail[0].t > FLING_WINDOW_MS) this.trail.shift();
      }
      if (e.pointerType === 'mouse') this.h.onHover?.(x, y);
    } else if (this.pointers.size === 2) {
      ptr.x = x;
      ptr.y = y;
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      // Con dos dedos también se desplaza el mapa (el punto medio arrastra)
      if (this.pinchMid) this.camera.pan(mid[0] - this.pinchMid[0], mid[1] - this.pinchMid[1]);
      if (this.pinchDist > 0) this.camera.zoomAt(mid[0], mid[1], dist / this.pinchDist);
      this.pinchDist = dist;
      this.pinchMid = mid;
    }
  }

  _up(e, cancelled = false) {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    this.pointers.delete(e.pointerId);
    clearTimeout(this.longPressTimer);
    if (!cancelled && !this.dragging && !this.longPressed && this.pointers.size === 0) {
      if (ptr.button === 0) this.h.onClick?.(ptr.x, ptr.y, ptr.shift);
      else if (ptr.button === 2) this.h.onRightClick?.(ptr.x, ptr.y);
    }
    // Inercia: si se soltó en pleno movimiento, el mapa sigue y frena
    if (!cancelled && this.dragging && this.pointers.size === 0 && this.trail && this.trail.length >= 2) {
      const first = this.trail[0];
      const last = this.trail[this.trail.length - 1];
      const dt = (last.t - first.t) / 1000;
      const idle = e.timeStamp - last.t;
      if (dt > 0.008 && idle < 60) this.camera.fling((last.x - first.x) / dt, (last.y - first.y) / dt);
    }
    if (this.pointers.size < 2) this.pinchMid = null;
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.trail = null;
    }
  }

  _wheel(e) {
    e.preventDefault();
    const [x, y] = this._pos(e);
    if (e.shiftKey) {
      this.h.onRatioStep?.(e.deltaY > 0 ? -0.05 : 0.05);
      return;
    }
    // Zoom suave: cada golpe de rueda acumula sobre el objetivo. Trackpads y
    // ratones con «líneas» o «páginas» dan lo mismo por la misma distancia
    const dy = e.deltaY * (WHEEL_UNIT[e.deltaMode] || 1);
    this.camera.zoomToward(x, y, Math.exp(-Math.max(-300, Math.min(300, dy)) * 0.0018));
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
    } else if (e.code === 'KeyC') {
      this.h.onCenter?.();
    } else if (e.code === 'Escape') {
      this.h.onEscape?.();
    } else if (this.h.buildKeys && this.h.buildKeys[e.code]) {
      this.h.onBuildKey?.(this.h.buildKeys[e.code]);
    } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
      this.camera.zoomToward(this.camera.viewW / 2, this.camera.viewH / 2, 1.3);
    } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
      this.camera.zoomToward(this.camera.viewW / 2, this.camera.viewH / 2, 1 / 1.3);
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
