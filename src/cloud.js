// Nube: perfil sincronizado entre dispositivos y clasificación global.
// Usa las capacidades `db` y `user` del enlace de Claude. Fuera de Claude (o si
// la persona no da permiso) todo sigue funcionando solo en este navegador.
//
//   data/users/<id>/perfil     perfil completo, privado de cada persona
//   clasificacion/<id>         fila pública de la clasificación global

import { levelInfo, titleName } from './profile.js';

let cloudPromise = null;

/** Resuelve { db, user, id } o null. Se pide una sola vez. */
export function getCloud() {
  if (!cloudPromise) cloudPromise = connect();
  return cloudPromise;
}

async function connect() {
  const claude = typeof window !== 'undefined' ? window.claude : null;
  if (!claude || typeof claude.use !== 'function') return null;
  try {
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    if (!db || !user) return null;
    const id = await user.id();
    return id ? { db, user, id } : null;
  } catch {
    return null;
  }
}

/** Escrituras de una en una por documento, como pide la plataforma. */
const chains = new Map();
function serialWrite(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.then(fn).catch(() => {});
  chains.set(key, next);
  return next;
}

export async function pullProfile(cloud) {
  try {
    const snap = await cloud.db.doc(`data/users/${cloud.id}/perfil`).get();
    const body = snap.exists ? snap.data() : null;
    return body && body.perfil && typeof body.perfil === 'object' ? body.perfil : null;
  } catch {
    return null;
  }
}

export function pushProfile(cloud, profile) {
  const copy = JSON.parse(JSON.stringify(profile));
  return serialWrite('perfil', () => cloud.db.doc(`data/users/${cloud.id}/perfil`).set({ perfil: copy }));
}

export function pushLeaderboard(cloud, profile) {
  if (!profile.nombre || !profile.stats.partidas) return Promise.resolve();
  const row = {
    nombre: profile.nombre.slice(0, 18),
    titulo: titleName(profile),
    color: profile.color,
    emblema: { ...profile.emblema },
    nivel: levelInfo(profile.xp).level,
    xp: profile.xp,
    victorias: profile.stats.victorias,
    partidas: profile.stats.partidas,
    mejorPct: profile.stats.mejorPct,
    actualizado: Date.now(),
  };
  return serialWrite('clasificacion', () => cloud.db.doc(`clasificacion/${cloud.id}`).set(row));
}

/** Filas de otras personas: datos no fiables, se limpian antes de mostrarlos. */
function cleanRow(id, d) {
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '#888888');
  const word = (v, def) => (typeof v === 'string' && /^[a-z]{2,12}$/.test(v) ? v : def);
  const e = d.emblema && typeof d.emblema === 'object' ? d.emblema : {};
  return {
    id,
    nombre: String(d.nombre || 'Jugador').slice(0, 18),
    titulo: String(d.titulo || '').slice(0, 24),
    color: hex(d.color),
    emblema: { shape: word(e.shape, 'escudo'), symbol: word(e.symbol, 'estrella'), bg: hex(e.bg), fg: hex(e.fg) },
    nivel: Math.max(1, Math.floor(num(d.nivel))),
    xp: num(d.xp),
    victorias: num(d.victorias),
    partidas: num(d.partidas),
    mejorPct: Math.min(1, Math.max(0, num(d.mejorPct))),
  };
}

/**
 * Se suscribe a los 50 primeros por experiencia. `onRows(rows, { stale })`;
 * `onError(texto)` si no se puede leer. Devuelve la función para cancelar.
 */
export function watchLeaderboard(cloud, onRows, onError) {
  let done = false;
  const timer = setTimeout(() => {
    if (!done) onError('Todavía no se puede leer la clasificación global; puede tardar un poco.');
  }, 10000);
  const unsub = cloud.db
    .collection('clasificacion')
    .orderBy('xp', 'desc')
    .limit(50)
    .onSnapshot(
      (snap) => {
        if (!snap.metadata.fromCache) {
          done = true;
          clearTimeout(timer);
        }
        onRows(snap.docs.map((d) => cleanRow(d.id, d.data() || {})), { stale: snap.metadata.fromCache });
      },
      () => {
        done = true;
        clearTimeout(timer);
        onError('No se ha podido leer la clasificación global.');
      },
    );
  return () => {
    clearTimeout(timer);
    unsub();
  };
}
