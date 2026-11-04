// Punto de entrada: une simulación, render, entrada e interfaz, y lleva el bucle.
import { BUILDINGS, BUILDING_KINDS, CONFIG, MAP_SIZES, TICK_MS } from './config.js';
import { generateMap } from './map.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { hexToRgb } from './colors.js';
import { hashString } from './rng.js';
import { formatPercent, formatTime } from './format.js';

const canvas = document.getElementById('lienzo');
const camera = new Camera();
const ui = new UI();

const state = {
  game: null,
  renderer: null,
  human: null,
  demo: true, // partida de fondo entre bots mientras se ve el menú
  speed: 1,
  ratio: 0.2,
  acc: 0,
  last: performance.now(),
  lastHud: 0,
  hover: { tile: -1, x: 0, y: 0 },
  buildMode: null, // tipo de edificio que se está colocando
  endShown: false,
  defeatShown: false,
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

function newGame({ seed, mapSize, bots, human }) {
  const size = MAP_SIZES[mapSize] || MAP_SIZES.mediano;
  const map = generateMap(size.w, size.h, seed);
  const game = new Game({ map, seed });
  let player = null;
  if (human) player = game.addPlayer(human.name, hexToRgb(human.color), true);
  game.addBots(bots);
  game.start();

  state.game = game;
  state.human = player;
  state.renderer = new Renderer(canvas, game, camera);
  state.acc = 0;
  state.buildMode = null;
  state.endShown = false;
  state.defeatShown = false;
  camera.fit(map.width, map.height);
  return game;
}

function startDemo() {
  state.demo = true;
  newGame({ seed: randomSeed(), mapSize: 'mediano', bots: 24, human: null });
  state.speed = 2;
  ui.showMenu();
}

function startGame(opts) {
  state.demo = false;
  const seed = opts.seed ? hashString(opts.seed) : randomSeed();
  const game = newGame({ seed, mapSize: opts.mapSize, bots: opts.bots, human: { name: opts.name, color: opts.color } });
  game.onEvent = (evt) => ui.pushEvent(evt);
  for (const evt of game.eventLog) ui.pushEvent(evt);
  state.speed = 1;
  ui.setSpeed(1);
  ui.setRatio(state.ratio);
  ui.showHud();
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

function setSpeed(s) {
  state.speed = s;
  ui.setSpeed(s);
}

function centerOnHuman() {
  const { game, human } = state;
  if (!game || !human || !human.spawned) return;
  const label = state.renderer.labels.find((l) => l.player === human);
  const t = human.spawnTile;
  if (label) camera.centerOn(label.x, label.y);
  else camera.centerOn(game.map.x(t), game.map.y(t));
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
      state.game.queueIntent({ type: 'build', playerId: state.human.id, tile, kind: state.buildMode });
      if (!shift) state.buildMode = null; // Mayús mantiene el modo para construir varios
      return;
    }
    state.game.queueIntent({ type: 'action', playerId: state.human.id, tile, ratio: state.ratio });
  },
  onRightClick() {
    state.buildMode = null;
  },
  onEscape() {
    state.buildMode = null;
  },
  buildKeys,
  onBuildKey: setBuildMode,
  onHover(sx, sy) {
    state.hover = { tile: sx < 0 ? -1 : tileAt(sx, sy), x: sx, y: sy };
    if (!state.demo && state.game) ui.updateTooltip(state.game, state.hover.tile, sx, sy);
  },
  onRatio: setRatio,
  onRatioStep: (d) => setRatio(state.ratio + d),
  onTogglePause() {
    if (state.demo) return;
    setSpeed(state.speed === 0 ? 1 : 0);
  },
  onCenter: centerOnHuman,
});
ui.on({
  onStart: startGame,
  onRatio: setRatio,
  onSpeed: setSpeed,
  onExit(force) {
    if (!force && !state.demo && state.game.phase !== 'ended' && state.human?.alive) {
      ui.confirmExit();
      return;
    }
    startDemo();
  },
  onBuildMode: setBuildMode,
  onFocusPlayer(id) {
    const label = state.renderer?.labels.find((l) => l.player.id === id);
    if (label) camera.centerOn(label.x, label.y);
  },
  onCancelAttack(targetId) {
    if (state.human) state.game.queueIntent({ type: 'cancelAttack', playerId: state.human.id, targetId });
  },
});

// -------------------------------------------------------------------- bucle

function checkEnd() {
  const { game, human } = state;
  if (state.demo || !human) return;
  const seconds = (Math.max(0, game.ticks - CONFIG.spawnTicks) * TICK_MS) / 1000;
  if (game.phase === 'ended' && !state.endShown) {
    state.endShown = true;
    if (game.winner === human) {
      ui.showEnd('¡Victoria!', `Has conquistado el ${formatPercent(human.tiles / game.map.landCount)} del mundo en ${formatTime(seconds)}.`);
    } else {
      ui.showEnd('Fin de la partida', `${game.winner.name} domina el mundo.\nTu máximo: ${formatPercent(human.maxTilesReached / game.map.landCount)} del territorio.`);
    }
  } else if (!human.alive && !state.defeatShown && game.phase !== 'ended') {
    state.defeatShown = true;
    ui.showEnd('Has sido derrotado', `Aguantaste ${formatTime(seconds)}.\nTu máximo: ${formatPercent(human.maxTilesReached / game.map.landCount)} del territorio.`);
  }
}

function frame(now) {
  const dt = Math.min(250, now - state.last);
  state.last = now;
  const game = state.game;

  if (game && game.phase !== 'ended' && state.speed > 0) {
    state.acc += dt * state.speed;
    let steps = 0;
    while (state.acc >= TICK_MS && steps < 8) {
      game.tick();
      state.acc -= TICK_MS;
      steps++;
    }
    if (steps === 8) state.acc = 0; // no intentamos recuperar si el equipo va justo
  }
  // En la demo, al terminar una partida empieza otra
  if (state.demo && game && game.phase === 'ended') startDemo();

  input.update(dt);
  if (state.buildMode && (state.game.phase !== 'playing' || !state.human?.alive)) state.buildMode = null;
  state.renderer?.draw(now, { buildMode: state.buildMode, hoverTile: state.hover.tile });

  if (!state.demo && state.human && now - state.lastHud > 200) {
    state.lastHud = now;
    ui.update(state.game, state.human, state.ratio, state.buildMode);
    if (state.hover.tile >= 0) ui.updateTooltip(state.game, state.hover.tile, state.hover.x, state.hover.y);
    checkEnd();
  }
  requestAnimationFrame(frame);
}

startDemo();
requestAnimationFrame(frame);
