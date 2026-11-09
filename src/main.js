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
import { installFlagSprite } from './icons.js';
import { hashString } from './rng.js';
import { fmtTroops, formatNumber, formatPercent, formatTime } from './format.js';

import { grantAchievement, levelInfo, loadProfile, mergeProfiles, recordGame, saveProfile, titleName, nameColorOf } from './profile.js';
import { withLoading } from './loading.js';
import { Tutorial } from './tutorial.js';
import { getCloud, pullProfile, pushLeaderboard, pushProfile, watchLeaderboard } from './cloud.js';
import { connectTransport } from './net.js';
import { NetSync, RULES_FINGERPRINT, Sala, cleanRoomInfo, newRoomCode, normalizeCode, openRooms, roomName, roomRuleset } from './multiplayer.js';
import { MECH_VERSION, PROFILES } from './mecanicas.js';
import { Diagnostico } from './diagnostico.js';

/** ?diag=1: diagnóstico local de la partida (src/diagnostico.js). */
const DIAG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('diag') === '1';
import { Sound } from './sonido.js';
import { Minimap } from './minimapa.js';

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
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  camera.setView(window.innerWidth, window.innerHeight);
  state.renderer?.setDpr(dpr);
}
window.addEventListener('resize', resize);
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

function newGame({ seed, mapSize, bots, difficulty, humans, localIndex, rules = DEFAULT_RULES, loaded = null }) {
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

  state.game = game;
  state.human = game.human;
  state.mapSize = mapSize;
  // Diagnóstico local: ?diag=1 registra la partida (exportar con Ctrl+Mayús+D o __trinchera.diag.exportar())
  state.diag = DIAG ? new Diagnostico(game, { build: RULES_FINGERPRINT, mechVersion: MECH_VERSION, ruleset: roomRuleset(game.rules) }) : null;
  state.renderer = new Renderer(canvas, game, camera);
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
  if (!background) leaveOnline();
  state.demo = true;
  newGame({ seed: randomSeed(), mapSize: 'mundo', bots: 30, difficulty: 'normal', humans: [], localIndex: -1 });
  // En el móvil, la partida de fondo del menú va más tranquila (gasta menos)
  state.speed = TOUCH ? 1 : 2;
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
const minimap = new Minimap(document.getElementById('minimapa-lienzo'), (wx, wy) => camera.centerOn(wx, wy));
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
  game.onEvent = (evt) => {
    if (!state.demo) sound.onEvent(evt);
    // Botín al eliminar a alguien: monedas que vuelan del mapa a tu oro
    if (evt.loot && !state.demo && evt.tick >= game.ticks - 2 && state.renderer?.anim) {
      const [sx, sy] = camera.worldToScreen(evt.x, evt.y);
      ui.flyCoins(sx, sy, evt.weak);
      setTimeout(() => sound.play('coins', 0.9, 0), 850);
    }
    if (evt.kind === 'request') ui.addRequest(game, evt);
    else ui.pushEvent(evt);
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
  leaveOnline();
  tutorial.stop();
  const seed = opts.seed ? hashString(opts.seed) : randomSeed();
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
    enterGame(game);
    if (opts.tutorial) tutorial.start(tutorialState());
  } finally {
    state.loading = false;
  }
}

function tutorialState() {
  return { game: state.game, human: state.human, ratio: state.ratio };
}

const tutorial = new Tutorial({
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
// Un clic suave en cualquier botón del interfaz
document.addEventListener('click', (e) => {
  if (e.target instanceof Element && e.target.closest('button')) sound.play('click', 0.6, 40);
});

/** Botón de la barra superior (y tecla N): silencia o activa todo el sonido. */
function toggleMute() {
  profile.ajustes.silencio = !profile.ajustes.silencio;
  saveProfile(profile);
  applySettings();
}
document.getElementById('btn-sonido')?.addEventListener('click', toggleMute);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement) && state.game && !state.demo) toggleMute();
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
  if (state.net) state.net.stop();
  state.net = null;
  if (state.sala) state.sala.leave();
  state.sala = null;
  state.online = false;
}

