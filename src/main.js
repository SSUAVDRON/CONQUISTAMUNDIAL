// Punto de entrada: inicio, partidas (contra la IA y online), bucle, perfil y
// nube. La simulación vive en game.js; aquí solo se orquesta.
import { BUILDINGS, BUILDING_KINDS, CONFIG, DEFAULT_RULES, MAP_SIZES, REAL_MAPS, RES, TICK_MS, colonyCount, mapLabel, migrateRules } from './config.js';
import { generateMap, loadRealMap } from './map.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Home } from './home.js';
import { hexToRgb } from './colors.js';
import { installFlagSprite, loadFlags } from './icons.js';
import { hashString } from './rng.js';
import { fmtTroops, formatNumber, formatPercent, formatTime } from './format.js';

import { grantAchievement, levelInfo, loadProfile, mergeProfiles, recordGame, saveProfile, titleName, nameColorOf } from './profile.js';
import { bootLoader, withLoading } from './loading.js';
import { loadMapData } from './mapas-carga.js';
import { paintMapPreview, paintTerrain } from './terreno.js';
import { Account } from './cuenta.js';
import { AccountUI } from './cuenta-ui.js';
import { Social } from './social.js';
import { SocialUI } from './social-ui.js';
import { Tutorial } from './tutorial.js';
import { getCloud, pullProfile, pushLeaderboard, pushProfile, watchLeaderboard } from './cloud.js';
import { connectTransport } from './net.js';
import { NetSync, RULES_FINGERPRINT, Sala, cleanRoomInfo, newRoomCode, normalizeCode, openRooms, roomName, roomRuleset } from './multiplayer.js';
import { MECH_VERSION, PROFILES, startOffsets } from './mecanicas.js';
import { Diagnostico } from './diagnostico.js';

/** ?diag=1: diagnóstico local de la partida (src/diagnostico.js). */
const DIAG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('diag') === '1';
import { Sound } from './sonido.js';
import { Minimap } from './minimapa.js';
import { abrirDialogo, cerrarDialogo, hayDialogo, ondasAlPulsar } from './movimiento.js';
import { TAP_RADIUS_MAX, TAP_RADIUS_PX, nearestTileOf, resolveTap } from './toque.js';
import { installGlobalHandlers, reportError, setErrorContext, setErrorNotifier } from './errores.js';
import { abrirGuia } from './guia.js';
import { Grabador, compactCurve, placement } from './resumen.js';
import { Ladder } from './ladder.js';
import { claimText, getIdentity, signClaim, verifiedRank } from './identidad.js';
import { challengeBeaten, challengeLink, parseChallenge } from './reto.js';
import { RANKED_AI, RANKED_ROOM, aiDifficultyFor, alreadyApplied, applyAiResult, applyRoomResult, badgeCanvas, ensureSeason, inPlacement, rankOf, seasonName, voidResult } from './rangos.js';
import { presentMatch } from './presentacion.js';
import { configSnapshot } from './repeticion.js';
import { INVITE_MS, Matchmaker } from './emparejamiento.js';

const canvas = document.getElementById('lienzo');
const camera = new Camera();
const ui = new UI();
const profile = loadProfile();
let cloud = null;
let transport = null;

const state = {
  game: null,
  renderer: null,
  human: null,
  demo: true, // partida de fondo entre bots mientras se ve el inicio
  online: false,
  sala: null,
  net: null,
  mapSize: 'mediano',
  speed: 1,
  ratio: 0.2,
  acc: 0,
  last: performance.now(),
  lastHud: 0,
  hover: { tile: -1, x: 0, y: 0 },
  buildMode: null,
  endShown: false,
  defeatShown: false,
  recorded: false,
};

/**
 * Resolución adaptable del lienzo: en pantallas de alta densidad se dibuja a
 * menos píxeles si el equipo no llega a ~40 fps (y se vuelve a subir si va
 * sobrado). Los paneles (HTML) siguen nítidos; solo cambia el mapa.
 */
const quality = { level: 0, slowMs: 0, fastMs: 0, ema: 16.7, drops: 0 };
// Pantalla táctil como puntero principal (móvil o tableta): el lienzo empieza
// a 1,5× como mucho (en pantallas de 2,5-3× apenas se nota en el mapa y cuesta
// el triple de píxeles), baja antes si va justo y no hay tooltip que calcular
const TOUCH = !!window.matchMedia?.('(pointer: coarse)').matches;
function dprSteps() {
  const native = Math.min(TOUCH ? 1.5 : 2, window.devicePixelRatio || 1);
  return [...new Set([native, 1.5, 1.25, 1].filter((d) => d <= native))];
}
function currentDpr() {
  const steps = dprSteps();
  return steps[Math.min(quality.level, steps.length - 1)];
}
function adaptQuality(dt) {
  if (dt > 200 || state.demo || !state.game) return; // pestaña oculta o menú
  quality.ema += (dt - quality.ema) * 0.05;
  const steps = dprSteps();
  if (quality.ema > 25 && quality.level < steps.length - 1) {
    quality.slowMs += dt;
    if (quality.slowMs > (TOUCH ? 1200 : 2500)) {
      quality.level++;
      quality.drops++;
      quality.slowMs = quality.fastMs = 0;
      resize();
    }
  } else quality.slowMs = 0;
  // Subir otra vez solo si va muy holgado un buen rato (y no tras dos bajadas)
  if (quality.ema < 17.5 && quality.level > 0 && quality.drops < 2) {
    quality.fastMs += dt;
    if (quality.fastMs > 20000) {
      quality.level--;
      quality.fastMs = 0;
      resize();
    }
  } else quality.fastMs = 0;
}

function resize() {
  const dpr = currentDpr();
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  // El tamaño en pantalla, el mismo que el de la cámara: con 100vh, en el
  // móvil (con la barra del navegador) el mapa se veía estirado y los toques
  // caían más abajo de donde se veían
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  camera.setView(w, h);
  state.renderer?.setDpr(dpr);
}
window.addEventListener('resize', resize);
// Al volver a la pestaña (o de otra app en el móvil): ¿se perdió el
// contenido de los lienzos? En el móvil, el territorio se vuelve a subir
// entero (sus píxeles siguen en memoria; es barato)
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.renderer) return;
  state.renderer.checkCanvases();
  if (TOUCH) state.renderer.refreshTerritory();
});
window.visualViewport?.addEventListener('resize', () => {
  if (canvas.width !== Math.round(window.innerWidth * currentDpr()) || canvas.height !== Math.round(window.innerHeight * currentDpr())) resize();
});
resize();

function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Lo que este jugador muestra a los demás (nombre, color, emblema…). */
/** Etiqueta fija de esta página para jugar en sala sin nombre propio («Recluta 4821»). */
const RECRUIT_TAG = String(1000 + Math.floor(Math.random() * 9000));

function myIdentity() {
  return {
    name: profile.nombre || 'Mi nación',
    color: profile.color,
    emblem: { ...profile.emblema },
    pattern: profile.patron,
    level: levelInfo(profile.xp).level,
    title: titleName(profile),
    frame: profile.marco || 'ninguno',
    banner: profile.estandarte || 'noche',
    nameColor: profile.colorNombre || '',
  };
}

// ------------------------------------------------------------- partidas

/**
 * Crea una partida. `humans`: identidades en orden (ids 1..n); `localIndex`:
 * cuál es este navegador (-1 = nadie, como en la demo del inicio).
 */
function loadMap(mapSize, seed) {
  if (REAL_MAPS[mapSize]) return loadRealMap(mapSize); // los bots serán países reales
  const size = MAP_SIZES[mapSize] || MAP_SIZES.mediano;
  return { map: generateMap(size.w, size.h, seed), countries: null };
}

/**
 * Suelta la partida que hubiera (la de fondo del menú o la anterior) antes
 * de crear otra: si no, durante un momento convivían dos o tres partidas del
 * mundo en memoria, y en el móvil el navegador acababa descartando lienzos
 * (el mapa en negro) o cerrando la pestaña.
 */
function releaseGame() {
  if (state.game) state.game.onEvent = null;
  try {
    state.renderer?.dispose();
  } catch (err) {
    reportError(err, 'liberar la partida');
  }
  state.renderer = null;
  state.game = null;
  state.human = null;
  state.rec = null;
  state.diag = null;
  state.ping = null;
  minimap.release();
  ui.releaseGame();
  sound.releaseGame();
}

function newGame({ seed, mapSize, bots, difficulty, humans, localIndex, rules = DEFAULT_RULES, loaded = null }) {
  releaseGame();
  const { map, countries } = loaded || loadMap(mapSize, seed);
  const game = new Game({ map, seed, rules });
  const used = new Set();
  // Cooperativo: cada dos jugadores (en el orden de la sala) llevan una nación
  const groups = coopGroups(humans.length, game.rules.coop);
  const players = groups.map((members) => {
    const h = humans[members[0]];
    const base = members.map((i) => humans[i].name).join(' y ');
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    used.add(name.toLowerCase());
    const p = game.addPlayer(name, hexToRgb(h.color), true);
    p.emblem = h.emblem;
    p.pattern = h.pattern;
    // Bandera de un país elegida como emblema: también junto a su nombre y en la clasificación
    p.flag = (h.emblem && h.emblem.flag) || '';
    // Nivel del jugador (se ve junto a su nombre en la clasificación de la partida)
    p.level = Math.max(...members.map((i) => Number(humans[i].level) || 0));
    return p;
  });
  const myGroup = localIndex >= 0 ? groups.findIndex((g) => g.includes(localIndex)) : -1;
  game.human = myGroup >= 0 ? players[myGroup] : null;
  // Compañero y rol (si la sala reparte roles: el primero, mando militar)
  state.coop = null;
  if (myGroup >= 0 && groups[myGroup].length > 1) {
    const members = groups[myGroup];
    const partner = members.find((i) => i !== localIndex);
    state.coop = {
      mySlot: localIndex,
      partnerSlot: partner,
      partnerName: humans[partner].name,
      names: Object.fromEntries(members.map((i) => [i, humans[i].name])),
      role: game.rules.coopRoles ? (members[0] === localIndex ? 'militar' : 'economia') : null,
    };
  }
  game.addBots(bots, difficulty, countries);
  // Colonias: muchas presas fáciles repartidas por el mapa
  // Las reglas pueden fijar cuántas colonias; si no, según la tierra del mapa
  game.addColonies(game.rules.colonies ?? colonyCount(map.landCount, bots));
  game.start();
  // Instantánea de la configuración (DEV01): para repetirla tal cual desde el historial
  state.config = configSnapshot({
    mode: humans.length > 1 ? 'online' : 'ia',
    mapSize,
    nations: game.players.filter((p) => p && !p.isHuman && !p.weak).length,
    colonies: game.players.filter((p) => p && p.weak).length,
    difficulty,
    rules: game.rules,
    seed,
  });

  state.game = game;
  state.human = game.human;
  state.mapSize = mapSize;
  // Diagnóstico local: ?diag=1 registra la partida (exportar con Ctrl+Mayús+D o __trinchera.diag.exportar())
  state.diag = DIAG ? new Diagnostico(game, { build: RULES_FINGERPRINT, mechVersion: MECH_VERSION, ruleset: roomRuleset(game.rules) }) : null;
  state.renderer = new Renderer(canvas, game, camera);
  // Si el navegador descartó los lienzos y el mapa se ha rehecho, también el
  // minimapa y los iconos del panel (que se dibujan una sola vez)
  state.renderer.onRestored = () => {
    if (minimap.game === game) minimap.restore();
    ui.repaintIcons();
  };
  // La misma densidad con la que se creó el lienzo (en móviles de 2,5-3× no es
  // la del dispositivo): si no, el mapa salía desplazado y los toques no
  // caían donde se veía
  state.renderer.setDpr(currentDpr());
  applySettings();
  state.acc = 0;
  state.buildMode = null;
  state.endShown = false;
  state.defeatShown = false;
  state.recorded = false;
  camera.fit(map.width, map.height);
  return game;
}

/**
 * Partida de fondo del menú. `background`: solo se cambia la partida de
 * fondo (al arrancar o cuando termina la anterior), sin salir de la sala ni
 * tapar la ficha de una invitación o la sala que estén a la vista.
 */
function startDemo({ background = false } = {}) {
  state.holdSim = false;
  if (!background) {
    leaveOnline();
    // Fuera de la partida: se vuelve a la página desde la que se empezó (Competitivo, Crear partida…)
    home.closeLayer('partida');
  }
  state.demo = true;
  newGame({ seed: randomSeed(), mapSize: 'mundo', bots: 30, difficulty: 'normal', humans: [], localIndex: -1 });
  // La partida de fondo del menú va a velocidad normal (gasta menos)
  state.speed = 1;
  ui.hideHud();
  ui.closeNation();
  if (state.sala || state.pendingEntry) {
    home.renderAll(); // el inicio, listo para cuando se vuelva
    return;
  }
  if (background && home.menuVisible()) return;
  home.show();
}

// Minimapa abajo a la izquierda (oculto en el menú y en la partida de fondo)
const minimap = new Minimap(document.getElementById('minimapa-lienzo'), (wx, wy, first) => {
  if (first) camera.flyTo(wx, wy, camera.zoom, 380);
  else camera.centerOn(wx, wy);
});
const minimapBox = document.getElementById('minimapa');
// Su altura, para que la clasificación (arriba a la izquierda) no la pise
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--mm-alto', `${Math.round(minimapBox.offsetHeight)}px`);
  }).observe(minimapBox);
}
function setMinimapFolded(folded) {
  const box = document.getElementById('minimapa');
  box.classList.toggle('plegado', folded);
  document.getElementById('minimapa-plegar').setAttribute('aria-label', folded ? 'Mostrar el minimapa' : 'Ocultar el minimapa');
}
document.getElementById('minimapa-plegar').addEventListener('click', () => {
  const folded = !document.getElementById('minimapa').classList.contains('plegado');
  setMinimapFolded(folded);
  profile.ajustes.minimapa = !folded;
  saveProfile(profile);
});

