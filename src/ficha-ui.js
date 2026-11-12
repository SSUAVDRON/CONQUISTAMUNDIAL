// Ficha visual de lo que da cada cosa (doc-1.7): la tarjeta que sale al
// pasar el ratón por un edificio de la barra, al mantenerlo pulsado en el
// móvil, mientras colocas uno (en el móvil, encima del panel) y al tocar un
// bono activo. Las cifras salen de fichas.js; aquí solo se pinta y se coloca.

import { BUILD_GROUPS, TICK_MS } from './config.js';
import { formatNumber } from './format.js';
import { buildingCard } from './fichas.js';

const GROUP_NAMES = Object.fromEntries(BUILD_GROUPS.map((g) => [g.id, g.name]));

const svg = (body, fill = false) =>
  `<svg viewBox="0 0 16 16" aria-hidden="true" ${fill ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
const ICONS = {
  oro: svg('<ellipse cx="8" cy="5" rx="5" ry="2.2"/><path d="M3 5v6c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2V5M3 8c0 1.2 2.2 2.2 5 2.2S13 9.2 13 8"/>'),
  tropas: svg('<circle cx="5.5" cy="5" r="2"/><circle cx="11" cy="5.5" r="1.7"/><path d="M1.5 13c0-2.5 1.8-4 4-4s4 1.5 4 4M9 9.3c.6-.2 1.3-.3 2-.3 2 0 3.5 1.3 3.5 3.5"/>'),
  techo: svg('<path d="M2.5 14h11M8 11.5V3M4.8 6.2 8 3l3.2 3.2"/>'),
  escudo: svg('<path d="M8 1.8 13 4v3.8c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4V4z"/>'),
  alcance: svg('<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.3"/>'),
  diana: svg('<circle cx="8" cy="8" r="5"/><path d="M8 1v3.5M8 11.5V15M1 8h3.5M11.5 8H15"/>'),
  reloj: svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/>'),
  barco: svg('<path d="M1.8 10.2h12.4l-2.2 3.3H4zM8 2.5v7.7M8 3.4l4 4.6H8"/>'),
  tren: svg('<rect x="4" y="2" width="8" height="9" rx="2"/><path d="M4 7h8M5.2 14l1.4-3M10.8 14l-1.4-3"/>'),
  bomba: svg('<path d="M8 1.5 9.3 5l3.5-1.4L11.4 7l3.4 1.3-3.4 1.3 1.4 3.4-3.5-1.4L8 14.5l-1.3-3.4-3.5 1.4L4.6 9.6 1.2 8.3 4.6 7 3.2 3.6 6.7 5z"/>'),
  banco: svg('<path d="M2 14V6h2v2h2V6h1.5V3.5h1V6H10v2h2V6h2v8h-4v-3a2 2 0 0 0-4 0v3z"/>', true),
  muralla: svg('<path d="M2 14V6h2.4v2h2.4V6h2.4v2h2.4V6H14v8z"/>', true),
  tienes: svg('<path d="M3 8.5 6.4 12 13 4.5"/>'),
  falta: svg('<path d="M8 2.2 14.5 13.5h-13zM8 6.5v3.2M8 11.6v.1"/>'),
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const seconds = (ticks) => {
  const s = Math.round((ticks * TICK_MS) / 100) / 10;
  return `${String(s).replace('.', ',')} s`;
};

export class FichaUI {
  /**
   * @param host     donde vive la tarjeta (el HUD)
   * @param iconFor  kind → url de su icono (los de la barra)
   * @param onCancel al pulsar «Cancelar» en la tarjeta del móvil mientras colocas
   */
  constructor(host, { iconFor, onCancel }) {
    const el = document.createElement('div');
    el.className = 'ficha';
    el.setAttribute('role', 'tooltip');
    el.hidden = true;
    host.append(el);
    this.el = el;
    this.iconFor = iconFor;
    this.cur = null; // { type: 'obra' | 'bono', kind, bonus, anchor, mode: 'hover' | 'press' | 'dock' | 'bono' }
    this._html = '';
    this._at = 0;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-cancelar]')) onCancel?.(this.cur && this.cur.kind);
      else if (this.cur && this.cur.mode !== 'dock') this.hide();
    });
  }

  get open() {
    return !!this.cur;
  }

  showBuilding(game, p, kind, anchor, mode) {
    this.cur = { type: 'obra', kind, anchor, mode };
    this.refresh(game, p, true);
  }

  showBonus(bonus, anchor) {
    this.cur = { type: 'bono', bonus, anchor, mode: 'bono' };
    this._render(this._bonusHtml(bonus));
  }

  hide() {
    if (!this.cur) return;
    this.cur = null;
    this.el.classList.remove('visible');
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (!this.cur) this.el.hidden = true;
    }, 160);
  }

  /** Vuelve a calcular las cifras (como mucho 3 veces por segundo salvo `force`). */
  refresh(game, p, force = false) {
    const cur = this.cur;
    if (!cur || cur.type !== 'obra' || !game || !p) return;
    const now = performance.now();
    if (!force && now - this._at < 330) return;
    this._at = now;
    this._render(this._buildingHtml(buildingCard(game, p, cur.kind), p, cur.mode));
  }

  _render(html) {
    const el = this.el;
    const cur = this.cur;
    if (html !== this._html) {
      el.innerHTML = html;
      this._html = html;
    }
    el.classList.toggle('ficha-dock', cur.mode === 'dock');
    el.dataset.grupo = cur.type === 'obra' ? this._group(cur.kind) : 'bono';
    clearTimeout(this._hideTimer);
    if (el.hidden) {
      el.hidden = false;
      el.classList.remove('visible');
      void el.offsetWidth; // para que entre con su animación
    }
    this._place();
    el.classList.add('visible');
  }

  _group(kind) {
    const g = BUILD_GROUPS.find((x) => x.kinds.includes(kind));
    return g ? g.id : 'economia';
  }

  /** Encima del botón (o del bono), centrada y sin salirse de la pantalla; en el móvil al colocar, fija encima del panel. */
  _place() {
    const el = this.el;
    const cur = this.cur;
    if (cur.mode === 'dock' || !cur.anchor) {
      el.style.left = '';
      el.style.top = '';
      return;
    }
    const r = cur.anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(vw - w - 8, left));
    let top = r.top - h - 10;
    if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 10);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    // La flechita apunta al botón
    el.style.setProperty('--flecha', `${Math.round(Math.max(14, Math.min(w - 14, r.left + r.width / 2 - left)))}px`);
    el.classList.toggle('debajo', top > r.top);
  }

  _buildingHtml(c, p, mode) {
    const group = this._group(c.kind);
    const icon = this.iconFor ? this.iconFor(c.kind) : '';
    const short = p.gold < c.cost && !c.maxed;
    const price = c.maxed
      ? '<b>Máx.</b>'
      : `<b>${formatNumber(c.cost)}</b><small>${short ? `te faltan ${formatNumber(c.cost - p.gold)}` : 'de oro'}</small>`;
    const meta = [c.time ? `${ICONS.reloj}${seconds(c.time)} de obra` : '', c.key ? `<kbd>${esc(c.key)}</kbd>` : ''].filter(Boolean).join('');
    const gives = c.gives
      .map(
        (g) => `<li><i class="fi">${ICONS[g.icon] || ''}</i><span class="fd-txt"><span class="fd-l">${esc(g.label)}</span>${g.note ? `<small>${esc(g.note)}</small>` : ''}</span>${g.value ? `<b class="fd-v">${esc(g.value)}</b>` : ''}</li>`,
      )
      .join('');
    const next =
      c.next && c.next.rows.length && mode !== 'dock'
        ? `<section class="ficha-sec"><h4>${esc(c.next.title)}</h4><div class="ficha-niv">${c.next.rows
            .map((r) => `<div class="fn-fila"><span class="fn-l">${esc(r.label)}</span>${r.from ? `<span class="fn-de">${esc(r.from)}</span><i class="fn-a">→</i>` : ''}<b>${esc(r.to)}</b></div>`)
            .join('')}</div></section>`
        : '';
    const have = c.have && (mode !== 'dock' || c.haveWarn) ? `<div class="ficha-tienes${c.haveWarn ? ' falta' : ''}"><i class="fi">${c.haveWarn ? ICONS.falta : ICONS.tienes}</i><span>${esc(c.have)}</span></div>` : '';
    const how = c.how ? `<div class="ficha-como">${esc(c.how)}</div>` : '';
    const cancel = mode === 'dock' ? '<button type="button" class="ficha-cancelar" data-cancelar>Cancelar</button>' : '';
    return `
      <div class="ficha-cab">
        <span class="ficha-icono">${icon ? `<img src="${icon}" alt="">` : ''}</span>
        <span class="ficha-titulos"><small>${esc(GROUP_NAMES[group] || '')} · ${esc(c.tag)}</small><strong>${esc(c.name)}</strong></span>
        <span class="ficha-precio${short ? ' caro' : ''}">${price}</span>
      </div>
      ${meta ? `<div class="ficha-meta">${meta}</div>` : ''}
      <p class="ficha-resumen">${esc(c.summary)}</p>
      <section class="ficha-sec"><h4>${esc(c.givesTitle || 'Qué te da')}</h4><ul class="ficha-da">${gives}</ul></section>
      ${next}
      ${have}
      ${how}
      ${cancel}`;
  }

  _bonusHtml(b) {
    const bar = b.left != null && b.total ? `<div class="ficha-tiempo"><span style="width:${Math.round(Math.min(1, b.left / b.total) * 100)}%"></span></div><div class="ficha-meta">${ICONS.reloj}Te quedan ${b.left} s</div>` : b.left == null ? '<div class="ficha-meta">Para siempre</div>' : '';
    return `
      <div class="ficha-cab">
        <span class="ficha-icono emoji">${esc(b.icon)}</span>
        <span class="ficha-titulos"><small>Bono activo</small><strong>${esc(b.title)}</strong></span>
        <span class="ficha-precio bono"><b>${esc(b.value)}</b></span>
      </div>
      <p class="ficha-resumen">${esc(b.text)}</p>
      ${bar}`;
  }
}
