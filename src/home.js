// Pantallas de inicio: jugar (IA y multijugador), perfil, apariencia, logros,
// clasificación, y la sala de espera del multijugador.
import { BUILDINGS, CONFIG, DEFAULT_RULES, GOLD_STEPS, MAP_SIZES, REAL_MAPS, RES, TIME_LIMITS, TRUCE_MINS, WIN_SHARES, colonyCount, mapLabel, migrateRules } from './config.js';
import { PROFILES } from './mecanicas.js';
import { MAX_HUMANS, MIN_HUMANS, RULES_FINGERPRINT } from './multiplayer.js';
import { REAL_MAP_DATA } from './mapas-reales.js';
import { loadMapData } from './mapas-carga.js';
import { configSummary, replayPlan } from './repeticion.js';
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
import { errorReport } from './errores.js';
import { drawChart, drawSparkline } from './resumen.js';
import { LEAGUES, PLACEMENT_GAMES, RANKED_AI, RANKED_ROOM, aiDifficultyFor, badgeCanvas, drawBadge, inPlacement, paintBadge, pointsFromMmr, rankOf, rankText, seasonEnd, seasonName, seasonReward } from './rangos.js';
import {
  ACHIEVEMENTS, BANNERS, DAILY, DAILY_BONUS, FRAMES, NAME_COLORS, PATTERNS, SHAPES, SYMBOLS, TITLES, WEEKLY, WEEKLY_BONUS, ensureWeekly,
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
  { tag: 'Mejoras', title: 'Más ligero y más pulido', text: 'Cada versión nueva se descarga en una quinta parte (los mapas se guardan en tu navegador), arreglos en amigos y clanes, colonias que ya no encabezan la clasificación, Arsenal y Progreso mejor colocados y nuevas animaciones al pulsar y al poder construir.', art: 0 },
  { tag: 'Social', title: 'Amigos y clanes', text: 'Añade amigos con tu código, mira quién está en línea e invítales a tu sala. Funda un clan con su etiqueta e insignia o únete a uno. Y un perfil renovado, con tus cifras a la vista.', art: 0 },
  { tag: 'Capital', title: 'Una capital que crece hasta el nivel 12', text: 'Murallas de píxeles que se engrosan con las tropas del banco, un botón para guardar y un emblema que pasa de piedra a oro. Cada nivel cuesta oro y tropas y trae premios que ves por adelantado.', art: 1 },
  { tag: 'Defensa', title: 'Capital con banco de tropas', text: 'Guarda soldados en tu capital y sácalos cuando los necesites. Una sola mejora le da oro y más banco; sus murallas, afueras y escudo antimisiles la hacen mucho más dura. Los antimisiles disparan salvas y casi no fallan.', art: 1 },
  { tag: 'Economía', title: 'Tu capital y un territorio que produce', text: 'Cuanto más grande, más oro. Naces con una capital amurallada que mejoras sin llenar el mapa de edificios; hay pueblos, pesqueros y lugares de interés con premios.', art: 1 },
  { tag: 'Mapa', title: 'Frentes en rojo', text: 'Las fronteras donde se lucha se ponen rojas, los barcos marcan dónde van a desembarcar y el tooltip es más pequeño y claro.', art: 2 },
  { tag: 'Mapa', title: 'Colores y banderas', text: 'Cada país se distingue de sus vecinos, los barcos llevan su bandera y los territorios sueltos de una nación, también.', art: 2 },
  { tag: 'Mapas', title: 'Seis regiones nuevas', text: 'Mediterráneo, Oriente Medio, Centroamérica y el Caribe, Sudeste Asiático, Extremo Oriente y Asia del Sur: más detalle por país y partidas más cortas.', art: 2 },
  { tag: 'Menús', title: 'Menú más fluido', text: 'Pestañas y páginas cambian sin tirones y el menú gasta mucho menos mientras lo miras, también en el móvil.', art: 0 },
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

/** Iconos de las fichas de estadísticas del perfil (16×16, trazo). */
const statIcon = (d, fill = false) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;
const STAT_ICONS = {
  bandera: statIcon('M4 14.5V2M4 2.5h8l-2 3 2 3H4'),
  copa: statIcon('M5 2.5h6v3.2a3 3 0 0 1-6 0zM5 3.5H2.8a2.2 2.2 0 0 0 2.4 3M11 3.5h2.2a2.2 2.2 0 0 1-2.4 3M8 8.7v3M5.5 13.5h5'),
  diana: statIcon('M8 14A6 6 0 1 1 8 2a6 6 0 0 1 0 12M8 10.8a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6M8 8.2v-.4'),
  espadas: statIcon('M3 13 11 5M5 14l8-8M10.5 3.5l3-1-1 3M2 11.5l2.5 2.5'),
  mapa: statIcon('M1.8 4 6 2.3l4 1.6 4.2-1.6v9.7L10 13.7l-4-1.6-4.2 1.6zM6 2.3v9.8M10 3.9v9.8'),
  rayo: statIcon('M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z'),
  reloj: statIcon('M8 14A6 6 0 1 1 8 2a6 6 0 0 1 0 12M8 4.8V8l2.3 1.5'),
  castillo: statIcon('M2.5 14V6.5h2v1.8h1.6V6.5h3.8v1.8h1.6V6.5h2V14zM6.5 14v-2.5a1.5 1.5 0 0 1 3 0V14'),
  manos: statIcon('M1.5 7.5 4 5l3 1.5 2.5-1.5 5 2.5M4 5v4l3 3 1.5-1M7 6.5 5.5 8.5l2 1.5M14.5 7.5 12 10l-2 1.5'),
  globo: statIcon('M8 14A6 6 0 1 1 8 2a6 6 0 0 1 0 12M2 8h12M8 2c-2 2-2.6 4-2.6 6S6 12 8 14c2-2 2.6-4 2.6-6S10 4 8 2'),
  podio: statIcon('M1.5 14h13M2.5 14V9.5h3.6V14M6.1 14V6h3.8v8M9.9 14v-6h3.6v6'),
  medalla: statIcon('M5.5 1.5 8 6l2.5-4.5M8 15a4 4 0 1 1 0-8 4 4 0 0 1 0 8M8 9.4v2.2'),
  escudo: statIcon('M8 1.8 13.5 4v4c0 3.2-2.4 5.3-5.5 6.4C4.9 13.3 2.5 11.2 2.5 8V4z'),
  check: statIcon('M8 14A6 6 0 1 1 8 2a6 6 0 0 1 0 12M5.3 8.2l1.9 1.9 3.6-3.8'),
  moneda: statIcon('M8 14.2A6.2 6.2 0 1 1 8 1.8a6.2 6.2 0 0 1 0 12.4M8 4.5v7M10 5.8c-.5-.6-1.2-.9-2-.9-1.2 0-2 .6-2 1.5 0 2 4 1 4 3.1 0 .9-.9 1.6-2.1 1.6-.9 0-1.7-.4-2.1-1'),
};

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

/**
 * Datos de un mapa real ya decodificados (terreno, relieve y ríos). Los que
 * se usan sin parar (el mundo y Europa, en la portada y los dibujos) se
 * guardan; para una miniatura se decodifica, se pinta y se suelta: con doce
 * mapas reales, guardarlos todos eran decenas de MB en el móvil.
 */
const realCache = new Map();
/** Llama a `fn` cuando estén los mapas (en la web llegan aparte; si falla la descarga, se reintenta). */
function whenMaps(fn) {
  loadMapData().then(fn, () => setTimeout(() => whenMaps(fn), 2000));
}
function decodePreview(id) {
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
  return { w, h, terrain, relief: data.relief ? decodeRelief(data.relief) : null, tileKm, countries: data.countries, lat: data.lat || null, river: markRivers(w, h, terrain, RIVERS[id] || []) };
}
function realPreviewData(id) {
  let d = realCache.get(id);
  if (!d) realCache.set(id, (d = decodePreview(id)));
  return d;
}

/** Casillas de tierra de un mapa (para calcular las colonias automáticas sin cargarlo). */
const landCache = new Map();
function landTilesOf(id) {
  if (landCache.has(id)) return landCache.get(id);
  let n = 0;
  if (REAL_MAP_DATA[id] && !REAL_MAP_DATA[id].rle) {
    // (en la web, antes de que llegue el terreno: una estimación, sin guardarla)
    return Math.round(REAL_MAP_DATA[id].w * REAL_MAP_DATA[id].h * 0.3);
  }
  if (REAL_MAP_DATA[id]) {
    // Se cuentan los tramos de tierra del terreno codificado, sin decodificarlo entero
    const bin = atob(REAL_MAP_DATA[id].rle);
    for (let k = 0; k < bin.length; k++) {
      const b = bin.charCodeAt(k);
      if (b >> 6) n += (b & 63) + 1;
    }
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
  if (REAL_MAP_DATA[id]) data = realCache.get(id) || decodePreview(id);
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
function thumbSource(id, width) {
  const key = `${id}:${width}`;
  let src = thumbCache.get(key);
  if (!src) {
    // (en la web, si los mapas aún no han llegado, un mapa aleatorio de momento, sin guardarlo)
    if (REAL_MAP_DATA[id] ? !REAL_MAP_DATA[id].rle : !MAP_SIZES[id] && !REAL_MAP_DATA.mundo?.rle) return mapThumb('mediano', width);
    src = mapThumb(REAL_MAP_DATA[id] || MAP_SIZES[id] ? id : 'mundo', width);
    thumbCache.set(key, src);
  }
  return src;
}
function thumbCopy(id, width) {
  const src = thumbSource(id, width);
  const c = el('canvas', { width: src.width, height: src.height, 'aria-hidden': 'true' });
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

/** Proporción (alto / ancho) de la miniatura de un mapa, sin pintarla. */
function thumbRatio(id) {
  if (REAL_MAP_DATA[id]) return REAL_MAP_DATA[id].h / REAL_MAP_DATA[id].w;
  const size = MAP_SIZES[id] || MAP_SIZES.mediano;
  return Math.round(size.h / (3 * RES)) / Math.round(size.w / (3 * RES));
}

/**
 * Miniatura que se pinta cuando haya un rato libre (una por vez, la elegida
 * antes): el lienzo, ya con su tamaño, sale al momento y se rellena después.
 * Antes se pintaban todas al arrancar, de golpe, y con quince mapas era lo
 * que más tardaba en abrirse el menú.
 */
const thumbQueue = [];
let thumbPumping = false;
function lazyThumb(id, width, first = false) {
  if (thumbCache.has(`${id}:${width}`)) return thumbCopy(id, width);
  const c = el('canvas', { width, height: Math.round(width * thumbRatio(id)), 'aria-hidden': 'true', class: 'por-pintar' });
  const job = { id, width, c };
  if (first) thumbQueue.unshift(job);
  else thumbQueue.push(job);
  pumpThumbs();
  return c;
}
function pumpThumbs() {
  if (thumbPumping || !thumbQueue.length) return;
  thumbPumping = true;
  const idle = typeof requestIdleCallback === 'function' ? (fn) => requestIdleCallback(fn, { timeout: 1200 }) : (fn) => setTimeout(fn, 40);
  idle(() => {
    thumbPumping = false;
    const job = thumbQueue.shift();
    if (job) {
      try {
        const src = thumbSource(job.id, job.width);
        if (job.c.height !== src.height) job.c.height = src.height;
        job.c.getContext('2d').drawImage(src, 0, 0);
        job.c.classList.remove('por-pintar');
      } catch (err) {
        console.warn('Miniatura de mapa', job.id, err);
      }
    }
    pumpThumbs();
  });
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
      const thumb = lazyThumb(id, Math.round(168 * dpr), id === value);
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
  // Modo de victoria: en Clásico no hay capitales, así que esa opción no sale.
  // Si estaba elegida y cambias a Clásico, pasa a Dominación y se dice junto al selector (DEV08)
  const victoryBox = el('div', { class: 'segmentos', role: 'radiogroup', 'aria-label': 'Modo de victoria' });
  const victoryNote = el('small', { class: 'nota-victoria', role: 'status' });
  const syncVictory = (fromProfile = false) => {
    const opts = [['dominio', 'Dominación'], ['capitales', 'Capitales'], ['economia', 'Economía'], ['supervivencia', 'Supervivencia']]
      .filter(([v]) => !(v === 'capitales' && rules.profile === 'clasico'));
    let note = rules.profile === 'clasico' ? 'En Clásico no hay victoria por capitales: no tiene puntos estratégicos.' : '';
    if (!opts.some(([v]) => v === rules.victory)) {
      if (fromProfile && rules.victory === 'capitales') note = 'Has elegido Clásico, que no tiene capitales que conquistar: el objetivo ha pasado de Capitales a Dominación.';
      rules.victory = 'dominio';
    }
    victoryNote.textContent = note;
    victoryNote.hidden = !note;
    victoryNote.classList.toggle('aviso', note.startsWith('Has elegido'));
    segmented(victoryBox, opts, rules.victory, (v) => {
      rules.victory = v;
      victoryNote.classList.remove('aviso');
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
    syncVictory(true);
    change();
  });
  const box = el('div', { class: 'reglas-rejilla' },
    el('div', { class: 'campo campo-perfil' }, el('span', {}, 'Perfil de reglas ', profileNote), profileBox),
    el('label', { class: 'campo' }, el('span', {}, 'Colonias (bots débiles) ', colOut, ' ', colNote), col),
    el('label', { class: 'campo' }, el('span', {}, 'Oro inicial ', goldOut), gold),
    seg('Economía', 'economy', [['fixed', 'Oro fijo'], ['workers', 'Con trabajadores']]),
    el('div', { class: 'campo' }, el('span', { text: 'Modo de victoria' }), victoryBox, victoryNote),
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
  if (Number.isFinite(r.colonies)) parts.push(`${r.colonies} ${r.colonies === 1 ? 'colonia' : 'colonias'}`);
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

// ------------------------------------------------------------ navegación

/** Páginas del menú (se abren encima de su sección, con «← Volver»). */
const PAGES = new Set(['competitivo', 'crear', 'multijugador', 'clasificacion']);
/** A dónde vuelve cada página si no hay historial (y qué pestaña se marca mientras tanto). */
const PARENT = { competitivo: 'jugar', crear: 'jugar', multijugador: 'jugar', clasificacion: 'competitivo' };
/** Dirección de cada sección o página (#/competitivo…; el inicio, sin nada). */
const SLUG = { jugar: '', logros: 'progreso', perfil: 'perfil', arsenal: 'arsenal', ajustes: 'ajustes', competitivo: 'competitivo', crear: 'crear', multijugador: 'multijugador', clasificacion: 'clasificacion' };

/** Sección o página de una dirección (#/competitivo → 'competitivo'), o null. */
export function viewFromHash(hash = typeof location !== 'undefined' ? location.hash : '') {
  const slug = String(hash || '').replace(/^#\/?/, '').split('/')[0];
  if (!slug) return null;
  for (const [view, sl] of Object.entries(SLUG)) if (sl === slug) return view;
  return null;
}

/** Entrada del historial del navegador; si no se puede cambiar la dirección (marcos aislados), sin ella. */
function histOp(op, state, slug) {
  const url = slug == null ? null : `${location.pathname}${location.search}${slug ? `#/${slug}` : ''}`;
  try {
    if (url === null) history[op](state, '');
    else history[op](state, '', url);
    return true;
  } catch {
    try {
      history[op](state, '');
      return true;
    } catch {
      return false;
    }
  }
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
    this.table = 'rangos';
    this.ladder = { available: false, rows: [], error: '', myId: null, source: '' };
    this.global = { available: false, rows: [], error: '', stale: false, myId: null };
    this.rooms = [];

    const nav = document.querySelector('.ini-pestanas');
    for (const tab of nav.querySelectorAll('[data-vista]')) {
      tab.setAttribute('aria-controls', `vista-${tab.dataset.vista}`);
      tab.addEventListener('click', () => this.go(tab.dataset.vista));
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
    $('chip-perfil').addEventListener('click', () => this.go('perfil'));
    // Páginas: «← Volver», enlaces a otras páginas y el botón atrás del navegador o del móvil
    for (const b of document.querySelectorAll('#inicio [data-volver]')) b.addEventListener('click', () => this.back());
    for (const b of document.querySelectorAll('#inicio [data-pagina]')) b.addEventListener('click', () => this.go(b.dataset.pagina));
    window.addEventListener('popstate', (e) => this._onPop(e.state));
    // Escape en una página: atrás (si no hay un diálogo abierto, que se cierra antes)
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !PAGES.has(this.view) || !this.menuVisible()) return;
      if (document.querySelector('[aria-modal="true"]:not([hidden])')) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      this.back();
    });
    // Dirección de entrada (#/competitivo…): esa página; la entrada actual del historial es la base
    const first = viewFromHash();
    if (first && first !== 'jugar') this.view = first;
    histOp('replaceState', { trinchera: true, vista: this.view, n: 0 }, SLUG[this.view] ?? '');

    // Tarjetas de modo
    for (const card of document.querySelectorAll('.modo[data-modo]')) {
      card.addEventListener('click', () => this._mode(card.dataset.modo));
    }

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
      whenMaps(() =>
        setTimeout(() => {
          // Europa, el Mediterráneo y Oriente Próximo (a la derecha de la portada, tras la línea dorada)
          this.cover = new CoverArt(cover, realPreviewData('mundo'), { crop: { x0: 0.415, x1: 0.655, y0: 0.085 }, labelFrom: 0.2 });
          if (!$('inicio').hidden) this.cover.start();
        }, 60),
      );
    }
    // Ilustraciones de la portada y de las tarjetas de modo (después del primer pintado)
    whenMaps(() => setTimeout(() => this._paintArt(), 30));
    // La escena de la portada se repinta solo si cambia de tamaño (antes se
    // pintaba al arrancar con una altura provisional, se quedaba estirada y se
    // repintaba, con su tirón, cada vez que se volvía a «Jugar»)
    const hero = $('heroe-escena');
    let resizeTimer = 0;
    const repaint = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this._paintHero(), 120);
    };
    if (hero && typeof ResizeObserver === 'function') new ResizeObserver(repaint).observe(hero);
    else window.addEventListener('resize', repaint);
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
    $('aj-error-copiar').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(errorReport());
        this._flash('Copiado. Pégalo donde quieras enviarlo.', true);
      } catch {
        // Sin portapapeles: el texto queda seleccionado para copiarlo a mano
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents($('aj-error-texto'));
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    $('dr-si').addEventListener('click', () => {
      this._resetSettings();
      cerrarDialogo($('dialogo-restablecer'));
      this._flash('Ajustes restablecidos.', true);
    });
    this._syncVolumes();

    // Portada, arsenal y muestras de color
    $('btn-jugar-ya').addEventListener('click', () => this._mode('rapida'));
    // Competitivo: cola (contra la IA o en línea) y «Buscar partida»
    this.queue = this.profile.ajustes.colaClasif === 'sala' ? 'sala' : 'ia';
    segmented($('cp-colas'), [['ia', 'Contra la IA'], ['sala', 'En línea']], this.queue, (v) => {
      this.queue = v;
      this.profile.ajustes.colaClasif = v;
      this.h.onProfileChange?.(false);
      this.renderQueue();
    });
    $('cp-buscar').addEventListener('click', () => this._findMatch());
    this.search = null;
    $('bp-ir').addEventListener('click', () => this.go('competitivo'));
    $('bp-cancelar').addEventListener('click', () => this.h.onFindMatch?.());
    $('btn-repetir').addEventListener('click', () => this._replay());
    $('btn-tutorial').addEventListener('click', () => this.h.onTutorial?.());
    $('novedades-todas').addEventListener('click', () => this._allNews());
    for (const b of document.querySelectorAll('[data-ir]')) {
      if (b.id !== 'chip-perfil') b.addEventListener('click', () => this.go(b.dataset.ir));
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

  /** Clic en una tarjeta de modo: la partida rápida empieza ya; el resto abre su página. */
  _mode(mode) {
    if (mode === 'rapida') {
      // Partida rápida: el perfil Clásico, siempre (elegido aquí, no por los valores por defecto)
      this.h.onQuickPlay?.({ bots: 90, mapSize: 'mundo', difficulty: this.profile.ajustes.dificultad, seed: '', rules: { ...DEFAULT_RULES, profile: 'clasico' } });
    } else if (mode === 'tutorial') {
      this.h.onTutorial?.();
    } else if (mode === 'online') {
      this.go('multijugador');
    } else if (mode === 'personalizada' || mode === 'ia') {
      this.go('crear');
    } else this.go(mode);
  }

  // ------------------------------------------------------------ historial

  /**
   * Va a una sección o página del menú con su entrada en el historial: el
   * botón atrás (del navegador, del móvil o «← Volver») vuelve a la anterior.
   */
  go(view, { replace = false } = {}) {
    if (view === 'apariencia') {
      this._profileTab('aspecto', false);
      view = 'perfil';
    }
    if (view === 'online') view = 'multijugador';
    if (!document.querySelector(`.vista[data-vista="${view}"]`)) view = 'jugar';
    const cur = history.state && history.state.trinchera ? history.state : null;
    const same = !replace && cur && cur.vista === view && !cur.capa;
    const n = cur ? cur.n || 0 : 0;
    histOp(replace || same ? 'replaceState' : 'pushState', { trinchera: true, vista: view, n: replace || same ? n : n + 1 }, SLUG[view]);
    this.setView(view);
  }

  /** «← Volver»: atrás en el historial si se llegó desde otra pantalla; si no, a la sección de la que cuelga. */
  back() {
    const cur = history.state;
    if (cur && cur.trinchera && cur.n > 0) history.back();
    else this.go(PARENT[this.view] || 'jugar', { replace: true });
  }

  /** Capa sobre el menú (crear sala, sala, partida) con su propia entrada: atrás la cierra. */
  pushLayer(capa, slug = capa) {
    const cur = history.state && history.state.trinchera ? history.state : { n: 0 };
    if (cur.capa === capa) return;
    // Una capa sustituye a otra (crear sala → sala → partida): atrás vuelve al menú, no a la anterior
    const op = cur.capa ? 'replaceState' : 'pushState';
    histOp(op, { trinchera: true, vista: this.view, capa, n: cur.capa ? cur.n : (cur.n || 0) + 1 }, slug);
  }

  /** Cierra la capa `capa` del historial (al salir con un botón): vuelve a la entrada de debajo. */
  closeLayer(capa) {
    const cur = history.state;
    if (!cur || cur.capa !== capa) return;
    if (cur.n > 0) history.back();
    else histOp('replaceState', { trinchera: true, vista: this.view, n: 0 }, SLUG[this.view]);
  }

  /**
   * Al cerrar la capa de la partida, ir a `view` (p. ej. Multijugador al
   * salir de una partida en línea). El «atrás» del historial llega un poco
   * después: se resuelve en _onPop, o al rato si no hubo «atrás».
   */
  returnTo(view) {
    this._returnTo = view;
    setTimeout(() => {
      if (this._returnTo !== view) return;
      this._returnTo = null;
      this.go(view, { replace: true });
    }, 400);
  }

  /** El navegador ha ido atrás o adelante. */
  _onPop(st) {
    if (this.h.onHistory?.(st)) return; // la partida o la sala lo resuelven
    if (this._returnTo && this.menuVisible()) {
      const v = this._returnTo;
      this._returnTo = null;
      this.go(v, { replace: true });
      return;
    }
    if (!$('crear-sala').hidden && st?.capa !== 'crear-sala') this._closeCreate();
    if (!this.menuVisible()) return;
    const view = (st && st.vista) || viewFromHash() || 'jugar';
    if (view !== this.view) this.setView(view);
  }

  /**
   * Repite una partida del historial (DEV01) con la configuración que tuvo
   * (no con tus preferencias de ahora). `scenario`: también la misma semilla.
   * Los registros antiguos, sin esa configuración, abren el configurador con
   * lo que se puede recuperar y un aviso para revisarlo.
   */
  _replay(entry = this.profile.historial[0], { scenario = false } = {}) {
    const plan = replayPlan(entry, { scenario });
    if (!plan) return this._mode('rapida');
    if (plan.kind === 'tutorial') return this.h.onTutorial?.();
    if (plan.kind === 'online') return this.go('multijugador');
    if (plan.kind === 'revisar') {
      if (plan.prefill.mapSize) {
        this.choice.map = plan.prefill.mapSize;
        this._galleryIA?.set(plan.prefill.mapSize);
        this._syncBots?.();
      }
      this.go('crear');
      this.flash('Esa partida es de antes de guardar su configuración completa: revisa mapa, rivales y reglas antes de empezar.');
      return;
    }
    const bots = Math.min(maxBotsFor(plan.opts.mapSize), plan.opts.bots);
    this.h.onQuickPlay?.({ ...plan.opts, bots });
  }

  /** Escena de la portada y dibujos de las tarjetas de modo. */
  _paintArt() {
    this._paintHero();
    this._paintBackdrop();
    const data = { world: realPreviewData('mundo'), europe: realPreviewData('europa'), badge: this._badgePainter() };
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

  /** Abre directamente una página (por ejemplo, Multijugador al volver de una sala). */
  openPanel(name) {
    const view = name === 'online' ? 'multijugador' : name;
    if (this.view !== view) this.go(view);
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
    const items = d.retos.flatMap((id) => {
      const r = DAILY.find((x) => x.id === id);
      if (!r) return [];
      const prog = Math.min(r.need, d.progreso[id] || 0);
      const done = !!d.hechos[id];
      return el(
        'li',
        { class: done ? 'hecha' : '' },
        el('span', { class: 'mision-check', 'aria-hidden': 'true', text: done ? '✓' : '' }),
        el('span', { class: 'mision-nombre' }, r.name, r.perfil ? el('small', { class: 'mision-perfil', title: 'En Clásico (el de Partida rápida) no se puede cumplir', text: ` · solo en ${PROFILES[r.perfil]?.name || r.perfil}` }) : null),
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
    const thumb = el('div', { class: 'ultima-mapa' }, thumbCopy(g.mapa, 260));
    thumb.append(el('span', { class: `ultima-resultado${win ? ' gana' : ''}`, text: g.resultado }));
    box.replaceChildren(
      thumb,
      el(
        'div',
        { class: 'ultima-datos' },
        el('strong', { text: mapLabel(g.mapa) }),
        el('span', { text: `${placeText(g) ? `${placeText(g)} · ` : ''}${formatPercent(g.pct)} del mapa · ${formatTime(g.duracion)}` }),
        sparkline(g.curva),
        el('small', { text: `${new Date(g.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}${g.config ? '' : g.rivales ? ` · ${g.rivales} ${g.rivales === 1 ? 'rival' : 'rivales'}` : ''}${g.online ? ' · online' : ''}` }),
      ),
      ...this._replayButtons(g),
    );
  }

  /**
   * Botones para repetir una partida del historial (DEV01): «Repetir
   * configuración» (reparto nuevo) y «Mismo escenario» (misma semilla), con
   * el resumen de la configuración y un aviso si las reglas han cambiado.
   */
  _replayButtons(g) {
    const plan = replayPlan(g);
    const profName = (id) => PROFILES[id]?.name || id;
    const difName = (id) => ({ facil: 'Fácil', normal: 'Normal', dificil: 'Difícil', imposible: 'Imposible' })[id] || id;
    if (!plan || plan.kind !== 'jugar') {
      const label = plan?.kind === 'online' ? 'Ir a Multijugador' : plan?.kind === 'tutorial' ? 'Repetir el tutorial' : 'Revisar y jugar';
      return [el('button', { type: 'button', class: 'ultima-jugar', 'aria-label': label, title: label, onclick: () => this._replay(g) }, el('span', { 'aria-hidden': 'true', text: '▶' }))];
    }
    const out = [
      el('button', { type: 'button', class: 'ultima-jugar', 'aria-label': 'Repetir configuración: mismo mapa, rivales y reglas, con otro reparto', title: 'Repetir configuración (mismo mapa, rivales y reglas; reparto nuevo)', onclick: () => this._replay(g) }, el('span', { 'aria-hidden': 'true', text: '▶' })),
      el(
        'div',
        { class: 'ultima-repetir' },
        el('small', { class: 'ultima-config', text: configSummary(g.config, profName, difName) }),
        el('button', { type: 'button', class: 'btn-sec ultima-escenario', title: 'Repetir escenario: también la misma semilla (el mismo reparto inicial)', onclick: () => this._replay(g, { scenario: true }), text: plan.versionChanged ? 'Mismo escenario (reglas nuevas)' : 'Mismo escenario' }),
      ),
    ];
    if (plan.versionChanged) out.push(el('p', { class: 'ultima-aviso', text: `Se jugó con las reglas ${plan.version || 'antiguas'}; ahora son otras, así que el mismo escenario no saldrá idéntico.` }));
    return out;
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
    $('arsenal-cats')?.replaceChildren(
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
      // Cada familia en su bloque: Economía y Defensa lado a lado, Ataque a lo ancho
      ...ARSENAL_CATS.map((cat) =>
        el(
          'section',
          { class: `arsenal-familia cat-${cat.id}`, style: `--n:${cat.items.length}` },
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
        ),
      ),
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
    // Anillo de experiencia hacia el siguiente nivel
    const frac = Math.max(0, Math.min(1, info.progress));
    $('tp-anillo-relleno').style.strokeDasharray = `${(frac * 100).toFixed(1)} 100`;
    $('tp-xp').textContent = `${p.xp - info.start}/${info.next - info.start} XP`;
    const winRate = p.stats.partidas ? Math.round((100 * p.stats.victorias) / p.stats.partidas) : 0;
    $('tp-datos').textContent = `${p.stats.victorias} victorias · ${p.stats.partidas} partidas${p.stats.partidas ? ` · ${winRate} % ganadas` : ''} · mejor ${formatPercent(p.stats.mejorPct || 0)}`;
    // Liga de la clasificatoria
    const r = p.rango;
    const liga = $('tp-chapas-liga');
    if (liga) {
      if (r && r.partidas > 0 && !inPlacement(r)) {
        const k = rankOf(r.puntos);
        liga.replaceChildren(el('span', { class: 'tp-chapa chapa-liga', style: `--liga: rgb(${k.league.color.join(',')})` }, badgeCanvas(r, 16), k.label));
      } else liga.replaceChildren();
    }
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

  /**
   * ¿Tapa el menú del todo la partida de fondo? Sus pantallas tienen fondo
   * opaco: mientras se ven quietas (sin entrar ni salir), dibujarla detrás
   * era trabajo tirado y quitaba fluidez a las pestañas y a las páginas.
   */
  menuCovers() {
    // (Sin getAnimations: obliga a recalcular estilos y, en cada fotograma, salía caro)
    const a = this._screenAnim;
    if (a && a.playState === 'running') return false;
    return !$('inicio').hidden || !$('sala').hidden || !$('crear-sala').hidden;
  }

  /** Entrada de una pantalla: se desliza desde un lado (`dir` 1 derecha, -1 izquierda, 0 fundido). */
  _slideIn(screen, dir) {
    if (!screen || sinMovimiento() || !screen.animate) return;
    this._screenAnim = screen.animate([{ opacity: 0, transform: `translateX(${dir * 32}px)` }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
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
    // En una página se marca la sección de la que cuelga (Competitivo y Crear partida: Jugar)
    let tabView = view;
    while (PARENT[tabView]) tabView = PARENT[tabView];
    for (const tab of nav.querySelectorAll('[data-vista]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.vista === tabView));
    }
    $('inicio').classList.toggle('en-pagina', PAGES.has(view));
    $('inicio').dataset.seccion = view;
    rodar(nav);
    this._moveUnderline(true);
    $('chip-perfil').classList.toggle('activo', view === 'perfil');
    // Lo que hay que rehacer de la página que entra (lienzos de rangos, tabla…).
    // Se hace mientras sale la vista anterior (esa animación la mueve la
    // gráfica sola), no en el clic: así la salida empieza al instante
    let prepared = false;
    const prepare = () => {
      if (prepared || this.view !== view) return;
      prepared = true;
      if (view === 'clasificacion') this.renderTable();
      if (view === 'competitivo') this.renderCompetitive();
    };
    if (this.search) this.setSearch(this.search);
    // El mapa animado de la portada solo corre mientras se ve «Jugar»
    if (view === 'jugar' && !$('inicio').hidden) this.cover?.start();
    else this.cover?.stop();
    // La vista que se va sale (rápido) y luego entra la nueva
    const secs = Array.from(document.querySelectorAll('.vista[data-vista]'));
    const next = secs.find((sec) => sec.dataset.vista === view);
    const leaving = secs.filter((sec) => sec !== next && !sec.hidden && !sec._salida);
    clearTimeout(this._viewTimer);
    // Las páginas entran desde la derecha y, al volver, la sección llega desde la izquierda
    const dir = PAGES.has(view) && !PAGES.has(prev) ? 1 : PAGES.has(prev) && !PAGES.has(view) ? -1 : PAGES.has(view) ? 1 : 0;
    const enter = () => {
      prepare();
      for (const sec of secs) if (sec !== next && !sec._salida) sec.hidden = true;
      $('inicio').scrollTo?.({ top: 0 });
      mostrar(next, dir ? { x: dir * 30, y: 0, scale: 1, ms: 280, diferir: true } : { y: 10, scale: 1, ms: 240, diferir: true });
      if (view === 'perfil' && this.profileTab === 'resumen') this.renderProgress(true);
      for (const nav of next.querySelectorAll('.sub-pestanas')) underline(nav, false);
      llenarAlVer(next);
    };
    if (prev === view || $('inicio').hidden || sinMovimiento() || !leaving.length) {
      for (const sec of secs) sec.hidden = sec !== next;
      enter();
      return;
    }
    for (const sec of leaving) ocultar(sec, dir ? { x: -dir * 18, y: 0, scale: 1, ms: 110 } : { y: -4, scale: 1, ms: 110 });
    // Tras pintar el fotograma en que empieza la salida
    requestAnimationFrame(() => setTimeout(prepare, 0));
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
    this.renderRanked();
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
    this.renderLastError();
  }

  /** Ajustes → Más: el último fallo registrado (para copiarlo y enviarlo). */
  renderLastError() {
    const box = $('aj-error');
    if (!box) return;
    const text = errorReport();
    box.hidden = !text;
    $('aj-error-texto').textContent = text;
  }

  // ------------------------------------------------------------ rangos

  /** Tarjeta «Competitivo» del inicio: tu rango en una línea y tu insignia en el dibujo. */
  renderRanked() {
    const r = this.profile.rango;
    if (!r) return;
    const corto = $('modo-corto-competitivo');
    if (corto) corto.textContent = rankText(r);
    const key = inPlacement(r) ? 'col' : String(rankOf(r.puntos).index * 10 + rankOf(r.puntos).div);
    if (this._artBadge !== key) {
      this._artBadge = key;
      const card = document.querySelector('.modo[data-modo="competitivo"] .modo-arte');
      if (card && card._escala) drawModeArt('competitivo', card, { badge: this._badgePainter() });
    }
    if (this.view === 'competitivo') this.renderCompetitive();
  }

  /** Dibuja tu insignia (para las ilustraciones): (ctx, cx, cy, alto). */
  _badgePainter() {
    const r = this.profile.rango;
    const placing = inPlacement(r);
    const k = rankOf(r.puntos);
    return (ctx, cx, cy, size) => drawBadge(ctx, cx, cy, size, placing ? null : k.league, placing ? 0 : k.div);
  }

  // ------------------------------------------------------- competitivo

  /** Página Competitivo entera (se llama al abrirla y cuando cambia el rango). */
  renderCompetitive() {
    const r = this.profile.rango;
    if (!r || !$('cp-insignia')) return;
    const p = this.profile;
    const placing = inPlacement(r);
    const k = rankOf(r.puntos);
    const days = Math.max(0, Math.ceil((seasonEnd(r.temporada) - Date.now()) / 86400000));
    $('cp-temporada').textContent = seasonName(r.temporada);
    $('cp-fin').textContent = `Acaba en ${days} día${days === 1 ? '' : 's'}`;
    // Tu comandante: estandarte, emblema y marco, nombre, título y nivel
    $('cp-comandante').className = `cp-comandante est-${p.estandarte}`;
    const ec = $('cp-emblema');
    const ectx = ec.getContext('2d');
    ectx.clearRect(0, 0, ec.width, ec.height);
    drawEmblem(ectx, p.emblema, ec.width / 2, ec.height / 2, ec.width * 0.62);
    drawFrame(ectx, p.marco, ec.width / 2, ec.height / 2, ec.width * 0.62);
    $('cp-nombre').textContent = p.nombre || 'Sin nombre';
    $('cp-nombre').style.color = nameColorOf(p);
    $('cp-titulo').textContent = titleName(p) || 'Recluta';
    $('cp-nivel').textContent = `Nivel ${levelInfo(p.xp).level}`;
    // El rango: insignia grande con su luz, liga, PL y victorias
    paintBadge($('cp-insignia'), r);
    const col = placing ? [196, 170, 120] : k.league.color;
    const band = document.querySelector('.cp-portada');
    band.style.setProperty('--liga', col.join(', '));
    band.classList.toggle('en-colocacion', placing);
    $('cp-liga').textContent = placing ? 'Sin clasificar' : k.label;
    $('cp-pl').textContent = placing ? `Colocación: ${r.colocacion} de ${PLACEMENT_GAMES} partidas` : k.league.apex ? `${k.pl} PL` : `${k.pl} / 100 PL`;
    const frac = placing ? r.colocacion / PLACEMENT_GAMES : k.league.apex ? Math.min(1, k.pl / 300) : k.pl / 100;
    $('cp-barra').style.setProperty('--p', frac.toFixed(3));
    const losses = Math.max(0, r.partidas - r.victorias);
    const pct = r.partidas ? Math.round((r.victorias / r.partidas) * 100) : 0;
    $('cp-vd').replaceChildren(
      el('span', { class: 'cp-v', text: `${r.victorias} V` }),
      ' · ',
      el('span', { class: 'cp-d', text: `${losses} D` }),
      ` · ${pct} % de victorias`,
      r.escudo ? el('span', { class: 'cp-escudo', title: 'No bajas de división en estas partidas', text: ` · 🛡 escudo ${r.escudo}` }) : '',
    );
    this.renderQueue();
    this._renderLeagues(r);
    this._renderSeasonStats(r);
    this._renderRankedHistory(r);
    this._renderTop(r);
    this._renderRewards(r);
  }

  /** La cola elegida y qué hará «Buscar partida». */
  renderQueue() {
    if (!$('cp-buscar')) return;
    const r = this.profile.rango;
    const dif = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil', imposible: 'Imposible' }[aiDifficultyFor(r)];
    const btn = $('cp-buscar');
    if (this.queue === 'ia') {
      $('cp-cola-nota').textContent = `${mapLabel(RANKED_AI.mapSize)}, ${RANKED_AI.bots} naciones, perfil Clásico, contra la IA ${dif}. Cuenta tu puesto final; abandonar cuenta como derrota.`;
      $('cp-cola-extra').textContent = inPlacement(r) ? `Partidas de colocación: ${r.colocacion} de ${PLACEMENT_GAMES}` : 'La IA se ajusta a tu liga.';
      btn.disabled = false;
      btn.textContent = 'Buscar partida';
      btn.classList.add('principal', 'btn-brillo');
      btn.classList.remove('secundario');
      $('cp-buscando').hidden = true;
      return;
    }
    const net = this.netKind;
    const searching = !!this.search;
    $('cp-buscando').hidden = !searching;
    btn.classList.toggle('secundario', searching);
    btn.classList.toggle('principal', !searching);
    btn.classList.toggle('btn-brillo', !searching);
    $('cp-cola-nota').textContent = `${mapLabel(RANKED_ROOM.mapSize)}, ${RANKED_ROOM.bots} naciones, perfil Clásico. Tus puntos dependen de quién queda por delante de quién entre los jugadores.`;
    if (searching) {
      btn.disabled = false;
      btn.textContent = 'Cancelar búsqueda';
      $('cp-cola-extra').textContent = 'Te emparejamos con jugadores de rango parecido; cuanto más esperas, más se abre el margen. Puedes moverte por el menú mientras tanto.';
      return;
    }
    if (!net || net === 'none') {
      btn.disabled = true;
      $('cp-cola-extra').textContent = 'Sin conexión con el servidor de salas.';
    } else if (net === 'connecting') {
      btn.disabled = true;
      $('cp-cola-extra').textContent = 'Conectando con el servidor de salas…';
    } else {
      btn.disabled = false;
      $('cp-cola-extra').textContent = 'Entrarás en la cola: te juntamos con jugadores de rango parecido y la partida empieza sola.';
    }
    btn.textContent = 'Buscar partida';
  }

  /** «Buscar partida»: contra la IA, al momento; en línea, la cola de emparejamiento. */
  _findMatch() {
    if (this.queue === 'ia') {
      this.h.onRanked?.('ia');
      return;
    }
    // En línea: la cola de emparejamiento (o cancelarla si ya se está buscando)
    this.h.onFindMatch?.();
  }

  /**
   * Estado de la búsqueda en línea: info = { waited, window, inQueue } o null
   * (sin buscar); `estado` 'encontrada' cuando ya se ha formado la partida.
   */
  setSearch(info, estado = '') {
    this.search = info;
    const fmt = (ms) => {
      const s = Math.floor(ms / 1000);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    const pill = $('busqueda-pill');
    if (info) {
      const r = this.profile.rango;
      const lo = rankOf(pointsFromMmr(r.mmr - info.window)).label;
      const hi = rankOf(pointsFromMmr(r.mmr + info.window)).label;
      $('cp-busca-tiempo').textContent = fmt(info.waited);
      $('cp-busca-info').textContent = `${lo === hi ? `Rivales de ${lo}` : `Rivales entre ${lo} y ${hi}`} · ${info.inQueue} en cola`;
      $('bp-tiempo').textContent = fmt(info.waited);
    }
    // El aviso flotante, solo por el menú y fuera de la página Competitivo
    const show = !!info && this.menuVisible() && this.view !== 'competitivo';
    if (pill.hidden === show) pill.hidden = !show;
    if (estado === 'encontrada') this._flash('¡Partida encontrada! Entrando en la sala…', true);
    if (this.view === 'competitivo') this.renderQueue();
  }

  /** Escalera de las nueve ligas: las superadas iluminadas, la tuya destacada y la mejor de la temporada marcada. */
  _renderLeagues(r) {
    const placing = inPlacement(r);
    const cur = placing ? -1 : rankOf(r.puntos).index;
    const best = r.partidas ? rankOf(Math.max(r.mejor, r.puntos)).index : -1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    $('cp-ligas').replaceChildren(
      ...LEAGUES.map((L, i) => {
        const c = document.createElement('canvas');
        c.width = c.height = Math.round(58 * dpr);
        c.setAttribute('aria-hidden', 'true');
        drawBadge(c.getContext('2d'), c.width / 2, c.height * 0.54, c.height * 0.72, L, 0);
        const state = i === cur ? 'actual' : i < cur ? 'superada' : 'pendiente';
        return el('li', { class: `cp-liga-item ${state}${i === best && !placing ? ' mejor' : ''}`, style: `--liga: ${L.color.join(', ')}`, title: `${L.name}: desde ${formatNumber(L.base)} puntos` },
          i === cur ? el('span', { class: 'cp-tu', text: 'TÚ' }) : null,
          c,
          el('strong', { text: L.name }),
          el('small', { text: L.apex ? `${formatNumber(L.base)}+` : `IV → I` }));
      }),
    );
  }

  /** Cifras de la temporada y la gráfica de tus PL. */
  _renderSeasonStats(r) {
    const hist = r.historial || [];
    const games = hist.filter((h) => !h.abandono && h.de > 0);
    const avg = games.length ? games.reduce((a, h) => a + h.puesto, 0) / games.length : 0;
    // Racha: del último resultado hacia atrás, mientras sea del mismo signo
    let streak = 0;
    let sign = 0;
    for (const h of hist) {
      const sg = h.delta > 0 || (h.delta === 0 && h.puesto === 1) ? 1 : h.delta < 0 || h.abandono ? -1 : 0;
      if (!sg) break;
      if (!sign) sign = sg;
      if (sg !== sign) break;
      streak++;
    }
    const pct = r.partidas ? Math.round((r.victorias / r.partidas) * 100) : 0;
    const ring = el('span', { class: 'cp-anillo', style: `--p: ${pct / 100}`, 'aria-hidden': 'true' }, el('span', { text: `${pct}%` }));
    const card = (label, value, extra = null) => el('div', { class: 'cp-cifra' }, extra, el('strong', { text: value }), el('small', { text: label }));
    $('cp-stats').replaceChildren(
      card('% de victorias', `${r.victorias}/${r.partidas}`, ring),
      card('Partidas', String(r.partidas)),
      card('Puesto medio', avg ? avg.toFixed(1).replace('.', ',') : '—'),
      card('Racha', streak ? `${streak} ${sign > 0 ? (streak === 1 ? 'buena' : 'buenas') : streak === 1 ? 'mala' : 'malas'}` : '—'),
      card('Mejor rango', r.partidas ? rankOf(Math.max(r.mejor, r.puntos)).label : '—'),
    );
    // Gráfica: tus puntos tras cada partida (de la más antigua a la última)
    const pts = hist.slice(0, 20).map((h) => h.puntos).reverse();
    const box = $('cp-grafica');
    if (pts.length < 2) {
      box.replaceChildren(el('p', { class: 'nota', text: 'Juega un par de clasificatorias para ver cómo evolucionan tus puntos.' }));
      return;
    }
    const W = 320;
    const H = 90;
    const lo = Math.min(...pts);
    const hi = Math.max(...pts);
    const span = Math.max(40, hi - lo);
    const y = (v) => H - 8 - ((v - lo) / span) * (H - 18);
    const x = (i) => 6 + (i / (pts.length - 1)) * (W - 12);
    const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'cp-curva');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Tus puntos en las últimas ${pts.length} partidas: de ${pts[0]} a ${pts[pts.length - 1]}`);
    // Estirada a todo el ancho; el trazo, del mismo grosor
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML = `<defs><linearGradient id="cp-relleno" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(242,179,61,0.35)"/><stop offset="1" stop-color="rgba(242,179,61,0)"/></linearGradient></defs>
      <polygon points="${x(0)},${H} ${line} ${x(pts.length - 1)},${H}" fill="url(#cp-relleno)"/>
      <polyline points="${line}" fill="none" stroke="#f2b33d" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    box.replaceChildren(el('div', { class: 'cp-curva-cab' }, el('small', { text: 'Tus puntos' }), el('small', { text: `${pts[pts.length - 1] - pts[0] >= 0 ? '+' : '−'}${Math.abs(pts[pts.length - 1] - pts[0])} en ${pts.length - 1} partidas` })), svg);
  }

  /** Historial de clasificatorias: franja de color por resultado, puesto, cola y ±PL. */
  _renderRankedHistory(r) {
    const hist = (r.historial || []).slice(0, 10);
    const list = $('cp-historial');
    if (!hist.length) {
      list.replaceChildren(el('li', { class: 'cp-vacio' }, emptyState('⚔', 'Aún no hay clasificatorias esta temporada', 'Tus partidas aparecerán aquí con el puesto y los puntos que ganes o pierdas.')));
      return;
    }
    const ago = (t) => {
      const m = Math.round((Date.now() - t) / 60000);
      if (m < 60) return `hace ${Math.max(1, m)} min`;
      const h = Math.round(m / 60);
      if (h < 24) return `hace ${h} h`;
      const d = Math.round(h / 24);
      return `hace ${d} día${d === 1 ? '' : 's'}`;
    };
    list.replaceChildren(
      ...hist.map((h) => {
        const won = !h.abandono && h.puesto === 1;
        const good = won || h.delta > 0;
        const cls = h.abandono ? 'derrota' : won ? 'victoria' : good ? 'buena' : h.delta < 0 ? 'derrota' : 'neutra';
        const title = h.abandono ? 'Abandono' : won ? 'Victoria' : h.puesto ? `${h.puesto}.º de ${h.de}` : '—';
        const delta = h.delta ? `${h.delta > 0 ? '+' : '−'}${Math.abs(h.delta)} PL` : 'Colocación';
        return el('li', { class: `cp-partida ${cls}` },
          el('span', { class: 'cp-res' }, el('strong', { text: title }), el('small', { text: h.tipo === 'sala' ? `En línea · ${h.rivales || 1} rival${h.rivales === 1 ? '' : 'es'}` : 'Contra la IA' })),
          el('span', { class: 'cp-tras' }, badgeCanvas(h.puntos, 18), el('small', { text: rankOf(h.puntos).label })),
          el('span', { class: 'cp-delta', text: delta }),
          el('small', { class: 'cp-cuando', text: ago(h.fecha) }));
      }),
    );
  }

  /** Los mejores de la temporada (de la tabla global) con tu fila marcada. */
  _renderTop(r) {
    const box = $('cp-top');
    const L = this.ladder;
    const rows = L.available ? L.rows.filter((x) => x.temporada === r.temporada).slice(0, 8) : [];
    if (!rows.length) {
      box.replaceChildren(emptyState('🏅', L.available ? 'Nadie tiene rango todavía esta temporada' : 'La tabla de la temporada aún no está disponible', L.available ? 'Juega una clasificatoria para estrenarla.' : L.error || 'Tu rango se guarda y sube a la tabla en cuanto haya conexión.'));
      return;
    }
    box.replaceChildren(
      el('ol', { class: 'cp-mejores' },
        ...rows.map((row, i) => {
          const rk = rankOf(row.puntos);
          return el('li', { class: row.id === L.myId ? 'yo' : '' },
            el('span', { class: 'cp-puesto', text: String(i + 1) }),
            el('button', { type: 'button', class: 'celda-nacion celda-boton', title: 'Ver su ficha', onclick: () => this.openPlayerCard(row, 'rango') }, emblemCanvas(row.emblema, 22), el('strong', { text: row.nombre })),
            el('span', { class: 'celda-rango' }, badgeCanvas(row.puntos, 18), el('span', { text: rk.label, style: `color: rgb(${rk.league.color.join(',')})` })),
            el('span', { class: 'num', text: `${rk.pl} PL` }));
        })),
    );
  }

  /** Recompensas por la mejor liga de la temporada y temporadas anteriores. */
  _renderRewards(r) {
    const best = r.partidas ? rankOf(Math.max(r.mejor, r.puntos)).index : -1;
    $('cp-rec-nota').textContent = best >= 0 ? `Al acabar la temporada recibirás 🪙 ${formatNumber(seasonReward(Math.max(r.mejor, r.puntos)).coins)} por haber llegado a ${LEAGUES[best].name}. Cuanto más alto llegues, más.` : 'Al acabar la temporada recibes monedas según la mejor liga que alcances.';
    $('cp-recompensas').replaceChildren(
      ...LEAGUES.map((L, i) => el('li', { class: `cp-premio${i === best ? ' actual' : i < best ? ' conseguida' : ''}`, style: `--liga: ${L.color.join(', ')}` },
        el('strong', { text: L.name }),
        el('span', { text: `🪙 ${formatNumber(seasonReward(L.base).coins)}` }))),
    );
    const prev = r.anteriores || [];
    $('cp-anteriores').replaceChildren(
      ...(prev.length
        ? [el('h3', { text: 'Temporadas anteriores' }), el('ul', {}, ...prev.slice(0, 6).map((a) => el('li', {}, badgeCanvas(a.mejor ?? a.puntos ?? 0, 20), el('span', { text: seasonName(a.temporada) }), el('strong', { text: a.liga || rankOf(a.mejor ?? a.puntos ?? 0).label }))))]
        : []),
    );
  }

  /** Clasificación global de rangos: { available, rows, error, myId, source }. */
  setLadder(state) {
    this.ladder = { ...this.ladder, ...state };
    if (this.view === 'clasificacion' && this.table === 'rangos') this.renderTable();
    if (this.view === 'competitivo') this._renderTop(this.profile.rango);
  }

  _ranksTable() {
    const r = this.profile.rango;
    const placing = inPlacement(r);
    const k = rankOf(r.puntos);
    const me = el('div', { class: 'rango-yo' },
      badgeCanvas(r, 56),
      el('div', { class: 'ry-textos' },
        el('small', { text: seasonName(r.temporada) }),
        el('strong', { text: placing ? `Colocación ${r.colocacion}/${PLACEMENT_GAMES}` : k.label, style: placing ? '' : `color: rgb(${k.league.color.join(',')})` }),
        el('span', { text: placing ? 'Juega las partidas de colocación para tener liga.' : `${k.pl} PL · ${r.victorias} victorias en ${r.partidas} partidas · mejor: ${rankOf(Math.max(r.mejor, r.puntos)).label}` })),
      el('button', { type: 'button', class: 'principal', onclick: () => this.go('competitivo'), text: 'Buscar partida' }));
    const out = [me];
    const L = this.ladder;
    if (!L.available) {
      out.push(emptyState('🏅', 'La tabla de rangos global estará disponible pronto', L.error || 'Tu rango se guarda en este navegador y sube a la tabla cuando haya conexión.'));
      return out;
    }
    const rows = L.rows.filter((x) => x.temporada === r.temporada);
    if (!rows.length) {
      out.push(emptyState('🏅', 'Nadie tiene rango todavía esta temporada', 'Juega una clasificatoria para estrenar la tabla.'));
      return out;
    }
    const table = el('table', { class: 'tabla tabla-rangos' });
    table.append(el('thead', {}, el('tr', {}, ...['#', 'Nación', 'Rango', 'PL', 'Partidas'].map((h) => el('th', { text: h })))));
    const body = el('tbody');
    rows.forEach((row, i) => {
      const rk = rankOf(row.puntos);
      body.append(
        el('tr', { class: row.id === L.myId ? 'yo' : '' },
          el('td', { class: 'num', text: String(i + 1) }),
          el('td', {}, el('button', { type: 'button', class: 'celda-nacion celda-boton', title: 'Ver su ficha', onclick: () => this.openPlayerCard(row, 'rango') }, emblemCanvas(row.emblema, 22), el('span', {}, el('strong', { text: row.nombre }), row.titulo ? el('small', { text: row.titulo }) : null))),
          el('td', {}, el('span', { class: 'celda-rango' }, badgeCanvas(row.puntos, 18), el('span', { text: rk.label, style: `color: rgb(${rk.league.color.join(',')})` }))),
          el('td', { class: 'num', text: String(rk.pl) }),
          el('td', { class: 'num', text: String(row.partidas) })),
      );
    });
    table.append(body);
    out.push(table);
    if (L.source) out.push(el('p', { class: 'nota', text: L.source }));
    return out;
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
    // Insignia del rango junto al emblema
    const chipRank = $('chip-rango');
    if (chipRank) {
      const r = p.rango;
      const show = r && (r.partidas > 0 || r.colocacion > 0);
      chipRank.hidden = !show;
      if (show) {
        let c = chipRank.querySelector('canvas');
        if (!c) {
          c = badgeCanvas(r, 18);
          chipRank.replaceChildren(c);
        } else paintBadge(c, r);
        chipRank.title = rankText(r);
      }
    }
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
    this.h.sound?.('equipar');
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

  /** Aviso breve encima de todo (para main.js). */
  flash(text, good = false) {
    this._flash(text, good);
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
    // [etiqueta, valor, formato, icono, destacada]
    const rows = [
      ['Partidas', s.partidas, int, 'bandera'],
      ['Victorias', s.victorias, int, 'copa', true],
      ['De cada 100, ganadas', s.partidas ? (100 * s.victorias) / s.partidas : 0, (n) => `${Math.round(n)} %`, 'diana'],
      ['Naciones eliminadas', s.eliminaciones, int, 'espadas'],
      ['Mayor territorio', s.mejorPct || 0, formatPercent, 'mapa', true],
      ['Victoria más rápida', s.mejorTiempo, (n) => (n == null ? '—' : formatTime(n)), 'rayo'],
      ['Tiempo jugado', s.tiempoJugado || 0, (n) => formatTime(Math.round(n)), 'reloj'],
      ['Edificios construidos', s.edificios, int, 'castillo'],
      ['Alianzas firmadas', s.alianzas, int, 'manos'],
      ['Partidas online', s.online, int, 'globo'],
    ];
    // Puesto medio y mejor puesto (de las partidas del historial que lo guardaron)
    const placed = p.historial.filter((g) => g.puesto > 0 && g.de > 1);
    if (placed.length) {
      rows.push(['Puesto medio', placed.reduce((a, g) => a + g.puesto, 0) / placed.length, (n) => `${Math.round(n)}.º`, 'podio']);
      rows.push(['Mejor puesto', Math.min(...placed.map((g) => g.puesto)), (n) => `${Math.round(n)}.º`, 'medalla']);
    }
    rows.push(['Clasificatorias', s.clasificatorias || 0, int, 'escudo']);
    rows.push(['Retos completados', (s.retosDiarios || 0) + (s.retosSemanales || 0), int, 'check']);
    rows.push(['Monedas ganadas', s.monedasGanadas || 0, int, 'moneda']);
    $('estadisticas').replaceChildren(
      ...rows.map(([k, v, fmt, ic, big]) => {
        const val = el('strong', { class: 'ef-valor', text: fmt(v) });
        if (count && typeof v === 'number' && v > 0) contar(val, v, { de: 0, ms: 800, formato: fmt });
        const icono = el('span', { class: 'ef-icono' });
        icono.innerHTML = STAT_ICONS[ic] || '';
        return el('div', { class: `est-ficha${big ? ' grande' : ''}` }, icono, val, el('small', { class: 'ef-etq', text: k }));
      }),
    );
    llenarAlVer($('perfil-resumen'));
    this.renderProfileRank();
  }

  /** Bloque «Clasificatoria» del perfil: rango, cifras y la gráfica de tus PL. */
  renderProfileRank() {
    const r = this.profile.rango;
    if (!r || !$('pc-cab')) return;
    const placing = inPlacement(r);
    const k = rankOf(r.puntos);
    $('pc-cab').replaceChildren(
      badgeCanvas(r, 40),
      el('div', { class: 'ry-textos' },
        el('strong', { text: placing ? `Colocación ${r.colocacion}/${PLACEMENT_GAMES}` : k.label, style: placing ? '' : `color: rgb(${k.league.color.join(',')})` }),
        el('span', { text: placing ? 'Sin liga todavía' : `${k.pl} PL · mejor esta temporada: ${rankOf(Math.max(r.mejor, r.puntos)).label}` })),
    );
    const hist = [...r.historial].reverse();
    const c = $('perfil-graf-pl');
    c.hidden = hist.length < 2;
    $('pc-nota').textContent = hist.length < 2 ? 'Juega clasificatorias para ver aquí cómo evolucionan tus puntos.' : `${r.victorias} victorias en ${r.partidas} partidas esta temporada${r.anteriores.length ? ` · temporada anterior: ${r.anteriores[0].liga}` : ''}.`;
    if (hist.length >= 2 && !$('perfil-resumen').hidden && this.view === 'perfil') {
      requestAnimationFrame(() => drawChart(c, [{ me: true, stroke: '#d6b8ff', points: hist.map((h, i) => [i + 1, h.puntos]) }], {
        format: (v) => String(Math.round(v)),
        xFormat: (v) => `${Math.round(v)}`,
        fitX: true,
        fitY: true,
        fillColor: 'rgba(196, 126, 255, 0.25)',
      }));
    }
  }

  // ------------------------------------------------------------ fichas

  /** Ficha pública de un jugador (de una tabla o de la sala). `kind`: 'rango', 'global' o 'sala'. */
  openPlayerCard(row, kind) {
    const emb = emblemCanvas(row.emblema || row.emblem || {}, 64);
    const head = el('div', { class: 'fj-cab' }, emb,
      el('div', { class: 'fj-textos' },
        el('strong', { class: 'fj-nombre', text: row.nombre || row.name || 'Jugador' }),
        row.titulo || row.title ? el('small', { text: row.titulo || row.title }) : null));
    const facts = [];
    if (kind === 'rango') {
      const rk = rankOf(row.puntos);
      head.append(badgeCanvas(row.puntos, 40));
      facts.push(['Rango', rk.label], ['PL', String(rk.pl)], ['Partidas', String(row.partidas)], ['Victorias', String(row.victorias)]);
      if (row.partidas) facts.push(['% de victorias', `${Math.round((100 * row.victorias) / row.partidas)} %`]);
    } else if (kind === 'global') {
      facts.push(['Nivel', String(row.nivel)], ['Victorias', String(row.victorias)], ['Partidas', String(row.partidas)], ['Mayor territorio', formatPercent(row.mejorPct)]);
    } else {
      facts.push(['Nivel', String(row.level || 1)]);
      if (row.rank) facts.push(['Rango', row.rank]);
    }
    $('dj-titulo').textContent = kind === 'sala' ? 'Jugador de la sala' : 'Ficha de jugador';
    $('dj-cuerpo').replaceChildren(head, el('dl', { class: 'estadisticas fj-datos' }, ...facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])));
    abrirDialogo($('dialogo-jugador'));
  }

  /** Ficha de una partida del historial: resultado, cifras y la curva de tu territorio. */
  openGameCard(g) {
    const win = g.resultado.startsWith('victoria');
    $('dp-titulo').textContent = `${win ? 'Victoria' : g.resultado === 'abandonada' ? 'Abandonada' : 'Derrota'} · ${mapLabel(g.mapa)}`;
    const facts = [
      ['Fecha', new Date(g.fecha).toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })],
      ['Puesto', placeText(g) || '—'],
      ['Duración', formatTime(g.duracion)],
      ['Máximo territorio', formatPercent(g.pct)],
      ['Eliminaciones', g.elim != null ? String(g.elim) : '—'],
      ['Edificios', g.edif != null ? String(g.edif) : '—'],
      ['Rivales', g.rivales ? String(g.rivales) : '—'],
      ['Tipo', `${g.clasif ? '🏅 Clasificatoria' : 'Normal'}${g.online ? ' · online' : ''}`],
    ];
    if (g.reto) facts.push(['Reto', `de ${g.reto.de}: superar el ${formatPercent(g.reto.meta / 1000)} · ${g.reto.superado ? '✓ superado' : '✗ no'}`]);
    const parts = [el('dl', { class: 'estadisticas dp-datos' }, ...facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]))];
    let chart = null;
    if (Array.isArray(g.curva) && g.curva.length > 1) {
      chart = el('canvas', { class: 'fin-grafica baja', 'aria-label': 'Tu territorio a lo largo de la partida' });
      parts.unshift(el('h3', { text: 'Tu territorio' }), chart);
    }
    $('dp-cuerpo').replaceChildren(...parts);
    abrirDialogo($('dialogo-partida'));
    if (chart) {
      const step = g.duracion / (g.curva.length - 1);
      requestAnimationFrame(() => drawChart(chart, [{ me: true, points: g.curva.map((v, i) => [i * step, v / 1000]) }], { format: (v, max) => `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: max < 0.1 ? 1 : 0 })} %` }));
    }
  }

  /** Sub-pestaña del perfil: 'resumen', 'amigos', 'clan' o 'aspecto'. */
  _profileTab(tab, anim = true) {
    if (!$(`perfil-${tab}`)) tab = 'resumen';
    this.profileTab = tab;
    for (const b of document.querySelectorAll('#perfil-pestanas [data-perfil]')) b.setAttribute('aria-selected', String(b.dataset.perfil === tab));
    rodar($('perfil-pestanas'));
    const on = $(`perfil-${tab}`);
    for (const pnl of document.querySelectorAll('#perfil-pestanas ~ .perfil-panel')) if (pnl !== on) pnl.hidden = true;
    if (anim && this.view === 'perfil') mostrar(on, { y: 8, scale: 1, ms: 220 });
    else on.hidden = false;
    underline($('perfil-pestanas'), anim);
    if (tab === 'resumen' && this.view === 'perfil') this.renderProgress(true);
    // Amigos y clan (social-ui.js) se pintan al verse
    $('perfil-pestanas').dispatchEvent(new CustomEvent('pestana', { detail: tab }));
  }

  /**
   * Chapas sociales de la tarjeta del perfil: tu clan y tus amigos (las pone
   * social-ui.js cuando llegan los datos; null sin cuenta).
   */
  setSocialSummary(sum) {
    const box = $('tp-chapas-social');
    if (!box) return;
    if (!sum) {
      box.replaceChildren();
      return;
    }
    const chips = [];
    if (sum.clan) chips.push(el('span', { class: 'tp-chapa chapa-clan', title: sum.clan.nombre }, el('b', { text: `[${sum.clan.tag}]` }), ` ${sum.clan.nombre}`));
    chips.push(el('span', { class: 'tp-chapa chapa-amigos', title: 'Amigos en línea / amigos' }, el('i', { class: sum.enLinea ? 'punto-linea' : 'punto-fuera' }), `${sum.enLinea ? `${sum.enLinea} en línea · ` : ''}${sum.amigos} ${sum.amigos === 1 ? 'amigo' : 'amigos'}`));
    box.replaceChildren(...chips);
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
          return el('li', { class: 'fila-boton', tabindex: '0', title: 'Ver la partida', onclick: () => this.openGameCard(g), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.openGameCard(g)) },
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
      ...d.retos.flatMap((id) => {
        const r = DAILY.find((x) => x.id === id);
        if (!r) return [];
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
            el('small', { text: hecho ? '¡Hecho!' : `${prog} / ${r.need}${r.perfil ? ` · solo con el perfil ${PROFILES[r.perfil]?.name || r.perfil}` : ''}` }),
          ),
          el('b', { class: 'reto-premio', text: `🪙 ${r.coins}` }),
        );
      }),
    );
    const all = d.retos.every((id) => d.hechos[id]);
    $('retos-bonus').textContent = d.bonus ? `¡Los tres hechos! Bonus de 🪙 ${DAILY_BONUS} conseguido. Mañana, más.` : `Completa los tres y ganas 🪙 ${DAILY_BONUS} más.${all ? '' : ` Llevas ${d.retos.filter((id) => d.hechos[id]).length} de 3.`}`;
    $('retos-bonus').classList.toggle('bien', !!d.bonus);
    llenarAlVer($('retos-diarios'));
    this.renderWeekly();
  }

  /** Retos de la semana: tres, más largos y mejor pagados, con su bonus. */
  renderWeekly() {
    const p = this.profile;
    const w = ensureWeekly(p);
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((8 - (now.getDay() || 7)) % 7 || 7));
    const hours = Math.max(1, Math.round((monday - now) / 3600000));
    $('semana-reloj').textContent = `cambian en ${Math.floor(hours / 24)} d ${hours % 24} h`;
    $('retos-semanales').replaceChildren(
      ...w.retos.flatMap((id) => {
        const r = WEEKLY.find((x) => x.id === id);
        if (!r) return [];
        const prog = Math.min(r.need, w.progreso[id] || 0);
        const hecho = !!w.hechos[id];
        return el(
          'li',
          { class: hecho ? 'hecho' : '' },
          el('span', { class: 'reto-icono', 'aria-hidden': 'true', text: r.icon }),
          el('div', { class: 'reto-texto' },
            el('strong', { text: r.name }),
            el('span', { class: 'reto-barra llena-al-ver' }, el('span', { style: `--p:${(prog / r.need).toFixed(3)}` })),
            el('small', { text: hecho ? '¡Hecho!' : `${prog} / ${r.need}` })),
          el('b', { class: 'reto-premio', text: `🪙 ${r.coins}` }),
        );
      }),
    );
    const done = w.retos.filter((id) => w.hechos[id]).length;
    $('semana-bonus').textContent = w.bonus ? `¡Los tres de la semana! Bonus de 🪙 ${WEEKLY_BONUS} conseguido.` : `Completa los tres y ganas 🪙 ${WEEKLY_BONUS} más. Llevas ${done} de 3.`;
    $('semana-bonus').classList.toggle('bien', !!w.bonus);
    llenarAlVer($('retos-semanales'));
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
    if (this.table === 'rangos') {
      box.replaceChildren(...this._ranksTable());
      if (anim) this.h.onLadderRefresh?.();
    }
    else if (this.table === 'global') box.replaceChildren(...this._globalTable());
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
            el('button', { type: 'button', class: 'celda-nacion celda-boton', title: 'Ver su ficha', onclick: () => this.openPlayerCard(r, 'global') }, emblemCanvas(r.emblema, 22), el('span', {}, el('strong', { text: r.nombre }), r.titulo ? el('small', { text: r.titulo }) : null)),
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
          { class: 'fila-boton', tabindex: '0', title: 'Ver la partida', onclick: () => this.openGameCard(g), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.openGameCard(g)) },
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
    if (this.view === 'competitivo') this.renderQueue();
  }

  setRooms(rooms) {
    this.rooms = rooms;
    this.renderRooms();
    if (this.view === 'competitivo') this.renderQueue();
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
              el('small', { text: `${r.clasificatoria ? '🏅 Clasificatoria · ' : ''}${mapLabel(r.mapa)} · ${P.name} · ${VICTORY_NAMES[r.victoria] || 'Dominación'}` }),
              el('small', { text: `${Math.max(0, (r.plazas || 8) - (r.jugadores || 1))} plaza${(r.plazas || 8) - (r.jugadores || 1) === 1 ? '' : 's'} libre${(r.plazas || 8) - (r.jugadores || 1) === 1 ? '' : 's'} · ${r.jugadores || 1}/${r.plazas || 8} · ${Number(r.bots) || 0} ${Number(r.bots) === 1 ? 'nación de la IA' : 'naciones de la IA'}` }),
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

  /** Ajustes fijos de una sala clasificatoria. */
  _rankedSettings() {
    return { bots: RANKED_ROOM.bots, mapSize: RANKED_ROOM.mapSize, difficulty: RANKED_ROOM.difficulty, rules: { ...DEFAULT_RULES, profile: RANKED_ROOM.profile }, clasificatoria: true };
  }

  /** Chips del resumen: perfil, bots y modo de victoria. */
  _chips(box, settings) {
    const s = settings || {};
    const r = s.rules || {};
    const P = PROFILES[r.profile] || PROFILES.trinchera;
    // (replaceChildren escribe «null» si le llega un null: solo los que existen, DEV08)
    const nBots = Number(s.bots) || 0;
    const nCol = Number.isFinite(r.colonies) ? r.colonies : null;
    box.replaceChildren(
      ...[
        s.clasificatoria ? el('span', { class: 'chip-sala chip-clasif' }, el('span', { class: 'chip-ico', 'aria-hidden': 'true', text: '🏅' }), 'Clasificatoria') : null,
        el('span', { class: 'chip-sala', title: `Perfil de reglas ${P.id}` }, el('span', { class: 'chip-ico', 'aria-hidden': 'true', text: '⚙' }), P.name),
        el('span', { class: 'chip-sala', title: 'Naciones que lleva la IA' }, el('span', { class: 'chip-ico', 'aria-hidden': 'true', text: '🤖' }), `${nBots} ${nBots === 1 ? 'nación de la IA' : 'naciones de la IA'}`),
        nCol !== null ? el('span', { class: 'chip-sala', title: 'Colonias: presas débiles repartidas por el mapa' }, el('span', { class: 'chip-ico', 'aria-hidden': 'true', text: '⌂' }), `${nCol} ${nCol === 1 ? 'colonia' : 'colonias'}`) : null,
        el('span', { class: 'chip-sala' }, el('span', { class: 'chip-ico', 'aria-hidden': 'true', text: '⚑' }), VICTORY_NAMES[r.victory] || 'Dominación'),
        r.coop ? el('span', { class: 'chip-sala' }, el('span', { class: 'chip-ico', 'aria-hidden': 'true', text: '🤝' }), r.coopRoles ? 'Cooperativo con roles' : 'Cooperativo') : null,
      ].filter(Boolean),
    );
  }

  // --------------------------------------------------------- crear sala

  /** Pantalla «Crear sala»: mapa y quién entra; las reglas, en «Reglas avanzadas». */
  showCreate({ ranked = false } = {}) {
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
    this.create.ranked = ranked;
    // Sala clasificatoria: mapa y reglas fijos
    $('crear-h1').textContent = ranked ? 'Crear sala clasificatoria' : 'Crear sala';
    $('crear-clasif').hidden = !ranked;
    $('crear-mapas').hidden = ranked;
    $('crear-avanzadas').hidden = ranked;
    $('inicio').hidden = true;
    if ($('crear-sala').hidden) {
      $('crear-sala').hidden = false;
      this._slideIn($('crear-sala'), 1);
    }
    $('crear-nombre').value = this.create.name;
    $('crear-error').textContent = '';
    this._busyCreate(false);
    this._renderCreate();
    this.pushLayer('crear-sala', 'multijugador/crear-sala');
  }

  /** «Atrás» en Crear sala: vuelve a la página de la que vino (Multijugador o Competitivo). */
  hideCreate() {
    const below = history.state?.capa === 'crear-sala' && history.state.n > 0;
    if (below) {
      history.back(); // el historial la cierra (ver _onPop)
      return;
    }
    this.closeLayer('crear-sala');
    this._closeCreate();
    if (!PAGES.has(this.view)) this.go('multijugador');
  }

  _closeCreate() {
    if ($('crear-sala').hidden) return;
    $('crear-sala').hidden = true;
    $('inicio').hidden = false;
    this._slideIn($('inicio'), -1);
  }

  _renderCreate() {
    const c = this.create;
    // Mapas: el grande y una tira con todos
    const shownMap = c.ranked ? RANKED_ROOM.mapSize : c.map;
    this._paintMapInto($('crear-mapa-img'), shownMap);
    $('crear-mapa-nombre').textContent = mapLabel(shownMap);
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
    this._chips($('crear-resumen'), c.ranked ? this._rankedSettings() : { bots: c.bots, rules: c.rules });
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
    // Las reglas elegidas pasan a ser las del jugador (las de una clasificatoria son fijas)
    if (!c.ranked) {
      Object.assign(this.profile.ajustes, { mapa: c.map, dificultad: c.difficulty, reglas: { ...c.rules } });
      this.h.onProfileChange?.(false);
    }
    try {
      await this.h.onCreateRoom?.({
        settings: c.ranked ? this._rankedSettings() : { bots: c.bots, mapSize: c.map, difficulty: c.difficulty, rules: { ...c.rules } },
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
    this.pushLayer('sala');
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
    const claims = sala.rankClaims ? sala.rankClaims() : new Map();
    const rows = st.players.map((p) => {
      const claim = claims.get(p.peer);
      const card = () => this.openPlayerCard({ ...p, rank: claim && Number.isFinite(claim.puntos) ? rankOf(claim.puntos).label : '' }, 'sala');
      const tag = p.host ? ['Anfitrión', 'anfitrion'] : !p.versionOk ? ['Otra versión', 'error'] : p.stale ? ['Reconectando…', 'aviso'] : p.ready ? ['Listo', 'listo'] : ['Preparando', 'preparando'];
      const fresh = seen && !seen.has(p.peer);
      const pop = wasReady && p.ready && !wasReady.has(p.peer);
      return el(
        'li',
        { class: `${p.isMe ? 'yo' : ''}${p.stale ? ' desconectado' : ''}${fresh ? ' entra' : ''}${pop ? ' pop' : ''} fila-boton`, tabindex: '0', title: 'Ver su ficha', onclick: card, onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), card()) },
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
    if (s.clasificatoria) {
      // Clasificatoria: solo nombre, visibilidad y plazas
      box.replaceChildren(
        el('p', { class: 'nota', text: 'Sala clasificatoria: el mapa, las naciones de la IA y las reglas son fijos.' }),
        el('label', { class: 'campo' }, el('span', { text: 'Nombre de la sala' }), name),
        el('div', { class: 'fila-2' }, el('div', { class: 'campo' }, el('span', { text: 'Visibilidad' }), vis), el('div', { class: 'campo' }, el('span', { text: 'Plazas' }), seats)),
      );
      return;
    }
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
        this.h.sound?.('cuenta');
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
