// Cámara 2D: (x, y) es la esquina superior izquierda visible en coordenadas de
// casilla; zoom = píxeles CSS por casilla.

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
  }

  screenToWorld(sx, sy) {
    return [sx / this.zoom + this.x, sy / this.zoom + this.y];
  }

  worldToScreen(wx, wy) {
    return [(wx - this.x) * this.zoom, (wy - this.y) * this.zoom];
  }

  /** Vuelo suave hasta centrar (wx, wy) con el zoom indicado. */
  flyTo(wx, wy, zoom, ms = 500) {
    this.tween = {
      fromZoom: this.zoom,
      fromCx: this.x + this.viewW / this.zoom / 2,
      fromCy: this.y + this.viewH / this.zoom / 2,
      toZoom: Math.min(this.maxZoom, Math.max(this.minZoom, zoom)),
      wx,
      wy,
      t0: performance.now(),
      ms,
    };
  }

  /** Avanza el vuelo en curso (llamar cada frame). */
  update(now) {
    const t = this.tween;
    if (!t) return;
    const k = Math.min(1, (now - t.t0) / t.ms);
    const e = 1 - (1 - k) ** 3;
    this.zoom = t.fromZoom + (t.toZoom - t.fromZoom) * e;
    const cx = t.fromCx + (t.wx - t.fromCx) * e;
    const cy = t.fromCy + (t.wy - t.fromCy) * e;
    this.x = cx - this.viewW / this.zoom / 2;
    this.y = cy - this.viewH / this.zoom / 2;
    if (k >= 1) this.tween = null;
    this.clamp();
  }

  pan(dx, dy) {
    this.tween = null; // el jugador toma el control
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  }

  zoomAt(sx, sy, factor) {
    this.tween = null;
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.x = wx - sx / this.zoom;
    this.y = wy - sy / this.zoom;
    this.clamp();
  }

  centerOn(wx, wy) {
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