function enterGame(game) {
  const small = TOUCH || window.innerWidth <= 720 || window.innerHeight <= 500;
  // En el ordenador, del ancho del panel de la izquierda (va justo encima)
  const desk = document.getElementById('hud').classList.contains('escritorio');
  minimap.setMaxSize(small ? 132 : desk ? 300 : 220, small ? 96 : desk ? 140 : 170);
  minimap.setGame(game, state.renderer, camera);
  setMinimapFolded(profile.ajustes.minimapa === false);
  state.demo = false;
  socialUI.hideToast(); // una invitación no saca a nadie de su partida
  // La simulación arranca ahora (ni durante la carga ni durante la presentación)
  state.holdSim = false;
  state.acc = 0;
  // La partida tiene su entrada en el historial: el botón atrás abre su menú en vez de sacarte
  home.pushLayer('partida');
  // Resumen de partida: graba cómo va (sin tocar la simulación)
  state.rec = game.human ? new Grabador(game, game.human) : null;
  // Se llama en mitad del turno: un fallo de la interfaz no debe dejar el
  // turno a medias (ni desincronizar una sala)
  game.onEvent = (evt) => {
    try {
      if (state.rec && state.rec.game === game) state.rec.onEvent(evt);
      if (!state.demo) sound.onEvent(evt);
      // Botín al eliminar a alguien: monedas que vuelan del mapa a tu oro
      if (evt.loot && !state.demo && evt.tick >= game.ticks - 2 && state.renderer?.anim) {
        const [sx, sy] = camera.worldToScreen(evt.x, evt.y);
        ui.flyCoins(sx, sy, evt.weak);
        setTimeout(() => sound.play('coins', 0.9, 0), 850);
      }
      if (evt.kind === 'request') ui.addRequest(game, evt);
      else ui.pushEvent(evt);
    } catch (err) {
      reportError(err, 'avisos de la partida');
    }
  };
  for (const evt of game.eventLog) game.onEvent(evt);
  state.speed = 1; // la partida va siempre a velocidad normal
  ui.setRatio(state.ratio);
  ui.setNetNote('');
  home.hide();
  home.hideLobby();
  ui.showHud();
}

/** Partida contra la IA, con su pantalla de carga. */
async function startGame(opts) {
  if (state.loading) return;
  state.loading = true;
  // Para la revancha: la misma partida con otra semilla (el tutorial no; un reto, sin el reto)
  state.lastOpts = opts.tutorial ? null : { ...opts, seed: '', seedNum: undefined, challenge: undefined, title: opts.challenge ? undefined : opts.title };
  state.challenge = opts.challenge || null;
  // Clasificatoria: queda «pendiente» hasta que se aplique su resultado
  state.ranked = opts.ranked || null;
  state.rankedDone = false;
  state.rankOut = null;
  if (state.mm) stopMatchmaking();
  state.match = null;
  leaveOnline();
  tutorial.stop();
  const seed = Number.isFinite(opts.seedNum) ? opts.seedNum >>> 0 : opts.seed ? hashString(opts.seed) : randomSeed();
  state.lastSeed = opts.tutorial ? null : seed;
  state.holdSim = true;
  try {
    const game = await withLoading(opts.title || mapLabel(opts.mapSize), [
      { label: 'Levantando el relieve…', run: () => loadMap(opts.mapSize, seed) },
      {
        label: 'Desplegando naciones…',
        run: (loaded) =>
          newGame({ seed, mapSize: opts.mapSize, bots: opts.bots, difficulty: opts.difficulty, rules: opts.rules, humans: [myIdentity()], localIndex: 0, loaded }),
      },
      { label: 'Cavando trincheras…', run: (game) => game },
    ]);
    // Qué partida es (para repetirla desde el historial)
    if (state.config) state.config.modo = opts.tutorial ? 'tutorial' : opts.ranked ? 'clasificatoria' : opts.challenge ? 'reto' : 'ia';
    // Antes de empezar: tu tarjeta frente a la IA y las naciones en juego (el tutorial va directo)
    if (!opts.tutorial) await presentMatch(soloPresentation(game, opts));
    if (state.game !== game) return;
    enterGame(game);
    if (opts.tutorial) tutorial.start(tutorialState());
  } finally {
    state.loading = false;
  }
}

const DIFF_NAMES = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil', imposible: 'Imposible' };
/** «1 nación» / «3 naciones». */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Tu tarjeta para la presentación (con tu rango si es clasificatoria). */
function myCard(ranked) {
  const r = queueRank(ranked);
  return { ...myIdentity(), nameColor: nameColorOf(profile), me: true, rank: ranked ? { points: r.puntos, placing: inPlacement(r) } : null };
}

/** Rango de una cola (DEV07): 'sala' u 'online', el de en línea; si no, el de contra la IA. */
function queueRank(cola) {
  return cola === 'sala' || cola === 'online' ? profile.rangoOnline : profile.rango;
}

/** Las naciones de la partida (sin humanos ni colonias), con su bandera si es un mapa real. */
function nationsOf(game) {
  return game.players.filter((p) => p && !p.isHuman && !p.weak).map((p) => ({ name: p.name, color: `rgb(${p.color.join(',')})`, flag: p.flag || '' }));
}

/** Presentación de una partida contra la IA (o clasificatoria contra la IA). */
function soloPresentation(game, opts) {
  const nations = nationsOf(game);
  const dif = DIFF_NAMES[opts.difficulty] || 'Normal';
  const prof = PROFILES[game.rules.profile]?.name || 'Clásico';
  const colonies = game.players.filter((p) => p && p.weak).length;
  const ranked = !!opts.ranked;
  return {
    kicker: ranked ? `Clasificatoria · ${seasonName(profile.rango.temporada)}` : opts.challenge ? 'Reto' : 'Partida contra la IA',
    title: opts.title && !ranked ? opts.title : mapLabel(opts.mapSize),
    details: `${plural(nations.length, 'nación', 'naciones')} · ${plural(colonies, 'colonia', 'colonias')} · perfil ${prof} · IA ${dif}`,
    players: [myCard(ranked)],
    ai: { name: 'La IA', title: `Ejércitos de ${nations.length} ${nations.length === 1 ? 'nación' : 'naciones'}`, note: `Dificultad ${dif}`, color: '#b5402f', emblem: { shape: 'escudo', symbol: 'espadas', bg: '#3a1418', fg: '#f2b33d', flag: '' }, frame: ranked ? 'oro' : 'bronce', banner: 'volcan' },
    nations,
    ranked,
    sound,
  };
}

function tutorialState() {
  return { game: state.game, human: state.human, ratio: state.ratio };
}

const tutorial = new Tutorial({
  // El despliegue del tutorial: empezar ya (sin esperar la cuenta atrás) y «Elegir por mí»
  onStartNow: () => {
    if (!state.net && state.game && state.game.phase === 'spawn') state.game.skipSpawn();
  },
  onAuto: () => document.getElementById('aviso-auto')?.click(),
  onFinish() {
    profile.tutorial = true;
    const ach = grantAchievement(profile, 'recluta');
    if (ach) ui.pushEvent({ text: `${ach.icon} Logro: ${ach.name}`, kind: 'good' });
    scheduleCloudSync();
  },
});

/** Ajustes del jugador que afectan a la partida (render e interfaz). */
// Sonido: arranca con el primer gesto (los navegadores no dejan sonar antes)
const sound = new Sound();
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => sound.unlock(), true);
// Sonidos del interfaz: pestañas (pergamino), modos de juego (tambor y laúd)
// y madera en cualquier otro botón
document.addEventListener('click', (e) => {
  const el = e.target instanceof Element ? e.target.closest('button') : null;
  if (!el || el.disabled) return;
  if (el.matches('[role="tab"], .sub-pestanas button, [data-volver], [data-pagina]')) sound.play('pagina', 0.8, 60);
  else if (el.matches('.modo')) sound.play('elegir', 0.8, 120);
  else sound.play('click', 0.6, 40);
});
// Al pasar el ratón por los elementos principales del menú, un roce muy suave
let hovered = null;
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse' || !(e.target instanceof Element)) return;
  const el = e.target.closest('.modo, [role="tab"], button.principal, .sub-pestanas button');
  if (el === hovered) return;
  hovered = el;
  if (el && !el.disabled) sound.play('hover', 1, 50);
});
// Interruptores de ajustes: pestillo que se abre o se cierra
document.addEventListener('change', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'checkbox') sound.play(e.target.checked ? 'interruptorOn' : 'interruptorOff', 0.9, 40);
});
// Diálogos que se despliegan y se recogen
document.addEventListener('dialogo', (e) => sound.play(e.detail === 'abrir' ? 'abrir' : 'cerrar', 0.8, 80));

/** Botón de la barra superior (y tecla N): silencia o activa todo el sonido. */
function toggleMute() {
  profile.ajustes.silencio = !profile.ajustes.silencio;
  saveProfile(profile);
  applySettings();
}
document.getElementById('btn-sonido')?.addEventListener('click', toggleMute);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement) && state.game && !state.demo) toggleMute();
  // X: guardar tropas en la capital; Mayús+X: sacarlas
  if (e.code === 'KeyX' && !e.ctrlKey && !e.metaKey && !e.repeat && !(e.target instanceof HTMLInputElement) && state.game && !state.demo) bankTroops(e.shiftKey ? 'out' : 'in');
});

function applySettings() {
  const a = profile.ajustes;
  sound.setOptions({
    music: a.musica !== false,
    sfx: a.efectos !== false,
    musicVol: a.volMusica ?? 0.5,
    sfxVol: a.volEfectos ?? 0.8,
    muted: !!a.silencio,
  });
  const muteBtn = document.getElementById('btn-sonido');
  if (muteBtn) {
    muteBtn.setAttribute('aria-pressed', String(!!a.silencio));
    muteBtn.classList.toggle('silencio', !!a.silencio);
  }
  state.pointerOn = a.puntero !== false;
  if (state.renderer) {
    // Modo ligero en pantallas táctiles: sin viñeta y nombres recolocados con menos frecuencia
    state.renderer.lite = TOUCH;
    state.renderer.coop = state.coop;
    state.renderer.options = {
      badges: a.marcadores !== false,
      emojis: a.emojis !== false,
      pointer: state.pointerOn,
      animations: a.animaciones !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches,
      nameColor: nameColorOf(profile),
    };
  }
  document.documentElement.style.setProperty('--color-nombre', nameColorOf(profile));
  ui.redAlert = a.alerta !== false;
  ui.tips = a.consejos !== false;
  ui.coop = state.coop;
  document.body.classList.toggle('sin-animaciones', a.animaciones === false);
}

// --------------------------------------------------------- multijugador

function leaveOnline() {
  clearInterval(state.rematchWatch);
  const net = state.net;
  const sala = state.sala;
  // El anfitrión deja una partida en curso: avisa a todos (interrupción
  // explícita, no un corte) y sale un momento después, para que llegue el aviso
  const hostAbandon = !!(net && net.isHost && state.game && !state.demo && state.game.phase !== 'ended');
  if (hostAbandon) net.announceLeave('abandono');
  if (net) net.stop();
  if (state.oldNet) state.oldNet.stop();
  state.oldNet = null;
  state.net = null;
  if (sala) {
    if (hostAbandon) setTimeout(() => sala.leave(), 400);
    else sala.leave();
  }
  state.sala = null;
  state.online = false;
}

/**
 * Botones de la pantalla final en línea (DEV05): solo lo que se puede hacer.
 * `ended`: la ronda ha terminado (si no, te han derrotado y sigue para el resto).
 */
function onlineEndActions(ended) {
  if (!state.online) return {};
  const sala = state.sala;
  const host = !!(sala && sala.isHost);
  if (!ended) return { nueva: { hidden: true }, menu: { label: host ? 'Salir (se interrumpe para todos)' : 'Salir a Multijugador' } };
  if (state.ranked || !sala) return { nueva: { hidden: true }, menu: { label: 'Volver a Multijugador' } };
  if (host) return { nueva: { label: 'Abrir revancha', title: 'Vuelve al vestíbulo con el mismo código, mapa y reglas; la próxima ronda tiene semilla nueva' }, menu: { label: 'Salir a Multijugador' } };
  const open = sala.rematchOpen();
  return { nueva: { label: open ? 'Unirse a la revancha' : 'Esperando la revancha…', disabled: !open, title: open ? '' : 'Cuando el anfitrión la abra, podrás unirte' }, menu: { label: 'Salir a Multijugador' } };
}

/** Invitado con la pantalla final abierta: el botón se activa cuando el anfitrión abre la revancha. */
function watchRematch() {
  clearInterval(state.rematchWatch);
  if (!state.online || !state.sala || state.sala.isHost || state.ranked) return;
  const sala = state.sala;
  state.rematchWatch = setInterval(() => {
    if (state.sala !== sala || !state.online) clearInterval(state.rematchWatch);
    else ui.setEndActions(onlineEndActions(true));
  }, 700);
}

/** De la pantalla final al vestíbulo de la misma sala (revancha). */
function backToRoom() {
  clearInterval(state.rematchWatch);
  finishGame();
  ui.hideEnd();
  tutorial.stop();
  const net = state.net;
  if (net && net.isHost) {
    // Un invitado rezagado aún puede pedir los últimos turnos de esta ronda: se atienden un minuto
    if (state.oldNet) state.oldNet.stop();
    state.oldNet = net;
    setTimeout(() => {
      net.stop();
      if (state.oldNet === net) state.oldNet = null;
    }, 60000);
  } else if (net) net.stop();
  state.net = null;
  state.online = false;
  state.ranked = null;
  startDemo({ background: true });
  home.showLobby();
}

