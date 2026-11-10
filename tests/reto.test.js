// Tests de los retos por enlace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeBeaten, challengeLink, encodeChallenge, parseChallenge } from '../src/reto.js';
import { DEFAULT_RULES } from '../src/config.js';

const reto = { m: 'europa', b: 40, d: 'dificil', s: 3735928559, r: { ...DEFAULT_RULES, profile: 'clasico', victory: 'dominio' }, p: 431, n: 'Aurelia Ñ', t: 3, o: 41 };

test('el reto va y vuelve por el enlace con la misma partida', () => {
  const link = challengeLink('https://ejemplo.es/', reto);
  assert.match(link, /^https:\/\/ejemplo\.es\/\?reto=[A-Za-z0-9_-]+$/);
  const c = parseChallenge(new URL(link).searchParams.get('reto'));
  assert.equal(c.m, 'europa');
  assert.equal(c.b, 40);
  assert.equal(c.d, 'dificil');
  assert.equal(c.s, 3735928559);
  assert.equal(c.r.profile, 'clasico');
  assert.equal(c.p, 431);
  assert.equal(c.n, 'Aurelia Ñ');
});

test('un enlace manipulado o roto no sirve', () => {
  assert.equal(parseChallenge('xxx'), null);
  assert.equal(parseChallenge(encodeChallenge({ ...reto, m: 'atlantida' })), null);
  assert.equal(parseChallenge(encodeChallenge({ ...reto, b: 999 })), null);
  assert.equal(parseChallenge(encodeChallenge({ ...reto, p: 5000 })), null);
  const raro = parseChallenge(encodeChallenge({ ...reto, n: '<b>x</b>', d: 'trampa' }));
  assert.equal(raro.n, 'bx/b');
  assert.equal(raro.d, 'normal');
});

test('superarlo es tener más territorio máximo que quien reta', () => {
  assert.equal(challengeBeaten(reto, 0.432), true);
  assert.equal(challengeBeaten(reto, 0.431), false);
  assert.equal(challengeBeaten(null, 1), false);
});
