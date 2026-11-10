// Resumen de partida: graba cómo va la partida (sin tocar la simulación, así
// que no afecta al multijugador) y lo dibuja al acabar.
//
// - Cada 2 s: porcentaje de tierra de las 8 primeras naciones y el tuyo, y tus
//   tropas, tu oro y tus casillas.
// - Momentos clave: lo importante de los avisos de la partida (eliminaciones,
//   alianzas y traiciones, capitales, bombas, derrota y victoria).
// - Repetición: una foto reducida del mapa de dueños cada 6 s (como mucho
//   150; al llenarse se descarta una de cada dos y se espacian el doble).
import { CONFIG, TICK_MS } from './config.js';

export const SAMPLE_TICKS = 20;
export const SNAP_TICKS = 60;
export const MAX_SNAPS = 150;
const MAX_MOMENTS = 60;
const SNAP_W = 320;
/** Valor de una casilla de agua en las fotos. */
export const WATER = 0xffff;

/** Segundos de partida (desde que acaba el despliegue) en el tick `tick`. */
export function gameSeconds(tick) {
  return (Math.max(0, tick - CONFIG.spawnTicks) * TICK_MS) / 1000;
}

/**
 * Puesto final de `p` entre las naciones (sin colonias): el ganador (o la
 * alianza ganadora) primero; los que siguen en pie, por territorio; los
 * eliminados, por cuánto aguantaron. Devuelve { place, of }.
 */
export function placement(game, p) {
  const nations = game.players.filter((x) => x && !x.weak);
  const winners = game.winningAlliance ? game.winningAlliance : game.winner ? [game.winner] : [];
  const rank = (x) => [
    winners.includes(x) ? 1 : 0,
    x.alive ? 1 : 0,
    x.alive ? x.tiles : x.eliminatedTick ?? 0,
  ];
  const better = (a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i];
    return false;
  };
  let place = 1;
  for (const x of nations) if (x !== p && better(x, p)) place++;
  return { place, of: nations.length };
}

/** Puntuación del puesto: 1 el primero, 0 el último. */
export function placementScore({ place, of }) {
  return of <= 1 ? 1 : 1 - (place - 1) / (of - 1);
}

/**
 * Qué aviso de la partida es un momento clave para `human` (o null):
 * { icon, text, tone } con tone 'bien', 'mal' o ''.
 */
export function momentOf(evt, game, human) {
  if (!evt || evt.feedback || evt.kind === 'request') return null;
  const text = String(evt.text || '');
  if (evt.loot) return { icon: '🏆', text: text.replace(/^🏆\s*/, ''), tone: 'bien' };
  if (text === 'Has sido derrotado') return { icon: '💀', text: 'Has sido derrotado', tone: 'mal' };
  if (/^¡Victoria|vas en cabeza: victoria/.test(text)) return { icon: '🏁', text: text.replace(/^¡Victoria!\s*/, 'Victoria: '), tone: 'bien' };
  if (/domina el mundo|va en cabeza$/.test(text) && evt.kind === 'danger') return { icon: '🏁', text, tone: 'mal' };
  if (evt.sfx === 'alliance') return { icon: text.startsWith('📜') ? '📜' : text.startsWith('🕊') ? '🕊' : '🤝', text: text.replace(/^[🤝📜🕊]\s*/u, ''), tone: 'bien' };
  if (evt.sfx === 'betray' || /^Has roto (la alianza|el pacto)/.test(text)) return { icon: '💔', text: text.replace(/^💔\s*/u, ''), tone: evt.sfx === 'betray' ? 'mal' : '' };
  if (evt.point !== undefined) return { icon: '⭐', text: text.replace(/^⭐\s*/u, ''), tone: evt.kind === 'good' ? 'bien' : 'mal' };
  if (/^🚀|^💥/u.test(text)) return { icon: text.startsWith('💥') ? '💥' : '🚀', text: text.replace(/^[🚀💥]\s*/u, ''), tone: evt.kind === 'danger' ? 'mal' : evt.kind === 'good' ? 'bien' : '' };
  if (evt.sfx === 'war' && /te ataca/.test(text)) return { icon: '⚔', text: text.replace(/^⚔\s*/u, ''), tone: 'mal', key: `ataque:${text.split(' te ataca')[0]}` };
  if (text === '¡Comienza la conquista!') return { icon: '🚩', text: 'Empieza la partida', tone: '' };
  return null;
}

