// Pantallas de inicio: jugar (IA y multijugador), perfil, apariencia, logros,
// clasificación, y la sala de espera del multijugador.
import { BUILDINGS, CONFIG, DEFAULT_RULES, GOLD_STEPS, MAP_SIZES, REAL_MAPS, RES, TIME_LIMITS, TRUCE_MINS, WIN_SHARES, colonyCount, mapLabel } from './config.js';
import { REAL_MAP_DATA } from './mapas-reales.js';
import { decodeRelief, generateMap, markRivers } from './map.js';
import { RIVERS } from './rios.js';
import { paintMapPreview } from './terreno.js';
import { CoverArt } from './portada.js';
import { drawHeroScene, drawModeArt, drawNewsArt } from './ilustraciones.js';
import { hexToRgb } from './colors.js';
import { PATTERN_FNS, drawBuildingReal, drawEmblem, drawFrame } from './icons.js';
import { drawTransport, drawWarship } from './barcos.js';
import { drawMissileSprite } from './fx.js';
import { formatNumber, formatPercent, formatTime } from './format.js';
import {
  ACHIEVEMENTS, BANNERS, DAILY, DAILY_BONUS, FRAMES, NAME_COLORS, PATTERNS, SHAPES, SYMBOLS, TITLES,
  buyItem, ensureDaily, grantAchievement, hasAchievement, isUnlocked, itemKey, levelInfo, nameColorOf, rewardsOf, titleName, unlockText,
} from './profile.js';

/** Colores rápidos para el territorio y el emblema. */
const SWATCHES = [
  '#2f7dff', '#1fb5ff', '#20c997', '#3ddc84', '#8bd346', '#ffd23f', '#ffa23d', '#ff6b3d',
  '#ff4d6d', '#e0483f', '#c2185b', '#b05cff', '#7b5cff', '#5b6b8c', '#f2f4f8', '#1b2133',
];

/** Lo que se muestra en el arsenal: dibujo del juego, nombre y para qué sirve (según las reglas). */
const ARSENAL = {
  city: { text: '+25 000 de techo de tropas por nivel' },
  port: { text: 'Mercantes: oro para ti y para el puerto de destino' },
  factory: { text: 'Vías y trenes: 10 000 de oro por tren (35 000 si es aliado)' },
  fort: { text: 'Conquistar a su alrededor cuesta ×3 de tiempo y bajas' },
  sam: { text: 'Intenta derribar las bombas que caen cerca' },
  warship: { text: 'Patrulla una zona del mar y hunde barcos' },
  transporte: { name: 'Desembarco', text: 'Lleva tropas por mar a otra costa', price: 'Tropas' },
  silo: { text: 'Lanza las bombas' },
  missile: { text: 'Arrasa una zona y la deja libre' },
  hbomb: { text: 'Arrasa una zona enorme' },
  mirv: { text: '24 cabezas repartidas por un país' },
};
/** Categorías del arsenal (portada y vista «Arsenal»). */
const ARSENAL_CATS = [
  { id: 'economia', name: 'Economía', text: 'Más tropas, comercio y trenes', icon: 'factory', items: ['city', 'port', 'factory'] },
  { id: 'defensa', name: 'Defensa', text: 'Protege tus fronteras y tu cielo', icon: 'fort', items: ['fort', 'sam', 'warship'] },
  { id: 'ataque', name: 'Ataque', text: 'Desembarcos y bombas', icon: 'missile', items: ['transporte', 'silo', 'missile', 'hbomb', 'mirv'] },
];

/** Novedades del carrusel de la portada. */
const NEWS = [
  { tag: 'Reglas', title: 'Mecánicas nuevas', text: 'Techo de tropas, regeneración, combate, cerco y retirada siguen ahora la especificación al pie de la letra.', art: 0 },
  { tag: 'Arsenal', title: 'Bomba H y MIRV', text: 'El silo lanza dos bombas nuevas: la H arrasa una zona enorme y el MIRV reparte 24 cabezas por un país.', art: 1 },
  { tag: 'Mapas', title: 'El mundo, más grande', text: 'Mapa del mundo de 2000 × 1000 casillas con 156 países y sus ríos de verdad.', art: 2 },
];

const $ = (id) => document.getElementById(id);
const DIFFICULTY = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil', imposible: 'Imposible' };

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
  d = { w, h, terrain, relief: data.relief ? decodeRelief(data.relief) : null, tileKm, countries: data.countries, lat: data.lat || null, river: markRivers(w, h, terrain, RIVERS[id] || []) };
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
    data = { w: map.width, h: map.height, terrain: map.terrain, relief: map.relief, tileKm: map.tileKm * 3, river: map.river };
  }
  const height = Math.round((width * data.h) / data.w);
  const c = el('canvas', { width, height, 'aria-hidden': 'true' });
  paintMapPreview(c, data);
  return c;
}

/** HSL (h en grados, s y l de 0 a 1) a [r, g, b]. */
function hslRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const MULT_OPTS = [[0.5, '×0,5'], [1, '×1'], [2, '×2']];

