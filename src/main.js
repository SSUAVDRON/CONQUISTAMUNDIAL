// Punto de entrada: inicio, partidas (contra la IA y online), bucle, perfil y
// nube. La simulación vive en game.js; aquí solo se orquesta.
import { BUILDINGS, BUILDING_KINDS, CONFIG, DEFAULT_RULES, MAP_SIZES, REAL_MAPS, TICK_MS, mapLabel } from './config.js';
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
import { formatPercent, formatTime } from './format.js';
import { grantAchievement, levelInfo, loadProfile, mergeProfiles, recordGame, saveProfile, titleName } from './profile.js';
import { withLoading } from './loading.js';
import { Tutorial } from './tutorial.js';
import { getCloud, pullProfile, pushLeaderboard, pushProfile, watchLeaderboard } from './cloud.js';
import { connectTransport } from './net.js';
import { NetSync, Sala, newRoomCode, normalizeCode, openRooms } from './multiplayer.js';

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

function resize() {
  const dpr = window.devicePixelRatio || 1;
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
  const players = humans.map((h) => {
    let name = h.name;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${h.name} ${n}`;
    used.add(name.toLowerCase());
    const p = game.addPlayer(name, hexToRgb(h.color), true);
    p.emblem = h.emblem;
    p.pattern = h.pattern;
    return p;
  });
  game.human = localIndex >= 0 ? players[localIndex] : null;
  game.addBots(bots, difficulty, countries);
  game.start();

  state.game = game;
  state.human = game.human;
  state.mapSize = mapSize;
  state.renderer = new Renderer(canvas, game, camera);
  applySettings();
  state.acc = 0;
  state.buildMode = null;
  state.endShown = false;
  state.defeatShown = false;
  state.recorded = false;
  camera.fit(map.width, map.height);
  return game;
}

function startDemo() {
  leaveOnline();
  state.demo = true;
  newGame({ seed: randomSeed(), mapSize: 'mundo', bots: 30, difficulty: 'normal', humans: [], localIndex: -1 });
  state.speed = 2;
  ui.hideHud();
  ui.closeNation();
  home.show();
}

function enterGame(game) {
  state.demo = false;
  game.onEvent = (evt) => (evt.kind === 'request' ? ui.addRequest(game, evt) : ui.pushEvent(evt));
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
function applySettings() {
  const a = profile.ajustes;
  if (state.renderer) state.renderer.options = { badges: a.marcadores !== false, emojis: a.emojis !== false };
  ui.redAlert = a.alerta !== false;
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

async function openSala(code, isHost) {
  if (!transport) return;
  leaveOnline();
  const settings = {
    bots: Math.min(50, profile.ajustes.bots),
    mapSize: profile.ajustes.mapa,
    difficulty: profile.ajustes.dificultad,
    rules: { ...DEFAULT_RULES, ...profile.ajustes.reglas },
  };
  const sala = new Sala(transport, { code, isHost, me: myIdentity(), settings });
  state.sala = sala;
  home.showLobby();
  home.renderLobby(sala, transport.kind, 'Entrando en la sala…');
  sala.onChange = () => {
    if (state.sala !== sala || sala.started) return;
    const host = sala.host();
    const busy = !isHost && host && host.presence.estado === 'jugando';
    home.renderLobby(sala, transport.kind, busy ? 'Esta partida ya ha empezado. Espera a la siguiente o crea otra sala.' : '');
  };
  sala.onStart = (payload, hostPeer) => beginOnlineGame(sala, payload, hostPeer);
  try {
    await sala.open();
  } catch (err) {
    const code = err && err.code;
    const why =
      code === 'not_permitted'
        ? 'No tienes permiso para jugar online en este enlace (hace falta acceso de colaborador).'
        : code === 'limit_reached'
          ? 'Hay demasiadas salas abiertas ahora mismo. Inténtalo en un momento.'
          : 'No se ha podido entrar en la sala. Inténtalo de nuevo.';
    home.renderLobby(sala, transport.kind, why);
    return;
  }
  if (state.sala === sala) sala.onChange();
  if (!isHost) {
    setTimeout(() => {
      if (state.sala === sala && !sala.started && !sala.host()) {
        home.renderLobby(sala, transport.kind, 'No hay nadie en esa sala. Revisa el código.');
      }
    }, 5000);
  }
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
    `${mapLabel(payload.settings.mapSize)} · online`,
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
  // Los humanos se añaden primero: el jugador i tiene id i + 1
  const peerToPlayer = new Map(payload.players.map((p, i) => [p.peer, i + 1]));
  state.net = new NetSync(sala.room, game, { isHost: sala.isHost, hostPeer, myPlayerId: index + 1, peerToPlayer });
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
  },
  onQuickPlay: startGame,
  onTutorial() {
    startGame({ tutorial: true, title: 'Tutorial', mapSize: 'pequeno', bots: 5, difficulty: 'facil', seed: 'trinchera-tutorial', rules: DEFAULT_RULES });
  },
  onSettings: applySettings,
  onCreateRoom() {
    if (transport) openSala(newRoomCode(), true);
  },
  onJoinRoom(text) {
    const code = normalizeCode(text);
    if (code.length !== 5) {
      home.setNetStatus(transport ? transport.kind : null, 'El código tiene 5 letras o números.');
      return;
    }
    openSala(code, false);
  },
  onLeaveRoom() {
    leaveOnline();
    home.show();
  },
  onStartRoom() {
    state.sala?.start();
  },
  onRoomSettings(settings) {
    state.sala?.setSettings(settings);
  },
  onCopyCode() {
    const code = state.sala ? state.sala.code.toUpperCase() : '';
    const done = () => home.renderLobby(state.sala, transport.kind, `Código ${code} copiado.`);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(done, () => selectCode());
    } else {
      selectCode();
    }
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
  camera.flyTo(at[0], at[1], Math.max(camera.zoom, 5));
  state.ping = { x: at[0], y: at[1], t: performance.now(), danger };
}

function centerOnHuman() {
  const { game, human } = state;
  if (!game || !human || !human.spawned) return;
  const label = state.renderer.labels.find((l) => l.player === human);
  if (label) camera.centerOn(label.x, label.y);
  else camera.centerOn(game.map.x(human.spawnTile), game.map.y(human.spawnTile));
}

function openNation(id) {
  ui.openNation(id);
  ui.update(state.game, state.human, state.ratio, state.buildMode);
}

/** Toda acción del jugador pasa por aquí: local o por la red. */
function humanIntent(intent) {
  const { game, human } = state;
  if (state.demo || !human) return;
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
    if (!state.game.map.isLand(tile)) {
      // Clic en el mar: mover el buque propio más cercano
      if (state.human.buildings.warship) humanIntent({ type: 'moveWarship', tile });
      return;
    }
    humanIntent({ type: 'action', tile, ratio: state.ratio });
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
    if (!state.demo && state.game) ui.updateTooltip(state.game, state.hover.tile, sx, sy);
  },
  onRatio: setRatio,
  onRatioStep: (d) => setRatio(state.ratio + d),
  onCenter: centerOnHuman,
});

ui.on({
  onRatio: setRatio,
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

  if (game && game.phase !== 'ended') {
    if (state.net) {
      state.net.update();
    } else if (state.speed > 0) {
      state.acc += dt * state.speed;
      let steps = 0;
      while (state.acc >= TICK_MS && steps < 8) {
        game.tick();
        state.acc -= TICK_MS;
        steps++;
      }
      if (steps === 8) state.acc = 0; // no intentamos recuperar si el equipo va justo
    }
  }
  // En la demo, al terminar una partida empieza otra
  if (state.demo && game && game.phase === 'ended') startDemo();

  if (state.buildMode && (state.game.phase !== 'playing' || !state.human?.alive)) state.buildMode = null;
  input.update(dt);
  camera.update(now);
  state.renderer?.draw(now, { buildMode: state.buildMode, hoverTile: state.hover.tile, ping: state.ping });

  if (!state.demo && state.human && now - state.lastHud > 200) {
    state.lastHud = now;
    ui.update(state.game, state.human, state.ratio, state.buildMode);
    if (state.hover.tile >= 0) ui.updateTooltip(state.game, state.hover.tile, state.hover.x, state.hover.y);
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
state.profile = profile;

startDemo();
requestAnimationFrame(frame);

// Multijugador: room de Claude o, fuera de Claude, pestañas de este navegador
home.setNetStatus('connecting');
connectTransport().then((t) => {
  transport = t;
  state.transport = t;
  home.setNetStatus(t ? t.kind : null);
  if (t) t.lobby.onPeers(() => home.setRooms(openRooms(t)));
});

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
