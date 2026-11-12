// Emparejamiento automático de la clasificatoria en línea: quién manda, a
// quién elige (MMR parecido, margen que se abre con la espera), cuándo forma
// la partida, los avisos y su caducidad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEADER_SETTLE_MS, MATCH_WAIT_MS, cleanQueueEntry, mmrWindow, planMatch } from '../src/emparejamiento.js';

const T0 = 1_000_000;
const e = (peer, mmr, since, sala = null) => ({ peer, mmr, since, sala });

test('emparejamiento: solo, nunca forma partida; acompañado, espera a llevar un rato', () => {
  assert.equal(planMatch([e('a', 1000, T0)], 'a', T0 + 600000).action, 'wait');
  const two = [e('a', 1000, T0), e('b', 1050, T0 + 1000)];
  assert.equal(planMatch(two, 'a', T0 + LEADER_SETTLE_MS - 1).action, 'wait', 'el que manda deja pasar unos segundos');
  assert.equal(planMatch(two, 'a', T0 + MATCH_WAIT_MS - 1).action, 'wait', 'con dos, espera por si llegan más');
  const p = planMatch(two, 'a', T0 + MATCH_WAIT_MS);
  assert.deepEqual([p.action, p.members], ['host', ['b']]);
  // El otro espera a que mande el más antiguo
  const w = planMatch(two, 'b', T0 + MATCH_WAIT_MS);
  assert.deepEqual([w.action, w.leader], ['wait', 'a']);
});

test('emparejamiento: con cuatro de rango parecido, la partida se forma enseguida', () => {
  const four = [e('a', 1000, T0), e('b', 1100, T0 + 200), e('c', 950, T0 + 400), e('d', 1180, T0 + 600)];
  const p = planMatch(four, 'a', T0 + LEADER_SETTLE_MS);
  assert.equal(p.action, 'host');
  assert.deepEqual(p.members, ['c', 'b', 'd'], 'los más parecidos primero');
});

test('emparejamiento: un rival muy lejano entra solo cuando el margen se ha abierto', () => {
  const far = [e('a', 1000, T0), e('b', 1800, T0)];
  assert.equal(planMatch(far, 'a', T0 + 13000).action, 'wait', 'a los 13 s, 800 de diferencia es demasiado');
  assert.ok(mmrWindow(30000) >= 800);
  assert.equal(planMatch(far, 'a', T0 + 30000).action, 'host', 'a los 30 s ya cabe');
});

test('emparejamiento: el avisado entra en la sala; los ya avisados no los coge otro; el aviso caduca', () => {
  const invited = [e('a', 1000, T0, { code: 'abc12', para: ['b', 'c'], hasta: T0 + 20000 }), e('b', 1000, T0 + 100), e('c', 1000, T0 + 200), e('d', 1000, T0 + 300), e('f', 1010, T0 + 400)];
  const j = planMatch(invited, 'b', T0 + 5000);
  assert.deepEqual([j.action, j.code, j.leader], ['join', 'abc12', 'a']);
  // d manda ahora entre los libres (b y c ya están avisados)
  const h = planMatch(invited, 'd', T0 + MATCH_WAIT_MS + 1000);
  assert.deepEqual([h.action, h.members], ['host', ['f']]);
  // Un aviso caducado no vale
  assert.equal(planMatch(invited, 'b', T0 + 21000).action, 'wait');
});

test('emparejamiento: entradas de la cola limpias (otra versión o datos raros, fuera)', () => {
  assert.equal(cleanQueueEntry('a', { v: 'x', mmr: 1000, desde: T0 }, 'y'), null, 'otra versión');
  assert.equal(cleanQueueEntry('a', { v: 'y', mmr: 'mucho', desde: T0 }, 'y'), null);
  assert.equal(cleanQueueEntry('a', { v: 'y', mmr: 99999, desde: T0 }, 'y'), null);
  const ok = cleanQueueEntry('a', { v: 'y', mmr: 1200, desde: T0, sala: { code: 'ZZ', para: ['b'] } }, 'y');
  assert.equal(ok.mmr, 1200);
  assert.equal(ok.sala, null, 'un código de sala mal formado se ignora');
  const s = cleanQueueEntry('a', { v: 'y', mmr: 1200, desde: T0, sala: { code: 'ab3d5', para: ['b', 7, 'c'], hasta: T0 + 1 } }, 'y');
  assert.deepEqual(s.sala.para, ['b', 'c']);
});
