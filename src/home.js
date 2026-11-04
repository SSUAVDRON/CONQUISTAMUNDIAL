// Pantallas de inicio: jugar (IA y multijugador), perfil, apariencia, logros,
// clasificación, y la sala de espera del multijugador.
import { DEFAULT_RULES, MAP_SIZES, REAL_MAPS, START_GOLDS, WIN_SHARES, mapLabel } from './config.js';
import { REAL_MAP_DATA } from './mapas-reales.js';
import { generateMap } from './map.js';
import { hexToRgb } from './colors.js';
import { PATTERN_FNS, drawEmblem } from './icons.js';
import { formatNumber, formatPercent, formatTime } from './format.js';
import {
  ACHIEVEMENTS, PATTERNS, SHAPES, SYMBOLS, TITLES,
  hasAchievement, isUnlocked, levelInfo, rewardsOf, titleName, unlockText,
} from './profile.js';

const $ = (id) => document.getElementById(id);
const DIFFICULTY = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

/** Opciones del selector de mapa: mundo real primero, luego aleatorios. */
function fillMapSelect(select) {
  const real = el('optgroup', { label: 'Mundo real (los bots son países)' },
    ...Object.entries(REAL_MAPS).map(([id, name]) => el('option', { value: id, text: name })));
  const random = el('optgroup', { label: 'Aleatorio' },
    ...Object.entries(MAP_SIZES).map(([id, m]) => el('option', { value: id, text: m.label })));
  select.replaceChildren(real, random);
}

// Colores de las miniaturas: agua, llanura, meseta, montaña
const THUMB_COLORS = [[23, 58, 104], [104, 150, 82], [160, 148, 100], [150, 140, 130]];

