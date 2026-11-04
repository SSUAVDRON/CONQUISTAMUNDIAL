// Pantallas de inicio: jugar (IA y multijugador), perfil, apariencia, logros,
// clasificación, y la sala de espera del multijugador.
import { BUILDINGS, DEFAULT_RULES, GOLD_STEPS, MAP_SIZES, REAL_MAPS, RES, WIN_SHARES, colonyCount, mapLabel } from './config.js';
import { REAL_MAP_DATA } from './mapas-reales.js';
import { decodeRelief, generateMap } from './map.js';
import { paintMapPreview } from './terreno.js';
import { hexToRgb } from './colors.js';
import { PATTERN_FNS, drawBuildingReal, drawEmblem, drawFrame } from './icons.js';
import { drawTransport, drawWarship } from './barcos.js';
import { drawMissileSprite } from './fx.js';
import { formatNumber, formatPercent, formatTime } from './format.js';
import {
  ACHIEVEMENTS, BANNERS, FRAMES, NAME_COLORS, PATTERNS, SHAPES, SYMBOLS, TITLES,
  hasAchievement, isUnlocked, levelInfo, nameColorOf, rewardsOf, titleName, unlockText,
} from './profile.js';

/** Colores rápidos para el territorio y el emblema. */
const SWATCHES = [
  '#2f7dff', '#1fb5ff', '#20c997', '#3ddc84', '#8bd346', '#ffd23f', '#ffa23d', '#ff6b3d',
  '#ff4d6d', '#e0483f', '#c2185b', '#b05cff', '#7b5cff', '#5b6b8c', '#f2f4f8', '#1b2133',
];

/** Lo que se muestra en «Tu arsenal»: dibujo del juego, nombre y para qué sirve. */
const ARSENAL = [
  { kind: 'city', text: 'Más tropas máximas' },
  { kind: 'port', text: 'Pesca, comercio y oro' },
  { kind: 'fort', text: 'Defensa ×2,5 alrededor' },
  { kind: 'factory', text: '+25 % de oro' },
  { kind: 'silo', text: 'Lanza misiles' },
  { kind: 'sam', text: 'Derriba misiles' },
  { kind: 'warship', text: 'Domina el mar' },
  { kind: 'transporte', name: 'Desembarco', text: 'Tropas por mar' },
  { kind: 'missile', text: 'Arrasa una zona' },
];

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

/** Datos de un mapa real ya decodificados (terreno y relieve), para miniaturas y portada. */
const realCache = new Map();
function realPreviewData(id) {
  let d = realCache.get(id);
  if (d) return d;
  const data = REAL_MAP_DATA[id];
  const { w, h } = data;
  const terrain = new Uint8Array(w * h);
  const bin = atob(data.rle);
  for (let k = 0, i = 0; k < bin.length; k++) {
    const b = bin.charCodeAt(k);
    terrain.fill(b >> 6, i, i + (b & 63) + 1);
    i += (b & 63) + 1;
  }
  const mid = data.lat ? (((data.lat[0] + data.lat[1]) / 2) * Math.PI) / 180 : 0;
  const tileKm = data.lon ? ((data.lon[1] - data.lon[0]) * 111 * Math.max(0.3, Math.cos(mid))) / w : 5;
  d = { w, h, terrain, relief: data.relief ? decodeRelief(data.relief) : null, tileKm, countries: data.countries };
  realCache.set(id, d);
  return d;
}

/** Casillas de tierra de un mapa (para calcular las colonias automáticas sin cargarlo). */
const landCache = new Map();
function landTilesOf(id) {
  if (landCache.has(id)) return landCache.get(id);
  let n;
  if (REAL_MAP_DATA[id]) {
    const t = realPreviewData(id).terrain;
    n = 0;
    for (let i = 0; i < t.length; i++) if (t[i]) n++;
  } else {
    const size = MAP_SIZES[id] || MAP_SIZES.mediano;
    n = Math.round(size.w * size.h * 0.42);
  }
  landCache.set(id, n);
  return n;
}

