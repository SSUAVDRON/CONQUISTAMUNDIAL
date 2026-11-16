// Competitivo: los huecos de tu escuadra (amigos con su estandarte y su
// insignia, o «+» para invitar), la guía «Cómo funcionan los PL» con lo que te
// daría tu próxima partida (calculado con tu rango) y el destello que cruza
// tu insignia de vez en cuando.
import { LEAGUES, PLACEMENT_GAMES, RANKED_AI, SHIELD_GAMES, drawBadge, inPlacement, nextGoal, previewResults, rankOf, seasonReward } from './rangos.js';
import { drawEmblem, drawFrame } from './icons.js';
import { sinMovimiento } from './movimiento.js';
import { nameColorOf } from './profile.js';

/** Plazas de una escuadra: tú y hasta 4 amigos. */
export const SQUAD = 5;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null && c !== false) node.append(c);
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
/** Icono de trazo (viewBox 24). */
function icon(d) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.8');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  s.append(p);
  return s;
}

const ICONS = {
  escalera: 'M3 20h4v-4h4v-4h4V8h4V4M15 4h4v4',
  escudo: 'M12 3l7 3v5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6zM9 12l2 2 4-4',
  diana: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18M12 16.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9M12 12.6v-1.2',
  ojo: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6',
  podio: 'M3 20h18M4 20v-6h5v6M9 20V9h6v11M15 20v-8h5v8M12 4.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z',
  balanza: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
  corona: 'M3 18h18M4 18 3 7l5 4 4-7 4 7 5-4-1 11',
  calendario: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h0M8 17h2',
  mas: 'M12 5v14M5 12h14',
};

// ------------------------------------------------------------- escuadra

/** Emblema con su marco en un lienzo de `px` (a la densidad de la pantalla). */
function emblemCanvas(emblem, frame, px) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = el('canvas', { width: String(Math.round(px * dpr)), height: String(Math.round(px * dpr)), 'aria-hidden': 'true' });
  c.style.width = c.style.height = `${px}px`;
  const ctx = c.getContext('2d');
  const s = c.width;
  drawEmblem(ctx, emblem, s / 2, s / 2, s * 0.62);
  if (frame) drawFrame(ctx, frame, s / 2, s / 2, s * 0.62);
  return c;
}

/** Insignia de unos puntos (o sin rango) en un lienzo de `px`. */
function crestCanvas(points, px) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = el('canvas', { width: String(Math.round(px * dpr)), height: String(Math.round(px * dpr)), 'aria-hidden': 'true', class: 'cp-hueco-insignia' });
  const k = Number.isFinite(points) && points > 0 ? rankOf(points) : null;
  drawBadge(c.getContext('2d'), c.width / 2, c.height * 0.54, c.height * 0.72, k ? k.league : null, k ? k.div : 0);
  return c;
}

/**
 * Tarjeta de un compañero de escuadra: su estandarte con emblema, nombre,
 * título y nivel; debajo, su insignia. `points` (o null, sin rango firmado).
 */
export function memberCard(p, { points = null, leader = false, fresh = false, onOpen = null } = {}) {
  // Sin puntos (aún en colocación, o sin rango firmado): medallón «?»
  const k = Number.isFinite(points) && points > 0 ? rankOf(points) : null;
  const banner = /^[a-z0-9-]{1,24}$/.test(p.banner || '') ? p.banner : 'noche';
  const state = p.stale ? ['Reconectando…', 'aviso'] : leader ? ['Líder', 'lider'] : ['En la escuadra', 'listo'];
  const li = el(
    'li',
    { class: `cp-hueco miembro${fresh ? ' entra' : ''}${p.stale ? ' desconectado' : ''}`, style: `--liga: ${(k ? k.league.color : [196, 170, 120]).join(', ')}`, tabindex: '0' },
    el(
      'div',
      { class: `cp-hueco-est est-${banner}` },
      leader ? el('span', { class: 'cp-hueco-corona', title: 'Líder de la escuadra', text: 'Líder' }) : null,
      emblemCanvas(p.emblem, p.frame, 74),
      el('strong', { class: 'cp-hueco-nombre', text: p.name, style: `color: ${nameColorOf({ colorNombre: p.nameColor, color: p.color })}` }),
      p.title ? el('small', { class: 'cp-hueco-titulo', text: p.title }) : null,
      el('span', { class: 'cp-hueco-nivel', text: `Nv ${p.level || 1}` }),
    ),
    el('div', { class: 'cp-hueco-rango' }, crestCanvas(points, 84), el('strong', { text: k ? k.label : 'Sin clasificar' })),
    el('span', { class: `cp-hueco-estado ${state[1]}`, text: state[0] }),
  );
  if (onOpen) {
    li.classList.add('fila-boton');
    li.addEventListener('click', onOpen);
    li.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen()));
  }
  return li;
}

