// Retos por enlace («Supera mi partida»): el enlace lleva el mapa, los
// rivales, la dificultad, la semilla y las reglas de una partida contra la
// IA, más lo que hizo quien reta (su máximo de territorio). Quien lo abre
// juega exactamente esa partida y ve si lo supera.
import { DEFAULT_RULES, MAP_IDS, cleanRules, migrateRules } from './config.js';

const DIFFICULTIES = ['facil', 'normal', 'dificil', 'imposible'];

function b64uEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(text) {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Reto de una partida: { m: mapa, b: rivales, d: dificultad, s: semilla,
 * r: reglas, p: máximo de territorio (0-1000), n: nombre, t: puesto, o: de }.
 */
export function encodeChallenge(c) {
  return b64uEncode(JSON.stringify({ v: 1, m: c.m, b: c.b, d: c.d, s: c.s >>> 0, r: c.r, p: Math.round(c.p), n: String(c.n || '').slice(0, 18), t: c.t || 0, o: c.o || 0 }));
}

/** Enlace del reto a partir de la dirección de la página (sin otros parámetros). */
export function challengeLink(base, c) {
  return `${base}?reto=${encodeChallenge(c)}`;
}

/** Reto de un enlace, validado (datos de otra persona), o null. */
export function parseChallenge(text) {
  if (!text || typeof text !== 'string' || text.length > 4000) return null;
  let d;
  try {
    d = JSON.parse(b64uDecode(text));
  } catch {
    return null;
  }
  if (!d || d.v !== 1 || !MAP_IDS.includes(d.m)) return null;
  const b = Math.floor(Number(d.b));
  const s = Number(d.s);
  const p = Math.floor(Number(d.p));
  if (!(b >= 1 && b <= 200) || !Number.isFinite(s) || s < 0 || s > 0xffffffff || !(p >= 0 && p <= 1000)) return null;
  return {
    m: d.m,
    b,
    d: DIFFICULTIES.includes(d.d) ? d.d : 'normal',
    s: s >>> 0,
    r: cleanRules({ ...DEFAULT_RULES, ...migrateRules(d.r && typeof d.r === 'object' ? d.r : {}) }),
    p,
    n: String(d.n || 'Alguien').replace(/[\u0000-\u001f<>]/g, '').slice(0, 18) || 'Alguien',
    t: Math.max(0, Math.floor(Number(d.t)) || 0),
    o: Math.max(0, Math.floor(Number(d.o)) || 0),
  };
}

/** ¿Has superado el reto? Más territorio máximo que quien te retó. */
export function challengeBeaten(c, maxShare) {
  return !!c && Math.round(maxShare * 1000) > c.p;
}