/** Ajustes de partida por defecto para una sala (los del jugador). */
function defaultRoomSettings() {
  return {
    bots: Math.min(60, profile.ajustes.bots),
    mapSize: profile.ajustes.mapa,
    difficulty: profile.ajustes.dificultad,
    rules: { ...DEFAULT_RULES, ...migrateRules(profile.ajustes.reglas) },
  };
}

/**
 * Abre una sala. Anfitrión: con la configuración y los datos del formulario
 * «Crear sala» (si falla, lanza el error para que el formulario lo muestre).
 * Invitado: entra como observador y, si se puede, ocupa su plaza (con
 * `auto`, al momento; desde un enlace, tras pulsar «Unirme» en la ficha).
 */
async function openSala(code, isHost, { settings = null, info = null, auto = true } = {}) {
  if (!transport) throw new Error('Sin conexión para el multijugador.');
  leaveOnline();
  const sala = new Sala(transport, { code, isHost, me: { ...myIdentity(), name: roomName(profile.nombre, RECRUIT_TAG) }, settings: settings || defaultRoomSettings(), info });
  state.sala = sala;
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
  sala.onChange = () => render();
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
  const myPeer = sala.myPeer();
  const index = payload.players.findIndex((p) => p.peer === myPeer);
  if (index < 0) {
    home.renderLobby(sala, transport.kind, 'La partida ha empezado sin ti (la sala estaba llena). Crea otra sala.');
    return;
  }
  state.online = true;
  const game = await withLoading(
    `${mapLabel(payload.settings.mapSize)} · ${transport && transport.kind === 'local' ? 'prueba local' : 'online'}`,
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
  // Los humanos se añaden primero: el jugador i tiene id i + 1 (en cooperativo,
  // cada pareja comparte el id de su nación)
  const groups = coopGroups(payload.players.length, game.rules.coop);
  const playerOf = (i) => groups.findIndex((g) => g.includes(i)) + 1;
  const peerToPlayer = new Map(payload.players.map((p, i) => [p.peer, playerOf(i)]));
  state.net = new NetSync(sala.room, game, { isHost: sala.isHost, hostPeer, myPlayerId: playerOf(index), peerToPlayer, mySlot: index });
  state.net.onHostLeft = () => {
    if (game.phase === 'ended') return;
    const progress = finishGame();
    ui.showEnd('Partida interrumpida', 'El anfitrión ha abandonado la partida.', progress);
  };
  enterGame(game);
}

// --------------------------------------------------------------- perfil

let cloudTimer = null;
function scheduleCloudSync(delay = 2500) {
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    if (!cloud) return;
    pushProfile(cloud, profile);
    pushLeaderboard(cloud, profile);
  }, delay);
}

function gameResult() {
  const { game, human } = state;
  const seconds = (Math.max(0, game.ticks - CONFIG.spawnTicks) * TICK_MS) / 1000;
  const survived = human.alive ? seconds : (Math.max(0, human.eliminatedTick - CONFIG.spawnTicks) * TICK_MS) / 1000;
  const alliedWin = !!(game.winningAlliance && game.winningAlliance.includes(human));
  return {
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
    rivals: game.players.length - 2,
  };
}

/** Anota la partida en el perfil (una vez). Devuelve el progreso para mostrarlo. */
function finishGame() {
  const { game, human } = state;
  if (state.recorded || state.demo || !game || !human) return null;
  state.recorded = true;
  const result = gameResult();
  // Abandonos de menos de un minuto no cuentan
  if (game.phase !== 'ended' && human.alive && result.seconds < 60) return null;
  const out = recordGame(profile, result);
  scheduleCloudSync(0);
  for (const a of out.achievements) ui.pushEvent({ text: `${a.icon} Logro: ${a.name}`, kind: 'good' });
  return { ...out, level: levelInfo(profile.xp).level };
}