/** Miniatura de un mapa: real (desde sus datos) o aleatorio (con una semilla fija). */
function mapThumb(id, width = 168) {
  let w;
  let h;
  let terrain;
  if (REAL_MAP_DATA[id]) {
    ({ w, h } = REAL_MAP_DATA[id]);
    terrain = new Uint8Array(w * h);
    const bin = atob(REAL_MAP_DATA[id].rle);
    for (let k = 0, i = 0; k < bin.length; k++) {
      const b = bin.charCodeAt(k);
      terrain.fill(b >> 6, i, i + (b & 63) + 1);
      i += (b & 63) + 1;
    }
  } else {
    const size = MAP_SIZES[id];
    const map = generateMap(Math.round(size.w / 3), Math.round(size.h / 3), 7 + Object.keys(MAP_SIZES).indexOf(id));
    ({ width: w, height: h, terrain } = map);
  }
  const height = Math.round((width * h) / w);
  const c = el('canvas', { width, height, 'aria-hidden': 'true' });
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / height));
    for (let x = 0; x < width; x++) {
      const t = terrain[sy * w + Math.min(w - 1, Math.floor((x * w) / width))];
      const [r, g, b] = THUMB_COLORS[t];
      const o = (y * width + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Control segmentado (botones excluyentes). */
function segmented(box, options, current, onChange) {
  box.replaceChildren(
    ...options.map(([value, label]) => {
      const btn = el('button', { type: 'button', role: 'radio', 'aria-checked': String(value === current), text: label });
      btn.addEventListener('click', () => {
        for (const b of box.children) b.setAttribute('aria-checked', String(b === btn));
        onChange(value);
      });
      return btn;
    }),
  );
}

/** Resumen de las reglas para la sala: "Victoria 70 % · sin misiles…". */
export function rulesSummary(r) {
  if (!r) return '';
  const parts = [`victoria al ${Math.round(r.winShare * 100)} %`];
  if (r.startGold) parts.push(`${formatNumber(r.startGold)} de oro inicial`);
  if (!r.missiles) parts.push('sin misiles');
  if (!r.warships) parts.push('sin buques');
  return parts.join(' · ');
}

/** Máximo de bots en un mapa real: uno por país disponible. */
function maxBotsFor(mapId) {
  return REAL_MAP_DATA[mapId] ? REAL_MAP_DATA[mapId].countries.length : 60;
}

function emblemCanvas(emblem, size = 32) {
  const c = el('canvas', { width: size * 2, height: size * 2, class: 'emblema', 'aria-hidden': 'true' });
  c.style.width = c.style.height = `${size}px`;
  drawEmblem(c.getContext('2d'), emblem, size, size, size * 1.9);
  return c;
}

function patternCanvas(patternId, color, w = 96, h = 56) {
  const c = el('canvas', { width: w, height: h, 'aria-hidden': 'true' });
  const ctx = c.getContext('2d');
  const [r, g, b] = hexToRgb(color);
  const fn = PATTERN_FNS[patternId];
  const cell = 4;
  for (let y = 0; y < h / cell; y++) {
    for (let x = 0; x < w / cell; x++) {
      const alt = fn && fn(x, y);
      const k = alt ? 0.72 : 1;
      ctx.fillStyle = `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  return c;
}

export class Home {
  /**
   * handlers: onProfileChange(), onQuickPlay(opts), onCreateRoom(), onJoinRoom(code),
   *           onLeaveRoom(), onStartRoom(), onRoomSettings(settings), onCopyCode()
   */
  constructor(profile, handlers) {
    this.profile = profile;
    this.h = handlers;
    this.view = 'jugar';
    this.table = 'global';
    this.global = { available: false, rows: [], error: '', stale: false, myId: null };
    this.rooms = [];

    for (const tab of document.querySelectorAll('.ini-pestanas [data-vista]')) {
      tab.addEventListener('click', () => this.setView(tab.dataset.vista));
    }
    $('chip-perfil').addEventListener('click', () => this.setView('perfil'));

    // Tarjetas de modo
    for (const card of document.querySelectorAll('.modo[data-modo]')) {
      card.addEventListener('click', () => this._mode(card.dataset.modo));
    }
    for (const btn of document.querySelectorAll('.cerrar-panel')) btn.addEventListener('click', () => this._openPanel(null));

    // Partida contra la IA
    const a = this.profile.ajustes;
    this.choice = { map: REAL_MAPS[a.mapa] || MAP_SIZES[a.mapa] ? a.mapa : 'mundo', difficulty: a.dificultad, rules: { ...DEFAULT_RULES, ...a.reglas } };
    this._buildGallery();
    segmented($('seg-dificultad'), [['facil', 'Fácil'], ['normal', 'Normal'], ['dificil', 'Difícil']], this.choice.difficulty, (v) => {
      this.choice.difficulty = v;
    });
    segmented($('seg-victoria'), WIN_SHARES.map((v) => [v, `${Math.round(v * 100)} %`]), this.choice.rules.winShare, (v) => {
      this.choice.rules.winShare = v;
    });
    segmented($('seg-oro'), START_GOLDS.map((v) => [v, v ? formatNumber(v) : 'Nada']), this.choice.rules.startGold, (v) => {
      this.choice.rules.startGold = v;
    });
    $('in-misiles').checked = this.choice.rules.missiles;
    $('in-buques').checked = this.choice.rules.warships;
    $('in-misiles').addEventListener('change', () => {
      this.choice.rules.missiles = $('in-misiles').checked;
    });
    $('in-buques').addEventListener('change', () => {
      this.choice.rules.warships = $('in-buques').checked;
    });
    this._syncBots = () => {
      const max = Math.min(60, maxBotsFor(this.choice.map));
      $('in-bots').max = String(max);
      if (Number($('in-bots').value) > max) $('in-bots').value = String(max);
      $('out-bots').textContent = $('in-bots').value;
      $('nota-rivales').textContent = REAL_MAPS[this.choice.map] ? `(hasta ${max} países)` : '';
      $('campo-semilla').hidden = !!REAL_MAPS[this.choice.map];
    };
    $('in-bots').addEventListener('input', this._syncBots);
    $('form-rapida').addEventListener('submit', (e) => {
      e.preventDefault();
      const opts = {
        bots: Number($('in-bots').value),
        mapSize: this.choice.map,
        difficulty: this.choice.difficulty,
        seed: REAL_MAPS[this.choice.map] ? '' : $('in-semilla').value.trim(),
        rules: { ...this.choice.rules },
      };
      Object.assign(this.profile.ajustes, { bots: opts.bots, mapa: opts.mapSize, dificultad: opts.difficulty, reglas: opts.rules });
      this.h.onProfileChange?.(false);
      this.h.onQuickPlay?.(opts);
    });

    // Ajustes
    const toggles = { 'aj-alerta': 'alerta', 'aj-puntero': 'puntero', 'aj-marcadores': 'marcadores', 'aj-emojis': 'emojis', 'aj-animaciones': 'animaciones' };
    for (const [id, key] of Object.entries(toggles)) {
      $(id).checked = this.profile.ajustes[key] !== false;
      $(id).addEventListener('change', () => {
        this.profile.ajustes[key] = $(id).checked;
        this.h.onProfileChange?.(false);
        this.h.onSettings?.();
      });
    }
    $('aj-tutorial').addEventListener('click', () => this.h.onTutorial?.());

    // Multijugador
    $('btn-crear-sala').addEventListener('click', () => this.h.onCreateRoom?.());
    $('form-unirse').addEventListener('submit', (e) => {
      e.preventDefault();
      this.h.onJoinRoom?.($('in-codigo').value);
    });
    $('lista-salas').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-code]');
      if (b) this.h.onJoinRoom?.(b.dataset.code);
    });

    // Perfil
    $('in-nombre').addEventListener('input', () => {
      this.profile.nombre = $('in-nombre').value.trim().slice(0, 18);
      this._profileChanged();
    });
    $('in-color').addEventListener('input', () => {
      this.profile.color = $('in-color').value;
      this._profileChanged();
    });
    $('in-titulo').addEventListener('change', () => {
      this.profile.titulo = $('in-titulo').value;
      this._profileChanged();
    });
    $('in-emb-fondo').addEventListener('input', () => {
      this.profile.emblema.bg = $('in-emb-fondo').value;
      this._profileChanged();
    });
    $('in-emb-figura').addEventListener('input', () => {
      this.profile.emblema.fg = $('in-emb-figura').value;
      this._profileChanged();
    });

    // Clasificación
    for (const b of document.querySelectorAll('.sub-pestanas [data-tabla]')) {
      b.addEventListener('click', () => {
        this.table = b.dataset.tabla;
        this.renderTable();
      });
    }

    // Sala
    $('btn-salir-sala').addEventListener('click', () => this.h.onLeaveRoom?.());
    $('btn-empezar').addEventListener('click', () => this.h.onStartRoom?.());
    $('btn-copiar-codigo').addEventListener('click', () => this.h.onCopyCode?.());

    $('in-bots').value = a.bots;
    this._syncBots();
  }

  /** Clic en una tarjeta de modo. */
  _mode(mode) {
    if (mode === 'rapida') {
      this.h.onQuickPlay?.({ bots: 30, mapSize: 'mundo', difficulty: this.profile.ajustes.dificultad, seed: '', rules: { ...DEFAULT_RULES } });
    } else if (mode === 'tutorial') {
      this.h.onTutorial?.();
    } else {
      this._openPanel(this.panel === mode ? null : mode);
    }
  }

  _openPanel(name) {
    this.panel = name;
    for (const p of document.querySelectorAll('.panel-modo')) p.hidden = p.dataset.panel !== name;
    for (const card of document.querySelectorAll('.modo[data-modo]')) {
      if (card.dataset.modo === 'ia' || card.dataset.modo === 'online') card.setAttribute('aria-expanded', String(card.dataset.modo === name));
    }
    const panel = name && document.querySelector(`.panel-modo[data-panel="${name}"]`);
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  _buildGallery() {
    const entries = [
      ...Object.entries(REAL_MAPS).map(([id, name]) => [id, name, `${REAL_MAP_DATA[id].countries.length} países`]),
      ...Object.entries(MAP_SIZES).map(([id, m]) => [id, `Aleatorio ${m.label.toLowerCase()}`, 'Nuevo mundo cada vez']),
    ];
    $('galeria-mapas').replaceChildren(
      ...entries.map(([id, name, sub]) =>
        el(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: 'mapa-tarjeta',
            'aria-checked': String(id === this.choice.map),
            'data-map': id,
            onclick: () => {
              this.choice.map = id;
              for (const b of $('galeria-mapas').children) b.setAttribute('aria-checked', String(b.dataset.map === id));
              this._syncBots();
            },
          },
          mapThumb(id),
          el('strong', { text: name }),
          el('small', { text: sub }),
        ),
      ),
    );
  }

  /** Abre directamente un panel (por ejemplo, el multijugador al volver de una sala). */
  openPanel(name) {
    this.setView('jugar');
    this._openPanel(name);
  }

  _profileChanged() {
    this.renderChip();
    this.renderIdentity();
    this.renderPatterns();
    this.h.onProfileChange?.(true);
  }

  show() {
    $('inicio').hidden = false;
    $('sala').hidden = true;
    this.renderAll();
  }

  hide() {
    $('inicio').hidden = true;
  }

  setView(view) {
    this.view = view;
    for (const tab of document.querySelectorAll('.ini-pestanas [data-vista]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.vista === view));
    }
    for (const sec of document.querySelectorAll('.vista[data-vista]')) sec.hidden = sec.dataset.vista !== view;
    if (view === 'clasificacion') this.renderTable();
  }

  renderAll() {
    this.renderChip();
    this.renderIdentity();
    this.renderProgress();
    this.renderPatterns();
    this.renderAchievements();
    this.renderTable();
    this.renderRooms();
  }

  // ------------------------------------------------------------- cabecera

  renderChip() {
    const p = this.profile;
    const c = $('chip-emblema');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    drawEmblem(ctx, p.emblema, c.width / 2, c.height / 2, c.width * 0.95);
    const info = levelInfo(p.xp);
    $('chip-nombre').textContent = p.nombre || 'Sin nombre';
    const title = titleName(p);
    $('chip-nivel').textContent = `Nivel ${info.level}${title ? ` · ${title}` : ''}`;
    $('chip-xp').style.width = `${Math.round(info.progress * 100)}%`;
    const total = ACHIEVEMENTS.filter((a) => hasAchievement(p, a.id)).length;
    $('cuenta-logros').textContent = `${total}/${ACHIEVEMENTS.length}`;
  }

  // --------------------------------------------------------------- perfil

  renderIdentity() {
    const p = this.profile;
    const c = $('perfil-emblema');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    drawEmblem(ctx, p.emblema, c.width / 2, c.height / 2, c.width * 0.92);
    if (document.activeElement !== $('in-nombre')) $('in-nombre').value = p.nombre;
    $('in-color').value = p.color;
    $('in-emb-fondo').value = p.emblema.bg;
    $('in-emb-figura').value = p.emblema.fg;

    const sel = $('in-titulo');
    sel.replaceChildren(
      ...TITLES.map((t) => {
        const ok = isUnlocked(p, t);
        return el('option', { value: t.id, disabled: !ok, text: ok ? t.name : `${t.name} (${unlockText(t)})` });
      }),
    );
    sel.value = p.titulo;

    this._renderSelector($('sel-formas'), SHAPES, p.emblema.shape, (item) => ({ ...p.emblema, shape: item.id }), (id) => {
      p.emblema.shape = id;
    });
    this._renderSelector($('sel-simbolos'), SYMBOLS, p.emblema.symbol, (item) => ({ ...p.emblema, symbol: item.id }), (id) => {
      p.emblema.symbol = id;
    });
  }

  _renderSelector(box, items, current, preview, apply) {
    box.replaceChildren(
      ...items.map((item) => {
        const ok = isUnlocked(this.profile, item);
        const btn = el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(item.id === current),
            class: `opcion${ok ? '' : ' bloqueada'}`,
            disabled: !ok,
            title: ok ? item.name : `${item.name}: ${unlockText(item)}`,
            onclick: () => {
              apply(item.id);
              this._profileChanged();
            },
          },
          emblemCanvas(preview(item), 30),
          el('span', { text: ok ? item.name : `🔒 ${unlockText(item)}` }),
        );
        return btn;
      }),
    );
  }

  renderProgress() {
    const p = this.profile;
    const info = levelInfo(p.xp);
    $('perfil-nivel').textContent = info.level;
    $('perfil-xp-barra').style.width = `${Math.round(info.progress * 100)}%`;
    $('perfil-xp').textContent = `${p.xp - info.start} / ${info.next - info.start} XP para el nivel ${info.level + 1}`;
    const s = p.stats;
    const rows = [
      ['Partidas', s.partidas],
      ['Victorias', `${s.victorias}${s.partidas ? ` (${Math.round((100 * s.victorias) / s.partidas)} %)` : ''}`],
      ['Naciones eliminadas', s.eliminaciones],
      ['Edificios construidos', s.edificios],
      ['Alianzas firmadas', s.alianzas],
      ['Partidas online', s.online],
      ['Mayor territorio', formatPercent(s.mejorPct)],
      ['Victoria más rápida', s.mejorTiempo == null ? '—' : formatTime(s.mejorTiempo)],
      ['Tiempo jugado', formatTime(s.tiempoJugado)],
    ];
    $('estadisticas').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: String(v) })]));
  }

  setCloudNote(text) {
    $('nota-nube').textContent = text;
  }

  // ----------------------------------------------------------- apariencia

  renderPatterns() {
    const p = this.profile;
    $('sel-patrones').replaceChildren(
      ...PATTERNS.map((item) => {
        const ok = isUnlocked(p, item);
        return el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(item.id === p.patron),
            class: `patron${ok ? '' : ' bloqueada'}`,
            disabled: !ok,
            onclick: () => {
              p.patron = item.id;
              this._profileChanged();
            },
          },
          patternCanvas(item.id, p.color),
          el('span', { class: 'patron-nombre', text: item.name }),
          ok ? null : el('span', { class: 'patron-req', text: `🔒 ${unlockText(item)}` }),
        );
      }),
    );
  }

  // --------------------------------------------------------------- logros

  renderAchievements() {
    const p = this.profile;
    const done = ACHIEVEMENTS.filter((a) => hasAchievement(p, a.id)).length;
    $('logros-resumen').textContent = `${done} de ${ACHIEVEMENTS.length}`;
    $('lista-logros').replaceChildren(
      ...ACHIEVEMENTS.map((a) => {
        const when = hasAchievement(p, a.id) ? p.logros[a.id] : 0;
        const rewards = rewardsOf(a.id);
        return el(
          'li',
          { class: when ? 'conseguido' : '' },
          el('span', { class: 'logro-icono', 'aria-hidden': 'true', text: a.icon }),
          el(
            'div',
            { class: 'logro-texto' },
            el('strong', { text: a.name }),
            el('span', { text: a.desc }),
            rewards.length ? el('small', { text: `Recompensa: ${rewards.join(' · ')}` }) : null,
          ),
          el('span', {
            class: 'logro-estado',
            text: when ? new Date(when).toLocaleDateString('es-ES') : 'Pendiente',
          }),
        );
      }),
    );
  }

  // --------------------------------------------------------- clasificación

  setGlobal(state) {
    this.global = { ...this.global, ...state };
    if (this.view === 'clasificacion' && this.table === 'global') this.renderTable();
  }

  renderTable() {
    for (const b of document.querySelectorAll('.sub-pestanas [data-tabla]')) b.classList.toggle('activo', b.dataset.tabla === this.table);
    const box = $('tabla-clasificacion');
    if (this.table === 'global') box.replaceChildren(...this._globalTable());
    else if (this.table === 'records') box.replaceChildren(...this._recordsTable());
    else box.replaceChildren(...this._historyTable());
  }

  _globalTable() {
    const g = this.global;
    if (!g.available) {
      return [el('p', { class: 'nota', text: g.error || 'La clasificación global funciona al jugar desde el enlace de Claude. Aquí ves tus récords y tu historial.' })];
    }
    const out = [];
    if (g.error) out.push(el('p', { class: 'nota', text: g.error }));
    if (!g.rows.length) {
      out.push(el('p', { class: 'nota', text: 'Todavía no hay nadie. Termina una partida para aparecer aquí.' }));
      return out;
    }
    const table = el('table', { class: 'tabla' });
    table.append(
      el('thead', {}, el('tr', {}, ...['#', 'Nación', 'Nivel', 'Victorias', 'Partidas', 'Mayor %'].map((h) => el('th', { text: h })))),
    );
    const body = el('tbody');
    g.rows.forEach((r, i) => {
      body.append(
        el(
          'tr',
          { class: r.id === g.myId ? 'yo' : '' },
          el('td', { class: 'num', text: String(i + 1) }),
          el(
            'td',
            {},
            el('span', { class: 'celda-nacion' }, emblemCanvas(r.emblema, 22), el('span', {}, el('strong', { text: r.nombre }), r.titulo ? el('small', { text: r.titulo }) : null)),
          ),
          el('td', { class: 'num', text: String(r.nivel) }),
          el('td', { class: 'num', text: String(r.victorias) }),
          el('td', { class: 'num', text: String(r.partidas) }),
          el('td', { class: 'num', text: formatPercent(r.mejorPct) }),
        ),
      );
    });
    table.append(body);
    out.push(table);
    if (g.stale) out.push(el('p', { class: 'nota', text: 'Mostrando datos guardados; se actualizarán en cuanto haya conexión.' }));
    return out;
  }

  _recordsTable() {
    const p = this.profile;
    const s = p.stats;
    const best = [...p.historial].sort((a, b) => b.pct - a.pct).slice(0, 5);
    const records = el(
      'dl',
      { class: 'estadisticas' },
      ...[
        ['Mayor territorio', formatPercent(s.mejorPct)],
        ['Victoria más rápida', s.mejorTiempo == null ? '—' : formatTime(s.mejorTiempo)],
        ['Victorias', String(s.victorias)],
        ['Naciones eliminadas', String(s.eliminaciones)],
      ].flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]),
    );
    const out = [records, el('h3', { text: 'Mejores partidas' })];
    if (!best.length) out.push(el('p', { class: 'nota', text: 'Juega una partida para ver tus récords.' }));
    else out.push(this._gamesTable(best));
    return out;
  }

  _historyTable() {
    const h = this.profile.historial;
    if (!h.length) return [el('p', { class: 'nota', text: 'Aún no has terminado ninguna partida.' })];
    return [this._gamesTable(h)];
  }

  _gamesTable(games) {
    const table = el('table', { class: 'tabla' });
    table.append(el('thead', {}, el('tr', {}, ...['Fecha', 'Resultado', 'Territorio', 'Duración', 'Mapa'].map((x) => el('th', { text: x })))));
    const body = el('tbody');
    for (const g of games) {
      body.append(
        el(
          'tr',
          {},
          el('td', { text: new Date(g.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) }),
          el('td', { text: `${g.resultado}${g.online ? ' · online' : ''}` }),
          el('td', { class: 'num', text: formatPercent(g.pct) }),
          el('td', { class: 'num', text: formatTime(g.duracion) }),
          el('td', { text: mapLabel(g.mapa) }),
        ),
      );
    }
    table.append(body);
    return table;
  }

  // ------------------------------------------------------------- en línea

  /** kind: 'claude' | 'local' | null; detail: texto opcional. */
  setNetStatus(kind, detail = '') {
    const chip = $('estado-red');
    const labels = { claude: 'En línea', local: 'Modo local', none: 'No disponible', connecting: 'Conectando…' };
    chip.textContent = labels[kind || 'none'];
    chip.className = `chip ${kind === 'claude' ? 'bien' : kind === 'local' ? 'aviso' : ''}`;
    const usable = kind === 'claude' || kind === 'local';
    $('btn-crear-sala').disabled = !usable;
    $('form-unirse').querySelector('button').disabled = !usable;
    $('nota-red').textContent =
      detail ||
      (kind === 'claude'
        ? 'Comparte el código con quien tenga este enlace. Para jugar necesitan permiso de colaborador.'
        : kind === 'local'
          ? 'Fuera de Claude solo pueden unirse otras pestañas de este navegador (útil para probar).'
          : kind === 'connecting'
            ? ''
            : 'Este navegador no permite el modo multijugador.');
  }

  setRooms(rooms) {
    this.rooms = rooms;
    this.renderRooms();
  }

  renderRooms() {
    const list = $('lista-salas');
    if (!this.rooms.length) {
      list.replaceChildren(el('li', { class: 'vacia', text: 'No hay salas abiertas ahora mismo. Crea una.' }));
      return;
    }
    list.replaceChildren(
      ...this.rooms.map((r) =>
        el(
          'li',
          {},
          el(
            'span',
            { class: 'sala-info' },
            el('strong', { text: `Sala de ${String(r.nombre || 'alguien').slice(0, 18)}` }),
            el('small', { text: `${r.jugadores || 1} jugador${r.jugadores === 1 ? '' : 'es'} · ${mapLabel(r.mapa)} · ${Number(r.bots) || 0} bots` }),
          ),
          el('button', { type: 'button', 'data-code': r.code, text: 'Entrar' }),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- sala

  showLobby() {
    $('inicio').hidden = true;
    $('sala').hidden = false;
  }

  hideLobby() {
    $('sala').hidden = true;
  }

  renderLobby(sala, kind, status = '') {
    $('sala-codigo').textContent = sala.code.toUpperCase();
    const players = sala.players();
    $('sala-jugadores').replaceChildren(
      ...players.map((p) =>
        el(
          'li',
          { class: p.isMe ? 'yo' : '' },
          emblemCanvas(p.emblem, 30),
          el('span', { class: 'sala-nombre' }, el('strong', { text: p.name }), el('small', { text: `Nivel ${p.level}${p.title ? ` · ${p.title}` : ''}` })),
          el('span', { class: 'chip', text: p.host ? 'Anfitrión' : p.isMe ? 'Tú' : 'Listo' }),
        ),
      ),
    );

    const box = $('sala-ajustes');
    const s = sala.isHost ? sala.settings : sala.hostSettings();
    if (sala.isHost) {
      if (!box.dataset.host) {
        box.dataset.host = '1';
        box.replaceChildren(
          el('label', { class: 'campo' }, el('span', {}, 'Bots ', el('strong', { id: 'sala-out-bots', text: String(s.bots) })),
            el('input', { id: 'sala-bots', type: 'range', min: '0', max: '50', value: String(s.bots), oninput: () => this._lobbyChanged() })),
          el('div', { class: 'fila-2' },
            el('label', { class: 'campo' }, el('span', { text: 'Mapa' }),
              el('select', { id: 'sala-mapa', onchange: () => this._lobbyChanged() })),
            el('label', { class: 'campo' }, el('span', { text: 'Dificultad' }),
              el('select', { id: 'sala-dificultad', onchange: () => this._lobbyChanged() }, ...Object.entries(DIFFICULTY).map(([k, v]) => el('option', { value: k, text: v }))))),
        );
        fillMapSelect($('sala-mapa'));
        $('sala-mapa').value = s.mapSize;
        $('sala-dificultad').value = s.difficulty;
      }
    } else {
      delete box.dataset.host;
      box.replaceChildren(
        el('p', { class: 'nota', text: s ? `Mapa ${mapLabel(s.mapSize)} · ${s.bots} bots · dificultad ${DIFFICULTY[s.difficulty] || 'normal'} · ${rulesSummary(s.rules)}` : 'Esperando al anfitrión…' }),
      );
    }

    $('btn-empezar').hidden = !sala.isHost;
    const where = `${kind === 'local' ? 'Modo local: solo pueden entrar otras pestañas de este navegador.' : 'Comparte el código: entran quienes tengan este enlace.'} Reglas: ${rulesSummary(s && s.rules)}.`;
    $('sala-estado').textContent = status || (sala.isHost ? `${where} Puedes empezar cuando quieras; el resto de naciones las lleva la IA.` : 'El anfitrión empezará la partida.');
  }

  _lobbyChanged() {
    const max = Math.min(50, maxBotsFor($('sala-mapa').value));
    $('sala-bots').max = String(max);
    if (Number($('sala-bots').value) > max) $('sala-bots').value = String(max);
    $('sala-out-bots').textContent = $('sala-bots').value;
    this.h.onRoomSettings?.({
      bots: Number($('sala-bots').value),
      mapSize: $('sala-mapa').value,
      difficulty: $('sala-dificultad').value,
      rules: { ...this.choice.rules },
    });
  }
}
