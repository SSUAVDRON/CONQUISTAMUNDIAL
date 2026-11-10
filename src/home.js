// Pantallas de inicio: jugar (IA y multijugador), perfil, apariencia, logros,
// clasificación, y la sala de espera del multijugador.
import { BUILDINGS, CONFIG, DEFAULT_RULES, GOLD_STEPS, MAP_SIZES, REAL_MAPS, RES, TIME_LIMITS, TRUCE_MINS, WIN_SHARES, colonyCount, mapLabel, migrateRules } from './config.js';
import { PROFILES } from './mecanicas.js';
import { MAX_HUMANS, MIN_HUMANS, RULES_FINGERPRINT } from './multiplayer.js';
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
import { abrirDialogo, cerrarDialogo, contar, llenarAlVer, mostrar, ocultar, rodar, sinMovimiento, teclasGrupo } from './movimiento.js';
import { abrirGuia } from './guia.js';
import { drawSparkline } from './resumen.js';
import {
  ACHIEVEMENTS, BANNERS, DAILY, DAILY_BONUS, FRAMES, NAME_COLORS, PATTERNS, SHAPES, SYMBOLS, TITLES,
  achievementProgress, buyItem, defaultProfile, ensureDaily, grantAchievement, hasAchievement, isUnlocked, itemKey, levelInfo, nameColorOf, rewardsOf, titleName, unlockText,
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

/** Novedades: las tres primeras salen en el carrusel de la portada; «Ver todas», la lista entera. */
const NEWS = [
  { tag: 'Mapa', title: 'Cámara fluida', text: 'El zoom y el desplazamiento se deslizan con suavidad, con inercia al soltar, y la cámara vuela hasta cada frente.', art: 2 },
  { tag: 'Partida', title: 'Fin de partida y revancha', text: 'Al acabar, la cámara enseña el mapa entero y puedes jugar la revancha con las mismas reglas.', art: 1 },
  { tag: 'Menús', title: 'Menús renovados', text: 'Transiciones suaves, Perfil y Aspecto juntos, guía de juego y un menú en partida con ajustes rápidos.', art: 0 },
  { tag: 'Reglas', title: 'Mecánicas nuevas', text: 'Techo de tropas, regeneración, combate, cerco y retirada siguen ahora la especificación al pie de la letra.', art: 0 },
  { tag: 'Arsenal', title: 'Bomba H y MIRV', text: 'El silo lanza dos bombas nuevas: la H arrasa una zona enorme y el MIRV reparte 24 cabezas por un país.', art: 1 },
  { tag: 'Mapas', title: 'El mundo, más grande', text: 'Mapa del mundo de 3000 × 1500 casillas con 156 países y sus ríos de verdad.', art: 2 },
];
const NEWS_SLIDES = 3;

const $ = (id) => document.getElementById(id);
const DIFFICULTY = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil', imposible: 'Imposible' };
const VICTORY_NAMES = { dominio: 'Dominación', capitales: 'Capitales', economia: 'Economía', supervivencia: 'Supervivencia' };
/** Naciones de la IA en una partida online (más cargan demasiado el lockstep). */
const ONLINE_MAX_BOTS = 60;

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

/** Miniaturas ya pintadas (una por mapa y ancho): se copian en vez de rehacerlas. */
const thumbCache = new Map();
function thumbCopy(id, width) {
  const key = `${id}:${width}`;
  let src = thumbCache.get(key);
  if (!src) {
    src = mapThumb(REAL_MAP_DATA[id] || MAP_SIZES[id] ? id : 'mundo', width);
    thumbCache.set(key, src);
  }
  const c = el('canvas', { width: src.width, height: src.height, 'aria-hidden': 'true' });
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

/** Todos los mapas: [id, nombre, detalle]. */
function mapEntries() {
  return [
    ...Object.entries(REAL_MAPS).map(([id, name]) => [id, name, `${REAL_MAP_DATA[id].countries.length} países`]),
    ...Object.entries(MAP_SIZES).map(([id, m]) => [id, `Aleatorio ${m.label.toLowerCase()}`, 'Nuevo mundo cada vez']),
  ];
}

/**
 * Selector de mapa (el mismo en «Contra la IA», «Crear sala» y el editor de
 * la sala): tarjetas con miniatura en una tira. Devuelve { set(id) }.
 */
function mapPicker(box, value, onChange) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  box.classList.add('selector-mapas');
  box.setAttribute('role', 'radiogroup');
  if (!box.hasAttribute('aria-labelledby')) box.setAttribute('aria-label', 'Mapa');
  const show = (id, smooth) => {
    const b = box.querySelector(`[data-map="${id}"]`);
    if (!b || box.scrollWidth <= box.clientWidth) return;
    const l = b.offsetLeft - box.offsetLeft;
    if (l < box.scrollLeft || l + b.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollTo({ left: l - 8, behavior: smooth && !sinMovimiento() ? 'smooth' : 'auto' });
  };
  const set = (id, smooth = false) => {
    for (const b of box.children) b.setAttribute('aria-checked', String(b.dataset.map === id));
    rodar(box);
    show(id, smooth);
  };
  box.replaceChildren(
    ...mapEntries().map(([id, name, sub]) => {
      const thumb = thumbCopy(id, Math.round(168 * dpr));
      return el(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: 'mapa-tarjeta',
          'aria-checked': String(id === value),
          'data-map': id,
          onclick: () => {
            set(id, true);
            onChange(id);
          },
        },
        el('span', { class: 'mapa-mini' }, thumb),
        el('strong', { text: name }),
        el('small', { text: sub }),
      );
    }),
  );
  teclasGrupo(box);
  rodar(box);
  requestAnimationFrame(() => show(value, false));
  return { set };
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
  // Modo de victoria: en Clásico no hay capitales, así que esa opción no sale
  const victoryBox = el('div', { class: 'segmentos', role: 'radiogroup', 'aria-label': 'Modo de victoria' });
  const syncVictory = () => {
    const opts = [['dominio', 'Dominación'], ['capitales', 'Capitales'], ['economia', 'Economía'], ['supervivencia', 'Supervivencia']]
      .filter(([v]) => !(v === 'capitales' && rules.profile === 'clasico'));
    if (!opts.some(([v]) => v === rules.victory)) rules.victory = 'dominio';
    segmented(victoryBox, opts, rules.victory, (v) => {
      rules.victory = v;
      change();
    });
  };
  syncVictory();
  const profileNote = el('small', { class: 'nota-perfil' });
  const syncProfileNote = () => {
    const P = PROFILES[rules.profile] || PROFILES.trinchera;
    profileNote.textContent = rules.profile === 'clasico'
      ? 'Ritmo ágil, sin puntos estratégicos ni tecnologías'
      : 'Ritmo lento, con puntos estratégicos y tecnologías';
    profileNote.title = `Versión de las reglas: ${P.id}`;
  };
  syncProfileNote();
  const profileBox = el('div', { class: 'segmentos', role: 'radiogroup', 'aria-label': 'Perfil de reglas' });
  segmented(profileBox, Object.entries(PROFILES).map(([k, P]) => [k, P.name]), rules.profile, (v) => {
    rules.profile = v;
    syncProfileNote();
    syncVictory();
    change();
  });
  const box = el('div', { class: 'reglas-rejilla' },
    el('div', { class: 'campo campo-perfil' }, el('span', {}, 'Perfil de reglas ', profileNote), profileBox),
    el('label', { class: 'campo' }, el('span', {}, 'Colonias (bots débiles) ', colOut, ' ', colNote), col),
    el('label', { class: 'campo' }, el('span', {}, 'Oro inicial ', goldOut), gold),
    seg('Economía', 'economy', [['fixed', 'Oro fijo'], ['workers', 'Con trabajadores']]),
    el('div', { class: 'campo' }, el('span', { text: 'Modo de victoria' }), victoryBox),
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
        rodar(box);
        onChange(value);
      });
      return btn;
    }),
  );
  teclasGrupo(box);
  rodar(box);
}