export class Grabador {
  constructor(game, human) {
    this.game = game;
    this.human = human;
    this.land = Math.max(1, game.map.landCount);
    /** [{ t, me: [pct, tropas, oro, casillas], top: { id: pct } }] */
    this.samples = [];
    /** id → { name, color } de las naciones que han salido entre las 8 primeras */
    this.names = new Map();
    this.moments = [];
    this.snaps = [];
    this.snapEvery = SNAP_TICKS;
    this.nextSample = 0;
    this.nextSnap = 0;
    this._keys = new Set();
    const m = game.map;
    this.sw = Math.min(SNAP_W, m.width);
    this.sh = Math.max(1, Math.round((this.sw * m.height) / m.width));
    // Qué casilla del mapa representa cada píxel de la foto
    this._pick = new Int32Array(this.sw * this.sh);
    for (let y = 0; y < this.sh; y++) {
      const ty = Math.min(m.height - 1, Math.floor(((y + 0.5) * m.height) / this.sh));
      for (let x = 0; x < this.sw; x++) this._pick[y * this.sw + x] = ty * m.width + Math.min(m.width - 1, Math.floor(((x + 0.5) * m.width) / this.sw));
    }
  }

  /** Llamar tras cada paso de la simulación (cuesta poco: muestrea cada 2 s). */
  update() {
    const g = this.game;
    if (g.phase === 'spawn') return;
    if (g.ticks >= this.nextSample) {
      this._sample();
      this.nextSample = g.ticks + SAMPLE_TICKS;
    }
    if (g.ticks >= this.nextSnap) {
      this._snap();
      this.nextSnap = g.ticks + this.snapEvery;
    }
  }

  /** Último muestreo y última foto (al acabar o al abandonar). */
  finish() {
    const g = this.game;
    const last = this.samples[this.samples.length - 1];
    if (!last || last.t < gameSeconds(g.ticks)) this._sample();
    const lastSnap = this.snaps[this.snaps.length - 1];
    if (!lastSnap || lastSnap.t < gameSeconds(g.ticks)) this._snap();
  }

  /** Aviso de la partida: se queda si es un momento clave. */
  onEvent(evt) {
    if (this.moments.length >= MAX_MOMENTS) return;
    const m = momentOf(evt, this.game, this.human);
    if (!m) return;
    // Cada nación que te ataca sale una vez (la primera)
    if (m.key) {
      if (this._keys.has(m.key)) return;
      this._keys.add(m.key);
    }
    this.moments.push({ t: gameSeconds(evt.tick ?? this.game.ticks), icon: m.icon, text: m.text, tone: m.tone });
  }

  _sample() {
    const g = this.game;
    const h = this.human;
    const top = {};
    const alive = [];
    for (const p of g.players) if (p && p.alive && !p.weak && p.tiles > 0) alive.push(p);
    alive.sort((a, b) => b.tiles - a.tiles);
    for (const p of alive.slice(0, 8)) {
      top[p.id] = p.tiles / this.land;
      if (!this.names.has(p.id)) this.names.set(p.id, { name: p.name, color: p.color });
    }
    if (!this.names.has(h.id)) this.names.set(h.id, { name: h.name, color: h.color });
    this.samples.push({ t: gameSeconds(g.ticks), me: [h.tiles / this.land, Math.max(0, h.troops), Math.max(0, h.gold), h.tiles], top });
  }

  _snap() {
    const g = this.game;
    const owner = g.owner;
    const terrain = g.map.terrain;
    const pick = this._pick;
    const data = new Uint16Array(pick.length);
    for (let i = 0; i < pick.length; i++) {
      const t = pick[i];
      data[i] = terrain[t] === 0 ? WATER : owner[t];
    }
    this.snaps.push({ t: gameSeconds(g.ticks), data });
    if (this.snaps.length > MAX_SNAPS) {
      // Una de cada dos de las que ya había; las siguientes, el doble de espaciadas
      this.snaps = this.snaps.filter((_, i) => i % 2 === 0 || i === this.snaps.length - 1);
      this.snapEvery *= 2;
    }
  }

  /** Colores [r, g, b] de cada dueño que sale en las fotos. */
  palette() {
    const pal = new Map();
    for (const p of this.game.players) if (p) pal.set(p.id, p.color);
    return pal;
  }
}

/** Tu territorio a lo largo de la partida en `n` puntos (enteros de 0 a 1000), para el historial. */
export function compactCurve(samples, n = 30) {
  if (!samples.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = Math.round((i * (samples.length - 1)) / Math.max(1, n - 1));
    out.push(Math.round(samples[k].me[0] * 1000));
  }
  return out;
}

/**
 * Series de territorio para la gráfica: tú y las `k` naciones que más tierra
 * llegaron a tener. [{ id, name, color, me, points: [[t, pct]] }]
 */
export function territorySeries(rec, k = 6) {
  const best = new Map();
  for (const s of rec.samples) for (const [id, v] of Object.entries(s.top)) best.set(Number(id), Math.max(best.get(Number(id)) || 0, v));
  best.delete(rec.human.id);
  const ids = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
  const series = ids.map((id) => ({ id, ...rec.names.get(id), me: false, points: rec.samples.map((s) => [s.t, s.top[id] ?? null]) }));
  series.push({ id: rec.human.id, ...rec.names.get(rec.human.id), me: true, points: rec.samples.map((s) => [s.t, s.me[0]]) });
  return series;
}

