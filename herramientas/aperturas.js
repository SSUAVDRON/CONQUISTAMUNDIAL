// Calibración de aperturas (auditoría DEV09 y DEV03).
//
//   node herramientas/aperturas.js            → escribe docs/aperturas.md
//   node herramientas/aperturas.js --rapido   → una semilla y un perfil (para probar el script)
//
// Tres aperturas con las mismas órdenes, en la partida rápida de verdad (el
// mundo con 90 naciones de la IA, sus colonias y la dificultad normal):
//   · Expansión: todo a crecer (un 25 % de las tropas a tierra libre cada vez
//     que no hay frente abierto) y ninguna obra.
//   · Economía: pueblos en cuanto se pueden pagar y un 15 % a crecer.
//   · Banco y defensa: guarda el 40 % en la capital cada 15 s, la mejora en
//     cuanto puede y un 15 % a crecer.
// Cada semilla se juega con dos salidas: la recomendada (game.recommendSpawn,
// la del botón «Elegir por mí») y una al azar repetible. Las naciones y las
// colonias son las mismas en las seis partidas de cada semilla.
//
// Se registra a los 0, 30, 60 y 120 s desde el final del despliegue:
// territorio, techo, tropas disponibles, tropas comprometidas (ataques y
// barcos), banco, oro, ingreso pasivo y primera obra; además, los ataques que
// entran antes del primer minuto y si la zona inicial salió completa, con el
// terreno, la costa y la nación más cercana de cada salida.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRealMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { BUILDINGS, DEFAULT_RULES, TICK_MS, colonyCount } from '../src/config.js';
import { MECH_VERSION, PROFILES } from '../src/mecanicas.js';
import { TROOP_SCALE } from '../src/format.js';
import { Rng, hashString } from '../src/rng.js';
import { describeSpawn } from '../src/salida.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUICK = process.argv.includes('--rapido');
const SEEDS = QUICK ? [1] : [1, 2, 3];
const PROFILE_LIST = QUICK ? ['clasico'] : ['clasico', 'trinchera'];
const BOTS = 90;
const DIFFICULTY = 'normal';
const TPS = 1000 / TICK_MS;
const MARKS = [0, 30, 60, 120];
const STRATEGIES = {
  expansion: { name: 'Expansión' },
  economia: { name: 'Economía' },
  banco: { name: 'Banco y defensa' },
};
const SPAWN_KINDS = { recomendada: 'Recomendada', azar: 'Al azar' };

const vis = (n) => n / TROOP_SCALE; // como en el HUD
const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');
const k = (n) => {
  const v = vis(n);
  return Math.abs(v) >= 1000 ? `${fmt(v / 1000, 1)}k` : fmt(v);
};
const gold = (n) => (Math.abs(n) >= 1000 ? `${fmt(n / 1000, 1)}k` : fmt(n));
const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const out = [];
const md = (s = '') => out.push(s);
const table = (head, rows) => {
  md(`| ${head.join(' | ')} |`);
  md(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) md(`| ${r.join(' | ')} |`);
  md();
};

const world = loadRealMap('mundo');

/** La partida rápida del menú (mismas naciones y colonias para una semilla). */
function newGame(seed, profile) {
  const { map, countries } = loadRealMap('mundo');
  const game = new Game({ map, seed, rules: { ...DEFAULT_RULES, profile } });
  const h = game.addPlayer('Yo', [40, 120, 255], true);
  game.human = h;
  game.addBots(BOTS, DIFFICULTY, countries);
  game.addColonies(colonyCount(map.landCount, BOTS));
  game.start();
  return { game, h };
}

/** Una salida al azar, repetible por semilla (sin gastar el azar de la partida). */
function randomSpawn(game, h, seed) {
  const rng = new Rng(hashString(`aperturas-azar:${seed}`));
  const land = game.map.landTiles;
  for (let i = 0; i < 20000; i++) {
    const t = land[Math.floor(rng.float() * land.length)];
    if (game.owner[t] === 0 && game.spawnCheck(h, t).ok) return t;
  }
  return game.findSpawnTile();
}

/** Casilla propia para un pueblo (no en la frontera), recorriendo su territorio desde la capital. */
function villageTile(game, h) {
  const map = game.map;
  const start = h.capital ? h.capital.tile : -1;
  if (start < 0) return -1;
  const seen = new Set([start]);
  const queue = [start];
  const nb = new Int32Array(4);
  for (let head = 0; head < queue.length && head < 4000; head++) {
    const t = queue[head];
    if (!h.border.has(t) && game.canBuild(h, 'village', t).ok) return t;
    const c = map.neighbors(t, nb);
    for (let i = 0; i < c; i++) {
      const v = nb[i];
      if (!seen.has(v) && game.owner[v] === h.id) seen.add(v), queue.push(v);
    }
  }
  return -1;
}

function committed(game, h) {
  let sum = h.troopsInAttacks();
  for (const b of game.boats) if (b.owner === h.id) sum += b.troops;
  return sum;
}

