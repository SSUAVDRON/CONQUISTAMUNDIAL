// Presentación de la partida: unos segundos antes de empezar, a pantalla
// completa, los participantes en tarjetas (su estandarte, su emblema con el
// marco que llevan, nombre, título y nivel; en la clasificatoria, también su
// rango) y las naciones que van a jugar, con sus banderas. Las tarjetas se
// adaptan a cuántos sean: grandes hasta 4, medianas hasta 8 y, con más,
// fichas compactas en rejilla. Contra la IA, su tarjeta va junto a la tuya.
// La partida no avanza mientras se ve (ver main.js: state.holdSim).
import { drawEmblem, drawFrame, flagCss, hasFlag } from './icons.js';
import { drawBadge, rankOf } from './rangos.js';
import { sinMovimiento } from './movimiento.js';

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null && c !== false) e.append(c);
  return e;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DPR = () => Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);

/** Lienzo con un emblema y su marco. */
function emblemCanvas(emblem, frame, px) {
  const c = document.createElement('canvas');
  const k = DPR();
  c.width = c.height = Math.round(px * k);
  c.style.width = c.style.height = `${px}px`;
  c.setAttribute('aria-hidden', 'true');
  const ctx = c.getContext('2d');
  const framed = frame && frame !== 'ninguno';
  drawEmblem(ctx, emblem, c.width / 2, c.height / 2, c.width * (framed ? 0.64 : 0.8));
  if (framed) drawFrame(ctx, frame, c.width / 2, c.height / 2, c.width * 0.64);
  return c;
}

/** Lienzo con la insignia de un rango (puntos; `placing`: aún en colocación). */
function badgeCanvas(points, placing, px) {
  const c = document.createElement('canvas');
  const k = DPR();
  c.width = c.height = Math.round(px * k);
  c.style.width = c.style.height = `${px}px`;
  c.setAttribute('aria-hidden', 'true');
  const r = rankOf(points);
  drawBadge(c.getContext('2d'), c.width / 2, c.height * 0.54, c.height * 0.74, placing ? null : r.league, placing ? 0 : r.div);
  return c;
}

/** Tamaño de las tarjetas según cuántos participantes hay. */
function sizeFor(n) {
  return n <= 4 ? 'grande' : n <= 8 ? 'media' : 'compacta';
}
const EMBLEM_PX = { grande: 104, media: 74, compacta: 46 };
const BADGE_PX = { grande: 50, media: 40, compacta: 30 };

/** Tarjeta de un participante. */
function card(p, i, size) {
  const rank = p.rank;
  const rk = rank ? rankOf(rank.points || 0) : null;
  return el(
    'article',
    { class: `pr-carta est-${p.banner || 'noche'}${p.me ? ' yo' : ''}${p.ai ? ' ia' : ''}`, style: `--i: ${i}; --color: ${p.color || '#888'}` },
    p.me ? el('span', { class: 'pr-tu', text: 'TÚ' }) : null,
    el('span', { class: 'pr-emblema' }, emblemCanvas(p.emblem, p.frame, EMBLEM_PX[size])),
    el('span', { class: 'pr-datos' },
      el('strong', { class: 'pr-nombre', text: p.name, style: p.nameColor ? `color: ${p.nameColor}` : '' }),
      el('span', { class: 'pr-titulo-j', text: p.title || 'Recluta' })),
    p.level ? el('span', { class: 'pr-nivel', title: `Nivel ${p.level}` }, el('small', { text: 'Nivel' }), el('b', { text: String(p.level) })) : null,
    p.note ? el('span', { class: 'pr-nota', text: p.note }) : null,
    rank
      ? el('span', { class: 'pr-rango', title: rank.placing ? 'Sin clasificar' : `${rk.label} · ${rk.pl} PL`, style: rank.placing ? '' : `--liga: ${rk.league.color.join(', ')}` },
          badgeCanvas(rank.points || 0, rank.placing, BADGE_PX[size]),
          el('span', {}, el('b', { text: rank.placing ? 'Colocación' : rk.label }), el('small', { text: rank.placing ? 'Sin liga aún' : `${rk.pl} PL` })))
      : null,
  );
}

