// Emparejamiento automático de la clasificatoria en línea («Buscar partida»).
//
// Quien busca partida se anuncia en el vestíbulo (el canal donde se ven las
// salas públicas) con su presencia `cola`: su MMR, desde cuándo espera y la
// versión del juego. Todos ven la misma lista y la misma regla:
//   - manda el que más lleva esperando (si ya lleva unos segundos, para que
//     haya dado tiempo a ver a los demás);
//   - elige a los que tienen un MMR parecido al suyo (el margen se abre con la
//     espera) y, si son bastantes o ya ha esperado lo suyo, crea una sala
//     clasificatoria y les avisa en su presencia (`sala: { code, para }`);
//   - los avisados entran solos, se marcan listos y la cuenta atrás empieza
//     sola en cuanto están todos (o al cabo de un rato, con los que haya).
// Es público y sin servidor propio, así que todo se valida al recibirlo.
import { MAX_HUMANS, MIN_HUMANS } from './multiplayer.js';

/** Grupo ideal (si hay tantos, se empieza ya). */
export const MATCH_TARGET = 4;
/** Con al menos MIN_HUMANS, se empieza si el que manda lleva esto esperando. */
export const MATCH_WAIT_MS = 12000;
/** El que manda no forma grupo hasta llevar esto en la cola (ver a los demás). */
export const LEADER_SETTLE_MS = 3000;
/** Tiempo para que los avisados entren en la sala. */
export const INVITE_MS = 15000;
/**
 * La sala formada espera esto con los jugadores dentro antes de empezar (o
 * hasta llenarse): mientras, sigue cogiendo de la cola a quien tenga un rango
 * parecido.
 */
export const LOBBY_WAIT_MS = 30000;
/** Plazas de una sala del emparejamiento (las que se llenan con la cola). */
export const MATCH_SEATS = 8;

/** Margen de MMR según lo que lleva esperando (se abre poco a poco). */
export function mmrWindow(waitMs) {
  return Math.min(1500, 200 + (Math.max(0, waitMs) / 1000) * 25);
}

/** Entrada de la cola limpia (o null si no vale). */
export function cleanQueueEntry(peer, raw, version) {
  if (!raw || typeof raw !== 'object' || typeof peer !== 'string') return null;
  const mmr = Number(raw.mmr);
  const since = Number(raw.desde);
  if (!Number.isFinite(mmr) || mmr < 0 || mmr > 4000 || !Number.isFinite(since)) return null;
  if (version && raw.v !== version) return null;
  const s = raw.sala && typeof raw.sala === 'object' ? raw.sala : null;
  const sala =
    s && typeof s.code === 'string' && /^[a-z0-9]{5}$/.test(s.code) && Array.isArray(s.para)
      ? { code: s.code, para: s.para.filter((x) => typeof x === 'string').slice(0, MAX_HUMANS), hasta: Number(s.hasta) || 0 }
      : null;
  return { peer, mmr, since, sala };
}

/**
 * Qué hacer ahora (función pura, la misma en todos los navegadores).
 * entries: [{ peer, mmr, since, sala }] (incluida la mía) · me: mi par · now.
 * Devuelve:
 *   { action: 'join', code, leader }  → me han avisado: entrar en esa sala;
 *   { action: 'host', members }       → mando yo: crear sala para `members` (sin mí);
 *   { action: 'wait', leader, window, ahead } → seguir esperando.
 */
export function planMatch(entries, me, now) {
  const mine = entries.find((e) => e.peer === me);
  if (!mine) return { action: 'wait', leader: null, window: 0, ahead: 0 };
  // ¿Me ha avisado alguien? (si varios, el que más lleva esperando)
  const invites = entries.filter((e) => e.peer !== me && e.sala && e.sala.para.includes(me) && (!e.sala.hasta || e.sala.hasta > now)).sort(byAge);
  if (invites.length) return { action: 'join', code: invites[0].sala.code, leader: invites[0].peer };
  // Los que siguen buscando (sin sala propia ni avisados por otro)
  const taken = new Set();
  for (const e of entries) if (e.sala) for (const p of e.sala.para) taken.add(p);
  const free = entries.filter((e) => !e.sala && !taken.has(e.peer)).sort(byAge);
  const leader = free[0];
  const ahead = free.findIndex((e) => e.peer === me);
  if (!leader || leader.peer !== me) {
    return { action: 'wait', leader: leader ? leader.peer : null, window: mmrWindow(now - mine.since), ahead };
  }
  const waited = now - mine.since;
  const win = mmrWindow(waited);
  if (waited < LEADER_SETTLE_MS) return { action: 'wait', leader: me, window: win, ahead: 0 };
  const near = free
    .filter((e) => e.peer !== me && Math.abs(e.mmr - mine.mmr) <= Math.max(win, mmrWindow(now - e.since)))
    .sort((a, b) => Math.abs(a.mmr - mine.mmr) - Math.abs(b.mmr - mine.mmr) || byAge(a, b))
    .slice(0, MAX_HUMANS - 1);
  const size = near.length + 1;
  if (size >= MATCH_TARGET || (size >= MIN_HUMANS && waited >= MATCH_WAIT_MS)) return { action: 'host', members: near.map((e) => e.peer), window: win };
  return { action: 'wait', leader: me, window: win, ahead: 0 };
}