/** Resumen de las reglas para la sala: "Victoria 70 % · sin misiles…". */
export function rulesSummary(r) {
  if (!r) return '';
  const modes = { capitales: 'victoria por capitales', economia: 'victoria económica', supervivencia: 'supervivencia' };
  const parts = [(PROFILES[r.profile] || PROFILES.trinchera).name, modes[r.victory] || `victoria al ${Math.round(r.winShare * 100)} %`];
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

/** Subrayado que se desliza bajo la pestaña elegida de un grupo de sub-pestañas. */
function underline(nav, anim) {
  if (!nav) return;
  let u = nav.querySelector(':scope > .subrayado-pestana');
  if (!u) {
    u = el('span', { class: 'subrayado-pestana', 'aria-hidden': 'true' });
    nav.append(u);
    nav.classList.add('con-subrayado');
  }
  const tab = nav.querySelector('[aria-selected="true"]');
  if (!tab || !tab.offsetWidth) return;
  u.classList.toggle('sin-transicion', !anim || sinMovimiento());
  u.style.width = `${tab.offsetWidth}px`;
  u.style.transform = `translateX(${tab.offsetLeft}px)`;
  u.style.opacity = '1';
}

/** Mini gráfica de tu territorio en una partida del historial (o nada si no hay curva). */
function sparkline(curve, cls = 'curva') {
  if (!Array.isArray(curve) || curve.length < 2) return null;
  const c = el('canvas', { class: cls, 'aria-hidden': 'true' });
  // Se pinta cuando ya tiene tamaño en pantalla
  requestAnimationFrame(() => requestAnimationFrame(() => drawSparkline(c, curve)));
  return c;
}

/** «3.º de 91» si la partida guardó su puesto. */
function placeText(g) {
  return g && g.puesto ? `${g.puesto}.º de ${g.de}` : '';
}

/** Estado vacío con diseño: icono, título, texto y acciones opcionales. */
function emptyState(icon, title, text, ...actions) {
  return el('div', { class: 'estado-vacio' },
    el('span', { class: 'ev-icono', 'aria-hidden': 'true', text: icon }),
    el('span', { class: 'ev-textos' }, el('strong', { text: title }), text ? el('small', { text }) : null),
    actions.length ? el('span', { class: 'ev-botones' }, ...actions) : null);
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

    const nav = document.querySelector('.ini-pestanas');
    for (const tab of nav.querySelectorAll('[data-vista]')) {
      tab.setAttribute('aria-controls', `vista-${tab.dataset.vista}`);
      tab.addEventListener('click', () => this.setView(tab.dataset.vista));
    }
    for (const sec of document.querySelectorAll('.vista[data-vista]')) sec.id ||= `vista-${sec.dataset.vista}`;
    teclasGrupo(nav, '[role="tab"]');
    // Subrayado de la pestaña activa: se desliza de una a otra
    this._underline = el('span', { class: 'ini-subrayado', 'aria-hidden': 'true' });
    nav.append(this._underline);
    nav.classList.add('con-subrayado');
    requestAnimationFrame(() => this._moveUnderline(false));
    document.fonts?.ready.then(() => this._moveUnderline(false));
    window.addEventListener('resize', () => this._moveUnderline(false));
    $('chip-perfil').addEventListener('click', () => this.setView('perfil'));

    // Tarjetas de modo
    for (const card of document.querySelectorAll('.modo[data-modo]')) {
      card.addEventListener('click', () => this._mode(card.dataset.modo));
    }
    for (const btn of document.querySelectorAll('.cerrar-panel')) btn.addEventListener('click', () => this._openPanel(null));

    // Partida contra la IA
    const a = this.profile.ajustes;
    this.choice = { map: REAL_MAPS[a.mapa] || MAP_SIZES[a.mapa] ? a.mapa : 'mundo', difficulty: a.dificultad, rules: { ...DEFAULT_RULES, ...migrateRules(a.reglas) } };
    this._galleryIA = mapPicker($('galeria-mapas'), this.choice.map, (id) => {
      this.choice.map = id;
      this._syncBots();
    });
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
      this._syncSummaryIA();
    });
    // Reglas (las mismas que en la sala multijugador)
    this._rulesIA = rulesEditor('ia', this.choice.rules, () => this._syncSummaryIA(), {
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
      this._syncSummaryIA();
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
        this._syncVolumes();
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
    $('aj-guia').addEventListener('click', () => abrirGuia());
    $('btn-guia').addEventListener('click', () => abrirGuia());
    $('aj-restablecer').addEventListener('click', () => abrirDialogo($('dialogo-restablecer'), { foco: '[data-cerrar]' }));
    $('dr-si').addEventListener('click', () => {
      this._resetSettings();
      cerrarDialogo($('dialogo-restablecer'));
      this._flash('Ajustes restablecidos.', true);
    });
    this._syncVolumes();

    // Portada, arsenal y muestras de color
    $('btn-jugar-ya').addEventListener('click', () => this._mode('rapida'));
    $('btn-repetir').addEventListener('click', () => this._replay());
    $('btn-tutorial').addEventListener('click', () => this.h.onTutorial?.());
    $('novedades-todas').addEventListener('click', () => this._allNews());
    for (const b of document.querySelectorAll('[data-ir]')) {
      if (b.id !== 'chip-perfil') b.addEventListener('click', () => this.setView(b.dataset.ir));
    }
    this._buildArsenal();
    this._buildNews();
    this._buildSwatches();

    // Multijugador
    $('btn-crear-sala').addEventListener('click', () => this.showCreate());
    $('form-unirse').addEventListener('submit', (e) => {
      e.preventDefault();
      this.h.onJoinRoom?.($('in-codigo').value);
    });
    $('lista-salas').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-code]');
      if (b && !b.disabled) this.h.onJoinRoom?.(b.dataset.code);
      if (e.target.closest('[data-crear]')) this.showCreate();
      if (e.target.closest('[data-reintentar]')) this.h.onRetryNet?.();
    });
    // Crear sala
    for (const id of ['crear-atras', 'crear-volver']) $(id).addEventListener('click', () => this.hideCreate());
    $('crear-confirmar').addEventListener('click', () => this._submitCreate());
    $('crear-nombre').addEventListener('input', () => {
      this.create.name = $('crear-nombre').value;
    });
    $('plazas-menos').addEventListener('click', () => this._seats(-1));
    $('plazas-mas').addEventListener('click', () => this._seats(1));

    // Perfil
    // Escribir el nombre o arrastrar el color: como mucho un redibujado por
    // fotograma (cada uno rehace decenas de miniaturas)
    $('in-nombre').addEventListener('input', () => {
      this.profile.nombre = $('in-nombre').value.trim().slice(0, 18);
      this._profileChangedSoon();
    });
    $('in-color').addEventListener('input', () => {
      this.profile.color = $('in-color').value;
      this._profileChangedSoon();
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

    // Perfil: sub-pestañas Resumen y Aspecto
    this.profileTab = 'resumen';
    for (const b of document.querySelectorAll('#perfil-pestanas [data-perfil]')) b.addEventListener('click', () => this._profileTab(b.dataset.perfil));
    teclasGrupo($('perfil-pestanas'), '[role="tab"]');
    $('ir-aspecto').addEventListener('click', () => this._profileTab('aspecto'));
    $('dc-comprar').addEventListener('click', () => this._confirmBuy());

    // Clasificación
    for (const b of document.querySelectorAll('#tabla-pestanas [data-tabla]')) {
      b.addEventListener('click', () => {
        this.table = b.dataset.tabla;
        this.renderTable(true);
      });
    }
    teclasGrupo($('tabla-pestanas'), '[role="tab"]');
    window.addEventListener('resize', () => {
      for (const nav of document.querySelectorAll('.vista:not([hidden]) .sub-pestanas')) underline(nav, false);
    });

    // Pie fijo de «Crear sala» y de la sala: el contenido acaba justo encima
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const h = e.target.offsetHeight;
          if (h) e.target.closest('.pantalla-sala')?.style.setProperty('--alto-pie', `${h}px`);
        }
      });
      for (const pie of document.querySelectorAll('.pantalla-sala .sala-pie')) ro.observe(pie);
      // Alto de la cabecera del inicio: la vista previa de «Aspecto» se queda fija justo debajo
      const bar = document.querySelector('.ini-barra');
      if (bar) new ResizeObserver(() => { if (bar.offsetHeight) $('inicio').style.setProperty('--alto-cabecera', `${bar.offsetHeight}px`); }).observe(bar);
    }

    // Sala
    $('btn-salir-sala').addEventListener('click', () => this.h.onLeaveRoom?.());
    $('btn-empezar').addEventListener('click', () => this.h.onStartRoom?.());
    $('btn-listo').addEventListener('click', () => this.h.onReady?.());
    $('btn-copiar-enlace').addEventListener('click', () => this.h.onCopyLink?.());
    $('btn-copiar-codigo').addEventListener('click', () => this.h.onCopyCode?.());
    $('btn-editar-reglas').addEventListener('click', () => {
      const box = $('sala-ajustes');
      box.hidden = !box.hidden;
      $('btn-editar-reglas').setAttribute('aria-expanded', String(!box.hidden));
      $('btn-editar-reglas').textContent = box.hidden ? 'Editar reglas' : 'Cerrar reglas';
    });

    $('in-bots').value = a.bots;
    this._syncBots();
  }

  /** Clic en una tarjeta de modo. */
  _mode(mode) {
    if (mode === 'rapida') {
      // Partida rápida: el perfil Clásico, siempre (elegido aquí, no por los valores por defecto)
      this.h.onQuickPlay?.({ bots: 90, mapSize: 'mundo', difficulty: this.profile.ajustes.dificultad, seed: '', rules: { ...DEFAULT_RULES, profile: 'clasico' } });
    } else if (mode === 'tutorial') {
      this.h.onTutorial?.();
    } else if (mode === 'personalizada') {
      // El mismo panel que «Contra IA», con las reglas avanzadas desplegadas
      $('ia-avanzadas').open = true;
      this._openPanel('ia', false);
      setTimeout(() => $('ia-avanzadas').scrollIntoView({ behavior: sinMovimiento() ? 'auto' : 'smooth', block: 'start' }), 30);
    } else {
      if (mode === 'ia' && this.panel !== 'ia') $('ia-avanzadas').open = false;
      this._openPanel(this.panel === mode ? null : mode);
    }
  }

  /** «Volver a jugar»: la última partida contra la IA, con el mismo mapa, rivales y reglas. */
  _replay(game = null) {
    const a = this.profile.ajustes;
    const map = game?.mapa && (REAL_MAPS[game.mapa] || MAP_SIZES[game.mapa]) ? game.mapa : this.choice.map;
    const bots = Math.min(maxBotsFor(map), game?.rivales || a.bots || 70);
    this.h.onQuickPlay?.({ bots, mapSize: map, difficulty: a.dificultad, seed: '', rules: { ...DEFAULT_RULES, ...migrateRules(a.reglas) } });
  }

  /** Escena de la portada y dibujos de las tarjetas de modo. */
  _paintArt() {
    this._paintHero();
    this._paintBackdrop();
    const data = { world: realPreviewData('mundo'), europe: realPreviewData('europa') };
    // A la densidad de la pantalla (tope 2): nítidas en móviles y pantallas retina
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const card of document.querySelectorAll('.modo[data-modo]')) {
      const c = card.querySelector('.modo-arte');
      if (!c) continue;
      c.width = Math.round(360 * dpr);
      c.height = Math.round(200 * dpr);
      c._escala = dpr;
      drawModeArt(card.dataset.modo, c, data);
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
    for (const p of document.querySelectorAll('.panel-modo')) {
      if (p.dataset.panel === name) mostrar(p, { y: 12, scale: 1, ms: 260 });
      else p.hidden = true;
    }
    for (const card of document.querySelectorAll('.modo[data-modo]')) {
      if (card.dataset.modo === 'ia' || card.dataset.modo === 'online') card.setAttribute('aria-expanded', String(card.dataset.modo === name));
    }
    const panel = name && document.querySelector(`.panel-modo[data-panel="${name}"]`);
    if (panel && scroll) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Resumen de la partida contra la IA (barra de abajo) y de sus reglas (cabecera de «Reglas avanzadas»). */
  _syncSummaryIA() {
    const c = this.choice;
    const n = Number($('in-bots').value);
    $('ia-resumen').replaceChildren(
      el('strong', { text: mapLabel(c.map) }),
      ` · ${n} rival${n === 1 ? '' : 'es'} · ${DIFFICULTY[c.difficulty] || 'Normal'}`,
      el('small', { text: rulesSummary(c.rules) }),
    );
    $('ia-reglas-resumen').textContent = rulesSummary(c.rules);
  }

  /** Abre directamente un panel (por ejemplo, el multijugador al volver de una sala). */
  openPanel(name) {
    this.setView('jugar');
    this._openPanel(name);
  }

  _profileChanged() {
    this._keepFocus(() => {
      this.renderChip();
      this.renderIdentity();
      this.renderCard();
      this.renderPatterns();
      this.renderAppearance();
      this.renderPreview();
      this.renderHero();
    });
    this.h.onProfileChange?.(true);
  }

  _profileChangedSoon() {
    if (this._changeRaf) return;
    this._changeRaf = requestAnimationFrame(() => {
      this._changeRaf = 0;
      this._profileChanged();
    });
  }

  /**
   * Rehace partes del menú sin perder el foco del teclado: si el foco estaba
   * en una opción (data-k), vuelve a la misma opción ya redibujada.
   */
  _keepFocus(fn) {
    const a = document.activeElement;
    const key = a && a.dataset ? a.dataset.k : null;
    const box = key ? a.parentElement && a.parentElement.id : null;
    fn();
    if (!key || !box) return;
    const again = document.getElementById(box)?.querySelector(`[data-k="${CSS.escape(key)}"]`);
    if (again && again !== document.activeElement) again.focus({ preventScroll: true });
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
        el('span', { class: 'mision-barra llena-al-ver', 'aria-hidden': 'true' }, el('span', { style: `--p:${(prog / r.need).toFixed(3)}` })),
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
    llenarAlVer($('misiones-lista'));
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
        el('span', { text: `${placeText(g) ? `${placeText(g)} · ` : ''}${formatPercent(g.pct)} del mapa · ${formatTime(g.duracion)}` }),
        sparkline(g.curva),
        el('small', { text: `${new Date(g.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}${g.rivales ? ` · ${g.rivales} rivales` : ''}${g.online ? ' · online' : ''}` }),
      ),
      el('button', { type: 'button', class: 'ultima-jugar', 'aria-label': 'Jugar otra vez en este mapa', title: 'Jugar otra vez en este mapa', onclick: () => this._replay(g) },
        el('span', { 'aria-hidden': 'true', text: '▶' })),
    );
  }

  /** Carrusel de novedades (pasa solo cada 7 s mientras se ve el inicio): fundido entre una y otra. */
  _buildNews() {
    const slides = NEWS.slice(0, NEWS_SLIDES).map((n, i) =>
      el(
        'article',
        { class: `novedad${i === 0 ? ' activa' : ''}`, 'data-i': String(i), 'aria-hidden': String(i !== 0) },
        el('div', { class: 'novedad-arte' }, this._newsArt(n), el('span', { class: 'novedad-tag', text: n.tag })),
        el('div', { class: 'novedad-texto' }, el('strong', { text: n.title }), el('p', { text: n.text })),
      ),
    );
    $('novedades').replaceChildren(...slides);
    const dots = NEWS.slice(0, NEWS_SLIDES).map((n, i) =>
      el('button', { type: 'button', role: 'tab', 'aria-label': n.title, 'aria-selected': String(i === 0), onclick: () => this._news(i, true) }),
    );
    $('novedades-puntos').replaceChildren(...dots);
    teclasGrupo($('novedades-puntos'), '[role="tab"]');
    this.newsIndex = 0;
    this._newsTimer = setInterval(() => {
      if (!$('inicio').hidden && this.view === 'jugar' && !document.hidden) this._news((this.newsIndex + 1) % NEWS_SLIDES);
    }, 7000);
  }

  /** Dibujo de una novedad, nítido en pantallas densas. */
  _newsArt(n) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = el('canvas', { width: Math.round(320 * dpr), height: Math.round(150 * dpr), 'aria-hidden': 'true' });
    c._escala = dpr;
    drawNewsArt(c, n.art);
    return c;
  }

  _news(i, manual = false) {
    this.newsIndex = i;
    for (const s of $('novedades').children) {
      const on = Number(s.dataset.i) === i;
      s.classList.toggle('activa', on);
      s.setAttribute('aria-hidden', String(!on));
    }
    [...$('novedades-puntos').children].forEach((d, k) => d.setAttribute('aria-selected', String(k === i)));
    rodar($('novedades-puntos'));
    if (manual) {
      clearInterval(this._newsTimer);
      this._newsTimer = setInterval(() => {
        if (!$('inicio').hidden && this.view === 'jugar' && !document.hidden) this._news((this.newsIndex + 1) % NEWS_SLIDES);
      }, 9000);
    }
  }

  /** «Ver todas»: todas las novedades en un diálogo. */
  _allNews() {
    const list = $('dn-lista');
    if (!list.children.length) {
      list.replaceChildren(
        ...NEWS.map((n) =>
          el(
            'article',
            { class: 'novedad-fila' },
            el('div', { class: 'novedad-arte' }, this._newsArt(n), el('span', { class: 'novedad-tag', text: n.tag })),
            el('div', { class: 'novedad-texto' }, el('strong', { text: n.title }), el('p', { text: n.text })),
          ),
        ),
      );
    }
    abrirDialogo($('dialogo-novedades'));
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
    const keyOf = (kind, short = false) => {
      const k = BUILDINGS[kind]?.key?.replace('Key', '');
      if (short) return k || 'Clic';
      return k ? `Tecla ${k} en la partida` : 'Clic en otra costa';
    };
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
              { class: 'arma', style: `--i:${n++}`, tabindex: '0', 'aria-label': `${nameOf(kind)}: ${ARSENAL[kind].text}. ${priceOf(kind)}. ${keyOf(kind)}` },
              el('span', { class: 'arma-tecla', title: 'Tecla en la partida', text: keyOf(kind, true) }),
              el('div', { class: 'arma-dibujo' }, this._weaponArt(kind)),
              el('strong', { text: nameOf(kind) }),
              el('span', { class: 'arma-texto', text: ARSENAL[kind].text }),
              el('span', { class: 'arma-precio', text: priceOf(kind) }),
              // Detalle al pasar el ratón o al tocar (enfocar) la tarjeta
              el('span', { class: 'arma-detalle', 'aria-hidden': 'true' }, el('strong', { text: nameOf(kind) }), el('span', { text: BUILDINGS[kind]?.desc || 'Haz clic en una costa enemiga o libre sin frontera por tierra: sale un barco con tropas desde tu costa (máximo 3 a la vez).' }), el('small', { text: keyOf(kind) })),
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
            'data-k': itemKey(b),
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
            'data-k': itemKey(f),
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
            'data-k': itemKey(n),
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
    // Títulos: fichas en vez de un desplegable
    $('sel-titulos').replaceChildren(
      ...TITLES.map((t) => {
        const s = this._shop(t);
        return el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(t.id === p.titulo),
            class: `ficha-titulo${s.cls}`,
            'data-k': itemKey(t),
            disabled: s.disabled,
            title: s.title,
            onclick: () => this._pick(t, () => (p.titulo = t.id)),
          },
          el('span', { class: 'ft-nombre', text: t.name }),
          s.ok ? null : el('small', { class: 'ft-req', text: s.label }),
        );
      }),
    );
    for (const id of ['sel-estandartes', 'sel-marcos', 'sel-color-nombre', 'sel-titulos', 'sel-patrones', 'sel-formas', 'sel-simbolos']) {
      teclasGrupo($(id));
      rodar($(id));
    }
  }

  /** ¿Se ve el menú de inicio (y no una sala o «Crear sala»)? */
  menuVisible() {
    return !$('inicio').hidden && $('sala').hidden && $('crear-sala').hidden;
  }

  /** Entrada de una pantalla: se desliza desde un lado (`dir` 1 derecha, -1 izquierda, 0 fundido). */
  _slideIn(screen, dir) {
    if (!screen || sinMovimiento() || !screen.animate) return;
    screen.animate([{ opacity: 0, transform: `translateX(${dir * 32}px)` }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }

  show() {
    const was = $('inicio').hidden;
    const from = !$('sala').hidden || !$('crear-sala').hidden;
    $('inicio').hidden = false;
    $('sala').hidden = true;
    $('crear-sala').hidden = true;
    if (was) this._slideIn($('inicio'), from ? -1 : 0);
    this.renderAll();
    if (this.view === 'jugar' || !this.view) this.cover?.start();
    requestAnimationFrame(() => this._paintHero());
  }

  hide() {
    $('inicio').hidden = true;
    this.cover?.stop();
  }

  setView(view) {
    // «Apariencia» ahora es la sub-pestaña «Aspecto» del perfil
    if (view === 'apariencia') {
      this._profileTab('aspecto', false);
      view = 'perfil';
    }
    const prev = this.view;
    this.view = view;
    const nav = document.querySelector('.ini-pestanas');
    for (const tab of nav.querySelectorAll('[data-vista]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.vista === view));
    }
    rodar(nav);
    this._moveUnderline(true);
    $('chip-perfil').classList.toggle('activo', view === 'perfil');
    if (view === 'clasificacion') this.renderTable();
    // El mapa animado de la portada solo corre mientras se ve «Jugar»
    if (view === 'jugar' && !$('inicio').hidden) this.cover?.start();
    else this.cover?.stop();
    // La vista que se va sale (rápido) y luego entra la nueva
    const secs = Array.from(document.querySelectorAll('.vista[data-vista]'));
    const next = secs.find((sec) => sec.dataset.vista === view);
    const leaving = secs.filter((sec) => sec !== next && !sec.hidden && !sec._salida);
    clearTimeout(this._viewTimer);
    const enter = () => {
      for (const sec of secs) if (sec !== next && !sec._salida) sec.hidden = true;
      $('inicio').scrollTo?.({ top: 0 });
      mostrar(next, { y: 10, scale: 1, ms: 240 });
      if (view === 'jugar') requestAnimationFrame(() => this._paintHero());
      if (view === 'perfil' && this.profileTab === 'resumen') this.renderProgress(true);
      for (const nav of next.querySelectorAll('.sub-pestanas')) underline(nav, false);
      llenarAlVer(next);
    };
    if (prev === view || $('inicio').hidden || sinMovimiento() || !leaving.length) {
      for (const sec of secs) sec.hidden = sec !== next;
      enter();
      return;
    }
    for (const sec of leaving) ocultar(sec, { y: -4, scale: 1, ms: 110 });
    this._viewTimer = setTimeout(enter, 110);
  }

  /** Coloca el subrayado bajo la pestaña activa (deslizándose si `anim`). */
  _moveUnderline(anim) {
    const u = this._underline;
    if (!u) return;
    const tab = document.querySelector('.ini-pestanas [aria-selected="true"]');
    if (!tab || !tab.offsetWidth) {
      u.style.opacity = '0';
      return;
    }
    const inset = Math.min(12, tab.offsetWidth * 0.12);
    u.classList.toggle('sin-transicion', !anim || sinMovimiento());
    u.style.width = `${tab.offsetWidth - inset * 2}px`;
    u.style.transform = `translateX(${tab.offsetLeft + inset}px)`;
    u.style.opacity = '1';
    // Si la pestaña queda fuera (barra con scroll en pantallas estrechas), se trae a la vista
    const nav = tab.parentElement;
    if (nav.scrollWidth > nav.clientWidth + 2) {
      const l = tab.offsetLeft - nav.scrollLeft;
      if (l < 0 || l + tab.offsetWidth > nav.clientWidth) nav.scrollTo({ left: tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2, behavior: anim && !sinMovimiento() ? 'smooth' : 'auto' });
    }
  }

  renderAll() {
    this.renderChip();
    this.renderHero();
    this.renderCard();
    this.renderAppearance();
    this.renderIdentity();
    this.renderProgress();
    this.renderPatterns();
    this.renderPreview();
    this.renderHistoryShort();
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
    contar($('chip-xp-txt'), p.xp, { formato: (n) => `${formatNumber(Math.round(n))} / ${formatNumber(info.next)} XP` });
    const total = ACHIEVEMENTS.filter((a) => hasAchievement(p, a.id)).length;
    $('cuenta-logros').textContent = `${total}/${ACHIEVEMENTS.length}`;
    const coins = (n) => `🪙 ${formatNumber(Math.round(n))}`;
    const before = $('chip-monedas')._cifra;
    contar($('chip-monedas'), p.monedas || 0, { formato: coins });
    if (before != null && (p.monedas || 0) > before && !sinMovimiento()) {
      $('chip-monedas').animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
    }
    contar($('bolsa-monedas'), p.monedas || 0, { formato: coins });
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
    return {
      ok,
      cls: ` bloqueada en-venta${afford ? '' : ' cara'}`,
      disabled: false,
      label: `🪙 ${formatNumber(price)}`,
      title: afford ? `${item.name}: cómpralo por ${formatNumber(price)} monedas` : `${item.name}: te faltan ${formatNumber(price - (p.monedas || 0))} monedas`,
    };
  }

  /** Clic en un objeto: si es tuyo, se equipa; si está a la venta, se abre la ficha de compra. */
  _pick(item, equip) {
    const p = this.profile;
    if (!isUnlocked(p, item)) {
      if (!(item.unlock && item.unlock.price)) return;
      this._buying = { item, equip };
      this._openBuy(item);
      return;
    }
    equip();
    this._profileChanged();
    this.renderAchievements();
  }

  /** Ficha de compra: muestra del objeto, precio y «Comprar» (o cuánto falta). */
  _openBuy(item) {
    const p = this.profile;
    const price = item.unlock.price;
    const have = p.monedas || 0;
    const afford = have >= price;
    $('dc-titulo').textContent = item.name;
    $('dc-muestra').replaceChildren(this._itemPreview(item));
    $('dc-texto').replaceChildren(
      el('span', { class: 'compra-precio', text: `🪙 ${formatNumber(price)}` }),
      el('small', { text: afford ? `Tienes 🪙 ${formatNumber(have)}; te quedarán ${formatNumber(have - price)}.` : `Tienes 🪙 ${formatNumber(have)}: te faltan ${formatNumber(price - have)}. Gánalas con partidas, logros y retos diarios.` }),
    );
    const buy = $('dc-comprar');
    buy.disabled = !afford;
    buy.textContent = afford ? `Comprar por 🪙 ${formatNumber(price)}` : 'Monedas insuficientes';
    abrirDialogo($('dialogo-compra'), { foco: afford ? '#dc-comprar' : '[data-cerrar]' });
  }

  _confirmBuy() {
    const b = this._buying;
    if (!b) return;
    const p = this.profile;
    if (!buyItem(p, b.item)) return;
    this._buying = null;
    cerrarDialogo($('dialogo-compra'));
    this._flash(`¡Comprado! «${b.item.name}» ya es tuyo.`, true);
    this.h.sound?.('coins');
    if (Object.keys(p.comprados).length >= 5) {
      const a = grantAchievement(p, 'coleccionista');
      if (a) this._flash(`¡Logro: ${a.name}! +🪙 ${a.coins}`, true);
    }
    b.equip();
    this._profileChanged();
    this.renderAchievements();
  }

  /** Muestra pequeña de un objeto de la tienda (para la ficha de compra). */
  _itemPreview(item) {
    const p = this.profile;
    if (item.cat === 'estandarte') return el('div', { class: `estandarte est-${item.id} compra-estandarte` }, el('span', { class: 'est-nombre', text: p.nombre || 'Mi nación' }));
    if (item.cat === 'patron') return patternCanvas(item.id, p.color, 192, 96);
    if (item.cat === 'color') return el('span', { class: 'compra-nombre', style: `color:${item.color || nameColorOf(p)}`, text: p.nombre || 'Mi nación' });
    if (item.cat === 'titulo') return el('span', { class: 'compra-titulo-txt' }, el('strong', { text: p.nombre || 'Mi nación' }), el('span', { text: item.name }));
    const c = el('canvas', { width: 192, height: 192, class: 'emblema', 'aria-hidden': 'true' });
    c.style.width = c.style.height = '96px';
    const cx = c.getContext('2d');
    const emb = item.cat === 'forma' ? { ...p.emblema, shape: item.id, flag: '' } : item.cat === 'simbolo' ? { ...p.emblema, symbol: item.id, flag: '' } : p.emblema;
    drawEmblem(cx, emb, 96, 96, 110);
    if (item.cat === 'marco') drawFrame(cx, item.id, 96, 96, 110);
    return c;
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
    if (document.activeElement !== $('in-nombre')) $('in-nombre').value = p.nombre;
    $('in-color').value = p.color;
    $('in-emb-fondo').value = p.emblema.bg;
    $('in-emb-figura').value = p.emblema.fg;

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
            'data-k': itemKey(item),
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

  /** Nivel, XP y estadísticas; con `count`, las cifras suben desde cero. */
  renderProgress(count = false) {
    const p = this.profile;
    const info = levelInfo(p.xp);
    $('perfil-nivel').textContent = info.level;
    $('perfil-xp-barra').style.setProperty('--p', String(Math.max(0, Math.min(1, info.progress))));
    $('perfil-xp').textContent = `${p.xp - info.start} / ${info.next - info.start} XP para el nivel ${info.level + 1}`;
    const s = p.stats;
    const int = (n) => formatNumber(Math.round(n));
    const rows = [
      ['Partidas', s.partidas, int],
      ['Victorias', s.victorias, (n) => `${int(n)}${s.partidas ? ` (${Math.round((100 * s.victorias) / s.partidas)} %)` : ''}`],
      ['Naciones eliminadas', s.eliminaciones, int],
      ['Edificios construidos', s.edificios, int],
      ['Alianzas firmadas', s.alianzas, int],
      ['Partidas online', s.online, int],
      ['Mayor territorio', s.mejorPct || 0, formatPercent],
      ['Victoria más rápida', s.mejorTiempo, (n) => (n == null ? '—' : formatTime(n))],
      ['Tiempo jugado', s.tiempoJugado || 0, (n) => formatTime(Math.round(n))],
    ];
    $('estadisticas').replaceChildren(
      ...rows.flatMap(([k, v, fmt]) => {
        const dd = el('dd', { text: fmt(v) });
        if (count && typeof v === 'number' && v > 0) contar(dd, v, { de: 0, ms: 800, formato: fmt });
        return [el('dt', { text: k }), dd];
      }),
    );
    llenarAlVer($('perfil-resumen'));
  }

  /** Sub-pestaña del perfil: 'resumen' o 'aspecto'. */
  _profileTab(tab, anim = true) {
    this.profileTab = tab;
    for (const b of document.querySelectorAll('#perfil-pestanas [data-perfil]')) b.setAttribute('aria-selected', String(b.dataset.perfil === tab));
    rodar($('perfil-pestanas'));
    const on = $(`perfil-${tab}`);
    const off = $(`perfil-${tab === 'resumen' ? 'aspecto' : 'resumen'}`);
    off.hidden = true;
    if (anim && this.view === 'perfil') mostrar(on, { y: 8, scale: 1, ms: 220 });
    else on.hidden = false;
    underline($('perfil-pestanas'), anim);
    if (tab === 'resumen' && this.view === 'perfil') this.renderProgress(true);
  }

  /** Vista previa fija de tu nación en «Aspecto»: estandarte, emblema con marco, nombre, título y patrón. */
  renderPreview() {
    const p = this.profile;
    $('vp-estandarte').className = `vp-estandarte est-${p.estandarte}`;
    const c = $('vp-emblema');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    drawEmblem(ctx, p.emblema, c.width / 2, c.height / 2, c.width * 0.62);
    drawFrame(ctx, p.marco, c.width / 2, c.height / 2, c.width * 0.62);
    $('vp-nombre').textContent = p.nombre || 'Mi nación';
    $('vp-nombre').style.color = nameColorOf(p);
    $('vp-titulo').textContent = titleName(p) || 'Sin título';
    // El patrón sobre tu color, con un trozo de costa, como se ve en el mapa
    const pc = $('vp-patron');
    const src = patternCanvas(p.patron, p.color, pc.width, pc.height);
    const g = pc.getContext('2d');
    g.fillStyle = '#16365f';
    g.fillRect(0, 0, pc.width, pc.height);
    g.save();
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(pc.width * 0.78, 0);
    g.bezierCurveTo(pc.width * 0.7, pc.height * 0.3, pc.width * 0.86, pc.height * 0.62, pc.width * 0.74, pc.height);
    g.lineTo(0, pc.height);
    g.closePath();
    g.clip();
    g.drawImage(src, 0, 0);
    g.restore();
    g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(pc.width * 0.78, 0);
    g.bezierCurveTo(pc.width * 0.7, pc.height * 0.3, pc.width * 0.86, pc.height * 0.62, pc.width * 0.74, pc.height);
    g.stroke();
    $('vp-etiqueta').textContent = p.nombre || 'Mi nación';
    $('vp-etiqueta').style.color = nameColorOf(p);
  }

  /** Últimas partidas en el resumen del perfil (el historial entero, en Clasificación). */
  renderHistoryShort() {
    const h = this.profile.historial;
    const box = $('perfil-historial');
    const all = el('button', { type: 'button', class: 'enlace-ini', onclick: () => {
      this.table = 'historial';
      this.setView('clasificacion');
    } }, 'Ver todo el historial ', el('span', { 'aria-hidden': 'true', text: '›' }));
    if (!h.length) {
      box.replaceChildren(emptyState('📜', 'Aún no hay partidas', 'Juega una y aquí verás cómo te fue.', el('button', { type: 'button', class: 'principal', onclick: () => this._mode('rapida'), text: 'Partida rápida' })));
      return;
    }
    box.replaceChildren(
      el('ul', { class: 'historial-corto' },
        ...h.slice(0, 5).map((g) => {
          const win = g.resultado.startsWith('victoria');
          return el('li', {},
            el('span', { class: `hc-resultado${win ? ' gana' : ''}`, text: win ? 'Victoria' : 'Derrota' }),
            el('span', { class: 'hc-mapa' }, el('strong', { text: mapLabel(g.mapa) }), el('small', { text: `${new Date(g.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}${placeText(g) ? ` · ${placeText(g)}` : ''}${g.online ? ' · online' : ''}` })),
            el('span', { class: 'hc-dato', text: formatPercent(g.pct) }),
            el('span', { class: 'hc-dato', text: formatTime(g.duracion) }));
        })),
      all,
    );
  }

  /** Ajustes: el volumen de la música o de los efectos se apaga con su sonido. */
  _syncVolumes() {
    for (const [tog, vol] of [['aj-musica', 'aj-vol-musica'], ['aj-efectos', 'aj-vol-efectos']]) {
      const on = $(tog).checked;
      $(vol).disabled = !on;
      $(vol).closest('.aj-volumen')?.classList.toggle('apagado', !on);
    }
  }

  /** «Restablecer ajustes»: opciones de partida, interfaz y sonido como venían (el perfil no cambia). */
  _resetSettings() {
    const d = defaultProfile().ajustes;
    const a = this.profile.ajustes;
    for (const k of ['alerta', 'puntero', 'marcadores', 'emojis', 'animaciones', 'consejos', 'musica', 'efectos', 'volMusica', 'volEfectos', 'silencio']) {
      if (k in d) a[k] = d[k];
      else delete a[k];
    }
    this.syncSettings();
    this.h.onProfileChange?.(false);
    this.h.onSettings?.();
  }

  /** Pone los controles de Ajustes según el perfil (tras cambiarlos desde el menú en partida o al restablecer). */
  syncSettings() {
    const a = this.profile.ajustes;
    const toggles = { 'aj-alerta': 'alerta', 'aj-puntero': 'puntero', 'aj-marcadores': 'marcadores', 'aj-emojis': 'emojis', 'aj-animaciones': 'animaciones', 'aj-consejos': 'consejos', 'aj-musica': 'musica', 'aj-efectos': 'efectos' };
    for (const [id, key] of Object.entries(toggles)) $(id).checked = a[key] !== false;
    for (const [id, key, out, def] of [['aj-vol-musica', 'volMusica', 'out-vol-musica', 0.5], ['aj-vol-efectos', 'volEfectos', 'out-vol-efectos', 0.8]]) {
      const v = Math.round((a[key] ?? def) * 100);
      $(id).value = String(v);
      $(out).textContent = String(v);
    }
    this._syncVolumes();
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
            'data-k': itemKey(item),
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
        const prog = when ? null : achievementProgress(p, a);
        return el(
          'li',
          { class: when ? 'conseguido' : 'pendiente' },
          el('span', { class: 'logro-icono', 'aria-hidden': 'true', text: a.icon }),
          el(
            'div',
            { class: 'logro-texto' },
            el('strong', { text: a.name }),
            el('span', { text: a.desc }),
            prog ? el('span', { class: 'logro-progreso' },
              el('span', { class: 'logro-barra llena-al-ver', 'aria-hidden': 'true' }, el('span', { style: `--p:${(prog.have / prog.need).toFixed(3)}` })),
              el('small', { text: `${formatNumber(prog.have)}/${formatNumber(prog.need)}` })) : null,
            rewards.length ? el('small', { class: 'logro-premio', text: `Recompensa: ${rewards.join(' · ')}` }) : null,
          ),
          el(
            'span',
            { class: 'logro-estado' },
            a.coins ? el('b', { class: 'logro-monedas', text: `🪙 ${a.coins}` }) : null,
            el('span', { class: 'logro-fecha', text: when ? `✓ ${new Date(when).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}` : '🔒' }),
          ),
        );
      }),
    );
    llenarAlVer($('lista-logros'));
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
            el('span', { class: 'reto-barra llena-al-ver' }, el('span', { style: `--p:${(prog / r.need).toFixed(3)}` })),
            el('small', { text: hecho ? '¡Hecho!' : `${prog} / ${r.need}` }),
          ),
          el('b', { class: 'reto-premio', text: `🪙 ${r.coins}` }),
        );
      }),
    );
    const all = d.retos.every((id) => d.hechos[id]);
    $('retos-bonus').textContent = d.bonus ? `¡Los tres hechos! Bonus de 🪙 ${DAILY_BONUS} conseguido. Mañana, más.` : `Completa los tres y ganas 🪙 ${DAILY_BONUS} más.${all ? '' : ` Llevas ${d.retos.filter((id) => d.hechos[id]).length} de 3.`}`;
    $('retos-bonus').classList.toggle('bien', !!d.bonus);
    llenarAlVer($('retos-diarios'));
  }

  // --------------------------------------------------------- clasificación

  setGlobal(state) {
    this.global = { ...this.global, ...state };
    if (this.view === 'clasificacion' && this.table === 'global') this.renderTable();
  }

  renderTable(anim = false) {
    for (const b of document.querySelectorAll('#tabla-pestanas [data-tabla]')) b.setAttribute('aria-selected', String(b.dataset.tabla === this.table));
    rodar($('tabla-pestanas'));
    underline($('tabla-pestanas'), anim);
    const box = $('tabla-clasificacion');
    if (anim && !sinMovimiento()) box.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    if (this.table === 'global') box.replaceChildren(...this._globalTable());
    else if (this.table === 'records') box.replaceChildren(...this._recordsTable());
    else box.replaceChildren(...this._historyTable());
  }

  _globalTable() {
    const g = this.global;
    const records = () => el('button', { type: 'button', class: 'btn-sec', onclick: () => {
      this.table = 'records';
      this.renderTable(true);
    }, text: 'Ver tus récords' });
    if (!g.available) {
      return [emptyState('🌐', 'La tabla global estará disponible pronto', 'Mientras tanto, aquí tienes tus récords y tu historial.', records())];
    }
    const out = [];
    if (g.error) out.push(el('p', { class: 'nota', text: g.error }));
    if (!g.rows.length) {
      out.push(emptyState('🏁', 'Todavía no hay nadie', 'Juega una partida para aparecer aquí.', el('button', { type: 'button', class: 'principal', onclick: () => this._mode('rapida'), text: 'Partida rápida' })));
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
    if (!best.length) out.push(emptyState('🏆', 'Sin récords todavía', 'Juega una partida para ver aquí tus mejores marcas.'));
    else out.push(this._gamesTable(best));
    return out;
  }

  _historyTable() {
    const h = this.profile.historial;
    if (!h.length) return [emptyState('📜', 'Aún no has terminado ninguna partida', 'Cuando acabes una, saldrá aquí con su resultado, territorio y duración.', el('button', { type: 'button', class: 'principal', onclick: () => this._mode('rapida'), text: 'Partida rápida' }))];
    return [this._gamesTable(h)];
  }

  _gamesTable(games) {
    const table = el('table', { class: 'tabla' });
    table.append(el('thead', {}, el('tr', {}, ...['Fecha', 'Resultado', 'Puesto', 'Territorio', 'Duración', 'Mapa'].map((x) => el('th', { text: x })))));
    const body = el('tbody');
    for (const g of games) {
      body.append(
        el(
          'tr',
          {},
          el('td', { text: new Date(g.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) }),
          el('td', { text: `${g.resultado}${g.online ? ' · online' : ''}` }),
          el('td', { class: 'num', text: placeText(g) || '—' }),
          el('td', { class: 'num celda-curva' }, sparkline(g.curva), el('span', { text: formatPercent(g.pct) })),
          el('td', { class: 'num', text: formatTime(g.duracion) }),
          el('td', { text: mapLabel(g.mapa) }),
        ),
      );
    }
    table.append(body);
    return table;
  }

  // ------------------------------------------------------------- en línea

  /** kind: 'claude' | 'mqtt' | 'local' | 'connecting' | null; detail: texto opcional. */
  setNetStatus(kind, detail = '') {
    this.netKind = kind;
    const chip = $('estado-red');
    const labels = { claude: 'En línea', mqtt: 'En línea', local: 'Prueba entre pestañas', none: 'No disponible', connecting: 'Conectando…' };
    chip.textContent = labels[kind || 'none'];
    chip.className = `chip ${kind === 'claude' || kind === 'mqtt' ? 'bien' : kind === 'local' ? 'aviso' : ''}`;
    const usable = kind === 'claude' || kind === 'local' || kind === 'mqtt';
    $('btn-crear-sala').disabled = !usable;
    $('form-unirse').querySelector('button').disabled = !usable;
    $('nota-red').textContent =
      detail ||
      (kind === 'claude'
        ? 'Comparte el código con quien tenga este enlace. Para jugar necesitan permiso de colaborador.'
        : kind === 'mqtt'
          ? 'Las salas van por un servidor público: entra quien tenga el enlace o el código desde cualquier dispositivo. Las públicas salen aquí.'
          : kind === 'local'
            ? 'Prueba entre pestañas: sin conexión con el servidor de salas, solo pueden unirse otras pestañas de este navegador. Copia el código y ábrelo en otra pestaña.'
            : kind === 'connecting'
              ? ''
              : 'Este navegador no permite el modo multijugador.');
    this.renderRooms();
  }

  setRooms(rooms) {
    this.rooms = rooms;
    this.renderRooms();
  }

  /** Vestíbulo público: tarjetas con miniatura, mapa, modo y plazas libres (o un estado vacío con diseño). */
  renderRooms() {
    const list = $('lista-salas');
    const kind = this.netKind;
    const empty = (cls, icon, title, text, ...buttons) =>
      el('li', { class: `vacia estado-vacio ${cls}` },
        el('span', { class: 'ev-icono', 'aria-hidden': 'true', text: icon }),
        el('span', { class: 'ev-textos' }, el('strong', { text: title }), el('small', { text })),
        el('span', { class: 'ev-botones' }, ...buttons));
    if (kind === 'connecting' || kind === undefined) {
      // Conectando: tarjetas de carga
      list.replaceChildren(...[0, 1].map(() => el('li', { class: 'sala-esqueleto', 'aria-hidden': 'true' }, el('span'), el('span'), el('span'))));
      list.setAttribute('aria-busy', 'true');
      return;
    }
    list.removeAttribute('aria-busy');
    if (!kind || kind === 'none') {
      list.replaceChildren(empty('sin-red', '📡', 'Sin conexión con el servidor de salas', 'Comprueba tu conexión a internet y vuelve a intentarlo.',
        el('button', { type: 'button', class: 'principal', 'data-reintentar': '1', text: 'Reintentar' })));
      return;
    }
    if (!this.rooms.length) {
      list.replaceChildren(empty('sin-salas', '🏳', 'No hay salas públicas ahora mismo', kind === 'local' ? 'Prueba entre pestañas: crea una sala y ábrela en otra pestaña.' : 'Crea una pública y aparecerá aquí para que entren otros.',
        el('button', { type: 'button', class: 'principal', 'data-crear': '1', text: 'Crea la primera' }),
        kind === 'local' ? el('button', { type: 'button', class: 'secundario', 'data-reintentar': '1', text: 'Reintentar conexión' }) : null));
      return;
    }
    list.replaceChildren(
      ...this.rooms.map((r) => {
        const full = (r.jugadores || 1) >= (r.plazas || 8);
        const P = PROFILES[r.perfil] || PROFILES.trinchera;
        const blocked = full || r.otraVersion;
        return el(
          'li',
          {},
          el(
            'button',
            { type: 'button', class: `sala-tarjeta-pub${blocked ? ' bloqueada' : ''}`, 'data-code': r.code, disabled: blocked, title: r.otraVersion ? 'Esta sala usa otra versión del juego' : full ? 'Sala llena' : `Entrar en ${r.nombre}` },
            el('span', { class: 'sala-mini' }, this._thumb(r.mapa, 168)),
            el(
              'span',
              { class: 'sala-info' },
              el('strong', { text: String(r.nombre || 'Sala').slice(0, 28) }),
              el('small', { text: `${mapLabel(r.mapa)} · ${P.name} · ${VICTORY_NAMES[r.victoria] || 'Dominación'}` }),
              el('small', { text: `${Math.max(0, (r.plazas || 8) - (r.jugadores || 1))} plaza${(r.plazas || 8) - (r.jugadores || 1) === 1 ? '' : 's'} libre${(r.plazas || 8) - (r.jugadores || 1) === 1 ? '' : 's'} · ${r.jugadores || 1}/${r.plazas || 8} · ${Number(r.bots) || 0} bots` }),
            ),
            el('span', { class: 'sala-entrar', text: r.otraVersion ? 'Otra versión' : full ? 'Llena' : 'Entrar' }),
          ),
        );
      }),
    );
  }

  /** Miniatura de un mapa, una sola vez por mapa y tamaño. */
  _thumb(id, width) {
    return thumbCopy(id, width);
  }

  /** Pinta el mapa `id` en un lienzo grande (recortado para llenarlo). */
  _paintMapInto(canvas, id) {
    if (canvas.dataset.mapa === id) return;
    canvas.dataset.mapa = id;
    const src = thumbCopy(id, 640);
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const k = Math.max(W / src.width, H / src.height);
    const w = src.width * k;
    const h = src.height * k;
    ctx.fillStyle = '#132f5c';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
  }

  /** Chips del resumen: perfil, bots y modo de victoria. */
  _chips(box, settings) {
    const s = settings || {};
    const r = s.rules || {};
    const P = PROFILES[r.profile] || PROFILES.trinchera;
    box.replaceChildren(
      el('span', { class: 'chip-sala', title: `Perfil de reglas ${P.id}` }, el('span', { class: 'chip-ico', 'aria-hidden': 'true', text: '⚙' }), P.name),
      el('span', { class: 'chip-sala' }, el('span', { class: 'chip-ico', 'aria-hidden': 'true', text: '🤖' }), `${Number(s.bots) || 0} bots`),
      el('span', { class: 'chip-sala' }, el('span', { class: 'chip-ico', 'aria-hidden': 'true', text: '⚑' }), VICTORY_NAMES[r.victory] || 'Dominación'),
    );
  }

  // --------------------------------------------------------- crear sala

  /** Pantalla «Crear sala»: mapa y quién entra; las reglas, en «Reglas avanzadas». */
  showCreate() {
    const a = this.profile.ajustes;
    if (!this.create) {
      this.create = {
        map: REAL_MAPS[a.mapa] || MAP_SIZES[a.mapa] ? a.mapa : 'europa',
        name: `Sala de ${this.profile.nombre || 'Trinchera'}`,
        visibility: 'enlace',
        seats: 4,
        bots: Math.min(ONLINE_MAX_BOTS, a.bots || 40),
        difficulty: a.dificultad || 'normal',
        rules: { ...DEFAULT_RULES, ...migrateRules(a.reglas) },
      };
    }
    $('inicio').hidden = true;
    if ($('crear-sala').hidden) {
      $('crear-sala').hidden = false;
      this._slideIn($('crear-sala'), 1);
    }
    $('crear-nombre').value = this.create.name;
    $('crear-error').textContent = '';
    this._busyCreate(false);
    this._renderCreate();
  }

  hideCreate() {
    $('crear-sala').hidden = true;
    $('inicio').hidden = false;
    this._slideIn($('inicio'), -1);
    this.openPanel('online');
  }

  _renderCreate() {
    const c = this.create;
    // Mapas: el grande y una tira con todos
    this._paintMapInto($('crear-mapa-img'), c.map);
    $('crear-mapa-nombre').textContent = mapLabel(c.map);
    if (!this._createPicker) {
      this._createPicker = mapPicker($('crear-mapas'), c.map, (id) => {
        c.map = id;
        this._renderCreate();
      });
    } else this._createPicker.set(c.map);
    segmented($('crear-visibilidad'), [['enlace', '🔒 Solo con enlace'], ['publica', '🌐 Pública']], c.visibility, (v) => {
      c.visibility = v;
      this._renderCreate();
    });
    $('crear-vis-nota').textContent = c.visibility === 'publica' ? 'Sale en la lista de salas públicas de Multijugador.' : 'No sale en la lista: se entra con el enlace o el código.';
    $('plazas-valor').textContent = String(c.seats);
    $('plazas-menos').disabled = c.seats <= MIN_HUMANS;
    $('plazas-mas').disabled = c.seats >= MAX_HUMANS;
    this._chips($('crear-resumen'), { bots: c.bots, rules: c.rules });
    // Reglas avanzadas: naciones, dificultad y el editor de reglas
    if (!this._createRules) {
      const out = el('strong', { text: String(c.bots) });
      const bots = el('input', { type: 'range', min: '0', max: String(ONLINE_MAX_BOTS), value: String(c.bots) });
      bots.addEventListener('input', () => {
        c.bots = Number(bots.value);
        out.textContent = bots.value;
        this._chips($('crear-resumen'), { bots: c.bots, rules: c.rules });
        this._createRules?.refresh();
      });
      const dif = el('div', { class: 'segmentos', role: 'radiogroup', 'aria-label': 'Dificultad' });
      segmented(dif, Object.entries(DIFFICULTY), c.difficulty, (v) => {
        c.difficulty = v;
      });
      this._createRules = rulesEditor('crear', c.rules, () => this._chips($('crear-resumen'), { bots: c.bots, rules: c.rules }), {
        autoColonies: () => colonyCount(landTilesOf(c.map), c.bots),
      });
      $('crear-reglas').replaceChildren(
        el('label', { class: 'campo' }, el('span', {}, 'Naciones de la IA ', out), bots),
        el('div', { class: 'campo' }, el('span', { text: 'Dificultad' }), dif),
        this._createRules,
      );
    }
    this._createRules.refresh();
  }

  _seats(d) {
    this.create.seats = Math.max(MIN_HUMANS, Math.min(MAX_HUMANS, this.create.seats + d));
    this._renderCreate();
  }

  _busyCreate(on) {
    this.creating = on;
    const b = $('crear-confirmar');
    b.disabled = on;
    b.textContent = on ? 'Creando sala…' : 'Crear sala';
  }

  /** Crear: una sola sala aunque se pulse dos veces; si falla, se conserva todo y se puede reintentar. */
  async _submitCreate() {
    if (this.creating) return;
    const c = this.create;
    c.name = $('crear-nombre').value.trim() || `Sala de ${this.profile.nombre || 'Trinchera'}`;
    this._busyCreate(true);
    $('crear-error').textContent = '';
    // Las reglas elegidas pasan a ser las del jugador
    Object.assign(this.profile.ajustes, { mapa: c.map, dificultad: c.difficulty, reglas: { ...c.rules } });
    this.h.onProfileChange?.(false);
    try {
      await this.h.onCreateRoom?.({
        settings: { bots: c.bots, mapSize: c.map, difficulty: c.difficulty, rules: { ...c.rules } },
        info: { nombre: c.name, visibilidad: c.visibility, plazas: c.seats },
      });
      $('crear-sala').hidden = true;
    } catch (err) {
      $('crear-error').textContent = `${err && err.message ? err.message : 'No se ha podido crear la sala.'} Revisa la conexión y vuelve a intentarlo.`;
      $('crear-confirmar').textContent = 'Reintentar';
      this.creating = false;
      $('crear-confirmar').disabled = false;
      return;
    }
    this._busyCreate(false);
  }

  // ---------------------------------------------------------------- sala

  showLobby() {
    this._lobbyMode = null;
    this._lobbyPeers = null;
    this._lobbyReady = null;
    $('inicio').hidden = true;
    $('crear-sala').hidden = true;
    if ($('sala').hidden) {
      $('sala').hidden = false;
      this._slideIn($('sala'), 1);
    }
    $('sala-ajustes').hidden = true;
    $('btn-editar-reglas').textContent = 'Editar reglas';
    $('sala-copia').hidden = true;
    delete $('sala-ajustes').dataset.host;
  }

  hideLobby() {
    $('sala').hidden = true;
    this.hideCountdown();
  }

  /** Aviso bajo la cabecera (motivos, errores, reconexión, prueba entre pestañas). */
  _notice(text, tone = '') {
    const n = $('sala-aviso');
    n.hidden = !text;
    n.textContent = text || '';
    n.className = `sala-aviso${tone ? ` ${tone}` : ''}`;
  }

  /**
   * Ficha de invitación: nombre, mapa y plazas, con «Unirme» o el motivo por
   * el que no se puede entrar (llena, empezada, cerrada, otra versión).
   */
  renderEntry(sala, state) {
    this._lobbyMode = 'entrada';
    $('sala-rejilla').hidden = true;
    $('sala-pie').hidden = true;
    $('btn-copiar-enlace').hidden = true;
    const box = $('sala-entrada');
    box.hidden = false;
    const info = state.info || sala.roomInfo();
    $('sala-nombre').textContent = state.info ? info.nombre : 'Invitación a una sala';
    $('sala-codigo').textContent = sala.code.toUpperCase();
    $('sala-visibilidad').textContent = info.visibilidad === 'publica' ? '🌐 Pública' : '🔒 Solo con enlace';
    $('sala-visibilidad').hidden = !state.info;
    const reasons = {
      buscando: 'Buscando sala…',
      llena: 'La sala está llena.',
      empezada: 'La partida ya ha empezado.',
      cerrada: 'La sala no existe, ha caducado o se ha cerrado. Revisa el código o pide un enlace nuevo.',
      version: 'La sala usa otra versión del juego. Recarga la página (y que el anfitrión también) y vuelve a entrar.',
      sinred: 'No hay conexión con el servidor de salas. Comprueba tu conexión a internet.',
      error: `No se ha podido abrir la sala.${state.detalle ? ` ${state.detalle}` : ''}`,
    };
    const s = state.settings;
    const parts = [];
    if (s) {
      const card = el('div', { class: 'entrada-mapa' }, this._thumb(s.mapSize, 320), el('span', { class: 'mapa-etiqueta', text: mapLabel(s.mapSize) }));
      const chips = el('div', { class: 'chips-sala' });
      this._chips(chips, s);
      parts.push(card, chips, el('p', { class: 'entrada-plazas', text: `${state.total || 1} de ${state.seats || 4} plazas ocupadas` }));
    }
    if (state.estado === 'lista') {
      parts.push(el('button', { type: 'button', class: 'principal grande', onclick: () => this.h.onEntryJoin?.(), text: 'Unirme' }));
    } else if (state.estado === 'buscando') {
      parts.push(el('p', { class: 'entrada-buscando', text: reasons.buscando }));
    } else {
      parts.push(el('p', { class: 'entrada-motivo', text: reasons[state.estado] || 'No se puede entrar en esta sala.' }));
      const again = ['cerrada', 'sinred', 'error', 'llena'].includes(state.estado);
      parts.push(
        el(
          'div',
          { class: 'entrada-botones' },
          again ? el('button', { type: 'button', class: 'principal', onclick: () => this.h.onEntryRetry?.(), text: 'Reintentar' }) : null,
          el('button', { type: 'button', class: 'secundario', onclick: () => this.h.onLeaveRoom?.(), text: '← Volver a Multijugador' }),
        ),
      );
    }
    box.replaceChildren(...parts);
  }

  /** Vestíbulo de la sala: invitación, mapa y reglas, jugadores, preparación y motivo. */
  renderLobby(sala, kind, status = '') {
    if (!sala) return;
    // Al pasar de la ficha de invitación a la sala, se vuelve arriba
    if (this._lobbyMode !== 'sala') {
      this._lobbyMode = 'sala';
      document.querySelector('#sala .sala-cuerpo').scrollTop = 0;
    }
    $('sala-entrada').hidden = true;
    $('sala-rejilla').hidden = false;
    $('sala-pie').hidden = false;
    $('btn-copiar-enlace').hidden = false;
    // Con invitados remotos (servidor de salas), el enlace; en la prueba entre pestañas o en Claude, el código
    this._inviteLabel = kind === 'mqtt' ? 'Copiar enlace' : 'Copiar código';
    const lbl = $('btn-copiar-enlace').querySelector('span');
    if (!this._copyTimer && lbl.textContent !== this._inviteLabel) lbl.textContent = this._inviteLabel;
    const st = sala.status();
    const info = sala.roomInfo();
    const s = sala.isHost ? sala.settings : sala.hostSettings();
    $('sala-nombre').textContent = info.nombre;
    $('sala-visibilidad').hidden = false;
    $('sala-visibilidad').textContent = info.visibilidad === 'publica' ? '🌐 Pública' : '🔒 Solo con enlace';
    $('sala-codigo').textContent = sala.code.toUpperCase();
    $('sala-red').textContent = kind === 'local' ? 'Prueba entre pestañas' : kind === 'mqtt' ? 'Servidor público' : '';
    if (s) {
      this._paintMapInto($('sala-mapa-img'), s.mapSize);
      $('sala-mapa-nombre').textContent = mapLabel(s.mapSize);
      this._chips($('sala-chips'), s);
    }
    // Jugadores: anfitrión, invitados y plazas libres. Los que acaban de
    // entrar aparecen con una animación y la marca de «listo» da un saltito
    const seen = this._lobbyPeers;
    const wasReady = this._lobbyReady;
    this._lobbyPeers = new Set(st.players.map((p) => p.peer));
    this._lobbyReady = new Set(st.players.filter((p) => p.ready).map((p) => p.peer));
    const rows = st.players.map((p) => {
      const tag = p.host ? ['Anfitrión', 'anfitrion'] : !p.versionOk ? ['Otra versión', 'error'] : p.stale ? ['Reconectando…', 'aviso'] : p.ready ? ['Listo', 'listo'] : ['Preparando', 'preparando'];
      const fresh = seen && !seen.has(p.peer);
      const pop = wasReady && p.ready && !wasReady.has(p.peer);
      return el(
        'li',
        { class: `${p.isMe ? 'yo' : ''}${p.stale ? ' desconectado' : ''}${fresh ? ' entra' : ''}${pop ? ' pop' : ''}` },
        el('span', { class: 'sala-escudo' }, emblemCanvas(p.emblem, 34)),
        el('span', { class: 'sala-nombre' }, el('strong', { text: `${p.name}${p.isMe ? ' (tú)' : ''}` }), el('small', { text: `Nivel ${p.level}${p.title ? ` · ${p.title}` : ''}` })),
        el('span', { class: `tag-sala ${tag[1]}`, text: tag[0] }),
        el('span', { class: `check-sala${p.ready ? ' si' : ''}`, 'aria-label': p.ready ? 'Preparado' : 'Sin preparar', text: p.ready ? '✓' : '' }),
      );
    });
    for (let i = st.players.length; i < st.seats; i++) {
      rows.push(el('li', { class: 'libre' }, el('span', { class: 'sala-escudo libre', text: '+' }), el('span', { class: 'sala-nombre' }, el('strong', { text: 'Plaza libre' }))));
    }
    $('sala-jugadores').replaceChildren(...rows);
    $('sala-cuenta').textContent = `${st.total}/${st.seats}`;
    // Pie: cuántos preparados, el motivo y la acción
    $('sala-preparados').textContent = `${st.readyCount} de ${st.total} preparado${st.total === 1 ? '' : 's'}`;
    const me = st.players.find((p) => p.isMe);
    const waiting = !me && st.waiting.some((p) => p.isMe);
    const counting = !!sala.countdown;
    $('btn-empezar').hidden = !sala.isHost;
    $('btn-listo').hidden = sala.isHost;
    let motivo = '';
    if (sala.isHost) {
      $('btn-empezar').disabled = !st.canStart || counting;
      $('btn-empezar').textContent = counting ? 'Empezando…' : 'Iniciar partida';
      motivo = st.canStart ? 'Todo listo' : st.blockers[0] || '';
    } else {
      const hostOk = st.host && st.host.presence.version === RULES_FINGERPRINT;
      const ready = !!me && me.ready;
      $('btn-listo').disabled = !me || !hostOk || counting;
      if (ready && wasReady && !wasReady.has(me.peer) && !sinMovimiento()) {
        $('btn-listo').animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(0.98)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
      }
      $('btn-listo').textContent = ready ? 'Cancelar listo' : 'Estoy listo';
      $('btn-listo').classList.toggle('secundario', ready);
      $('btn-listo').classList.toggle('principal', !ready);
      motivo = !st.host ? 'Esperando al anfitrión…' : !hostOk ? 'Otra versión del juego: recarga la página' : waiting ? 'La sala está llena' : ready ? 'Esperando a que el anfitrión inicie' : sala.ready ? 'Las reglas han cambiado: revisa y confirma de nuevo' : 'Revisa la configuración y pulsa «Estoy listo»';
    }
    $('sala-motivo').textContent = motivo;
    $('sala-motivo').classList.toggle('ok', sala.isHost && st.canStart);
    // Reglas: solo el anfitrión las edita
    $('btn-editar-reglas').hidden = !sala.isHost;
    if (sala.isHost) this._hostEditor(sala, s);
    else {
      $('sala-ajustes').hidden = true;
      delete $('sala-ajustes').dataset.host;
    }
    // Aviso: lo que se pase, o la prueba entre pestañas
    if (status) this._notice(status, /no |otra versión|perdid|ha salido|llena|cerrad|cancel/i.test(status) ? 'error' : '');
    else if (kind === 'local') this._notice('Prueba entre pestañas: solo pueden entrar otras pestañas de este navegador. Copia el código y ábrelo en otra pestaña.', 'aviso');
    else this._notice('');
  }

  /** Editor del anfitrión (nombre, visibilidad, plazas, mapa, naciones, dificultad y reglas): los mismos controles que «Crear sala». */
  _hostEditor(sala, s) {
    const box = $('sala-ajustes');
    if (box.dataset.host) return;
    box.dataset.host = '1';
    const info = sala.info;
    const name = el('input', { maxlength: '28', value: info.nombre, 'aria-label': 'Nombre de la sala' });
    name.addEventListener('change', () => this.h.onRoomInfo?.({ nombre: name.value.trim() || info.nombre }));
    const vis = el('div', { class: 'segmentos visibilidad', role: 'radiogroup', 'aria-label': 'Visibilidad' });
    segmented(vis, [['enlace', '🔒 Solo con enlace'], ['publica', '🌐 Pública']], info.visibilidad, (v) => this.h.onRoomInfo?.({ visibilidad: v }));
    const seats = el('div', { class: 'segmentos plazas', role: 'radiogroup', 'aria-label': 'Plazas' });
    segmented(seats, Array.from({ length: MAX_HUMANS - MIN_HUMANS + 1 }, (_, i) => [i + MIN_HUMANS, String(i + MIN_HUMANS)]), info.plazas, (v) => this.h.onRoomInfo?.({ plazas: v }));
    this.choice.rules = { ...DEFAULT_RULES, ...migrateRules(s.rules) };
    this._salaMap = s.mapSize;
    this._salaDifficulty = s.difficulty;
    const maps = el('div', { class: 'crear-mapas', 'aria-label': 'Mapa' });
    mapPicker(maps, s.mapSize, (id) => {
      this._salaMap = id;
      this._lobbyChanged();
    });
    const dif = el('div', { class: 'segmentos', role: 'radiogroup', 'aria-label': 'Dificultad' });
    segmented(dif, Object.entries(DIFFICULTY), s.difficulty, (v) => {
      this._salaDifficulty = v;
      this._lobbyChanged();
    });
    box.replaceChildren(
      el('p', { class: 'nota', text: 'Si cambias el mapa, las naciones, la dificultad o las reglas, los invitados tienen que confirmar de nuevo. El nombre, la visibilidad y las plazas no.' }),
      el('label', { class: 'campo' }, el('span', { text: 'Nombre de la sala' }), name),
      el('div', { class: 'fila-2' }, el('div', { class: 'campo' }, el('span', { text: 'Visibilidad' }), vis), el('div', { class: 'campo' }, el('span', { text: 'Plazas' }), seats)),
      el('div', { class: 'campo' }, el('span', { text: 'Mapa' }), maps),
      el('div', { class: 'fila-2' },
        el('label', { class: 'campo' }, el('span', {}, 'Naciones de la IA ', el('strong', { id: 'sala-out-bots', text: String(s.bots) })),
          el('input', { id: 'sala-bots', type: 'range', min: '0', max: String(ONLINE_MAX_BOTS), value: String(Math.min(ONLINE_MAX_BOTS, s.bots)), oninput: () => this._lobbyChanged() })),
        el('div', { class: 'campo' }, el('span', { text: 'Dificultad' }), dif)),
      (this._rulesSala = rulesEditor('sala', this.choice.rules, () => this._lobbyChanged(), {
        autoColonies: () => colonyCount(landTilesOf(this._salaMap || 'mundo'), Number($('sala-bots')?.value || 0)),
      })),
    );
    this._rulesSala.refresh();
  }

  _lobbyChanged() {
    $('sala-out-bots').textContent = $('sala-bots').value;
    this._rulesSala?.refresh();
    // Se guardan como las reglas por defecto del jugador
    this.profile.ajustes.reglas = { ...this.choice.rules };
    this.h.onProfileChange?.(false);
    this.h.onRoomSettings?.({
      bots: Number($('sala-bots').value),
      mapSize: this._salaMap,
      difficulty: this._salaDifficulty,
      rules: { ...this.choice.rules },
    });
  }

  /** Cuenta atrás grande sobre la sala (ms) o la quita (null). */
  showCountdown(ms) {
    const box = $('sala-cuenta-atras');
    clearInterval(this._cdTimer);
    const end = performance.now() + ms;
    const num = $('sala-cuenta-num');
    const paint = () => {
      const left = Math.max(0, end - performance.now());
      const txt = String(Math.max(1, Math.ceil(left / 1000)));
      if (num.textContent !== txt) {
        num.textContent = txt;
        // Cada cifra entra girando
        if (!sinMovimiento()) num.animate?.([{ transform: 'perspective(400px) rotateX(-90deg)', opacity: 0 }, { transform: 'perspective(400px) rotateX(12deg)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'ease-out' });
      }
      if (left <= 0) clearInterval(this._cdTimer);
    };
    num.textContent = '';
    box.hidden = false;
    paint();
    this._cdTimer = setInterval(paint, 100);
  }

  hideCountdown() {
    clearInterval(this._cdTimer);
    $('sala-cuenta-atras').hidden = true;
  }

  /** Enlace copiado o, si el portapapeles falla, el enlace a la vista para seleccionarlo. */
  showCopy(ok, link) {
    if (ok) {
      const b = $('btn-copiar-enlace');
      const label = b.querySelector('span');
      label.textContent = '¡Copiado!';
      clearTimeout(this._copyTimer);
      this._copyTimer = setTimeout(() => {
        this._copyTimer = null;
        label.textContent = this._inviteLabel || 'Copiar enlace';
      }, 1800);
      $('sala-copia').hidden = true;
      return;
    }
    $('sala-copia').hidden = false;
    $('sala-enlace').value = link;
    $('sala-enlace').focus();
    $('sala-enlace').select();
  }
}
