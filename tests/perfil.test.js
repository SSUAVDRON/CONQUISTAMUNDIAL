// Tests del perfil: experiencia, niveles, logros, desbloqueos y fusión con la nube.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS, PATTERNS, SYMBOLS, defaultProfile, hasAchievement, isUnlocked,
  levelInfo, mergeProfiles, normalizeProfile, recordGame,
} from '../src/profile.js';

// recordGame guarda en localStorage si existe; en Node no hace falta
globalThis.localStorage = undefined;

function result(over = {}) {
  return {
    won: false, alliedWin: false, mapSize: 'mediano', seconds: 600, maxShare: 0.1, kills: 0, built: 0,
    landings: 0, alliances: 0, betrayals: 0, maxGold: 0, maxCities: 0, online: false, alive: false,
    survivedSeconds: 600, rivals: 25, ...over,
  };
}

test('los niveles crecen con la experiencia', () => {
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(59).level, 1);
  assert.equal(levelInfo(60).level, 2);
  assert.equal(levelInfo(240).level, 3);
  const mid = levelInfo(150);
  assert.ok(mid.progress > 0 && mid.progress < 1);
});

test('una partida da experiencia, estadísticas, historial y logros', () => {
  const p = defaultProfile();
  const out = recordGame(p, result({ won: true, seconds: 500, kills: 6, built: 12, maxShare: 0.72, maxGold: 120000 }));
  assert.ok(out.xp > 150);
  assert.equal(p.stats.partidas, 1);
  assert.equal(p.stats.victorias, 1);
  assert.equal(p.stats.mejorTiempo, 500);
  assert.equal(p.historial.length, 1);
  const ids = out.achievements.map((a) => a.id);
  for (const id of ['primera_partida', 'primera_victoria', 'relampago', 'verdugo', 'arquitecto', 'medio_mundo', 'tesoro']) {
    assert.ok(ids.includes(id), `falta el logro ${id}`);
  }
  // Un logro no se concede dos veces
  const again = recordGame(p, result({ won: true }));
  assert.equal(again.achievements.some((a) => a.id === 'primera_victoria'), false);
});

test('los ids de logro no chocan con propiedades del prototipo', () => {
  const p = defaultProfile();
  for (const a of ACHIEVEMENTS) assert.equal(hasAchievement(p, a.id), false, a.id);
  const torre = SYMBOLS.find((s) => s.id === 'torre');
  assert.equal(isUnlocked(p, torre), false, 'la torre no debe salir desbloqueada sin el logro');
  assert.equal(isUnlocked(normalizeProfile({ logros: { constructor: 1 } }), torre), false);
});

test('desbloqueos por logro y por nivel', () => {
  const p = defaultProfile();
  const rayas = PATTERNS.find((x) => x.id === 'rayas');
  const espiga = PATTERNS.find((x) => x.id === 'espiga');
  assert.equal(isUnlocked(p, rayas), false);
  p.logros.primera_victoria = Date.now();
  assert.equal(isUnlocked(p, rayas), true);
  assert.equal(isUnlocked(p, espiga), false);
  p.xp = 60 * 16; // nivel 5
  assert.equal(isUnlocked(p, espiga), true);
});

test('fusionar perfiles no pierde progreso', () => {
  const a = defaultProfile();
  const b = defaultProfile();
  a.xp = 500;
  a.stats.partidas = 4;
  a.stats.mejorTiempo = 900;
  a.logros.primera_partida = 1;
  a.actualizado = 10;
  b.xp = 300;
  b.stats.partidas = 7;
  b.stats.mejorTiempo = 600;
  b.logros.marino = 2;
  b.nombre = 'Desde el móvil';
  b.actualizado = 20;
  const m = mergeProfiles(a, b);
  assert.equal(m.xp, 500);
  assert.equal(m.stats.partidas, 7);
  assert.equal(m.stats.mejorTiempo, 600);
  assert.ok(hasAchievement(m, 'primera_partida') && hasAchievement(m, 'marino'));
  assert.equal(m.nombre, 'Desde el móvil', 'la identidad viene del perfil más reciente');
});
