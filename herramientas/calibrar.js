// Calibración del perfil Clásico (auditoría técnica, protocolo de medición).
//
//   node herramientas/calibrar.js            → escribe docs/calibracion-clasico.md
//   node herramientas/calibrar.js --rapido   → menos repeticiones (para probar el script)
//
// Sin pantalla y determinista: mismas semillas para cada valor de cada barrido.
// Escenarios:
//   A. Regeneración a igual reserva y techo que las lecturas del HUD de FrontWars.
//   B. Reposo: oro, reserva, techo y tasa a lo largo de los dos primeros minutos.
//   C. Tierra libre: barrido de paceNeutral (PROVISIONAL), envíos al 10/20/40 %,
//      segundo envío y cancelación; objetivos de 100/250/500 casillas.
//   D. Contacto y retirada: D/A = 0,5 / 1 / 2, con y sin puesto, colonia y nación,
//      pacePvp 0,5 y 1 (PROVISIONAL).
//   E. Primera ciudad: cuándo se puede pagar, cuándo termina y cuánto sube el techo.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMap, loadRealMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { BUILDINGS, RES, TICK_MS } from '../src/config.js';
import { MECH, MECH_VERSION, PROFILES, maxTroopsFor, regenPerTick } from '../src/mecanicas.js';
import { TROOP_SCALE } from '../src/format.js';
import { buildNow } from '../tests/ayuda.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUICK = process.argv.includes('--rapido');
const SEEDS = QUICK ? [1] : [1, 2, 3];
const TPS = 1000 / TICK_MS; // turnos por segundo
const vis = (n) => n / TROOP_SCALE; // cifra visible en el HUD
const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');
const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
/** «mediana [mín–máx]», o «no llega (k/n)» si algún frente no alcanzó el objetivo. */
const stat = (xs, d = 1) => {
  const ok = xs.filter(Number.isFinite);
  if (!ok.length) return 'no llega';
  const m = fmt(median(ok), d);
  const range = ok.length > 1 ? ` [${fmt(Math.min(...ok), d)}–${fmt(Math.max(...ok), d)}]` : '';
  const miss = ok.length < xs.length ? ` · no llega ${xs.length - ok.length}/${xs.length}` : '';
  return `${m}${range}${miss}`;
};
const out = [];
const md = (s = '') => out.push(s);
const table = (head, rows) => {
  md(`| ${head.join(' | ')} |`);
  md(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) md(`| ${r.join(' | ')} |`);
  md();
};

// ------------------------------------------------------------------ escenario base

const world = loadRealMap('mundo').map;

/** Distancia (en casillas) de cada casilla de tierra a la costa más cercana. */
const coastDist = (() => {
  const d = new Int32Array(world.size).fill(-1);
  const q = new Int32Array(world.size);
  let tail = 0;
  for (let i = 0; i < world.size; i++) if (world.terrain[i] && world.coastal[i]) (d[i] = 0), (q[tail++] = i);
  const nb = new Int32Array(4);
  for (let head = 0; head < tail; head++) {
    const u = q[head];
    const c = world.neighbors(u, nb);
    for (let k = 0; k < c; k++) {
      const v = nb[k];
      if (world.terrain[v] && d[v] < 0) (d[v] = d[u] + 1), (q[tail++] = v);
    }
  }
  return d;
})();

/** Despliegue de cada semilla: tierra adentro (≥ 45 casillas de la costa), mayormente llano. */
const SPAWNS = (() => {
  const cands = [];
  for (let i = 0; i < world.size; i += 97) if (coastDist[i] >= 45 && world.terrain[i] === 1) cands.push(i);
  return SEEDS.map((s) => cands[Math.floor(((s * 2654435761) >>> 0) / 2 ** 32 * cands.length)]);
})();

