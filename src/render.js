// Dibujo en canvas. Capas, de abajo arriba:
//   mapa (mar + tierra, una sola imagen) → territorios → destellos
//   de las casillas recién conquistadas → cráteres →
//   edificios → barcos → partículas → misiles → viñeta → nombres y marcadores.
// Barcos y misiles se interpolan entre ticks para que se muevan con suavidad.
import { BUILDINGS, CONFIG, RES, TICK_MS } from './config.js';
import { rgbToCss, shadeRgb, territoryRgb, vividRgb } from './colors.js';
import { fmtTroops, fmtTroopsCount, formatNumber, formatTroops } from './format.js';
import { PATTERN_FNS, drawBuildingReal, drawCapitalEmblem, drawCapitalFx, drawEmblem, drawFlag, drawPointIcon, emblemFor, flagReady, hasFlag } from './icons.js';
import { CAPITAL_TIERS, capitalTier } from './capital-tier.js';
import { forgetTerrain, paintTerrain } from './terreno.js';
import { MECH } from './mecanicas.js';
import { Fx, drawMissileSprite, resetFxSprites } from './fx.js';
import { drawCargo, drawFishing, drawTransport, drawWarship } from './barcos.js';
import { LUGARES } from './lugares.js';

const TAU = Math.PI * 2;
const COLONY_ALPHA = 108; // las colonias, más tenues
const FILL_ALPHA = 142; // territorio semitransparente: se ve el terreno debajo (algo menos que antes: colores más nítidos)
const LABEL_INTERVAL_MS = 500;
const FLASH_N = 16384;
const FLASH_DRAW_MAX = 3000; // destellos dibujados como mucho por fotograma (los más recientes)
const CHUNK = 64; // lado (en casillas) de los bloques del territorio que se suben a la gráfica
// Píxeles por casilla de la capa de territorio: con 2, la frontera ocupa media
// casilla (el lado que da al vecino). En mapas enormes, 1 (frontera de una casilla)
const TERRITORY_TS = 2;
// Píxeles de la capa como mucho (imagen + lienzo: 8 bytes por píxel). En el
// móvil, menos: el mundo (4,5 M de casillas) va allí a 1 píxel por casilla
const COARSE = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
const TERRITORY_MAX_PX = COARSE ? 9e6 : 2e7;
// Brillo de las casillas recién conquistadas, pintado en el propio territorio:
// fuerte al conquistar, a medias a los GLOW_MID ms y normal a los GLOW_END ms
const GLOW_N = 32768;
const GLOW_MID = [140, 110]; // combate, tierra libre
const GLOW_END = [420, 300];
const GLOW_MIX = [
  [[255, 232, 170, 0.7], [255, 214, 150, 0.32]], // combate: brasa
  [[255, 255, 255, 0.5], [255, 255, 255, 0.22]], // tierra libre (ya no se usa: no brilla)
];
const FLASH_LIFE = [700, 450, 1400]; // combate, tierra libre, arrasada (ms)
const FLASH_COLORS = [
  ['rgba(255, 240, 190, 0.9)', 'rgba(255, 160, 70, 0.6)', 'rgba(210, 70, 30, 0.32)'],
  ['rgba(255, 255, 255, 0.32)', 'rgba(255, 255, 255, 0.18)', 'rgba(255, 255, 255, 0.08)'],
  ['rgba(255, 150, 60, 0.85)', 'rgba(200, 50, 20, 0.55)', 'rgba(70, 20, 10, 0.4)'],
];
const ALLY_STRIPE = [96, 226, 140];
// Despliegue: cada nación es su zona inicial (un disco de casillas) con un
// aro de una casilla en su color y el interior teñido y translúcido
const SPAWN_R = MECH.startingRadius + 0.5;
const SPAWN_C = MECH.startingCenterOffset + 0.5;
// Placas de nombre de los bots: solo si el país se ve de este radio (px) o
// más; alejado no se ven (tú, otros jugadores y aliados, siempre)
// o con la cámara cerca (píxeles por casilla del mundo de 2000×1000)
const BOT_LABEL_R = 26;
const COLONY_LABEL_R = 30;
const BOT_LABEL_ZOOM = 6;
const COLONY_LABEL_ZOOM = 8;

const lerp = (a, b, t) => a + (b - a) * t;

// Color CSS de cada nación, calculado una vez (antes, una cadena nueva por
// barco, buque, misil y tren en cada fotograma)
const CSS_OF = new WeakMap();
const RGB_OF = new WeakMap();
function pcss(p) {
  let c = CSS_OF.get(p);
  if (!c) CSS_OF.set(p, (c = rgbToCss(p.color)));
  return c;
}
function prgb(p) {
  let c = RGB_OF.get(p);
  if (!c) RGB_OF.set(p, (c = p.color.join(', ')));
  return c;
}

