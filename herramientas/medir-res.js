// Coste de la resolución del mapa: memoria y tiempo por turno de la partida
// rápida en el mundo (90 naciones de la IA y sus colonias), sin pantalla.
//
//   node --expose-gc herramientas/medir-res.js [turnos]
//
// Imprime la resolución (RES), las casillas del mundo, el tiempo de carga, el
// tiempo medio y el percentil 95 por turno en tres tramos de la partida y la
// memoria de JavaScript usada.
import { performance } from 'node:perf_hooks';
import { DEFAULT_RULES, RES, colonyCount } from '../src/config.js';
import { Game } from '../src/game.js';
import { loadRealMap } from '../src/map.js';

const TURNS = Number(process.argv[2]) || 3000;
const BOTS = 90;
const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;
const gc = () => globalThis.gc && globalThis.gc();

gc();
const heap0 = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
let t0 = performance.now();
const { map, countries } = loadRealMap('mundo');
const loadMs = performance.now() - t0;
t0 = performance.now();
const game = new Game({ map, seed: 7, rules: { ...DEFAULT_RULES } });
const h = game.addPlayer('Yo', [40, 120, 255], true);
game.human = h;
game.addBots(BOTS, 'normal', countries);
game.addColonies(colonyCount(map.landCount, BOTS));
game.start();
const setupMs = performance.now() - t0;
while (game.phase !== 'playing') game.tick();
const spans = [];
let cur = [];
for (let i = 1; i <= TURNS; i++) {
  const a = performance.now();
  game.tick();
  cur.push(performance.now() - a);
  if (i % Math.floor(TURNS / 3) === 0) {
    spans.push(cur);
    cur = [];
  }
}
gc();
const mem = process.memoryUsage();
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];
const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
console.log(`RES ${RES} · mundo ${map.width}×${map.height} = ${(map.width * map.height / 1e6).toFixed(2)} M casillas (${(map.landCount / 1e6).toFixed(2)} M de tierra)`);
console.log(`carga del mapa ${loadMs.toFixed(0)} ms · preparar la partida ${setupMs.toFixed(0)} ms`);
spans.forEach((s, i) => console.log(`turnos tramo ${i + 1}: media ${avg(s).toFixed(2)} ms · p95 ${p95(s).toFixed(2)} ms`));
console.log(`memoria JS: ${mb(mem.heapUsed + mem.arrayBuffers - heap0)} (montón ${mb(mem.heapUsed)} + búferes ${mb(mem.arrayBuffers)})`);
console.log(`ocupación a los ${TURNS / 10} s: ${((100 * game.players.reduce((s, p) => s + (p && p.alive ? p.tiles : 0), 0)) / map.landCount).toFixed(0)} %`);