/** Anfitrión: abre la revancha en el mismo vestíbulo (DEV05). */
function openRematch() {
  const sala = state.sala;
  if (!sala || !sala.isHost) return;
  backToRoom();
  sala.reopen();
}

/** Invitado: vuelve a la sala para la revancha (hay que confirmar «Estoy listo» otra vez). */
function joinRematch() {
  const sala = state.sala;
  if (!sala || sala.isHost || !sala.rematchOpen()) return;
  backToRoom();
  sala.rejoin();
}

/** Ajustes de partida por defecto para una sala (los del jugador). */
function defaultRoomSettings() {
  // La configuración de las salas, aparte de la de la IA (DEV10)
  const c = profile.ajustes.online;
  return {
    bots: Math.min(60, c.bots),
    mapSize: c.mapa,
    difficulty: c.dificultad,
    rules: { ...DEFAULT_RULES, ...migrateRules(c.reglas) },
  };
}

// ------------------------------------------------------- emparejamiento

/** «Buscar partida» en línea: entra en la cola (o sale, si ya estaba). */
function toggleMatchmaking() {
  if (state.mm) {
    stopMatchmaking();
    return;
  }
  if (!transport) {
    home.flash?.('Sin conexión con el servidor de salas.');
    return;
  }
  const r = profile.rangoOnline;
  const reward = ensureSeason(r);
  if (reward) grantSeasonReward(reward);
  state.mm = new Matchmaker(transport, {
    version: RULES_FINGERPRINT,
    mmr: r.mmr,
    newCode: newRoomCode,
    onUpdate: (info) => home.setSearch(info),
    onHost: (code, members) => {
      state.mm = null;
      state.match = { code, host: true, expect: members, deadline: Date.now() + INVITE_MS };
      home.setSearch(null, 'encontrada');
      sound.play('listo', 0.9, 0);
      openSala(code, true, {
        settings: { bots: RANKED_ROOM.bots, mapSize: RANKED_ROOM.mapSize, difficulty: RANKED_ROOM.difficulty, rules: { ...DEFAULT_RULES, profile: RANKED_ROOM.profile }, clasificatoria: true },
        info: { nombre: 'Clasificatoria', visibilidad: 'enlace', plazas: Math.max(2, Math.min(8, members.length + 1)) },
      }).catch(() => {
        state.match = null;
        home.flash?.('No se ha podido crear la sala. Vuelve a buscar partida.');
      });
    },
    onJoin: (code) => {
      state.mm = null;
      state.match = { code, host: false };
      home.setSearch(null, 'encontrada');
      sound.play('listo', 0.9, 0);
      openSala(code, false, { auto: true });
    },
  });
  state.mm.start();
}

function stopMatchmaking() {
  state.mm?.stop();
  state.mm = null;
  home.setSearch(null);
}

/**
 * Sala formada por el emparejamiento: los invitados se marcan listos solos y
 * el anfitrión empieza en cuanto están todos (o, pasado el plazo, con los que
 * haya; si no ha venido nadie, vuelve a la cola).
 */
function autoMatch(sala) {
  const m = state.match;
  if (!m || m.code !== sala.code || sala.started || sala.countdown) return;
  if (!m.host) {
    if (!sala.observer && !sala.myReadyValid()) sala.setReady(true);
    return;
  }
  const st = sala.status();
  const others = st.players.filter((p) => !p.isMe);
  const allHere = m.expect.every((peer) => others.some((p) => p.peer === peer && p.ready));
  const late = Date.now() > m.deadline;
  if (st.canStart && (allHere || (late && st.total >= 2))) sala.beginCountdown();
  else if (late && st.total < 2) {
    // No ha venido nadie: fuera de la sala y otra vez a la cola
    state.match = null;
    leaveOnline();
    home.show();
    home.go('competitivo', { replace: true });
    toggleMatchmaking();
  }
}

/**
 * Abre una sala. Anfitrión: con la configuración y los datos del formulario
 * «Crear sala» (si falla, lanza el error para que el formulario lo muestre).
 * Invitado: entra como observador y, si se puede, ocupa su plaza (con
 * `auto`, al momento; desde un enlace, tras pulsar «Unirme» en la ficha).
 */
async function openSala(code, isHost, { settings = null, info = null, auto = true } = {}) {
  if (!transport) throw new Error('Sin conexión para el multijugador.');
  if (state.match?.code !== code) {
    state.match = null;
    if (state.mm) stopMatchmaking();
  }
  leaveOnline();
  const sala = new Sala(transport, { code, isHost, me: { ...myIdentity(), name: roomName(profile.nombre, RECRUIT_TAG) }, settings: settings || defaultRoomSettings(), info });
  state.sala = sala;
  // Tu rango, firmado para esta sala (en una clasificatoria, los demás lo usan en el Elo)
  try {
    const ident = await getIdentity();
    const r = profile.rangoOnline;
    const signed = ident ? await signClaim(claimText(code, r.mmr, r.puntos), ident) : null;
    if (signed) sala.rankClaim = { mmr: Math.round(r.mmr), puntos: r.puntos, ...signed };
  } catch {
    /* sin WebCrypto: sin firma (cuenta como 1000) */
  }
  const kind = transport.kind;
  const render = (status = '') => {
    if (state.sala !== sala || sala.started) return;
    if (sala.observer) {
      const entry = sala.entryState();
      if (auto && entry.estado === 'lista') {
        sala.join().then(() => render());
        return;
      }
      home.renderEntry(sala, entry);
    } else home.renderLobby(sala, kind, status);
  };
  sala.onChange = () => {
    render();
    autoMatch(sala);
  };
  // Sala del emparejamiento: comprobar también con el reloj (plazo para que lleguen)
  if (state.match?.code === code) {
    clearInterval(state.matchTimer);
    state.matchTimer = setInterval(() => {
      if (state.sala !== sala || sala.started || state.match?.code !== code) clearInterval(state.matchTimer);
      else autoMatch(sala);
    }, 1000);
  }
  sala.onStart = (payload, hostPeer) => {
    home.hideCountdown();
    beginOnlineGame(sala, payload, hostPeer);
  };
  sala.onCountdown = (ms, motivo) => {
    if (state.sala !== sala) return;
    if (ms) home.showCountdown(ms);
    else {
      home.hideCountdown();
      render(motivo ? `Inicio cancelado: ${motivo}.` : '');
    }
  };
  sala.onConnection = (on) => {
    if (state.sala !== sala || sala.started) return;
    render(on ? '' : 'Reconectando… (tu plaza se guarda unos segundos)');
  };
  // El anfitrión simula con otra versión de las reglas: no se empieza
  sala.onVersionMismatch = (theirs, mine) => {
    if (state.sala !== sala) return;
    render(`La sala usa otra versión del juego (${theirs}; la tuya, ${mine}). Recargad la página los dos y volved a entrar.`);
  };
  home.showLobby();
  if (!isHost) home.renderEntry(sala, { estado: 'buscando' });
  try {
    await sala.open({ observer: !isHost });
  } catch (err) {
    if (state.sala === sala) state.sala = null;
    const c = err && err.code;
    const why =
      c === 'not_permitted'
        ? 'No tienes permiso para jugar online en este enlace (hace falta acceso de colaborador).'
        : c === 'limit_reached'
          ? 'Hay demasiadas salas abiertas ahora mismo. Inténtalo en un momento.'
          : 'No se ha podido abrir la sala.';
    if (isHost) {
      home.hideLobby();
      throw new Error(why);
    }
    if (!state.pendingEntry) state.pendingEntry = code;
    home.renderEntry(sala, { estado: 'error', detalle: why });
    return;
  }
  render();
  if (!isHost) {
    // Sin anfitrión a la vista: la ficha dirá que la sala no existe o se ha cerrado
    setTimeout(() => state.sala === sala && !sala.started && render(), 5200);
  }
}

/** Enlace de invitación: esta página con ?sala=CÓDIGO (y el servidor de salas usado). */
function inviteLink(sala) {
  const code = sala.code.toUpperCase();
  if (!transport || transport.kind === 'claude' || !/^https?:$/.test(location.protocol)) return null;
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('sala', code);
  if (transport.kind === 'mqtt') {
    if (transport.brokerIndex >= 0) url.searchParams.set('b', String(transport.brokerIndex));
    else url.searchParams.set('broker', transport.brokerUrl);
  }
  if (transport.kind === 'local') url.searchParams.set('red', 'local');
  return url.toString();
}

function copyText(text, ok, fail) {
  if (navigator.clipboard && window.isSecureContext !== false) navigator.clipboard.writeText(text).then(ok, fail);
  else fail();
}

async function beginOnlineGame(sala, payload, hostPeer) {
  if (state.sala !== sala) return;
  // La sala del emparejamiento ya ha empezado
  state.match = null;
  clearInterval(state.matchTimer);
  const myPeer = sala.myPeer();
  const index = payload.players.findIndex((p) => p.peer === myPeer);
  if (index < 0) {
    home.renderLobby(sala, transport.kind, 'La partida ha empezado sin ti (la sala estaba llena). Crea otra sala.');
    return;
  }
  state.online = true;
  // Sala clasificatoria: cuenta para el rango (abandonarla, como derrota)
  state.ranked = payload.settings.clasificatoria ? 'sala' : null;
  state.rankedDone = false;
  state.rankedVoid = false;
  state.rankOut = null;
  state.lastOpts = null;
  // Rango de cada uno (sala clasificatoria): el que anuncian firmado para esta sala
  const rankPoints = new Map();
  let ranksReady = Promise.resolve();
  if (state.ranked) {
    // Identificador de la partida (el mismo para todos): su resultado se aplica una vez (DEV07)
    state.rankedMatch = `${sala.code}.${payload.ronda}.${payload.seed >>> 0}`;
    profile.rangoOnline.pendiente = { tipo: 'sala', inicio: Date.now(), partida: state.rankedMatch };
    saveProfile(profile);
    // MMR de los demás: el que anuncian firmado para esta sala (si no cuadra, 1000)
    const claims = sala.rankClaims();
    state.rankedMmr = new Map();
    ranksReady = Promise.all(payload.players.map(async (p) => {
      const v = await verifiedRank(sala.code, claims.get(p.peer)).catch(() => null);
      state.rankedMmr.set(p.peer, v ? v.mmr : 1000);
      if (v) rankPoints.set(p.peer, v.puntos);
    }));
  }
  // La simulación espera a la sincronización (si no, cada uno avanzaría por su cuenta)
  state.holdSim = true;
  const game = await withLoading(
    // En un mapa generado, la semilla que reparte el anfitrión (la misma para todos, DEV10)
    `${mapLabel(payload.settings.mapSize)}${REAL_MAPS[payload.settings.mapSize] ? '' : ` · semilla ${payload.seed >>> 0}`} · ${transport && transport.kind === 'local' ? 'prueba local' : 'online'}`,
    [
      { label: 'Levantando el relieve…', run: () => loadMap(payload.settings.mapSize, payload.seed) },
      {
        label: 'Desplegando naciones…',
        run: (loaded) =>
          newGame({
            seed: payload.seed,
            mapSize: payload.settings.mapSize,
            bots: payload.settings.bots,
            difficulty: payload.settings.difficulty,
            rules: payload.settings.rules,
            humans: payload.players,
            localIndex: index,
            loaded,
          }),
      },
    ],
    { minMs: 500 }, // online no hay que hacer esperar al resto
  );
  if (state.sala !== sala) return;
  // Presentación: los participantes de la sala (y su rango en la clasificatoria) y las naciones.
  // Dura lo mismo para todos; el anfitrión espera además a que todos hayan cargado.
  await Promise.race([ranksReady, new Promise((r) => setTimeout(r, 900))]);
  {
    const nations = nationsOf(game);
    const prof = PROFILES[game.rules.profile]?.name || 'Clásico';
    const ranked = !!state.ranked;
    await presentMatch({
      kicker: ranked ? `Sala clasificatoria · en línea · ${seasonName(profile.rangoOnline.temporada)}` : `Multijugador · sala ${sala.code.toUpperCase()}`,
      title: mapLabel(payload.settings.mapSize),
      details: `${plural(payload.players.length, 'jugador', 'jugadores')} · ${plural(nations.length, 'nación de la IA', 'naciones de la IA')} · perfil ${prof}`,
      players: payload.players.map((p) => ({
        ...p,
        nameColor: nameColorOf({ colorNombre: p.nameColor, color: p.color }),
        me: p.peer === myPeer,
        rank: ranked ? (p.peer === myPeer ? { points: profile.rangoOnline.puntos, placing: inPlacement(profile.rangoOnline) } : rankPoints.has(p.peer) ? { points: rankPoints.get(p.peer), placing: false } : { points: 0, placing: true }) : null,
      })),
      nations,
      ranked,
      skippable: false,
      sound,
    });
  }
  if (state.sala !== sala || state.game !== game) return;
  // Los humanos se añaden primero: el jugador i tiene id i + 1 (en cooperativo,
  // cada pareja comparte el id de su nación)
  const groups = coopGroups(payload.players.length, game.rules.coop);
  const playerOf = (i) => groups.findIndex((g) => g.includes(i)) + 1;
  const peerToPlayer = new Map(payload.players.map((p, i) => [p.peer, playerOf(i)]));
  state.net = new NetSync(sala.room, game, { isHost: sala.isHost, hostPeer, myPlayerId: playerOf(index), peerToPlayer, mySlot: index, myPeer, smooth: true, ronda: payload.ronda || 1 });
  // Rivales humanos para el Elo: su MMR (verificado) y su puesto al acabar
  state.rankedRivals = () =>
    payload.players
      .map((p, i) => ({ p, player: game.players[playerOf(i)] }))
      .filter(({ p }) => p.peer !== myPeer)
      .map(({ p, player }) => ({ mmr: state.rankedMmr?.get(p.peer) ?? 1000, place: player ? placement(game, player).place : Infinity }));
  // Se va el anfitrión (aviso explícito) o se pierde su conexión: la partida
  // se interrumpe con su informe completo (duración real, cifras, motivo y si
  // cuenta), una sola vez aunque lleguen avisos repetidos (DEV05)
  state.net.onHostLeft = (reason) => {
    if (game.phase === 'ended' || state.game !== game || state.endShown) return;
    state.endShown = true;
    // Si se va el anfitrión, la clasificatoria no cuenta para nadie
    if (state.ranked) {
      state.rankedVoid = true;
      state.rankedVoidReason = reason === 'abandono' ? 'El anfitrión abandonó la partida' : 'Se perdió la conexión con el anfitrión';
    }
    const progress = finishGame({ interrupted: true });
    const extra = endExtra('interrumpida');
    extra.motivo = reason === 'abandono' ? 'El anfitrión ha abandonado la partida.' : 'Se ha perdido la conexión con el anfitrión.';
    extra.validez = state.ranked ? 'Clasificatoria anulada: no cuenta para el rango de nadie.' : 'La ronda no se ha completado: queda en tu historial como interrumpida.';
    extra.actions = { nueva: { hidden: true }, seguir: { hidden: true }, menu: { label: 'Volver a Multijugador' } };
    ui.showEnd('Partida interrumpida', `Se interrumpió a los ${formatTime(extra.stats.seconds)} de partida.`, progress, extra);
  };
  enterGame(game);
}

