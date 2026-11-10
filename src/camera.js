// Cámara 2D: (x, y) es la esquina superior izquierda visible en coordenadas de
// casilla; zoom = píxeles CSS por casilla.
//
// Todo lo que mueve la cámara es suave y depende del tiempo, no de los
// fotogramas:
// - zoom con la rueda o las teclas: un zoom objetivo al que se llega en
//   escala logarítmica, sin moverse el punto bajo el cursor;
// - arrastre con inercia: al soltar, el mapa sigue un poco y frena;
// - vuelos (flyTo): zoom interpolado en escala logarítmica, con aceleración
//   y frenada.

const ZOOM_RATE = 16; // 1/s: lo rápido que llega el zoom a su objetivo
const FRICTION = 5.5; // 1/s: frenada de la inercia
const MIN_FLING = 40; // px/s: por debajo, la inercia se para

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 2;
    this.minZoom = 0.5;
    this.maxZoom = 48;
    this.viewW = 800;
    this.viewH = 600;
    this.mapW = 1;
    this.mapH = 1;
    this.tween = null;
    this.zoomTarget = null; // { zoom, sx, sy, wx, wy }: zoom suave anclado a un punto
    this.vx = 0; // inercia, en píxeles de pantalla por segundo
    this.vy = 0;
    this._last = 0;
  }

  setView(w, h) {
    this.viewW = w;
    this.viewH = h;
    this.clamp();
  }

  fit(mapW, mapH) {
    this.mapW = mapW;
    this.mapH = mapH;
    const contain = Math.min(this.viewW / mapW, this.viewH / mapH) * 0.96;
    const cover = Math.max(this.viewW / mapW, this.viewH / mapH);
    // En un móvil en vertical, un mapa apaisado entero quedaría como una
    // franja estrecha: se acerca a medio camino (se ve el centro y se desliza)
    this.zoom = cover / contain > 2.2 ? contain * Math.sqrt(cover / contain) : contain;
    this.minZoom = contain * 0.7;
    this.x = (mapW - this.viewW / this.zoom) / 2;
    this.y = (mapH - this.viewH / this.zoom) / 2;
    this.stop();
  }

  screenToWorld(sx, sy) {
    return [sx / this.zoom + this.x, sy / this.zoom + this.y];
  }

  worldToScreen(wx, wy) {
    return [(wx - this.x) * this.zoom, (wy - this.y) * this.zoom];
  }

  /** Para cualquier movimiento en curso (vuelo, zoom suave e inercia). */
  stop() {
    this.tween = null;
    this.zoomTarget = null;
    this.vx = 0;
    this.vy = 0;
  }

  /** ¿Se está moviendo sola? (vuelo, zoom suave o inercia) */
  get moving() {
    return !!(this.tween || this.zoomTarget || this.vx || this.vy);
  }

  _clampZoom(z) {
    return Math.min(this.maxZoom, Math.max(this.minZoom, z));
  }

  /**
   * Vuelo suave hasta centrar (wx, wy) con el zoom indicado. La duración
   * crece un poco con lo lejos que está (en pantallas) y con el cambio de zoom.
   */
  flyTo(wx, wy, zoom, ms = null) {
    const fromCx = this.x + this.viewW / this.zoom / 2;
    const fromCy = this.y + this.viewH / this.zoom / 2;
    const toZoom = this._clampZoom(zoom);
    if (ms === null) {
      const screens = Math.hypot(wx - fromCx, wy - fromCy) * this.zoom / Math.max(1, Math.hypot(this.viewW, this.viewH));
      const zoomSteps = Math.abs(Math.log2(toZoom / this.zoom));
      ms = Math.min(1100, 450 + Math.min(screens, 6) * 70 + zoomSteps * 90);
    }
    this.zoomTarget = null;
    this.vx = this.vy = 0;
    this.tween = { fromZoom: this.zoom, fromCx, fromCy, toZoom, wx, wy, t0: performance.now(), ms };
  }

  /** Avanza el vuelo, el zoom suave y la inercia (llamar cada frame). */
  update(now) {
    const dt = this._last ? Math.min(0.1, (now - this._last) / 1000) : 0;
    this._last = now;
    const t = this.tween;
    if (t) {
      const k = Math.min(1, (now - t.t0) / t.ms);
      const e = easeInOut(k);
      // Zoom en escala logarítmica: cada duplicación tarda lo mismo
      this.zoom = t.fromZoom * (t.toZoom / t.fromZoom) ** e;
      const cx = t.fromCx + (t.wx - t.fromCx) * e;
      const cy = t.fromCy + (t.wy - t.fromCy) * e;
      this.x = cx - this.viewW / this.zoom / 2;
      this.y = cy - this.viewH / this.zoom / 2;
      if (k >= 1) this.tween = null;
      this.clamp();
      return;
    }
    if (!dt) return;
    const z = this.zoomTarget;
    if (z) {
      const k = 1 - Math.exp(-dt * ZOOM_RATE);
      const ratio = z.zoom / this.zoom;
      if (Math.abs(Math.log(ratio)) < 0.002) {
        this.zoom = z.zoom;
        this.zoomTarget = null;
      } else this.zoom *= ratio ** k;
      // El punto anclado se queda bajo el cursor
      this.x = z.wx - z.sx / this.zoom;
      this.y = z.wy - z.sy / this.zoom;
      this.clamp();
    }
    if (this.vx || this.vy) {
      this.x -= (this.vx * dt) / this.zoom;
      this.y -= (this.vy * dt) / this.zoom;
      const f = Math.exp(-dt * FRICTION);
      this.vx *= f;
      this.vy *= f;
      if (Math.hypot(this.vx, this.vy) < MIN_FLING) this.vx = this.vy = 0;
      this.clamp();
    }
  }

  pan(dx, dy) {
    this.tween = null; // el jugador toma el control
    this.vx = this.vy = 0;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    // Si había un zoom suave en marcha, su punto anclado se mueve con el mapa
    if (this.zoomTarget) {
      this.zoomTarget.wx -= dx / this.zoom;
      this.zoomTarget.wy -= dy / this.zoom;
    }
    this.clamp();
  }

  /** Al soltar un arrastre: el mapa sigue moviéndose con esta velocidad (px/s) y frena. */
  fling(vx, vy) {
    if (Math.hypot(vx, vy) < MIN_FLING * 2) return;
    const max = 4000;
    const s = Math.min(1, max / Math.hypot(vx, vy));
    this.vx = vx * s;
    this.vy = vy * s;
  }

  /** Zoom al momento (pellizco: sigue a los dedos). */
  zoomAt(sx, sy, factor) {
    this.tween = null;
    this.zoomTarget = null;
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = this._clampZoom(this.zoom * factor);
    this.x = wx - sx / this.zoom;
    this.y = wy - sy / this.zoom;
    this.clamp();
  }

  /** Zoom suave (rueda y teclas): acumula sobre el objetivo y mantiene el punto (sx, sy). */
  zoomToward(sx, sy, factor) {
    this.tween = null;
    this.vx = this.vy = 0;
    const base = this.zoomTarget ? this.zoomTarget.zoom : this.zoom;
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoomTarget = { zoom: this._clampZoom(base * factor), sx, sy, wx, wy };
  }

  centerOn(wx, wy) {
    this.stop();
    this.x = wx - this.viewW / this.zoom / 2;
    this.y = wy - this.viewH / this.zoom / 2;
    this.clamp();
  }

  /** Impide perder el mapa de vista: su centro siempre queda en pantalla. */
  clamp() {
    const vw = this.viewW / this.zoom;
    const vh = this.viewH / this.zoom;
    this.x = Math.min(this.mapW - vw * 0.25, Math.max(-vw * 0.75, this.x));
    this.y = Math.min(this.mapH - vh * 0.25, Math.max(-vh * 0.75, this.y));
  }
}
