// Dibujo en canvas. Capas, de abajo arriba:
//   mapa (mar + tierra, una sola imagen) → territorios → destellos
//   de las casillas recién conquistadas → cráteres →
//   edificios → barcos → partículas → misiles → viñeta → nombres y marcadores.
// Barcos y misiles se interpolan entre ticks para que se muevan con suavidad.
import { BUILDINGS, CONFIG, RES, TICK_MS } from './config.js';
import { mutedRgb, rgbToCss, shadeRgb, vividRgb } from './colors.js';
import { fmtTroops, fmtTroopsCount, formatNumber, formatTroops } from './format.js';
import { PATTERN_FNS, drawBuildingReal, drawEmblem, drawFlag, drawPointIcon, emblemFor, flagReady, hasFlag } from './icons.js';
import { paintTerrain } from './terreno.js';
import { Fx, drawMissileSprite } from './fx.js';
import { drawCargo, drawFishing, drawTransport, drawWarship } from './barcos.js';

const FILL_ALPHA = 128; // territorio semitransparente: se ve el terreno debajo
const LABEL_INTERVAL_MS = 500;
const FLASH_N = 16384;
const FLASH_DRAW_MAX = 3000; // destellos dibujados como mucho por fotograma (los más recientes)
const CHUNK = 64; // lado (en casillas) de los bloques del territorio que se suben a la gráfica
// Píxeles por casilla de la capa de territorio: con 2, la frontera ocupa media
// casilla (el lado que da al vecino). En mapas enormes, 1 (frontera de una casilla)
const TERRITORY_TS = 2;
const TERRITORY_MAX_PX = 9e6;
// Brillo de las casillas recién conquistadas, pintado en el propio territorio:
// fuerte al conquistar, a medias a los GLOW_MID ms y normal a los GLOW_END ms
const GLOW_N = 32768;
const GLOW_MID = [140, 110]; // combate, tierra libre
const GLOW_END = [420, 300];
const GLOW_MIX = [
  [[255, 232, 170, 0.7], [255, 214, 150, 0.32]], // combate: brasa
  [[255, 255, 255, 0.5], [255, 255, 255, 0.22]], // tierra libre: luz
];
const FLASH_LIFE = [700, 450, 1400]; // combate, tierra libre, arrasada (ms)
const FLASH_COLORS = [
  ['rgba(255, 240, 190, 0.9)', 'rgba(255, 160, 70, 0.6)', 'rgba(210, 70, 30, 0.32)'],
  ['rgba(255, 255, 255, 0.32)', 'rgba(255, 255, 255, 0.18)', 'rgba(255, 255, 255, 0.08)'],
  ['rgba(255, 150, 60, 0.85)', 'rgba(200, 50, 20, 0.55)', 'rgba(70, 20, 10, 0.4)'],
];
const ALLY_STRIPE = [96, 226, 140];

