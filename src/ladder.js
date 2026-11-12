// Tabla global de rangos. Dos sitios donde guardarla:
//
// - En el enlace de Claude: la base de datos del enlace, colección `rangos`
//   (cada persona escribe solo `rangos/<su id>`).
// - En la web (Hostinger): api/rangos.php (PHP + MySQL), con un id y un
//   secreto aleatorios de este navegador.
//
// Si no hay ninguno, el rango se queda en el perfil (solo local).
import { inPlacement } from './rangos.js';
import { titleName } from './profile.js';

const API = 'api/rangos.php';
const ID_KEY = 'trinchera.rango.id';
const SECRET_KEY = 'trinchera.rango.secreto';

/** Fila pública de tu rango. */
export function rankRow(profile) {
  const r = profile.rango;
  return {
    nombre: String(profile.nombre || 'Jugador').slice(0, 18),
    titulo: titleName(profile),
    color: profile.color,
    emblema: { shape: profile.emblema.shape, symbol: profile.emblema.symbol, bg: profile.emblema.bg, fg: profile.emblema.fg, flag: profile.emblema.flag || '' },
    puntos: r.puntos,
    partidas: r.partidas,
    victorias: r.victorias,
    temporada: r.temporada,
    colocado: !inPlacement(r),
    actualizado: Date.now(),
  };
}

/** Fila de otra persona: datos no fiables, se limpian antes de mostrarlos. */
export function cleanRankRow(id, d) {
  const num = (v, max = 1e6) => (Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
  const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '#888888');
  const word = (v, def) => (typeof v === 'string' && /^[a-z]{2,12}$/.test(v) ? v : def);
  const e = d && d.emblema && typeof d.emblema === 'object' ? d.emblema : {};
  return {
    id: String(id).slice(0, 64),
    nombre: String((d && d.nombre) || 'Jugador').slice(0, 18),
    titulo: String((d && d.titulo) || '').slice(0, 24),
    color: hex(d && d.color),
    emblema: { shape: word(e.shape, 'escudo'), symbol: word(e.symbol, 'estrella'), bg: hex(e.bg), fg: hex(e.fg), flag: typeof e.flag === 'string' && /^[a-z]{2,3}$/.test(e.flag) ? e.flag : '' },
    puntos: num(d && d.puntos, 5000),
    partidas: num(d && d.partidas),
    victorias: num(d && d.victorias),
    temporada: typeof (d && d.temporada) === 'string' && /^\d{4}-[1-6]$/.test(d.temporada) ? d.temporada : '',
    colocado: d && d.colocado !== false,
  };
}

function randomHex(n) {
  const bytes = new Uint8Array(n / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Id y secreto de este navegador para la API (se crean la primera vez). */
export function apiIdentity(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    let id = storage.getItem(ID_KEY);
    let secreto = storage.getItem(SECRET_KEY);
    if (!/^[0-9a-f]{32}$/.test(id || '') || !/^[0-9a-f]{64}$/.test(secreto || '')) {
      id = randomHex(32);
      secreto = randomHex(64);
      storage.setItem(ID_KEY, id);
      storage.setItem(SECRET_KEY, secreto);
    }
    return { id, secreto };
  } catch {
    return null;
  }
}

/** Usa este id y secreto (los de tu cuenta, para tener la misma fila en todos tus dispositivos). */
export function setApiIdentity({ id, secreto }, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!/^[0-9a-f]{32}$/.test(id || '') || !/^[0-9a-f]{64}$/.test(secreto || '')) return false;
  try {
    storage.setItem(ID_KEY, id);
    storage.setItem(SECRET_KEY, secreto);
    return true;
  } catch {
    return false;
  }
}

/** Id público (lo que devuelve la API para marcar tu fila): los 16 primeros del sha-256 del id. */
async function publicId(id) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Tabla global: `onState({ available, rows, error, myId, source })`.
 * `fetchFn` y `base` se pueden cambiar en los tests.
 */
export class Ladder {
  constructor(onState, { fetchFn = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null, base = '' } = {}) {
    this.onState = onState;
    this.fetch = fetchFn;
    this.url = `${base}${API}`;
    this.cloud = null;
    this.mode = 'local';
    this.unsub = null;
    this.season = '';
  }

  /** ¿Puede haber API en este sitio? (web servida por http(s), fuera de Claude) */
  static webAvailable(loc = typeof location !== 'undefined' ? location : null) {
    return !!loc && /^https?:$/.test(loc.protocol) && !/(^|\.)claude(usercontent)?\.(ai|com)$/.test(loc.hostname);
  }

  /** Empieza a leer la tabla de la temporada `season` (con la nube de Claude, si la hay). */
  async start(cloud, season, { web = Ladder.webAvailable() } = {}) {
    this.season = season;
    this.unsub?.();
    if (cloud) {
      this.cloud = cloud;
      this.mode = 'claude';
      this.unsub = cloud.db
        .collection('rangos')
        .orderBy('puntos', 'desc')
        .limit(100)
        .onSnapshot(
          (snap) => {
            const rows = snap.docs.map((d) => cleanRankRow(d.id, d.data() || {})).filter((x) => x.colocado);
            this.onState({ available: true, rows, error: '', myId: cloud.id, source: snap.metadata.fromCache ? 'Mostrando datos guardados; se actualizarán en cuanto haya conexión.' : '' });
          },
          () => this.onState({ available: false, error: 'No se ha podido leer la tabla de rangos.' }),
        );
      return;
    }
    if (web && this.fetch) {
      this.mode = 'web';
      const ident = apiIdentity();
      this.myId = ident ? await publicId(ident.id).catch(() => null) : null;
      await this.refresh();
      return;
    }
    this.mode = 'local';
    this.onState({ available: false, rows: [], error: '' });
  }

  /** Vuelve a pedir la tabla a la API (en la web). */
  async refresh() {
    if (this.mode !== 'web') return;
    try {
      const res = await this.fetch(`${this.url}?temporada=${encodeURIComponent(this.season)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      const rows = (Array.isArray(body.filas) ? body.filas : []).map((f) => cleanRankRow(f.id, { ...f, temporada: f.temporada || this.season }));
      this.onState({ available: true, rows, error: '', myId: this.myId, source: '' });
    } catch {
      // Sin API en este servidor (404) o sin conexión: solo local
      this.mode = 'local';
      this.onState({ available: false, rows: [], error: '' });
    }
  }

  /** Sube tu fila (tras cada clasificatoria). */
  async push(profile) {
    const row = rankRow(profile);
    try {
      if (this.mode === 'claude' && this.cloud) {
        await this.cloud.db.doc(`rangos/${this.cloud.id}`).set(row);
        return true;
      }
      if (this.mode === 'web') {
        const ident = apiIdentity();
        if (!ident) return false;
        const res = await this.fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...ident, fila: row }) });
        if (res.ok) setTimeout(() => this.refresh(), 300);
        return res.ok;
      }
    } catch {
      /* sin conexión: se sube la próxima vez */
    }
    return false;
  }
}