/**
 * A quién más avisar mientras la sala formada espera (función pura): los que
 * siguen en la cola sin sala ni aviso, con un MMR parecido al del anfitrión
 * (con el margen de lo que lleva esperando cada uno), los más parecidos
 * primero y como mucho `slots`. `para`: los ya avisados.
 */
export function planRecruit(entries, me, now, { mmr, since, slots, para = [] }) {
  if (slots <= 0) return [];
  const taken = new Set(para);
  for (const e of entries) if (e.sala && e.peer !== me) for (const p of e.sala.para) taken.add(p);
  const win = mmrWindow(now - since);
  return entries
    .filter((e) => e.peer !== me && !e.sala && !taken.has(e.peer) && Math.abs(e.mmr - mmr) <= Math.max(win, mmrWindow(now - e.since)))
    .sort((a, b) => Math.abs(a.mmr - mmr) - Math.abs(b.mmr - mmr) || byAge(a, b))
    .slice(0, slots)
    .map((e) => e.peer);
}

function byAge(a, b) {
  return a.since - b.since || (a.peer < b.peer ? -1 : 1);
}

/**
 * La cola en marcha: se anuncia en el vestíbulo y, cada medio segundo, mira
 * qué toca (planMatch). Llamadas: onHost(code, members) al crear la sala que
 * se ha formado · onJoin(code) al ser avisado · onUpdate(info) para la
 * pantalla («Buscando partida…»).
 */
export class Matchmaker {
  constructor(transport, { version, mmr, newCode, onHost, onJoin, onUpdate }) {
    this.t = transport;
    this.version = version;
    this.mmr = mmr;
    this.newCode = newCode;
    this.onHost = onHost;
    this.onJoin = onJoin;
    this.onUpdate = onUpdate;
    this.since = Date.now();
    this.active = false;
    this.done = false;
  }

  /** Mi par en el vestíbulo. */
  _me() {
    const me = this.t.lobby.peers().find((p) => p.sameTab);
    return me ? me.peer : null;
  }

  start() {
    this.active = true;
    this.since = Date.now();
    this._announce(null);
    this._timer = setInterval(() => this.tick(), 500);
    this.tick();
  }

  _announce(sala) {
    this.t.lobby.presence({ cola: { v: this.version, mmr: Math.round(this.mmr), desde: this.since, sala } });
  }

  /** Quien está en la cola ahora (yo incluido). */
  entries() {
    const out = [];
    for (const p of this.t.lobby.peers()) {
      if (p.stale && !p.sameTab) continue;
      const e = cleanQueueEntry(p.peer, p.presence && p.presence.cola, this.version);
      if (e) out.push(e);
    }
    return out;
  }

  tick() {
    if (!this.active || this.done) return;
    const me = this._me();
    if (!me) return;
    const entries = this.entries();
    const now = Date.now();
    const plan = planMatch(entries, me, now);
    const mine = entries.find((e) => e.peer === me);
    const others = entries.filter((e) => e.peer !== me && !e.sala).length;
    this.onUpdate?.({ waited: now - this.since, window: plan.window || mmrWindow(now - this.since), inQueue: others + 1, leader: plan.leader === me });
    if (plan.action === 'join') {
      this.done = true;
      this.stop();
      this.onJoin?.(plan.code);
    } else if (plan.action === 'host' && mine && !mine.sala) {
      this.done = true;
      const code = this.newCode();
      // Aviso a los elegidos y sigo en la cola con la sala: durante la espera
      // de la sala (LOBBY_WAIT_MS) entra más gente de rango parecido
      clearInterval(this._timer);
      this.onHost?.(code, plan.members);
      this.recruit(code, { para: plan.members, until: now + LOBBY_WAIT_MS });
    }
  }

  /**
   * Anfitrión de una sala que espera: se queda anunciado en la cola con su
   * sala y, cada medio segundo, avisa a más jugadores de rango parecido hasta
   * llenarla o hasta `until`. `onRecruit(peers)` con los nuevos avisados.
   */
  recruit(code, { para = [], until, seats = MATCH_SEATS, onRecruit = null } = {}) {
    this.active = true;
    this.done = true;
    this.hosting = { code, para: [...para], until, seats };
    if (onRecruit) this.onRecruit = onRecruit;
    this._announce({ code, para: this.hosting.para, hasta: until + INVITE_MS });
    clearInterval(this._timer);
    this._timer = setInterval(() => this._recruitTick(), 500);
    this._recruitTick();
  }

  _recruitTick() {
    const h = this.hosting;
    if (!this.active || !h) return;
    const now = Date.now();
    if (now > h.until + INVITE_MS) {
      this.stop();
      return;
    }
    if (now > h.until) return; // la sala ya va a empezar: no se avisa a nadie más
    const me = this._me();
    if (!me) return;
    const slots = h.seats - 1 - h.para.length;
    const fresh = planRecruit(this.entries(), me, now, { mmr: this.mmr, since: this.since, slots, para: h.para });
    if (!fresh.length) return;
    h.para.push(...fresh);
    this._announce({ code: h.code, para: h.para, hasta: h.until + INVITE_MS });
    this.onRecruit?.(fresh);
  }

  /** Sale de la cola (y deja de anunciarse). */
  stop() {
    this.active = false;
    clearInterval(this._timer);
    clearTimeout(this._clearTimer);
    try {
      this.t.lobby.presence({ cola: null });
    } catch {
      /* sin conexión */
    }
  }
}