/** Hueco libre: «+» para invitar (o, si no se puede, por qué). */
export function emptySlot({ onInvite, disabled = false, hint = '' } = {}) {
  const b = el(
    'button',
    { type: 'button', class: 'cp-hueco-mas', disabled, title: hint || 'Invitar a un amigo a tu escuadra', 'aria-label': hint || 'Invitar a un amigo a tu escuadra' },
    el('span', { class: 'cp-mas-aro', 'aria-hidden': 'true' }, icon(ICONS.mas)),
    el('strong', { text: 'Invitar' }),
    el('small', { text: hint ? hint : 'a un amigo' }),
  );
  if (onInvite) b.addEventListener('click', onInvite);
  return el('li', { class: 'cp-hueco vacio' }, b);
}

// -------------------------------------------------- cómo funcionan los PL

const sign = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '±0');

/**
 * Pinta la guía de los PL para la cola elegida: lo que te daría tu próxima
 * partida según cómo quedes, tu siguiente objetivo y las reglas.
 */
export function renderPlGuide(r, queue) {
  const box = document.getElementById('cp-guia-ejemplos');
  if (!box) return;
  const online = queue === 'sala';
  const prev = previewResults(r, online ? 'sala' : 'ia');
  const placing = inPlacement(r);
  document.getElementById('cp-guia-cola').textContent = online ? 'Cola en línea' : 'Cola contra la IA';
  // Tu próxima partida: barras de PL que salen del centro (verde si suma, rojo si resta)
  const max = 50;
  const rows = prev.rows.map((row, i) =>
    el(
      'li',
      { class: `cp-ej ${row.delta > 0 ? 'sube' : row.delta < 0 ? 'baja' : 'igual'}`, style: `--w: ${Math.min(1, Math.abs(row.delta) / max).toFixed(3)}; --i: ${i}` },
      el('span', { class: 'cp-ej-puesto' }, el('strong', { text: row.label }), el('small', { text: row.sub })),
      el('span', { class: 'cp-ej-pista', 'aria-hidden': 'true' }, el('span', { class: 'cp-ej-barra' })),
      el('b', { class: 'cp-ej-pl', text: `${sign(row.delta)} PL` }),
    ),
  );
  box.replaceChildren(
    el('div', { class: 'cp-guia-sub' },
      el('strong', { text: placing ? 'Al acabar la colocación' : 'Tu próxima partida' }),
      el('small', { text: placing ? `Con tu nivel de ahora entrarías en ${prev.estimate}. Esto es lo que te daría después cada resultado:` : online ? 'Contra 4 personas de tu nivel, calculado con tu rango de ahora:' : `Según tu puesto entre las ${RANKED_AI.bots + 1} naciones, calculado con tu rango de ahora:` })),
    el('ol', { class: 'cp-ejemplos' }, ...rows),
  );
  // Tu objetivo: colocación, la división siguiente o la cima
  const meta = document.getElementById('cp-guia-meta');
  const parts = [];
  if (placing) {
    parts.push(
      el('strong', { class: 'cp-meta-tit', text: 'Partidas de colocación' }),
      el('div', { class: 'cp-colocacion', 'aria-label': `${r.colocacion} de ${PLACEMENT_GAMES} jugadas` }, ...Array.from({ length: PLACEMENT_GAMES }, (_, i) => el('i', { class: i < r.colocacion ? 'hecha' : '' }))),
      el('p', { text: `Llevas ${r.colocacion} de ${PLACEMENT_GAMES}. Miden tu nivel: al acabarlas entras en la liga que te corresponde (ahora mismo, ${prev.estimate}).` }),
    );
  } else {
    const goal = nextGoal(r);
    const win = prev.rows[0].delta;
    if (goal) {
      const wins = Math.max(1, Math.ceil(goal.need / Math.max(1, win)));
      const c = el('canvas', { width: '96', height: '96', 'aria-hidden': 'true' });
      const g = rankOf(r.puntos + goal.need);
      drawBadge(c.getContext('2d'), 48, 52, 70, g.league, g.div);
      parts.push(
        el('div', { class: 'cp-meta-cab' }, c, el('span', {}, el('small', { text: goal.promotion ? 'Siguiente liga' : 'Siguiente objetivo' }), el('strong', { class: 'cp-meta-tit', text: goal.label, style: `color: rgb(${g.league.color.join(',')})` }))),
        el('p', { text: `Te faltan ${goal.need} PL: unas ${wins} ${wins === 1 ? 'victoria' : 'victorias'} (${sign(win)} PL cada una).` }),
      );
    } else parts.push(el('strong', { class: 'cp-meta-tit', text: 'Estás en la cima' }), el('p', { text: 'Leyenda no tiene techo: cada victoria suma a tu marca de la temporada.' }));
  }
  const lag = prev.lag;
  parts.push(
    el('p', { class: `cp-meta-nivel ${lag > 0 ? 'bien' : lag < 0 ? 'mal' : ''}` },
      icon(ICONS.ojo),
      el('span', { text: lag > 0 ? `Tu nivel oculto va por delante de tu rango: ganas ${lag} PL más y pierdes ${lag} menos en cada partida.` : lag < 0 ? `Tu nivel oculto va por detrás de tu rango: ganas ${-lag} PL menos y pierdes ${-lag} más hasta que se igualen.` : 'Tu rango y tu nivel oculto van a la par.' })),
  );
  if (r.escudo > 0) parts.push(el('p', { class: 'cp-meta-escudo' }, icon(ICONS.escudo), el('span', { text: `Escudo: ${r.escudo} ${r.escudo === 1 ? 'partida' : 'partidas'} en las que no puedes bajar de división.` })));
  meta.replaceChildren(...parts);
  // Las reglas, en fichas
  const legend = LEAGUES[LEAGUES.length - 1];
  const rule = (ico, title, text) => el('li', { class: 'cp-regla' }, el('span', { class: 'cp-regla-ico' }, icon(ICONS[ico])), el('strong', { text: title }), el('p', { text }));
  document.getElementById('cp-guia-reglas').replaceChildren(
    rule('escalera', 'Divisiones de 100 PL', 'Cada liga tiene 4 divisiones, de IV a I. Llega a 100 PL y subes a la siguiente; baja de 0 y caes a la anterior.'),
    rule('escudo', 'Escudo al subir', `Tras subir de división tienes ${SHIELD_GAMES} partidas de escudo: puedes perder PL, pero no bajar.`),
    rule('diana', 'Colocación', `Las ${PLACEMENT_GAMES} primeras partidas de la temporada no dan PL: miden tu nivel y te colocan en tu liga.`),
    rule('ojo', 'Nivel oculto', 'Además de los PL hay un nivel oculto que mide cómo juegas. Si va por delante de tu rango, ganas más y pierdes menos (hasta 10 PL).'),
    online
      ? rule('podio', 'Qué cuenta en línea', 'Quién queda por delante de quién entre las personas de la sala, y un poco tu puesto entre todas las naciones. Ganar a gente de más nivel da más.')
      : rule('podio', 'Qué cuenta contra la IA', `Tu puesto entre las ${RANKED_AI.bots + 1} naciones, comparado con lo que se espera de tu liga. La IA sube de nivel contigo: de Fácil a Imposible.`),
    rule('balanza', 'Límites', 'Ganar da +8 PL extra. Ninguna partida da más de +50 ni quita más de 35, y hacerlo mejor de lo esperado nunca resta. Abandonar cuenta como quedar el último.'),
    rule('corona', 'Ligas de élite', 'Maestro, Gran Maestro y Leyenda no tienen divisiones: los PL siguen sumando. Gran Maestro empieza a 200 PL de Maestro y Leyenda, a 300 de Gran Maestro.'),
    rule('calendario', 'Temporadas', `Duran dos meses. Al acabar ganas monedas según tu mejor liga (de ${seasonReward(0).coins} en Hierro a ${seasonReward(legend.base).coins} en Leyenda) y empiezas con 2 partidas de colocación cerca de tu nivel.`),
  );
}