/**
 * Muestra la presentación y se resuelve al acabar (o al saltarla).
 * opts: { kicker, title, details, players: [...], ai: tarjeta de la IA (o null),
 *         nations: [{ name, color, flag }], nationTotal, ranked, ms, skippable, sound }
 */
export async function presentMatch(opts) {
  const { kicker = '', title = '', details = '', players = [], ai = null, nations = [], nationTotal = nations.length, ranked = false, ms = 6500, skippable = true, sound = null } = opts;
  const still = sinMovimiento();
  // Tú primero; el resto, en el orden de la sala; la tarjeta de la IA (contra la IA), al final
  const ordered = [...players.filter((p) => p.me), ...players.filter((p) => !p.me), ...(ai ? [{ ...ai, ai: true }] : [])];
  const size = sizeFor(ordered.length);
  const row = el('div', { class: `pr-jugadores tam-${size}`, style: `--n: ${players.length}` }, ...ordered.map((p, i) => card(p, i, size)));
  const shown = nations.slice(0, 64);
  const chips = el('ul', { class: 'pr-banderas' },
    ...shown.map((n, i) =>
      el('li', { style: `--i: ${i}` },
        n.flag && hasFlag(n.flag) ? el('i', { class: 'bandera', style: flagCss(n.flag, 20) }) : el('i', { class: 'pr-punto', style: `background: ${n.color}` }),
        el('span', { text: n.name }))),
    nationTotal > shown.length ? el('li', { class: 'pr-mas', style: `--i: ${shown.length}`, text: `+${nationTotal - shown.length}` }) : null);
  const count = el('b', { text: String(Math.ceil(ms / 1000)) });
  const bar = el('span');
  const skip = skippable ? el('button', { type: 'button', class: 'principal pr-saltar', text: 'Empezar ya' }) : null;
  const box = el('div', { class: `presentacion${ranked ? ' clasificatoria' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': `Presentación: ${title}` },
    el('div', { class: 'pr-luz', 'aria-hidden': 'true' }),
    el('header', { class: 'pr-cab' }, el('small', { class: 'pr-antetitulo', text: kicker }), el('h1', { class: 'pr-titulo', text: title }), details ? el('p', { class: 'pr-detalles', text: details }) : null),
    row,
    nations.length ? el('section', { class: 'pr-naciones' }, el('h2', {}, 'Naciones en juego ', el('span', { text: String(nationTotal) })), chips) : null,
    el('footer', { class: 'pr-pie' }, el('div', { class: 'pr-barra', 'aria-hidden': 'true' }, bar), el('span', { class: 'pr-cuenta' }, 'La batalla empieza en ', count), skip));
  document.body.append(box);
  bar.style.animationDuration = `${ms}ms`;
  sound?.play('presentacion', 0.9, 0);

  let done;
  const finished = new Promise((r) => (done = r));
  const end = () => done();
  skip?.addEventListener('click', end);
  const onKey = (e) => {
    if (skippable && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) {
      e.preventDefault();
      end();
    }
  };
  window.addEventListener('keydown', onKey, true);
  skip?.focus({ preventScroll: true });
  // Cuenta atrás (con un tambor en los tres últimos segundos)
  const t0 = performance.now();
  let last = Math.ceil(ms / 1000);
  const timer = setInterval(() => {
    const left = Math.max(0, ms - (performance.now() - t0));
    const s = Math.ceil(left / 1000);
    if (s !== last) {
      last = s;
      count.textContent = String(Math.max(1, s));
      if (s >= 1 && s <= 3) sound?.play('cuenta', 0.8, 0);
    }
    if (left <= 0) end();
  }, 100);
  await finished;
  clearInterval(timer);
  window.removeEventListener('keydown', onKey, true);
  box.classList.add('saliendo');
  await wait(still ? 0 : 320);
  box.remove();
}