/**
 * Editor de reglas de la partida, igual en «Contra la IA» y en la sala
 * multijugador: colonias, oro inicial, victoria, ritmos de tropas y oro,
 * precios, tregua, límite de tiempo y qué está permitido. Modifica `rules` en
 * el sitio y llama a `onChange()` tras cada cambio. `ctx.autoColonies()`:
 * cuántas colonias saldrían en automático. `refresh()` actualiza esa nota.
 */
function rulesEditor(prefix, rules, onChange, ctx) {
  const id = (s) => `${prefix}-${s}`;
  const change = () => onChange();
  // Colonias (bots débiles): «Auto» o un número fijo
  const colOut = el('strong');
  const colNote = el('small');
  const col = el('input', { id: id('colonias'), type: 'range', min: '-1', max: String(CONFIG.colonyMax), value: String(rules.colonies ?? -1) });
  const syncCol = () => {
    const v = Number(col.value);
    colOut.textContent = v < 0 ? 'Auto' : String(v);
    colNote.textContent = v < 0 ? `(${ctx.autoColonies()} en este mapa)` : '';
  };
  col.addEventListener('input', () => {
    const v = Number(col.value);
    rules.colonies = v < 0 ? null : v;
    syncCol();
    change();
  });
  // Oro inicial por escalones
  const goldOut = el('strong');
  const gold = el('input', { id: id('oro'), type: 'range', min: '0', max: String(GOLD_STEPS.length - 1), step: '1' });
  const goldIdx = (g) => GOLD_STEPS.reduce((best, v, i) => (Math.abs(v - g) < Math.abs(GOLD_STEPS[best] - g) ? i : best), 0);
  gold.value = String(goldIdx(rules.startGold || 0));
  const syncGold = () => {
    const v = GOLD_STEPS[Number(gold.value)];
    goldOut.textContent = v ? formatNumber(v) : 'Nada';
    rules.startGold = v;
  };
  gold.addEventListener('input', () => {
    syncGold();
    change();
  });
  syncGold();
  const seg = (label, key, options) => {
    const box = el('div', { class: 'segmentos', role: 'radiogroup', 'aria-label': label });
    segmented(box, options, rules[key], (v) => {
      rules[key] = v;
      change();
    });
    return el('div', { class: 'campo' }, el('span', { text: label }), box);
  };
  const toggle = (label, key) => {
    const input = el('input', { type: 'checkbox', id: id(key) });
    input.checked = rules[key] !== false;
    input.addEventListener('change', () => {
      rules[key] = input.checked;
      change();
    });
    return el('label', { class: 'interruptor' }, input, el('span', { text: label }));
  };
  const box = el('div', { class: 'reglas-rejilla' },
    el('label', { class: 'campo' }, el('span', {}, 'Colonias (bots débiles) ', colOut, ' ', colNote), col),
    el('label', { class: 'campo' }, el('span', {}, 'Oro inicial ', goldOut), gold),
    seg('Economía', 'economy', [['fixed', 'Oro fijo'], ['workers', 'Con trabajadores']]),
    seg('Modo de victoria', 'victory', [['dominio', 'Dominación'], ['capitales', 'Capitales'], ['economia', 'Economía'], ['supervivencia', 'Supervivencia']]),
    seg('Victoria al conquistar (dominación)', 'winShare', WIN_SHARES.map((v) => [v, `${Math.round(v * 100)} %`])),
    seg('Crecimiento de tropas', 'troopMult', MULT_OPTS),
    seg('Ingresos de oro', 'goldMult', MULT_OPTS),
    seg('Precios de edificios', 'priceMult', MULT_OPTS),
    seg('Tregua inicial (sin ataques entre naciones)', 'truceMin', TRUCE_MINS.map((v) => [v, v ? `${v} min` : 'No'])),
    seg('Límite de tiempo (gana quien tenga más)', 'timeLimitMin', TIME_LIMITS.map((v) => [v, v ? `${v} min` : 'Sin límite'])),
    el('div', { class: 'interruptores' },
      toggle('Misiles y antimisiles', 'missiles'),
      toggle('Buques de guerra', 'warships'),
      toggle('Alianzas', 'alliances'),
      toggle('Desembarcos', 'boats'),
      toggle('Fábricas y trenes', 'factories'),
    ),
  );
  // Sala multijugador: nación compartida por parejas (y roles opcionales)
  if (prefix === 'sala') {
    const optIn = (label, key, title) => {
      const input = el('input', { type: 'checkbox', id: id(key) });
      input.checked = rules[key] === true;
      input.addEventListener('change', () => {
        rules[key] = input.checked;
        if (key === 'coop' && !input.checked) {
          rules.coopRoles = false;
          const roles = document.getElementById(id('coopRoles'));
          if (roles) roles.checked = false;
        }
        change();
      });
      return el('label', { class: 'interruptor', title }, input, el('span', { text: label }));
    };
    box.append(el('div', { class: 'interruptores coop' },
      optIn('Cooperativo: cada dos jugadores llevan una misma nación', 'coop', 'Por orden de llegada a la sala: 1.º y 2.º juntos, 3.º y 4.º juntos…'),
      optIn('Con roles: uno el mando militar y otro la economía y la diplomacia', 'coopRoles', 'Evita compras o ataques por accidente: cada uno solo puede hacer lo suyo'),
    ));
  }
  box.refresh = syncCol;
  syncCol();
  return box;
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
  const modes = { capitales: 'victoria por capitales', economia: 'victoria económica', supervivencia: 'supervivencia' };
  const parts = [modes[r.victory] || `victoria al ${Math.round(r.winShare * 100)} %`];
  if (r.economy === 'workers') parts.push('economía con trabajadores');
  if (r.startGold) parts.push(`${formatNumber(r.startGold)} de oro inicial`);
  if (Number.isFinite(r.colonies)) parts.push(`${r.colonies} colonias`);
  const mult = (v) => (v === 0.5 ? '×0,5' : `×${v}`);
  if (r.troopMult && r.troopMult !== 1) parts.push(`tropas ${mult(r.troopMult)}`);
  if (r.goldMult && r.goldMult !== 1) parts.push(`oro ${mult(r.goldMult)}`);
  if (r.priceMult && r.priceMult !== 1) parts.push(`precios ${mult(r.priceMult)}`);
  if (r.truceMin) parts.push(`tregua de ${r.truceMin} min`);
  if (r.timeLimitMin) parts.push(`límite de ${r.timeLimitMin} min`);
  if (r.alliances === false) parts.push('sin alianzas');
  if (r.coop) parts.push(r.coopRoles ? 'cooperativo por parejas con roles' : 'cooperativo por parejas');
  if (r.boats === false) parts.push('sin desembarcos');
  if (r.factories === false) parts.push('sin fábricas');
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

/** Países de los mapas reales (sin repetir), por nombre: para elegir su bandera como emblema. */
let countryCache = null;
function countryList() {
  if (!countryCache) {
    const seen = new Map();
    for (const m of Object.values(REAL_MAP_DATA)) for (const c of m.countries) if (c[3] && !seen.has(c[3])) seen.set(c[3], c[0]);
    countryCache = [...seen].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }
  return countryCache;
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
    if (cover) {
      setTimeout(() => {
        // Europa, el Mediterráneo y Oriente Próximo (a la derecha de la portada, tras la línea dorada)
        this.cover = new CoverArt(cover, realPreviewData('mundo'), { crop: { x0: 0.415, x1: 0.655, y0: 0.085 }, labelFrom: 0.2 });
        if (!$('inicio').hidden) this.cover.start();
      }, 60);
    }
    // Ilustraciones de la portada y de las tarjetas de modo (después del primer pintado)
    setTimeout(() => this._paintArt(), 30);
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this._paintHero(), 150);
    });
    segmented($('seg-dificultad'), Object.entries(DIFFICULTY), this.choice.difficulty, (v) => {
      this.choice.difficulty = v;
    });
    // Reglas (las mismas que en la sala multijugador)
    this._rulesIA = rulesEditor('ia', this.choice.rules, () => {}, {
      autoColonies: () => colonyCount(landTilesOf(this.choice.map), Number($('in-bots').value)),
    });
    $('reglas-ia').replaceChildren(this._rulesIA);
    this._syncBots = () => {
      const max = maxBotsFor(this.choice.map);
      $('in-bots').max = String(max);
      if (Number($('in-bots').value) > max) $('in-bots').value = String(max);
      $('out-bots').textContent = $('in-bots').value;
      const flags = REAL_MAP_DATA[this.choice.map]?.countries.length;
      $('nota-rivales').textContent = flags ? `(${flags} países reales; el resto, inventados)` : '';
      $('campo-semilla').hidden = !!REAL_MAPS[this.choice.map];
      this._rulesIA?.refresh();
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
    const toggles = { 'aj-alerta': 'alerta', 'aj-puntero': 'puntero', 'aj-marcadores': 'marcadores', 'aj-emojis': 'emojis', 'aj-animaciones': 'animaciones', 'aj-consejos': 'consejos' };
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
    for (const [id, key, out, def] of [['aj-vol-musica', 'volMusica', 'out-vol-musica', 0.5], ['aj-vol-efectos', 'volEfectos', 'out-vol-efectos', 0.8]]) {
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
    $('btn-repetir').addEventListener('click', () => this._replay());
    $('btn-tutorial').addEventListener('click', () => this.h.onTutorial?.());
    $('novedades-todas').addEventListener('click', () => {
      const box = $('novedades').closest('.tarjeta-ini');
      const all = box.classList.toggle('todas');
      $('novedades-todas').firstChild.textContent = all ? 'Ver menos ' : 'Ver todas ';
    });
    for (const b of document.querySelectorAll('[data-ir]')) {
      if (b.id !== 'chip-perfil') b.addEventListener('click', () => this.setView(b.dataset.ir));
    }
    this._buildArsenal();
    this._buildNews();
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
      const t = TITLES.find((x) => x.id === $('in-titulo').value);
      if (t && !isUnlocked(this.profile, t)) {
        // Título de la tienda: se ofrece comprarlo y el selector vuelve al actual
        $('in-titulo').value = this.profile.titulo;
        this._offerTitle(t);
        return;
      }
      $('titulo-compra').hidden = true;
      this.profile.titulo = $('in-titulo').value;
      this._profileChanged();
    });
    $('in-bandera').addEventListener('change', () => {
      this.profile.emblema.flag = $('in-bandera').value;
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
    } else if (mode === 'personalizada') {
      // El mismo panel que «Contra IA», directamente en las reglas
      this._openPanel('ia', false);
      setTimeout(() => $('reglas-ia').scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
    } else {
      this._openPanel(this.panel === mode ? null : mode);
    }
  }

  /** «Volver a jugar»: la última partida contra la IA, con el mismo mapa, rivales y reglas. */
  _replay(game = null) {
    const a = this.profile.ajustes;
    const map = game?.mapa && (REAL_MAPS[game.mapa] || MAP_SIZES[game.mapa]) ? game.mapa : this.choice.map;
    const bots = Math.min(maxBotsFor(map), game?.rivales || a.bots || 70);
    this.h.onQuickPlay?.({ bots, mapSize: map, difficulty: a.dificultad, seed: '', rules: { ...DEFAULT_RULES, ...a.reglas } });
  }

  /** Escena de la portada y dibujos de las tarjetas de modo. */
  _paintArt() {
    this._paintHero();
    this._paintBackdrop();
    const data = { world: realPreviewData('mundo'), europe: realPreviewData('europa') };
    for (const card of document.querySelectorAll('.modo[data-modo]')) {
      const c = card.querySelector('.modo-arte');
      if (c) drawModeArt(card.dataset.modo, c, data);
    }
  }

  /** Fondo de los menús: el mundo en puntos azules muy apagados, como un mapa de mando. */
  _paintBackdrop() {
    const d = realPreviewData('mundo');
    const step = 6;
    const W = 1500;
    const H = Math.round((W * d.h) / d.w);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(96, 140, 220, 0.2)';
    for (let y = step / 2; y < H; y += step) {
      const ty = Math.floor((y * d.h) / H) * d.w;
      for (let x = step / 2; x < W; x += step) {
        if (d.terrain[ty + Math.floor((x * d.w) / W)]) ctx.fillRect(x - 1.1, y - 1.1, 2.2, 2.2);
      }
    }
    // Meridianos y paralelos
    ctx.strokeStyle = 'rgba(120, 160, 230, 0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += W / 12) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += H / 6) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }
    c.toBlob?.((blob) => {
      if (blob) document.documentElement.style.setProperty('--fondo-mundo', `url(${URL.createObjectURL(blob)})`);
    });
  }

  /** La escena al atardecer, al tamaño real de la portada (nítida en pantallas densas). */
  _paintHero() {
    const c = $('heroe-escena');
    if (!c || !c.clientWidth) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(c.clientWidth * dpr);
    const H = Math.round(c.clientHeight * dpr);
    if (c.width === W && c.height === H && c._painted) return;
    c.width = W;
    c.height = H;
    const narrow = c.clientWidth < 700;
    drawHeroScene(c.getContext('2d'), W, H, 0, narrow ? 0.7 : 0.5);
    c._painted = true;
  }

  _openPanel(name, scroll = true) {
    this.panel = name;
    for (const p of document.querySelectorAll('.panel-modo')) p.hidden = p.dataset.panel !== name;
    for (const card of document.querySelectorAll('.modo[data-modo]')) {
      if (card.dataset.modo === 'ia' || card.dataset.modo === 'online') card.setAttribute('aria-expanded', String(card.dataset.modo === name));
    }
    const panel = name && document.querySelector(`.panel-modo[data-panel="${name}"]`);
    if (panel && scroll) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    $('portada-saludo').textContent = p.nombre ? `A las trincheras, ${p.nombre}` : 'A las trincheras';
    const pill = (icon, value, label, cls = '') =>
      el('span', { class: `dato-portada${cls}` }, el('span', { class: 'dato-icono', 'aria-hidden': 'true', text: icon }), el('b', { text: value }), ` ${label}`);
    $('portada-datos').replaceChildren(
      pill('★', String(info.level), 'nivel'),
      pill('🏆', String(p.stats.victorias), 'victorias'),
      pill('⚔', String(p.stats.partidas), 'partidas'),
      pill('🎖', `${ACHIEVEMENTS.filter((a) => hasAchievement(p, a.id)).length}/${ACHIEVEMENTS.length}`, 'logros'),
    );
    const last = p.historial[0];
    $('btn-repetir').hidden = !last;
    this.renderMissions();
    this.renderLastGame();
  }

  /** Misiones diarias en la portada (los mismos retos que en «Progreso»). */
  renderMissions() {
    const p = this.profile;
    const d = ensureDaily(p);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const mins = Math.max(1, Math.round((midnight - now) / 60000));
    $('misiones-reloj').textContent = `⏱ ${Math.floor(mins / 60)} h ${mins % 60} min`;
    const items = d.retos.map((id) => {
      const r = DAILY.find((x) => x.id === id);
      if (!r) return null;
      const prog = Math.min(r.need, d.progreso[id] || 0);
      const done = !!d.hechos[id];
      return el(
        'li',
        { class: done ? 'hecha' : '' },
        el('span', { class: 'mision-check', 'aria-hidden': 'true', text: done ? '✓' : '' }),
        el('span', { class: 'mision-nombre', text: r.name }),
        el('span', { class: 'mision-prog', text: `${prog}/${r.need}` }),
        el('b', { class: 'mision-premio', text: `🪙 ${r.coins}` }),
      );
    });
    const doneCount = d.retos.filter((id) => d.hechos[id]).length;
    items.push(
      el(
        'li',
        { class: `mision-bonus${d.bonus ? ' hecha' : ''}` },
        el('span', { class: 'mision-check', 'aria-hidden': 'true', text: d.bonus ? '✓' : '★' }),
        el('span', { class: 'mision-nombre', text: d.bonus ? '¡Las tres hechas!' : 'Completa las tres' }),
        el('span', { class: 'mision-prog', text: `${doneCount}/3` }),
        el('b', { class: 'mision-premio', text: `🪙 ${DAILY_BONUS}` }),
      ),
    );
    $('misiones-lista').replaceChildren(...items);
  }

  /** Tarjeta de la última partida: mapa, resultado y «jugar otra vez». */
  renderLastGame() {
    const g = this.profile.historial[0];
    const box = $('ultima-partida');
    if (!g) {
      box.replaceChildren(
        el('p', { class: 'nota', text: 'Aún no has terminado ninguna partida. ¡Empieza la primera!' }),
        el('button', { type: 'button', class: 'secundario', onclick: () => this._mode('rapida'), text: 'Partida rápida' }),
      );
      return;
    }
    const win = g.resultado.startsWith('victoria');
    const key = `${g.mapa}|${g.fecha}`;
    if (box.dataset.clave === key) return;
    box.dataset.clave = key;
    const thumb = el('div', { class: 'ultima-mapa' }, mapThumb(REAL_MAP_DATA[g.mapa] || MAP_SIZES[g.mapa] ? g.mapa : 'mundo', 260));
    thumb.append(el('span', { class: `ultima-resultado${win ? ' gana' : ''}`, text: g.resultado }));
    box.replaceChildren(
      thumb,
      el(
        'div',
        { class: 'ultima-datos' },
        el('strong', { text: mapLabel(g.mapa) }),
        el('span', { text: `${formatPercent(g.pct)} del mapa · ${formatTime(g.duracion)}` }),
        el('small', { text: `${new Date(g.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}${g.rivales ? ` · ${g.rivales} rivales` : ''}${g.online ? ' · online' : ''}` }),
      ),
      el('button', { type: 'button', class: 'ultima-jugar', 'aria-label': 'Jugar otra vez en este mapa', title: 'Jugar otra vez en este mapa', onclick: () => this._replay(g) },
        el('span', { 'aria-hidden': 'true', text: '▶' })),
    );
  }

  /** Carrusel de novedades (pasa solo cada 7 s mientras se ve el inicio). */
  _buildNews() {
    const slides = NEWS.map((n, i) => {
      const c = el('canvas', { width: 320, height: 150, 'aria-hidden': 'true' });
      drawNewsArt(c, n.art);
      return el(
        'article',
        { class: 'novedad', 'data-i': String(i), hidden: i !== 0 },
        el('div', { class: 'novedad-arte' }, c, el('span', { class: 'novedad-tag', text: n.tag })),
        el('div', { class: 'novedad-texto' }, el('strong', { text: n.title }), el('p', { text: n.text })),
      );
    });
    $('novedades').replaceChildren(...slides);
    const dots = NEWS.map((n, i) =>
      el('button', { type: 'button', role: 'tab', 'aria-label': n.title, 'aria-selected': String(i === 0), onclick: () => this._news(i, true) }),
    );
    $('novedades-puntos').replaceChildren(...dots);
    this.newsIndex = 0;
    this._newsTimer = setInterval(() => {
      if (!$('inicio').hidden && this.view === 'jugar' && !document.hidden) this._news((this.newsIndex + 1) % NEWS.length);
    }, 7000);
  }

  _news(i, manual = false) {
    this.newsIndex = i;
    for (const s of $('novedades').children) s.hidden = Number(s.dataset.i) !== i;
    [...$('novedades-puntos').children].forEach((d, k) => d.setAttribute('aria-selected', String(k === i)));
    if (manual) {
      clearInterval(this._newsTimer);
      this._newsTimer = setInterval(() => {
        if (!$('inicio').hidden && this.view === 'jugar' && !document.hidden) this._news((this.newsIndex + 1) % NEWS.length);
      }, 9000);
    }
  }

  /** Un dibujo del juego para el arsenal (edificio, barco o bomba). */
  _weaponArt(kind, size = 112) {
    const c = el('canvas', { width: size, height: size, 'aria-hidden': 'true' });
    const ctx = c.getContext('2d');
    const m = size / 2;
    const color = '#2f7dff';
    if (kind === 'warship') drawWarship(ctx, m, m, -0.5, size * 0.39, color, true, -0.9, 0);
    else if (kind === 'transporte') drawTransport(ctx, m, m, -0.5, size * 0.57, color, true, 0);
    else if (kind === 'missile') drawMissileSprite(ctx, m, m, -0.8, size * 0.57, '#e0483f', 0);
    else drawBuildingReal(ctx, kind, m, m, size * 0.75, { ring: kind === 'hbomb' ? '#ff7a45' : kind === 'mirv' ? '#b05cff' : color });
    return c;
  }

  /** Arsenal: tres categorías en la portada y la lista completa en su vista. */
  _buildArsenal() {
    const nameOf = (kind) => ARSENAL[kind].name || BUILDINGS[kind]?.name || kind;
    const priceOf = (kind) => ARSENAL[kind].price || (BUILDINGS[kind] ? `${formatNumber(BUILDINGS[kind].base)} oro` : '');
    $('arsenal-cats').replaceChildren(
      ...ARSENAL_CATS.map((cat, i) =>
        el(
          'article',
          { class: `arsenal-cat cat-${cat.id}`, style: `--i:${i}` },
          el(
            'header',
            {},
            el('span', { class: 'arsenal-cat-icono' }, this._weaponArt(cat.icon, 72)),
            el('div', {}, el('strong', { text: cat.name }), el('small', { text: cat.text })),
          ),
          el(
            'div',
            { class: 'arsenal-cat-fichas' },
            ...cat.items.slice(0, 4).map((kind) => el('span', { class: 'ficha-arma', title: `${nameOf(kind)}: ${ARSENAL[kind].text}` }, this._weaponArt(kind, 72), el('small', { text: nameOf(kind) }))),
          ),
          el('button', { type: 'button', class: 'enlace-ini', onclick: () => this.setView('arsenal') }, 'Ver todo ', el('span', { 'aria-hidden': 'true', text: '›' })),
        ),
      ),
    );
    let n = 0;
    $('arsenal').replaceChildren(
      el('h2', { class: 'titulo-seccion' }, el('span', { text: 'Arsenal' })),
      el('p', { class: 'arsenal-intro', text: 'Todo lo que puedes construir y lanzar en una partida, con su precio inicial. Subir de nivel cuesta lo mismo que uno nuevo.' }),
      ...ARSENAL_CATS.flatMap((cat) => [
        el('h3', { class: `arsenal-grupo cat-${cat.id}` }, el('span', { class: 'arsenal-cat-icono' }, this._weaponArt(cat.icon, 56)), el('span', { text: cat.name }), el('small', { text: cat.text })),
        el(
          'div',
          { class: 'arsenal' },
          ...cat.items.map((kind) =>
            el(
              'div',
              { class: 'arma', style: `--i:${n++}` },
              el('div', { class: 'arma-dibujo' }, this._weaponArt(kind)),
              el('strong', { text: nameOf(kind) }),
              el('span', { class: 'arma-texto', text: ARSENAL[kind].text }),
              el('span', { class: 'arma-precio', text: priceOf(kind) }),
            ),
          ),
        ),
      ]),
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
        const s = this._shop(b);
        return el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(b.id === p.estandarte),
            class: `estandarte est-${b.id}${s.cls}`,
            disabled: s.disabled,
            title: s.title,
            onclick: () => this._pick(b, () => (p.estandarte = b.id)),
          },
          el('span', { class: 'est-nombre', text: b.name }),
          s.ok ? null : el('span', { class: 'est-req', text: s.label }),
        );
      }),
    );
    // Marcos
    $('sel-marcos').replaceChildren(
      ...FRAMES.map((f) => {
        const s = this._shop(f);
        const cv = el('canvas', { width: 80, height: 80, class: 'emblema', 'aria-hidden': 'true' });
        cv.style.width = cv.style.height = '40px';
        const cx = cv.getContext('2d');
        drawEmblem(cx, p.emblema, 40, 40, 44);
        drawFrame(cx, f.id, 40, 40, 44);
        return el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(f.id === p.marco),
            class: `opcion${s.cls}`,
            disabled: s.disabled,
            title: s.title,
            onclick: () => this._pick(f, () => (p.marco = f.id)),
          },
          cv,
          el('span', { text: s.ok ? f.name : s.label }),
        );
      }),
    );
    // Color del nombre
    $('sel-color-nombre').replaceChildren(
      ...NAME_COLORS.map((n) => {
        const s = this._shop(n);
        const color = n.color || nameColorOf({ ...p, colorNombre: 'propio' });
        return el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(n.id === p.colorNombre),
            class: `color-nombre${s.cls}`,
            disabled: s.disabled,
            style: `--c:${color}`,
            title: s.title,
            onclick: () => this._pick(n, () => (p.colorNombre = n.id)),
          },
          el('span', { class: 'cn-muestra', text: p.nombre || 'Mi nación' }),
          el('span', { class: 'cn-nombre', text: s.ok ? n.name : s.label }),
        );
      }),
    );
  }

  show() {
    $('inicio').hidden = false;
    $('sala').hidden = true;
    this.renderAll();
    this.cover?.start();
    requestAnimationFrame(() => this._paintHero());
  }

  hide() {
    $('inicio').hidden = true;
    this.cover?.stop();
  }

  setView(view) {
    this.view = view;
    for (const tab of document.querySelectorAll('.ini-pestanas [data-vista]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.vista === view));
    }
    for (const sec of document.querySelectorAll('.vista[data-vista]')) sec.hidden = sec.dataset.vista !== view;
    $('chip-perfil').classList.toggle('activo', view === 'perfil');
    if (view === 'clasificacion') this.renderTable();
    if (view === 'jugar') requestAnimationFrame(() => this._paintHero());
    $('inicio').scrollTo?.({ top: 0 });
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
    $('chip-perfil').className = `chip-perfil est-${p.estandarte}${this.view === 'perfil' ? ' activo' : ''}`;
    $('chip-nombre').style.color = nameColorOf(p);
    const info = levelInfo(p.xp);
    $('chip-nombre').textContent = p.nombre || 'Sin nombre';
    const title = titleName(p);
    $('chip-nivel').textContent = `Nivel ${info.level}${title ? ` · ${title}` : ''}`;
    $('chip-xp').style.width = `${Math.round(info.progress * 100)}%`;
    $('chip-xp-txt').textContent = `${formatNumber(p.xp)} / ${formatNumber(info.next)} XP`;
    const total = ACHIEVEMENTS.filter((a) => hasAchievement(p, a.id)).length;
    $('cuenta-logros').textContent = `${total}/${ACHIEVEMENTS.length}`;
    $('chip-monedas').textContent = `🪙 ${formatNumber(p.monedas || 0)}`;
    $('bolsa-monedas').textContent = `🪙 ${formatNumber(p.monedas || 0)}`;
  }

  // ---------------------------------------------------------------- tienda

  /** Estado de un objeto del catálogo: libre, bloqueado o a la venta (y si llega el dinero). */
  _shop(item) {
    const p = this.profile;
    const ok = isUnlocked(p, item);
    const price = !ok && item.unlock && item.unlock.price;
    if (ok) return { ok, cls: '', disabled: false, label: item.name, title: item.name };
    if (!price) return { ok, cls: ' bloqueada', disabled: true, label: `🔒 ${unlockText(item)}`, title: `${item.name}: ${unlockText(item)}` };
    const afford = (p.monedas || 0) >= price;
    const asking = this.buying === itemKey(item);
    return {
      ok,
      cls: ` bloqueada en-venta${afford ? '' : ' cara'}${asking ? ' confirmar' : ''}`,
      disabled: false,
      label: asking ? `¿Comprar? 🪙 ${formatNumber(price)}` : `🪙 ${formatNumber(price)}`,
      title: afford ? `${item.name}: cómpralo por ${formatNumber(price)} monedas` : `${item.name}: te faltan ${formatNumber(price - (p.monedas || 0))} monedas`,
    };
  }

  /** Clic en un objeto: si es tuyo, se equipa; si está a la venta, primer clic pregunta y el segundo compra. */
  _pick(item, equip) {
    const p = this.profile;
    if (!isUnlocked(p, item)) {
      const price = item.unlock && item.unlock.price;
      if (!price) return;
      if ((p.monedas || 0) < price) {
        this._flash(`Te faltan 🪙 ${formatNumber(price - (p.monedas || 0))} para «${item.name}». Gánalas con partidas, logros y retos diarios.`);
        return;
      }
      if (this.buying !== itemKey(item)) {
        this.buying = itemKey(item);
        this.renderAppearance();
        this.renderPatterns();
        this.renderIdentity();
        return;
      }
      this.buying = null;
      if (!buyItem(p, item)) return;
      this._flash(`¡Comprado! «${item.name}» ya es tuyo.`, true);
      this.h.sound?.('coins');
      if (Object.keys(p.comprados).length >= 5) {
        const a = grantAchievement(p, 'coleccionista');
        if (a) this._flash(`¡Logro: ${a.name}! +🪙 ${a.coins}`, true);
      }
    }
    this.buying = null;
    equip();
    this._profileChanged();
    this.renderAchievements();
  }

  /** Ofrece comprar un título de la tienda (los títulos van en un desplegable). */
  _offerTitle(t) {
    const p = this.profile;
    const box = $('titulo-compra');
    box.hidden = false;
    const price = t.unlock && t.unlock.price;
    if (!price) {
      box.replaceChildren(el('span', { text: `«${t.name}»: ${unlockText(t)}` }));
      return;
    }
    const afford = (p.monedas || 0) >= price;
    box.replaceChildren(
      el('span', { text: afford ? `«${t.name}» cuesta 🪙 ${formatNumber(price)}` : `«${t.name}» cuesta 🪙 ${formatNumber(price)}: te faltan ${formatNumber(price - (p.monedas || 0))}` }),
      afford
        ? el('button', {
            type: 'button',
            class: 'btn-comprar',
            text: 'Comprar',
            onclick: () => {
              this.buying = itemKey(t);
              this._pick(t, () => (p.titulo = t.id));
              box.hidden = true;
            },
          })
        : null,
    );
  }

  /** Aviso breve encima de todo (compras, monedas que faltan). */
  _flash(text, good = false) {
    let box = document.getElementById('aviso-tienda');
    if (!box) {
      box = el('div', { id: 'aviso-tienda', class: 'aviso-tienda', role: 'status' });
      document.body.append(box);
    }
    box.textContent = text;
    box.classList.toggle('bien', good);
    box.classList.remove('visible');
    void box.offsetWidth;
    box.classList.add('visible');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => box.classList.remove('visible'), 2600);
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
        const price = !ok && t.unlock && t.unlock.price;
        return el('option', { value: t.id, disabled: !ok && !price, text: ok ? t.name : `${price ? '🪙' : '🔒'} ${t.name} (${unlockText(t)})` });
      }),
    );
    sel.value = p.titulo;
    const flags = $('in-bandera');
    if (!flags.options.length) {
      flags.replaceChildren(el('option', { value: '', text: 'Ninguna (forma y símbolo)' }), ...countryList().map(([iso, name]) => el('option', { value: iso, text: name })));
    }
    flags.value = p.emblema.flag || '';

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
        const s = this._shop(item);
        const btn = el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(item.id === current),
            class: `opcion${s.cls}`,
            disabled: s.disabled,
            title: s.title,
            onclick: () => this._pick(item, () => apply(item.id)),
          },
          emblemCanvas({ ...preview(item), flag: '' }, 30),
          el('span', { text: s.ok ? item.name : s.label }),
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
        const s = this._shop(item);
        return el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(item.id === p.patron),
            class: `patron${s.cls}`,
            disabled: s.disabled,
            title: s.title,
            onclick: () => this._pick(item, () => (p.patron = item.id)),
          },
          patternCanvas(item.id, p.color),
          el('span', { class: 'patron-nombre', text: item.name }),
          s.ok ? null : el('span', { class: 'patron-req', text: s.label }),
        );
      }),
    );
  }

  // --------------------------------------------------------------- logros

  renderAchievements() {
    const p = this.profile;
    const done = ACHIEVEMENTS.filter((a) => hasAchievement(p, a.id)).length;
    $('logros-resumen').textContent = `${done} de ${ACHIEVEMENTS.length} · 🪙 ${formatNumber(p.monedas || 0)}`;
    this.renderDaily();
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
          el(
            'span',
            { class: 'logro-estado' },
            a.coins ? el('b', { class: 'logro-monedas', text: `🪙 ${a.coins}` }) : null,
            el('span', { text: when ? new Date(when).toLocaleDateString('es-ES') : 'Pendiente' }),
          ),
        );
      }),
    );
  }

  /** Retos de hoy: tres al día, con su progreso, su premio y el bonus por hacer los tres. */
  renderDaily() {
    const p = this.profile;
    const d = ensureDaily(p);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const mins = Math.max(1, Math.round((midnight - now) / 60000));
    $('retos-reloj').textContent = `cambian en ${Math.floor(mins / 60)} h ${mins % 60} min`;
    $('retos-diarios').replaceChildren(
      ...d.retos.map((id) => {
        const r = DAILY.find((x) => x.id === id);
        if (!r) return null;
        const prog = Math.min(r.need, d.progreso[id] || 0);
        const hecho = !!d.hechos[id];
        return el(
          'li',
          { class: hecho ? 'hecho' : '' },
          el('span', { class: 'reto-icono', 'aria-hidden': 'true', text: r.icon }),
          el(
            'div',
            { class: 'reto-texto' },
            el('strong', { text: r.name }),
            el('span', { class: 'reto-barra' }, el('span', { style: `width:${Math.round((100 * prog) / r.need)}%` })),
            el('small', { text: hecho ? '¡Hecho!' : `${prog} / ${r.need}` }),
          ),
          el('b', { class: 'reto-premio', text: `🪙 ${r.coins}` }),
        );
      }),
    );
    const all = d.retos.every((id) => d.hechos[id]);
    $('retos-bonus').textContent = d.bonus ? `¡Los tres hechos! Bonus de 🪙 ${DAILY_BONUS} conseguido. Mañana, más.` : `Completa los tres y ganas 🪙 ${DAILY_BONUS} más.${all ? '' : ` Llevas ${d.retos.filter((id) => d.hechos[id]).length} de 3.`}`;
    $('retos-bonus').classList.toggle('bien', !!d.bonus);
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
          el('label', { class: 'campo' }, el('span', {}, 'Naciones rivales ', el('strong', { id: 'sala-out-bots', text: String(s.bots) })),
            el('input', { id: 'sala-bots', type: 'range', min: '0', max: String(MAX_BOTS), value: String(s.bots), oninput: () => this._lobbyChanged() })),
          el('div', { class: 'fila-2' },
            el('label', { class: 'campo' }, el('span', { text: 'Mapa' }),
              el('select', { id: 'sala-mapa', onchange: () => this._lobbyChanged() })),
            el('label', { class: 'campo' }, el('span', { text: 'Dificultad' }),
              el('select', { id: 'sala-dificultad', onchange: () => this._lobbyChanged() }, ...Object.entries(DIFFICULTY).map(([k, v]) => el('option', { value: k, text: v }))))),
          // Las mismas reglas que contra la IA: colonias, oro, ritmos, tregua…
          (this._rulesSala = rulesEditor('sala', this.choice.rules, () => this._lobbyChanged(), {
            autoColonies: () => colonyCount(landTilesOf($('sala-mapa')?.value || 'mundo'), Number($('sala-bots')?.value || 0)),
          })),
        );
        fillMapSelect($('sala-mapa'));
        $('sala-mapa').value = s.mapSize;
        $('sala-dificultad').value = s.difficulty;
        this._rulesSala.refresh(); // ya existen el mapa y las naciones elegidos
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
    this._rulesSala?.refresh();
    // Se guardan como las reglas por defecto del jugador
    this.profile.ajustes.reglas = { ...this.choice.rules };
    this.h.onProfileChange?.(false);
    this.h.onRoomSettings?.({
      bots: Number($('sala-bots').value),
      mapSize: $('sala-mapa').value,
      difficulty: $('sala-dificultad').value,
      rules: { ...this.choice.rules },
    });
  }
}