/** Partida en el mundo con un humano en `spawn` y un rival lejano y quieto (para que no acabe). */
function soloGame(seed, profile, override = {}) {
  const game = new Game({ map: world, seed, rules: { profile } });
  game.profile = { ...PROFILES[profile], ...override };
  const h = game.addPlayer('Yo', [0, 0, 255], true);
  const far = game.addPlayer('Lejos', [255, 0, 0], false);
  game.human = h;
  game.start();
  game.spawnPlayer(h, SPAWNS[(seed - 1) % SPAWNS.length]);
  game.spawnPlayer(far, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  far.regenMult = 0;
  return { game, h };
}

/** Terreno del entorno del despliegue (radio 25): % de llanura, meseta y montaña. */
function terrainMix(tile) {
  const c = [0, 0, 0, 0];
  const x0 = world.x(tile);
  const y0 = world.y(tile);
  for (let dy = -25; dy <= 25; dy++) for (let dx = -25; dx <= 25; dx++) if (dx * dx + dy * dy <= 625) c[world.terrain[world.index(x0 + dx, y0 + dy)]]++;
  const land = c[1] + c[2] + c[3];
  return `${Math.round((100 * c[1]) / land)} / ${Math.round((100 * c[2]) / land)} / ${Math.round((100 * c[3]) / land)} %`;
}

// ------------------------------------------------------------------ A. regeneración

md(`# Calibración del perfil Clásico`);
md();
md(`Generado por \`node herramientas/calibrar.js\` (motor ${MECH_VERSION}, perfiles ${Object.values(PROFILES).map((P) => P.id).join(' / ')}). Simulaciones sin pantalla, deterministas; semillas ${SEEDS.join(', ')} (las mismas para cada valor de cada barrido). Cifras «visibles» = internas ÷ ${TROOP_SCALE}, como en el HUD.`);
md();
md(`Referencias de FrontWars: lecturas del HUD recogidas en la auditoría técnica (9-nov-2026). No se ha jugado FrontWars para este informe.`);
md();
md(`## A. Regeneración a igual reserva y techo`);
md();
md(`Varias lecturas de FrontWars se tomaron durante la expansión, así que no se compara la serie en el tiempo: para cada pareja reserva/techo leída en su HUD se calcula la tasa de Trinchera **con esa misma reserva y ese techo** (×${TROOP_SCALE} internos), por el mismo camino que usa el juego (\`Player.growthPerTick\`, sin bonos), y se compara con lo que mostraba su HUD.`);
md();
const FW = [
  [5890, 12100, 395],
  [6030, 13600, 436],
  [8020, 19200, 560],
  [12500, 23300, 613],
  [15200, 25400, 611],
];
const rateVisible = (profile, reserveVis, capVis) => {
  const { h } = soloGame(1, profile);
  h.mods.growth = 0;
  h.troops = reserveVis * TROOP_SCALE;
  h.maxTroops = () => capVis * TROOP_SCALE;
  return vis(h.growthPerTick() * TPS);
};
let regenOk = true;
table(
  ['Reserva / techo (visibles)', 'HUD FrontWars', 'Clásico (paceRegen 1)', 'Desvío', 'Trinchera (0,6)'],
  FW.map(([r, c, hud]) => {
    const cl = rateVisible('clasico', r, c);
    const tr = rateVisible('trinchera', r, c);
    const dev = (cl - hud) / hud;
    // Tolerancia: ±5 % o el redondeo del HUD (±0,5/s)
    if (Math.abs(dev) > 0.05 && Math.abs(cl - hud) > 0.5) regenOk = false;
    return [`${fmt(r)} / ${fmt(c)}`, `${hud}/s`, `${fmt(cl, 1)}/s`, `${dev >= 0 ? '+' : ''}${fmt(dev * 100, 1)} %`, `${fmt(tr, 1)}/s`];
  }),
);
md(regenOk ? `**Resultado:** las cinco lecturas quedan dentro de ±5 % (o del redondeo del HUD) con \`paceRegen = 1\` y sin bonos. **Se cierra paceRegen = 1 en Clásico.**` : `**Resultado:** alguna lectura sale de la tolerancia: paceRegen no se puede cerrar todavía.`);
md();
{
  const cap = maxTroopsFor(52, 0);
  md(`Curva en reposo con 52 casillas (techo ${fmt(vis(cap))} visibles): la tasa crece hasta ~42 % del techo y tiende a 0 al llenarse.`);
  md();
  table(
    ['Ocupación del techo', 'Clásico (visibles/s)'],
    [0.2, 0.4, 0.6, 0.8, 0.95, 1].map((f) => [`${Math.round(f * 100)} %`, fmt(vis(regenPerTick(cap * f, cap) * PROFILES.clasico.paceRegen * TPS), 1)]),
  );
}

// ------------------------------------------------------------------ B. reposo

md(`## B. Reposo (sin atacar ni construir)`);
md();
md(`Humano solo en el mundo, tierra adentro; tiempo desde el final del despliegue.`);
md();
for (const profile of ['clasico', 'trinchera']) {
  const { game, h } = soloGame(1, profile);
  const t0 = game.ticks;
  const rows = [];
  for (const s of [0, 5, 10, 20, 30, 60, 90, 120]) {
    while (game.ticks < t0 + s * TPS) game.tick();
    rows.push([`${s} s`, fmt(vis(h.troops)), fmt(vis(h.maxTroops())), `${fmt(vis(h.growthPerTick() * TPS))}/s`, fmt(h.gold), `${fmt(h.goldPerTick() * TPS)}/s`]);
  }
  md(`**${PROFILES[profile].name}** (${PROFILES[profile].id})`);
  md();
  table(['t', 'Reserva', 'Techo', 'Regeneración', 'Oro', 'Oro pasivo'], rows);
}
md(`En Clásico el oro pasivo es exactamente 1000/s (sin bono de capital: el perfil no tiene puntos estratégicos), como las lecturas de FrontWars (8,90k a 9 s, 35,1k a 35 s, 53,7k a 53 s).`);
md();

// ------------------------------------------------------------------ C. tierra libre

md(`## C. Tierra libre (PROVISIONAL)`);
md();
md(`Barrido de \`paceNeutral\` con las mismas ${SEEDS.length} semillas para cada valor. Terreno alrededor de cada despliegue (llanura / meseta / montaña): ${SPAWNS.map((t, i) => `semilla ${SEEDS[i]}: ${terrainMix(t)}`).join('; ')}. Coste por casilla y bajas sin tocar (documento). Tiempos en segundos desde el clic; «no llega» = ese frente se agotó antes.`);
md();

/** Un frente de expansión: envía `amount` (internas) o `ratio` en t=5 s; variantes: segundo envío o retirada en t=10 s. */
function wildFront(seed, pace, { ratio = 0.2, amount = 0, variant = 'uno' } = {}) {
  const { game, h } = soloGame(seed, 'clasico', { paceNeutral: pace });
  const t0 = game.ticks;
  while (game.ticks < t0 + 5 * TPS) game.tick();
  const tiles0 = h.tiles;
  const send = amount || Math.floor(h.troops * ratio);
  h.regenMult = 0; // la reserva no cambia durante la medida
  const reserve0 = h.troops;
  game.launchAttack(h, 0, send);
  const atk = h.attacks.get(0);
  const tc = game.ticks;
  const hit = { 100: NaN, 250: NaN, 500: NaN };
  let at4 = NaN;
  let end = NaN;
  let sent = send;
  for (let i = 0; i < 90 * TPS; i++) {
    if (variant === 'segundo' && game.ticks === tc + 5 * TPS) {
      const more = amount || Math.floor(h.troops * ratio);
      game.launchAttack(h, 0, more);
      sent += more;
    }
    if (variant === 'cancelar' && game.ticks === tc + 5 * TPS && !atk.done) game.retreat(atk);
    game.tick();
    const gained = h.tiles - tiles0;
    const s = (game.ticks - tc) / TPS;
    for (const k of [100, 250, 500]) if (!Number.isFinite(hit[k]) && gained >= k) hit[k] = s;
    if (game.ticks === tc + 4 * TPS) at4 = gained;
    if (atk.done) {
      end = s;
      break;
    }
  }
  return { hit, at4, end, gained: h.tiles - tiles0, sent, lost: reserve0 - h.troops + (atk.done ? 0 : atk.troops) };
}

const PACES = [0.07, 0.25, 0.5, 0.75, 1];
const fwProxy = 467; // ~467 casillas en 4 s (deducidas del cambio de techo en FrontWars)
md(`### Muestra comparable con FrontWars: ~1,27k visibles (12.700 internas) en el frente`);
md();
md(`En FrontWars, tras el primer clic había ~1,27k en el frente a 0:13 y 202 a 0:17; del cambio de techo (13,6k → 19,2k) la auditoría deduce **~${fwProxy} casillas en 4 s**. Es un indicador indirecto (supone la misma fórmula de techo): orienta el barrido, no cierra el valor.`);
md();
const sample = {};
{
  const rows = [];
  for (const pace of PACES) {
    const runs = SEEDS.map((s) => wildFront(s, pace, { amount: 12700 }));
    sample[pace] = median(runs.map((r) => r.at4));
    rows.push([fmt(pace, 2), stat(runs.map((r) => r.at4), 0), stat(runs.map((r) => r.hit[100])), stat(runs.map((r) => r.hit[250])), stat(runs.map((r) => r.hit[500])), stat(runs.map((r) => r.end)), stat(runs.map((r) => r.gained), 0)]);
  }
  table(['paceNeutral', 'Casillas a los 4 s', '100 cas. (s)', '250 cas. (s)', '500 cas. (s)', 'Fin del frente (s)', 'Casillas al acabar'], rows);
}
const best = PACES.reduce((a, b) => (Math.abs(sample[b] - fwProxy) < Math.abs(sample[a] - fwProxy) ? b : a));
md(`Valor más cercano al indicador de FrontWars: **paceNeutral = ${fmt(best, 2)}** (${fmt(sample[best], 0)} casillas a los 4 s frente a ~${fwProxy}). Queda como **provisional**.`);
md();
md(`Segundo indicador, también indirecto: el frente de FrontWars pasó de ~1,27k a 202 visibles en esos 4 s (~1,07k gastadas). Con las bajas por casilla del documento (1,6 / 2 / 2,4 visibles en llanura / meseta / montaña) serían ~670 / ~535 / ~445 casillas según el terreno, que no se conoce. Los dos indicadores se solapan hacia ~450–500 casillas, lo que también apunta a 0,5; con terreno llano, a 0,75–1. Hace falta la medición directa de la lista final para cerrarlo.`);
md();
md(`### Envíos al 10, 20 y 40 % de la reserva en t = 5 s`);
md();
for (const ratio of [0.1, 0.2, 0.4]) {
  const rows = [];
  for (const pace of PACES) {
    const runs = SEEDS.map((s) => wildFront(s, pace, { ratio }));
    rows.push([fmt(pace, 2), fmt(vis(median(runs.map((r) => r.sent))), 0), stat(runs.map((r) => r.hit[100])), stat(runs.map((r) => r.hit[250])), stat(runs.map((r) => r.hit[500])), stat(runs.map((r) => r.end)), stat(runs.map((r) => r.gained), 0), fmt(vis(median(runs.map((r) => r.lost))), 0)]);
  }
  md(`**${Math.round(ratio * 100)} %**`);
  md();
  table(['paceNeutral', 'Enviadas (vis.)', '100 cas. (s)', '250 cas. (s)', '500 cas. (s)', 'Fin (s)', 'Casillas', 'Bajas (vis.)'], rows);
}
md(`### Variantes al 20 %: segundo envío y cancelación a los 5 s del clic`);
md();
{
  const rows = [];
  for (const pace of PACES) {
    const two = SEEDS.map((s) => wildFront(s, pace, { variant: 'segundo' }));
    const cancel = SEEDS.map((s) => wildFront(s, pace, { variant: 'cancelar' }));
    rows.push([fmt(pace, 2), stat(two.map((r) => r.hit[500])), stat(two.map((r) => r.end)), stat(two.map((r) => r.gained), 0), stat(cancel.map((r) => r.gained), 0), fmt(vis(median(cancel.map((r) => r.lost))), 0)]);
  }
  table(['paceNeutral', 'Dos envíos: 500 cas. (s)', 'Dos envíos: fin (s)', 'Dos envíos: casillas', 'Cancelado: casillas', 'Cancelado: bajas (vis.)'], rows);
}

// ------------------------------------------------------------------ D. contacto y retirada

md(`## D. Contacto y retirada (PROVISIONAL)`);
md();
md(`Dos países vecinos en terreno llano fijo (mapa generado con toda la tierra en llanura); el defensor tiene ~1500 casillas y no regenera. Se ataca con 20.000 internas (2.000 visibles); D/A = tropas del defensor ÷ las enviadas. Se mide a los 10 s (o al acabarse el frente).`);
md();

function duel(seed, { dA = 1, pacePvp = 1, fort = false, colony = false, retreatAt = 0 } = {}) {
  const map = generateMap(160 * RES, 100 * RES, seed);
  for (let i = 0; i < map.size; i++) if (map.terrain[i]) map.terrain[i] = 1;
  const game = new Game({ map, seed, rules: { profile: 'clasico' } });
  game.profile = { ...PROFILES.clasico, pacePvp };
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 255, 0], false);
  const c = game.addPlayer('C', [0, 0, 255], false);
  game.human = a;
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const inland = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  const ta = inland[Math.floor(inland.length / 2)];
  const tb = inland.find((t) => {
    const d2 = (map.x(t) - map.x(ta)) ** 2 + (map.y(t) - map.y(ta)) ** 2;
    return d2 > (9 * RES) ** 2 && d2 < (11 * RES) ** 2;
  });
  game.spawnPlayer(a, ta);
  game.spawnPlayer(b, tb);
  game.spawnPlayer(c, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  for (let i = 0; i < 40 && !game.hasLandBorder(a, b.id); i++) {
    a.troops = 1e5;
    game.launchAttack(a, 0, 20000);
    for (let k = 0; k < 20; k++) game.tick();
  }
  for (const atk of [...a.attacks.values()]) game._endAttack(atk);
  // B también crece (unas 1500 casillas) para que el frente no se acabe por falta de país
  for (let i = 0; i < 60 && b.tiles < 1500 && game.hasWildNeighbor(b); i++) {
    b.troops = 1e5;
    game.launchAttack(b, 0, 20000);
    for (let k = 0; k < 20; k++) game.tick();
  }
  for (const atk of [...b.attacks.values()]) game._endAttack(atk);
  if (colony) b.weak = true;
  if (fort) {
    // Puesto defensivo de B en su casilla más cercana a A
    let bestT = -1;
    let bd = Infinity;
    b.gold = 1e7;
    for (const t of b.border) {
      const d = (map.x(t) - map.x(ta)) ** 2 + (map.y(t) - map.y(ta)) ** 2;
      if (d < bd && game.canBuild(b, 'fort', t).ok) (bd = d), (bestT = t);
    }
    if (bestT >= 0) buildNow(game, b, 'fort', bestT);
  }
  a.regenMult = b.regenMult = 0;
  const send = 20000;
  a.troops = 1e6;
  b.troops = send * dA;
  const a0 = a.troops;
  const b0 = b.troops;
  const tiles0 = a.tiles;
  const bTiles0 = b.tiles;
  game.launchAttack(a, b.id, send);
  const atk = a.attacks.get(b.id);
  const tc = game.ticks;
  let refund = NaN;
  let firstTile = NaN;
  let at2 = NaN;
  let end = NaN;
  for (let i = 0; i < 10 * TPS; i++) {
    if (retreatAt && game.ticks === tc + retreatAt * TPS && !atk.done) {
      const home = a.troops;
      game.retreat(atk);
      while (!atk.done) game.tick();
      refund = a.troops - home;
      break;
    }
    game.tick();
    if (!Number.isFinite(firstTile) && a.tiles > tiles0) firstTile = (game.ticks - tc) / TPS;
    if (game.ticks === tc + 2 * TPS) at2 = a.tiles - tiles0;
    if (atk.done) {
      end = (game.ticks - tc) / TPS;
      if (!Number.isFinite(at2)) at2 = a.tiles - tiles0;
      break;
    }
  }
  // Bajas del atacante: lo que falta en casa, sin contar lo que sigue en el frente
  return { gained: a.tiles - tiles0, bTiles: bTiles0, firstTile, at2, end, aLoss: a0 - a.troops - (atk.done ? 0 : atk.troops), bLoss: b0 - b.troops, refund, done: atk.done };
}

