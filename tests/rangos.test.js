// Tests de los rangos: ligas, PL, MMR, colocación, escudo, abandono, temporadas y salas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACEMENT_GAMES, SHIELD_GAMES, aiDifficultyFor, applyAiResult, applyRoomResult, divisionFloor, ensureSeason,
  newRank, normalizeRank, rankOf, rankText, seasonName, seasonOf,
} from '../src/rangos.js';

// Con el MMR que corresponde a su rango, salvo que se diga otro
const ranked = (puntos, mmr = puntos / 2 + 700) => ({ ...newRank(), colocacion: PLACEMENT_GAMES, puntos, mmr });
const of = 91;

test('ligas y divisiones: todo el rango cabe en los puntos', () => {
  assert.equal(rankOf(0).label, 'Hierro IV');
  assert.equal(rankOf(399).label, 'Hierro I');
  assert.equal(rankOf(399).pl, 99);
  assert.equal(rankOf(400).label, 'Bronce IV');
  assert.equal(rankOf(1250).label, 'Oro IV');
  assert.equal(rankOf(1250).pl, 50);
  assert.equal(rankOf(2399).label, 'Diamante I');
  assert.equal(rankOf(2400).label, 'Maestro');
  assert.equal(rankOf(2650).label, 'Gran Maestro');
  assert.equal(rankOf(2650).pl, 50);
  assert.equal(rankOf(3100).label, 'Leyenda');
  assert.equal(divisionFloor(1287), 1200);
  assert.equal(divisionFloor(2700), 2600);
});

test('colocación: 5 partidas sin rango visible y luego un rango según el MMR', () => {
  const good = newRank();
  const bad = newRank();
  for (let i = 0; i < PLACEMENT_GAMES; i++) {
    const g = applyAiResult(good, { place: 1, of });
    const b = applyAiResult(bad, { place: 80, of });
    assert.equal(g.placing, true);
    assert.equal(g.placementDone, i === PLACEMENT_GAMES - 1);
    assert.equal(b.placementDone, i === PLACEMENT_GAMES - 1);
  }
  assert.ok(good.mmr > 1000 && bad.mmr < 1000);
  assert.ok(good.puntos > bad.puntos + 400, `${rankText(good)} frente a ${rankText(bad)}`);
  assert.match(rankText(newRank()), /Colocación 0\/5/);
  assert.equal(aiDifficultyFor(newRank()), 'normal');
});

test('PL según el puesto, y más si tu MMR va por delante de tu rango', () => {
  const win = applyAiResult(ranked(1000), { place: 1, of });
  const mid = applyAiResult(ranked(1000), { place: 40, of });
  const last = applyAiResult(ranked(1000), { place: 91, of });
  assert.ok(win.delta > 15, `ganar: +${win.delta}`);
  assert.ok(mid.delta < 0, `a media tabla: ${mid.delta}`);
  assert.ok(last.delta <= -25 && last.delta >= -35, `el último: ${last.delta}`);
  // Mismo rango y resultado; MMR alto (vas por delante) gana más y MMR bajo, menos
  const ahead = applyAiResult(ranked(1000, 1400), { place: 3, of });
  const behind = applyAiResult(ranked(1000, 900), { place: 3, of });
  assert.ok(ahead.delta > behind.delta, `${ahead.delta} frente a ${behind.delta}`);
});

test('abandonar una clasificatoria cuenta como quedar el último', () => {
  const r = ranked(800);
  const out = applyAiResult(r, { place: 5, of }, { abandon: true });
  assert.ok(out.delta < -20, `${out.delta}`);
  assert.equal(r.historial[0].abandono, true);
  assert.equal(r.partidas, 1);
});

test('escudo: tras ascender, 3 partidas sin bajar de división', () => {
  const r = ranked(1190, 1300);
  const up = applyAiResult(r, { place: 1, of });
  assert.ok(up.promoted && rankOf(r.puntos).label.startsWith('Oro'), rankText(r));
  assert.equal(r.escudo, SHIELD_GAMES);
  // Tres derrotas: el escudo aguanta en Oro IV
  for (let i = 0; i < SHIELD_GAMES; i++) applyAiResult(r, { place: 91, of });
  assert.equal(r.puntos, 1200, rankText(r));
  assert.equal(r.escudo, 0);
  // La siguiente ya baja
  const down = applyAiResult(r, { place: 91, of });
  assert.ok(down.demoted && r.puntos < 1200, rankText(r));
});