/** Órdenes de una apertura en un segundo `s` de juego (las mismas en todas las partidas). */
function orders(strategy, game, h, s, log) {
  const front = h.attacks.get(0);
  const expanding = front && !front.done;
  const share = strategy === 'expansion' ? 0.25 : 0.15;
  if (!expanding && h.troops > 50) game.launchAttack(h, 0, Math.floor(h.troops * share));
  const tryBuild = (kind, tile) => {
    if (!game.build(h, kind, tile)) return false;
    if (!log.first) log.first = { kind, s };
    return true;
  };
  if (strategy === 'economia') {
    if (h.gold >= game.buildCost(h, 'village')) {
      const t = villageTile(game, h);
      if (t >= 0) tryBuild('village', t);
    }
  } else if (strategy === 'banco') {
    if (s >= 5 && s % 15 === 5) game.bankDeposit(h, 0.4);
    const cap = h.capital;
    if (cap && !cap.work && h.gold >= game.buildCost(h, 'capUp') && game.canBuild(h, 'capUp').ok) tryBuild('capUp', -1);
  }
}

function snapshot(game, h) {
  return {
    tiles: h.tiles,
    share: h.tiles / game.map.landCount,
    cap: h.maxTroops(),
    troops: h.troops,
    committed: committed(game, h),
    bank: h.capital ? h.capital.bank || 0 : 0,
    gold: h.gold,
    income: h.goldPerTick() * TPS,
    alive: h.alive,
  };
}

/** Juega una apertura y devuelve sus marcas, la salida y los ataques recibidos. */
function play(seed, profile, spawnKind, strategy) {
  const { game, h } = newGame(seed, profile);
  const tile = spawnKind === 'recomendada' ? game.recommendSpawn(h).tile : randomSpawn(game, h, seed);
  const info = game.spawnInfo(h, tile);
  game.spawnPlayer(h, tile);
  while (game.phase === 'spawn') game.tick();
  const t0 = game.ticks;
  const marks = {};
  const log = { first: null };
  const seenAttacks = new Set();
  let early = 0;
  let firstHit = NaN;
  for (let s = 0; s <= MARKS[MARKS.length - 1]; s++) {
    while (game.ticks < t0 + s * TPS) {
      game.tick();
      for (const a of game.attacks) {
        if (a.targetId !== h.id || seenAttacks.has(a)) continue;
        seenAttacks.add(a);
        const at = (game.ticks - t0) / TPS;
        if (at < 60) early++;
        if (!Number.isFinite(firstHit)) firstHit = at;
      }
    }
    if (MARKS.includes(s)) marks[s] = snapshot(game, h);
    if (h.alive && game.phase === 'playing') orders(strategy, game, h, s, log);
  }
  return { seed, profile, spawnKind, strategy, info, marks, first: log.first, early, total: seenAttacks.size, firstHit };
}

const started = Date.now();
const results = [];
for (const profile of PROFILE_LIST) {
  for (const seed of SEEDS) {
    for (const spawnKind of Object.keys(SPAWN_KINDS)) {
      for (const strategy of Object.keys(STRATEGIES)) {
        const r = play(seed, profile, spawnKind, strategy);
        results.push(r);
        process.stdout.write(`${profile} · semilla ${seed} · ${spawnKind} · ${strategy}: ${fmt(r.marks[120].tiles)} casillas a los 120 s, ${r.early} ataques antes de 60 s\n`);
      }
    }
  }
}
const seconds = Math.round((Date.now() - started) / 1000);

// ------------------------------------------------------------------ informe

const firstLabel = (f) => (f ? `${BUILDINGS[f.kind].name} (${f.s} s)` : '—');
const terrainLabel = (info) => {
  const d = describeSpawn(info);
  return d.terrain || '—';
};

md(`# Calibración de aperturas`);
md();
md(`Generado por \`node herramientas/aperturas.js\` (motor ${MECH_VERSION}; perfiles ${PROFILE_LIST.map((p) => PROFILES[p].id).join(' / ')}). La partida rápida del menú: el mundo con ${BOTS} naciones de la IA en dificultad ${DIFFICULTY} y ${colonyCount(world.map.landCount, BOTS)} colonias; semillas ${SEEDS.join(', ')}. Sin pantalla y determinista: para cada semilla, las seis partidas tienen las mismas naciones, colonias y semilla, y solo cambian la salida y las órdenes. ${results.length} partidas en ${seconds} s.`);
md();
md(`Tropas, techo y banco en cifras del HUD (internas ÷ ${TROOP_SCALE}); oro e ingreso pasivo tal cual. «Comprometidas» = tropas en ataques y barcos (ya no defienden). Tiempos en segundos desde el final del despliegue.`);
md();
md(`**Aperturas**`);
md();
md(`- **Expansión:** un 25 % de las tropas a tierra libre cada vez que no hay frente abierto; ninguna obra.`);
md(`- **Economía:** un pueblo en cuanto se puede pagar (en una casilla propia que no sea frontera) y un 15 % a crecer.`);
md(`- **Banco y defensa:** guarda el 40 % de las tropas en la capital a los 5 s y luego cada 15 s, mejora la capital en cuanto puede (oro y tropas) y un 15 % a crecer.`);
md();
md(`**Salidas:** «Recomendada» = la del botón «Elegir por mí» (\`recommendSpawn\`: zona inicial completa, sitio libre, lejos de las naciones); «Al azar» = una casilla válida al azar, repetible por semilla.`);
md();