{
  const rows = [];
  for (const pacePvp of [0.5, 1]) {
    for (const dA of [0.5, 1, 2]) {
      for (const [label, opt] of [['nación', {}], ['nación + puesto', { fort: true }], ['colonia', { colony: true }]]) {
        const runs = SEEDS.map((s) => duel(s, { dA, pacePvp, ...opt }));
        rows.push([fmt(pacePvp, 1), fmt(dA, 1), label, stat(runs.map((r) => r.firstTile)), stat(runs.map((r) => r.at2), 0), stat(runs.map((r) => r.end)), stat(runs.map((r) => r.gained), 0), fmt(vis(median(runs.map((r) => r.aLoss))), 0), fmt(vis(median(runs.map((r) => r.bLoss))), 0)]);
      }
    }
  }
  table(['pacePvp', 'D/A', 'Defensor', 'Primera casilla (s)', 'Casillas a los 2 s', 'Fin del frente (s)', 'Casillas al acabar', 'Bajas atacante (vis.)', 'Bajas defensor (vis.)'], rows);
  md(`El ritmo (pacePvp) cambia cuánto tarda el frente, no cuántas casillas gana: con estas cifras el ataque se agota por bajas. En el motor, colonia y nación se resuelven igual (OpenFront aplica ×0,7 a la magnitud contra bots; no está implementado sin medirlo en FrontWars).`);
  md();
}
md(`Retirada a 1 s del clic (D/A = 1, nación), pacePvp 1: vuelve el 75 % de lo que sigue en el frente.`);
md();
{
  const runs = SEEDS.map((s) => duel(s, { dA: 1, pacePvp: 1, retreatAt: 1 }));
  table(['Semilla', 'Casillas ganadas', 'Vuelven (vis.)', 'Perdidas: combate + 25 % (vis.)'], runs.map((r, i) => [String(SEEDS[i]), fmt(r.gained), fmt(vis(r.refund)), fmt(vis(r.aLoss))]));
}
md(`En FrontWars se vio un ataque a Wolof Area con ~2.470 enviados contra ~2.490 de reserva (D/A ≈ 1) que avanzó la frontera y se cerró antes de 5 s. Aquí, con D/A = 1, el frente se cierra hacia los ~4 s con pacePvp 1 y hacia los ~8 s con 0,5: lo visto es compatible con 1. Pero sin el terreno, el tramo ni las bajas de esa muestra no se puede cerrar \`pacePvp\`: **1 queda como ensayo provisional**.`);
md();