/** Miniatura de un mapa (real o aleatorio con semilla fija) con el mismo estilo que la partida. */
function mapThumb(id, width = 168) {
  let data;
  if (REAL_MAP_DATA[id]) data = realPreviewData(id);
  else {
    const size = MAP_SIZES[id];
    const map = generateMap(Math.round(size.w / (3 * RES)), Math.round(size.h / (3 * RES)), 7 + Object.keys(MAP_SIZES).indexOf(id));
    data = { w: map.width, h: map.height, terrain: map.terrain, relief: map.relief, tileKm: map.tileKm * 3 };
  }
  const height = Math.round((width * data.h) / data.w);
  const c = el('canvas', { width, height, 'aria-hidden': 'true' });
  paintMapPreview(c, data);
  return c;
}

/**
 * Portada: nuestro mapa del mundo (de la costa de América a Oriente Próximo,
 * con Europa y el Mediterráneo en la parte que no tapa el texto) y las
 * naciones como territorios suaves con borde fino, igual que en la partida.
 * Cada casilla de tierra es del país cuyo centro le queda más cerca,
 * contando su tamaño (los países grandes llegan más lejos).
 */
function paintCover(canvas) {
  const data = realPreviewData('mundo');
  const x0 = Math.round(data.w * 0.235);
  const x1 = Math.round(data.w * 0.67);
  const cropW = x1 - x0;
  const cropH = Math.round((cropW * canvas.height) / canvas.width);
  const y0 = Math.round(data.h * 0.13);
  paintMapPreview(canvas, data, [x0, y0, x1, y0 + cropH]);
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const k = W / cropW;
  // Países a la vista (o cerca): posición en píxeles, peso por tamaño y color suave
  const nations = [];
  data.countries.forEach(([, tile, area], i) => {
    const x = ((tile % data.w) - x0 + 0.5) * k;
    const y = (Math.floor(tile / data.w) - y0 + 0.5) * k;
    if (x < -W * 0.3 || y < -H * 0.5 || x > W * 1.3 || y > H * 1.5) return;
    const hue = (i * 137.508 + 20) % 360;
    const [r, g, b] = hslRgb(hue, 0.5, 0.62);
    const [br, bg, bb] = hslRgb(hue, 0.5, 0.3);
    nations.push({ x, y, w: (area / Math.PI) * k * k * 0.7, c: [r, g, b], e: [br, bg, bb] });
  });
  if (!nations.length) return;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const owner = new Int16Array(W * H).fill(-1);
  const maxD2 = (110 * k) ** 2;
  for (let py = 0; py < H; py++) {
    const ty = Math.min(data.h - 1, Math.floor(y0 + (py + 0.5) / k));
    for (let px = 0; px < W; px++) {
      const tx = Math.min(data.w - 1, Math.floor(x0 + (px + 0.5) / k));
      if (data.terrain[ty * data.w + tx] === 0) continue;
      let best = -1;
      let bestV = Infinity;
      let bestD2 = 0;
      for (let n = 0; n < nations.length; n++) {
        const q = nations[n];
        const d2 = (q.x - px) ** 2 + (q.y - py) ** 2;
        const v = d2 - q.w;
        if (v < bestV) {
          bestV = v;
          best = n;
          bestD2 = d2;
        }
      }
      if (best >= 0 && bestD2 < maxD2 + nations[best].w) owner[py * W + px] = best;
    }
  }
  for (let i = 0; i < W * H; i++) {
    const o = owner[i];
    if (o < 0) continue;
    const x = i % W;
    const edge = (x > 0 && owner[i - 1] !== o) || (x < W - 1 && owner[i + 1] !== o) || (i >= W && owner[i - W] !== o) || (i < W * (H - 1) && owner[i + W] !== o);
    const [r, g, b] = edge ? nations[o].e : nations[o].c;
    const a = edge ? 0.85 : 0.4;
    const p = i * 4;
    d[p] = d[p] + (r - d[p]) * a;
    d[p + 1] = d[p + 1] + (g - d[p + 1]) * a;
    d[p + 2] = d[p + 2] + (b - d[p + 2]) * a;
  }
  ctx.putImageData(img, 0, 0);
}

