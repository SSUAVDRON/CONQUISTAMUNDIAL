// Dibujo en canvas. Capas, de abajo arriba:
//   mar (con olas que se mueven) → tierra con relieve → territorios → destellos
//   de las casillas recién conquistadas → sombras de nubes → cráteres →
//   edificios → barcos → partículas → misiles → viñeta → nombres y marcadores.
// Barcos y misiles se interpolan entre ticks para que se muevan con suavidad.
import { CONFIG, RES, TICK_MS } from './config.js';
import { rgbToCss, shadeRgb } from './colors.js';
import { formatNumber } from './format.js';
import { PATTERN_FNS, drawBuildingIcon, drawEmblem, drawFlag, emblemFor } from './icons.js';
import { makeCloudTexture, makeWaveTexture, paintTerrain } from './terreno.js';
import { Fx, drawMissileSprite } from './fx.js';
import { drawCargo, drawFishing, drawTransport, drawWarship } from './barcos.js';

const FILL_ALPHA = 128;
const INNER_ALPHA = 185;
const LABEL_INTERVAL_MS = 500;
const FLASH_N = 16384;
const FLASH_LIFE = [700, 450, 1400]; // combate, tierra libre, arrasada (ms)
const FLASH_COLORS = [
  ['rgba(255, 240, 190, 0.9)', 'rgba(255, 160, 70, 0.6)', 'rgba(210, 70, 30, 0.32)'],
  ['rgba(255, 255, 255, 0.32)', 'rgba(255, 255, 255, 0.18)', 'rgba(255, 255, 255, 0.08)'],
  ['rgba(255, 150, 60, 0.85)', 'rgba(200, 50, 20, 0.55)', 'rgba(70, 20, 10, 0.4)'],
];
const ALLY_STRIPE = [96, 226, 140];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Empaqueta RGBA en un uint32 (little-endian, como ImageData en la práctica). */
const pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** Ángulo `a` acercándose a `b` por el camino corto. */
function turn(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class Renderer {
  constructor(canvas, game, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.camera = camera;
    this.dpr = window.devicePixelRatio || 1;
    const { width, height, size } = game.map;

    const terrain = paintTerrain(game.map);
    this.waterCanvas = terrain.water;
    this.landCanvas = terrain.land;
    this.waveTex = makeWaveTexture();
    this.cloudTex = makeCloudTexture();
    this._wavePat = null;
    this._cloudPat = null;
    this._vignette = null;

    this.territoryCanvas = makeCanvas(width, height);
    this.tctx = this.territoryCanvas.getContext('2d');
    this.image = this.tctx.createImageData(width, height);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this._buildPalette();
    this.diploVersion = game.diploVersion;
    game.trackDirty = true;
    game.dirty.length = 0;
    this.prevOwner = Uint16Array.from(game.owner);
    this._paintAllTerritory();

    // Destellos de casillas que cambian de dueño (cola circular)
    this._flash = { t: new Int32Array(FLASH_N), at: new Float64Array(FLASH_N), k: new Uint8Array(FLASH_N), head: 0, n: 0 };
    this._buckets = Array.from({ length: 9 }, () => []);
    this._battleTmp = [];
    this._wildTmp = [];

    this.fx = new Fx();
    this._units = new WeakMap();
    this._seenFx = new WeakSet();
    for (const e of game.effects) this._seenFx.add(e);
    this._boats = new Map();
    this._ships = new Map();
    this._merch = new Map();
    this._missiles = new Map();
    this._gen = 0;
    this._tick = game.ticks;
    this._tickAt = 0;
    this._frac = 1;
    this._dt = 0;
    this._lastNow = 0;
    this._trailAcc = 0;
    this.view = { x0: 0, y0: 0, x1: width, y1: height };

    this.distField = new Uint16Array(size);
    this.labels = [];
    this.labelById = new Map();
    this.lastLabelTime = -Infinity;
    this.highlightTile = -1;
    this.options = { badges: true, emojis: true, pointer: true, animations: true };
  }

  setDpr(dpr) {
    this.dpr = dpr;
    this._vignette = null;
  }

  get anim() {
    return this.options.animations !== false;
  }

  _buildPalette() {
    const n = this.game.players.length;
    this.fill = new Uint32Array(n);
    this.inner = new Uint32Array(n);
    this.alt = new Uint32Array(n);
    this.border = new Uint32Array(n);
    this.patterns = new Array(n).fill(null);
    this.allied = new Uint8Array(n);
    const human = this.game.human;
    for (const p of this.game.players) {
      if (!p) continue;
      const [r, g, b] = p.color;
      const ally = !!(human && p !== human && human.allies.has(p.id));
      this.allied[p.id] = ally ? 1 : 0;
      this.fill[p.id] = pack(r, g, b, FILL_ALPHA);
      // Junto a la frontera, el color es más intenso: el territorio parece en relieve
      const [ir, ig, ib] = shadeRgb(p.color, 1.08);
      this.inner[p.id] = pack(Math.min(255, ir), Math.min(255, ig), Math.min(255, ib), INNER_ALPHA);
      // Patrón del perfil: algunas casillas con un tono más oscuro.
      // Los aliados llevan franjas verdes en diagonal: se reconocen de un vistazo.
      this.patterns[p.id] = PATTERN_FNS[p.pattern] || null;
      const [ar, ag, ab] = ally ? ALLY_STRIPE : shadeRgb(p.color, 0.72);
      this.alt[p.id] = pack(ar, ag, ab, ally ? 215 : Math.min(255, FILL_ALPHA + 40));
      // Frontera blanca para el humano y verde para sus aliados
      const bc = p === human ? [255, 255, 255] : ally ? [120, 245, 165] : shadeRgb(p.color, 0.55);
      this.border[p.id] = pack(bc[0], bc[1], bc[2], 255);
    }
  }

  _paintTile(i) {
    const o = this.game.owner[i];
    if (!o) {
      this.pixels[i] = 0;
      return;
    }
    const p = this.game.players[o];
    const border = p.border;
    if (border.has(i)) {
      this.pixels[i] = this.border[o];
      return;
    }
    const w = this.game.map.width;
    const x = i % w;
    const y = (i / w) | 0;
    if (this.allied[o]) {
      this.pixels[i] = (x + y) % 7 < 2 ? this.alt[o] : this.fill[o];
      return;
    }
    if ((x > 0 && border.has(i - 1)) || (x < w - 1 && border.has(i + 1)) || border.has(i - w) || border.has(i + w)) {
      this.pixels[i] = this.inner[o];
      return;
    }
    const pattern = this.patterns[o];
    this.pixels[i] = pattern && pattern(x, y) ? this.alt[o] : this.fill[o];
  }

  _paintAllTerritory() {
    for (let i = 0; i < this.pixels.length; i++) this._paintTile(i);
    this.tctx.putImageData(this.image, 0, 0);
  }

  _inView(x, y, margin = 0) {
    const v = this.view;
    return x >= v.x0 - margin && y >= v.y0 - margin && x <= v.x1 + margin && y <= v.y1 + margin;
  }

  /** Repinta lo que cambió y lanza destellos y chispas donde se conquista. */
  _flushDirty(now) {
    const game = this.game;
    const dirty = game.dirty;
    if (!dirty.length) return;
    const owner = game.owner;
    const prev = this.prevOwner;
    const map = game.map;
    const W = map.width;
    const size = map.size;
    const battles = this._battleTmp;
    const wild = this._wildTmp;
    battles.length = 0;
    wild.length = 0;
    const watch = this.anim && this.camera.zoom * RES >= 1.2;
    let x0 = W;
    let y0 = map.height;
    let x1 = -1;
    let y1 = -1;
    for (let k = 0; k < dirty.length; k++) {
      const t = dirty[k];
      this._paintTile(t);
      // Los vecinos pueden pasar a ser (o dejar de ser) la franja interior
      const x = t % W;
      const y = (t / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0) this._paintTile(t - 1);
      if (x < W - 1) this._paintTile(t + 1);
      if (t >= W) this._paintTile(t - W);
      if (t < size - W) this._paintTile(t + W);
      const o = owner[t];
      const was = prev[t];
      if (o === was) continue;
      prev[t] = o;
      const kind = was && o ? 0 : o ? 1 : 2;
      this._pushFlash(t, now, kind);
      if (watch && kind < 2 && this._inView(x, (t / W) | 0, 2)) (kind === 0 ? battles : wild).push(t);
    }
    dirty.length = 0;
    // Solo se sube a la tarjeta gráfica el rectángulo que ha cambiado (± 1 casilla)
    x0 = Math.max(0, x0 - 1);
    y0 = Math.max(0, y0 - 1);
    x1 = Math.min(W - 1, x1 + 1);
    y1 = Math.min(map.height - 1, y1 + 1);
    this.tctx.putImageData(this.image, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    if (!watch) return;
    // Solo una muestra: suficiente para que el frente «hierva» sin saturar
    const fx = this.fx;
    if (battles.length) {
      const p = Math.min(0.6, 9 / battles.length);
      for (const t of battles) {
        if (Math.random() < p) fx.skirmish((t % W) + 0.5, ((t / W) | 0) + 0.5, Math.random() < 0.15);
      }
    }
    if (wild.length && this.camera.zoom * RES >= 2) {
      const p = Math.min(0.15, 2 / wild.length);
      for (const t of wild) if (Math.random() < p) fx.dust((t % W) + 0.5, ((t / W) | 0) + 0.5);
    }
  }

  _pushFlash(t, now, kind) {
    const f = this._flash;
    f.t[f.head] = t;
    f.at[f.head] = now;
    f.k[f.head] = kind;
    f.head = (f.head + 1) % FLASH_N;
    if (f.n < FLASH_N) f.n++;
  }

  /** Casillas recién conquistadas: brillan y se apagan (en coordenadas de mundo). */
  _drawFlashes(now) {
    const f = this._flash;
    if (!f.n) return;
    const W = this.game.map.width;
    const buckets = this._buckets;
    for (const b of buckets) b.length = 0;
    const maxLife = Math.max(...FLASH_LIFE);
    let any = false;
    for (let j = 0; j < f.n; j++) {
      const idx = (f.head - 1 - j + FLASH_N) % FLASH_N;
      const age = now - f.at[idx];
      if (age > maxLife) break; // están en orden: las demás son más viejas
      const kind = f.k[idx];
      const life = FLASH_LIFE[kind];
      if (age >= life) continue;
      const t = f.t[idx];
      const x = t % W;
      const y = (t / W) | 0;
      if (!this._inView(x, y, 1)) continue;
      buckets[kind * 3 + Math.min(2, Math.floor((age / life) * 3))].push(t);
      any = true;
    }
    if (!any) return;
    const { ctx } = this;
    for (let k = 0; k < 9; k++) {
      const list = buckets[k];
      if (!list.length) continue;
      const kind = Math.floor(k / 3);
      ctx.globalCompositeOperation = kind !== 1 && k % 3 < 2 ? 'lighter' : 'source-over';
      ctx.fillStyle = FLASH_COLORS[kind][k % 3];
      ctx.beginPath();
      for (const t of list) ctx.rect(t % W, (t / W) | 0, 1, 1);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Posición suavizada de una unidad: entre la del tick anterior y la actual.
   * Devuelve un estado { x, y, v, ang, speed } que se reutiliza.
   */
  _lerpUnit(obj, x, y, v = 0) {
    const tick = this.game.ticks;
    let s = this._units.get(obj);
    if (!s) {
      s = { px: x, py: y, pv: v, cx: x, cy: y, cv: v, tick, ang: null, x, y, v, speed: 0 };
      this._units.set(obj, s);
    } else if (s.tick !== tick) {
      const jump = Math.abs(x - s.cx) + Math.abs(y - s.cy) > 8;
      s.px = jump ? x : s.cx;
      s.py = jump ? y : s.cy;
      s.pv = s.cv;
      s.cx = x;
      s.cy = y;
      s.cv = v;
      s.tick = tick;
    }
    const f = this._frac;
    s.x = s.px + (s.cx - s.px) * f;
    s.y = s.py + (s.cy - s.py) * f;
    s.v = s.pv + (s.cv - s.pv) * f;
    const dx = s.cx - s.px;
    const dy = s.cy - s.py;
    s.speed = Math.hypot(dx, dy);
    if (s.speed > 1e-3) {
      const target = Math.atan2(dy, dx);
      s.ang = s.ang === null ? target : turn(s.ang, target, Math.min(1, this._dt * 8));
    } else if (s.ang === null) {
      s.ang = 0;
    }
    return s;
  }

  /**
   * Para colocar cada nombre buscamos la casilla más alejada de su frontera
   * (transformada de distancia en dos pasadas). Esa distancia da también el
   * tamaño de letra.
   */
  _updateLabels() {
    const { owner, players, map } = this.game;
    const W = map.width;
    const H = map.height;
    const d = this.distField;
    for (let i = 0; i < d.length; i++) {
      const o = owner[i];
      if (!o) {
        d[i] = 0;
        continue;
      }
      const x = i % W;
      const edge =
        x === 0 || x === W - 1 || i < W || i >= d.length - W ||
        owner[i - 1] !== o || owner[i + 1] !== o || owner[i - W] !== o || owner[i + W] !== o;
      d[i] = edge ? 1 : 65535;
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (d[i] <= 1) continue;
        let v = d[i - 1] + 1;
        if (v < d[i]) d[i] = v;
        v = d[i - W] + 1;
        if (v < d[i]) d[i] = v;
      }
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        if (d[i] <= 1) continue;
        let v = d[i + 1] + 1;
        if (v < d[i]) d[i] = v;
        v = d[i + W] + 1;
        if (v < d[i]) d[i] = v;
      }
    }
    const best = new Uint16Array(players.length);
    const at = new Int32Array(players.length).fill(-1);
    for (let i = 0; i < d.length; i++) {
      const o = owner[i];
      if (o && d[i] > best[o]) {
        best[o] = d[i];
        at[o] = i;
      }
    }
    this.labels = [];
    this.labelById.clear();
    for (const p of players) {
      if (!p || !p.alive || at[p.id] < 0) continue;
      const L = { player: p, x: (at[p.id] % W) + 0.5, y: Math.floor(at[p.id] / W) + 0.5, r: best[p.id] };
      this.labels.push(L);
      this.labelById.set(p.id, L);
    }
  }

  /**
   * `overlay`: { buildMode, hoverTile, ping } para la vista previa de
   * construcción y el aviso de la cámara.
   */
  draw(now, overlay = {}) {
    const { ctx, camera, dpr, game } = this;
    this._dt = this._lastNow ? Math.min(0.1, (now - this._lastNow) / 1000) : 0;
    this._lastNow = now;
    if (game.ticks !== this._tick) {
      this._tick = game.ticks;
      this._tickAt = now;
    }
    this._frac = clamp((now - this._tickAt) / TICK_MS, 0, 1);
    const v = this.view;
    v.x0 = camera.x;
    v.y0 = camera.y;
    v.x1 = camera.x + camera.viewW / camera.zoom;
    v.y1 = camera.y + camera.viewH / camera.zoom;

    if (game.diploVersion !== this.diploVersion) {
      // Cambió alguna alianza: recolorear fronteras y franjas de aliados
      this.diploVersion = game.diploVersion;
      this._buildPalette();
      this._paintAllTerritory();
    }
    this._flushDirty(now);
    if (now - this.lastLabelTime > LABEL_INTERVAL_MS) {
      this._updateLabels();
      this.lastLabelTime = now;
    }
    this.fx.update(this._dt);

    // Temblor de cámara tras una explosión cercana
    const sh = this.anim ? this.fx.shake : 0;
    const ox = sh ? (Math.random() - 0.5) * sh : 0;
    const oy = sh ? (Math.random() - 0.5) * sh : 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a1a30';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const map = game.map;
    const z = camera.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, -camera.x * z + ox * dpr, -camera.y * z + oy * dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.waterCanvas, 0, 0);
    this._drawWaves(now);
    ctx.drawImage(this.landCanvas, 0, 0, map.width, map.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.territoryCanvas, 0, 0);
    this._drawFlashes(now);
    this._drawClouds(now);

    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    ctx.imageSmoothingEnabled = true;
    this.fx.drawDecals(ctx, camera);
    this._drawBuildings(now);
    this._gen++;
    this._trackEffects();
    this._drawMerchants();
    this._drawBoats();
    this._drawWarships(now);
    this.fx.draw(ctx, camera);
    this._drawMissiles(now);
    this._drawVignette();
    if (this.fx.flash > 0.01 && this.anim) {
      // Destello blanco de toda la pantalla tras una explosión cercana
      ctx.fillStyle = `rgba(255, 244, 220, ${this.fx.flash * 0.45})`;
      ctx.fillRect(-20, -20, camera.viewW + 40, camera.viewH + 40);
    }
    this._drawLabels();
    this._drawYouMarker(now);
    this._drawAttackArrows(now);
    this._drawAttackBadges();
    this._drawEmojis();
    if (game.phase === 'spawn') this._drawSpawnMarker(now);
    if (overlay.buildMode && overlay.hoverTile >= 0) this._drawBuildPreview(overlay.buildMode, overlay.hoverTile);
    if (overlay.ping) this._drawPing(now, overlay.ping);
  }

  // -------------------------------------------------------------- ambiente

  /** Dos capas de crestas que se desplazan sobre el mar (debajo de la tierra). */
  _drawWaves(now) {
    const { ctx, camera } = this;
    const a = smooth(1.2, 3.5, camera.zoom * RES);
    if (a <= 0 || typeof DOMMatrix === 'undefined') return;
    if (!this._wavePat) {
      this._wavePat = ctx.createPattern(this.waveTex, 'repeat');
      this._wavePat2 = ctx.createPattern(this.waveTex, 'repeat');
    }
    const t = this.anim ? now / 1000 : 0;
    const v = this.view;
    const layers = [
      [this._wavePat, RES / 9, 0.55 * RES, 0.22 * RES, 0.55],
      [this._wavePat2, RES / 6, -0.35 * RES, 0.4 * RES, 0.3],
    ];
    for (const [pat, k, vx, vy, alpha] of layers) {
      if (!pat || !pat.setTransform) continue;
      const period = 256 * k;
      pat.setTransform(new DOMMatrix([k, 0, 0, k, (t * vx) % period, (t * vy) % period]));
      ctx.globalAlpha = a * alpha;
      ctx.fillStyle = pat;
      ctx.fillRect(v.x0 - 1, v.y0 - 1, v.x1 - v.x0 + 2, v.y1 - v.y0 + 2);
    }
    ctx.globalAlpha = 1;
  }

  /** Sombras de nubes que pasan despacio (se apagan al acercarse mucho). */
  _drawClouds(now) {
    const { ctx, camera } = this;
    const a = 0.2 * (1 - smooth(5, 10, camera.zoom * RES));
    if (a <= 0.01 || typeof DOMMatrix === 'undefined') return;
    if (!this._cloudPat) this._cloudPat = ctx.createPattern(this.cloudTex, 'repeat');
    if (!this._cloudPat || !this._cloudPat.setTransform) return;
    const k = 0.75 * RES;
    const period = 256 * k;
    const t = this.anim ? now / 1000 : 0;
    this._cloudPat.setTransform(new DOMMatrix([k, 0, 0, k, (t * 1.6 * RES) % period, (t * 0.5 * RES) % period]));
    const v = this.view;
    ctx.globalAlpha = a;
    ctx.fillStyle = this._cloudPat;
    ctx.fillRect(v.x0 - 1, v.y0 - 1, v.x1 - v.x0 + 2, v.y1 - v.y0 + 2);
    ctx.globalAlpha = 1;
  }

  /** Bordes de la pantalla algo más oscuros: centra la mirada. */
  _drawVignette() {
    const { ctx, camera } = this;
    const w = camera.viewW;
    const h = camera.viewH;
    if (!this._vignette || this._vignette.w !== w || this._vignette.h !== h) {
      const r = Math.hypot(w, h) / 2;
      const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.55, w / 2, h / 2, r);
      g.addColorStop(0, 'rgba(4, 10, 22, 0)');
      g.addColorStop(1, 'rgba(4, 10, 22, 0.42)');
      this._vignette = { w, h, g };
    }
    ctx.fillStyle = this._vignette.g;
    ctx.fillRect(-20, -20, w + 40, h + 40);
  }

  /** Anillos que marcan el punto al que ha volado la cámara. */
  _drawPing(now, ping) {
    const age = (now - ping.t) / 1000;
    if (age > 1.6) return;
    const { ctx, camera } = this;
    const [x, y] = camera.worldToScreen(ping.x, ping.y);
    for (let k = 0; k < 2; k++) {
      const a = age - k * 0.35;
      if (a < 0 || a > 1.2) continue;
      ctx.beginPath();
      ctx.arc(x, y, 10 + a * 40, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = ping.danger ? `rgba(255, 90, 90, ${1 - a / 1.2})` : `rgba(242, 179, 61, ${1 - a / 1.2})`;
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------- edificios

  _buildingSize() {
    return Math.min(30, Math.max(10, this.camera.zoom * RES * 3));
  }

  _drawBuildings(now) {
    const { ctx, game, camera } = this;
    if (camera.zoom * RES < 1.1 || !game.buildings.length) return;
    const map = game.map;
    const size = this._buildingSize();
    for (const b of game.buildings) {
      const [sx, sy] = camera.worldToScreen(map.x(b.tile) + 0.5, map.y(b.tile) + 0.5);
      if (sx < -size || sy < -size || sx > camera.viewW + size || sy > camera.viewH + size) continue;
      const p = game.players[b.owner];
      // Sombra bajo el icono
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(sx + size * 0.08, sy + size * 0.42, size * 0.42, size * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      const building = game.isBuilding ? game.isBuilding(b) : false;
      if (building) ctx.globalAlpha = 0.55;
      drawBuildingIcon(ctx, b.kind, sx, sy, size, {
        disc: rgbToCss(shadeRgb(p.color, 0.7)),
        ring: p === game.human ? '#ffffff' : 'rgba(0,0,0,0.7)',
      });
      ctx.globalAlpha = 1;
      if (building) this._drawConstruction(sx, sy, size, game.buildProgress(b), now);
      else if (b.level > 1) this._drawLevel(sx, sy, size, b.level);
      if (b.kind === 'port' && b.hp < CONFIG.portHp) this._hpBar(sx, sy - size * 0.75, size, b.hp / CONFIG.portHp);
    }
  }

  /** Obra en marcha: anillo de progreso y un andamio que parpadea. */
  _drawConstruction(sx, sy, size, frac, now) {
    const { ctx } = this;
    const r = size * 0.62;
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffc857';
    ctx.beginPath();
    ctx.arc(sx, sy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    // Grúa: una chispa que gira por el anillo
    const a = -Math.PI / 2 + Math.PI * 2 * frac;
    const blink = this.anim ? 0.6 + Math.sin(now / 90) * 0.4 : 1;
    ctx.fillStyle = `rgba(255, 240, 180, ${blink})`;
    ctx.beginPath();
    ctx.arc(sx + Math.cos(a) * r, sy + Math.sin(a) * r, Math.max(1.5, size * 0.09), 0, Math.PI * 2);
    ctx.fill();
  }

  /** Nivel del edificio: estrellitas debajo del icono. */
  _drawLevel(sx, sy, size, level) {
    const { ctx } = this;
    const n = Math.min(level, 5);
    const s = Math.max(3, size * 0.16);
    const total = n * s * 1.3;
    let x = sx - total / 2 + s * 0.65;
    const y = sy + size * 0.58;
    for (let k = 0; k < n; k++) {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 4) / 5;
        ctx.lineTo(x + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.6);
      }
      ctx.closePath();
      ctx.fillStyle = '#ffd34d';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.stroke();
      x += s * 1.3;
    }
  }

  _hpBar(cx, cy, width, frac) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.roundRect(cx - width / 2 - 1, cy - 3, width + 2, 6, 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cx - width / 2, cy - 2, Math.max(2, width * Math.max(0, Math.min(1, frac))), 4, 2);
    ctx.fillStyle = frac > 0.5 ? '#5fd38d' : frac > 0.25 ? '#ffc857' : '#ff6b6b';
    ctx.fill();
  }

  // ----------------------------------------------------------------- barcos

  /** Punto (con decimales) de una unidad que sigue un camino de casillas. */
  _pathPoint(tile, path, pos, progress) {
    const W = this.game.map.width;
    let x = (tile % W) + 0.5;
    let y = Math.floor(tile / W) + 0.5;
    if (path && pos < path.length - 1) {
      const n = path[pos + 1];
      const t = Math.min(1, progress);
      x = lerp(x, (n % W) + 0.5, t);
      y = lerp(y, Math.floor(n / W) + 0.5, t);
    }
    return [x, y];
  }

  _onScreen(sx, sy, m) {
    const c = this.camera;
    return sx > -m && sy > -m && sx < c.viewW + m && sy < c.viewH + m;
  }

  /** Estela de espuma: unas pocas partículas por segundo mientras navega. */
  _maybeWake(s, len, rate) {
    if (!this.anim || this.camera.zoom * RES < 2.5 || s.speed < 0.05 * RES) return;
    if (Math.random() < this._dt * rate) this.fx.wake(s.x, s.y, s.ang, len / this.camera.zoom / RES);
  }

  /** Pesqueros y mercantes, con el color de su dueño. Destello al ser capturados. */
  _drawMerchants() {
    const { ctx, game, camera, fx } = this;
    const gen = this._gen;
    const z = camera.zoom;
    for (const m of game.merchants) {
      const [wx, wy] = this._pathPoint(m.tile, m.path, m.pos, m.progress);
      const s = this._lerpUnit(m, wx, wy);
      let st = this._merch.get(m.id);
      if (!st) {
        st = { owner: m.owner };
        this._merch.set(m.id, st);
      } else if (st.owner !== m.owner) {
        st.owner = m.owner;
        if (this.anim) fx.capture(s.x, s.y, rgbToCss(game.players[m.owner].color));
      }
      st.gen = gen;
      const sx = (s.x - camera.x) * z;
      const sy = (s.y - camera.y) * z;
      if (!this._onScreen(sx, sy, 40)) continue;
      const p = game.players[m.owner];
      const color = rgbToCss(p.color);
      const mine = p === game.human;
      const moving = clamp((s.speed / RES) * 3, 0, 1);
      if (m.kind === 'trade') {
        const len = clamp(z * RES * 2.6, 6, 30);
        drawCargo(ctx, sx, sy, s.ang, len, color, mine, moving, m.id);
        this._maybeWake(s, len, 5);
      } else {
        const len = clamp(z * RES * 1.8, 5, 18);
        drawFishing(ctx, sx, sy, s.ang, len, color, mine, moving);
      }
    }
    for (const [id, st] of this._merch) if (st.gen !== gen) this._merch.delete(id);
  }

  /** Lanchas de desembarco. Al desaparecer: desembarco o hundimiento. */
  _drawBoats() {
    const { ctx, game, camera, fx } = this;
    const gen = this._gen;
    const z = camera.zoom;
    const W = game.map.width;
    const human = game.human;
    for (const b of game.boats) {
      const a = b.path[b.pos];
      const [wx, wy] = this._pathPoint(a, b.path, b.pos, b.progress);
      const s = this._lerpUnit(b, wx, wy);
      this._boats.set(b.id, { x: s.x, y: s.y, pos: b.pos, len: b.path.length, gen, end: b.path[b.path.length - 1] });
      const sx = (s.x - camera.x) * z;
      const sy = (s.y - camera.y) * z;
      const p = game.players[b.owner];
      this._drawBoatTrail(b, s, p);
      if (!this._onScreen(sx, sy, 60)) continue;
      const len = clamp(z * RES * 2.4, 8, 30);
      drawTransport(ctx, sx, sy, s.ang, len, rgbToCss(p.color), p === human, 1);
      this._maybeWake(s, len, 8);
      const mine = human && (b.owner === human.id || b.targetId === human.id);
      if (z * RES >= 4 || mine) {
        const text = formatNumber(b.troops);
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(text).width + 10;
        const ty = sy - len * 0.55 - 10;
        ctx.beginPath();
        ctx.roundRect(sx - tw / 2, ty - 8, tw, 16, 8);
        ctx.fillStyle = human && b.targetId === human.id ? 'rgba(190, 40, 40, 0.92)' : b.owner === human?.id ? 'rgba(24, 140, 78, 0.92)' : 'rgba(10, 16, 28, 0.85)';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, sx, ty + 0.5);
      }
    }
    for (const [id, st] of this._boats) {
      if (st.gen === gen) continue;
      this._boats.delete(id);
      if (!this.anim || !this._inView(st.x, st.y, 4)) continue;
      if (st.pos >= st.len - 2) fx.landing((st.end % W) + 0.5, Math.floor(st.end / W) + 0.5);
      else fx.sink(st.x, st.y, false);
    }
  }

  /**
   * Línea fina del barco de tropas: sólida desde donde salió hasta donde va
   * y punteada hasta donde llegará. Todos la ven: así se sabe de dónde viene.
   */
  _drawBoatTrail(b, s, p) {
    const { ctx, camera } = this;
    const W = this.game.map.width;
    const z = camera.zoom;
    const path = b.path;
    const step = Math.max(1, Math.floor(path.length / 90));
    const pt = (t) => [((t % W) + 0.5 - camera.x) * z, (Math.floor(t / W) + 0.5 - camera.y) * z];
    const color = p.color.join(', ');
    const [hx, hy] = [(s.x - camera.x) * z, (s.y - camera.y) * z];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Recorrido hecho
    ctx.beginPath();
    let [x, y] = pt(path[0]);
    ctx.moveTo(x, y);
    for (let i = step; i < b.pos; i += step) {
      [x, y] = pt(path[i]);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = `rgba(${color}, 0.9)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Lo que le queda
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    for (let i = b.pos + step; i < path.length; i += step) {
      [x, y] = pt(path[i]);
      ctx.lineTo(x, y);
    }
    [x, y] = pt(path[path.length - 1]);
    ctx.lineTo(x, y);
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = `rgba(${color}, 0.45)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
    // Origen marcado
    [x, y] = pt(path[0]);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color}, 0.9)`;
    ctx.fill();
  }

  /** Buques de guerra: torretas que apuntan, fogonazos, proyectiles y hundimiento. */
  _drawWarships(now) {
    const { ctx, game, camera, fx } = this;
    const gen = this._gen;
    const z = camera.zoom;
    const map = game.map;
    const W = map.width;
    for (const ws of game.warships) {
      const [wx, wy] = this._pathPoint(ws.tile, ws.path, ws.pos, ws.progress);
      const s = this._lerpUnit(ws, wx, wy);
      let st = this._ships.get(ws.id);
      if (!st) {
        st = { fire: ws.fireTick, aim: null, aimAt: -Infinity };
        this._ships.set(ws.id, st);
      }
      st.gen = gen;
      st.x = s.x;
      st.y = s.y;
      // Disparo nuevo: fogonazo y proyectil hasta el blanco
      if (ws.fireTick !== st.fire) {
        st.fire = ws.fireTick;
        if (ws.fireAt >= 0 && game.ticks - ws.fireTick <= 3) {
          const tx = (ws.fireAt % W) + 0.5;
          const ty = Math.floor(ws.fireAt / W) + 0.5;
          st.aim = Math.atan2(ty - s.y, tx - s.x);
          st.aimAt = now;
          if (this.anim && this._inView(s.x, s.y, 12)) {
            fx.muzzle(s.x, s.y, st.aim);
            fx.shell(s.x, s.y, tx, ty, !map.isLand(ws.fireAt));
          }
        }
      }
      const sx = (s.x - camera.x) * z;
      const sy = (s.y - camera.y) * z;
      // Insignia circular: grande para reconocerla, sin tapar demasiado mapa
      const r = clamp(z * RES * 1.6, 11, 21);
      const len = r * 2;
      if (!this._onScreen(sx, sy, len * 2)) continue;
      const p = game.players[ws.owner];
      const aim = now - st.aimAt < 1600 ? st.aim : null;
      // Destino del buque propio
      if (p === game.human && ws.path) {
        const dest = ws.path[ws.path.length - 1];
        const [dx, dy] = camera.worldToScreen((dest % W) + 0.5, Math.floor(dest / W) + 0.5);
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(dx, dy);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
      drawWarship(ctx, sx, sy, s.ang, r, rgbToCss(p.color), p === game.human, aim, clamp((s.speed / RES) * 3, 0, 1));
      this._maybeWake(s, len, 10);
      // Barra de vida, siempre a la vista
      this._hpBar(sx, sy + r + 6, r * 2, ws.hp / CONFIG.warshipHp);
    }
    for (const [id, st] of this._ships) {
      if (st.gen === gen) continue;
      this._ships.delete(id);
      if (this.anim && this._inView(st.x, st.y, 6)) fx.sink(st.x, st.y, true);
    }
  }

  // ---------------------------------------------------------------- misiles

  /** Explosiones e interceptaciones nuevas de la simulación → efectos. */
  _trackEffects() {
    const { game, fx } = this;
    if (!game.effects.length) return;
    let live = null;
    for (const e of game.effects) {
      if (this._seenFx.has(e)) continue;
      this._seenFx.add(e);
      if (!this.anim || game.ticks - e.tick > 4) continue;
      const visible = this._inView(e.x, e.y, 16);
      const shake = fx.shake;
      const flash = fx.flash;
      if (e.kind === 'boom') {
        fx.explosion(e.x, e.y, CONFIG.missileRadius / RES);
      } else {
        // Busca el misil: el derribado ya no está en la simulación; el que se salva, sí
        live ??= new Set(game.missiles.map((m) => m.id));
        const hit = e.kind === 'intercept';
        let best = null;
        let bestD = Infinity;
        for (const [id, m] of this._missiles) {
          if (hit === live.has(id)) continue;
          const d = (m.gx - e.x) ** 2 + (m.gy - e.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = m;
          }
        }
        const W = game.map.width;
        const bx = (e.from % W) + 0.5;
        const by = Math.floor(e.from / W) + 0.5;
        if (best && bestD < 64) fx.intercept(bx, by, best.gx, best.gy, best.z, best.vx, best.vy, best.vz, hit, best.color);
        else if (hit) fx.airburst(e.x, e.y, 4 * RES);
      }
      if (!visible) {
        fx.shake = shake;
        fx.flash = flash;
      }
    }
  }

  /** Misiles en vuelo: sombra, estela de humo, cuerpo con llama y zona de impacto. */
  _drawMissiles(now) {
    const { ctx, game, camera, fx } = this;
    const gen = this._gen;
    if (game.missiles.length) {
      const W = game.map.width;
      const human = game.human;
      const z = camera.zoom;
      const perSec = 1000 / TICK_MS;
      this._trailAcc += this._dt;
      const puffs = Math.min(4, Math.floor(this._trailAcc / 0.02));
      this._trailAcc = Math.min(0.02, this._trailAcc - puffs * 0.02);
      for (const m of game.missiles) {
        const fx0 = (m.from % W) + 0.5;
        const fy0 = Math.floor(m.from / W) + 0.5;
        const tx = (m.to % W) + 0.5;
        const ty = Math.floor(m.to / W) + 0.5;
        const s = this._lerpUnit(m, 0, 0, m.progress);
        const t = clamp(s.v, 0, 1);
        const arc = Math.min(36 * RES, m.dist * 0.2);
        const gx = fx0 + (tx - fx0) * t;
        const gy = fy0 + (ty - fy0) * t;
        const alt = arc * Math.sin(Math.PI * t);
        const rate = (CONFIG.missileSpeed / m.dist) * perSec;
        const vx = (tx - fx0) * rate;
        const vy = (ty - fy0) * rate;
        const vz = arc * Math.PI * Math.cos(Math.PI * t) * rate;
        const color = rgbToCss(game.players[m.owner].color);
        this._missiles.set(m.id, { gx, gy, z: alt, vx, vy, vz, color, gen });

        const involved = human && (m.owner === human.id || m.targetId === human.id);
        const [sx1, sy1] = camera.worldToScreen(tx, ty);
        if (involved) {
          const pulse = (Math.sin(now / 120) + 1) / 2;
          ctx.beginPath();
          ctx.arc(sx1, sy1, CONFIG.missileRadius * z, 0, Math.PI * 2);
          ctx.fillStyle = m.targetId === human.id ? `rgba(255, 60, 60, ${0.06 + pulse * 0.08})` : 'rgba(255, 190, 120, 0.06)';
          ctx.fill();
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = m.targetId === human.id ? `rgba(255, 80, 80, ${0.5 + pulse * 0.5})` : 'rgba(255, 200, 120, 0.7)';
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (this.anim) for (let k = 0; k < puffs; k++) fx.trail(gx - vx * 0.01 * k, gy - vy * 0.01 * k, alt);
        // Sombra en el suelo (más pequeña cuanto más alto)
        const [gsx, gsy] = camera.worldToScreen(gx, gy);
        const len = clamp(z * RES * 3, 16, 30);
        const k = 1 - (alt / Math.max(1, arc)) * 0.5;
        ctx.fillStyle = `rgba(0, 0, 0, ${0.3 * k})`;
        ctx.beginPath();
        ctx.ellipse(gsx, gsy, len * 0.5 * k, len * 0.18 * k, Math.atan2(vy, vx), 0, Math.PI * 2);
        ctx.fill();
        const [sx, sy] = camera.worldToScreen(gx, gy - alt);
        if (!this.anim) {
          // Sin animaciones, al menos el trayecto recorrido
          const [ax, ay] = camera.worldToScreen(fx0, fy0);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.quadraticCurveTo((ax + sx) / 2, Math.min(ay, sy) - 20, sx, sy);
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255, 230, 200, 0.45)';
          ctx.stroke();
        }
        // Halo para verlo bien de lejos
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 + Math.sin(now / 70) * 0.15;
        ctx.drawImage(this.fx.glow, sx - len, sy - len, len * 2, len * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        drawMissileSprite(ctx, sx, sy, Math.atan2(vy - vz, vx), len, color, now / 1000);
      }
    }
    for (const [id, m] of this._missiles) if (m.gen !== gen) this._missiles.delete(id);
  }

  // ------------------------------------------------------------ vista previa

  _drawBuildPreview(kind, tile) {
    const { ctx, game, camera } = this;
    const human = game.human;
    if (!human) return;
    const map = game.map;
    tile = game.snapBuildTile(human, kind, tile); // el puerto se pega a la orilla
    const check = game.canBuild(human, kind, tile);
    const ok = check.ok;
    let [sx, sy] = camera.worldToScreen(map.x(tile) + 0.5, map.y(tile) + 0.5);
    if (kind === 'warship' && ok) {
      // El buque sale del puerto propio más cercano
      [sx, sy] = camera.worldToScreen(map.x(check.water) + 0.5, map.y(check.water) + 0.5);
    }
    if (check.upgrade) {
      // Mejora de un edificio existente: se marca el propio edificio
      const b = check.upgrade;
      [sx, sy] = camera.worldToScreen(map.x(b.tile) + 0.5, map.y(b.tile) + 0.5);
    }
    const color = ok ? '#5fd38d' : '#ff6b6b';
    if (kind === 'missile') {
      // Zona que arrasará y trayectoria desde el silo elegido
      ctx.beginPath();
      ctx.arc(sx, sy, CONFIG.missileRadius * camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = ok ? 'rgba(255, 90, 60, 0.18)' : 'rgba(255, 107, 107, 0.08)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      if (ok) {
        const [ox, oy] = camera.worldToScreen(map.x(check.silo.tile) + 0.5, map.y(check.silo.tile) + 0.5);
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.quadraticCurveTo((ox + sx) / 2, Math.min(oy, sy) - Math.hypot(sx - ox, sy - oy) * 0.25, sx, sy);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      return;
    }
    if (kind === 'fort' || kind === 'sam') {
      const lvl = check.upgrade ? check.upgrade.level + 1 : 1;
      const r = kind === 'sam' ? game.samRange?.(lvl) ?? CONFIG.samRange : game.fortRadius?.(lvl) ?? CONFIG.fortRadius;
      ctx.beginPath();
      ctx.arc(sx, sy, r * camera.zoom, 0, Math.PI * 2);
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const size = Math.max(18, this._buildingSize());
    ctx.globalAlpha = 0.9;
    drawBuildingIcon(ctx, kind, sx, sy, size, { disc: rgbToCss(human.color), ring: color });
    ctx.globalAlpha = 1;
    if (check.upgrade) {
      // Flecha de «subir de nivel»
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cost = check.cost ?? game.upgradeCost(human, check.upgrade);
      const text = check.upgrade.target
        ? 'En obras'
        : check.upgrade.level >= CONFIG.maxLevel
          ? 'Nivel máximo'
          : `▲ Nivel ${check.upgrade.level + 1} · ${formatNumber(cost)}`;
      const w = ctx.measureText(text).width + 12;
      ctx.beginPath();
      ctx.roundRect(sx - w / 2, sy - size - 14, w, 18, 9);
      ctx.fillStyle = ok ? 'rgba(24, 140, 78, 0.95)' : 'rgba(150, 40, 40, 0.95)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(text, sx, sy - size - 5);
    }
  }

  // ---------------------------------------------------------- nombres y HUD

  _drawLabels() {
    const { ctx, camera } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const human = this.game.human;
    for (const L of this.labels) {
      const p = L.player;
      const [sx, sy] = camera.worldToScreen(L.x, L.y);
      const radiusPx = L.r * camera.zoom;
      const allied = human && p !== human && human.allies.has(p.id);
      const len = Math.max(4, p.name.length + (allied ? 2 : 0));
      let size = Math.min(radiusPx * 0.8, (radiusPx * 3) / len, 42);
      // Los aliados se nombran siempre (aunque sean pequeños), con el apretón de manos
      if (allied) size = Math.max(size, Math.min(13, camera.zoom * RES * 4));
      if (size < 7) continue;
      if (sx < -200 || sy < -100 || sx > camera.viewW + 200 || sy > camera.viewH + 100) continue;
      const traitor = this.game.isTraitor(p);
      const name = traitor ? `⚠ ${p.name}` : allied ? `${p.name} 🤝` : p.name;
      const me = p === human;
      ctx.font = `${me ? 800 : 600} ${size}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, size / (me ? 4 : 5));
      ctx.strokeStyle = allied ? 'rgba(0, 50, 20, 0.75)' : me ? 'rgba(20, 12, 0, 0.85)' : 'rgba(0,0,0,0.6)';
      ctx.fillStyle = me ? this.options.nameColor || '#ffd23f' : allied ? '#b8f5cf' : traitor ? '#ffb4a8' : '#ffffff';
      ctx.strokeText(name, sx, sy - size * 0.35);
      if (me) {
        // Tu nombre, en color vivo y con un halo para encontrarlo de un vistazo
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = Math.min(16, size * 0.6);
      }
      ctx.fillText(name, sx, sy - size * 0.35);
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      if (size >= 11) {
        // Bandera (países reales) o emblema a la izquierda del nombre
        const w = ctx.measureText(name).width;
        if (!drawFlag(ctx, p.flag, sx - w / 2 - size * 0.85, sy - size * 0.35, size * 0.8)) {
          drawEmblem(ctx, emblemFor(p), sx - w / 2 - size * 0.75, sy - size * 0.35, size * 1.15);
        }
      }
      const s2 = size * 0.78;
      ctx.font = `500 ${s2}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, s2 / 5);
      const troops = formatNumber(p.troops);
      ctx.strokeText(troops, sx, sy + size * 0.6);
      ctx.fillText(troops, sx, sy + size * 0.6);
    }
  }

  /** Marca «TÚ» que flota sobre tu nación para encontrarla de un vistazo. */
  _drawYouMarker(now) {
    const { ctx, game, camera } = this;
    const human = game.human;
    if (!human || !human.alive || !human.spawned || this.options.pointer === false) return;
    const L = this.labelById.get(human.id);
    if (!L) return;
    const [sx, sy] = camera.worldToScreen(L.x, L.y);
    if (sx < -40 || sy < -60 || sx > camera.viewW + 40 || sy > camera.viewH + 40) return;
    // Por encima del nombre (si se dibuja) y con un pequeño vaivén
    const radiusPx = L.r * camera.zoom;
    const nameSize = Math.min(radiusPx * 0.8, (radiusPx * 3) / Math.max(4, human.name.length), 42);
    const lift = (nameSize >= 7 ? nameSize * 1.1 : 0) + 18 + Math.sin(now / 260) * 3;
    const x = sx;
    const y = sy - lift;
    ctx.save();
    ctx.font = '800 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = 34;
    const h = 18;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2 - 6, w, h, 9);
    ctx.moveTo(x - 5, y + 3);
    ctx.lineTo(x, y + 9);
    ctx.lineTo(x + 5, y + 3);
    ctx.fillStyle = rgbToCss(human.color);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText('TÚ', x, y - 6 + 0.5);
    ctx.restore();
  }

  /**
   * Flechas animadas en cada frente: avanzan hacia el territorio atacado.
   * Las tuyas en verde, las que te atacan en rojo; las demás (con zoom) con
   * el color del atacante.
   */
  _drawAttackArrows(now) {
    const { ctx, game, camera } = this;
    if (!game.attacks.length) return;
    const human = game.human;
    const phase = this.anim ? (now / 650) % 1 : 0.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const atk of game.attacks) {
      if (atk.done || atk.troops < 1 || !atk.targetId || !atk.inFrontier.size) continue;
      const incoming = human && atk.targetId === human.id;
      const mine = human && atk.attacker === human;
      if (!incoming && !mine && camera.zoom * RES < 2.5) continue;
      const L = this.labelById.get(atk.attacker.id);
      if (!L) continue;
      const [fx, fy] = game.attackFront(atk);
      const [sx, sy] = camera.worldToScreen(fx, fy);
      if (!this._onScreen(sx, sy, 80)) continue;
      let dx = fx - L.x;
      let dy = fy - L.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.5) continue;
      dx /= d;
      dy /= d;
      const rgb = incoming ? '255, 90, 90' : mine ? '80, 230, 140' : atk.attacker.color.join(', ');
      const s = incoming || mine ? 8 : 5.5;
      const lw = incoming || mine ? 3.2 : 2.4;
      for (let k = 0; k < 3; k++) {
        const u = (k + phase) / 3;
        const off = 14 + u * 44;
        const a = Math.sin(Math.PI * u) * (incoming || mine ? 0.95 : 0.7);
        const cx = sx + dx * off;
        const cy = sy + dy * off;
        ctx.beginPath();
        ctx.moveTo(cx - dx * s - dy * s, cy - dy * s + dx * s);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx - dx * s + dy * s, cy - dy * s - dx * s);
        ctx.strokeStyle = `rgba(0, 0, 0, ${a * 0.45})`;
        ctx.lineWidth = lw + 2;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${rgb}, ${a})`;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    }
  }

  /**
   * Marcador con las tropas en el frente de cada ataque entre el humano y otra
   * nación: rojo si le atacan, verde si ataca él.
   */
  _drawAttackBadges() {
    const { ctx, game, camera } = this;
    const human = game.human;
    if (!human || !game.attacks.length || this.options.badges === false) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 12px system-ui, sans-serif';
    for (const atk of game.attacks) {
      if (atk.done || atk.troops < 1 || !atk.targetId) continue;
      const incoming = atk.targetId === human.id;
      if (!incoming && atk.attacker !== human) continue;
      if (!atk.inFrontier.size) continue;
      const [fx, fy] = game.attackFront(atk);
      const [x, y] = camera.worldToScreen(fx, fy);
      if (x < -60 || y < -30 || x > camera.viewW + 60 || y > camera.viewH + 30) continue;
      const text = `${incoming ? '🛡' : '⚔'} ${formatNumber(atk.troops)}`;
      const w = ctx.measureText(text).width + 14;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - 10, w, 20, 10);
      ctx.fillStyle = incoming ? 'rgba(190, 40, 40, 0.92)' : 'rgba(24, 140, 78, 0.92)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = incoming ? '#ffb3b3' : '#a8f5c6';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x, y + 0.5);
    }
  }

  /** Burbujas de emoji sobre quien lo envía (solo las que implican al humano). */
  _drawEmojis() {
    const { ctx, game, camera } = this;
    if (!game.emojis.length || this.options.emojis === false) return;
    const human = game.human;
    const map = game.map;
    for (const e of game.emojis) {
      if (human && e.to !== human.id && e.from !== human.id && e.to !== 0) continue;
      const sender = game.players[e.from];
      if (!sender.alive) continue;
      const label = this.labelById.get(sender.id);
      const wx = label ? label.x : map.x(sender.spawnTile) + 0.5;
      const wy = label ? label.y : map.y(sender.spawnTile) + 0.5;
      const [sx, sy0] = camera.worldToScreen(wx, wy);
      const age = game.ticks - e.tick;
      const sy = sy0 - 34 - age * 0.4;
      ctx.globalAlpha = Math.max(0, Math.min(1, (CONFIG.emojiTicks - age) / 10));
      ctx.beginPath();
      ctx.arc(sx, sy, 17, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgbToCss(sender.color);
      ctx.stroke();
      ctx.font = '20px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';
      ctx.fillText(e.emoji, sx, sy + 1);
      ctx.globalAlpha = 1;
    }
  }

  _drawSpawnMarker(now) {
    const { ctx, game, camera } = this;
    const h = game.human;
    if (!h || !h.spawned) return;
    const map = game.map;
    const [sx, sy] = camera.worldToScreen(map.x(h.spawnTile) + 0.5, map.y(h.spawnTile) + 0.5);
    const pulse = (Math.sin(now / 200) + 1) / 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 14 + pulse * 8, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + pulse * 0.5})`;
    ctx.stroke();
  }
}