// ------------------------------------------------------------------ E. primera ciudad

md(`## E. Primera ciudad (sin comercio ni conquistas)`);
md();
{
  const rows = [];
  for (const profile of ['clasico', 'trinchera']) {
    const { game, h } = soloGame(1, profile);
    const t0 = game.ticks;
    const price = game.buildCost(h, 'city');
    while (h.gold < price) game.tick();
    const tPay = (game.ticks - t0) / TPS;
    const capBefore = h.maxTroops();
    let site = -1;
    for (let t = 0; t < world.size && site < 0; t++) if (game.owner[t] === h.id && game.canBuild(h, 'city', t).ok) site = t;
    game.build(h, 'city', site);
    const tBuild = game.ticks;
    while (game.sites.some((b) => b.owner === h.id)) game.tick();
    const tDone = (game.ticks - t0) / TPS;
    rows.push([PROFILES[profile].name, fmt(price), `${fmt(tPay, 1)} s`, `${fmt((game.ticks - tBuild) / TPS, 1)} s`, `${fmt(tDone, 1)} s`, `+${fmt(vis(h.maxTroops() - capBefore))}`]);
  }
  table(['Perfil', 'Precio', 'Se puede pagar a', 'Obra', 'Terminada a', 'Techo (vis.)'], rows);
  md(`Obra de ${BUILDINGS.city.build} turnos; la ciudad suma ${fmt(vis(MECH.cityCapBonus))} visibles al techo al terminar, con el territorio quieto. En FrontWars el techo pasó de 25,6k a 50,9k mientras cambiaba el territorio: falta medirlo con el mapa quieto para comparar.`);
  md();
}