for (const profile of PROFILE_LIST) {
  const P = PROFILES[profile];
  const rs = results.filter((r) => r.profile === profile);
  md(`## ${P.name} (${P.id})`);
  md();
  md(`### Salidas`);
  md();
  table(
    ['Semilla', 'Salida', 'Zona inicial', 'Recortes', 'Terreno', 'Sitio libre', 'Nación más cercana', 'Ataques < 60 s (expansión / economía / banco)'],
    SEEDS.flatMap((seed) =>
      Object.keys(SPAWN_KINDS).map((sk) => {
        const runs = rs.filter((r) => r.seed === seed && r.spawnKind === sk);
        const info = runs[0].info;
        const d = describeSpawn(info);
        return [seed, SPAWN_KINDS[sk], `${info.zone.length}/${info.full}${info.zone.length < info.full ? ' ⚠' : ''}`, d.cuts || '—', terrainLabel(info), d.free.replace('espacio libre alrededor: ', ''), info.rival ? `${info.rival.km} km` : '—', Object.keys(STRATEGIES).map((st) => runs.find((r) => r.strategy === st).early).join(' / ')];
      }),
    ),
  );
  const incomplete = (sk) => SEEDS.filter((seed) => {
    const info = rs.find((r) => r.seed === seed && r.spawnKind === sk).info;
    return info.zone.length < info.full;
  }).length;
  md(`Zonas iniciales incompletas: recomendada ${incomplete('recomendada')}/${SEEDS.length}, al azar ${incomplete('azar')}/${SEEDS.length}.`);
  md();

  md(`### Resumen a los 120 s (mediana de las semillas)`);
  md();
  table(
    ['Apertura', 'Salida', 'Territorio', 'Techo', 'Disponibles', 'Comprometidas', 'Banco', 'Oro', 'Ingreso', 'Ataques < 60 s', 'Primera obra'],
    Object.keys(STRATEGIES).flatMap((st) =>
      Object.keys(SPAWN_KINDS).map((sk) => {
        const runs = rs.filter((r) => r.strategy === st && r.spawnKind === sk);
        const m = (f) => median(runs.map((r) => f(r.marks[120])));
        const firsts = runs.map((r) => r.first).filter(Boolean);
        return [
          STRATEGIES[st].name,
          SPAWN_KINDS[sk],
          `${fmt(m((x) => x.tiles))} cas.`,
          k(m((x) => x.cap)),
          k(m((x) => x.troops)),
          k(m((x) => x.committed)),
          k(m((x) => x.bank)),
          gold(m((x) => x.gold)),
          `${gold(m((x) => x.income))}/s`,
          fmt(median(runs.map((r) => r.early)), 1),
          firsts.length ? `${BUILDINGS[firsts[0].kind].name} (${fmt(median(firsts.map((f) => f.s)))} s)` : '—',
        ];
      }),
    ),
  );

  md(`### Tabla por semilla y apertura`);
  md();
  table(
    ['Semilla', 'Salida', 'Apertura', 't', 'Territorio', 'Techo', 'Disponibles', 'Comprometidas', 'Banco', 'Oro', 'Ingreso', 'Primera obra'],
    rs.flatMap((r) =>
      MARKS.map((t) => {
        const x = r.marks[t];
        return [r.seed, SPAWN_KINDS[r.spawnKind], STRATEGIES[r.strategy].name, `${t} s`, `${fmt(x.tiles)} cas.${x.alive ? '' : ' (eliminado)'}`, k(x.cap), k(x.troops), k(x.committed), k(x.bank), gold(x.gold), `${gold(x.income)}/s`, r.first && r.first.s <= t ? firstLabel(r.first) : '—'];
      }),
    ),
  );
}

md(`## Cómo leerlo`);
md();
md(`- Antes de cambiar un multiplicador, se vuelve a generar este informe con las mismas semillas y se comparan las tres aperturas: un cambio de fórmula dice qué medida quiere corregir (por ejemplo, el territorio de la expansión a los 60 s) y qué les pasa a las otras dos.`);
md(`- La amortización que muestran las fichas (coste ÷ oro por segundo, más el tiempo de obra) es orientativa: con +300/s y 40k, el pueblo se paga en ~133 s de funcionamiento. La columna «Ingreso» de la apertura de economía muestra cuánto suben de verdad los pueblos en estas partidas.`);
md(`- Los ataques que entran antes del primer minuto y las zonas incompletas comparan las salidas recomendadas con las de al azar en las mismas partidas.`);
md();

await mkdir(join(ROOT, 'docs'), { recursive: true });
await writeFile(join(ROOT, 'docs', 'aperturas.md'), `${out.join('\n')}\n`);
console.log(`docs/aperturas.md (${results.length} partidas, ${seconds} s)`);
