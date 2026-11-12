// Cerco (_tryAnnex): la sonda en línea recta solo ahorra trabajo; cada bolsa
// se anexiona (o no) igual que con el recorrido completo de siempre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { RES } from '../src/config.js';
import { MECH } from '../src/mecanicas.js';
import { Rng } from '../src/rng.js';

const MAX = Math.round(MECH.annexMaxTiles * (RES / 2) ** 2);

/** El recorrido completo, sin sonda (como era antes): ¿está cercada la bolsa de `start`? El mar abre la bolsa; un río la cierra. */
function reference(game, start, aid) {
  const { map, owner } = game;
  const fail = game._annexFail;
  const o = owner[start];
  const seen = new Set([start]);
  const queue = [start];
  const nb = new Int32Array(4);
  for (let head = 0; head < queue.length; head++) {
    const c = map.neighbors(queue[head], nb);
    if (c < 4) return null;
    for (let k = 0; k < c; k++) {
      const v = nb[k];
      if (map.terrain[v] === 0) {
        if (map.river[v]) continue; // un río cierra la bolsa como una frontera
        return null;
      }
      const ov = owner[v];
      if (ov === aid) continue;
      if (ov !== o || fail[v] === game.ticks || (!seen.has(v) && queue.length >= MAX)) return null;
      if (!seen.has(v)) {
        seen.add(v);
        queue.push(v);
      }
    }
  }
  return queue;
}

test('cerco: la sonda da el mismo resultado que el recorrido completo', () => {
  const map = generateMap(220 * RES, 130 * RES, 5);
  const game = new Game({ map, seed: 5 });
  const a = game.addPlayer('A', [0, 0, 255], true);
  const b = game.addPlayer('B', [255, 0, 0], false);
  game.start();
  const rng = new Rng(99);
  const land = [...map.landTiles];
  let enclosed = 0;
  let open = 0;
  // La sonda tiene que haber decidido algunas (escapa) y dejado otras al recorrido
  const probe = game._annexProbe.bind(game);
  const seenProbe = [0, 0];
  game._annexProbe = (...args) => {
    const r = probe(...args);
    seenProbe[r ? 1 : 0]++;
    return r;
  };
  for (let round = 0; round < 40; round++) {
    // Anillos de A de tamaños variados (algunos con huecos), manchas de B y
    // casillas sueltas de A: bolsas grandes, pequeñas, abiertas y cerradas
    for (let k = 0; k < 6; k++) {
      const c = rng.pick(land);
      const cx = map.x(c);
      const cy = map.y(c);
      const r = rng.int(2, Math.round((30 * RES) / 2));
      const gap = rng.chance(0.3);
      for (let d = -r; d <= r; d++) {
        for (const [x, y] of [[cx + d, cy - r], [cx + d, cy + r], [cx - r, cy + d], [cx + r, cy + d]]) {
          if (!map.inBounds(x, y) || (gap && d === 0)) continue;
          const t = map.index(x, y);
          if (map.isLand(t)) game.setOwner(t, a.id);
        }
      }
      const blob = rng.pick(land);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = map.x(blob) + dx;
        const y = map.y(blob) + dy;
        if (map.inBounds(x, y) && map.isLand(map.index(x, y))) game.setOwner(map.index(x, y), b.id);
      }
    }
    for (let k = 0; k < 40; k++) game.setOwner(rng.pick(land), a.id);
    // Casillas junto a A que no son de A: desde ahí se intenta el cerco
    const starts = land.filter((t) => game.owner[t] !== a.id && [t - 1, t + 1, t - map.width, t + map.width].some((n) => game.owner[n] === a.id));
    for (let k = 0; k < 60 && starts.length; k++) {
      const s = rng.pick(starts);
      if (game.owner[s] === a.id) continue;
      game.ticks++; // sin marcas de fallos anteriores
      game._annexBudget = 1e9;
      const want = reference(game, s, a.id);
      const got = game._tryAnnex(s, a.id);
      assert.equal(got, !!want, `bolsa de ${s} (ronda ${round})`);
      if (want) {
        enclosed++;
        for (const t of want) assert.equal(game.owner[t], a.id);
      } else open++;
    }
  }
  // Que la prueba cubra los dos casos
  assert.ok(enclosed > 20, `cercadas ${enclosed}`);
  assert.ok(open > 200, `abiertas ${open}`);
  assert.ok(seenProbe[0] > 5 && seenProbe[1] > 5, `sondas sin decidir/escapan: ${seenProbe}`);
});