// ------------------------------------------------------------- destello

/**
 * Destello que cruza la insignia grande cada pocos segundos (se repinta con
 * `opts.shine`), solo mientras se ve y sin «reducir movimiento».
 */
export class BadgeShine {
  constructor(canvas, visible) {
    this.c = canvas;
    this.visible = visible;
    this.draw = null;
    this.raf = 0;
    this.timer = 0;
  }

  /** draw(ctx, shine): pinta la insignia (shine NaN = sin destello). */
  set(draw) {
    this.draw = draw;
    this._paint(NaN);
    if (!this.timer && !this.raf) this._wait(1800);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.raf = 0;
    this.timer = 0;
  }

  _paint(shine) {
    if (!this.draw) return;
    const ctx = this.c.getContext('2d');
    ctx.clearRect(0, 0, this.c.width, this.c.height);
    this.draw(ctx, shine);
  }

  _wait(ms) {
    this.timer = setTimeout(() => {
      this.timer = 0;
      this._sweep();
    }, ms);
  }

  _sweep() {
    if (!this.draw || sinMovimiento() || !this.visible() || document.visibilityState !== 'visible') {
      this._wait(2500);
      return;
    }
    const t0 = performance.now();
    const dur = 1100;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      // Entra despacio, cruza rápido y sale despacio
      this._paint(t < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * t) : NaN);
      if (t < 1) this.raf = requestAnimationFrame(step);
      else {
        this.raf = 0;
        this._wait(4200 + Math.random() * 1800);
      }
    };
    this.raf = requestAnimationFrame(step);
  }
}
