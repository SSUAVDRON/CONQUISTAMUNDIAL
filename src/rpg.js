// Fichas con estilo de juego de rol de fantasía: categorías y puntos de las
// gestas (logros) y un tooltip ornamentado que se usa en Progreso, Perfil y
// la Colección. Solo el tooltip toca el DOM.
import { RARITIES, rarityOf } from './skins.js';

/** Categorías de las gestas, en el orden del índice. */
export const ACH_CATEGORIES = [
  { id: 'conquista', name: 'Conquista', icon: '🏰' },
  { id: 'guerra', name: 'Guerra', icon: '⚔️' },
  { id: 'economia', name: 'Economía', icon: '💰' },
  { id: 'diplomacia', name: 'Diplomacia', icon: '🕊️' },
  { id: 'clasificatoria', name: 'Clasificatoria', icon: '🏅' },
  { id: 'trayectoria', name: 'Trayectoria', icon: '📜' },
];

const CAT_OF = {
  conquista: ['primera_victoria', 'gran_victoria', 'relampago', 'medio_mundo', 'imperio', 'remontada', 'top10', 'podio', 'emperador', 'magnate_mundial', 'resistente', 'superviviente', 'aguante', 'retador'],
  guerra: ['verdugo', 'tormenta', 'centurion', 'lluvia_fuego', 'almirante', 'saqueador', 'capitalino', 'marino'],
  economia: ['arquitecto', 'metropolis', 'urbanista', 'constructor', 'industrial', 'tesoro', 'millonario', 'magnate_oro', 'estratega', 'cientifico'],
  diplomacia: ['alianza_victoriosa', 'diplomatico', 'diplomatico_total', 'traidor', 'pacificador', 'cooperativo', 'en_compania'],
  clasificatoria: ['clasificado', 'liga_bronce', 'liga_plata', 'liga_oro', 'liga_platino', 'liga_diamante', 'liga_maestro', 'racha'],
};
const CAT_BY_ID = new Map(Object.entries(CAT_OF).flatMap(([cat, ids]) => ids.map((id) => [id, cat])));

/** Categoría de una gesta (lo que no está en ninguna, «Trayectoria»). */
export function achCategory(id) {
  return CAT_BY_ID.get(id) || 'trayectoria';
}

/** Puntos de gesta: una décima parte de sus monedas (como mínimo 5). */
export function achPoints(a) {
  return Math.max(5, Math.round((a.coins || 0) / 10));
}

/** Escapa texto para meterlo en el HTML del tooltip. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * HTML de una ficha de objeto: nombre del color de su rareza, rareza y tipo,
 * descripción y líneas de estado (`{ text, tone }`: 'bien' | 'aviso' | 'mal' | 'oro' | '').
 */
export function itemTipHtml({ name, item = null, rarity = null, type = '', desc = '', lines = [], flavor = '' }) {
  const r = rarity || (item ? rarityOf(item) : RARITIES.comun);
  return `<div class="rt-cab"><strong class="rt-nombre" style="color:${r.color}">${esc(name)}</strong>
    <div class="rt-fila"><span style="color:${r.color}">${esc(r.name)}</span><span class="rt-tipo">${esc(type)}</span></div></div>
    ${desc ? `<p class="rt-desc">${esc(desc)}</p>` : ''}
    ${lines.map((l) => `<p class="rt-linea ${l.tone || ''}">${esc(l.text)}</p>`).join('')}
    ${flavor ? `<p class="rt-sabor">«${esc(flavor)}»</p>` : ''}`;
}

let TIP = null;
let current = null;
let press = 0;

function tipEl() {
  if (TIP) return TIP;
  TIP = document.createElement('div');
  TIP.className = 'rpg-tip';
  TIP.setAttribute('role', 'tooltip');
  TIP.hidden = true;
  document.body.append(TIP);
  return TIP;
}

function place(node) {
  const t = tipEl();
  const r = node.getBoundingClientRect();
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // A la derecha del objeto; si no cabe, a la izquierda; y si tampoco, encima o debajo
  let x = r.right + 10;
  let y = r.top;
  if (x + w > vw - 8) x = r.left - w - 10;
  if (x < 8) {
    x = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2));
    y = r.top - h - 10 < 8 ? r.bottom + 10 : r.top - h - 10;
  }
  y = Math.max(8, Math.min(vh - h - 8, y));
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function show(node, build) {
  const t = tipEl();
  current = node;
  t.innerHTML = build();
  t.hidden = false;
  t.classList.remove('entra');
  void t.offsetWidth;
  t.classList.add('entra');
  place(node);
}

export function hideTip() {
  if (TIP) TIP.hidden = true;
  current = null;
}

/**
 * Ficha emergente de `node`: al pasar el ratón o al enfocarlo con el teclado
 * y, en pantallas táctiles, al mantenerlo pulsado (medio segundo).
 */
export function attachTip(node, build) {
  node.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') show(node, build);
  });
  node.addEventListener('pointerleave', () => current === node && hideTip());
  node.addEventListener('focus', () => show(node, build));
  node.addEventListener('blur', () => current === node && hideTip());
  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    clearTimeout(press);
    press = setTimeout(() => {
      node.dataset.tipLargo = '1';
      show(node, build);
    }, 480);
  });
  for (const ev of ['pointerup', 'pointercancel']) {
    node.addEventListener(ev, () => {
      clearTimeout(press);
      if (node.dataset.tipLargo) setTimeout(() => {
        delete node.dataset.tipLargo;
        hideTip();
      }, 1400);
    });
  }
  // Tras una pulsación larga, el clic no equipa ni compra
  node.addEventListener('click', (e) => {
    if (node.dataset.tipLargo) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
}

if (typeof window !== 'undefined') {
  window.addEventListener('scroll', hideTip, { passive: true, capture: true });
}