function checkEnd() {
  const { game, human } = state;
  if (state.demo || !human) return;
  const seconds = (Math.max(0, game.ticks - CONFIG.spawnTicks) * TICK_MS) / 1000;
  const land = game.map.landCount;
  if (game.phase === 'ended' && !state.endShown) {
    state.endShown = true;
    const progress = finishGame();
    if (game.winningAlliance && game.winningAlliance.includes(human)) {
      const others = game.winningAlliance.filter((p) => p !== human).map((p) => p.name).join(', ');
      ui.showEnd('¡Victoria en alianza!', `Solo quedáis tú y tus aliados (${others}) en ${formatTime(seconds)}.\nTu territorio: ${formatPercent(human.tiles / land)}.`, progress);
    } else if (game.winner === human) {
      ui.showEnd('¡Victoria!', `Has conquistado el ${formatPercent(human.tiles / land)} del mundo en ${formatTime(seconds)}.`, progress);
    } else if (game.winningAlliance) {
      ui.showEnd('Fin de la partida', `La alianza de ${game.winningAlliance.map((p) => p.name).join(', ')} domina el mundo.\nTu máximo: ${formatPercent(human.maxTilesReached / land)} del territorio.`, progress);
    } else {
      ui.showEnd('Fin de la partida', `${game.winner.name} domina el mundo.\nTu máximo: ${formatPercent(human.maxTilesReached / land)} del territorio.`, progress);
    }
  } else if (!human.alive && !state.defeatShown && game.phase !== 'ended') {
    state.defeatShown = true;
    const progress = finishGame();
    ui.showEnd('Has sido derrotado', `Aguantaste ${formatTime(seconds)}.\nTu máximo: ${formatPercent(human.maxTilesReached / land)} del territorio.`, progress);
  }
}

// ---------------------------------------------------------------- inicio