// --------------------------------------------------------------- perfil

let cloudTimer = null;
function scheduleCloudSync(delay = 2500) {
  scheduleAccountSync(delay);
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    if (!cloud) return;
    pushProfile(cloud, profile);
    pushLeaderboard(cloud, profile);
  }, delay);
}

// Cuenta (solo en la web, con la API de cuentas): el perfil entero en el servidor
const account = Account.available()
  ? new Account({
      onChange: (st) => {
        accountUI?.render(st);
        onAccountChange(st);
      },
    })
  : null;
const accountUI = new AccountUI(account, { profile, onSynced: afterAccountSync });
state.account = account; // para pruebas automáticas

// Amigos, invitaciones a sala y clanes (en la web, con cuenta)
const social = account ? new Social(account, { onChange: (data) => socialUI.update(data) }) : null;
const socialUI = new SocialUI(social, {
  accountUI,
  getRoom: roomForInvite,
  onJoinInvite: joinInvite,
  onSummary: (sum) => home.setSocialSummary(sum),
  isBusy: () => !!(state.game && !state.demo),
});
state.social = social;
if (social) {
  // Lo que ven tus amigos: menú, sala o partida
  social.estadoFn = () => (state.game && !state.demo ? 'partida' : state.sala && !state.sala.started ? 'sala' : 'menu');
}
let socialSignedIn = false;
/** Al entrar o salir de la cuenta: amigos y clan aparecen o se van. */
function onAccountChange(st) {
  if (!social || st.signedIn === socialSignedIn) return;
  socialSignedIn = st.signedIn;
  social.forgetCard(); // otra cuenta: su ficha pública se manda de nuevo
  if (st.signedIn) {
    social.saveCard(profile).finally(() => social.refresh());
    social.poll(30000);
  } else {
    social.poll(0);
    social.data = null;
    socialUI.update(null);
  }
}
/** Tu sala abierta (para invitar a amigos): { code, red } o null. */
function roomForInvite() {
  const sala = state.sala;
  // (la red local solo llega a otras pestañas de este navegador: no sirve para invitar)
  if (!sala || sala.started || !transport || transport.kind === 'claude' || transport.kind === 'local') return null;
  return { code: sala.code, red: roomNet() };
}
/** El servidor de salas, como en el enlace de invitación («b=1» o «red=local»). */
function roomNet() {
  if (!transport) return '';
  if (transport.kind === 'mqtt' && transport.brokerIndex >= 0) return `b=${transport.brokerIndex}`;
  if (transport.kind === 'local') return 'red=local';
  return '';
}
/** Unirse a la sala de una invitación: aquí mismo si es el mismo servidor de salas; si no, con su enlace. */
function joinInvite(inv) {
  // En mitad de una partida no: la invitación sigue ahí al volver al menú
  if (state.game && !state.demo) return;
  social?.dismissInvite(inv.id).catch(() => {});
  const code = normalizeCode(inv.sala);
  if (code.length !== 5) return;
  // Del servidor de salas solo se acepta su número («b=1»): nada más del enlace
  const red = /^b=\d{1,2}$/.test(inv.red || '') ? inv.red : '';
  inv = { ...inv, red };
  if (transport && (inv.red || '') === roomNet() && !(state.game && !state.demo)) {
    state.pendingEntry = code;
    home.showLobby();
    home.renderEntry(entryStub(code), { estado: 'buscando' });
    openEntry();
    return;
  }
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('sala', code.toUpperCase());
  for (const [k, v] of new URLSearchParams(inv.red || '')) url.searchParams.set(k, v);
  location.assign(url.toString());
}
/** El perfil cambió con lo de la cuenta: repinta el inicio y aplica los ajustes. */
function afterAccountSync() {
  try {
    social?.saveCard(profile);
    applySettings();
    home.renderChip();
    if (state.demo) home.renderAll();
  } catch (err) {
    reportError(err, 'cuenta');
  }
}
let accountTimer = null;
function scheduleAccountSync(delay = 4000) {
  if (!account || !account.signedIn) return;
  clearTimeout(accountTimer);
  accountTimer = setTimeout(() => {
    account
      .sync(profile)
      .then(afterAccountSync)
      .catch(() => {});
  }, Math.max(delay, 1500));
}

function gameResult() {
  const { game, human } = state;
  const seconds = (Math.max(0, game.ticks - CONFIG.spawnTicks) * TICK_MS) / 1000;
  const survived = human.alive ? seconds : (Math.max(0, human.eliminatedTick - CONFIG.spawnTicks) * TICK_MS) / 1000;
  const alliedWin = !!(game.winningAlliance && game.winningAlliance.includes(human));
  const place = placement(game, human);
  const rec = state.rec && state.rec.game === game ? state.rec : null;
  const maxShare = human.maxTilesReached / game.map.landCount;
  return {
    ranked: state.ranked || null,
    challenge: state.challenge || null,
    challengeBeaten: challengeBeaten(state.challenge, maxShare),
    place: place.place,
    of: place.of,
    curve: rec ? compactCurve(rec.samples) : [],
    won: game.winner === human && !game.winningAlliance,
    alliedWin,
    mapSize: state.mapSize,
    seconds,
    maxShare: human.maxTilesReached / game.map.landCount,
    kills: human.stats.kills,
    built: human.stats.built,
    landings: human.stats.landings,
    alliances: human.stats.alliances,
    betrayals: human.betrayals,
    maxGold: human.stats.maxGold,
    maxCities: human.stats.maxCities,
    maxFactories: human.stats.maxFactories,
    missiles: human.stats.missiles,
    online: state.online,
    pointsTaken: human.stats.points || 0,
    capitalsTaken: human.stats.capitals || 0,
    pacts: human.stats.pacts || 0,
    techs: human.techs ? human.techs.size : 0,
    loot: human.income ? human.income.loot : 0,
    sunk: human.stats.sunk || 0,
    coop: !!state.coop,
    victory: game.rules.victory,
    alive: human.alive,
    survivedSeconds: survived,
    ended: game.phase === 'ended',
    rivals: game.players.length - 2,
    config: state.config && state.config.semilla === (game.seed >>> 0) ? state.config : null,
  };
}

/** Anota la partida en el perfil (una vez). Devuelve el progreso para mostrarlo. */
/** Al ver el resultado: fanfarria si has subido de nivel, o campana si hay logros nuevos. */
function endFanfare(progress, ms) {
  if (!progress) return;
  const name = progress.levelUp ? 'nivel' : progress.achievements?.length ? 'logro' : null;
  if (name) setTimeout(() => sound.play(name, 1, 0), ms);
}

/**
 * Anota la partida en el perfil (una sola vez por partida). `interrupted`:
 * la interrumpió otro (el anfitrión se fue): cuenta aunque dure poco.
 */
function finishGame({ interrupted = false } = {}) {
  const { game, human } = state;
  if (state.recorded || state.demo || !game || !human) return null;
  state.recorded = true;
  if (state.rec && state.rec.game === game) state.rec.finish();
  const result = gameResult();
  result.interrupted = interrupted;
  applyRanked(result);
  // Abandonos tuyos de menos de un minuto no cuentan
  if (!interrupted && game.phase !== 'ended' && human.alive && result.seconds < 60) return null;
  const out = recordGame(profile, result);
  scheduleCloudSync(0);
  for (const a of out.achievements) ui.pushEvent({ text: `${a.icon} Logro: ${a.name}`, kind: 'good' });
  return { ...out, level: levelInfo(profile.xp).level };
}

/** Cómo ha ganado `who` (tú si `mine`), según el motivo con el que acabó la partida. */
function winText(game, mine, who, land) {
  switch (game.winReason) {
    case 'capitales':
      return mine ? 'Has controlado las capitales del mundo el tiempo necesario' : `${who.name} controla las capitales del mundo`;
    case 'economia':
      return mine ? 'Has mantenido la supremacía económica' : `${who.name} logra la supremacía económica`;
    case 'supervivencia':
      return mine ? 'Has sobrevivido con la mejor puntuación' : `${who.name} sobrevive con la mejor puntuación`;
    case 'tiempo':
      return mine ? 'Se acabó el tiempo y vas en cabeza' : `Se acabó el tiempo y ${who.name} va en cabeza`;
    case 'ultimo':
      return mine ? 'Eres la última nación en pie' : `${who.name} es la última nación en pie`;
    default:
      return mine ? `Has conquistado el ${formatPercent(who.tiles / land)} del mundo` : `${who.name} domina el mundo`;
  }
}

// ------------------------------------------------------------ clasificatoria

const ladder = new Ladder((st) => home.setLadder(st));
/** Sube tu fila a la tabla de rangos (y al perfil de la nube). */
function pushRankRow() {
  ladder.push(profile);
  scheduleCloudSync(0);
}