const lerp = (a, b, t) => a + (b - a) * t;

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
    this._paintAllTerritory();

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
    this.border = new Uint32Array(n); // frontera: media casilla, opaca
    this.border2 = new Uint32Array(n); // mitad interior de la frontera: solo la tuya (resaltado)
    this.ring2 = new Uint8Array(n);
    this.patterns = new Array(n).fill(null);
    this.allied = new Uint8Array(n);
    this.glowCol = GLOW_MIX.map(() => [new Uint32Array(n), new Uint32Array(n)]);
    const human = this.game.human;
    for (const p of this.game.players) {
      if (!p) continue;
      // Relleno: el color de la nación en un tono pálido y semitransparente
      // (se ve el terreno debajo). Frontera fina y opaca en el mismo tono, más oscuro
      const pale = mutedRgb(p.color, 0.34, 0.64, 0.74);
      const [r, g, b] = pale;
      const ally = !!(human && p !== human && human.allies.has(p.id));
      this.allied[p.id] = ally ? 1 : 0;
      this.fill[p.id] = pack(r, g, b, FILL_ALPHA);
      this.inner[p.id] = this.fill[p.id]; // sin franja interior: el territorio es plano
      // Patrón del perfil: algunas casillas con un tono más oscuro.
      // Los aliados llevan franjas verdes en diagonal: se reconocen de un vistazo.
      this.patterns[p.id] = PATTERN_FNS[p.pattern] || null;
      const [ar, ag, ab] = ally ? ALLY_STRIPE : shadeRgb(pale, 0.8);
      this.alt[p.id] = pack(ar, ag, ab, ally ? 215 : Math.min(255, FILL_ALPHA + 40));
      // Frontera blanca para ti y verde para tus aliados; las demás, su tono
      // pálido más oscuro
      const bc = p === human ? [255, 255, 255] : ally ? [120, 245, 165] : shadeRgb(pale, 0.58);
      this.border[p.id] = pack(bc[0], bc[1], bc[2], 255);
      // Tu nación, resaltada: por dentro de la frontera blanca, otra media
      // casilla en tu color vivo
      if (p === human) {
        const b2 = vividRgb(p.color, 0.1, 1.12, 0.36, 0.72);
        this.border2[p.id] = pack(b2[0], b2[1], b2[2], 210);
        this.ring2[p.id] = 1;
      }
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
      P[i] = l && r && u && d ? col : this.border[o];
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
    if (dirty.length) {
      // Turno nuevo: primero se termina de mostrar el anterior
      this._reveal(1, now);
      this._queueChanges(dirty);
      dirty.length = 0;
    }
    if (this._runN) this._reveal(this.anim ? this._fracEarly : 1, now);
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
        const x = t % W;
        const y = (t / W) | 0;
        const kind = was && o ? 0 : o ? 1 : 2;
        if (kind < 2) {
          if (glowOn && this._inView(x, y, 2)) this._pushGlow(t, o, now, kind);
        } else this._pushFlash(t, now, kind);
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
   * tamaño de letra.
   */
  _updateLabels() {
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
    const half = F >> 1;
    for (let y = 0; y < H; y++) {
      const sy = Math.min(map.height - 1, y * F + half) * MW;
      for (let x = 0; x < W; x++) own[y * W + x] = owner[sy + Math.min(MW - 1, x * F + half)];
    }
    const d = this.distField;
    for (let i = 0; i < n; i++) {
      const o = own[i];
      if (!o) {
        d[i] = 0;
        continue;
      }
      const x = i % W;
      const edge =
        x === 0 || x === W - 1 || i < W || i >= n - W ||
        own[i - 1] !== o || own[i + 1] !== o || own[i - W] !== o || own[i + W] !== o;
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
    for (const p of players) {
      if (!p || !p.alive || at[p.id] < 0) continue;
      const tx = (at[p.id] % W) * F + F / 2;
      const ty = Math.floor(at[p.id] / W) * F + F / 2;
      const tr = best[p.id] * F;
      const prev = old.get(p.id);
      // Si el sitio nuevo queda lejos (otro trozo del país), va directo
      const near = prev && Math.abs(prev.x - tx) + Math.abs(prev.y - ty) < Math.max(40, tr * 3);
      const L = { player: p, tx, ty, tr, x: near ? prev.x : tx, y: near ? prev.y : ty, r: near ? prev.r : tr };
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
        this._allySig = sig;
        this._buildPalette();
        this._paintAllTerritory();
      }
    }
    this._flushDirty(now);
    this._updateGlowsAndUpload(now);
    if (now - this.lastLabelTime > (this.lite ? 2 : 1) * LABEL_INTERVAL_MS) {
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
    }
    this._drawFlashes(now);

    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    ctx.imageSmoothingEnabled = true;
    this.fx.drawDecals(ctx, camera);
    this._drawRails();
    this._drawBuildings(now);
    this._drawPoints(now);
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
    // Iconos pequeños y discretos: el mapa manda
    return Math.min(30, Math.max(11, this.camera.zoom * RES * 3));
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
      const spr = this._buildingSprite(b.kind, p, size);
      const w = spr.width / this.dpr;
      ctx.drawImage(spr, sx - w / 2, sy - w / 2, w, w);
      ctx.globalAlpha = 1;
      if (building) this._drawConstruction(sx, sy, size, game.buildProgress(b), now);
      else {
        if ((b.kind === 'sam' || b.kind === 'silo') && b.level > 0) this._drawReload(sx, sy, size, b);
        if (b.level > 1) this._drawLevel(sx, sy, size, b.level);
      }
      if (b.kind === 'port' && b.hp < CONFIG.portHp) this._hpBar(sx, sy - size * 0.75, size, b.hp / CONFIG.portHp);
    }
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
      drawTrain(ctx, px, py, ang, L, owner ? rgbToCss(owner.color) : '#888');
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
  _drawLevel(sx, sy, size, level) {
    const { ctx } = this;
    const r = Math.max(6.5, size * 0.3);
    const x = sx;
    const y = sy - size * 0.62 - r * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd34d';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.22);
    ctx.strokeStyle = 'rgba(40, 26, 0, 0.9)';
    ctx.stroke();
    ctx.fillStyle = '#2a1a00';
    ctx.font = `900 ${Math.round(r * 1.35)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(level), x, y + r * 0.08);
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
        const text = fmtTroops(b.troops);
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
      // Zona de patrulla de tus buques: círculo discontinuo y, si va hacia allí, la línea
      if (p === game.human && ws.patrol >= 0) {
        const [px, py] = camera.worldToScreen((ws.patrol % W) + 0.5, Math.floor(ws.patrol / W) + 0.5);
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(px, py, CONFIG.warshipPatrol * z, 0, Math.PI * 2);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(160, 210, 255, 0.35)';
        ctx.stroke();
        if (Math.hypot(px - sx, py - sy) > CONFIG.warshipPatrol * z) {
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(px, py);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.stroke();
        }
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
        const color = rgbToCss(game.players[m.owner].color);
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
      L.rank = (p === human ? 4e9 : 0) + (human && human.allies.has(p.id) ? 3e9 : 0) + (p.isHuman ? 2e9 : 0) + (p.weak ? 0 : 1e9) + L.r;
      L.size = 0;
      order.push(L);
    }
    order.sort((a, b) => b.rank - a.rank);
    const boxes = (this._labelBoxes ??= []);
    boxes.length = 0;
    for (const L of order) {
      const p = L.player;
      const [sx, sy] = camera.worldToScreen(L.x, L.y);
      if (sx < -200 || sy < -100 || sx > camera.viewW + 200 || sy > camera.viewH + 100) continue;
      const radiusPx = L.r * camera.zoom;
      const allied = human && p !== human && human.allies.has(p.id);
      const player = p.isHuman;
      // Colonias: solo con nombre cuando se ven de un tamaño razonable (en la
      // vista global del arranque eran cientos de etiquetas diminutas)
      if (p.weak && !allied && radiusPx < 7) continue;
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
      const N = this._nameSprite(p, size, me, allied, traitor, player);
      const s2 = Math.round(size * 0.78);
      // Caja que ocupa (icono + nombre + tropas) para no pisar otros nombres
      const w = N.w;
      const x0 = sx - w / 2 - N.iconW - 2;
      const x1 = sx + w / 2 + 2;
      const y0 = sy - size * 0.95;
      const y1 = sy + size * 0.6 + s2 * 0.6;
      let hit = false;
      for (let i = 0; i < boxes.length && !hit; i += 4) {
        hit = x0 < boxes[i + 2] && x1 > boxes[i] && y0 < boxes[i + 3] && y1 > boxes[i + 1];
      }
      if (hit && !me) continue;
      boxes.push(x0, y0, x1, y1);
      L.size = size;
      // Nombre (con su icono) y tropas: imágenes ya dibujadas, centradas
      // En píxeles enteros del lienzo: copia directa, sin remuestrear
      const d = this.dpr;
      ctx.drawImage(N.canvas, Math.round((sx - N.tx) * d) / d, Math.round((sy - size * 0.35 - N.ty) * d) / d, N.canvas.width / d, N.canvas.height / d);
      this._drawTroops((me ? fmtTroopsCount : formatTroops)(this._smoothed(p, p.troops)), sx, sy + size * 0.6, s2, me);
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
  _drawTroops(text, cx, cy, s2, me) {
    const f = this._digitFont(s2, me);
    const { ctx, dpr } = this;
    let w = 0;
    for (let i = 0; i < text.length; i++) w += f.widths[text[i]] || 0;
    // Cada carácter, en píxeles enteros del lienzo (copia directa, sin remuestrear)
    const ch = Math.round(f.cellH * dpr);
    const y = Math.round((cy - f.ty) * dpr) / dpr;
    for (let pass = 0; pass < 2; pass++) {
      let x = cx - w / 2;
      const srcY = pass * Math.round((f.cellH + 2) * dpr);
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const cw = f.widths[c];
        if (cw === undefined) continue;
        const sw = Math.round((cw + f.pad * 2) * dpr);
        ctx.drawImage(f.canvas, Math.round(f.xs[c] * dpr), srcY, sw, ch, Math.round((x - f.pad) * dpr) / dpr, y, sw / dpr, ch / dpr);
        x += cw;
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
      const f = this._front(atk);
      if (!f) continue;
      const [x, y] = camera.worldToScreen(f.x, f.y);
      if (x < -60 || y < -30 || x > camera.viewW + 60 || y > camera.viewH + 30) continue;
      const text = `${incoming ? '🛡' : '⚔'} ${formatTroops(this._smoothed(atk, atk.troops))}`;
      // Ancho por escalones: no «baila» cada vez que cambia una cifra
      const w = Math.max(64, Math.ceil((ctx.measureText(text).width + 14) / 10) * 10);
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