const home = new Home(profile, {
  onProfileChange(identity) {
    saveProfile(profile);
    if (identity) scheduleCloudSync();
    applySettings();
  },
  onQuickPlay: startGame,
  onTutorial() {
    startGame({ tutorial: true, title: 'Tutorial', mapSize: 'pequeno', bots: 5, difficulty: 'facil', seed: 'trinchera-tutorial', rules: DEFAULT_RULES });
  },
  onSettings: applySettings,
  sound: (name) => sound.play(name, 0.9, 0),
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
    sala.setReady(!sala.myReadyValid());
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
    leaveOnline();
    if (state.pendingEntry) {
      // La invitación ya se ha usado: fuera de la dirección (una recarga no vuelve a ella)
      state.pendingEntry = null;
      const url = new URL(location.href);
      for (const k of ['sala', 'b']) url.searchParams.delete(k);
      history.replaceState(null, '', url);
    }
    home.show();
    home.openPanel('online');
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
  pointerArrow.style.transform = `rotate(${Math.atan2(dy, dx) + Math.PI / 2}rad)`;
}

pointerBtn.addEventListener('click', centerOnHuman);
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
  militar: new Set(['action', 'cancelAttack', 'moveWarship']),
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

/** Activa (o desactiva si ya estaba) el modo de colocar un edificio. */
function setBuildMode(kind) {
  const { game, human } = state;
  if (state.demo || !human || !human.alive || game.phase !== 'playing') return;
  state.buildMode = state.buildMode === kind ? null : kind;
  ui.update(game, human, state.ratio, state.buildMode);
}

const buildKeys = Object.fromEntries(BUILDING_KINDS.map((k) => [BUILDINGS[k].key, k]));

const input = new Input(canvas, camera, {
  onClick(sx, sy, shift) {
    if (state.demo || !state.human || !state.human.alive) return;
    const tile = tileAt(sx, sy);
    if (tile < 0) return;
    if (state.buildMode) {
      humanIntent({ type: 'build', tile, kind: state.buildMode });
      if (!shift) state.buildMode = null; // Mayús mantiene el modo para construir varios
      return;
    }
    if (!state.game.map.isLand(tile)) return; // los buques no se mueven: su zona se elige al botarlos
    humanIntent({ type: 'action', tile, ratio: state.ratio });
    // Información útil: lo que se espera de este ataque (aproximado)
    const g = state.game;
    const h = state.human;
    const o = g.owner[tile];
    if (g.phase === 'playing' && o !== h.id && !(o && h.allies.has(o))) {
      // El mismo envío que muestra el panel (mismo turno, misma cifra)
      const troops = ui.nextSend(h);
      if (troops >= 1) {
        const e = g.estimateAttack(h, o, troops);
        const who = o ? g.players[o].name : 'tierra libre';
        ui.hint(`${who}: ~${formatNumber(e.tiles)} casillas con ${fmtTroops(troops)} soldados${o ? ` · riesgo ${e.risk}` : ''}${e.uncertain ? ' (incierto)' : ''}`, o && e.risk === 'alto' ? 'warn' : 'info');
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
    state.buildMode = null;
    ui.closeNation();
  },
  buildKeys,
  onBuildKey: setBuildMode,
  onHover(sx, sy) {
    state.hover = { tile: sx < 0 ? -1 : tileAt(sx, sy), x: sx, y: sy };
    if (!state.demo && state.game && !TOUCH) ui.updateTooltip(state.game, state.hover.tile, sx, sy);
  },
  onRatio: setRatio,
  onRatioStep: (d) => setRatio(state.ratio + d),
  onCenter: centerOnHuman,
});

ui.on({
  onRatio: setRatio,
  onShare: (share) => humanIntent({ type: 'share', share }),
  // Desarrollo y diplomacia ampliada
  onSpec: (spec) => humanIntent({ type: 'spec', spec }),
  onResearch: (tech) => humanIntent({ type: 'research', tech }),
  onPact: (id, on) => humanIntent({ type: 'proposePact', targetId: id, on }),
  onPeace: (id, tribute) => humanIntent({ type: 'offerPeace', targetId: id, tribute }),
  onAskHelp: () => humanIntent({ type: 'askHelp' }),
  onRespondOffer: (fromId, kind, accept) => humanIntent({ type: kind === 'pact' ? 'respondPact' : 'respondPeace', fromId, accept }),
  onFocusFront: focusFront,
  onExit(force) {
    if (!force && !state.demo && state.game.phase !== 'ended' && state.human?.alive) {
      ui.confirmExit();
      return;
    }
    finishGame();
    tutorial.stop();
    startDemo();
  },
  onBuildMode: setBuildMode,
  onFocusPlayer(id) {
    const label = state.renderer?.labels.find((l) => l.player.id === id);
    if (label) camera.centerOn(label.x, label.y);
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

function frame(now) {
  const dt = Math.min(250, now - state.last);
  state.last = now;
  const game = state.game;
  adaptQuality(now - (state.lastRaw || now));
  state.lastRaw = now;

  if (game && game.phase !== 'ended') {
    if (state.net) {
      state.net.update();
    } else if (state.speed > 0) {
      state.acc += dt * state.speed;
      let steps = 0;
      // Como mucho 3 turnos por fotograma: si el equipo va justo, la partida
      // va un pelín más lenta en vez de dar tirones intentando recuperar
      while (state.acc >= TICK_MS && steps < 3) {
        game.tick();
        state.acc -= TICK_MS;
        steps++;
      }
      if (steps === 3) state.acc = Math.min(state.acc, TICK_MS);
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
  // La partida de fondo del menú, en el móvil, se dibuja a 30 fps (casi no se ve)
  state.frameNo = (state.frameNo || 0) + 1;
  if (!(state.demo && TOUCH && state.frameNo & 1)) {
    state.renderer?.draw(now, { buildMode: state.buildMode, hoverTile: state.hover.tile, ping: state.ping });
  }
  if (!state.demo && state.game && !minimapBox.classList.contains('plegado')) minimap.draw(now);
  sound.update(state.game, camera, state.human, state.demo);
  updatePointer(now);

  if (!state.demo && state.human && now - state.lastHud > 200) {
    state.lastHud = now;
    ui.update(state.game, state.human, state.ratio, state.buildMode);
    if (state.hover.tile >= 0 && !TOUCH) ui.updateTooltip(state.game, state.hover.tile, state.hover.x, state.hover.y);
    if (state.net) ui.setNetNote(state.net.status);
    if (tutorial.active) tutorial.update(tutorialState());
    checkEnd();
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ arranque

installFlagSprite(document.documentElement);
applySettings();

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

// El menú se pinta enseguida; el mapa de fondo (grande) se prepara justo después
state.demo = true;
requestAnimationFrame(() => setTimeout(() => {
  if (!state.game) startDemo({ background: true });
}, 30));
requestAnimationFrame(frame);

// Multijugador: room de Claude o, fuera de Claude, pestañas de este navegador
// En la web: servidor MQTT público (?b=N el del anfitrión, ?broker=ws… uno propio, ?red=local solo pestañas)
const startParams = new URLSearchParams(location.search);
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
  if (!c) {
    home.setCloudNote('Tu perfil se guarda en este navegador.');
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