/** Clasificatoria contra la IA: el mundo, 90 naciones, perfil Clásico; la dificultad, según tu liga. */
function startRanked() {
  const r = profile.rango;
  const reward = ensureSeason(r);
  if (reward) grantSeasonReward(reward);
  const difficulty = aiDifficultyFor(r);
  state.rankedMatch = `ia.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
  r.pendiente = { tipo: 'ia', inicio: Date.now(), partida: state.rankedMatch };
  saveProfile(profile);
  state.rankedDifficulty = difficulty;
  startGame({
    ranked: 'ia',
    title: 'Clasificatoria',
    mapSize: RANKED_AI.mapSize,
    bots: RANKED_AI.bots,
    difficulty,
    seed: '',
    rules: { ...DEFAULT_RULES, profile: RANKED_AI.profile },
  });
}

/** Recompensa de la temporada anterior (al cambiar de temporada). */
function grantSeasonReward(reward) {
  profile.monedas = (profile.monedas || 0) + reward.coins;
  profile.stats.monedasGanadas = (profile.stats.monedasGanadas || 0) + reward.coins;
  saveProfile(profile);
  home.flash?.(`Nueva temporada. Por tu ${reward.league.name} de la anterior: +🪙 ${reward.coins}`, true);
}

/**
 * Aplica (una sola vez) el resultado de una clasificatoria: al acabar, al
 * caer o al abandonarla (cuenta como quedar el último).
 */
function applyRanked(result) {
  if (!state.ranked || state.rankedDone || !state.human) return;
  state.rankedDone = true;
  // Cada cola, su progresión (DEV07): contra la IA o en línea
  const r = queueRank(state.ranked);
  const partida = (r.pendiente && r.pendiente.partida) || state.rankedMatch || '';
  if (state.rankedVoid) {
    // Se perdió al anfitrión: anulada (no cuenta), con su motivo en el historial
    const out = voidResult(r, { partida, motivo: state.rankedVoidReason || 'Se perdió al anfitrión' });
    r.pendiente = null;
    saveProfile(profile);
    if (out) state.rankOut = { ...out, rank: { ...r } };
    home.renderRanked?.();
    return;
  }
  const abandon = state.game.phase !== 'ended' && state.human.alive;
  const place = { place: result.place, of: result.of };
  const before = { puntos: r.puntos, colocacion: r.colocacion };
  let out;
  if (state.ranked === 'sala') out = applyRoomResult(r, place, state.rankedRivals ? state.rankedRivals() : [], { abandon, partida });
  else out = applyAiResult(r, place, { difficulty: state.rankedDifficulty, abandon, partida });
  r.pendiente = null;
  saveProfile(profile);
  if (!out) return; // ese final ya se había aplicado (recarga o final repetido)
  state.rankOut = { ...out, abandon, before, rank: { ...r } };
  pushRankRow();
  home.renderRanked?.();
  home.renderChip();
}

/** Partida clasificatoria que quedó a medias (se cerró la página): cuenta como abandono. */
function settlePendingRanked() {
  for (const r of [profile.rango, profile.rangoOnline]) {
    const reward = ensureSeason(r);
    if (reward) grantSeasonReward(reward);
    if (!r.pendiente) continue;
    const { tipo, partida } = r.pendiente;
    // Ya resuelta (se aplicó antes de cerrar): no se cuenta otra vez
    const out = alreadyApplied(r, partida) ? null : tipo === 'sala' ? applyRoomResult(r, null, [], { abandon: true, partida }) : applyAiResult(r, null, { abandon: true, partida });
    r.pendiente = null;
    saveProfile(profile);
    if (!out) continue;
    if (tipo !== 'sala') pushRankRow();
    const cola = tipo === 'sala' ? 'en línea' : 'contra la IA';
    whenBooted(() => setTimeout(() => home.flash?.(`Dejaste una clasificatoria ${cola} sin terminar: cuenta como derrota (${out.delta} PL).`), 500));
  }
}

/** Cambio de rango en el resumen de la partida: insignia, liga, barra de PL y el motivo. */
function renderRankChange(box, o) {
  const r = o.rank;
  const k = rankOf(o.after);
  const head = document.createElement('div');
  head.className = 'fr-cab';
  head.append(badgeCanvas(r, 44));
  const texts = document.createElement('div');
  texts.className = 'fr-textos';
  const title = document.createElement('strong');
  const sub = document.createElement('small');
  const placing = inPlacement(r);
  if (o.void) {
    title.textContent = 'Clasificatoria anulada';
    sub.textContent = `${o.motivo || 'Se perdió al anfitrión'}: no cuenta ni a favor ni en contra. Queda en tu historial.`;
  } else if (o.placing && !o.placementDone) {
    title.textContent = `Colocación ${r.colocacion}/5`;
    sub.textContent = o.mmrDelta >= 0 ? 'Buena partida: tu nivel oculto sube.' : 'Tu nivel oculto baja un poco.';
  } else if (o.placementDone) {
    title.textContent = `¡Colocación terminada: ${k.label}!`;
    sub.textContent = `Empiezas con ${k.pl} PL.`;
  } else {
    title.textContent = k.label;
    const pl = `${k.pl} PL${k.league.apex ? '' : ' de 100'}`;
    sub.textContent = o.promoted ? `¡Subes a ${k.label}! Tienes escudo durante 3 partidas.` : o.demoted ? `Bajas a ${k.label}.` : o.shieldUsed ? `🛡 El escudo te ha librado de bajar · ${pl}` : o.abandon ? `Abandonar cuenta como derrota · ${pl}` : pl;
  }
  title.style.color = placing ? '' : `rgb(${k.league.color.join(',')})`;
  texts.append(title, sub);
  const delta = document.createElement('span');
  delta.className = `fr-delta ${o.delta > 0 ? 'sube' : o.delta < 0 ? 'baja' : ''}`;
  delta.textContent = o.void ? '0 PL' : o.placing && !o.placementDone ? '' : `${o.delta > 0 ? '+' : ''}${o.delta} PL`;
  head.append(texts, delta);
  box.append(head);
  if (o.void) return;
  if (!placing) {
    // Barra de PL de la división: se llena desde donde estaba
    const bar = document.createElement('div');
    bar.className = 'fr-barra';
    const fill = document.createElement('span');
    const from = o.promoted ? 0 : o.demoted ? 1 : rankOf(o.before).pl / (k.league.apex ? 300 : 100);
    const to = Math.min(1, k.league.apex ? k.pl / 300 : k.pl / 100);
    fill.style.setProperty('--p', String(Math.max(0, Math.min(1, from))));
    bar.append(fill);
    box.append(bar);
    setTimeout(() => fill.style.setProperty('--p', String(to)), 700);
  }
  if (o.promoted || o.placementDone) box.classList.add('fr-ascenso');
}

/**
 * Enlace «Supera mi partida»: la misma partida contra la IA (mapa, rivales,
 * dificultad, semilla y reglas) y tu máximo de territorio como meta. Solo en
 * la web (en el enlace de Claude, la dirección de la página no sirve para
 * abrirla) y no en multijugador.
 */
function challengeUrl(r) {
  if (state.online || state.lastSeed == null || !state.lastOpts || !Ladder.webAvailable()) return '';
  const o = state.lastOpts;
  return challengeLink(`${location.origin}${location.pathname}`, {
    m: state.mapSize, b: o.bots, d: o.difficulty, s: state.lastSeed, r: state.game.rules, p: r.maxShare * 1000, n: profile.nombre || 'Alguien', t: r.place, o: r.of,
  });
}

/** Al abrir un enlace con ?reto=…: la ficha del reto para aceptarlo. */
function offerChallenge(c) {
  const map = mapLabel(c.m);
  const pct = (c.p / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 });
  document.getElementById('dre-titulo').textContent = `${c.n} te reta`;
  const box = document.getElementById('dre-cuerpo');
  const meta = document.createElement('div');
  meta.className = 'reto-meta';
  const num = document.createElement('span');
  num.className = 'rm-num';
  num.textContent = `${pct} %`;
  const txt = document.createElement('span');
  txt.textContent = `Supera su máximo de territorio en ${map}${c.t ? ` (quedó ${c.t}.º de ${c.o})` : ''}.`;
  meta.append(num, txt);
  const info = document.createElement('p');
  info.className = 'nota';
  info.textContent = `La misma partida: ${map}, ${c.b} rivales, IA ${{ facil: 'Fácil', normal: 'Normal', dificil: 'Difícil', imposible: 'Imposible' }[c.d]} y las mismas reglas y semilla.`;
  box.replaceChildren(meta, info);
  document.getElementById('dre-aceptar').onclick = () => {
    cerrarDialogo(document.getElementById('dialogo-reto'));
    startGame({ mapSize: c.m, bots: c.b, difficulty: c.d, seedNum: c.s, rules: c.r, challenge: c, title: `Reto de ${c.n}` });
  };
  abrirDialogo(document.getElementById('dialogo-reto'), { foco: '#dre-aceptar' });
}

/** Lo que necesita la pantalla de fin: grabación, puesto y cifras de la partida. */
function endExtra(outcome) {
  const { game, human } = state;
  const r = gameResult();
  return {
    rec: state.rec && state.rec.game === game ? state.rec : null,
    game,
    human,
    outcome,
    place: { place: r.place, of: r.of },
    stats: { seconds: outcome === 'derrota' ? r.survivedSeconds : r.seconds, maxShare: r.maxShare, kills: r.kills, built: r.built },
    share: { map: mapLabel(state.mapSize), online: !!state.online, url: challengeUrl(r) },
    challenge: state.challenge ? { de: state.challenge.n, meta: state.challenge.p, superado: r.challengeBeaten } : null,
    renderRank: state.rankOut ? (box) => renderRankChange(box, state.rankOut) : null,
  };
}

function checkEnd() {
  const { game, human } = state;
  if (state.demo || !human) return;
  const seconds = (Math.max(0, game.ticks - CONFIG.spawnTicks) * TICK_MS) / 1000;
  const land = game.map.landCount;
  if (game.phase === 'ended' && !state.endShown) {
    state.endShown = true;
    const progress = finishGame();
    let title;
    let text;
    if (game.winningAlliance && game.winningAlliance.includes(human)) {
      const others = game.winningAlliance.filter((p) => p !== human).map((p) => p.name).join(', ');
      title = '¡Victoria en alianza!';
      text = `Solo quedáis tú y tus aliados (${others}) en ${formatTime(seconds)}.\nTu territorio: ${formatPercent(human.tiles / land)}.`;
    } else if (game.winner === human) {
      title = '¡Victoria!';
      text = `${winText(game, true, human, land)} en ${formatTime(seconds)}.`;
    } else if (game.winningAlliance) {
      title = 'Fin de la partida';
      text = `La alianza de ${game.winningAlliance.map((p) => p.name).join(', ')} domina el mundo.\nTu máximo: ${formatPercent(human.maxTilesReached / land)} del territorio.`;
    } else {
      title = 'Fin de la partida';
      text = `${winText(game, false, game.winner, land)}.\nTu máximo: ${formatPercent(human.maxTilesReached / land)} del territorio.`;
    }
    // Un momento para ver el final: la cámara se aleja hasta ver todo el
    // mapa y después aparece el resultado
    const map = game.map;
    const fit = Math.min(camera.viewW / map.width, camera.viewH / map.height) * 0.9;
    camera.flyTo(map.width / 2, map.height / 2, fit, 1300);
    const won = game.winner === human || !!(game.winningAlliance && game.winningAlliance.includes(human));
    const extra = endExtra(won ? 'victoria' : 'fin');
    extra.actions = onlineEndActions(true);
    setTimeout(() => {
      if (state.game !== game) return;
      ui.showEnd(title, text, progress, extra);
      watchRematch();
    }, 1500);
    endFanfare(progress, 2600);
  } else if (!human.alive && !state.defeatShown && game.phase !== 'ended') {
    state.defeatShown = true;
    const progress = finishGame();
    const extra = endExtra('derrota');
    extra.actions = onlineEndActions(false);
    setTimeout(() => {
      if (state.game === game) ui.showEnd('Has sido derrotado', `Aguantaste ${formatTime(extra.stats.seconds)}.\nTu máximo: ${formatPercent(human.maxTilesReached / land)} del territorio.`, progress, extra);
    }, 1200);
    endFanfare(progress, 4200);
  }
}

// ---------------------------------------------------------------- inicio

const home = new Home(profile, {
  onProfileChange(identity) {
    saveProfile(profile);
    if (identity) scheduleCloudSync();
    else scheduleAccountSync(); // la cuenta guarda todo el perfil (también los ajustes)
    applySettings();
  },
  onQuickPlay: startGame,
  onTutorial() {
    startGame({ tutorial: true, title: 'Tutorial', mapSize: 'pequeno', bots: 5, difficulty: 'facil', seed: 'trinchera-tutorial', rules: DEFAULT_RULES });
  },
  onSettings: applySettings,
  sound: (name) => sound.play(name, 0.9, 0),
  /** «Buscar partida» en línea (cola de emparejamiento): entrar o cancelar. */
  onFindMatch() {
    toggleMatchmaking();
  },
  /** «Jugar clasificatoria» (contra la IA) o «Sala clasificatoria» (multijugador). */
  onRanked(kind) {
    if (kind === 'sala') home.showCreate({ ranked: true });
    else startRanked();
  },
  onLadderRefresh: () => ladder.refresh(),
  /** «Reintentar» en Multijugador: vuelve a buscar el servidor de salas. */
  onRetryNet() {
    if (connecting) return;
    try {
      transport?.close?.();
    } catch {
      /* ya estaba cerrado */
    }
    transport = null;
    state.transport = null;
    connectNet();
  },
  /** «Crear sala» (devuelve una promesa: el formulario espera y, si falla, permite reintentar). */
  onCreateRoom({ settings, info }) {
    return openSala(newRoomCode(), true, { settings, info });
  },
  onJoinRoom(text) {
    const code = normalizeCode(text);
    if (code.length !== 5) {
      home.setNetStatus(transport ? transport.kind : null, 'El código tiene 5 letras o números.');
      return;
    }
    openSala(code, false, { auto: true });
  },
  onEntryJoin() {
    const sala = state.sala;
    if (!sala || !sala.observer) return;
    if (sala.entryState().estado !== 'lista') {
      home.renderEntry(sala, sala.entryState());
      return;
    }
    state.pendingEntry = null;
    sala.join().then(() => home.renderLobby(sala, transport.kind));
  },
  onReady() {
    const sala = state.sala;
    if (!sala || sala.isHost) return;
    const ready = !sala.myReadyValid();
    sala.setReady(ready);
    if (ready) sound.play('listo', 0.9, 300);
    home.renderLobby(sala, transport.kind);
  },
  onRoomInfo(info) {
    state.sala?.setInfo(info);
    if (state.sala) home.renderLobby(state.sala, transport.kind);
  },
  onCopyLink() {
    const sala = state.sala;
    if (!sala) return;
    const link = transport && transport.kind === 'mqtt' ? inviteLink(sala) : null;
    const code = sala.code.toUpperCase();
    if (transport && transport.kind === 'local') {
      // Prueba entre pestañas: el código, para escribirlo en otra pestaña
      copyText(code, () => home.showCopy(true), () => home.showCopy(false, code));
      return;
    }
    if (!link) {
      // Dentro de Claude: el enlace es el del juego; se copia el código
      copyText(`Únete a mi sala de Trinchera con el código ${code}`, () => home.showCopy(true), () => home.showCopy(false, code));
      return;
    }
    copyText(link, () => home.showCopy(true), () => home.showCopy(false, link));
  },
  onLeaveRoom() {
    state.match = null;
    leaveOnline();
    if (state.pendingEntry) {
      // La invitación ya se ha usado: fuera de la dirección (una recarga no vuelve a ella)
      state.pendingEntry = null;
      const url = new URL(location.href);
      for (const k of ['sala', 'b']) url.searchParams.delete(k);
      history.replaceState(null, '', url);
    }
    // La sala tenía su entrada en el historial: se cierra y se vuelve a la página de antes
    const below = history.state?.capa === 'sala' && history.state.n > 0;
    home.closeLayer('sala');
    home.show();
    if (!below) home.openPanel('online');
  },
  /** Atrás o adelante en el navegador (o el botón atrás del móvil). true = resuelto aquí. */
  onHistory(st) {
    // En partida, atrás no te saca de golpe: abre (o cierra) el menú de la partida
    if (state.game && !state.demo) {
      const menu = document.getElementById('menu-partida');
      if (st?.capa !== 'partida') home.pushLayer('partida');
      if (menu && !menu.hidden) cerrarDialogo(menu);
      else openGameMenu();
      return true;
    }
    // En una sala (o su ficha de entrada): atrás es salir de ella
    if ((state.sala || state.pendingEntry) && !document.getElementById('sala').hidden && st?.capa !== 'sala') {
      leaveOnline();
      if (state.pendingEntry) {
        state.pendingEntry = null;
        const url = new URL(location.href);
        for (const k of ['sala', 'b']) url.searchParams.delete(k);
        history.replaceState(history.state, '', url);
      }
      home.show();
      home.setView(st?.vista && st.vista !== 'jugar' ? st.vista : 'multijugador');
      return true;
    }
    return false;
  },
  onEntryRetry() {
    if (!state.pendingEntry && state.sala) state.pendingEntry = state.sala.code;
    if (!state.pendingEntry) return;
    home.renderEntry(entryStub(state.pendingEntry), { estado: 'buscando' });
    if (transport) openEntry();
    else connectNet();
  },
  onStartRoom() {
    const sala = state.sala;
    if (!sala) return;
    const why = sala.beginCountdown();
    if (why) home.renderLobby(sala, transport.kind, why);
  },
  onRoomSettings(settings) {
    state.sala?.setSettings(settings);
  },
  onCopyCode() {
    const code = state.sala ? state.sala.code.toUpperCase() : '';
    const done = () => home.renderLobby(state.sala, transport.kind, `Código ${code} copiado.`);
    copyText(code, done, () => selectCode());
  },
});

function selectCode() {
  const node = document.getElementById('sala-codigo');
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ------------------------------------------------------------------ entrada

/**
 * Objetivo de un clic o toque en partida. Sobre el nombre de un país (que
 * suele salirse de sus fronteras): ese país, en su casilla más cercana. Con
 * el dedo, además, tolerancia: si la casilla tocada no se puede atacar por
 * tierra (agua, lo tuyo, un aliado o un país sin frontera contigo), la más
 * cercana que sí, a unos 24 px (ver src/toque.js).
 */
function aimTap(sx, sy, tile, touch) {
  const { game, renderer, human } = state;
  const named = renderer?.labelAt(sx, sy, touch ? 6 : 0);
  if (named && named.player !== human) {
    const L = named;
    const [wx, wy] = camera.screenToWorld(sx, sy);
    const t = nearestTileOf(game, L.player.id, wx, wy, Math.max(8, L.r + Math.hypot(wx - L.x, wy - L.y)));
    if (t >= 0) return t;
  }
  if (!touch) return tile;
  return resolveTap(game, human, tile, Math.min(TAP_RADIUS_MAX, TAP_RADIUS_PX / camera.zoom));
}

function tileAt(sx, sy) {
  const game = state.game;
  if (!game) return -1;
  const [wx, wy] = camera.screenToWorld(sx, sy);
  const x = Math.floor(wx);
  const y = Math.floor(wy);
  if (!game.map.inBounds(x, y)) return -1;
  return game.map.index(x, y);
}

function setRatio(r) {
  state.ratio = Math.min(1, Math.max(0.01, r));
  ui.setRatio(state.ratio);
}

/** Lleva la cámara al combate de una tarjeta ("a<atacante>-<objetivo>", "b<barco>", "m<misil>"). */
function focusFront(key) {
  const game = state.game;
  if (!game) return;
  const W = game.map.width;
  let at = null;
  let danger = false;
  if (key[0] === 'a') {
    const [from, to] = key.slice(1).split('-').map(Number);
    const atk = game.players[from]?.attacks.get(to);
    if (atk && !atk.done) {
      at = game.attackFront(atk);
      danger = to === state.human?.id;
    }
  } else if (key[0] === 'b') {
    const boat = game.boats.find((b) => b.id === Number(key.slice(1)));
    if (boat) {
      const t = boat.path[boat.pos];
      at = [(t % W) + 0.5, Math.floor(t / W) + 0.5];
      danger = boat.targetId === state.human?.id;
    }
  } else if (key[0] === 'm') {
    const m = game.missiles.find((x) => x.id === Number(key.slice(1)));
    if (m) {
      at = [(m.to % W) + 0.5, Math.floor(m.to / W) + 0.5];
      danger = m.targetId === state.human?.id;
    }
  }
  if (!at) return;
  camera.flyTo(at[0], at[1], Math.max(camera.zoom, 5 / RES));
  state.ping = { x: at[0], y: at[1], t: performance.now(), danger };
}

/** Dónde está tu nación: el punto más interior de tu territorio principal. */
function myPosition() {
  const { game, human, renderer } = state;
  if (!game || !human || !human.spawned || !human.alive) return null;
  const label = renderer && renderer.labels.find((l) => l.player === human);
  if (label) return [label.x, label.y];
  return [game.map.x(human.spawnTile) + 0.5, game.map.y(human.spawnTile) + 0.5];
}

/** Vuela hasta tu nación y la marca (tecla C, botón «Mi nación» y puntero). */
function centerOnHuman() {
  const at = myPosition();
  if (!at) return;
  camera.flyTo(at[0], at[1], Math.max(camera.zoom, 3.5 / RES));
  state.ping = { x: at[0], y: at[1], t: performance.now(), danger: false };
}

// ---------------------------------------------------------------- puntero

const pointerBtn = document.getElementById('puntero');
const pointerArrow = pointerBtn.querySelector('.puntero-flecha');
let panelTop = Infinity;
let panelCheck = 0;

/**
 * Si tu nación queda fuera de la vista, coloca una flecha en el borde de la
 * pantalla que apunta hacia ella (sin tapar la barra superior ni tu panel).
 */
function updatePointer(now) {
  const at = !state.demo && state.pointerOn !== false ? myPosition() : null;
  if (!at) {
    pointerBtn.hidden = true;
    return;
  }
  if (now - panelCheck > 500) {
    panelCheck = now;
    const panel = document.getElementById('panel-jugador');
    panelTop = panel && !panel.closest('[hidden]') ? panel.getBoundingClientRect().top : camera.viewH;
  }
  const W = camera.viewW;
  const H = camera.viewH;
  // Márgenes: la punta de la flecha sobresale ~42 px del centro del botón
  const top = 96;
  const bottom = Math.min(H - 44, panelTop - 44);
  const side = 46;
  const [sx, sy] = camera.worldToScreen(at[0], at[1]);
  if (sx > side && sx < W - side && sy > top && sy < bottom) {
    pointerBtn.hidden = true; // a la vista: basta con la marca «TÚ» del mapa
    return;
  }
  const cx = W / 2;
  const cy = (top + bottom) / 2;
  const dx = sx - cx;
  const dy = sy - cy;
  const k = Math.min((W / 2 - side) / Math.max(1e-6, Math.abs(dx)), ((bottom - top) / 2) / Math.max(1e-6, Math.abs(dy)));
  pointerBtn.hidden = false;
  pointerBtn.style.transform = `translate(${Math.round(cx + dx * k - 26)}px, ${Math.round(cy + dy * k - 26)}px)`;
  // Ángulo acumulado: gira siempre por el camino corto (con atan2 a secas,
  // al cruzar ±180° la transición daba la vuelta entera)
  const target = Math.atan2(dy, dx) + Math.PI / 2;
  if (arrowAngle === null) arrowAngle = target;
  else {
    const TAU = Math.PI * 2;
    arrowAngle += ((((target - arrowAngle) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  }
  pointerArrow.style.transform = `rotate(${arrowAngle.toFixed(4)}rad)`;
}
let arrowAngle = null;

pointerBtn.addEventListener('click', centerOnHuman);

// Velocidad al mirar: solo cuando ya no juegas (has perdido) y sin conexión;
// mientras juegas, la partida va siempre a su ritmo
const speedBox = document.getElementById('velocidad');
speedBox.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  state.speed = Number(b.dataset.v);
  for (const x of speedBox.querySelectorAll('button')) x.classList.toggle('activo', x === b);
});
function updateSpeedBox() {
  const { game, human } = state;
  const show = !!(game && human && !state.demo && !state.net && !human.alive && game.phase !== 'ended');
  if (speedBox.hidden === show) speedBox.hidden = !show;
  if (!show && state.speed !== 1 && !state.demo) {
    state.speed = 1;
    for (const x of speedBox.querySelectorAll('button')) x.classList.toggle('activo', x.dataset.v === '1');
  }
}

/**
 * «Elegir por mí» en el despliegue: un sitio válido lo más lejos posible de
 * las demás naciones. Se busca con el azar del navegador, no con el de la
 * simulación (en multijugador, todos tienen que tirar los mismos dados).
 */
const START_AREA = startOffsets();

/** ¿Cabe entera la zona inicial (52 casillas) en `t`? Tierra libre de la misma masa. */
function fullStart(game, t) {
  const map = game.map;
  const cx = map.x(t);
  const cy = map.y(t);
  const body = map.landBody[t];
  for (const [dx, dy] of START_AREA) {
    const x = cx + dx;
    const y = cy + dy;
    if (!map.inBounds(x, y)) return false;
    const i = map.index(x, y);
    if (!map.isLand(i) || game.owner[i] !== 0 || map.landBody[i] !== body) return false;
  }
  return true;
}

/**
 * «Elegir por mí»: un sitio donde quepa entera la zona inicial, lejos de los
 * polos y con espacio respecto a los demás. Pasado cierto espacio, cualquiera
 * vale (al azar): antes buscaba el más alejado de todos y acababa en el
 * borde del mapa o en el Ártico.
 */
function suggestSpawn(game, human) {
  const map = game.map;
  const others = [];
  for (const p of game.players) if (p && p !== human && p.spawned && p.spawnTile >= 0) others.push(p.spawnTile);
  const yMin = Math.round(map.height * 0.08);
  const yMax = map.height - 1 - yMin;
  const roomy = (20 * RES) ** 2;
  let best = -1;
  let bestScore = -1;
  for (let k = 0; k < 800; k++) {
    const t = map.landTiles[Math.floor(Math.random() * map.landTiles.length)];
    const y = map.y(t);
    if (y < yMin || y > yMax || !game.spawnCheck(human, t).ok || !fullStart(game, t)) continue;
    let d = Infinity;
    const x = map.x(t);
    for (const s of others) d = Math.min(d, (map.x(s) - x) ** 2 + (map.y(s) - y) ** 2);
    const score = Math.min(d, roomy) + Math.random();
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  // Sin sitio así (mapas pequeños o muy llenos): cualquiera válido
  for (let k = 0; best < 0 && k < 600; k++) {
    const t = map.landTiles[Math.floor(Math.random() * map.landTiles.length)];
    if (game.spawnCheck(human, t).ok) best = t;
  }
  return best;
}

document.getElementById('dp-empezar').addEventListener('click', () => {
  // Contra la IA: empezar ya, sin esperar el resto de la cuenta atrás (DEV03)
  const { game, human } = state;
  if (state.demo || state.net || !game || !human?.spawned || game.phase !== 'spawn') return;
  game.skipSpawn();
});

/**
 * Salida que se mira durante el despliegue (DEV03): la casilla bajo el ratón
 * o, si no, la elegida. Se calcula solo cuando cambia de casilla.
 */
function updateSpawnPreview() {
  const { game, human } = state;
  if (state.demo || !game || !human || game.phase !== 'spawn') {
    if (state.spawnPreview) {
      state.spawnPreview = null;
      ui.setSpawnInfo(null);
    }
    return;
  }
  const hover = !TOUCH && state.hover.tile >= 0 ? state.hover.tile : -1;
  const tile = hover >= 0 && game.map.isLand(hover) ? hover : human.spawned ? human.spawnTile : -1;
  const key = `${tile}:${human.spawnTile}`;
  if (state.spawnKey === key) return;
  state.spawnKey = key;
  state.spawnPreview = tile >= 0 ? game.spawnInfo(human, tile) : null;
  ui.setSpawnInfo(state.spawnPreview);
}

document.getElementById('aviso-auto').addEventListener('click', () => {
  const { game, human } = state;
  if (state.demo || !game || !human || game.phase !== 'spawn') return;
  // La salida recomendada: zona entera y sitio para crecer; la misma con la misma semilla (DEV03)
  const rec = game.recommendSpawn(human);
  const t = rec.tile >= 0 ? rec.tile : suggestSpawn(game, human);
  if (t < 0) {
    ui.hint('No encuentro un buen sitio: elige tú en el mapa', 'warn');
    return;
  }
  humanIntent({ type: 'action', tile: t, ratio: state.ratio });
  camera.flyTo(game.map.x(t) + 0.5, game.map.y(t) + 0.5, Math.max(camera.zoom, 3.5 / RES));
});
document.getElementById('btn-mi-nacion').addEventListener('click', centerOnHuman);

function openNation(id) {
  ui.openNation(id);
  ui.update(state.game, state.human, state.ratio, state.buildMode);
}

/**
 * Cooperativo: reparte `n` jugadores en parejas (el último, solo si son
 * impares). Sin cooperativo, cada uno su nación.
 */
function coopGroups(n, coop) {
  const groups = [];
  for (let i = 0; i < n; i += coop ? 2 : 1) groups.push(coop && i + 1 < n ? [i, i + 1] : [i]);
  return groups;
}

/** Con roles en el cooperativo: qué decide cada uno (para evitar compras o ataques por accidente). */
const ROLE_TYPES = {
  militar: new Set(['action', 'cancelAttack', 'bank']),
  economia: new Set(['share', 'research', 'spec', 'proposeAlliance', 'respondAlliance', 'breakAlliance', 'donate', 'emoji', 'proposePact', 'respondPact', 'offerPeace', 'respondPeace', 'askHelp']),
};
const MILITARY_BUILDS = new Set(['fort', 'warship', 'missile', 'hbomb', 'mirv', 'silo', 'sam']);
const ROLE_NAMES = { militar: 'mando militar', economia: 'economía y diplomacia' };

function roleAllows(role, intent) {
  if (!role) return true;
  if (intent.type === 'build') return (role === 'militar') === MILITARY_BUILDS.has(intent.kind);
  return ROLE_TYPES[role].has(intent.type);
}

/** Toda acción del jugador pasa por aquí: local o por la red. */
function humanIntent(intent) {
  const { game, human } = state;
  if (state.demo || !human) return;
  const role = state.coop?.role;
  if (!roleAllows(role, intent)) {
    const other = role === 'militar' ? 'economia' : 'militar';
    ui.hint(`Eso lo decide ${state.coop.partnerName} (${ROLE_NAMES[other]})`, 'warn');
    return;
  }
  if (state.net) {
    state.net.localIntent(intent);
    return;
  }
  game.queueIntent({ ...intent, playerId: human.id });
}

/** Banco de tropas de la capital: 'in' guarda el 25 % de tus soldados (doc-1.8); 'out' lo saca todo. */
function bankTroops(op) {
  const { game, human } = state;
  if (state.demo || !human || !human.alive || game.phase !== 'playing' || !human.capital) return;
  humanIntent({ type: 'bank', op, ratio: op === 'in' ? BANK_STEP : 1 });
}

/** Activa (o desactiva si ya estaba) el modo de colocar un edificio. */
function setBuildMode(kind) {
  const { game, human } = state;
  if (state.demo || !human || !human.alive || game.phase !== 'playing') return;
  // Las mejoras de la capital no se colocan: se piden al momento
  if (BUILDINGS[kind] && BUILDINGS[kind].unit === 'capital') {
    state.buildMode = null;
    humanIntent({ type: 'build', kind });
    ui.update(game, human, state.ratio, state.buildMode);
    return;
  }
  state.buildMode = state.buildMode === kind ? null : kind;
  ui.update(game, human, state.ratio, state.buildMode);
}

/** Parte de tus soldados que guarda cada pulsación de «Guardar» (o X). */
const BANK_STEP = 0.25;

const buildKeys = Object.fromEntries(BUILDING_KINDS.map((k) => [BUILDINGS[k].key, k]));

const input = new Input(canvas, camera, {
  onClick(sx, sy, shift, touch = false) {
    if (state.demo || !state.human || !state.human.alive) return;
    let tile = tileAt(sx, sy);
    if (tile < 0) return;
    if (state.buildMode) {
      humanIntent({ type: 'build', tile, kind: state.buildMode });
      if (!shift) state.buildMode = null; // Mayús mantiene el modo para construir varios
      return;
    }
    if (state.game.phase === 'playing') {
      tile = aimTap(sx, sy, tile, touch);
    }
    // Los buques no se mueven (su zona se elige al botarlos); en el despliegue
    // el clic en el agua sí llega, para explicar por qué no se puede empezar ahí
    if (!state.game.map.isLand(tile) && state.game.phase !== 'spawn') return;
    humanIntent({ type: 'action', tile, ratio: state.ratio });
    // Con el dedo, unos anillos pequeños marcan a dónde va la orden
    if (touch && state.game.phase === 'playing' && state.game.owner[tile] !== state.human.id) {
      const m = state.game.map;
      state.ping = { x: m.x(tile) + 0.5, y: m.y(tile) + 0.5, t: performance.now(), danger: false, small: true };
    }
    // Información útil: lo que se espera de este ataque (aproximado)
    const g = state.game;
    const h = state.human;
    const o = g.owner[tile];
    if (g.phase === 'playing' && o !== h.id && !(o && h.allies.has(o))) {
      // El mismo envío que muestra el panel (mismo turno, misma cifra)
      const troops = ui.nextSend(h);
      if (troops >= 1) {
        // Envío y reserva; previsión; y, aparte, tu exposición si te atacan (DEV04)
        const pv = g.attackPreview(h, tile, troops);
        const who = o ? g.players[o].name : 'Tierra libre';
        const expo = pv.incoming ? ` · ⚠ te atacan con ${fmtTroops(pv.incoming)}${pv.exposure === 'alta' ? ' (tu reserva no basta)' : ''}` : '';
        ui.hint(`${who}: envías ${fmtTroops(pv.send)}, te quedan ${fmtTroops(pv.reserve)} · previsión ~${formatNumber(pv.tiles)} cas.${o ? ` (riesgo ${pv.risk})` : ''}${expo}`, pv.exposure === 'alta' || (o && pv.risk === 'alto') ? 'warn' : 'info');
      }
    }
  },
  onRightClick(sx, sy) {
    if (state.buildMode) {
      state.buildMode = null;
      return;
    }
    if (state.demo || !state.human) return;
    // Clic derecho / pulsación larga sobre otra nación: abrir su ficha
    const tile = tileAt(sx, sy);
    const owner = tile >= 0 ? state.game.owner[tile] : 0;
    if (owner && owner !== state.human.id) openNation(owner);
    else ui.closeNation();
  },
  onEscape() {
    // Escape: primero cancela lo que haya abierto (construir, ficha, desarrollo); si no hay nada, el menú
    const dev = document.getElementById('panel-desarrollo');
    const nation = document.getElementById('panel-nacion');
    if (state.buildMode || !nation.hidden || !dev.hidden) {
      state.buildMode = null;
      ui.closeNation();
      if (!dev.hidden) ui.toggleDev(false);
      return;
    }
    if (!state.demo && state.game && !hayDialogo()) openGameMenu();
  },
  buildKeys,
  onBuildKey: setBuildMode,
  onHover(sx, sy) {
    state.hover = { tile: sx < 0 ? -1 : tileAt(sx, sy), x: sx, y: sy };
    if (!state.demo && state.game && !TOUCH) ui.updateTooltip(state.game, state.hover.tile, sx, sy, camera.zoom);
  },
  onRatio: setRatio,
  onRatioStep: (d) => setRatio(state.ratio + d),
  onCenter: centerOnHuman,
});

ui.on({
  onRatio: setRatio,
  onShare: (share) => humanIntent({ type: 'share', share }),
  // Banco de tropas de la capital: guarda el 25 % de tus soldados o lo saca todo
  onBank: bankTroops,
  onUpgradeCapital: () => setBuildMode('capUp'),
  // Desarrollo y diplomacia ampliada
  onSpec: (spec) => humanIntent({ type: 'spec', spec }),
  onResearch: (tech) => humanIntent({ type: 'research', tech }),
  onPact: (id, on) => humanIntent({ type: 'proposePact', targetId: id, on }),
  onPeace: (id, tribute) => humanIntent({ type: 'offerPeace', targetId: id, tribute }),
  onAskHelp: () => humanIntent({ type: 'askHelp' }),
  onRespondOffer: (fromId, kind, accept) => humanIntent({ type: kind === 'pact' ? 'respondPact' : 'respondPeace', fromId, accept }),
  onFocusFront: focusFront,
  onExit(force) {
    // Botón «Menú»: el menú en partida (continuar, ajustes rápidos, guía, abandonar)
    if (!force && !state.demo) {
      openGameMenu();
      return;
    }
    const wasOnline = state.online;
    finishGame();
    tutorial.stop();
    startDemo();
    if (wasOnline) home.returnTo('multijugador');
  },
  /** Revancha: misma partida contra la IA; en línea, la revancha de grupo en la misma sala. */
  onRematch() {
    if (state.online) {
      if (state.sala?.isHost) openRematch();
      else joinRematch();
      return;
    }
    finishGame();
    ui.hideEnd();
    if (state.online || !state.lastOpts) {
      tutorial.stop();
      startDemo();
      return;
    }
    if (state.lastOpts.ranked === 'ia') startRanked();
    else startGame(state.lastOpts);
  },
  onBuildMode: setBuildMode,
  onFocusPlayer(id) {
    const label = state.renderer?.labels.find((l) => l.player.id === id);
    if (label) camera.flyTo(label.x, label.y, Math.max(camera.zoom, 3.5 / RES));
    if (state.human && id !== state.human.id) openNation(id);
  },
  onProposeAlliance(id) {
    const incoming = state.game.pendingRequest(id, state.human?.id);
    if (incoming) humanIntent({ type: 'respondAlliance', fromId: id, accept: true });
    else humanIntent({ type: 'proposeAlliance', targetId: id });
  },
  onBreakAlliance: (id) => humanIntent({ type: 'breakAlliance', targetId: id }),
  onDonate: (id, resource) => humanIntent({ type: 'donate', targetId: id, resource, ratio: state.ratio }),
  onEmoji: (id, emoji) => humanIntent({ type: 'emoji', targetId: id, emoji }),
  onRespondAlliance: (fromId, accept) => humanIntent({ type: 'respondAlliance', fromId, accept }),
  onCancelAttack: (targetId) => humanIntent({ type: 'cancelAttack', targetId }),
});

// -------------------------------------------------------------------- bucle

// Turnos de simulación por fotograma, como mucho: si el equipo va justo, la
// partida va un pelín más lenta en vez de dar tirones intentando recuperar
// (en el móvil, 2: un fotograma con 3 turnos y el dibujo se notaba)
const MAX_TICKS_PER_FRAME = TOUCH ? 2 : 3;

/**
 * Un fotograma. El siguiente se pide lo primero y cada parte va por separado:
 * si algo falla (simulación, dibujo, minimapa o paneles), se registra (ver
 * errores.js) y la partida sigue; antes, un solo fallo la dejaba congelada.
 */
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(250, now - state.last);
  state.last = now;
  const game = state.game;
  try {
    updateSpeedBox();
    adaptQuality(now - (state.lastRaw || now));
    state.lastRaw = now;
    if (game && game.phase !== 'ended') {
      if (state.net) {
        state.net.update();
      } else if (tutorial.holds() && !state.holdSim) {
        // Tutorial en un paso de lectura o práctica: el tiempo no corre, pero en
        // el despliegue tu elección de sitio se aplica igual (DEV02)
        if (game.phase === 'spawn') game.applyIntentsNow();
      } else if (state.speed > 0 && !state.holdSim) {
        state.acc += dt * state.speed;
        let steps = 0;
        while (state.acc >= TICK_MS && steps < MAX_TICKS_PER_FRAME) {
          state.acc -= TICK_MS;
          steps++;
          game.tick();
        }
        if (steps === MAX_TICKS_PER_FRAME) state.acc = Math.min(state.acc, TICK_MS);
      }
    }
  } catch (err) {
    reportError(err, 'simulación');
  }
  try {
    frameWorld(now, dt, game);
  } catch (err) {
    reportError(err, 'cámara y sonido');
  }
  // La partida de fondo del menú se ve atenuada y tapada: se dibuja a 20 fps
  // (15 en el móvil). Cada dibujo hace recomponer la pantalla entera, y a 60
  // fps era casi la mitad del trabajo del menú. Y si el menú la tapa del todo
  // (fondo opaco y quieto), ni se dibuja
  state.frameNo = (state.frameNo || 0) + 1;
  const demoGap = TOUCH ? 62 : 46;
  if (!state.demo || (now - (state.lastDemoDraw || 0) >= demoGap && !home.menuCovers())) {
    if (state.demo) state.lastDemoDraw = now;
    try {
      state.renderer?.draw(now, { buildMode: state.buildMode, hoverTile: state.hover.tile, ping: state.ping, spawn: state.spawnPreview });
    } catch (err) {
      reportError(err, 'dibujo del mapa');
    }
  }
  try {
    if (!state.demo && state.game && !minimapBox.classList.contains('plegado')) minimap.draw(now);
    sound.update(state.game, camera, state.human, state.demo);
    updatePointer(now);
  } catch (err) {
    reportError(err, 'minimapa y sonido');
  }
  if (!state.demo && state.human && now - state.lastHud > 200) {
    state.lastHud = now;
    try {
      ui.soloSpawn = !state.net;
      updateSpawnPreview();
      ui.update(state.game, state.human, state.ratio, state.buildMode);
      if (state.hover.tile >= 0 && !TOUCH) ui.updateTooltip(state.game, state.hover.tile, state.hover.x, state.hover.y, camera.zoom);
      if (state.net) ui.setNetNote(state.net.status);
      if (tutorial.active) tutorial.update(tutorialState());
    } catch (err) {
      reportError(err, 'paneles');
    }
    try {
      checkEnd();
    } catch (err) {
      reportError(err, 'final de partida');
    }
  }
}

/** Lo que va entre la simulación y el dibujo: resumen, cuenta atrás, demo, cámara y paneles vivos. */
function frameWorld(now, dt, game) {
  if (!state.demo && state.rec && state.rec.game === game) state.rec.update();
  // Últimos 5 s del despliegue: un «tic» por segundo
  if (game && !state.demo && game.phase === 'spawn' && state.human?.alive) {
    const left = Math.ceil(((CONFIG.spawnTicks - game.ticks) * TICK_MS) / 1000);
    if (left !== state.spawnLeft) {
      state.spawnLeft = left;
      if (left >= 1 && left <= 5) sound.play('tick', left === 1 ? 1 : 0.75, 0);
    }
  }
  // En la demo, al terminar una partida empieza otra
  if (state.demo && game && game.phase === 'ended') startDemo({ background: true });
  // Empieza la conquista: la cámara vuela a tu zona y se acerca hasta ver la
  // región (unas 80 casillas originales de ancho), aunque el mapa sea el mundo
  if (game && !state.demo && state.lastPhase === 'spawn' && game.phase === 'playing') {
    const at = myPosition();
    if (at) camera.flyTo(at[0], at[1], Math.max(camera.zoom, camera.viewW / (80 * RES)), 900);
  }
  state.lastPhase = game ? game.phase : null;

  if (state.buildMode && (state.game.phase !== 'playing' || !state.human?.alive)) state.buildMode = null;
  input.update(dt);
  camera.update(now);
  if (!state.demo) {
    ui.liveNumbers(state.game, state.human);
    ui.animate(dt);
  }
}

// ------------------------------------------------------------ arranque

installFlagSprite(document.documentElement);
applySettings();

// ------------------------------------------------------------ menú en partida

/** ¿Sigue la partida para ti (no ha acabado y sigues en pie)? */
function stillPlaying() {
  return !state.demo && state.game && state.game.phase !== 'ended' && !!state.human?.alive;
}

/** Menú en partida: la partida no se pausa (en multijugador no se puede). */
function openGameMenu() {
  const a = profile.ajustes;
  for (const input of document.querySelectorAll('#menu-partida [data-ajuste]')) input.checked = a[input.dataset.ajuste] !== false;
  document.getElementById('mp-salir').textContent = stillPlaying() ? 'Abandonar' : 'Volver al menú';
  document.getElementById('mp-nota').textContent = state.online ? 'La partida sigue para todos mientras tanto.' : 'La partida sigue mientras tanto.';
  abrirDialogo(document.getElementById('menu-partida'), { foco: '#mp-continuar' });
}
for (const input of document.querySelectorAll('#menu-partida [data-ajuste]')) {
  input.addEventListener('change', () => {
    profile.ajustes[input.dataset.ajuste] = input.checked;
    saveProfile(profile);
    applySettings();
    home.syncSettings();
  });
}
document.getElementById('mp-guia').addEventListener('click', () => abrirGuia());
// Por si el navegador descartó los lienzos sin avisar: rehace mapa, territorio y minimapa
document.getElementById('mp-repintar').addEventListener('click', () => state.renderer?.restoreCanvases());
document.getElementById('mp-salir').addEventListener('click', () => {
  cerrarDialogo(document.getElementById('menu-partida'));
  if (stillPlaying()) ui.confirmExit(!!state.ranked, { host: !!(state.online && state.net?.isHost), guests: state.sala ? Math.max(0, state.sala.players().length - 1) : 0 });
  else {
    finishGame();
    tutorial.stop();
    startDemo();
  }
});

// Acceso desde la consola del navegador para depurar: __dominia.game, __dominia.human…
window.__dominia = state;
window.__trinchera = state;
// Ctrl+Mayús+D: descarga el diagnóstico de la partida (solo con ?diag=1)
if (DIAG) {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyD' && state.diag) {
      e.preventDefault();
      state.diag.exportar();
    }
  });
}
// Identificador de reglas (para comprobar qué versión sirve el hosting)
state.version = { motor: MECH_VERSION, perfiles: Object.fromEntries(Object.entries(PROFILES).map(([k, P]) => [k, P.id])), huella: RULES_FINGERPRINT, ruleset: (rules) => roomRuleset(rules) };
{
  const v = document.getElementById('version-reglas');
  // Compilación: el sello del paquete (herramientas/empaquetar.js) o «desarrollo» con módulos sueltos
  const build = typeof window.__TRINCHERA_BUILD === 'string' ? window.__TRINCHERA_BUILD : 'desarrollo';
  state.version.build = build;
  if (v) v.textContent = `Compilación ${build} · reglas: motor ${MECH_VERSION} · perfiles ${Object.values(PROFILES).map((P) => P.id).join(' / ')} · huella ${RULES_FINGERPRINT}`;
}
state.camera = camera; // para pruebas automáticas
state.sound = sound;
state.profile = profile;

// Fallos: con qué partida y versión ocurrieron, y un aviso discreto (como
// mucho uno cada 30 s; la partida sigue)
setErrorContext(() => ({
  build: state.version.build,
  tick: state.game ? state.game.ticks : null,
  phase: state.game ? (state.demo ? 'menú' : state.game.phase) : null,
  map: state.mapSize || null,
  device: `${TOUCH ? 'táctil' : 'ratón'} · ${window.innerWidth}×${window.innerHeight} · ${navigator.userAgent.slice(0, 120)}`,
}));
let lastErrorHint = -Infinity;
setErrorNotifier(() => {
  home.renderLastError?.();
  const now = performance.now();
  if (now - lastErrorHint < 30000 || state.demo) return;
  lastErrorHint = now;
  ui.hint('Algo ha fallado, pero la partida sigue. Si se repite: Ajustes → Más → Último error', 'warn');
});
installGlobalHandlers();

// Arranque: la pantalla de carga (ya en el HTML) cubre todo mientras se
// preparan las fuentes, las banderas, el mapa del mundo, su terreno, la
// cuenta, el menú y la partida de fondo; después entra el menú. Lo que salía
// al abrir (un reto, una clasificatoria a medias…) espera a que acabe.
state.demo = true;
state.booted = false;
const afterBoot = [];
/** Ejecuta `fn` cuando haya terminado la pantalla de arranque (o ya). */
function whenBooted(fn) {
  if (state.booted) fn();
  else afterBoot.push(fn);
}
async function boot() {
  const loader = bootLoader();
  ondasAlPulsar(); // la onda dorada al pulsar los botones
  // Sonido: la música espera al menú; si el navegador ya deja sonar (o hay un
  // toque durante la carga), suena el tono de carga
  let atGate = false;
  sound.hold(true);
  sound.onUnlock = () => {
    if (!state.booted && !atGate) sound.play('carga', 0.9, 0);
  };
  sound.prime().then((ok) => {
    if (ok && !state.booted && !atGate) sound.play('carga', 0.9, 0);
  });
  const paint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const atMost = (promise, ms) => Promise.race([Promise.resolve(promise).catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))]);
  // En la web los mapas llegan aparte: la descarga empieza ya, en paralelo
  const mapsFirst = loadMapData().catch(() => {});
  try {
    loader?.step('Preparando el cuartel…', 0.1, 400, 'cuartel');
    await atMost(document.fonts?.ready, 1200);
    loader?.step('Izando las banderas…', 0.2, 400, 'banderas');
    await atMost(loadFlags(), 2000);
    loader?.step('Cartografiando el mundo…', 0.42, 900, 'mapa');
    await mapsFirst;
    // Sin los mapas no hay juego: si la descarga falla, se reintenta (con pausas cada vez más largas)
    for (let i = 0; ; i++) {
      try {
        await loadMapData();
        break;
      } catch {
        loader?.step('Sin conexión con el servidor: reintentando…', 0.42, 900, 'mapa');
        await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 1000 * 2 ** i)));
      }
    }
    await paint();
    const { map, countries } = loadRealMap('mundo');
    const cropH = Math.min(map.height, Math.round((map.width * 230) / 480));
    // Banderas de algunos países repartidos por el mundo, sobre su sitio real
    const PIN_ISOS = ['us', 'ca', 'mx', 'br', 'ar', 'gb', 'fr', 'es', 'de', 'ru', 'tr', 'eg', 'ng', 'za', 'sa', 'in', 'cn', 'jp', 'id', 'au'];
    const pins = countries
      .filter((c) => PIN_ISOS.includes(c.iso) && map.y(c.tile) < cropH)
      .map((c) => ({ iso: c.iso, x: (map.x(c.tile) + 0.5) / map.width, y: (map.y(c.tile) + 0.5) / cropH }));
    loader?.map((canvas) => {
      const data = { w: map.width, h: map.height, terrain: map.terrain, relief: map.relief, tileKm: map.tileKm * 3, river: map.river, lat: map.lat };
      paintMapPreview(canvas, data, [0, 0, map.width, cropH]);
    }, pins);
    loader?.step('Pintando relieve, costas y ríos…', 0.66, 1300, 'terreno');
    await paint();
    await paint();
    paintTerrain(map); // queda guardado: la partida de fondo lo reutiliza
    loader?.step('Sincronizando tu perfil…', 0.74, 500, 'perfil');
    await paint();
    await atMost(syncAtBoot(), 2500);
    loader?.step('Abriendo el cuartel general…', 0.84, 500, 'perfil');
    await paint();
    home.renderChip();
    home.renderHero();
    // Clasificatoria que quedó a medias al cerrar la página: cuenta como abandono
    settlePendingRanked();
    // Colas separadas (DEV07): se avisa una vez de cómo queda el rango de antes
    if (profile.rangoMigrado && !profile.ajustes.avisoColas) {
      profile.ajustes.avisoColas = Date.now();
      saveProfile(profile);
      const h = profile.rangoHistorico;
      whenBooted(() => setTimeout(() => home.flash?.(`Ahora la clasificatoria contra la IA y la de en línea tienen rangos separados. Tu rango de antes${h && !inPlacement(h) ? ` (${rankOf(h.puntos).label})` : ''} se guarda como histórico en Competitivo; las dos colas empiezan con 5 partidas de colocación a partir de tu nivel.`, true), 1200));
    }
    home.renderAll();
    loader?.step('Desplegando el frente…', 0.96, 700, 'frente');
    await paint();
    if (!state.game) startDemo({ background: true });
    await paint();
  } catch (err) {
    reportError(err, 'arranque');
    // Que el menú salga igualmente
    try {
      home.renderAll();
      if (!state.game) startDemo({ background: true });
    } catch (err2) {
      reportError(err2, 'arranque (menú)');
    }
  } finally {
    // El menú entra (escalonado) justo cuando se abren las puertas
    const inicio = document.getElementById('inicio');
    // Si todavía no puede sonar, el último paso espera un toque (no en pruebas automáticas)
    const a = profile.ajustes;
    const wantsSound = !a.silencio && (a.musica !== false || a.efectos !== false);
    const needTap = wantsSound && !sound.canPlay() && !navigator.webdriver;
    await loader?.done({
      tap: needTap
        ? () =>
            new Promise((resolve) => {
              atGate = true;
              const go = async () => {
                window.removeEventListener('pointerdown', go, true);
                window.removeEventListener('keydown', go, true);
                await atMost(sound.unlock(), 700);
                resolve();
              };
              window.addEventListener('pointerdown', go, true);
              window.addEventListener('keydown', go, true);
            })
        : null,
      onOpen: () => {
        inicio.classList.add('entrada');
        setTimeout(() => inicio.classList.remove('entrada'), 1700);
        // Se abren las puertas: fanfarria y empieza la música del menú
        sound.hold(false);
        sound.play('apertura', 1, 0);
      },
    });
    if (!loader) sound.hold(false);
    if (!loader) inicio.classList.add('entrada');
    state.booted = true;
    for (const fn of afterBoot.splice(0)) {
      try {
        fn();
      } catch (err) {
        reportError(err, 'tras el arranque');
      }
    }
  }
}
/** Al arrancar: ¿hay cuentas en este servidor? Y, con sesión, trae el perfil guardado. */
async function syncAtBoot() {
  if (!account) return;
  const ok = await account.probe();
  accountUI.setAvailable(ok);
  socialUI.setAvailable(ok);
  if (ok && account.signedIn) {
    await account.sync(profile).catch(() => {});
    onAccountChange(account.state);
  }
}
boot();
requestAnimationFrame(frame);

// Multijugador: room de Claude o, fuera de Claude, pestañas de este navegador
// En la web: servidor MQTT público (?b=N el del anfitrión, ?broker=ws… uno propio, ?red=local solo pestañas)
const startParams = new URLSearchParams(location.search);
{
  // ?reto=…: «Supera mi partida» (se quita de la dirección para no volver a preguntarlo al recargar)
  const reto = parseChallenge(startParams.get('reto'));
  if (startParams.has('reto')) {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('reto');
      history.replaceState(null, '', u.toString());
    } catch {
      /* sin history: no pasa nada */
    }
  }
  if (reto) whenBooted(() => setTimeout(() => offerChallenge(reto), 400));
}
const transportOpts = (() => {
  const b = Number(startParams.get('b'));
  return { prefer: startParams.get('red') === 'local' ? 'local' : Number.isInteger(b) && startParams.has('b') ? b : null, brokerUrl: startParams.get('broker') };
})();

/** Ficha de una invitación sin sala todavía (buscando, sin conexión o error). */
function entryStub(code) {
  return { code, roomInfo: () => cleanRoomInfo(null, 'Sala') };
}

/**
 * Enlace de invitación (?sala=CÓDIGO): la ficha aparece al momento con
 * «Buscando sala…» y termina en «Unirme» o en el motivo, con «Reintentar».
 */
function openEntry() {
  const code = state.pendingEntry;
  if (!code) return;
  if (!transport) {
    home.renderEntry(entryStub(code), { estado: 'sinred' });
    return;
  }
  openSala(code, false, { auto: false }).catch((err) => {
    if (state.pendingEntry === code) home.renderEntry(entryStub(code), { estado: 'error', detalle: err && err.message });
  });
}

let connecting = null;
function connectNet() {
  if (connecting) return connecting;
  home.setNetStatus('connecting');
  connecting = connectTransport(transportOpts).then((t) => {
    connecting = null;
    transport = t;
    state.transport = t;
    home.setNetStatus(t ? t.kind : null);
    if (t) t.lobby.onPeers(() => home.setRooms(openRooms(t)));
    if (state.pendingEntry) openEntry();
    return t;
  });
  return connecting;
}

{
  const code = normalizeCode(startParams.get('sala'));
  if (code.length === 5) {
    state.pendingEntry = code;
    home.showLobby();
    home.renderEntry(entryStub(code), { estado: 'buscando' });
  }
  connectNet();
}

// Nube: perfil entre dispositivos y clasificación global
getCloud().then(async (c) => {
  cloud = c;
  // Tabla de rangos: en Claude, su base de datos; en la web, la API PHP; si no, local
  ladder.start(c, profile.rango.temporada);
  if (!c) {
    // En la web, el bloque «Cuenta» dice si además está en tu cuenta
    home.setCloudNote(account ? '' : 'Tu perfil se guarda en este navegador.');
    home.setGlobal({ available: false });
    return;
  }
  home.setCloudNote('Tu perfil se guarda en tu cuenta y lo verás en cualquier dispositivo.');
  const remote = await pullProfile(c);
  if (remote) {
    Object.assign(profile, mergeProfiles(profile, remote));
    saveProfile(profile);
    if (!state.game || state.demo) home.renderAll();
  }
  home.setGlobal({ available: true, myId: c.id });
  watchLeaderboard(
    c,
    (rows, { stale }) => home.setGlobal({ rows, stale, error: '' }),
    (error) => home.setGlobal({ error }),
  );
});