// ------------------------------------------------------------------ resumen

md(`## Resumen y valores del perfil Clásico`);
md();
table(
  ['Parámetro', 'Valor', 'Estado'],
  [
    ['paceRegen', fmt(PROFILES.clasico.paceRegen, 2), regenOk ? 'cerrado (A dentro de tolerancia)' : 'abierto'],
    ['paceNeutral', fmt(PROFILES.clasico.paceNeutral, 2), `provisional (barrido C: el más cercano al indicador es ${fmt(best, 2)})`],
    ['pacePvp', fmt(PROFILES.clasico.pacePvp, 2), 'provisional (D: sin muestra comparable)'],
    ['Oro pasivo', '1000/s', 'cuadra con FrontWars (B)'],
    ['Primera ciudad', '125.000', 'precio igual; delta de techo pendiente de medir en FrontWars'],
  ],
);
md(`### Mediciones de FrontWars que faltan para cerrar los provisionales`);
md();
md(`1. Tierra libre: con el mapa y el despliegue registrados, casillas propias exactas (o recorte al mismo zoom) a 100/250/500 y fin del frente tras un clic al 10, 20 y 40 %, tres repeticiones.`);
md(`2. Combate: D/A = 0,5 / 1 / 2 contra nación y colonia, con y sin puesto, en terreno y tramo fijos: primera casilla, avance a los 10 s y bajas de los dos lados.`);
md(`3. Retirada: plazo, reembolso y estado de la tarjeta en un caso medido.`);
md(`4. Primera ciudad: incremento del techo con el territorio quieto.`);
md();

console.log(out.join('\n'));
if (!QUICK) {
  // Solo la ejecución completa (tres semillas) escribe el informe
  await mkdir(join(ROOT, 'docs'), { recursive: true });
  const file = join(ROOT, 'docs', 'calibracion-clasico.md');
  await writeFile(file, `${out.join('\n')}\n`);
  console.error(`\nInforme: ${file}`);
}
