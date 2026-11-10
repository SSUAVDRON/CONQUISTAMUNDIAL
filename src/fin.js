// Pantalla de fin de partida: resumen (puesto, cifras, recompensas y rango),
// gráficas, momentos clave y repetición del mapa. Los datos vienen de la
// grabación de la partida (resumen.js).
import { abrirDialogo, contar, rodar, sinMovimiento, teclasGrupo } from './movimiento.js';
import { drawChart, drawSnap, mmss, territorySeries } from './resumen.js';
import { formatNumber, formatPercent, formatTime } from './format.js';

const $ = (id) => document.getElementById(id);
const SPEEDS = [[1, '×1'], [2, '×2'], [4, '×4']];
/** Fotos por segundo de la repetición a ×1. */
const FPS = 3;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** «3.º» */
export function ordinal(n) {
  return `${n}.º`;
}

export class PantallaFin {
  constructor() {
    this.data = null;
    this.tab = 'resumen';
    this.speed = 1;
    this.frame = 0;
    this.playing = false;
    for (const b of document.querySelectorAll('#fin-pestanas [data-fin]')) b.addEventListener('click', () => this.showTab(b.dataset.fin));
    teclasGrupo($('fin-pestanas'), '[role="tab"]');
    $('repe-play').addEventListener('click', () => (this.playing ? this.pause() : this.play()));
    $('repe-barra').addEventListener('input', () => {
      this.pause();
      this.frame = Number($('repe-barra').value);
      this._drawFrame();
    });
    const vel = $('repe-vel');
    vel.replaceChildren(
      ...SPEEDS.map(([v, label]) => {
        const b = el('button', '', label);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(v === this.speed));
        b.addEventListener('click', () => {
          this.speed = v;
          for (const x of vel.children) x.setAttribute('aria-checked', String(x === b));
          rodar(vel);
        });
        return b;
      }),
    );
    teclasGrupo(vel);
    window.addEventListener('resize', () => {
      if (!$('fin').hidden && this.tab === 'graficas') this._drawCharts();
    });
    $('fin-compartir').addEventListener('click', () => this.share());
  }

  /** Texto para compartir el resultado (y el enlace del reto, si lo hay). */
  shareText() {
    const d = this.data;
    const s = d.stats || {};
    const where = d.share && d.share.map ? ` en ${d.share.map}` : '';
    const url = d.share && d.share.url;
    const head = url ? '¿Me superas? He jugado' : d.outcome === 'victoria' ? '¡He ganado' : d.outcome === 'derrota' ? 'He caído' : 'He terminado';
    const place = d.place ? `${ordinal(d.place.place)} de ${d.place.of}` : '';
    return `${head} una partida de Trinchera${where}: ${place}${place ? ', ' : ''}${formatPercent(s.maxShare || 0)} del mapa como máximo y ${formatNumber(s.kills || 0)} eliminaciones en ${formatTime(s.seconds || 0)}.`;
  }

  /** Compartir: el menú del sistema si lo hay; si no, se copia el texto. */
  async share() {
    const d = this.data;
    if (!d) return;
    const url = (d.share && d.share.url) || '';
    const text = this.shareText();
    const b = $('fin-compartir');
    const done = (label) => {
      b.textContent = label;
      clearTimeout(this._shareT);
      this._shareT = setTimeout(() => (b.textContent = 'Compartir'), 1800);
    };
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Trinchera', text, ...(url ? { url } : {}) });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
      done('¡Copiado!');
    } catch {
      done('No se pudo copiar');
    }
  }

  /**
   * data: { title, text, progress, rec, game, human, place, outcome
   * ('victoria' | 'derrota' | 'fin'), rank (ver rangos.js) }
   */
  show(data) {
    this.data = data;
    this.pause();
    $('fin-titulo').textContent = data.title;
    $('fin-texto').textContent = data.text;
    const sello = $('fin-sello');
    sello.textContent = data.outcome === 'victoria' ? '🏆' : data.outcome === 'derrota' ? '💀' : '🏁';
    sello.className = `fin-sello ${data.outcome || 'fin'}`;
    this._renderStats();
    this._renderProgress();
    this._renderRank();
    this._renderMoments();
    this._prepareReplay();
    // Sin grabación (p. ej. el tutorial o una partida de prueba): solo el resumen
    const hasRec = !!(data.rec && data.rec.samples.length > 1);
    for (const b of document.querySelectorAll('#fin-pestanas [data-fin]')) b.hidden = !hasRec && b.dataset.fin !== 'resumen';
    $('fin-pestanas').hidden = !hasRec;
    this.showTab('resumen', false);
  }

  hide() {
    this.pause();
  }

  showTab(tab, anim = true) {
    this.tab = tab;
    for (const b of document.querySelectorAll('#fin-pestanas [data-fin]')) b.setAttribute('aria-selected', String(b.dataset.fin === tab));
    rodar($('fin-pestanas'));
    for (const id of ['resumen', 'graficas', 'momentos', 'repeticion']) {
      const panel = $(`fin-${id}`);
      panel.hidden = id !== tab;
      if (id === tab && anim && !sinMovimiento()) panel.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    }
    if (tab !== 'repeticion') this.pause();
    if (tab === 'graficas') requestAnimationFrame(() => this._drawCharts());
    if (tab === 'repeticion') requestAnimationFrame(() => this._drawFrame());
  }

  // ------------------------------------------------------------- resumen

  _renderStats() {
    const d = this.data;
    const s = d.stats || {};
    const cell = (label, value, cls = '') => {
      const c = el('div', `fin-cifra ${cls}`);
      c.append(el('span', 'fc-valor', value), el('span', 'fc-etq', label));
      return c;
    };
    const cells = [];
    if (d.place) cells.push(cell('Puesto', `${ordinal(d.place.place)} de ${d.place.of}`, d.place.place === 1 ? 'oro' : ''));
    cells.push(cell(d.outcome === 'derrota' ? 'Aguantaste' : 'Duración', formatTime(s.seconds || 0)));
    cells.push(cell('Máximo territorio', formatPercent(s.maxShare || 0)));
    cells.push(cell('Eliminaciones', formatNumber(s.kills || 0)));
    cells.push(cell('Edificios', formatNumber(s.built || 0)));
    $('fin-cifras').replaceChildren(...cells);
    // Reto por enlace: ¿superado?
    const old = $('fin-cifras').parentElement.querySelector('.fin-reto');
    old?.remove();
    if (d.challenge) {
      const ok = d.challenge.superado;
      const r = el('p', `fin-reto ${ok ? 'si' : 'no'}`, ok ? `🎯 ¡Reto superado! Has pasado el ${formatPercent(d.challenge.meta / 1000)} de ${d.challenge.de}.` : `🎯 Reto de ${d.challenge.de}: superar el ${formatPercent(d.challenge.meta / 1000)}. Esta vez no.`);
      $('fin-cifras').after(r);
    }
  }

  /** Recompensas que suben desde cero cuando aparece la tarjeta. */
  _renderProgress() {
    const progress = this.data.progress;
    const box = $('fin-progreso');
    box.replaceChildren();
    if (!progress) return;
    const xp = el('p', 'fin-xp');
    const nXp = el('b', '', '+0');
    const nCoins = el('b', '', '+0');
    xp.append(nXp, ' XP · ', nCoins, ' 🪙', progress.levelUp ? ` · ¡Subes al nivel ${progress.level}!` : '');
    box.append(xp);
    let i = 0;
    const line = (text) => {
      const li = el('p', 'fin-logro', text);
      li.style.setProperty('--i', String(i++));
      box.append(li);
    };
    for (const d of progress.daily || []) line(`${d.icon} Reto diario: ${d.name} (+${d.coins} 🪙)`);
    if (progress.dailyBonus) line(`📅 ¡Los tres retos de hoy! (+${progress.dailyBonus} 🪙)`);
    for (const w of progress.weekly || []) line(`${w.icon} Reto semanal: ${w.name} (+${w.coins} 🪙)`);
    for (const a of progress.achievements) line(`${a.icon} Logro conseguido: ${a.name}${a.coins ? ` (+${a.coins} 🪙)` : ''}`);
    setTimeout(() => {
      contar(nXp, progress.xp, { de: 0, ms: 900, formato: (n) => `+${Math.round(n)}` });
      contar(nCoins, progress.coins || 0, { de: 0, ms: 900, formato: (n) => `+${Math.round(n)}` });
    }, 420);
  }

  /** Cambio de rango (partidas clasificatorias): lo pinta `data.renderRank(caja)`. */
  _renderRank() {
    const box = $('fin-rango');
    box.replaceChildren();
    box.hidden = !this.data.renderRank;
    if (this.data.renderRank) this.data.renderRank(box);
  }

  // ------------------------------------------------------------- gráficas

  _drawCharts() {
    const rec = this.data && this.data.rec;
    if (!rec || $('fin-graficas').hidden) return;
    const series = territorySeries(rec, 6);
    drawChart($('fin-graf-terr'), series, { format: (v, max) => `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: max < 0.1 ? 1 : 0 })} %` });
    $('fin-leyenda').replaceChildren(
      ...[...series].reverse().map((s) => {
        const li = el('li', s.me ? 'yo' : '');
        const dot = el('span', 'fl-color');
        dot.style.background = s.me ? '#ffffff' : `rgb(${s.color.join(',')})`;
        li.append(dot, el('span', '', s.me ? `${s.name} (tú)` : s.name));
        return li;
      }),
    );
    const mine = (k) => [{ me: true, color: [255, 255, 255], points: rec.samples.map((s) => [s.t, s.me[k]]) }];
    drawChart($('fin-graf-tropas'), mine(1), { format: (v) => formatNumber(Math.round(v / 10)), fillColor: 'rgba(120, 180, 255, 0.25)' });
    drawChart($('fin-graf-oro'), mine(2), { format: (v) => formatNumber(Math.round(v)), fillColor: 'rgba(255, 210, 90, 0.25)' });
  }

  // ------------------------------------------------------- momentos clave

  _renderMoments() {
    const rec = this.data.rec;
    const list = $('fin-lista-momentos');
    if (!rec || !rec.moments.length) {
      list.replaceChildren(el('li', 'momento-vacio', 'Una partida tranquila: no hubo grandes momentos.'));
      return;
    }
    list.replaceChildren(
      ...rec.moments.map((m, i) => {
        const li = el('li', `momento ${m.tone || ''}`);
        li.style.setProperty('--i', String(Math.min(i, 12)));
        li.append(el('span', 'mo-tiempo', mmss(m.t)), el('span', 'mo-icono', m.icon), el('span', 'mo-texto', m.text));
        return li;
      }),
    );
  }

  // ------------------------------------------------------------ repetición

  _prepareReplay() {
    const rec = this.data.rec;
    const c = $('fin-repe');
    if (!rec || !rec.snaps.length) return;
    c.width = rec.sw;
    c.height = rec.sh;
    c.style.aspectRatio = `${rec.sw} / ${rec.sh}`;
    this.palette = rec.palette();
    this.frame = rec.snaps.length - 1;
    $('repe-barra').max = String(rec.snaps.length - 1);
    $('repe-barra').value = String(this.frame);
  }

  _drawFrame() {
    const rec = this.data && this.data.rec;
    if (!rec || !rec.snaps.length) return;
    const snap = rec.snaps[Math.max(0, Math.min(rec.snaps.length - 1, this.frame))];
    drawSnap($('fin-repe').getContext('2d'), rec, snap, this.palette, this.data.human.id);
    $('repe-tiempo').textContent = mmss(snap.t);
    $('repe-barra').value = String(this.frame);
  }

  play() {
    const rec = this.data && this.data.rec;
    if (!rec || rec.snaps.length < 2) return;
    if (this.frame >= rec.snaps.length - 1) this.frame = 0;
    this.playing = true;
    $('repe-play').textContent = '❚❚';
    $('repe-play').setAttribute('aria-label', 'Pausa');
    let last = performance.now();
    let acc = 0;
    const step = (now) => {
      if (!this.playing) return;
      acc += ((now - last) / 1000) * FPS * this.speed;
      last = now;
      if (acc >= 1) {
        this.frame = Math.min(rec.snaps.length - 1, this.frame + Math.floor(acc));
        acc %= 1;
        this._drawFrame();
        if (this.frame >= rec.snaps.length - 1) {
          this.pause();
          return;
        }
      }
      this._raf = requestAnimationFrame(step);
    };
    this._drawFrame();
    this._raf = requestAnimationFrame(step);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this._raf || 0);
    const b = $('repe-play');
    if (b) {
      b.textContent = '▶';
      b.setAttribute('aria-label', 'Reproducir');
    }
  }
}

/** Abre el diálogo de fin (con su entrada en dos tiempos) y la pantalla. */
export function abrirFin(pantalla, data) {
  pantalla.show(data);
  abrirDialogo($('fin'), { ms: 450, tarjeta: false, foco: '#fin-nueva', sinFondo: true, alCerrar: () => pantalla.hide() });
  const card = $('fin').querySelector('.tarjeta');
  if (card && card.animate && !sinMovimiento()) {
    card.animate(
      [{ opacity: 0, transform: 'translateY(18px) scale(0.96)' }, { opacity: 1, transform: 'none' }],
      { duration: 420, delay: 120, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' },
    );
  }
}