test('temporadas de dos meses con reinicio suave y recompensa', () => {
  assert.equal(seasonOf(new Date(2026, 10, 10)), '2026-6');
  assert.equal(seasonOf(new Date(2027, 0, 3)), '2027-1');
  assert.match(seasonName('2026-6'), /noviembre y diciembre de 2026/);
  const r = { ...ranked(1700, 1500), temporada: '2026-5', partidas: 30, mejor: 1800 };
  const reward = ensureSeason(r, new Date(2026, 10, 10));
  assert.ok(reward && reward.coins > 0 && reward.league.id === 'platino');
  assert.equal(r.temporada, '2026-6');
  assert.equal(r.mmr, 1250);
  assert.equal(r.colocacion, PLACEMENT_GAMES - 2, 'dos partidas de colocación');
  assert.equal(r.anteriores[0].temporada, '2026-5');
  assert.equal(ensureSeason(r, new Date(2026, 11, 1)), null, 'misma temporada: nada');
});

test('salas clasificatorias: Elo entre las personas y un poco del puesto entre naciones', () => {
  const top = applyRoomResult(ranked(1000), { place: 2, of }, [{ mmr: 1000, place: 7 }, { mmr: 1100, place: 12 }]);
  const bottom = applyRoomResult(ranked(1000), { place: 30, of }, [{ mmr: 1000, place: 7 }, { mmr: 1100, place: 12 }]);
  assert.ok(top.delta > 0 && bottom.delta < 0, `${top.delta} / ${bottom.delta}`);
  // Ganarle a alguien mucho mejor da más que ganarle a alguien peor
  const vsStrong = applyRoomResult(ranked(1000), { place: 5, of }, [{ mmr: 1500, place: 9 }]);
  const vsWeak = applyRoomResult(ranked(1000), { place: 5, of }, [{ mmr: 600, place: 9 }]);
  assert.ok(vsStrong.mmrDelta > vsWeak.mmrDelta);
});

test('el rango guardado se limpia', () => {
  const r = normalizeRank({ puntos: 99999, mmr: 'x', colocacion: 9, temporada: '<script>', historial: [{ puntos: 5 }, null, 'x'] });
  assert.equal(r.puntos, 5000);
  assert.equal(r.mmr, 1000);
  assert.equal(r.colocacion, PLACEMENT_GAMES);
  assert.match(r.temporada, /^\d{4}-[1-6]$/);
  assert.equal(r.historial.length, 1);
});

test('rangos: la guía de los PL calcula lo de tu próxima partida sin tocar tu rango', async () => {
  const { previewResults, nextGoal, mmrLag } = await import('../src/rangos.js');
  const r = ranked(1250);
  const before = JSON.stringify(r);
  const ia = previewResults(r, 'ia');
  assert.equal(JSON.stringify(r), before, 'el rango no cambia');
  assert.equal(ia.rows.length, 5);
  // Cuanto mejor quedas, más PL; ganar suma y el último resta (con el tope de −35)
  for (let i = 1; i < ia.rows.length; i++) assert.ok(ia.rows[i].delta <= ia.rows[i - 1].delta, 'ordenado de mejor a peor');
  assert.ok(ia.rows[0].delta > 0 && ia.rows[0].delta <= 50);
  assert.equal(ia.rows[ia.rows.length - 1].delta, -35);
  // Lo mismo, de verdad: aplicar el 1.º da lo que dice la guía
  assert.equal(applyAiResult(ranked(1250), { place: 1, of }).delta, ia.rows[0].delta);
  const sala = previewResults(r, 'sala');
  assert.ok(sala.rows[0].delta > sala.rows[sala.rows.length - 1].delta);
  assert.ok(sala.rows.at(-1).label.includes('Abandonar'));
  // Nivel oculto por delante: más PL al ganar (y el ajuste, como mucho ±10)
  assert.equal(mmrLag(ranked(1250)), 0);
  assert.equal(mmrLag(ranked(1250, 2400)), 10);
  assert.equal(mmrLag(ranked(1250, 0)), -10);
  assert.ok(previewResults(ranked(1250, 1500), 'ia').rows[0].delta > ia.rows[0].delta);
  // En colocación: el rango estimado con tu nivel de ahora
  const placing = { ...newRank(), mmr: 1300 };
  const p = previewResults(placing, 'ia');
  assert.equal(p.placing, true);
  assert.equal(p.estimate, rankOf(1200).label);
  // Siguiente objetivo: la división de arriba, la liga de élite siguiente o nada en Leyenda
  assert.deepEqual([nextGoal(ranked(1250)).label, nextGoal(ranked(1250)).need], ['Oro III', 50]);
  assert.equal(nextGoal(ranked(2399)).label, 'Maestro');
  assert.equal(nextGoal(ranked(2399)).promotion, true);
  assert.deepEqual([nextGoal(ranked(2450)).label, nextGoal(ranked(2450)).need], ['Gran Maestro', 150]);
  assert.equal(nextGoal(ranked(3000)), null);
});