/** Tren visto desde arriba apuntando en `ang`: locomotora (color del dueño) y dos vagones. */
function drawTrain(ctx, x, y, ang, L, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const h = L * 0.34;
  ctx.lineWidth = Math.max(1, L * 0.06);
  ctx.strokeStyle = 'rgba(15, 18, 24, 0.85)';
  for (const off of [-L * 0.72, -L * 1.28]) {
    ctx.beginPath();
    ctx.roundRect(off - L * 0.25, -h / 2, L * 0.5, h, h * 0.25);
    ctx.fillStyle = '#8b6a4a';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(off - L * 0.2, -h / 2 + h * 0.15, L * 0.4, h * 0.2);
  }
  ctx.beginPath();
  ctx.roundRect(-L * 0.22, -h / 2, L * 0.62, h, h * 0.35);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(-L * 0.16, -h / 2 + h * 0.18, L * 0.2, h * 0.64);
  ctx.beginPath();
  ctx.arc(L * 0.36, 0, Math.max(1, h * 0.18), 0, Math.PI * 2);
  ctx.fillStyle = '#ffe48a';
  ctx.fill();
  ctx.restore();
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** '#rrggbb' → [r, g, b]. */
function hexRgb(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Empaqueta RGBA en un uint32 (little-endian, como ImageData en la práctica). */
const pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
// Frente de combate (doc-1.6): rojo intenso si es tuyo, algo más apagado si es de otros
const HOT_MINE = pack(245, 38, 32, 255);
const HOT_OTHER = pack(214, 52, 44, 235);

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
    this.baseCanvas = terrain.base; // mar + tierra, opaco
    this.baseScale = terrain.scale;
    this._vignette = null;

    this.ts = size * TERRITORY_TS * TERRITORY_TS <= TERRITORY_MAX_PX ? TERRITORY_TS : 1;
    this.territoryCanvas = makeCanvas(width * this.ts, height * this.ts);
    this.tctx = this.territoryCanvas.getContext('2d');
    this.image = this.tctx.createImageData(width * this.ts, height * this.ts);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this._buildPalette();
    this.diploVersion = game.diploVersion;
    game.trackDirty = true;
    game.dirty.length = 0;
    this.prevOwner = Uint16Array.from(game.owner);
    // Subida a la tarjeta gráfica por bloques: solo los que cambiaron
    this._cw = Math.ceil(width / CHUNK);
    this._chunkDirty = new Uint8Array(this._cw * Math.ceil(height / CHUNK));
    this._chunkList = [];
    this._allySig = this._allySignature();
    this._spawnStyle = game.phase === 'spawn';
    this._paintAllTerritory();
    // Si el navegador descarta el contenido de los lienzos, se rehacen (ver restoreCanvases)
    this._lost = false;
    this._needRestore = false;
    this._lostCheckAt = 0;
    this.restores = 0;
    this._onLost = () => {
      this._lost = true;
    };
    this._onRestored = () => {
      this._lost = false;
      this._needRestore = true;
    };
    for (const c of [canvas, this.territoryCanvas, this.baseCanvas]) this._watchCanvas(c);

    // Destellos de casillas que cambian de dueño (cola circular)
    this._flash = { t: new Int32Array(FLASH_N), at: new Float64Array(FLASH_N), k: new Uint8Array(FLASH_N), head: 0, n: 0 };
    // Cola de brillos (en orden de tiempo): `mid` y `end` son los siguientes por atenuar y por apagar
    this._glow = { t: new Int32Array(GLOW_N), o: new Uint16Array(GLOW_N), at: new Float64Array(GLOW_N), k: new Uint8Array(GLOW_N), head: 0, mid: 0, end: 0 };
    this._buckets = Array.from({ length: 9 }, () => []);
    this._battleTmp = [];
    this._wildTmp = [];

    this.fx = new Fx();
    this._units = new WeakMap();
    this._seenFx = new WeakSet();
    for (const e of game.effects) this._seenFx.add(e);
    this._boats = new Map();
    this._trailBoxes = new Map(); // recuadro de la ruta de cada barco (para no dibujar las estelas fuera de la pantalla)
    this._ships = new Map();
    this._attackFronts = new WeakMap();
    this._merch = new Map();
    this._missiles = new Map();
    this._gen = 0;
    this._tick = game.ticks;
    this._tickAt = 0;
    this._tickDur = TICK_MS;
    this._frac = 1;
    this._fracEarly = 1;
    this._runN = 0;
    this._smooth = new WeakMap(); // cifras que suben poco a poco entre turnos
    this._dt = 0;
    this._lastNow = 0;
    this._trailAcc = 0;
    this.view = { x0: 0, y0: 0, x1: width, y1: height };

    this.distField = null;
    this.labels = [];
    this.labelById = new Map();
    this.exclaves = []; // trozos sueltos de cada nación (con su bandera)
    this.lastLabelTime = -Infinity;
    this.highlightTile = -1;
    this.options = { badges: true, emojis: true, pointer: true, animations: true };
  }

  setDpr(dpr) {
    this.dpr = dpr;
    this._vignette = null;
  }

  /** Escucha si el navegador pierde (y recupera) el contexto de dibujo de un lienzo. */
  _watchCanvas(c) {
    if (!c || !c.addEventListener) return;
    c.addEventListener('contextlost', this._onLost);
    c.addEventListener('contextrestored', this._onRestored);
  }

  /**
   * ¿Se perdió el contenido de los lienzos? Chrome en Android (con poca
   * memoria, o al volver de otra app) puede tirar el contexto de dibujo: el
   * mapa y el territorio se quedaban en blanco para el resto de la partida
   * (solo volvían los trozos de territorio que cambiaban). Cuando el contexto
   * vuelve, se rehace todo. Además de los eventos, se mira cada ~2 s y al
   * volver a la pestaña.
   */
  checkCanvases() {
    let lost = false;
    try {
      lost = !!(this.ctx.isContextLost?.() || this.tctx.isContextLost?.() || this.baseCanvas.getContext('2d').isContextLost?.());
    } catch {
      lost = false;
    }
    if (lost) this._lost = true;
    else if (this._lost) {
      this._lost = false;
      this._needRestore = true;
    }
    return lost;
  }

  /**
   * Suelta la memoria de esta partida al empezar otra o volver al menú: la
   * capa del territorio (imagen y lienzo: en el mundo, 36-144 MB), sus copias
   * y cachés. El mapa base no (lo guarda terreno.js para la próxima partida en
   * el mismo mapa). Deja de escuchar al lienzo principal, que sigue en uso.
   */
  dispose() {
    for (const c of [this.canvas, this.territoryCanvas, this.baseCanvas]) {
      c?.removeEventListener?.('contextlost', this._onLost);
      c?.removeEventListener?.('contextrestored', this._onRestored);
    }
    if (this.territoryCanvas) {
      // Ancho 0: el navegador suelta su memoria (también la de la tarjeta gráfica)
      this.territoryCanvas.width = 0;
      this.territoryCanvas.height = 0;
    }
    for (const m of Object.values(this._mips || {})) {
      m.width = 0;
      m.height = 0;
    }
    this.territoryCanvas = null;
    this.tctx = null;
    this.image = null;
    this.pixels = null;
    this.prevOwner = null;
    this._queued = null;
    this._mips = null;
    this._spawnMaskCanvas = null;
    this._lbOwner = null;
    this.distField = null;
    this._sprites?.clear();
    this._labelSprites?.clear();
    this._ensigns?.clear();
    this._digitFonts?.clear();
    this.labels = [];
    this.labelById.clear();
    this.exclaves = [];
    this._exComp = this._exQueue = null;
    this.hot = null;
    this._hotList = null;
    this.onRestored = null;
    this.disposed = true;
  }

  /** Sube otra vez el territorio entero desde sus píxeles (barato: no hay que pintarlo). */
  refreshTerritory() {
    this.tctx.putImageData(this.image, 0, 0);
    for (const c of this._chunkList) this._chunkDirty[c] = 0;
    this._chunkList.length = 0;
  }

  /**
   * Vuelve a dibujar lo que vive en lienzos auxiliares: el mapa (terreno, sin
   * la copia guardada) y sus copias reducidas, el territorio (sus píxeles
   * siguen en memoria), la sombra del despliegue, la viñeta y las imágenes ya
   * dibujadas (nombres, cifras, edificios, efectos). `onRestored` avisa al
   * resto (minimapa e iconos del panel).
   */
  restoreCanvases() {
    this._needRestore = false;
    this._lost = false;
    forgetTerrain();
    const terrain = paintTerrain(this.game.map);
    if (terrain.base !== this.baseCanvas) this._watchCanvas(terrain.base);
    this.baseCanvas = terrain.base;
    this.baseScale = terrain.scale;
    this._mips = null;
    this.tctx.putImageData(this.image, 0, 0);
    for (const c of this._chunkList) this._chunkDirty[c] = 0;
    this._chunkList.length = 0;
    this._spawnMaskCanvas = null;
    this._vignette = null;
    this._youKey = null;
    this._sprites?.clear();
    this._labelSprites?.clear();
    this._ensigns?.clear();
    this._digitFonts?.clear();
    resetFxSprites();
    this.restores++;
    this.onRestored?.();
  }

  get anim() {
    return this.options.animations !== false;
  }

  _buildPalette() {
    const n = this.game.players.length;
    this.fill = new Uint32Array(n);
    this.inner = new Uint32Array(n);
    this.alt = new Uint32Array(n);
    this.border = new Uint32Array(n); // frontera: media casilla, opaca
    this.border2 = new Uint32Array(n); // mitad interior de la frontera: solo la tuya (resaltado)
    this.ring2 = new Uint8Array(n);
    this.patterns = new Array(n).fill(null);
    this.allied = new Uint8Array(n);
    this.glowCol = GLOW_MIX.map(() => [new Uint32Array(n), new Uint32Array(n)]);
    this.spawnFill = new Uint32Array(n);
    this.spawnEdge = new Uint32Array(n);
    const human = this.game.human;
    for (const p of this.game.players) {
      if (!p) continue;
      // Relleno: el color de la nación algo apagado y semitransparente (se ve
      // el terreno debajo). Frontera fina y opaca en el mismo tono, más oscuro
      // y algo más vivo (antes, gris: dos vecinas parecidas se confundían)
      const pale = territoryRgb(p.color);
      const [r, g, b] = pale;
      const ally = !!(human && p !== human && human.allies.has(p.id));
      this.allied[p.id] = ally ? 1 : 0;
      // Las colonias, más tenues y con frontera suave: el mapa se lee más
      // limpio y destacan las naciones
      this.fill[p.id] = pack(r, g, b, p.weak ? COLONY_ALPHA : FILL_ALPHA);
      this.inner[p.id] = this.fill[p.id]; // sin franja interior: el territorio es plano
      // Patrón del perfil: algunas casillas con un tono más oscuro.
      // Los aliados llevan franjas verdes en diagonal: se reconocen de un vistazo.
      this.patterns[p.id] = PATTERN_FNS[p.pattern] || null;
      const [ar, ag, ab] = ally ? ALLY_STRIPE : shadeRgb(pale, 0.8);
      this.alt[p.id] = pack(ar, ag, ab, ally ? 215 : Math.min(255, FILL_ALPHA + 40));
      // Frontera blanca para ti y verde para tus aliados; las demás, su tono
      // pálido más oscuro
      const bc = p === human ? [255, 255, 255] : ally ? [120, 245, 165] : p.weak ? shadeRgb(pale, 0.74) : vividRgb(pale, 0.12, 0.6, 0.16, 0.46);
      this.border[p.id] = pack(bc[0], bc[1], bc[2], 255);
      // Tu nación, resaltada: por dentro de la frontera blanca, otra media
      // casilla en tu color vivo
      if (p === human) {
        const b2 = vividRgb(p.color, 0.1, 1.12, 0.36, 0.72);
        this.border2[p.id] = pack(b2[0], b2[1], b2[2], 210);
        this.ring2[p.id] = 1;
      }
      // Despliegue: interior del color de la nación, translúcido, y aro opaco
      const sf = vividRgb(p.color, 0.06, 1, 0.36, 0.64);
      const se = p === human ? vividRgb(p.color, 0.2, 1.05, 0.3, 0.62) : vividRgb(p.color, 0.12, 0.8, 0.24, 0.52);
      this.spawnFill[p.id] = pack(sf[0], sf[1], sf[2], 150);
      this.spawnEdge[p.id] = pack(se[0], se[1], se[2], 255);
      GLOW_MIX.forEach((stages, kind) => stages.forEach(([gr, gg, gb, m], st) => {
        this.glowCol[kind][st][p.id] = pack(Math.round(lerp(r, gr, m)), Math.round(lerp(g, gg, m)), Math.round(lerp(b, gb, m)), 235);
      }));
    }
  }

  /** Pinta los TS×TS píxeles de la casilla `i` de un solo color. */
  _setTile(i, color) {
    const ts = this.ts;
    const P = this.pixels;
    if (ts === 1) {
      P[i] = color;
      return;
    }
    const W = this.game.map.width;
    const PW = W * 2;
    const k = ((i / W) | 0) * 2 * PW + (i % W) * 2;
    P[k] = color;
    P[k + 1] = color;
    P[k + PW] = color;
    P[k + PW + 1] = color;
  }

  /**
   * Pinta la casilla `i` según el dueño que se muestra ahora (puede ir unos
   * milisegundos por detrás de la simulación mientras se revela el último
   * turno). Con 2 píxeles por casilla, la frontera solo ocupa los píxeles que
   * dan al vecino de otro dueño (también en diagonal, para cerrar las
   * esquinas): media casilla. La tuya: mitad exterior blanca y mitad interior
   * en tu color.
   */
  /** ¿Toca la casilla `i` (del dueño `o`) a otro dueño o el borde del mapa? */
  _isEdge(i, o) {
    const s = this.prevOwner;
    const W = this.game.map.width;
    const x = i % W;
    return x === 0 || x === W - 1 || i < W || i >= s.length - W || s[i - 1] !== o || s[i + 1] !== o || s[i - W] !== o || s[i + W] !== o;
  }

  _paintTile(i) {
    const s = this.prevOwner;
    const o = s[i];
    if (!o) {
      this._setTile(i, 0);
      return;
    }
    const W = this.game.map.width;
    const x = i % W;
    const y = (i / W) | 0;
    // En un frente de combate: roja entera (ver _updateHot)
    const hv = this.hot ? this.hot[i] & 3 : 0;
    if (hv) {
      this._setTile(i, hv === 2 ? HOT_MINE : HOT_OTHER);
      return;
    }
    if (this._spawnStyle) {
      // Aro de una casilla entera (la que toca a otro por un lado) e interior teñido
      const inner = x > 0 && x < W - 1 && s[i - 1] === o && s[i + 1] === o && s[i - W] === o && s[i + W] === o;
      this._setTile(i, inner ? this.spawnFill[o] : this.spawnEdge[o]);
      return;
    }
    let col;
    if (this.allied[o]) col = (x + y) % 7 < 2 ? this.alt[o] : this.fill[o];
    else {
      const pattern = this.patterns[o];
      col = pattern && pattern(x, y) ? this.alt[o] : this.fill[o];
    }
    // ¿Es del mismo dueño el vecino de cada lado? (fuera del mapa: no)
    const l = x > 0 && s[i - 1] === o;
    const r = x < W - 1 && s[i + 1] === o;
    const u = i >= W && s[i - W] === o;
    const d = i < s.length - W && s[i + W] === o;
    const P = this.pixels;
    if (this.ts === 1) {
      if (!(l && r && u && d)) P[i] = this.border[o];
      // Tu nación: la casilla de dentro de la frontera, en tu color
      else if (this.ring2[o] && (this._isEdge(i - 1, o) || this._isEdge(i + 1, o) || this._isEdge(i - W, o) || this._isEdge(i + W, o))) P[i] = this.border2[o];
      else P[i] = col;
      return;
    }
    const ul = l && u && s[i - W - 1] === o;
    const ur = r && u && s[i - W + 1] === o;
    const dl = l && d && s[i + W - 1] === o;
    const dr = r && d && s[i + W + 1] === o;
    const edge = this.border[o];
    const inside = this.ring2[o] && !(ul && ur && dl && dr) ? this.border2[o] : col;
    const PW = W * 2;
    const k = y * 2 * PW + x * 2;
    P[k] = ul ? inside : edge;
    P[k + 1] = ur ? inside : edge;
    P[k + PW] = dl ? inside : edge;
    P[k + PW + 1] = dr ? inside : edge;
  }

  /** Repinta una casilla (si existe) y marca su bloque para subirlo. */
  _repaint(i) {
    if (i < 0 || i >= this.prevOwner.length) return;
    this._paintTile(i);
    const w = this.game.map.width;
    this._markChunk(i % w, (i / w) | 0);
  }

  /**
   * Una nación (no colonia) acaba de caer: donde estaba su nombre, una onda
   * oscura y su nombre que sube y se desvanece.
   */
  _eliminations() {
    const seen = (this._aliveNations ??= new Set());
    const human = this.game.human;
    for (const p of this.game.players) {
      if (!p || p.weak) continue;
      if (p.alive && p.tiles > 0) {
        seen.add(p.id);
        continue;
      }
      if (!seen.has(p.id)) continue;
      seen.delete(p.id);
      const L = this.labelById.get(p.id);
      if (!L || !this.anim || !this._inView(L.x, L.y, 20)) continue;
      this.fx.add({ x: L.x, y: L.y, life: 1.1, s0: 0.5, s1: 9 * RES, min: 8, ring: true, color: 'rgba(30, 24, 20, 0.7)', lw: 0.6 });
      this.fx.label(L.x, L.y, `✝ ${p.name}`, p === human ? 'rgba(255, 120, 120, 0.95)' : 'rgba(255, 236, 214, 0.95)', 15, 2.4);
    }
  }

  /**
   * Sombra de las tierras donde no se puede empezar (islas pequeñas), a
   * media resolución; se hace una vez y se suelta al acabar el despliegue.
   */
  _spawnMask() {
    if (this._spawnMaskCanvas) return this._spawnMaskCanvas;
    if (this._spawnMaskCanvas === false) return null;
    const map = this.game.map;
    const W = Math.ceil(map.width / 2);
    const H = Math.ceil(map.height / 2);
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const px = new Uint32Array(img.data.buffer);
    const shade = pack(10, 16, 30, 150);
    const min = CONFIG.minSpawnBodySize;
    let any = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = Math.min(map.height - 1, y * 2) * map.width + Math.min(map.width - 1, x * 2);
        if (map.isLand(t) && map.landBodySizes[map.landBody[t]] < min) {
          px[y * W + x] = shade;
          any = true;
        }
      }
    }
    g.putImageData(img, 0, 0);
    this._spawnMaskCanvas = any ? c : false;
    return any ? c : null;
  }

  /**
   * Imagen del mapa (mar + tierra) adecuada para `z` píxeles por casilla: la
   * original o una copia a 1/2 o 1/4, hecha la primera vez que hace falta.
   * Devuelve [imagen, píxeles de la imagen por casilla].
   */
  _baseFor(z) {
    const S = this.baseScale;
    // A menos de ~0,7 píxeles por casilla la copia a la mitad se ve igual y pesa 4 veces menos
    const want = z < S * 0.3 ? 4 : z < S * 0.7 ? 2 : 1;
    if (want === 1) return [this.baseCanvas, S];
    return [this._mip(want), S / want];
  }

  /** Copia del mapa a 1/`f` (f = 2 o 4; la de 1/4 sale de la de 1/2). */
  _mip(f) {
    this._mips ??= {};
    let m = this._mips[f];
    if (!m) {
      const src = f === 4 ? this._mip(2) : this.baseCanvas;
      m = makeCanvas(Math.max(1, Math.round(src.width / 2)), Math.max(1, Math.round(src.height / 2)));
      const c = m.getContext('2d');
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(src, 0, 0, m.width, m.height);
      this._mips[f] = m;
    }
    return m;
  }

  /** Aliados del humano en una cadena: si no cambia, el territorio tampoco. */
  _allySignature() {
    const h = this.game.human;
    return h ? [...h.allies].sort((a, b) => a - b).join(',') : '';
  }

  /** Marca el bloque de la casilla (x, y) para subirlo en este fotograma. */
  _markChunk(x, y) {
    const c = ((y / CHUNK) | 0) * this._cw + ((x / CHUNK) | 0);
    if (!this._chunkDirty[c]) {
      this._chunkDirty[c] = 1;
      this._chunkList.push(c);
    }
  }

  /**
   * Termina el despliegue: las zonas iniciales pasan del estilo de disco
   * (aro de su color) al territorio normal. Solo se repintan las casillas con
   * dueño (y sus bloques se suben a medida que se ven).
   */
  _endSpawnStyle() {
    this._spawnStyle = false;
    const s = this.prevOwner;
    const W = this.game.map.width;
    for (let i = 0; i < s.length; i++) {
      if (!s[i]) continue;
      this._paintTile(i);
      this._markChunk(i % W, (i / W) | 0);
    }
  }

  /** Repinta las casillas de los dueños marcados en `mask` (sus bloques se suben a medida que se ven). */
  _repaintOwners(mask) {
    const s = this.prevOwner;
    const W = this.game.map.width;
    for (let i = 0; i < s.length; i++) {
      if (!mask[s[i]]) continue;
      this._paintTile(i);
      this._markChunk(i % W, (i / W) | 0);
    }
  }

  /** Todo el territorio de una vez (al empezar o si cambian tus alianzas). */
  _paintAllTerritory() {
    const N = this.prevOwner.length;
    for (let i = 0; i < N; i++) this._paintTile(i);
    this.tctx.putImageData(this.image, 0, 0);
  }

  _inView(x, y, margin = 0) {
    const v = this.view;
    return x >= v.x0 - margin && y >= v.y0 - margin && x <= v.x1 + margin && y <= v.y1 + margin;
  }

  /**
   * Territorio que cambió. La simulación avanza a saltos (10 turnos por
   * segundo): si se pintara todo lo conquistado en un turno de golpe, el
   * avance se vería a tirones. Así que lo de cada turno se pone en cola y se
   * va mostrando poco a poco hasta el turno siguiente, en el orden en que se
   * conquistó y a la vez en todos los frentes.
   */
  _flushDirty(now) {
    const game = this.game;
    const dirty = game.dirty;
    if (game.dirtyOverflow) {
      // Demasiados cambios sin dibujar (pestaña oculta en una sala): todo de una vez
      game.dirtyOverflow = false;
      dirty.length = 0;
      this._runN = 0;
      this._queued?.fill(0);
      this.prevOwner.set(game.owner);
      this._paintAllTerritory();
      return;
    }
    if (dirty.length) {
      // Turno nuevo: primero se termina de mostrar el anterior
      this._reveal(1, now);
      this._queueChanges(dirty);
      dirty.length = 0;
    }
    // En el despliegue, al momento (cambiar de sitio no es una conquista)
    if (this._runN) this._reveal(this.anim && game.phase !== 'spawn' ? this._fracEarly : 1, now);
  }

  /** Mete en la cola las casillas que han cambiado de dueño, agrupadas por tramos del mismo conquistador. */
  _queueChanges(dirty) {
    const owner = this.game.owner;
    const shown = this.prevOwner;
    const size = shown.length;
    if (!this._queued) {
      this._queued = new Uint8Array(size);
      this._q = new Int32Array(1024);
      this._runA = new Int32Array(64); // inicio del tramo en la cola
      this._runB = new Int32Array(64); // fin
      this._runD = new Int32Array(64); // cuántas ya mostradas
    }
    let n = 0;
    let runs = 0;
    let lastOwner = -1;
    for (let k = 0; k < dirty.length; k++) {
      const t = dirty[k];
      const o = owner[t];
      if (o === shown[t] || this._queued[t]) continue;
      this._queued[t] = 1;
      if (n >= this._q.length) {
        const q = new Int32Array(this._q.length * 2);
        q.set(this._q);
        this._q = q;
      }
      if (o !== lastOwner) {
        if (runs) this._runB[runs - 1] = n;
        if (runs >= this._runA.length) {
          for (const key of ['_runA', '_runB', '_runD']) {
            const a = new Int32Array(this[key].length * 2);
            a.set(this[key]);
            this[key] = a;
          }
        }
        this._runA[runs] = n;
        this._runD[runs] = 0;
        runs++;
        lastOwner = o;
      }
      this._q[n++] = t;
    }
    if (runs) this._runB[runs - 1] = n;
    this._runN = runs;
    this._qN = n;
  }

  /** Muestra la fracción `f` (0-1) de lo que hay en cola, por igual en cada tramo. */
  _reveal(f, now) {
    const runs = this._runN;
    if (!runs) return;
    const owner = this.game.owner;
    const shown = this.prevOwner;
    const W = this.game.map.width;
    const battles = this._battleTmp;
    const wild = this._wildTmp;
    battles.length = 0;
    wild.length = 0;
    const watch = this.anim && this.camera.zoom * RES >= 1.2;
    const glowFrom = this._glow.head;
    // El brillo solo se ve con casillas de más de un píxel y dentro de la pantalla
    const glowOn = this.anim && this.camera.zoom * this.dpr >= 1.2;
    const q = this._q;
    let pending = 0;
    for (let r = 0; r < runs; r++) {
      const a = this._runA[r];
      const len = this._runB[r] - a;
      const target = f >= 1 ? len : Math.min(len, Math.ceil(len * f));
      for (let k = this._runD[r]; k < target; k++) {
        const t = q[a + k];
        this._queued[t] = 0;
        const o = owner[t];
        const was = shown[t];
        if (o === was) continue;
        shown[t] = o;
        // La casilla y sus 8 vecinas: la frontera de cada una depende de las
        // de alrededor (también en diagonal, por las esquinas)
        this._repaint(t);
        this._repaint(t - 1);
        this._repaint(t + 1);
        this._repaint(t - W);
        this._repaint(t + W);
        this._repaint(t - W - 1);
        this._repaint(t - W + 1);
        this._repaint(t + W - 1);
        this._repaint(t + W + 1);
        if (this.ts === 1) {
          // A 1 píxel por casilla tu frontera lleva una segunda franja: también
          // cambian las casillas a dos de distancia
          this._repaint(t - 2);
          this._repaint(t + 2);
          this._repaint(t - 2 * W);
          this._repaint(t + 2 * W);
        }
        const x = t % W;
        const y = (t / W) | 0;
        const kind = was && o ? 0 : o ? 1 : 2;
        // Brillo solo al ganar terreno en combate. En tierra libre no: al
        // empezar crecen cientos de países a la vez y, siendo aún pequeños, el
        // anillo brillante cubría casi todo el país y latía en cada turno
        if (kind === 0) {
          if (glowOn && this._inView(x, y, 2)) this._pushGlow(t, o, now, kind);
        } else if (kind === 2 && this.game.phase !== 'spawn') this._pushFlash(t, now, kind);
        if (watch && kind < 2 && this._inView(x, y, 2)) (kind === 0 ? battles : wild).push(t);
      }
      this._runD[r] = Math.max(this._runD[r], target);
      pending += len - this._runD[r];
    }
    if (!pending) this._runN = 0;
    // El brillo se pinta al final: así no lo pisa el repintado de los vecinos
    const g = this._glow;
    for (let j = glowFrom; j !== g.head; j = (j + 1) % GLOW_N) {
      const t = g.t[j];
      if (shown[t] === g.o[j]) this._setTile(t, this.glowCol[g.k[j]][0][g.o[j]]);
    }
    if (!watch) return;
    // Solo una muestra: suficiente para que el frente «hierva» sin saturar
    // (el cupo es por turno; aquí se reparte entre los fotogramas)
    const share = Math.min(1, (this._dt * 1000) / this._tickDur);
    const fx = this.fx;
    if (battles.length) {
      const p = Math.min(0.6, (9 * share) / battles.length);
      for (const t of battles) {
        if (Math.random() < p) fx.skirmish((t % W) + 0.5, ((t / W) | 0) + 0.5, Math.random() < 0.15);
      }
    }
    if (wild.length && this.camera.zoom * RES >= 2) {
      const p = Math.min(0.15, (2 * share) / wild.length);
      for (const t of wild) if (Math.random() < p) fx.dust((t % W) + 0.5, ((t / W) | 0) + 0.5);
    }
  }

  /** Añade una casilla a la cola de brillos (si está llena, apaga antes la más vieja). */
  _pushGlow(t, o, now, kind) {
    const g = this._glow;
    const next = (g.head + 1) % GLOW_N;
    if (next === g.end) this._glowStep(g.end, 2);
    g.t[g.head] = t;
    g.o[g.head] = o;
    g.at[g.head] = now;
    g.k[g.head] = kind;
    g.head = next;
  }

  /** Pasa una casilla de la cola al brillo a medias (stage 1) o a su color normal (2). */
  _glowStep(j, stage) {
    const g = this._glow;
    const t = g.t[j];
    if (this.prevOwner[t] === g.o[j]) {
      if (stage === 1) this._setTile(t, this.glowCol[g.k[j]][1][g.o[j]]);
      else this._paintTile(t);
      const W = this.game.map.width;
      this._markChunk(t % W, (t / W) | 0);
    }
    const after = (j + 1) % GLOW_N;
    if (stage === 1) g.mid = after;
    else {
      if (g.mid === j) g.mid = after; // apagada antes de atenuarse (cola llena)
      g.end = after;
    }
  }

  /** Atenúa y apaga los brillos que tocan; luego sube los bloques cambiados. */
  _updateGlowsAndUpload(now) {
    const g = this._glow;
    while (g.mid !== g.head && now - g.at[g.mid] >= GLOW_MID[g.k[g.mid]]) this._glowStep(g.mid, 1);
    while (g.end !== g.mid && now - g.at[g.end] >= GLOW_END[g.k[g.end]]) this._glowStep(g.end, 2);
    if (!this._chunkList.length) return;
    // Solo se suben a la tarjeta gráfica los bloques que cambiaron (con países
    // creciendo por todo el mapa, un único rectángulo acababa siendo el mapa entero)
    // Los que están fuera de la pantalla esperan a verse
    const W = this.game.map.width;
    const H = this.game.map.height;
    const v = this.view;
    const list = this._chunkList;
    let keep = 0;
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      const bx = (c % this._cw) * CHUNK;
      const by = ((c / this._cw) | 0) * CHUNK;
      if (bx > v.x1 + 2 || by > v.y1 + 2 || bx + CHUNK < v.x0 - 2 || by + CHUNK < v.y0 - 2) {
        list[keep++] = c;
        continue;
      }
      this._chunkDirty[c] = 0;
      const ts = this.ts;
      this.tctx.putImageData(this.image, 0, 0, bx * ts, by * ts, Math.min(CHUNK, W - bx) * ts, Math.min(CHUNK, H - by) * ts);
    }
    list.length = keep;
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
    // Con el mapa muy alejado una casilla mide menos de un píxel: no se verían
    if (this.camera.zoom * this.dpr < 1) return;
    const W = this.game.map.width;
    const buckets = this._buckets;
    for (const b of buckets) b.length = 0;
    const maxLife = Math.max(...FLASH_LIFE);
    let any = false;
    let drawn = 0;
    for (let j = 0; j < f.n && drawn < FLASH_DRAW_MAX; j++) {
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
      drawn++;
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
   * tamaño de letra. Todo de una vez (ver _labelStage para el reparto).
   */
  _updateLabels() {
    for (let k = 0; k < 4; k++) this._labelStage(k);
  }

  /**
   * El cálculo de los nombres en tres trozos, uno por fotograma (en el mundo
   * son medio millón de celdas: de una vez daba un tirón cada medio segundo
   * en equipos lentos). 0: copia de los dueños y bordes; 1: pasada de ida;
   * 2: pasada de vuelta y nombres. Trabaja sobre la copia del paso 0.
   */
  _labelStage(stage) {
    const { owner, players, map } = this.game;
    // Basta una rejilla basta (F×F casillas por celda): el nombre solo necesita
    // una posición aproximada y así el cálculo no da tirones
    const F = Math.max(1, RES);
    const MW = map.width;
    const W = Math.ceil(MW / F);
    const H = Math.ceil(map.height / F);
    const n = W * H;
    if (!this._lbOwner || this._lbOwner.length !== n) {
      this._lbOwner = new Uint16Array(n);
      this.distField = new Uint16Array(n);
    }
    const own = this._lbOwner;
    const d = this.distField;
    if (stage === 3) {
      this._findExclaves(W, H, F);
      return;
    }
    if (stage === 0) {
      this._eliminations();
      const half = F >> 1;
      let cols = this._lbCols;
      if (!cols || cols.length !== W) {
        cols = this._lbCols = new Int32Array(W);
        for (let x = 0; x < W; x++) cols[x] = Math.min(MW - 1, x * F + half);
      }
      for (let y = 0; y < H; y++) {
        const sy = Math.min(map.height - 1, y * F + half) * MW;
        const row = y * W;
        for (let x = 0; x < W; x++) own[row + x] = owner[sy + cols[x]];
      }
      for (let y = 0; y < H; y++) {
        const row = y * W;
        const rim = y === 0 || y === H - 1;
        for (let x = 0; x < W; x++) {
          const i = row + x;
          const o = own[i];
          if (!o) {
            d[i] = 0;
            continue;
          }
          const edge = rim || x === 0 || x === W - 1 || own[i - 1] !== o || own[i + 1] !== o || own[i - W] !== o || own[i + W] !== o;
          d[i] = edge ? 1 : 65535;
        }
      }
      return;
    }
    if (stage === 1) {
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
      return;
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
    for (let i = 0; i < n; i++) {
      const o = own[i];
      if (o && d[i] > best[o]) {
        best[o] = d[i];
        at[o] = i;
      }
    }
    this.labels = [];
    // El nombre no salta a su sitio nuevo: se desliza (ver _glideLabels)
    const old = (this._oldLabels ??= new Map());
    old.clear();
    for (const [id, L] of this.labelById) old.set(id, L);
    this.labelById.clear();
    // Los nombres ya dibujados de los eliminados, fuera (antes se guardaban
    // todos hasta el final: cientos de lienzos pequeños)
    if (this._labelSprites) for (const id of this._labelSprites.keys()) if (!players[id]?.alive) this._labelSprites.delete(id);
    const spawn = this.game.phase === 'spawn';
    for (const p of players) {
      if (!p || !p.alive || at[p.id] < 0) continue;
      let tx = (at[p.id] % W) * F + F / 2;
      let ty = Math.floor(at[p.id] / W) * F + F / 2;
      let tr = best[p.id] * F;
      // En el despliegue, en el centro de su círculo
      if (spawn && p.spawned && p.spawnTile >= 0) {
        tx = map.x(p.spawnTile) + SPAWN_C;
        ty = map.y(p.spawnTile) + SPAWN_C;
        tr = SPAWN_R;
      }
      const prev = old.get(p.id);
      // Si el sitio nuevo queda lejos (otro trozo del país), va directo
      const near = prev && Math.abs(prev.x - tx) + Math.abs(prev.y - ty) < Math.max(40, tr * 3);
      // También su opacidad y si estaba a la vista: antes cada nombre volvía a
      // aparecer desde transparente dos veces por segundo (parpadeaban todos)
      const L = near
        ? { player: p, tx, ty, tr, x: prev.x, y: prev.y, r: prev.r, alpha: prev.alpha, shown: prev.shown, s2: prev.s2 }
        : { player: p, tx, ty, tr, x: tx, y: ty, r: tr, alpha: 0, shown: false, s2: 0 };
      this.labels.push(L);
      this.labelById.set(p.id, L);
    }
  }

  /**
   * Trozos sueltos de cada nación (un enclave, una isla, lo que queda al otro
   * lado de un río): llevan su bandera para saber de quién son. Sobre la
   * rejilla de los nombres (ya con la distancia a la frontera), tomando una
   * celda de cada 2×2: así es un recorrido rápido, en su propio fotograma.
   * El trozo principal (donde va el nombre) no cuenta.
   */
  _findExclaves(W, H, F) {
    const out = [];
    this.exclaves = out;
    if (this.game.phase === 'spawn') return;
    const own = this._lbOwner;
    const d = this.distField;
    const W2 = Math.ceil(W / 2);
    const H2 = Math.ceil(H / 2);
    const n2 = W2 * H2;
    if (!this._exComp || this._exComp.length !== n2) {
      this._exComp = new Int32Array(n2);
      this._exQueue = new Int32Array(n2);
    }
    const comp = this._exComp.fill(-1);
    const queue = this._exQueue;
    const players = this.game.players;
    // Por dueño, sus trozos: [celda con más distancia a la frontera, esa distancia, tamaño]
    const pieces = new Map();
    let id = 0;
    for (let c = 0; c < n2; c++) {
      if (comp[c] >= 0) continue;
      const cx = c % W2;
      const cy = (c / W2) | 0;
      const o = own[cy * 2 * W + cx * 2];
      if (!o) continue;
      const p = players[o];
      if (!p || !p.alive || p.weak) {
        comp[c] = -2;
        continue;
      }
      let head = 0;
      let tail = 0;
      queue[tail++] = c;
      comp[c] = id;
      let bestD = 0;
      let bestCell = -1;
      let size = 0;
      while (head < tail) {
        const k = queue[head++];
        size++;
        const kx = k % W2;
        const ky = (k / W2) | 0;
        const fine = ky * 2 * W + kx * 2;
        if (d[fine] > bestD) {
          bestD = d[fine];
          bestCell = fine;
        }
        if (kx > 0 && comp[k - 1] < 0 && own[fine - 2] === o) (comp[k - 1] = id), (queue[tail++] = k - 1);
        if (kx < W2 - 1 && comp[k + 1] < 0 && own[fine + 2] === o) (comp[k + 1] = id), (queue[tail++] = k + 1);
        if (ky > 0 && comp[k - W2] < 0 && own[fine - 2 * W] === o) (comp[k - W2] = id), (queue[tail++] = k - W2);
        if (ky < H2 - 1 && comp[k + W2] < 0 && own[fine + 2 * W] === o) (comp[k + W2] = id), (queue[tail++] = k + W2);
      }
      id++;
      let list = pieces.get(o);
      if (!list) pieces.set(o, (list = []));
      list.push([bestCell, bestD, size]);
    }
    for (const [o, list] of pieces) {
      if (list.length < 2) continue;
      // El más grande lleva el nombre; los demás (como mucho 8, los mayores), su bandera
      list.sort((a, b) => b[2] - a[2]);
      for (let i = 1; i < list.length && i <= 8; i++) {
        const [cell, bd, size] = list[i];
        if (size < 3 || bd < 2 || cell < 0) continue;
        out.push({ player: players[o], x: (cell % W) * F + F / 2, y: Math.floor(cell / W) * F + F / 2, r: bd * F });
      }
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
      // Duración real de un turno (en multijugador no es siempre la misma):
      // con ella se reparte lo que pasa en el turno entre los fotogramas
      const gap = (now - this._tickAt) / Math.max(1, game.ticks - this._tick);
      if (this._tickAt && gap > 30 && gap < 400) this._tickDur = this._tickDur * 0.8 + gap * 0.2;
      this._tick = game.ticks;
      this._tickAt = now;
    }
    this._frac = clamp((now - this._tickAt) / this._tickDur, 0, 1);
    // Territorio y cifras: un pelín antes del turno siguiente ya está todo a la
    // vista (así no queda nada pendiente que aparezca de golpe)
    this._fracEarly = clamp((now - this._tickAt) / (this._tickDur * 0.9), 0, 1);
    const v = this.view;
    v.x0 = camera.x;
    v.y0 = camera.y;
    v.x1 = camera.x + camera.viewW / camera.zoom;
    v.y1 = camera.y + camera.viewH / camera.zoom;

    if (game.diploVersion !== this.diploVersion) {
      // Cambió alguna alianza: solo hay que repintar si cambian las tuyas
      // (franjas y fronteras de aliados); las de los bots entre sí no se ven
      this.diploVersion = game.diploVersion;
      const sig = this._allySignature();
      if (sig !== this._allySig) {
        // Solo las naciones cuyo trato contigo cambia (antes se repintaba y
        // subía el mapa entero: en el móvil, medio segundo congelado)
        const ids = (s) => new Set(s ? s.split(',').map(Number) : []);
        const before = ids(this._allySig);
        const after = ids(sig);
        this._allySig = sig;
        this._buildPalette();
        const changed = new Uint8Array(game.players.length);
        for (const id of before) if (!after.has(id)) changed[id] = 1;
        for (const id of after) if (!before.has(id)) changed[id] = 1;
        this._repaintOwners(changed);
      }
    }
    // Lienzos descartados por el navegador: se rehacen en cuanto vuelve el contexto
    if (now - this._lostCheckAt > 2000) {
      this._lostCheckAt = now;
      this.checkCanvases();
    }
    if (this._needRestore && !this._lost) this.restoreCanvases();
    if (this._spawnStyle && game.phase !== 'spawn') this._endSpawnStyle();
    this._flushDirty(now);
    // Cada 3 turnos (0,3 s): el frente avanza despacio y así se repinta menos
    if (this._hotTick === undefined || game.ticks - this._hotTick >= 3 || game.ticks < this._hotTick) this._updateHot();
    this._updateGlowsAndUpload(now);
    // Nombres: el cálculo se reparte en tres fotogramas seguidos. Si cambias
    // de sitio en el despliegue, el tuyo va con su círculo al momento
    const me = game.human;
    if (game.phase === 'spawn' && me && me.spawnTile !== this._mySpawn) {
      this._mySpawn = me.spawnTile;
      this._lbStep = 0;
      this._updateLabels();
      this.lastLabelTime = now;
    } else if (this._lbStep) {
      this._labelStage(this._lbStep);
      this._lbStep = (this._lbStep + 1) % 4;
    } else if (now - this.lastLabelTime > (this.lite ? 2 : 1) * LABEL_INTERVAL_MS) {
      // La primera vez, todo de golpe (para que los nombres salgan ya)
      if (!this.labels.length) this._updateLabels();
      else {
        this._labelStage(0);
        this._lbStep = 1;
      }
      this.lastLabelTime = now;
    }
    this.fx.update(this._dt);

    // Temblor de cámara tras una explosión cercana
    const sh = this.anim ? this.fx.shake : 0;
    // Temblor con ondas suaves (no un salto al azar en cada fotograma: así no
    // depende de los fps y no «vibra» en pantallas de 120 Hz)
    const ts = now / 1000;
    const ox = sh ? (Math.sin(ts * 53) * 0.6 + Math.sin(ts * 31 + 1.3) * 0.4) * sh * 0.5 : 0;
    const oy = sh ? (Math.sin(ts * 47 + 0.7) * 0.6 + Math.sin(ts * 37 + 2.1) * 0.4) * sh * 0.5 : 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a1a30';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const map = game.map;
    const z = camera.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, -camera.x * z + ox * dpr, -camera.y * z + oy * dpr);
    // Mapa y territorio en píxeles nítidos; solo el trozo que se ve
    ctx.imageSmoothingEnabled = false;
    const x0 = Math.max(0, Math.floor(v.x0) - 1);
    const y0 = Math.max(0, Math.floor(v.y0) - 1);
    const x1 = Math.min(map.width, Math.ceil(v.x1) + 1);
    const y1 = Math.min(map.height, Math.ceil(v.y1) + 1);
    if (x1 > x0 && y1 > y0) {
      // Alejado, el mapa se dibuja desde una copia reducida (menos píxeles que mover)
      const [img, S] = this._baseFor(z);
      const w = x1 - x0;
      const h = y1 - y0;
      ctx.drawImage(img, x0 * S, y0 * S, w * S, h * S, x0, y0, w, h);
      const ts = this.ts;
      ctx.drawImage(this.territoryCanvas, x0 * ts, y0 * ts, w * ts, h * ts, x0, y0, w, h);
      // Despliegue: las islas demasiado pequeñas para empezar, en sombra
      if (game.phase === 'spawn' && game.human) {
        const mask = this._spawnMask();
        if (mask) ctx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, mask.width * 2, mask.height * 2);
      } else if (this._spawnMaskCanvas) this._spawnMaskCanvas = null;
    }
    this._drawFlashes(now);

    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    ctx.imageSmoothingEnabled = true;
    this.fx.drawDecals(ctx, camera);
    this._drawRails();
    this._drawBuildings(now);
    this._drawCapitals(now);
    this._drawPoints(now);
    this._drawLugares(now);
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

  /**
   * Frontera roja donde se lucha (doc-1.6): en cada ataque contra un país o
   * una colonia, las casillas de la línea de frente del que se defiende se
   * pintan en rojo en la propia capa del territorio (más intenso si el
   * combate es tuyo). Una vez por turno se repintan solo las que entran o
   * salen del frente: no cuesta nada en cada fotograma. (Antes se dibujaba
   * encima en cada fotograma y era lo que más pesaba de la partida.)
   * `hot`: bits 0-1, lo pintado ahora (1 combate ajeno, 2 tuyo); bits 2-3, lo nuevo.
   */
  _updateHot() {
    const game = this.game;
    this._hotTick = game.ticks;
    const owner = game.owner;
    const W = game.map.width;
    if (!this.hot) this.hot = new Uint8Array(owner.length);
    const hot = this.hot;
    const human = game.human;
    const old = this._hotList || [];
    const next = [];
    if (game.phase === 'playing') {
      const H = owner.length;
      const mark = (t, v) => {
        const nv = hot[t] >> 2;
        if (nv >= v) return;
        if (!nv) next.push(t);
        hot[t] = (hot[t] & 3) | (v << 2);
      };
      for (const atk of game.attacks) {
        if (atk.done || !atk.targetId || !atk.inFrontier.size) continue;
        const v = human && (atk.attacker === human || atk.targetId === human.id) ? 2 : 1;
        const a = atk.attacker.id;
        for (const t of atk.inFrontier) {
          if (owner[t] !== atk.targetId) continue;
          mark(t, v);
          // …y la casilla del atacante de enfrente: la franja queda centrada en la frontera
          const x = t % W;
          if (x > 0 && owner[t - 1] === a) mark(t - 1, v);
          if (x < W - 1 && owner[t + 1] === a) mark(t + 1, v);
          if (t >= W && owner[t - W] === a) mark(t - W, v);
          if (t + W < H && owner[t + W] === a) mark(t + W, v);
        }
      }
    }
    const repaint = (t) => {
      this._paintTile(t);
      this._markChunk(t % W, (t / W) | 0);
    };
    // Las que salen del frente…
    for (const t of old) {
      if (!(hot[t] >> 2) && hot[t] & 3) {
        hot[t] = 0;
        repaint(t);
      }
    }
    // …y las que entran o cambian
    for (const t of next) {
      const v = hot[t] >> 2;
      const changed = (hot[t] & 3) !== v;
      hot[t] = v;
      if (changed) repaint(t);
    }
    this._hotList = next;
  }

  // -------------------------------------------------------------- ambiente

  /**
   * Bordes de la pantalla algo más oscuros: centra la mirada. El degradado se
   * pinta una vez en una imagen pequeña y se estira (calcularlo píxel a píxel
   * en cada fotograma costaba).
   */
  _drawVignette() {
    // En el móvil (modo ligero) no: es una capa a pantalla completa más
    if (this.lite) return;
    const { ctx, camera } = this;
    const w = camera.viewW;
    const h = camera.viewH;
    if (!this._vignette || this._vignette.w !== w || this._vignette.h !== h) {
      const cw = 192;
      const ch = Math.max(16, Math.round((cw * h) / Math.max(1, w)));
      const c = makeCanvas(cw, ch);
      const g2 = c.getContext('2d');
      const r = Math.hypot(cw, ch) / 2;
      const g = g2.createRadialGradient(cw / 2, ch / 2, r * 0.55, cw / 2, ch / 2, r);
      g.addColorStop(0, 'rgba(4, 10, 22, 0)');
      g.addColorStop(1, 'rgba(4, 10, 22, 0.42)');
      g2.fillStyle = g;
      g2.fillRect(0, 0, cw, ch);
      this._vignette = { w, h, c };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._vignette.c, -20, -20, w + 40, h + 40);
  }

  /** Anillos que marcan el punto al que ha volado la cámara. */
  /**
   * Nombre de país (no el tuyo) dibujado bajo el punto (sx, sy) de la
   * pantalla en el último fotograma, con `pad` px de margen; o null.
   */
  labelAt(sx, sy, pad = 0) {
    const hits = this._labelHits;
    if (!hits) return null;
    for (let i = 0; i < hits.length; i += 5) {
      if (sx >= hits[i + 1] - pad && sx <= hits[i + 3] + pad && sy >= hits[i + 2] - pad && sy <= hits[i + 4] + pad) return hits[i];
    }
    return null;
  }

  _drawPing(now, ping) {
    const age = (now - ping.t) / 1000;
    if (ping.small) {
      // Toque: dos anillos pequeños y rápidos donde cae la orden
      if (age > 0.7) return;
      const { ctx, camera } = this;
      const [x, y] = camera.worldToScreen(ping.x, ping.y);
      for (let k = 0; k < 2; k++) {
        const a = age - k * 0.15;
        if (a < 0 || a > 0.55) continue;
        ctx.beginPath();
        ctx.arc(x, y, 5 + a * 34, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - a / 0.55)})`;
        ctx.stroke();
      }
      return;
    }
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
    // Iconos pequeños y discretos: el mapa manda
    return Math.min(30, Math.max(11, this.camera.zoom * RES * 3));
  }

  _drawBuildings(now) {
    const { ctx, game, camera } = this;
    if (camera.zoom * RES < 1.1 || !game.buildings.length) return;
    const map = game.map;
    const size = this._buildingSize();
    for (const b of game.buildings) {
      if (b.kind === 'capital') continue; // aparte (_drawCapitals), también de lejos
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
      const spr = this._buildingSprite(b.kind, p, size);
      const w = spr.width / this.dpr;
      ctx.drawImage(spr, sx - w / 2, sy - w / 2, w, w);
      ctx.globalAlpha = 1;
      if (building) this._drawConstruction(sx, sy, size, game.buildProgress(b), now);
      else {
        if ((b.kind === 'sam' || b.kind === 'silo') && b.level > 0) this._drawReload(sx, sy, size, b);
        if (b.level > 1) this._drawLevel(sx, sy, size, b.level);
      }
    }
  }

  /**
   * Capitales (doc-1.6): siempre a la vista, más grandes que un edificio, con
   * su muralla (un anillo almenado del color del dueño) de cerca. La tuya y
   * las de tus aliados, también de lejos; las demás, al acercarse un poco.
   */
  _drawCapitals(now) {
    const { ctx, game, camera } = this;
    if (!game.capitals || !game.capitals.length) return;
    const map = game.map;
    const zr = camera.zoom * RES;
    const human = game.human;
    const size = clamp(this._buildingSize() * 1.45, 12, 34);
    for (const b of game.capitals) {
      const p = game.players[b.owner];
      if (!p) continue;
      const mine = p === human;
      const friend = mine || (human && human.allies.has(p.id));
      if (zr < 0.6 && !friend) continue;
      const [sx, sy] = camera.worldToScreen(map.x(b.tile) + 0.5, map.y(b.tile) + 0.5);
      const radii = game.capitalRadii ? game.capitalRadii(b) : { wall: CONFIG.capitalWallRadius, outer: CONFIG.capitalOuterRadius };
      const wallR = radii.wall * camera.zoom;
      const m = Math.max(size * 2, radii.outer * camera.zoom) + 4;
      if (sx < -m || sy < -m || sx > camera.viewW + m || sy > camera.viewH + m) continue;
      // Murallas en píxeles (doc-1.8): la tuya, en cuanto se distingue; las
      // demás, solo de cerca (con decenas de capitales a la vista recargaban)
      if (wallR >= (mine ? 12 : 40)) this._drawCapitalWalls(b, p, radii);
      const lvl = b.up || 0;
      // Emblema: medallón de su metal (más dorado cuanto más nivel) con su
      // resplandor, el brillo que lo cruza, chispas y rayos a nivel 12
      const fx = this.anim && (mine || zr >= 1.2);
      if (fx) drawCapitalFx(ctx, sx, sy, size, lvl, now, { back: true });
      const spr = this._capitalSprite(b, p, size);
      const w = spr.width / this.dpr;
      ctx.drawImage(spr, sx - w / 2, sy - w / 2, w, w);
      if (fx) drawCapitalFx(ctx, sx, sy, size, lvl, now, { back: false });
      const prog = game.capitalProgress ? game.capitalProgress(b) : null;
      if (prog !== null) this._drawConstruction(sx, sy, size, prog, now);
      else if (lvl > 0 && (mine ? zr >= 0.9 : zr >= 2.4)) this._drawLevel(sx, sy, size, lvl);
      // Lo que hay en su banco: la tuya siempre, las demás de cerca
      if ((b.bank || 0) >= 1 && (mine || zr >= 2.4) && game.bankCap) this._drawBankTag(sx, sy + size * 0.62 + 3, b, p, mine);
    }
  }

  /** Emblema de una capital según su tramo de nivel (en caché por dueño, tramo y tamaño). */
  _capitalSprite(b, p, size) {
    const px = Math.max(8, Math.round((size * this.dpr) / 2) * 2);
    const human = p === this.game.human;
    const key = `capital|${p.id}|${px}|${human ? 1 : 0}|${capitalTier(b.up || 0)}`;
    this._sprites ??= new Map();
    let c = this._sprites.get(key);
    if (!c) {
      if (this._sprites.size > 600) this._sprites.clear();
      const S = Math.ceil(px * 1.7);
      c = makeCanvas(S, S);
      drawCapitalEmblem(c.getContext('2d'), S / 2, S / 2 + px * 0.05, px, b.up || 0, { ring: rgbToCss(p.color), outline: human });
      this._sprites.set(key, c);
    }
    return c;
  }

  /**
   * Murallas de una capital como frontera de píxeles (doc-1.8): un anillo de
   * casillas (solo las suyas) con almenas, del metal de su nivel, más grueso
   * cuantas más tropas guarda su banco (de 1 a 3 casillas), y las afueras
   * como un punteado de su color. Se pinta a una casilla por píxel en un
   * lienzo aparte (se rehace cada segundo o si cambia algo) y se escala sin
   * suavizar: cuadradito a cuadradito, como el territorio.
   */
  _drawCapitalWalls(b, p, radii) {
    const { ctx, game, camera } = this;
    const map = game.map;
    const R = radii.wall;
    const O = radii.outer;
    const tier = capitalTier(b.up || 0);
    const ratio = (b.bank || 0) / Math.max(1, p.maxTroops());
    const thick = 2 + (ratio >= 0.4 ? 1 : 0) + (ratio >= 1.5 ? 1 : 0);
    this._wallCache ??= new Map();
    let e = this._wallCache.get(b.id);
    const key = `${b.tile}|${R}|${O}|${tier}|${thick}|${p.id}`;
    if (!e || e.key !== key || game.ticks - e.tick >= 10) {
      const n = 2 * O + 3;
      const c = e && e.canvas.width === n ? e.canvas : makeCanvas(n, n);
      const g = c.getContext('2d');
      const img = g.createImageData(n, n);
      const d = img.data;
      const T = CAPITAL_TIERS[tier].metal.map(hexRgb);
      const [pr, pg, pb] = p.color;
      const cx = map.x(b.tile);
      const cy = map.y(b.tile);
      const owner = game.owner;
      const W = map.width;
      for (let j = 0; j < n; j++) {
        const y = cy - O - 1 + j;
        if (y < 0 || y >= map.height) continue;
        for (let i = 0; i < n; i++) {
          const x = cx - O - 1 + i;
          if (x < 0 || x >= W) continue;
          const dx = x - cx;
          const dy = y - cy;
          const r = Math.sqrt(dx * dx + dy * dy);
          let col = null;
          let a = 255;
          if (r <= R && r > R - thick) {
            // Muralla: el filo de fuera más claro, el resto del metal
            col = r > R - 1 ? T[0] : T[1];
          } else if (r > R && r <= R + 1) {
            // Almenas: una sí y una no por el borde de fuera
            const ang = Math.atan2(dy, dx);
            if (Math.floor(((ang + Math.PI) / TAU) * R * 3.2) % 2 === 0) col = T[2];
          } else if (r > O - 1 && r <= O) {
            // Afueras: punteado del color del dueño
            const ang = Math.atan2(dy, dx);
            if (Math.floor(((ang + Math.PI) / TAU) * O * 2.2) % 2 === 0) {
              col = [pr, pg, pb];
              a = 170;
            }
          }
          if (!col || owner[y * W + x] !== p.id) continue;
          const k = (j * n + i) * 4;
          d[k] = col[0];
          d[k + 1] = col[1];
          d[k + 2] = col[2];
          d[k + 3] = a;
        }
      }
      g.putImageData(img, 0, 0);
      e = { key, tick: game.ticks, canvas: c };
      this._wallCache.set(b.id, e);
      if (this._wallCache.size > 400) this._wallCache.clear();
    }
    const [x0, y0] = camera.worldToScreen(map.x(b.tile) - O - 1, map.y(b.tile) - O - 1);
    const sz = e.canvas.width * camera.zoom;
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(e.canvas, x0, y0, sz, sz);
    ctx.imageSmoothingEnabled = smooth;
  }

  /** Pastilla con las tropas del banco de una capital y cuánto le falta para llenarse. */
  _drawBankTag(sx, sy, b, p, mine) {
    const { ctx, game } = this;
    const cap = game.bankCap(p);
    const fill = Math.min(1, (b.bank || 0) / Math.max(1, cap));
    const text = fmtTroops(b.bank || 0);
    ctx.font = '700 10px system-ui, sans-serif';
    const tw = ctx.measureText(text).width;
    const w = Math.max(34, tw + 22);
    const h = 15;
    const x = sx - w / 2;
    ctx.fillStyle = 'rgba(14, 18, 28, 0.86)';
    ctx.beginPath();
    ctx.roundRect(x, sy, w, h, 7.5);
    ctx.fill();
    // Relleno: lo que lleva el banco
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, sy, w, h, 7.5);
    ctx.clip();
    ctx.fillStyle = mine ? 'rgba(242, 179, 61, 0.38)' : 'rgba(200, 200, 210, 0.25)';
    ctx.fillRect(x, sy, w * fill, h);
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.strokeStyle = mine ? 'rgba(242, 179, 61, 0.8)' : 'rgba(255, 255, 255, 0.25)';
    ctx.beginPath();
    ctx.roundRect(x + 0.5, sy + 0.5, w - 1, h - 1, 7);
    ctx.stroke();
    // Castillito y la cifra
    ctx.fillStyle = mine ? '#ffd27a' : '#e6e9ef';
    const ix = x + 6;
    const iy = sy + 4;
    ctx.fillRect(ix, iy + 3, 7, 4);
    ctx.fillRect(ix, iy + 1, 1.6, 2);
    ctx.fillRect(ix + 2.7, iy, 1.6, 3);
    ctx.fillRect(ix + 5.4, iy + 1, 1.6, 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x + 16, sy + h / 2 + 0.5);
  }

  /**
   * Lugares de interés (doc-1.6): un disco dorado que late con su icono,
   * siempre a la vista; de cerca, con su nombre.
   */
  _drawLugares(now) {
    const { ctx, game, camera } = this;
    if (!game.lugares || !game.lugares.length) return;
    const size = clamp(camera.zoom * RES * 4, 15, 30);
    const named = camera.zoom * RES >= 1.8;
    const k = this.anim ? 0.5 + 0.5 * Math.sin(now / 360) : 0.5;
    for (const l of game.lugares) {
      const [sx, sy] = camera.worldToScreen(l.x + 0.5, l.y + 0.5);
      if (sx < -size || sy < -size || sx > camera.viewW + size || sy > camera.viewH + size * 2) continue;
      // Halo que late
      ctx.fillStyle = `rgba(255, 210, 90, ${0.18 + 0.16 * k})`;
      ctx.beginPath();
      ctx.arc(sx, sy, size * (0.78 + 0.16 * k), 0, Math.PI * 2);
      ctx.fill();
      const spr = this._lugarSprite(l.kind, size);
      const w = spr.width / this.dpr;
      ctx.drawImage(spr, sx - w / 2, sy - w / 2, w, w);
      if (named) {
        const def = LUGARES[l.kind];
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10, 14, 24, 0.8)';
        ctx.fillStyle = '#ffe3a1';
        ctx.strokeText(def.name, sx, sy + size * 0.62);
        ctx.fillText(def.name, sx, sy + size * 0.62);
        // Debajo, lo que da (doc-1.7: antes solo el nombre y no se sabía)
        if (def.short) {
          ctx.font = '600 9.5px system-ui, sans-serif';
          ctx.fillStyle = '#9be38f';
          ctx.strokeText(def.short, sx, sy + size * 0.62 + 12);
          ctx.fillText(def.short, sx, sy + size * 0.62 + 12);
        }
      }
    }
  }

  _lugarSprite(kind, size) {
    const px = Math.max(12, Math.round((size * this.dpr) / 2) * 2);
    const key = `lugar|${kind}|${px}`;
    this._sprites ??= new Map();
    let c = this._sprites.get(key);
    if (!c) {
      if (this._sprites.size > 600) this._sprites.clear();
      const S = Math.ceil(px * 1.2);
      c = makeCanvas(S, S);
      const g = c.getContext('2d');
      const r = px / 2;
      const grad = g.createRadialGradient(S / 2, S / 2 - r * 0.3, r * 0.1, S / 2, S / 2, r);
      grad.addColorStop(0, '#fff2c4');
      grad.addColorStop(1, '#d9a12e');
      g.beginPath();
      g.arc(S / 2, S / 2, r, 0, Math.PI * 2);
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = Math.max(1.5, px * 0.07);
      g.strokeStyle = '#5b3a0a';
      g.stroke();
      g.font = `${Math.round(px * 0.56)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(LUGARES[kind].icon, S / 2, S / 2 + px * 0.03);
      this._sprites.set(key, c);
    }
    return c;
  }

  /**
   * Puntos estratégicos: siempre visibles (también alejado), en rombo con el
   * borde del color de su dueño (dorado si no es de nadie). De cerca, con su
   * nombre debajo. Los tuyos laten suavemente.
   */
  _drawPoints(now) {
    const { ctx, game, camera } = this;
    if (!game.points.length) return;
    const big = Math.max(13, Math.min(30, camera.zoom * RES * 3.2));
    const named = camera.zoom * RES >= 2.4;
    const human = game.human;
    // Capitales: más pequeñas y, de lejos, solo las que importan (la tuya, las
    // de tus aliados, las conquistadas) salvo en la victoria por capitales
    const allCaps = game.rules.victory === 'capitales' || camera.zoom * RES >= 1.2;
    for (const pt of game.points) {
      const o = game.owner[pt.tile];
      const p = o ? game.players[o] : null;
      const capital = pt.kind === 'capital';
      if (capital && !allCaps && !(human && (pt.nation === human.id || o === human.id || human.allies.has(pt.nation))) && o === pt.nation) continue;
      const size = capital ? Math.max(10, big * 0.75) : big;
      const [sx, sy] = camera.worldToScreen(pt.x + 0.5, pt.y + 0.5);
      if (sx < -size || sy < -size || sx > camera.viewW + size || sy > camera.viewH + size * 2) continue;
      const spr = this._pointSprite(pt.kind, p, size);
      const w = spr.width / this.dpr;
      const mine = human && p === human;
      if (mine && this.anim) {
        const k = 0.5 + 0.5 * Math.sin(now / 420);
        ctx.fillStyle = `rgba(255, 220, 120, ${0.18 + 0.14 * k})`;
        ctx.beginPath();
        ctx.arc(sx, sy, size * (0.75 + 0.12 * k), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.drawImage(spr, sx - w / 2, sy - w / 2, w, w);
      if (named && !capital) {
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10, 14, 24, 0.8)';
        ctx.fillStyle = p ? '#ffffff' : '#f6d27a';
        const label = pt.kind === 'capital' ? pt.name : pt.name.replace(/ de .*/, '');
        ctx.strokeText(label, sx, sy + size * 0.62);
        ctx.fillText(label, sx, sy + size * 0.62);
      }
    }
  }

  _pointSprite(kind, p, size) {
    const px = Math.max(10, Math.round((size * this.dpr) / 2) * 2);
    const key = `poi|${kind}|${p ? p.id : 0}|${px}`;
    this._sprites ??= new Map();
    let c = this._sprites.get(key);
    if (!c) {
      if (this._sprites.size > 600) this._sprites.clear();
      const S = Math.ceil(px * 1.35);
      c = makeCanvas(S, S);
      drawPointIcon(c.getContext('2d'), kind, S / 2, S / 2, px, { ring: p ? rgbToCss(p.color) : null });
      this._sprites.set(key, c);
    }
    return c;
  }

  /**
   * Vías de las fábricas: en ángulo recto (tramo horizontal y tramo
   * vertical), como un trazado de mapa. Una línea oscura con traviesas
   * claras encima, ajustada a los píxeles; y los trenes que circulan por
   * ellas (locomotora del color del dueño con dos vagones).
   */
  _drawRails() {
    const { ctx, game, camera } = this;
    if (!game.rails.length || camera.zoom * RES < 1.1) return;
    const map = game.map;
    const W = camera.viewW;
    const H = camera.viewH;
    const d = this.dpr;
    // Coordenadas de pantalla en píxeles enteros del lienzo: líneas nítidas
    const snap = (v) => Math.round(v * d) / d;
    const pts = this._railSegs || (this._railSegs = []);
    pts.length = 0;
    for (const r of game.rails) {
      const [ax, ay] = camera.worldToScreen(map.x(r.factory.tile) + 0.5, map.y(r.factory.tile) + 0.5);
      const [cx, cy] = camera.worldToScreen(r.cx + 0.5, r.cy + 0.5);
      const [bx, by] = camera.worldToScreen(map.x(r.station.tile) + 0.5, map.y(r.station.tile) + 0.5);
      if (Math.max(ax, bx, cx) < -10 || Math.min(ax, bx, cx) > W + 10 || Math.max(ay, by, cy) < -10 || Math.min(ay, by, cy) > H + 10) continue;
      pts.push(snap(ax), snap(ay), snap(cx), snap(cy), snap(bx), snap(by));
    }
    if (pts.length) {
      const lw = clamp(camera.zoom * RES * 0.42, 1.5, 4.5);
      const path = () => {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 6) {
          ctx.moveTo(pts[i], pts[i + 1]);
          ctx.lineTo(pts[i + 2], pts[i + 3]);
          ctx.lineTo(pts[i + 4], pts[i + 5]);
        }
      };
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      path();
      // Lecho oscuro…
      ctx.lineWidth = lw * 1.6;
      ctx.strokeStyle = 'rgba(30, 30, 36, 0.88)';
      ctx.stroke();
      // …y traviesas claras a intervalos
      ctx.setLineDash([lw * 0.9, lw * 0.9]);
      ctx.lineCap = 'butt';
      ctx.lineWidth = lw * 0.75;
      ctx.strokeStyle = 'rgba(232, 234, 238, 0.95)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
    if (!game.trains.length) return;
    const L = clamp(camera.zoom * RES * 3.2, 9, 26);
    for (const t of game.trains) {
      const r = t.rail;
      const pos = clamp(t.pos + CONFIG.trainSpeed * t.dir * this._frac, 0, r.len);
      const [wx, wy, a] = game.railPoint(r, pos);
      const [px, py] = camera.worldToScreen(wx, wy);
      if (px < -L * 2 || py < -L * 2 || px > W + L * 2 || py > H + L * 2) continue;
      const ang = a + (t.dir < 0 ? Math.PI : 0);
      const owner = game.players[r.factory.owner];
      drawTrain(ctx, px, py, ang, L, owner ? pcss(owner) : '#888');
    }
  }

  /**
   * Edificio a color ya pintado (se dibuja una vez por tipo, dueño y tamaño
   * y se reutiliza: los degradados y detalles no cuestan en cada fotograma).
   */
  _buildingSprite(kind, p, size) {
    const px = Math.max(8, Math.round((size * this.dpr) / 2) * 2);
    const human = p === this.game.human;
    const key = `${kind}|${p.id}|${px}|${human ? 1 : 0}`;
    this._sprites ??= new Map();
    let c = this._sprites.get(key);
    if (!c) {
      if (this._sprites.size > 600) this._sprites.clear();
      const S = Math.ceil(px * 1.45);
      c = makeCanvas(S, S);
      drawBuildingReal(c.getContext('2d'), kind, S / 2, S / 2, px, { ring: rgbToCss(p.color), outline: human });
      this._sprites.set(key, c);
    }
    return c;
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

  /**
   * Recarga de antimisiles y silos: anillo que se va llenando mientras
   * recargan (con los segundos que faltan) y punto verde cuando están listos.
   */
  _drawReload(sx, sy, size, b) {
    const { ctx, game } = this;
    const r = size * 0.66;
    const left = (b.readyAt ?? 0) - game.ticks;
    if (left > 0 && b.reloadFrom !== undefined) {
      const total = Math.max(1, b.readyAt - b.reloadFrom);
      const frac = 1 - left / total;
      ctx.lineWidth = Math.max(2.5, size * 0.13);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = b.kind === 'sam' ? '#6cc4ff' : '#ff9b4a';
      ctx.beginPath();
      ctx.arc(sx, sy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      if (size >= 14) {
        const secs = Math.ceil((left * TICK_MS) / 1000);
        ctx.font = '800 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.strokeText(`${secs}s`, sx, sy + size * 0.78);
        ctx.fillStyle = b.kind === 'sam' ? '#bfe6ff' : '#ffd2a8';
        ctx.fillText(`${secs}s`, sx, sy + size * 0.78);
      }
    } else {
      // Lista: punto verde
      ctx.beginPath();
      ctx.arc(sx + size * 0.42, sy + size * 0.38, Math.max(2.5, size * 0.12), 0, Math.PI * 2);
      ctx.fillStyle = '#5fd38d';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.stroke();
    }
  }

  /** Nivel del edificio (2 o más): el número en una chapa dorada encima del icono. */
  /**
   * Insignia de nivel de un edificio: ya dibujada (una por nivel y tamaño) y
   * pegada. Antes era un círculo con texto en cada fotograma por edificio, y
   * con cientos a la vista pesaba.
   */
  _drawLevel(sx, sy, size, level) {
    const r = Math.max(6.5, size * 0.3);
    const rq = Math.round(r * 2) / 2;
    const key = `nivel|${level}|${rq}|${this.dpr}`;
    this._sprites ??= new Map();
    let c = this._sprites.get(key);
    if (!c) {
      if (this._sprites.size > 600) this._sprites.clear();
      const S = Math.ceil((rq * 2 + 4) * this.dpr);
      c = makeCanvas(S, S);
      const g = c.getContext('2d');
      g.scale(this.dpr, this.dpr);
      const m = rq + 2;
      g.beginPath();
      g.arc(m, m, rq, 0, Math.PI * 2);
      g.fillStyle = '#ffd34d';
      g.fill();
      g.lineWidth = Math.max(1.5, rq * 0.22);
      g.strokeStyle = 'rgba(40, 26, 0, 0.9)';
      g.stroke();
      g.fillStyle = '#2a1a00';
      g.font = `900 ${Math.round(rq * 1.35)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(level), m, m + rq * 0.08);
      this._sprites.set(key, c);
    }
    const w = c.width / this.dpr;
    this.ctx.drawImage(c, sx - w / 2, sy - size * 0.62 - r * 0.35 - w / 2, w, w);
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

  /**
   * Enseña de una nación ya dibujada (en caché por nación y tamaño): la
   * bandera de su país o, si no tiene (naciones inventadas, colonias,
   * jugadores sin bandera), un paño de su color con su emblema. Con `pole`,
   * en un mástil (los barcos): así se sabe de quién es cada barco.
   * Devuelve el lienzo con { w, h, ax, ay }: tamaño en px de pantalla y el
   * punto de anclaje (pie del mástil, o el centro sin mástil).
   */
  _ensign(p, h, pole) {
    const cache = (this._ensigns ??= new Map());
    const flag = flagReady() && hasFlag(p.flag);
    const key = `${p.id}|${h}|${pole ? 1 : 0}|${flag ? 1 : 0}|${this.dpr}`;
    let c = cache.get(key);
    if (c) return c;
    if (cache.size > 600) cache.clear();
    const fw = Math.round((h * 4) / 3);
    const poleH = pole ? Math.round(h * 0.9) : 0;
    const pad = 1;
    const w = fw + pad * 2 + (pole ? 1.5 : 0);
    const H = h + pad * 2 + poleH;
    c = document.createElement('canvas');
    c.width = Math.ceil(w * this.dpr);
    c.height = Math.ceil(H * this.dpr);
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const fx = pad + (pole ? 1.5 : 0);
    const fy = pad;
    if (pole) {
      // Mástil oscuro con un borde claro (se ve sobre el mar y sobre tierra)
      g.fillStyle = 'rgba(255, 255, 255, 0.6)';
      g.fillRect(0.5, fy, 2, h + poleH);
      g.fillStyle = '#1b222c';
      g.fillRect(1, fy, 1.2, h + poleH);
    }
    if (!flag || !drawFlag(g, p.flag, fx + fw / 2, fy + h / 2, h)) {
      g.fillStyle = rgbToCss(p.color);
      g.fillRect(fx, fy, fw, h);
      if (h >= 8) drawEmblem(g, emblemFor(p), fx + fw / 2, fy + h / 2, h * 0.92);
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      g.strokeRect(fx, fy, fw, h);
    }
    c.w = w;
    c.h = H;
    c.ax = pole ? 1.6 : w / 2;
    c.ay = pole ? H : H / 2;
    cache.set(key, c);
    return c;
  }

  /** Bandera en su mástil sobre un barco: el pie del mástil en (x, y). */
  _shipEnsign(p, x, y, h) {
    const e = this._ensign(p, h, true);
    this.ctx.drawImage(e, Math.round(x - e.ax), Math.round(y - e.ay), e.w, e.h);
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
        if (this.anim) fx.capture(s.x, s.y, pcss(game.players[m.owner]));
      }
      st.gen = gen;
      const sx = (s.x - camera.x) * z;
      const sy = (s.y - camera.y) * z;
      if (!this._onScreen(sx, sy, 40)) continue;
      const p = game.players[m.owner];
      const color = pcss(p);
      const mine = p === game.human;
      const moving = clamp((s.speed / RES) * 3, 0, 1);
      const fish = m.kind === 'fish';
      const len = clamp(z * RES * (fish ? 1.9 : 2.6), 6, fish ? 22 : 30);
      if (fish) drawFishing(ctx, sx, sy, s.ang, len, color, mine, moving, m.phase === 'fishing', this._lastNow || 0);
      else drawCargo(ctx, sx, sy, s.ang, len, color, mine, moving, m.id);
      // Su bandera, en cuanto el barco se ve lo bastante grande
      if (len >= 11) this._shipEnsign(p, sx, sy - len * 0.12, Math.round(clamp(len * 0.42, 7, 12)));
      this._maybeWake(s, len, 5);
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
      const mine = human && (b.owner === human.id || b.targetId === human.id);
      this._drawBoatTrail(b, s, p, mine);
      if (!this._onScreen(sx, sy, 60)) continue;
      const len = clamp(z * RES * 2.4, 8, 30);
      drawTransport(ctx, sx, sy, s.ang, len, pcss(p), p === human, 1);
      this._maybeWake(s, len, 8);
      if (z * RES >= 4 || mine) {
        // Etiqueta con la bandera del dueño y sus tropas
        const text = fmtTroops(b.troops);
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const flag = this._ensign(p, 10, false);
        const fw = flag.w + 3;
        const tw = ctx.measureText(text).width + 10 + fw;
        const ty = sy - len * 0.55 - 10;
        ctx.beginPath();
        ctx.roundRect(sx - tw / 2, ty - 8, tw, 16, 8);
        ctx.fillStyle = human && b.targetId === human.id ? 'rgba(190, 40, 40, 0.92)' : b.owner === human?.id ? 'rgba(24, 140, 78, 0.92)' : 'rgba(10, 16, 28, 0.85)';
        ctx.fill();
        ctx.drawImage(flag, Math.round(sx - tw / 2 + 5), Math.round(ty - flag.h / 2), flag.w, flag.h);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, sx + fw / 2, ty + 0.5);
      } else if (len >= 10) {
        this._shipEnsign(p, sx, sy - len * 0.1, Math.round(clamp(len * 0.4, 6, 11)));
      }
    }
    for (const [id, st] of this._boats) {
      if (st.gen === gen) continue;
      this._boats.delete(id);
      this._trailBoxes.delete(id);
      if (!this.anim || !this._inView(st.x, st.y, 4)) continue;
      if (st.pos >= st.len - 2) fx.landing((st.end % W) + 0.5, Math.floor(st.end / W) + 0.5);
      else fx.sink(st.x, st.y, false);
    }
  }

  /**
   * Línea fina del barco de tropas: sólida desde donde salió hasta donde va
   * y punteada hasta donde llegará. Todos la ven: así se sabe de dónde viene.
   */
  _drawBoatTrail(b, s, p, mine = false) {
    const { ctx, camera } = this;
    const W = this.game.map.width;
    const z = camera.zoom;
    const path = b.path;
    // Recuadro de la ruta (se calcula una vez): si no toca la pantalla, no se
    // dibuja. Antes cada barco del mundo trazaba su estela en cada fotograma
    let box = this._trailBoxes.get(b.id);
    if (!box || box.path !== path) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < path.length; i++) {
        const x = path[i] % W;
        const y = (path[i] / W) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      box = { path, x0, y0, x1: x1 + 1, y1: y1 + 1 };
      this._trailBoxes.set(b.id, box);
    }
    const m = 8;
    if ((box.x1 - camera.x) * z < -m || (box.x0 - camera.x) * z > camera.viewW + m || (box.y1 - camera.y) * z < -m || (box.y0 - camera.y) * z > camera.viewH + m) return;
    const step = Math.max(1, Math.floor(path.length / 90));
    const pt = (t) => [((t % W) + 0.5 - camera.x) * z, (Math.floor(t / W) + 0.5 - camera.y) * z];
    const color = prgb(p);
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
    // Con contorno oscuro solo los barcos que te tocan (los demás, un trazo)
    if (mine) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
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
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = `rgba(${color}, ${mine ? 0.8 : 0.55})`;
    ctx.lineWidth = mine ? 1.8 : 1.3;
    ctx.stroke();
    ctx.setLineDash([]);
    // Origen marcado
    [x, y] = pt(path[0]);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color}, 0.9)`;
    ctx.fill();
    // Destino: dónde va a desembarcar (diana que late; roja si viene a por ti)
    const end = b.dest >= 0 ? b.dest : path[path.length - 1];
    [x, y] = pt(end);
    const human = this.game.human;
    const hostile = human && b.targetId === human.id;
    this._drawLanding(x, y, hostile ? '255, 80, 70' : color, mine);
  }

  /** Diana del punto de desembarco de una lancha. */
  _drawLanding(x, y, rgb, strong) {
    const { ctx } = this;
    const k = this.anim ? 0.5 + 0.5 * Math.sin((this._lastNow || 0) / 260) : 0.5;
    const r = strong ? 7 : 5.5;
    ctx.beginPath();
    ctx.arc(x, y, r + 3 + 3 * k, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${rgb}, ${0.25 + 0.35 * (1 - k)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 14, 24, 0.55)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.55, y);
    ctx.lineTo(x + r * 0.55, y);
    ctx.moveTo(x, y - r * 0.55);
    ctx.lineTo(x, y + r * 0.55);
    ctx.lineWidth = 1.6;
    ctx.stroke();
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
      // Casco grande para reconocerlo, sin aro ni zona de patrulla alrededor
      // (la zona solo se ve al colocarlo, en la vista previa)
      const r = clamp(z * RES * 1.6, 11, 21);
      const len = r * 2;
      if (!this._onScreen(sx, sy, len * 2)) continue;
      const p = game.players[ws.owner];
      const aim = now - st.aimAt < 1600 ? st.aim : null;
      drawWarship(ctx, sx, sy, s.ang, r, pcss(p), p === game.human, aim, clamp((s.speed / RES) * 3, 0, 1));
      // Su bandera en el mástil (de quién es, de un vistazo)
      this._shipEnsign(p, sx, sy - r * 0.2, Math.round(clamp(r * 0.78, 10, 15)));
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
      if (e.kind === 'fish') {
        // Pesca: el oro, solo de los tuyos y si se ve
        const h = game.human;
        if (h && visible && e.owner === h.id) fx.label(e.x, e.y - 1.2 * RES, `+${formatNumber(e.gold)}`, '#ffd76a', 11, 1.2);
        continue;
      }
      if (e.kind === 'lugar') {
        if (!visible) continue;
        const p = game.players[e.owner];
        fx.capture(e.x, e.y, p ? pcss(p) : '#ffd76a');
        fx.label(e.x, e.y - 1.6 * RES, `${LUGARES[e.lugar].icon} ${LUGARES[e.lugar].name}`, '#ffe3a1', 13, 2.2);
        continue;
      }
      if (e.kind === 'capitalFall') {
        if (!visible) continue;
        const p = game.players[e.owner];
        fx.capture(e.x, e.y, p ? pcss(p) : '#ffffff');
        fx.label(e.x, e.y - 2 * RES, '🏰 ¡Capital tomada!', '#ffffff', 15, 2.6);
        continue;
      }
      if (e.kind === 'train') {
        // Oro de un tren: solo si es tuyo o pasa por tu estación, y si se ve
        const h = game.human;
        if (!h || !visible) continue;
        const mine = e.owner === h.id;
        // El oro del tren es para el dueño de la fábrica (documento, 04.4)
        if (!mine) continue;
        fx.label(e.x, e.y - 1.5 * RES, `+${formatNumber(e.gold)}`, '#ffd76a', 12, 1.3);
        continue;
      }
      if (e.kind === 'order') {
        // Cooperativo: lo que ordena tu compañero, con su nombre
        const h = game.human;
        const co = this.coop;
        if (!h || !co || e.owner !== h.id || e.by === co.mySlot || !visible) continue;
        const who = co.names?.[e.by] || co.partnerName;
        const what = e.what === 'action' ? 'ataque' : (BUILDINGS[e.what]?.name || '').toLowerCase();
        fx.label(e.x, e.y - RES, `${who}: ${what}`, '#9fd4ff', 12, 2);
        continue;
      }
      if (e.kind === 'loot') {
        // Has eliminado a alguien: lluvia de monedas y la cifra del botín
        const h = game.human;
        if (!h || e.owner !== h.id || !visible) continue;
        fx.coinBurst(e.x, e.y, e.weak ? 14 : 24);
        fx.label(e.x, e.y - 1.5 * RES, `+${formatNumber(e.gold)}`, '#ffd76a', e.weak ? 18 : 24, 2.4);
        continue;
      }
      if (e.kind === 'boom') {
        fx.explosion(e.x, e.y, (e.r || CONFIG.missileRadius) / RES);
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
        const color = pcss(game.players[m.owner]);
        this._missiles.set(m.id, { gx, gy, z: alt, vx, vy, vz, color, gen });

        const involved = human && (m.owner === human.id || m.targetId === human.id);
        const [sx1, sy1] = camera.worldToScreen(tx, ty);
        if (involved) {
          const pulse = (Math.sin(now / 120) + 1) / 2;
          ctx.beginPath();
          ctx.arc(sx1, sy1, (m.radius || CONFIG.missileRadius) * z, 0, Math.PI * 2);
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

  /**
   * Al colocar una fábrica: su alcance (un rombo, porque se mide en recorrido
   * horizontal + vertical) y las vías que tendería a las estaciones más cercanas.
   */
  _drawRailPreview(tile, sx, sy) {
    const { ctx, game, camera } = this;
    const map = game.map;
    const human = game.human;
    const R = game.railRange(1) * (1 + (human.mods.railRange || 0));
    const z = camera.zoom;
    ctx.beginPath();
    ctx.moveTo(sx, sy - R * z);
    ctx.lineTo(sx + R * z, sy);
    ctx.lineTo(sx, sy + R * z);
    ctx.lineTo(sx - R * z, sy);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.stroke();
    const fx = map.x(tile);
    const fy = map.y(tile);
    const body = map.landBody[tile];
    const cands = [];
    for (const b of game.buildings) {
      if ((b.kind !== 'city' && b.kind !== 'port' && b.kind !== 'factory') || !b.level || map.landBody[b.tile] !== body) continue;
      const d = Math.abs(map.x(b.tile) - fx) + Math.abs(map.y(b.tile) - fy);
      if (d <= R) cands.push([d, b]);
    }
    cands.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    let n = 0;
    for (const [, b] of cands) {
      if (n >= CONFIG.railMaxPerFactory) break;
      const corner = game._railCorner(tile, b.tile);
      if (!corner) continue;
      n++;
      const [cx, cy] = camera.worldToScreen(corner[0] + 0.5, corner[1] + 0.5);
      const [bx, by] = camera.worldToScreen(map.x(b.tile) + 0.5, map.y(b.tile) + 0.5);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    const note = n ? `${n} vía${n > 1 ? 's' : ''}: trenes con oro` : 'Sin estaciones al alcance (ciudades, puertos o fábricas)';
    // Encima del icono: debajo va la estimación de lo que rendiría
    ctx.strokeText(note, sx, sy - 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(note, sx, sy - 30);
  }

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
      // Sale del puerto propio más cercano y se queda para siempre en su zona:
      // línea desde el puerto y círculo de la zona que patrullará
      const [px, py] = camera.worldToScreen(map.x(check.water) + 0.5, map.y(check.water) + 0.5);
      [sx, sy] = camera.worldToScreen(map.x(check.zone) + 0.5, map.y(check.zone) + 0.5);
      ctx.beginPath();
      ctx.arc(sx, sy, CONFIG.warshipPatrol * camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(95, 211, 141, 0.08)';
      ctx.fill();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#5fd38d';
      ctx.stroke();
      if (Math.hypot(sx - px, sy - py) > 4) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      const note = 'Zona fija: no se podrá cambiar';
      ctx.strokeText(note, sx, sy + 22);
      ctx.fillStyle = '#d8f5e4';
      ctx.fillText(note, sx, sy + 22);
    }
    if (kind === 'factory' && ok && !check.upgrade) this._drawRailPreview(tile, sx, sy);
    if (check.upgrade) {
      // Mejora de un edificio existente: se marca el propio edificio
      const b = check.upgrade;
      [sx, sy] = camera.worldToScreen(map.x(b.tile) + 0.5, map.y(b.tile) + 0.5);
    }
    const color = ok ? '#5fd38d' : '#ff6b6b';
    if (BUILDINGS[kind]?.unit === 'missile') {
      // Zona que arrasará y trayectoria desde el silo elegido (el MIRV cae por todo el país)
      ctx.beginPath();
      ctx.arc(sx, sy, CONFIG.missileRadius * (kind === 'hbomb' ? CONFIG.hbombRadius : 1) * camera.zoom, 0, Math.PI * 2);
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
    drawBuildingReal(ctx, kind, sx, sy, size, { ring: color });
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

  /** Acerca cada nombre a su sitio nuevo poco a poco (se recalcula cada medio segundo). */
  _glideLabels() {
    const k = this.anim ? 1 - Math.exp(-this._dt / 0.3) : 1;
    for (const L of this.labels) {
      L.x += (L.tx - L.x) * k;
      L.y += (L.ty - L.y) * k;
      L.r += (L.tr - L.r) * k;
    }
  }

  _drawLabels() {
    this._glideLabels();
    const { ctx, camera } = this;
    // ¿Cambia el zoom en este fotograma? (zoom suave, vuelo o pellizco)
    const zooming = !!(camera.zoomTarget || camera.tween || this._lastZoom !== camera.zoom);
    this._lastZoom = camera.zoom;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const human = this.game.human;
    // Primero tú, tus aliados y los demás jugadores; luego las naciones y al
    // final las colonias, de mayor a menor. Si un nombre pisa a otro ya
    // dibujado, se omite (al alejar no se amontonan).
    const order = (this._labelOrder ??= []);
    order.length = 0;
    for (const L of this.labels) {
      const p = L.player;
      // Las colonias, después de todas las naciones
      // El que ya se veía tiene preferencia (un 30 % más de radio): así dos
      // nombres parecidos que se pisan no se turnan en cada fotograma
      L.rank = (p === human ? 4e9 : 0) + (human && human.allies.has(p.id) ? 3e9 : 0) + (p.isHuman ? 2e9 : 0) + (p.weak ? 0 : 1e9) + L.r * (L.shown ? 1.3 : 1);
      L.size = 0;
      order.push(L);
    }
    order.sort((a, b) => b.rank - a.rank);
    const boxes = (this._labelBoxes ??= []);
    boxes.length = 0;
    // Cajas de los nombres de este fotograma (para tocar un país por su nombre)
    const hits = (this._labelHits ??= []);
    hits.length = 0;
    // Los nombres aparecen con un fundido (antes saltaban al entrar en pantalla
    // o al dejar de chocar con otro); el que no se dibuja vuelve a empezar
    const fadeStep = this.anim ? Math.min(1, this._dt * 5) : 1;
    for (const L of order) {
      L.was = L.shown;
      L.shown = false;
      L.fading = false;
    }
    for (const L of order) {
      const p = L.player;
      const [sx, sy] = camera.worldToScreen(L.x, L.y);
      if (sx < -200 || sy < -100 || sx > camera.viewW + 200 || sy > camera.viewH + 100) continue;
      const radiusPx = L.r * camera.zoom;
      const allied = human && p !== human && human.allies.has(p.id);
      const player = p.isHuman;
      // Bots (naciones y colonias): placa solo cuando el país se ve grande;
      // al alejar no (eran cientos de placas). Un poco de margen para el que
      // ya se veía, así no aparece y desaparece en el límite
      if (!allied && !player) {
        const k = L.was ? 0.85 : 1;
        const minR = (p.weak ? COLONY_LABEL_R : BOT_LABEL_R) * k;
        const minZoom = (p.weak ? COLONY_LABEL_ZOOM : BOT_LABEL_ZOOM) * k;
        if (radiusPx < minR && camera.zoom * (RES / 2) < minZoom) continue;
      }
      const len = Math.max(4, p.name.length + (allied ? 2 : 0));
      // Lo que cabe dentro del país…
      let size = Math.min(radiusPx * 0.6, (radiusPx * 2.6) / len, 28);
      // …pero al alejar el nombre no encoge con él: tamaño mínimo legible que
      // crece un poco con el país (aunque se salga de sus fronteras); las
      // colonias, algo más pequeñas
      if (radiusPx >= 2) size = Math.max(size, p.weak ? Math.min(12, 8 + radiusPx * 0.8) : Math.min(16, 9 + radiusPx * 1.1));
      // Los jugadores y aliados se nombran siempre, aunque sean pequeños
      if (allied || player) size = Math.max(size, 13);
      if (size < 8) continue;
      // Tamaño en pasos de 1 px (2 px en los grandes): así la imagen guardada
      // del nombre sirve muchos fotogramas seguidos
      size = size < 20 ? Math.round(size) : Math.round(size / 2) * 2;
      const traitor = this.game.isTraitor(p);
      const me = p === human;
      const s2 = Math.round(size * 0.78);
      // Mientras la cámara hace zoom, el tamaño cambia en cada fotograma: se
      // reutiliza la imagen ya dibujada del nombre (y de las cifras), escalada,
      // y se vuelve a dibujar nítida cuando el zoom se para
      let N = null;
      let k = 1;
      if (zooming) {
        const e = this._labelEntry(p).name;
        if (e.canvas && e.size) {
          N = e;
          k = size / e.size;
        }
      }
      if (!N) N = this._nameSprite(p, size, me, allied, traitor, player);
      const ds2 = zooming && L.s2 ? L.s2 : s2;
      if (!zooming) L.s2 = s2;
      // Caja que ocupa (icono + nombre + tropas) para no pisar otros nombres
      const w = N.w * k;
      const x0 = sx - w / 2 - N.iconW * k - 2;
      const x1 = sx + w / 2 + 2;
      const y0 = sy - size * 0.95;
      const y1 = sy + size * 0.6 + s2 * 0.6;
      // Margen: el que ya se veía solo se quita si el choque es claro, y el
      // que no, solo aparece con algo de hueco (sin turnarse en el límite)
      const m = L.was ? -0.12 : 0.08;
      const mx = (x1 - x0) * m;
      const my = (y1 - y0) * m;
      let hit = false;
      for (let i = 0; i < boxes.length && !hit; i += 4) {
        hit = x0 - mx < boxes[i + 2] && x1 + mx > boxes[i] && y0 - my < boxes[i + 3] && y1 + my > boxes[i + 1];
      }
      const d = this.dpr;
      if (hit && !me) {
        // Tapado por otro: se desvanece en vez de desaparecer de golpe
        if (L.alpha > 0 && this.anim) {
          L.alpha = Math.max(0, L.alpha - fadeStep * 1.5);
          L.fading = true;
          ctx.globalAlpha = L.alpha;
          if (k === 1) ctx.drawImage(N.canvas, Math.round((sx - N.tx) * d) / d, Math.round((sy - size * 0.35 - N.ty) * d) / d, N.canvas.width / d, N.canvas.height / d);
          else ctx.drawImage(N.canvas, sx - N.tx * k, sy - size * 0.35 - N.ty * k, (N.canvas.width / d) * k, (N.canvas.height / d) * k);
          ctx.globalAlpha = 1;
        }
        continue;
      }
      boxes.push(x0, y0, x1, y1);
      if (!me) hits.push(L, x0, y0, x1, y1);
      L.size = size;
      // Nombre (con su icono) y tropas: imágenes ya dibujadas, centradas
      // En píxeles enteros del lienzo: copia directa, sin remuestrear
      L.shown = true;
      L.alpha = Math.min(1, (L.alpha || 0) + fadeStep);
      if (L.alpha < 1) ctx.globalAlpha = L.alpha;
      if (k === 1) ctx.drawImage(N.canvas, Math.round((sx - N.tx) * d) / d, Math.round((sy - size * 0.35 - N.ty) * d) / d, N.canvas.width / d, N.canvas.height / d);
      else ctx.drawImage(N.canvas, sx - N.tx * k, sy - size * 0.35 - N.ty * k, (N.canvas.width / d) * k, (N.canvas.height / d) * k);
      this._drawTroops((me ? fmtTroopsCount : formatTroops)(this._smoothed(p, p.troops)), sx, sy + size * 0.6, ds2, me, s2 / ds2);
      if (L.alpha < 1) ctx.globalAlpha = 1;
    }
    for (const L of order) if (!L.shown && !L.fading) L.alpha = 0;
    // Trozos sueltos de cada nación: su bandera, si se ven y hay sitio
    for (const X of this.exclaves) {
      if (!X.player.alive) continue;
      const [sx, sy] = camera.worldToScreen(X.x, X.y);
      if (sx < -20 || sy < -20 || sx > camera.viewW + 20 || sy > camera.viewH + 20) continue;
      const rp = X.r * camera.zoom;
      if (rp < 5) continue;
      const h = Math.round(clamp(rp * 0.7, 9, 16));
      const e = this._ensign(X.player, h, false);
      const x0 = sx - e.w / 2;
      const y0 = sy - e.h / 2;
      const x1 = x0 + e.w;
      const y1 = y0 + e.h;
      let hit = false;
      for (let i = 0; i < boxes.length && !hit; i += 4) hit = x0 < boxes[i + 2] && x1 > boxes[i] && y0 < boxes[i + 3] && y1 > boxes[i + 1];
      if (hit) continue;
      boxes.push(x0, y0, x1, y1);
      ctx.drawImage(e, Math.round(x0), Math.round(y0), e.w, e.h);
    }
  }

  /**
   * Cifra que cambia a saltos en cada turno (tropas), mostrada subiendo o
   * bajando poco a poco entre un turno y el siguiente: así cuenta de forma
   * continua en vez de ir a tirones. `obj` es su dueño (nación o ataque).
   */
  _smoothed(obj, value) {
    const tick = this.game.ticks;
    let e = this._smooth.get(obj);
    if (!e) {
      this._smooth.set(obj, (e = { tick, from: value, to: value, shown: value }));
      return value;
    }
    if (e.tick !== tick) {
      // Si hacía rato que no se veía, sin animación (iría desde un valor viejo)
      e.from = tick - e.tick > 3 ? value : e.shown;
      e.to = value;
      e.tick = tick;
    }
    e.shown = e.from + (e.to - e.from) * this._fracEarly;
    return e.shown;
  }

  /** Lienzo de una caché de nombres (se reutiliza el elemento si ya existe). */
  _spriteCanvas(old, cw, ch) {
    const c = old || document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(cw * this.dpr));
    c.height = Math.max(1, Math.ceil(ch * this.dpr));
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    return g;
  }

  _labelEntry(p) {
    const cache = (this._labelSprites ??= new Map());
    let e = cache.get(p.id);
    if (!e) cache.set(p.id, (e = { name: {}, troops: {} }));
    return e;
  }

  /**
   * Nombre de una nación ya dibujado (texto e icono a la izquierda),
   * guardado como imagen: dibujar texto con contorno cada fotograma es caro, y
   * en el móvil se nota. Solo se rehace si cambia algo de lo que se ve.
   */
  _nameSprite(p, size, me, allied, traitor, player) {
    const e = this._labelEntry(p).name;
    const color = me ? this.options.nameColor || '#ffd23f' : '';
    const flag = flagReady() && hasFlag(p.flag);
    const key = `${p.name}|${size}|${me}|${allied}|${traitor}|${player}|${color}|${flag}|${this.dpr}`;
    if (e.key === key) return e;
    e.key = key;
    e.size = size;
    const name = traitor ? `⚠ ${p.name}` : allied ? `${p.name} 🤝` : p.name;
    const font = `${me ? 800 : player ? 600 : 500} ${size}px system-ui, sans-serif`;
    const mc = this.ctx;
    mc.font = font;
    const w = mc.measureText(name).width;
    const lw = Math.max(2.5, size / (me ? 4 : 6));
    const blur = me ? Math.min(16, size * 0.6) : 0;
    const pad = Math.ceil(lw + blur / this.dpr + 2);
    const iconW = player || size >= 11 ? size * 1.45 : 0;
    e.w = w;
    e.iconW = iconW;
    e.cw = iconW + w + pad * 2;
    e.ch = size * 1.7 + pad * 2;
    e.tx = pad + iconW + w / 2;
    e.ty = pad + size * 0.85;
    const g = this._spriteCanvas(e.canvas, e.cw, e.ch);
    e.canvas = g.canvas;
    // Nombres de mapa: texto gris oscuro con un halo claro muy tenue (solo
    // se nota si el nombre se sale sobre el mar); aliados en verde y traidores
    // en rojo, oscuros. El tuyo, en su color vivo, con contorno y un halo para
    // encontrarlo de un vistazo
    g.font = font;
    g.fillStyle = me ? color : allied ? '#0e4d28' : traitor ? '#7a1d12' : 'rgba(48, 48, 48, 0.92)';
    g.lineWidth = me ? lw : Math.max(2, size / 7);
    g.strokeStyle = me ? 'rgba(20, 12, 0, 0.85)' : 'rgba(255, 255, 255, 0.3)';
    g.strokeText(name, e.tx, e.ty);
    if (me) {
      g.shadowColor = color;
      g.shadowBlur = blur;
    }
    g.fillText(name, e.tx, e.ty);
    g.shadowBlur = 0;
    g.shadowColor = 'transparent';
    if (player && flag) {
      // Jugador con la bandera de un país como emblema: la bandera y una insignia pequeña de persona
      const fx = e.tx - w / 2 - size * 0.85;
      drawFlag(g, p.flag, fx, e.ty, size * 0.8);
      drawPlayerBadge(g, fx + size * 0.5, e.ty + size * 0.38, size * 0.6, p.color);
    } else if (player) {
      // Jugador de verdad (no un bot): insignia con una silueta de persona
      drawPlayerBadge(g, e.tx - w / 2 - size * 0.75, e.ty, size * 1.05, p.color);
    } else if (iconW) {
      // Bandera (países reales) o emblema a la izquierda del nombre
      if (!flag || !drawFlag(g, p.flag, e.tx - w / 2 - size * 0.85, e.ty, size * 0.8)) {
        drawEmblem(g, emblemFor(p), e.tx - w / 2 - size * 0.75, e.ty, size * 1.15);
      }
    }
    return e;
  }

  /**
   * Juego de caracteres de las cifras de tropas (0-9 . k M) ya dibujados para
   * un tamaño: las tuyas en tu color, con contorno; las de los rivales en gris
   * oscuro con un halo claro muy tenue (como sus nombres). Las cifras cambian casi a cada turno, así que se
   * componen carácter a carácter en vez de dibujar texto cada fotograma.
   */
  _digitFont(s2, me) {
    const color = me ? this.options.nameColor || '#ffd23f' : '';
    const key = `${s2}|${color}|${this.dpr}`;
    const fonts = (this._digitFonts ??= new Map());
    let f = fonts.get(key);
    if (f) return f;
    if (fonts.size > 48) fonts.clear();
    const chars = '0123456789.kM';
    const font = `${me ? 600 : 500} ${s2}px system-ui, sans-serif`;
    const lw = Math.max(2.5, s2 / 5);
    const pad = Math.ceil(lw / 2 + 1);
    const mc = this.ctx;
    mc.font = font;
    const widths = {};
    const xs = {};
    let x = 0;
    for (const ch of chars) {
      widths[ch] = mc.measureText(ch).width;
      xs[ch] = x;
      x += Math.ceil(widths[ch] + pad * 2) + 2; // 2 px de separación: sin sangrado
    }
    const cellH = Math.ceil(s2 * 1.4 + pad * 2);
    // Arriba solo el contorno y abajo solo el relleno: se dibujan en dos
    // pasadas para que el contorno de un carácter no tape al anterior
    const g = this._spriteCanvas(null, x, cellH * 2 + 2);
    g.font = font;
    g.textAlign = 'left';
    g.lineWidth = me ? lw : Math.max(2, s2 / 6);
    g.strokeStyle = me ? 'rgba(20, 12, 0, 0.85)' : 'rgba(255, 255, 255, 0.3)';
    g.fillStyle = me ? color : 'rgba(48, 48, 48, 0.92)';
    const ty = pad + s2 * 0.7;
    for (const ch of chars) {
      g.strokeText(ch, xs[ch] + pad, ty);
      g.fillText(ch, xs[ch] + pad, Math.round((cellH + 2) * this.dpr) / this.dpr + ty);
    }
    f = { canvas: g.canvas, widths, xs, pad, cellH, ty };
    fonts.set(key, f);
    return f;
  }

  /** Cifra de tropas centrada en (cx, cy) con el juego de caracteres guardado. */
  /** `scale`: durante el zoom, el juego de cifras de `s2` dibujado a escala (sin rehacerlo). */
  _drawTroops(text, cx, cy, s2, me, scale = 1) {
    const f = this._digitFont(s2, me);
    const { ctx, dpr } = this;
    let w = 0;
    for (let i = 0; i < text.length; i++) w += f.widths[text[i]] || 0;
    w *= scale;
    // Cada carácter, en píxeles enteros del lienzo (copia directa, sin remuestrear)
    const ch = Math.round(f.cellH * dpr);
    const y = scale === 1 ? Math.round((cy - f.ty) * dpr) / dpr : cy - f.ty * scale;
    for (let pass = 0; pass < 2; pass++) {
      let x = cx - w / 2;
      const srcY = pass * Math.round((f.cellH + 2) * dpr);
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const cw = f.widths[c];
        if (cw === undefined) continue;
        const sw = Math.round((cw + f.pad * 2) * dpr);
        if (scale === 1) ctx.drawImage(f.canvas, Math.round(f.xs[c] * dpr), srcY, sw, ch, Math.round((x - f.pad) * dpr) / dpr, y, sw / dpr, ch / dpr);
        else ctx.drawImage(f.canvas, Math.round(f.xs[c] * dpr), srcY, sw, ch, x - f.pad * scale, y, (sw / dpr) * scale, (ch / dpr) * scale);
        x += cw * scale;
      }
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
    // Por encima del nombre tal y como se ha dibujado en este fotograma, con
    // un pequeño vaivén
    const nameSize = L.size || 0;
    const lift = (nameSize ? nameSize * 1.1 : 0) + 18 + Math.sin(now / 260) * 3;
    // El globo se dibuja una vez (por color y resolución) y se copia
    const d = this.dpr;
    const key = `${human.color}|${d}`;
    if (this._youKey !== key) {
      this._youKey = key;
      const W = 40;
      const H = 34;
      const g = this._spriteCanvas(this._youCanvas, W, H);
      this._youCanvas = g.canvas;
      const x = W / 2;
      const y = 22; // punta del globo en (x, y + 9)
      g.font = '800 11px system-ui, sans-serif';
      g.beginPath();
      g.roundRect(x - 17, y - 15, 34, 18, 9);
      g.moveTo(x - 5, y + 3);
      g.lineTo(x, y + 9);
      g.lineTo(x + 5, y + 3);
      g.fillStyle = rgbToCss(human.color);
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = '#ffffff';
      g.stroke();
      g.fillStyle = '#ffffff';
      g.fillText('TÚ', x, y - 6 + 0.5);
    }
    const c = this._youCanvas;
    ctx.drawImage(c, Math.round((sx - 20) * d) / d, Math.round((sy - lift - 22) * d) / d, c.width / d, c.height / d);
  }

  /**
   * Punto del frente de un ataque, estable: se recalcula una vez por tick con
   * una muestra repartida por todo el frente y el marcador se desliza hacia él
   * con suavidad (antes saltaba de un sitio a otro). También suaviza la
   * dirección del avance. Devuelve { x, y, ang } o null.
   */
  _front(atk) {
    if (!atk.inFrontier.size) return null;
    const tick = this.game.ticks;
    let f = this._attackFronts.get(atk);
    if (!f || f.tick !== tick) {
      const W = this.game.map.width;
      const n = atk.inFrontier.size;
      const stride = Math.max(1, Math.ceil(n / 160));
      let sx = 0;
      let sy = 0;
      let c = 0;
      let i = 0;
      for (const t of atk.inFrontier) {
        if (i++ % stride) continue;
        sx += t % W;
        sy += (t / W) | 0;
        c++;
      }
      const tx = sx / c + 0.5;
      const ty = sy / c + 0.5;
      if (!f) {
        f = { x: tx, y: ty, tx, ty, ang: null, tick, frame: -1 };
        this._attackFronts.set(atk, f);
      }
      f.tx = tx;
      f.ty = ty;
      f.tick = tick;
    }
    if (f.frame !== this._gen) {
      f.frame = this._gen;
      // Si el frente salta muy lejos (otro sector), se recoloca de golpe
      if (Math.abs(f.tx - f.x) + Math.abs(f.ty - f.y) > 60 * RES) {
        f.x = f.tx;
        f.y = f.ty;
      }
      const k = Math.min(1, this._dt * 2.2);
      f.x += (f.tx - f.x) * k;
      f.y += (f.ty - f.y) * k;
      const L = this.labelById.get(atk.attacker.id);
      if (L) {
        const a = Math.atan2(f.y - L.y, f.x - L.x);
        f.ang = f.ang === null ? a : turn(f.ang, a, Math.min(1, this._dt * 1.5));
      }
    }
    return f;
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
      const f = this._front(atk);
      if (!f || f.ang === null) continue;
      const [sx, sy] = camera.worldToScreen(f.x, f.y);
      if (!this._onScreen(sx, sy, 80)) continue;
      const dx = Math.cos(f.ang);
      const dy = Math.sin(f.ang);
      const rgb = incoming ? '255, 90, 90' : mine ? '80, 230, 140' : prgb(atk.attacker);
      // Flechas discretas: marcan el sentido sin tapar lo que se ataca
      const s = incoming || mine ? 6 : 4.2;
      const lw = incoming || mine ? 2.4 : 1.8;
      for (let k = 0; k < 3; k++) {
        const u = (k + phase) / 3;
        const off = 10 + u * 33;
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
   * Marcador con las tropas de cada ataque entre el humano y otra nación:
   * rojo si le atacan, verde si ataca él. Pequeño y algo translúcido, y del
   * lado del atacante (detrás del frente), para que se vea lo que se ataca.
   */
  _drawAttackBadges() {
    const { ctx, game, camera } = this;
    const human = game.human;
    if (!human || !game.attacks.length || this.options.badges === false) return;
    const fs = COARSE ? 9 : 10;
    const h = fs + 5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    for (const atk of game.attacks) {
      if (atk.done || atk.troops < 1 || !atk.targetId) continue;
      const incoming = atk.targetId === human.id;
      if (!incoming && atk.attacker !== human) continue;
      const f = this._front(atk);
      if (!f) continue;
      let [x, y] = camera.worldToScreen(f.x, f.y);
      if (f.ang !== null) {
        x -= Math.cos(f.ang) * (h + 4);
        y -= Math.sin(f.ang) * (h + 4);
      }
      if (x < -60 || y < -30 || x > camera.viewW + 60 || y > camera.viewH + 30) continue;
      const text = `${incoming ? '🛡' : '⚔'} ${formatTroops(this._smoothed(atk, atk.troops))}`;
      // Ancho por escalones: no «baila» cada vez que cambia una cifra
      const w = Math.max(40, Math.ceil((ctx.measureText(text).width + 10) / 8) * 8);
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
      ctx.fillStyle = incoming ? 'rgba(170, 36, 36, 0.78)' : 'rgba(20, 120, 68, 0.78)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = incoming ? 'rgba(255, 179, 179, 0.85)' : 'rgba(168, 245, 198, 0.85)';
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
      // Edad continua (entre turnos también), para que suba sin tirones
      const age = game.ticks - e.tick + (this._frac || 0);
      const sy = sy0 - 34 - age * 0.4;
      ctx.globalAlpha = Math.max(0, Math.min(1, (CONFIG.emojiTicks - age) / 10));
      // Al aparecer, un pequeño rebote (de 0,6 a 1 pasándose un poco)
      const k = Math.min(1, age / 3);
      const back = 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;
      const pop = 0.6 + 0.4 * back;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(pop, pop);
      ctx.translate(-sx, -sy);
      ctx.beginPath();
      ctx.arc(sx, sy, 17, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = pcss(sender);
      ctx.stroke();
      ctx.font = '20px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';
      ctx.fillText(e.emoji, sx, sy + 1);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  _drawSpawnMarker(now) {
    const { ctx, game, camera } = this;
    const h = game.human;
    if (!h || !h.spawned) return;
    const map = game.map;
    const [sx, sy] = camera.worldToScreen(map.x(h.spawnTile) + SPAWN_C, map.y(h.spawnTile) + SPAWN_C);
    const pulse = (Math.sin(now / 200) + 1) / 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 14 + pulse * 8, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + pulse * 0.5})`;
    ctx.stroke();
  }
}

/**
 * Insignia de jugador humano: círculo de su color con borde blanco y una
 * silueta de persona (cabeza y hombros) en blanco.
 */
function drawPlayerBadge(ctx, cx, cy, d, color) {
  const r = d / 2;
  const lw = Math.max(1.5, d * 0.1);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.22, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.78, r * 0.62, r * 0.55, 0, Math.PI, 0);
  ctx.fill();
  ctx.restore();
  // Contorno oscuro fino para que se lea sobre colores claros
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + lw * 0.5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(20, 24, 32, 0.55)';
  ctx.stroke();
  ctx.restore();
}