// ----------------------------------------------------------------- dibujo

const css = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
/** Segundos como «m:ss». */
export function mmss(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Prepara un lienzo a su tamaño en pantalla y a la densidad de la pantalla. */
function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(200, canvas.clientWidth || 600);
  const h = Math.max(120, canvas.clientHeight || 220);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/**
 * Gráfica de líneas con el estilo del juego. `series`: [{ color, points:
 * [[t, v]], me, label }]; `opts.format(v)` para el eje vertical y
 * `opts.max` (si no, el mayor valor).
 */
export function drawChart(canvas, series, opts = {}) {
  const { ctx, w, h } = fit(canvas);
  const pad = { l: 46, r: 12, t: 12, b: 24 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  let tMax = 1;
  let vMax = opts.max || 0;
  for (const s of series) {
    for (const [t, v] of s.points) {
      if (t > tMax) tMax = t;
      if (!opts.max && v != null && v > vMax) vMax = v;
    }
  }
  vMax = vMax > 0 ? vMax * 1.08 : 1;
  const X = (t) => pad.l + (t / tMax) * pw;
  const Y = (v) => pad.t + ph - (v / vMax) * ph;
  ctx.clearRect(0, 0, w, h);
  // Rejilla y ejes
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(169, 181, 202, 0.85)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = (vMax / 1.08) * (i / 4);
    const y = Math.round(Y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.fillText(opts.format ? opts.format(v, vMax) : String(Math.round(v)), pad.l - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const steps = Math.min(6, Math.max(2, Math.floor(pw / 90)));
  for (let i = 0; i <= steps; i++) ctx.fillText(mmss((tMax * i) / steps), X((tMax * i) / steps), h - pad.b + 6);
  // Líneas: primero las demás, la tuya encima y más gruesa
  const ordered = [...series.filter((s) => !s.me), ...series.filter((s) => s.me)];
  for (const s of ordered) {
    ctx.beginPath();
    let pen = false;
    for (const [t, v] of s.points) {
      if (v == null) {
        pen = false;
        continue;
      }
      const x = X(t);
      const y = Y(v);
      if (!pen) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      pen = true;
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (s.me) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = s.stroke || '#ffffff';
      ctx.lineWidth = 2.6;
    } else {
      ctx.strokeStyle = css(s.color, 0.95);
      ctx.lineWidth = 1.6;
    }
    ctx.stroke();
  }
  // Relleno suave bajo tu línea
  const me = series.find((s) => s.me);
  if (me && opts.fill !== false) {
    const pts = me.points.filter(([, v]) => v != null);
    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(X(pts[0][0]), Y(0));
      for (const [t, v] of pts) ctx.lineTo(X(t), Y(v));
      ctx.lineTo(X(pts[pts.length - 1][0]), Y(0));
      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ph);
      grad.addColorStop(0, opts.fillColor || 'rgba(255, 227, 161, 0.22)');
      grad.addColorStop(1, 'rgba(255, 227, 161, 0)');
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }
}

/** Mini gráfica (para el historial): `curve` de 0 a 1000. */
export function drawSparkline(canvas, curve, color = '#ffe3a1') {
  const { ctx, w, h } = fit(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!curve || curve.length < 2) return;
  const max = Math.max(1, ...curve);
  ctx.beginPath();
  curve.forEach((v, i) => {
    const x = (i / (curve.length - 1)) * (w - 2) + 1;
    const y = h - 1 - (v / max) * (h - 3);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Pinta la foto `snap` del mapa en `ctx` (a su tamaño: rec.sw × rec.sh). */
export function drawSnap(ctx, rec, snap, palette, meId) {
  const img = ctx.createImageData(rec.sw, rec.sh);
  const px = img.data;
  const data = snap.data;
  for (let i = 0; i < data.length; i++) {
    const o = data[i];
    let r;
    let g;
    let b;
    if (o === WATER) {
      r = 22;
      g = 54;
      b = 95;
    } else if (!o) {
      r = 104;
      g = 122;
      b = 92;
    } else {
      const c = palette.get(o) || [200, 200, 200];
      // Tu nación, un poco más viva para encontrarla
      const k = o === meId ? 1 : 0.86;
      r = c[0] * k;
      g = c[1] * k;
      b = c[2] * k;
    }
    const j = i * 4;
    px[j] = r;
    px[j + 1] = g;
    px[j + 2] = b;
    px[j + 3] = 255;
  }
  // Tu frontera en blanco
  const W = rec.sw;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== meId) continue;
    const x = i % W;
    if ((x > 0 && data[i - 1] !== meId) || (x < W - 1 && data[i + 1] !== meId) || (i >= W && data[i - W] !== meId) || (i + W < data.length && data[i + W] !== meId)) {
      const j = i * 4;
      px[j] = 255;
      px[j + 1] = 255;
      px[j + 2] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