/** HSL (h en grados, s y l de 0 a 1) a [r, g, b]. */
function hslRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
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
  if (Number.isFinite(r.colonies)) parts.push(`${r.colonies} colonias`);
  if (!r.missiles) parts.push('sin misiles');
  if (!r.warships) parts.push('sin buques');
  return parts.join(' · ');
}

/** Máximo de bots en un mapa real: uno por país disponible. */
/** Máximo de naciones rivales en cualquier mapa (en los reales, las que pasen de los países son inventadas). */
const MAX_BOTS = 200;
function maxBotsFor() {
  return MAX_BOTS;
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
    // Portada con nuestro mapa (un poco después, para que el menú salga al instante)
    const cover = $('portada-mapa');
    if (cover) setTimeout(() => paintCover(cover), 60);
    segmented($('seg-dificultad'), [['facil', 'Fácil'], ['normal', 'Normal'], ['dificil', 'Difícil']], this.choice.difficulty, (v) => {
      this.choice.difficulty = v;
    });
    segmented($('seg-victoria'), WIN_SHARES.map((v) => [v, `${Math.round(v * 100)} %`]), this.choice.rules.winShare, (v) => {
      this.choice.rules.winShare = v;
    });
    // Oro inicial: deslizador por escalones (0, 100k, 250k… 10M)
    const goldIdx = (g) => GOLD_STEPS.reduce((best, v, i) => (Math.abs(v - g) < Math.abs(GOLD_STEPS[best] - g) ? i : best), 0);
    const showGold = () => {
      const v = GOLD_STEPS[Number($('in-oro').value)];
      $('out-oro').textContent = v ? formatNumber(v) : 'Nada';
      this.choice.rules.startGold = v;
    };
    $('in-oro').max = String(GOLD_STEPS.length - 1);
    $('in-oro').value = String(goldIdx(this.choice.rules.startGold || 0));
    $('in-oro').addEventListener('input', showGold);
    showGold();
    // Colonias (bots débiles): «Auto» según el mapa o un número fijo
    $('in-colonias').value = String(this.choice.rules.colonies ?? -1);
    $('in-colonias').addEventListener('input', () => {
      const v = Number($('in-colonias').value);
      this.choice.rules.colonies = v < 0 ? null : v;
      this._syncColonies();
    });
    this._syncColonies = () => {
      const v = Number($('in-colonias').value);
      const auto = colonyCount(landTilesOf(this.choice.map), Number($('in-bots').value));
      $('out-colonias').textContent = v < 0 ? 'Auto' : String(v);
      $('nota-colonias').textContent = v < 0 ? `(${auto} en este mapa)` : '';
    };
    $('in-misiles').checked = this.choice.rules.missiles;
    $('in-buques').checked = this.choice.rules.warships;
    $('in-misiles').addEventListener('change', () => {
      this.choice.rules.missiles = $('in-misiles').checked;
    });
    $('in-buques').addEventListener('change', () => {
      this.choice.rules.warships = $('in-buques').checked;
    });
    this._syncBots = () => {
      const max = maxBotsFor(this.choice.map);
      $('in-bots').max = String(max);
      if (Number($('in-bots').value) > max) $('in-bots').value = String(max);
      $('out-bots').textContent = $('in-bots').value;
      const flags = REAL_MAP_DATA[this.choice.map]?.countries.length;
      $('nota-rivales').textContent = flags ? `(${flags} países reales; el resto, inventados)` : '';
      $('campo-semilla').hidden = !!REAL_MAPS[this.choice.map];
      this._syncColonies?.();
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
    // Sonido: interruptores y volúmenes (0-100 en pantalla, 0-1 en el perfil)
    for (const [id, key] of Object.entries({ 'aj-musica': 'musica', 'aj-efectos': 'efectos' })) {
      $(id).checked = this.profile.ajustes[key] !== false;
      $(id).addEventListener('change', () => {
        this.profile.ajustes[key] = $(id).checked;
        this.h.onProfileChange?.(false);
      });
    }
    for (const [id, key, out, def] of [['aj-vol-musica', 'volMusica', 'out-vol-musica', 0.5], ['aj-vol-efectos', 'volEfectos', 'out-vol-efectos', 0.6]]) {
      const v = Math.round((this.profile.ajustes[key] ?? def) * 100);
      $(id).value = String(v);
      $(out).textContent = String(v);
      $(id).addEventListener('input', () => {
        $(out).textContent = $(id).value;
        this.profile.ajustes[key] = Number($(id).value) / 100;
        this.h.onSettings?.();
      });
      $(id).addEventListener('change', () => this.h.onProfileChange?.(false));
    }
    $('aj-tutorial').addEventListener('click', () => this.h.onTutorial?.());

    // Portada, arsenal y muestras de color
    $('btn-jugar-ya').addEventListener('click', () => this._mode('rapida'));
    $('btn-elegir').addEventListener('click', () => this._mode('ia'));
    this._buildArsenal();
    this._buildSwatches();

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
      this.h.onQuickPlay?.({ bots: 90, mapSize: 'mundo', difficulty: this.profile.ajustes.dificultad, seed: '', rules: { ...DEFAULT_RULES } });
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
    this.renderCard();
    this.renderPatterns();
    this.renderAppearance();
    this.renderHero();
    this.h.onProfileChange?.(true);
  }

  // ------------------------------------------------------- portada y arsenal

  /** Saludo y datos rápidos de la portada. */
  renderHero() {
    const p = this.profile;
    const info = levelInfo(p.xp);
    $('portada-saludo').textContent = p.nombre ? `¡A las trincheras, ${p.nombre}!` : '¡A las trincheras!';
    $('portada-datos').replaceChildren(
      el('span', { class: 'dato-portada' }, el('b', { text: String(info.level) }), ' nivel'),
      el('span', { class: 'dato-portada' }, el('b', { text: String(p.stats.victorias) }), ' victorias'),
      el('span', { class: 'dato-portada' }, el('b', { text: String(p.stats.partidas) }), ' partidas'),
      el('span', { class: 'dato-portada' }, el('b', { text: `${ACHIEVEMENTS.filter((a) => hasAchievement(p, a.id)).length}/${ACHIEVEMENTS.length}` }), ' logros'),
    );
  }

  /** Dibujos del juego (edificios, buques, misil) con su nombre y su precio. */
  _buildArsenal() {
    const color = '#2f7dff';
    $('arsenal').replaceChildren(
      ...ARSENAL.map((item, i) => {
        const def = BUILDINGS[item.kind];
        const c = el('canvas', { width: 112, height: 112, 'aria-hidden': 'true' });
        const ctx = c.getContext('2d');
        if (item.kind === 'warship') drawWarship(ctx, 56, 56, -0.5, 44, color, true, -0.9, 0);
        else if (item.kind === 'transporte') drawTransport(ctx, 56, 56, -0.5, 64, color, true, 0);
        else if (item.kind === 'missile') drawMissileSprite(ctx, 56, 56, -0.8, 64, '#e0483f', 0);
        else drawBuildingReal(ctx, item.kind, 56, 56, 84, { ring: '#2f7dff' });
        const price = def ? `${formatNumber(def.base)} oro` : 'Tropas';
        return el(
          'div',
          { class: 'arma', style: `--i:${i}` },
          el('div', { class: 'arma-dibujo' }, c),
          el('strong', { text: item.name || def.name }),
          el('span', { class: 'arma-texto', text: item.text }),
          el('span', { class: 'arma-precio', text: price }),
        );
      }),
    );
  }

  /** Muestras de color rápidas junto a cada selector de color. */
  _buildSwatches() {
    for (const box of document.querySelectorAll('.muestras[data-campo]')) {
      const input = $(box.dataset.campo);
      box.replaceChildren(
        ...SWATCHES.map((c) =>
          el('button', {
            type: 'button',
            class: 'muestra-color',
            style: `--c:${c}`,
            title: c,
            'aria-label': `Color ${c}`,
            onclick: () => {
              input.value = c;
              input.dispatchEvent(new Event('input'));
            },
          }),
        ),
      );
    }
  }

  // ------------------------------------------------------ tarjeta y aspecto

  /** Tarjeta de perfil: estandarte, emblema con marco, nombre, título y nivel. */
  renderCard() {
    const p = this.profile;
    const card = $('tarjeta-perfil');
    card.className = `tarjeta-perfil est-${p.estandarte}`;
    const c = $('tarjeta-emblema');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    drawEmblem(ctx, p.emblema, c.width / 2, c.height / 2, c.width * 0.66);
    drawFrame(ctx, p.marco, c.width / 2, c.height / 2, c.width * 0.66);
    $('tp-nombre').textContent = p.nombre || 'Sin nombre';
    $('tp-nombre').style.color = nameColorOf(p);
    $('tp-titulo').textContent = titleName(p) || 'Recluta';
    const info = levelInfo(p.xp);
    $('tp-nivel').textContent = String(info.level);
    $('tp-datos').textContent = `${p.stats.victorias} victorias · ${p.stats.partidas} partidas · mejor ${formatPercent(p.stats.mejorPct || 0)}`;
  }

  renderAppearance() {
    const p = this.profile;
    // Estandartes
    $('sel-estandartes').replaceChildren(
      ...BANNERS.map((b) => {
        const ok = isUnlocked(p, b);
        return el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(b.id === p.estandarte),
            class: `estandarte est-${b.id}${ok ? '' : ' bloqueada'}`,
            disabled: !ok,
            onclick: () => {
              p.estandarte = b.id;
              this._profileChanged();
            },
          },
          el('span', { class: 'est-nombre', text: b.name }),
          ok ? null : el('span', { class: 'est-req', text: `🔒 ${unlockText(b)}` }),
        );
      }),
    );
    // Marcos
    $('sel-marcos').replaceChildren(
      ...FRAMES.map((f) => {
        const ok = isUnlocked(p, f);
        const cv = el('canvas', { width: 64, height: 64, class: 'emblema', 'aria-hidden': 'true' });
        cv.style.width = cv.style.height = '34px';
        const cx = cv.getContext('2d');
        drawEmblem(cx, p.emblema, 32, 32, 40);
        drawFrame(cx, f.id, 32, 32, 40);
        return el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(f.id === p.marco),
            class: `opcion${ok ? '' : ' bloqueada'}`,
            disabled: !ok,
            title: ok ? f.name : `${f.name}: ${unlockText(f)}`,
            onclick: () => {
              p.marco = f.id;
              this._profileChanged();
            },
          },
          cv,
          el('span', { text: ok ? f.name : `🔒 ${unlockText(f)}` }),
        );
      }),
    );
    // Color del nombre
    $('sel-color-nombre').replaceChildren(
      ...NAME_COLORS.map((n) => {
        const ok = isUnlocked(p, n);
        const color = n.color || nameColorOf({ ...p, colorNombre: 'propio' });
        return el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(n.id === p.colorNombre),
            class: `color-nombre${ok ? '' : ' bloqueada'}`,
            disabled: !ok,
            style: `--c:${color}`,
            title: ok ? n.name : `${n.name}: ${unlockText(n)}`,
            onclick: () => {
              p.colorNombre = n.id;
              this._profileChanged();
            },
          },
          el('span', { class: 'cn-muestra', text: p.nombre || 'Mi nación' }),
          el('span', { class: 'cn-nombre', text: ok ? n.name : `🔒 ${unlockText(n)}` }),
        );
      }),
    );
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
    this.renderHero();
    this.renderCard();
    this.renderAppearance();
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
    const framed = p.marco && p.marco !== 'ninguno';
    drawEmblem(ctx, p.emblema, c.width / 2, c.height / 2, c.width * (framed ? 0.72 : 0.95));
    drawFrame(ctx, p.marco, c.width / 2, c.height / 2, c.width * 0.72);
    $('chip-perfil').className = `chip-perfil est-${p.estandarte}`;
    $('chip-nombre').style.color = nameColorOf(p);
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
            el('input', { id: 'sala-bots', type: 'range', min: '0', max: String(MAX_BOTS), value: String(s.bots), oninput: () => this._lobbyChanged() })),
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
    const max = maxBotsFor($('sala-mapa').value);
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
