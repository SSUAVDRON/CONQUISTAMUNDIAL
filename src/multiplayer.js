// Multijugador: salas (vestíbulo de espera) y sincronización "lockstep".
//
// Cómo funciona: todos ejecutan la misma simulación determinista con la misma
// semilla. Solo viajan las acciones. El anfitrión marca el ritmo: en cada tick
// recoge las acciones recibidas, las aplica y las reparte a los demás como un
// "turno". Los invitados avanzan solo cuando tienen el turno siguiente. Los
// mensajes pueden perderse: los invitados piden reenvíos y repiten sus
// acciones hasta verlas confirmadas en un turno.
import { BUILDINGS, BUILDING_KINDS, CONFIG, MAP_IDS, TICK_MS, cleanRules } from './config.js';
import { MECH, PROFILES, rulesetId } from './mecanicas.js';
import { selfPeer } from './net.js';

/**
 * Versión del protocolo de la sala y de la sincronización. 2: cada mensaje de
 * la partida lleva su ronda (revancha en la misma sala) y el anfitrión avisa
 * al salir (DEV05). 3: salas de hasta 32 (DEV06): el anfitrión concede las
 * plazas, el inicio viaja en fragmentos con acuse de recibo y las órdenes de
 * cada turno se reparten entre los emisores.
 */
export const PROTOCOL = 3;

/**
 * Huella de los parámetros del motor (MECH, perfiles, CONFIG y edificios) y
 * del protocolo: si dos clientes tienen versiones distintas, no coincide.
 */
const FINGERPRINT = (() => {
  // Con la lista de mapas: una versión sin los mapas nuevos no puede jugar con esta
  const s = JSON.stringify([PROTOCOL, MECH, PROFILES, CONFIG, BUILDINGS, MAP_IDS]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
})();

/** Huella de los parámetros del motor de esta versión del juego. */
export const RULES_FINGERPRINT = FINGERPRINT;

/** Identificador completo con el que se simula una sala: versión, perfil y huella. */
export function roomRuleset(rules) {
  return `${rulesetId(cleanRules(rules))}#${FINGERPRINT}`;
}

/**
 * Valida el mensaje de inicio del anfitrión ANTES de simular: datos bien
 * formados y la misma versión de reglas que este cliente. Si no coincide, la
 * partida no empieza (los dos simularían con parámetros distintos).
 */
export function checkStartPayload(d) {
  if (!d || d.v !== 1 || !Number.isFinite(d.seed) || !Array.isArray(d.players) || !d.settings) return { ok: false, reason: 'datos' };
  // Lista completa y sin repetidos (DEV06): ni más plazas de las que hay ni dos veces el mismo
  if (d.players.length < 1 || d.players.length > MAX_HUMANS) return { ok: false, reason: 'datos' };
  if (new Set(d.players.map((p) => String(p && p.peer))).size !== d.players.length) return { ok: false, reason: 'datos' };
  if (Number.isInteger(d.count) && d.count !== d.players.length) return { ok: false, reason: 'datos' };
  const rules = cleanRules(d.settings.rules);
  const mine = roomRuleset(rules);
  if (d.ruleset !== mine) return { ok: false, reason: 'version', theirs: String(d.ruleset || 'desconocida'), mine };
  // Un mapa que esta versión no tiene: no se juega en otro (cada uno simularía uno distinto)
  if (d.settings.mapSize != null && !MAP_IDS.includes(d.settings.mapSize)) return { ok: false, reason: 'version', theirs: `mapa ${String(d.settings.mapSize).slice(0, 24)}`, mine };
  return {
    ok: true,
    payload: {
      seed: d.seed >>> 0,
      ronda: Number.isInteger(d.ronda) && d.ronda > 0 ? d.ronda : 1,
      ruleset: mine,
      settings: {
        mapSize: MAP_IDS.includes(d.settings.mapSize) ? d.settings.mapSize : 'mundo',
        bots: Math.max(0, Math.min(MAX_ONLINE_BOTS, Math.floor(d.settings.bots) || 0)),
        difficulty: ['facil', 'normal', 'dificil', 'imposible'].includes(d.settings.difficulty) ? d.settings.difficulty : 'normal',
        rules,
        clasificatoria: !!d.settings.clasificatoria,
      },
      players: d.players.map((p) => ({ peer: String(p.peer), ...cleanPlayer(p) })),
    },
  };
}
/** Plazas humanas de una sala (DEV06): de 2 a 32, con accesos directos. */
export const MAX_HUMANS = 32;
/**
 * Mayor aforo validado con la prueba de carga (herramientas/carga-salas.js,
 * docs/carga-salas.md): es el que se ofrece al crear o editar una sala. Si
 * una prueba sobre el servidor publicado no lo supera, se baja aquí.
 */
export const VALIDATED_SEATS = 32;
export const SEAT_SHORTCUTS = [4, 8, 16, 24, 32].filter((n) => n <= VALIDATED_SEATS);
/** Plazas al crear una sala por primera vez. */
export const DEFAULT_SEATS = 8;
/** Naciones de la IA en una sala (las colonias van aparte). */
export const MAX_ONLINE_BOTS = 60;

const TURN_TICKS = 2; // ticks por mensaje del anfitrión (≈5 mensajes/s)
const MAX_MSG_BYTES = 3500; // por debajo del límite de 4 KiB (bytes UTF-8 con la envoltura del transporte)
/** Órdenes de un turno (DEV06): entre todos, por emisor y en bytes (caben en un mensaje con su envoltura). */
const MAX_TICK_INTENTS = 32;
const MAX_SENDER_TICK = 4;
const MAX_SENDER_QUEUE = 64;
const MAX_TICK_BYTES = 2800;
const HASH_EVERY = 100; // ticks entre comprobaciones de sincronía
const RESEND_AFTER_MS = 700;
const GAP_RESEND_MS = 300; // falta un turno pero ya llegan los siguientes: se pide enseguida
const RESEND_MAX_TURNS = 200; // por petición (los turnos vacíos ocupan ~10 bytes)
const INTENT_RETRY_MS = 1500;
// Reproducción suave del invitado: los turnos llegan de dos en dos (y con los
// vaivenes de la red); se juegan de uno en uno cada 100 ms con un pequeño
// colchón, y si se acumulan muchos (pestaña en segundo plano, corte) se
// recuperan de golpe.
const CATCHUP_TURNS = 10;
const SMOOTH_BUFFER = 2;
export const OFFLINE_NOTE = 'Sin conexión: reconectando…';
const LOAD_WAIT_MS = 20000; // el anfitrión espera como mucho esto a que carguen todos

/**
 * Reloj de 100 ms para el anfitrión. En una pestaña en segundo plano el
 * navegador frena los temporizadores (hasta uno por minuto); los de un
 * Worker siguen a su ritmo, así la partida no se ralentiza para los demás.
 * Si no se puede crear el Worker, un setInterval normal.
 */
function startTicker(fn) {
  try {
    const src = 'setInterval(function () { postMessage(0); }, 100);';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = fn;
    return () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = setInterval(fn, 100);
    return () => clearInterval(id);
  }
}
const START_REPEAT_MS = 1500;
const START_REPEAT_FOR_MS = 12000;
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newRoomCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

export function normalizeCode(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
}

/** Mínimo de jugadores humanos para empezar una partida en sala. */
export const MIN_HUMANS = 2;
/** Cuenta atrás antes de arrancar (fija participantes, semilla y configuración). */
export const COUNTDOWN_MS = 3000;
/** Visibilidad: «Solo con enlace» (no sale en el vestíbulo) o «Pública». */
export const VISIBILITIES = ['enlace', 'publica'];

/** Nombre, visibilidad y plazas de una sala (no cambian la partida). */
export function cleanRoomInfo(raw, fallbackName = 'Sala') {
  const r = raw && typeof raw === 'object' ? raw : {};
  const name = String(r.nombre || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 28);
  const seats = Math.round(Number(r.plazas));
  return {
    nombre: name || String(fallbackName).slice(0, 28),
    visibilidad: VISIBILITIES.includes(r.visibilidad) ? r.visibilidad : 'enlace',
    plazas: Number.isFinite(seats) ? Math.max(MIN_HUMANS, Math.min(MAX_HUMANS, seats)) : 4,
  };
}

/**
 * Nombre en la sala: el del perfil o, si no tiene uno propio (vacío o el de
 * por defecto, «Mi nación»), «Recluta NNNN» con una etiqueta fija de la página:
 * así dos perfiles sin nombre no se confunden desde que entran.
 */
export function roomName(profileName, tag) {
  const n = String(profileName || '').trim();
  return n && n !== 'Mi nación' ? n.slice(0, 18) : `Recluta ${String(tag || '').slice(0, 4) || '0000'}`;
}

/** Lo que sí cambia la partida: si cambia, los invitados tienen que confirmar de nuevo. */
export function gameplayKey(settings) {
  const s = settings || {};
  return JSON.stringify([s.mapSize, s.bots, s.difficulty, cleanRules(s.rules), !!s.clasificatoria]);
}

/** Salas públicas que anuncian en el vestíbulo quienes las han creado. Las «Solo con enlace» no aparecen. */
export function openRooms(transport) {
  if (!transport) return [];
  return transport.lobby
    .peers()
    .filter((p) => !p.sameTab && p.presence && p.presence.sala && p.presence.sala.abierta && p.presence.sala.visibilidad === 'publica')
    .map((p) => ({ ...p.presence.sala, peer: p.peer, otraVersion: p.presence.sala.version !== FINGERPRINT }))
    .filter((s) => typeof s.code === 'string' && /^[a-z0-9]{5}$/.test(s.code))
    .sort((x, y) => (y.jugadores || 0) - (x.jugadores || 0) || (x.code < y.code ? -1 : 1));
}

/**
 * Estado de la sala a partir de la presencia de cada par (función pura, la
 * usan la interfaz, el inicio y los tests): jugadores sentados por orden de
 * llegada (el anfitrión primero), quién está listo PARA LA REVISIÓN ACTUAL de
 * la configuración, quién se reconecta o tiene otra versión del juego, y qué
 * impide empezar.
 */
export function roomStatus(peers, { myPeer = null } = {}) {
  const host = peers.find((p) => p.presence && p.presence.anfitrion && p.presence.jugador) || null;
  const rev = host ? host.presence.rev : null;
  const info = cleanRoomInfo(host && host.presence.info);
  const hostVersion = host ? host.presence.version : null;
  const all = peers.filter((p) => p.presence && p.presence.jugador).sort(byArrival);
  const mk = (p) => {
    const isHost = !!p.presence.anfitrion;
    return {
      peer: p.peer,
      isMe: p.peer === myPeer || !!p.sameTab,
      host: isHost,
      ...cleanPlayer(p.presence.jugador),
      ready: isHost || (rev != null && p.presence.listo === rev),
      stale: !!p.stale,
      versionOk: !host || p.presence.version === hostVersion,
    };
  };
  // Nombres repetidos: «Vega» y «Vega (2)», por orden de llegada (los mismos en la lista, los motivos y la partida)
  const seen = new Map();
  const listed = all.map(mk).map((p) => {
    const n = (seen.get(p.name) || 0) + 1;
    seen.set(p.name, n);
    if (n === 1) return p;
    const suffix = ` (${n})`;
    return { ...p, name: `${p.name.slice(0, 18 - suffix.length)}${suffix}` }; // cabe en los 18 de la partida
  });
  // Plazas: primero las que ha concedido el anfitrión (en su orden); las libres,
  // por orden de llegada, hasta que el anfitrión las confirme (DEV06)
  const granted = host && Array.isArray(host.presence.admitidos) ? host.presence.admitidos.map(String) : null;
  let players;
  if (granted) {
    const byPeer = new Map(listed.map((p) => [p.peer, p]));
    const seated = granted.map((id) => byPeer.get(id)).filter(Boolean).slice(0, info.plazas);
    const ids = new Set(seated.map((p) => p.peer));
    for (const p of listed) if (seated.length < info.plazas && !ids.has(p.peer)) seated.push(p), ids.add(p.peer);
    players = seated;
  } else players = listed.slice(0, info.plazas);
  const seatedIds = new Set(players.map((p) => p.peer));
  const waiting = listed.filter((p) => !seatedIds.has(p.peer));
  const blockers = [];
  if (!host) blockers.push('El anfitrión no está en la sala');
  for (const p of players) if (!p.versionOk) blockers.push(`${p.name} tiene otra versión del juego: tiene que recargar la página`);
  for (const p of players) if (p.stale) blockers.push(`${p.name} se está reconectando`);
  const missing = players.filter((p) => !p.ready && !p.stale && p.versionOk).map((p) => p.name);
  if (missing.length) blockers.push(`${missing.length > 1 ? 'Faltan' : 'Falta'} ${missing.length > 1 ? `${missing.slice(0, -1).join(', ')} y ${missing[missing.length - 1]}` : missing[0]}`);
  if (players.length < MIN_HUMANS) blockers.push('Hace falta al menos otro jugador');
  return { host, rev, info, players, waiting, seats: info.plazas, readyCount: players.filter((p) => p.ready).length, total: players.length, blockers, canStart: blockers.length === 0 };
}

/** Copia "segura" de lo que otro jugador dice de sí mismo (datos no fiables). */
function cleanPlayer(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  const word = (v, d) => (typeof v === 'string' && /^[a-z]{2,12}$/.test(v) ? v : d);
  const e = p.emblem && typeof p.emblem === 'object' ? p.emblem : {};
  return {
    name: String(p.name || 'Jugador').replace(/[\u0000-\u001f]/g, '').slice(0, 18) || 'Jugador',
    color: hex(p.color, '#888888'),
    emblem: { shape: word(e.shape, 'escudo'), symbol: word(e.symbol, 'estrella'), bg: hex(e.bg, '#888888'), fg: hex(e.fg, '#ffffff'), flag: typeof e.flag === 'string' && /^[a-z]{2,3}$/.test(e.flag) ? e.flag : '' },
    pattern: word(p.pattern, 'liso'),
    level: Number.isFinite(p.level) ? Math.max(1, Math.min(999, Math.floor(p.level))) : 1,
    title: String(p.title || '').slice(0, 24),
    // Aspecto para la presentación de la partida: marco del emblema, estandarte y color del nombre
    frame: word(p.frame, 'ninguno'),
    banner: word(p.banner, 'noche'),
    nameColor: typeof p.nameColor === 'string' && /^[a-z]{2,12}$/.test(p.nameColor) ? p.nameColor : '',
  };
}

// --------------------------------------------------------- fragmentos

const utf8 = new TextEncoder();
/** Bytes UTF-8 de `s`. */
export function utf8Bytes(s) {
  return utf8.encode(s).length;
}
/** Bytes del mensaje tal como lo manda el transporte: con su envoltura y el identificador del remitente. */
export function wireBytes(topic, data, peer = 'xxxxxxxxxxxx') {
  return utf8Bytes(JSON.stringify({ t: 'e', topic, data, peer }));
}

/**
 * Parte el mensaje de inicio en fragmentos que caben en el presupuesto del
 * transporte (DEV06). Cada uno lleva la sala y la ronda, la revisión, su
 * índice y el total; el primero, además, la cabecera (semilla, reglas y
 * configuración). Los jugadores van enteros, con su puesto `x`.
 */
export function startFragments(payload, { code = '', maxBytes = MAX_MSG_BYTES } = {}) {
  const { players, ...head } = payload;
  const k = `${code}.${payload.ronda}.${payload.rev || 0}.${payload.seed}`;
  const base = (i) => ({ v: 2, k, r: payload.ronda, rev: payload.rev || 0, i, n: 99, count: players.length, p: [] });
  const frags = [];
  let cur = { ...base(0), h: head };
  if (wireBytes('inicio', cur) > maxBytes) throw new Error('La configuración no cabe en un mensaje');
  players.forEach((pl, x) => {
    const entry = { ...pl, x };
    cur.p.push(entry);
    if (wireBytes('inicio', cur) <= maxBytes) return;
    cur.p.pop();
    if (cur.p.length) frags.push(cur);
    cur = base(frags.length);
    cur.p.push(entry);
    if (wireBytes('inicio', cur) > maxBytes) throw new Error('Un jugador no cabe en un mensaje');
  });
  frags.push(cur);
  for (const f of frags) f.n = frags.length;
  return frags;
}

/**
 * Reconstruye el inicio a partir de sus fragmentos (DEV06): acepta
 * duplicados idénticos, rechaza los contradictorios (se queda con el primero)
 * y, con todos, comprueba el recuento y que no haya puestos ni jugadores
 * repetidos antes de devolver el mensaje completo.
 */
export class StartAssembler {
  constructor() {
    this.key = null;
    this.total = 0;
    this.parts = new Map(); // índice → texto del fragmento (para comparar duplicados)
    this.frags = new Map();
    this.conflicts = 0;
    this.done = null;
  }

  /** Fragmento recibido: { estado: 'parcial' | 'completo' | 'error' | 'ignorado', payload? }. */
  add(f) {
    if (!f || f.v !== 2 || typeof f.k !== 'string' || f.k.length > 80 || !Number.isInteger(f.i) || !Number.isInteger(f.n) || f.n < 1 || f.n > 64 || f.i < 0 || f.i >= f.n || !Array.isArray(f.p)) return { estado: 'ignorado' };
    if (f.k !== this.key) {
      this.key = f.k;
      this.total = f.n;
      this.parts = new Map();
      this.frags = new Map();
      this.done = null;
    }
    if (this.done) return { estado: 'completo', payload: this.done };
    if (f.n !== this.total) {
      this.conflicts++;
      return { estado: 'ignorado' };
    }
    const text = JSON.stringify(f);
    const prev = this.parts.get(f.i);
    if (prev !== undefined) {
      if (prev !== text) this.conflicts++;
      return { estado: 'parcial' };
    }
    this.parts.set(f.i, text);
    this.frags.set(f.i, f);
    if (this.frags.size < this.total) return { estado: 'parcial' };
    const head = this.frags.get(0).h;
    const players = [];
    for (let i = 0; i < this.total; i++) players.push(...this.frags.get(i).p);
    players.sort((a, b) => a.x - b.x);
    const count = this.frags.get(0).count;
    const okOrder = players.every((pl, i) => pl && pl.x === i);
    if (!head || typeof head !== 'object' || players.length !== count || !okOrder) return { estado: 'error' };
    this.done = { ...head, count, players: players.map(({ x, ...pl }) => pl) };
    return { estado: 'completo', payload: this.done };
  }

  /** Índices que faltan del inicio en curso. */
  missing() {
    const out = [];
    for (let i = 0; i < this.total; i++) if (!this.frags.has(i)) out.push(i);
    return out;
  }
}

/** Orden de llegada a la sala (el anfitrión primero). */
function byArrival(a, b) {
  return (b.presence.anfitrion ? 1 : 0) - (a.presence.anfitrion ? 1 : 0) || (Number(a.presence.desde) || 0) - (Number(b.presence.desde) || 0) || (a.peer < b.peer ? -1 : 1);
}

/**
 * Plazas concedidas por el anfitrión (DEV06): las ya concedidas se mantienen
 * mientras su jugador siga en la sala (también reconectando: la plaza se le
 * reserva) y las libres se dan por orden de llegada. Así la última plaza se
 * concede una sola vez aunque lleguen dos a la vez.
 */
export function admitPeers(peers, { prev = [], seats, hostPeer }) {
  const present = new Map(peers.filter((p) => p.presence && p.presence.jugador).map((p) => [p.peer, p]));
  const list = [hostPeer, ...prev.filter((id) => id !== hostPeer && present.has(id))];
  const cands = [...present.values()].filter((p) => !list.includes(p.peer) && !p.presence.anfitrion).sort(byArrival);
  for (const c of cands) {
    if (list.length >= seats) break;
    list.push(c.peer);
  }
  return list;
}

// ------------------------------------------------------------------ salas

export class Sala {
  /**
   * @param transport  resultado de connectTransport()
   * @param opts { code, isHost, me: {name,color,emblem,pattern,level,title}, settings, info }
   *
   * Llamadas: onChange() al cambiar algo · onStart(payload, hostPeer) al
   * arrancar · onCountdown(ms | null, motivo) al empezar o cancelarse la
   * cuenta atrás · onVersionMismatch(suya, mía) · onConnection(conectado).
   */
  constructor(transport, { code, isHost, me, settings, info }) {
    this.transport = transport;
    this.code = code;
    this.isHost = isHost;
    this.me = me;
    this.settings = settings;
    this.info = cleanRoomInfo(info, `Sala de ${me && me.name ? me.name : 'Trinchera'}`);
    /** Revisión de la configuración: sube cuando cambia algo que afecta a la partida. */
    this.rev = 1;
    /** Ronda de la sala: la revancha es la siguiente (mismo código, semilla nueva). */
    this.ronda = 1;
    this.playedRonda = 0; // la que jugó este cliente (para saber si ya hay revancha)
    this.minRonda = 1; // un invitado no acepta inicios de rondas anteriores
    this._key = gameplayKey(settings);
    this.ready = false;
    this.observer = false;
    this.room = null;
    this.started = false;
    this.countdown = null;
    this.unsubs = [];
    this.onChange = null;
    this.onStart = null;
    this.onCountdown = null;
    this.onConnection = null;
    this._startTimer = null;
    /** Anfitrión: plazas concedidas (pares, en orden); reservadas mientras reconectan. */
    this.admitted = [];
    /** Invitado: fragmentos del inicio recibidos ({ got, total } mientras faltan). */
    this.asm = new StartAssembler();
    this.sync = null;
    /** Anfitrión: quién ha confirmado el inicio completo. */
    this.acks = new Set();
  }

  /** Entra en el canal. `observer`: solo mira (ficha de invitación), sin ocupar plaza. */
  async open({ observer = false } = {}) {
    this.observer = observer && !this.isHost;
    this.openedAt = Date.now();
    this.room = await this.transport.join(`sala-${this.code}`);
    this.unsubs.push(this.room.onPeers(() => this._changed()));
    this.unsubs.push(this.room.on('inicio', (m) => this._onFragment(m)));
    this.unsubs.push(this.room.on('inicio-falta', (m) => this._onMissing(m)));
    this.unsubs.push(this.room.on('inicio-ok', (m) => this._onAck(m)));
    this.unsubs.push(this.room.on('cuenta', (m) => this._onCountdownMsg(m)));
    this.unsubs.push(this.room.on('cancelar', (m) => this._onCancelMsg(m)));
    if (this.room.onConnection) this.unsubs.push(this.room.onConnection((on) => this.onConnection?.(on)) || (() => {}));
    if (this.isHost) {
      await this.room.presence({ jugador: this.me, anfitrion: true, ajustes: this.settings, rev: this.rev, ronda: this.ronda, info: this.info, estado: 'vestibulo', version: FINGERPRINT, desde: Date.now(), rango: this.rankClaim || null });
      this._admit();
      this._advertise();
    } else if (!this.observer) await this.join();
    this._tick = setInterval(() => {
      this._watchCountdown();
      this._watchStart();
    }, 250);
  }

  /** Invitado: ocupa su plaza (desde la ficha de invitación). */
  async join() {
    this.observer = false;
    this.ready = false;
    await this.room.presence({ jugador: this.me, listo: null, version: FINGERPRINT, desde: Date.now(), rango: this.rankClaim || null });
  }

  /** Rango firmado que anuncia cada par de la sala (presencia `rango`): Map peer → datos sin comprobar. */
  rankClaims() {
    const out = new Map();
    if (!this.room) return out;
    for (const p of this.room.peers()) if (p.presence && p.presence.rango) out.set(p.peer, p.presence.rango);
    return out;
  }

  myPeer() {
    return this.room ? selfPeer(this.room) : null;
  }

  host() {
    if (!this.room) return null;
    return this.room.peers().find((p) => p.presence && p.presence.anfitrion && p.presence.jugador) || null;
  }

  status() {
    return roomStatus(this.room ? this.room.peers() : [], { myPeer: this.myPeer() });
  }

  /** Jugadores sentados (el anfitrión primero, luego por orden de llegada). */
  players() {
    return this.status().players;
  }

  hostSettings() {
    const h = this.host();
    return h && h.presence.ajustes ? h.presence.ajustes : null;
  }

  /** Nombre, visibilidad y plazas actuales (las del anfitrión). */
  roomInfo() {
    if (this.isHost) return this.info;
    const h = this.host();
    return cleanRoomInfo(h && h.presence.info);
  }

  /**
   * Ficha de invitación: si se puede entrar y, si no, por qué.
   * estado: 'buscando' | 'lista' | 'llena' | 'empezada' | 'cerrada' | 'version'
   */
  entryState() {
    const h = this.host();
    if (!h) return { estado: this.openedAt && Date.now() - this.openedAt > 5000 ? 'cerrada' : 'buscando' };
    const st = this.status();
    const base = { info: st.info, settings: h.presence.ajustes || null, total: st.total, seats: st.seats };
    if (h.presence.estado === 'jugando') return { ...base, estado: 'empezada' };
    if (h.presence.version !== FINGERPRINT) return { ...base, estado: 'version' };
    const meSeated = st.players.some((p) => p.isMe);
    if (!meSeated && st.total >= st.seats) return { ...base, estado: 'llena' };
    return { ...base, estado: 'lista' };
  }

  /** Invitado: «Estoy listo» / «Cancelar listo» (para la revisión actual de la configuración). */
  setReady(on) {
    if (this.isHost || !this.room) return;
    const st = this.status();
    this.ready = !!on && st.rev != null;
    this.room.presence({ listo: this.ready ? st.rev : null });
  }

  /** ¿Sigue valiendo mi «listo»? (si el anfitrión cambió el mapa o las reglas, no) */
  myReadyValid() {
    const st = this.status();
    const me = st.players.find((p) => p.isMe);
    return !!me && me.ready;
  }

  /** Anfitrión: cambia mapa, naciones, dificultad o reglas (los invitados confirman de nuevo). */
  setSettings(settings) {
    this.settings = settings;
    if (!this.isHost || !this.room) return;
    const key = gameplayKey(settings);
    if (key !== this._key) {
      this._key = key;
      this.rev++;
    }
    if (this.countdown) this.cancelCountdown('El anfitrión ha cambiado la configuración');
    this.room.presence({ ajustes: settings, rev: this.rev });
    this._advertise();
  }

  /** Anfitrión: nombre, visibilidad y plazas (no invalidan la preparación). */
  setInfo(info) {
    this.info = cleanRoomInfo({ ...this.info, ...info }, this.info.nombre);
    if (!this.isHost || !this.room) return;
    // El aforo no baja de los que ya tienen plaza (con las reservadas a quien reconecta)
    this.info.plazas = Math.max(this.info.plazas, this.minSeats());
    this.room.presence({ info: this.info });
    this._admit();
    this._advertise();
  }

  /** Aforo mínimo al editar: los jugadores con plaza, incluidos los que reconectan (DEV06). */
  minSeats() {
    return Math.max(MIN_HUMANS, this.isHost ? this.admitted.length : this.status().total);
  }

  /** Anfitrión: concede las plazas libres y lo anuncia (una sola vez cada una). */
  _admit() {
    if (!this.isHost || !this.room) return;
    const me = this.myPeer();
    if (!me) return;
    const list = this.started ? this.admitted.filter((id) => this.room.peers().some((p) => p.peer === id)) : admitPeers(this.room.peers(), { prev: this.admitted, seats: this.info.plazas, hostPeer: me });
    if (list.length === this.admitted.length && list.every((id, i) => id === this.admitted[i])) return;
    this.admitted = list;
    this.room.presence({ admitidos: list });
  }

  _advertise() {
    if (!this.isHost) return;
    const open = !!this.room && !this.started;
    const pub = open && this.info.visibilidad === 'publica';
    const st = pub ? this.status() : null;
    this.transport.lobby.presence({
      sala: pub
        ? {
            code: this.code,
            nombre: this.info.nombre,
            visibilidad: 'publica',
            jugadores: Math.max(1, st.total),
            plazas: this.info.plazas,
            mapa: this.settings.mapSize,
            bots: this.settings.bots,
            perfil: this.settings.rules && this.settings.rules.profile,
            victoria: this.settings.rules && this.settings.rules.victory,
            clasificatoria: !!this.settings.clasificatoria,
            version: FINGERPRINT,
            abierta: true,
          }
        : null,
    });
  }

  _changed() {
    if (this.isHost && !this.started) this._admit();
    if (this.isHost && !this.started) {
      // El número de jugadores del anuncio, al día
      const n = this.status().total;
      if (n !== this._advertisedPlayers) {
        this._advertisedPlayers = n;
        this._advertise();
      }
    }
    this._watchCountdown();
    this.onChange?.();
  }

  // ------------------------------------------------------- cuenta atrás

  /**
   * Anfitrión: si todo está listo, empieza la cuenta atrás de 3 s. Fija los
   * participantes, la semilla y la revisión; si alguien sale, pierde la
   * conexión o deja de estar listo, se cancela y se vuelve al vestíbulo con el
   * motivo. Devuelve null o el motivo por el que no se puede.
   */
  beginCountdown() {
    if (!this.isHost || this.started || this.countdown || !this.room) return 'Ya se está preparando el inicio';
    const st = this.status();
    if (!st.canStart) return st.blockers[0];
    this.countdown = {
      endsAt: Date.now() + COUNTDOWN_MS,
      seed: (Math.random() * 0xffffffff) >>> 0,
      rev: this.rev,
      peers: st.players.map((p) => p.peer),
      names: Object.fromEntries(st.players.map((p) => [p.peer, p.name])),
    };
    this.room.presence({ estado: 'cuenta' });
    this._sendCountdown();
    this.onCountdown?.(COUNTDOWN_MS, null);
    return null;
  }

  _sendCountdown() {
    const c = this.countdown;
    if (!c || !this.room) return;
    this.room.emit('cuenta', { v: 1, ms: Math.max(0, c.endsAt - Date.now()), rev: c.rev, peers: c.peers });
    c.lastSent = Date.now();
  }

  /** Anfitrión: cancela la cuenta atrás y lo dice a todos. */
  cancelCountdown(motivo) {
    if (!this.countdown) return;
    this.countdown = null;
    if (this.isHost && this.room) {
      this.room.emit('cancelar', { v: 1, motivo: String(motivo).slice(0, 120) });
      this.room.presence({ estado: 'vestibulo' });
    }
    this.onCountdown?.(null, motivo);
    this.onChange?.();
  }

  /** Comprueba la cuenta atrás en curso (cada 250 ms y con cada cambio). */
  _watchCountdown() {
    const c = this.countdown;
    if (!c || this.started || !this.room) return;
    if (!this.isHost) {
      // Invitado: si el anfitrión desaparece, se vuelve al vestíbulo
      const h = this.host();
      if (!h || h.stale) {
        this.countdown = null;
        this.onCountdown?.(null, 'Se ha perdido la conexión con el anfitrión');
        this.onChange?.();
      }
      return;
    }
    const peers = new Map(this.room.peers().map((p) => [p.peer, p]));
    for (const id of c.peers) {
      const p = peers.get(id);
      const name = c.names[id] || 'Un jugador';
      if (!p || !p.presence || !p.presence.jugador) return this.cancelCountdown(`${name} ha salido de la sala`);
      if (p.stale) return this.cancelCountdown(`${name} ha perdido la conexión`);
      if (!p.presence.anfitrion && p.presence.listo !== c.rev) return this.cancelCountdown(`${name} ya no está listo`);
    }
    if (Date.now() >= c.endsAt) this._launch();
    else if (Date.now() - (c.lastSent || 0) > 600) this._sendCountdown(); // por si se pierde algún mensaje
  }

  _onCountdownMsg(msg) {
    if (this.isHost || this.started || !msg.data || msg.data.v !== 1) return;
    const h = this.host();
    if (!h || msg.peer !== h.peer) return;
    const ms = Math.max(0, Math.min(COUNTDOWN_MS, Number(msg.data.ms) || 0));
    const first = !this.countdown;
    this.countdown = { endsAt: Date.now() + ms, rev: msg.data.rev, peers: Array.isArray(msg.data.peers) ? msg.data.peers.map(String) : [] };
    if (first) this.onCountdown?.(ms, null);
  }

  _onCancelMsg(msg) {
    if (this.isHost || this.started || !msg.data || msg.data.v !== 1) return;
    const h = this.host();
    if (!h || msg.peer !== h.peer) return;
    this.countdown = null;
    this.onCountdown?.(null, String(msg.data.motivo || 'Se ha cancelado el inicio').slice(0, 120));
    this.onChange?.();
  }

  /** Fin de la cuenta atrás: reparte semilla, configuración y jugadores (una sola vez). */
  _launch() {
    const c = this.countdown;
    if (!c || this.started) return;
    const all = new Map(this.status().players.map((p) => [p.peer, p]));
    const players = c.peers.map((id) => all.get(id)).filter(Boolean);
    this.countdown = null;
    this.start({ seed: c.seed, players });
  }

  /**
   * Solo el anfitrión: reparte la semilla y la lista de jugadores. Sin
   * argumentos (pruebas o anfitrión solo) usa la sala tal cual.
   */
  start({ seed = (Math.random() * 0xffffffff) >>> 0, players = this.players() } = {}) {
    if (!this.isHost || this.started) return null;
    this.started = true;
    const payload = {
      v: 1,
      seed,
      ronda: this.ronda,
      rev: this.rev,
      // Versión de reglas con la que simula el anfitrión: cada invitado la comprueba
      ruleset: roomRuleset(this.settings.rules),
      settings: this.settings,
      // Lo que se ve de cada uno en la partida y en la presentación (nivel, título, marco, estandarte…)
      players: players.map(({ peer, name, color, emblem, pattern, level, title, frame, banner, nameColor }) => ({ peer, name, color, emblem, pattern, level, title, frame, banner, nameColor })),
    };
    payload.count = payload.players.length;
    this.payload = payload;
    // En fragmentos dentro del presupuesto del transporte (DEV06); se repiten
    // durante el despliegue hasta que todos confirman que los tienen
    this.fragments = startFragments(payload, { code: this.code });
    this.acks = new Set();
    this._expect = new Set(payload.players.map((p) => p.peer).filter((id) => id !== this.myPeer()));
    for (const f of this.fragments) this.room.emit('inicio', f);
    const t0 = Date.now();
    this._startTimer = setInterval(() => {
      const all = [...this._expect].every((id) => this.acks.has(id));
      if (all || Date.now() - t0 > START_REPEAT_FOR_MS) clearInterval(this._startTimer);
      else for (const f of this.fragments) this.room?.emit('inicio', f);
    }, START_REPEAT_MS);
    this._advertise();
    this.room.presence({ estado: 'jugando' });
    this._accept(payload, this.myPeer(), true);
    return payload;
  }

  /** Invitado: llega un fragmento del inicio (solo vale el del anfitrión). */
  _onFragment(msg) {
    if (this.isHost || msg.isMe || !msg.data || this._startHandled) return;
    const host = this.host();
    if (!host || msg.peer !== host.peer) return;
    const f = msg.data;
    if (!Number.isInteger(f.r) || f.r < this.minRonda) return; // restos de una ronda anterior
    const res = this.asm.add(f);
    if (res.estado === 'ignorado') return;
    if (res.estado === 'parcial') {
      const got = this.asm.frags.size;
      if (!this.sync || this.sync.got !== got) {
        this.sync = { got, total: this.asm.total, since: this.sync?.since || Date.now(), asked: this.sync?.asked || 0 };
        this.onChange?.();
      }
      return;
    }
    if (res.estado === 'error') return;
    this.sync = null;
    if (this._accept(res.payload, msg.peer, false)) this.room.emit('inicio-ok', { r: f.r, k: f.k });
  }

  /** Invitado: pide los fragmentos que faltan (si no llegan solos al poco). */
  _watchStart() {
    const s = this.sync;
    if (!s || this.isHost || this._startHandled || !this.room) return;
    const now = Date.now();
    if (now - s.since < 600 || now - s.asked < 700) return;
    s.asked = now;
    this.room.emit('inicio-falta', { r: Number(this.asm.key?.split('.')[1]) || this.minRonda, k: this.asm.key, falta: this.asm.missing() });
  }

  /** Anfitrión: reenvía los fragmentos pedidos (como mucho uno cada 300 ms por invitado). */
  _onMissing(msg) {
    if (!this.isHost || !this.fragments || !msg.data || msg.data.k !== this.fragments[0].k || !Array.isArray(msg.data.falta)) return;
    const now = Date.now();
    this._missingAt ??= new Map();
    if (now - (this._missingAt.get(msg.peer) || 0) < 300) return;
    this._missingAt.set(msg.peer, now);
    for (const i of msg.data.falta.slice(0, 64)) if (Number.isInteger(i) && this.fragments[i]) this.room.emit('inicio', this.fragments[i]);
  }

  /** Anfitrión: un invitado tiene el inicio completo. */
  _onAck(msg) {
    if (!this.isHost || !this.fragments || !msg.data || msg.data.k !== this.fragments[0].k) return;
    if (!this.acks.has(msg.peer)) {
      this.acks.add(msg.peer);
      this.onChange?.();
    }
  }

  /** Inicio completo (propio o reconstruido): se valida y se arranca una sola vez. */
  _accept(data, peer, isMe) {
    if (this._startHandled) return false;
    const check = checkStartPayload(data);
    if (!check.ok) {
      // Otra versión del juego: no se simula (se avisa una vez y se sigue en la sala)
      if (check.reason === 'version' && !this._versionWarned) {
        this._versionWarned = true;
        this.onVersionMismatch?.(check.theirs, check.mine);
      }
      return false;
    }
    // Un inicio repetido de una ronda anterior (se reenvía unos segundos) no vale tras volver a la sala
    if (!isMe && check.payload.ronda < this.minRonda) return false;
    this._startHandled = true;
    this.started = true;
    this.countdown = null;
    this.playedRonda = check.payload.ronda;
    this.onStart?.(check.payload, peer);
    return true;
  }

  // ------------------------------------------------------------ revancha

  /**
   * Anfitrión: abre la revancha en el mismo vestíbulo (mismo código, enlace,
   * mapa, reglas y visibilidad). Sube la ronda y la revisión, así que todos
   * confirman «Estoy listo» de nuevo; la cuenta atrás reparte semilla nueva.
   */
  reopen() {
    if (!this.isHost || !this.room) return;
    clearInterval(this._startTimer);
    this.started = false;
    this._startHandled = false;
    this.payload = null;
    this.fragments = null;
    this.acks = new Set();
    this.countdown = null;
    this.ronda++;
    this.rev++;
    this.room.presence({ estado: 'vestibulo', ronda: this.ronda, rev: this.rev });
    this._advertise();
    this.onChange?.();
  }

  /** Invitado: ¿ha abierto ya el anfitrión la revancha de la ronda que jugamos? */
  rematchOpen() {
    const h = this.host();
    return !!(h && !h.stale && h.presence.estado === 'vestibulo' && (h.presence.ronda || 1) > this.playedRonda);
  }

  /** Invitado: vuelve al vestíbulo para la revancha (sin «listo»: hay que confirmar otra vez). */
  async rejoin() {
    if (this.isHost || !this.room) return;
    const h = this.host();
    this.started = false;
    this._startHandled = false;
    this.asm = new StartAssembler();
    this.sync = null;
    this.countdown = null;
    this.ready = false;
    this.minRonda = Math.max(this.playedRonda + 1, (h && h.presence.ronda) || 1);
    await this.room.presence({ listo: null });
    this.onChange?.();
  }

  async leave() {
    clearInterval(this._startTimer);
    clearInterval(this._tick);
    if (this.countdown && this.isHost) this.cancelCountdown('El anfitrión ha salido de la sala');
    for (const u of this.unsubs) u?.();
    this.unsubs = [];
    const room = this.room;
    this.room = null;
    if (this.isHost) this._advertise();
    if (room) await room.leave().catch(() => {});
  }
}

// ------------------------------------------------------------- lockstep

const INTENT_TYPES = new Set(['action', 'build', 'cancelAttack', 'proposeAlliance', 'respondAlliance', 'breakAlliance', 'donate', 'emoji', 'share', 'research', 'spec', 'proposePact', 'respondPact', 'offerPeace', 'respondPeace', 'askHelp', 'bank']);
const SAFE_ID = /^[a-z]{2,16}$/;

/** Solo deja pasar campos conocidos y con tipos válidos. */
function cleanIntent(raw) {
  if (!raw || typeof raw !== 'object' || !INTENT_TYPES.has(raw.type)) return null;
  const out = { type: raw.type };
  const int = (v) => (Number.isInteger(v) && v >= 0 && v < 1e7 ? v : undefined);
  if (int(raw.tile) !== undefined) out.tile = raw.tile;
  if (int(raw.targetId) !== undefined) out.targetId = raw.targetId;
  if (int(raw.fromId) !== undefined) out.fromId = raw.fromId;
  if (typeof raw.ratio === 'number' && raw.ratio >= 0 && raw.ratio <= 1) out.ratio = raw.ratio;
  if (typeof raw.share === 'number' && raw.share >= 0 && raw.share <= 1) out.share = raw.share;
  if (typeof raw.tech === 'string' && SAFE_ID.test(raw.tech)) out.tech = raw.tech;
  if (typeof raw.spec === 'string' && SAFE_ID.test(raw.spec)) out.spec = raw.spec;
  if (typeof raw.on === 'boolean') out.on = raw.on;
  if (typeof raw.tribute === 'number' && raw.tribute >= 0 && raw.tribute <= 0.5) out.tribute = raw.tribute;
  if (typeof raw.accept === 'boolean') out.accept = raw.accept;
  if (raw.op === 'in' || raw.op === 'out') out.op = raw.op; // banco de tropas de la capital
  // Lo que se puede pedir desde la barra (la tabla de edificios; la capital nace con la nación)
  if (typeof raw.kind === 'string' && BUILDING_KINDS.includes(raw.kind)) out.kind = raw.kind;
  if (raw.resource === 'troops' || raw.resource === 'gold') out.resource = raw.resource;
  if (typeof raw.emoji === 'string' && raw.emoji.length <= 8) out.emoji = raw.emoji;
  return out;
}

/** Puesto en la sala de quien envió una acción (va al principio de su clave «puesto.n»). */
function slotOf(u) {
  const n = typeof u === 'string' ? Number(u.split('.')[0]) : NaN;
  return Number.isInteger(n) ? n : undefined;
}

/** Huella del estado para detectar desincronizaciones. */
export function stateHash(game) {
  let h = 2166136261 >>> 0;
  const owner = game.owner;
  for (let i = 0; i < owner.length; i += 3) h = Math.imul(h ^ owner[i], 16777619);
  for (const p of game.players) if (p) h = Math.imul(h ^ (Math.floor(p.troops) & 0xffffff), 16777619);
  return h >>> 0;
}

export class NetSync {
  /**
   * @param room     canal de la sala
   * @param game     simulación ya creada (misma semilla en todos)
   * @param opts { isHost, hostPeer, myPlayerId, peerToPlayer: Map<peer, playerId>, mySlot }
   * `mySlot`: puesto del jugador en la sala (único aunque dos jugadores
   * compartan nación en el modo cooperativo).
   */
  constructor(room, game, { isHost, hostPeer, myPlayerId, peerToPlayer, mySlot = myPlayerId, myPeer = null, smooth = false, ronda = 1, now = () => performance.now() }) {
    this.room = room;
    /** Ronda de la sala: los mensajes de otra ronda (una revancha, o restos de la anterior) se descartan. */
    this.ronda = ronda;
    this.game = game;
    this.isHost = isHost;
    this.hostPeer = hostPeer;
    this.myPlayerId = myPlayerId;
    this.mySlot = mySlot;
    this.peerToPlayer = peerToPlayer;
    this.counter = 0;
    this.unsubs = [];
    this.status = ''; // texto para la interfaz cuando hay problemas
    this.desynced = false;
    this.hostGone = false;
    this.hostGoneReason = '';
    this.onHostLeft = null;
    this.myPeer = myPeer;
    /** true en el juego: el invitado reproduce los turnos a ritmo constante (ver CATCHUP_TURNS). */
    this.smooth = smooth;
    this.now = now;

    if (isHost) {
      this.queue = []; // acciones para el próximo tick
      this.pending = new Map(); // emisor → acciones suyas en la cola
      this.seen = new Set();
      this.history = new Map(); // tick → acciones aplicadas
      this.batch = [];
      this.hashes = new Map();
      this.acc = 0;
      this.last = now();
      this.lastResend = new Map();
      this.unsubs.push(room.on('intent', (m) => this._mine(m) && this._onIntent(m)));
      this.unsubs.push(room.on('resend', (m) => this._mine(m) && this._onResend(m)));
      this.unsubs.push(room.on('hash', (m) => this._mine(m) && this._onHash(m)));
      // Antes del primer turno, espera a que todos hayan cargado el mapa (si
      // no, quien carga despacio pierde parte del despliegue)
      this.waiting = new Set([...peerToPlayer.keys()].filter((peer) => peer !== hostPeer && peer !== myPeer));
      this.waitStart = now();
      this.unsubs.push(room.on('cargado', (m) => this._mine(m) && this.waiting.delete(m.peer)));
      this.unsubs.push(room.onPeers((c) => {
        for (const p of c.left) this.waiting.delete(p.peer);
      }));
      // Si la pestaña pasa a segundo plano, requestAnimationFrame se para: este
      // reloj mantiene la partida en marcha para los demás.
      this._stopTicker = startTicker(() => this.update());
    } else {
      this.turns = new Map();
      this.outbox = new Map(); // uid → { intent, sentAt }
      this.lastAdvance = now();
      this.lastResendAsk = -Infinity;
      this.playLast = now();
      this.playAcc = TICK_MS; // el primer turno se juega en cuanto llega
      this.unsubs.push(room.on('turn', (m) => this._mine(m) && this._onTurn(m)));
      // Hashes del anfitrión, para que el invitado sepa si se ha desincronizado
      this.myHashes = new Map();
      this.hostHashes = new Map();
      this.unsubs.push(room.on('hash', (m) => this._mine(m) && this._onHostHash(m)));
      // El anfitrión avisa al salir: interrupción explícita (no un corte de red)
      this.unsubs.push(
        room.on('adios', (m) => {
          if (!this._mine(m) || m.peer !== this.hostPeer || this.hostGone) return;
          this.hostGone = true;
          this.hostGoneReason = 'abandono';
          this.onHostLeft?.('abandono');
        }),
      );
      // Avisa de que ya ha cargado (y repite hasta que llegue el primer turno)
      const announce = () => {
        if (this.game.ticks > 0 || this.turns.size || this.hostGone) {
          clearInterval(this._loadTimer);
          return;
        }
        room.emit('cargado', { r: this.ronda }).catch(() => {});
      };
      this._loadTimer = setInterval(announce, 1000);
      announce();
      this.unsubs.push(
        room.onPeers((c) => {
          if (c.left.some((p) => p.peer === this.hostPeer) && !this.hostGone) {
            this.hostGone = true;
            this.hostGoneReason = 'conexion';
            this.onHostLeft?.('conexion');
          }
        }),
      );
    }
  }

  /** Acción del jugador local. */
  localIntent(intent) {
    const clean = cleanIntent(intent);
    if (!clean) return;
    const u = `${this.mySlot}.${++this.counter}`;
    if (this.isHost) {
      this.queue.push({ ...clean, playerId: this.myPlayerId, u });
    } else {
      this.outbox.set(u, { intent: clean, sentAt: this.now() });
      this.room.emit('intent', { r: this.ronda, u, i: clean }).catch(() => {});
    }
  }

  /** ¿Es de esta ronda? (los mensajes sin ronda son de la 1) */
  _mine(m) {
    return !!m && ((m.data && m.data.r) || 1) === this.ronda;
  }

  /** Anfitrión: avisa a todos de que deja la partida (la interrupción se ve al momento y con su motivo). */
  announceLeave(motivo = 'abandono') {
    if (!this.isHost) return;
    this.room.emit('adios', { r: this.ronda, motivo }).catch(() => {});
  }

  // ---- anfitrión

  _onIntent(m) {
    const pid = this.peerToPlayer.get(m.peer); // el remitente lo pone la plataforma, no los datos
    const d = m.data;
    if (!pid || !d || typeof d.u !== 'string' || d.u.length > 24 || this.seen.has(d.u)) return;
    const intent = cleanIntent(d.i);
    if (!intent) return;
    // Cola por emisor acotada (DEV06): si alguien manda de más, lo que sobra no
    // se acepta todavía (sin marcarlo como visto: su cliente lo reintenta)
    const sender = slotOf(d.u);
    const pending = this.pending.get(sender) || 0;
    if (pending >= MAX_SENDER_QUEUE) return;
    this.pending.set(sender, pending + 1);
    this.seen.add(d.u);
    this.queue.push({ ...intent, playerId: pid, u: d.u });
  }

  /**
   * Órdenes de este turno (DEV06): por orden de llegada, como mucho
   * MAX_SENDER_TICK de cada emisor y MAX_TICK_INTENTS en total, sin pasar de
   * MAX_TICK_BYTES (así el turno cabe en un mensaje). Lo demás espera al
   * siguiente turno: ni una cola larga ni un solo cliente se quedan con todo.
   */
  _takeIntents() {
    const out = [];
    const rest = [];
    const per = new Map();
    let bytes = 0;
    for (const it of this.queue) {
      const sender = slotOf(it.u);
      const n = per.get(sender) || 0;
      const size = utf8Bytes(JSON.stringify(it)) + 1;
      if (out.length >= MAX_TICK_INTENTS || n >= MAX_SENDER_TICK || bytes + size > MAX_TICK_BYTES) {
        rest.push(it);
        continue;
      }
      per.set(sender, n + 1);
      bytes += size;
      out.push(it);
      const left = (this.pending.get(sender) || 1) - 1;
      if (left > 0) this.pending.set(sender, left);
      else this.pending.delete(sender);
    }
    this.queue = rest;
    return out;
  }

  _onResend(m) {
    const from = m.data && m.data.from;
    if (!Number.isInteger(from)) return;
    const now = this.now();
    if (now - (this.lastResend.get(m.peer) ?? -Infinity) < 250) return;
    this.lastResend.set(m.peer, now);
    let turns = [];
    let bytes = wireBytes('turn', { r: this.ronda, turns: [] });
    for (let t = Math.max(from, this.game.ticks - 2999); t <= this.game.ticks && t < from + RESEND_MAX_TURNS; t++) {
      const entry = [t, this.history.get(t) || []];
      const size = utf8Bytes(JSON.stringify(entry)) + 1;
      if (bytes + size > MAX_MSG_BYTES) break;
      turns.push(entry);
      bytes += size;
    }
    if (turns.length) this.room.emit('turn', { r: this.ronda, turns }).catch(() => {});
  }

  _onHash(m) {
    const d = m.data;
    if (m.isMe || !d || d.host || !Number.isInteger(d.t)) return;
    const mine = this.hashes.get(d.t);
    if (mine !== undefined && mine !== d.h) {
      this.status = 'Aviso: un jugador se ha desincronizado';
    }
  }

  _hostStep() {
    const intents = this._takeIntents();
    for (const it of intents) this.game.queueIntent({ ...it, by: slotOf(it.u) });
    this.game.tick();
    const t = this.game.ticks;
    this.history.set(t, intents);
    if (this.history.size > 3000) this.history.delete(t - 3000);
    if (t % HASH_EVERY === 0) {
      const h = stateHash(this.game);
      this.hashes.set(t, h);
      if (this.hashes.size > 60) this.hashes.delete(t - HASH_EVERY * 60);
      // También a los invitados: cada uno comprueba si sigue sincronizado
      this.room.emit('hash', { r: this.ronda, t, h, host: true }).catch(() => {});
    }
    const entry = [t, intents];
    // El turno, con su envoltura, en bytes UTF-8 (DEV06)
    if (this.batch.length && wireBytes('turn', { r: this.ronda, turns: [...this.batch, entry], bg: 1 }) > MAX_MSG_BYTES) this._flush();
    this.batch.push(entry);
    if (this.batch.length >= TURN_TICKS) this._flush();
  }

  _flush() {
    if (!this.batch.length) return;
    // bg: la pestaña del anfitrión está en segundo plano (los invitados lo avisan)
    const bg = typeof document !== 'undefined' && document.hidden ? 1 : 0;
    this.room.emit('turn', bg ? { r: this.ronda, turns: this.batch, bg } : { r: this.ronda, turns: this.batch }).catch(() => {});
    this.batch = [];
  }

  // ---- invitado

  _onTurn(m) {
    if (m.peer !== this.hostPeer || !m.data || !Array.isArray(m.data.turns)) return;
    this.hostBackground = !!m.data.bg;
    for (const entry of m.data.turns) {
      if (!Array.isArray(entry) || !Number.isInteger(entry[0]) || !Array.isArray(entry[1])) continue;
      if (entry[0] > this.game.ticks) this.turns.set(entry[0], entry[1]);
    }
  }

  _guestStep(intents) {
    for (const raw of intents) {
      const clean = cleanIntent(raw);
      if (clean && Number.isInteger(raw.playerId)) this.game.queueIntent({ ...clean, playerId: raw.playerId, by: slotOf(raw.u) });
      if (raw && typeof raw.u === 'string') this.outbox.delete(raw.u);
    }
    this.game.tick();
    const t = this.game.ticks;
    if (t % HASH_EVERY === 0) {
      const h = stateHash(this.game);
      this.room.emit('hash', { r: this.ronda, t, h }).catch(() => {});
      this.myHashes.set(t, h);
      if (this.myHashes.size > 60) this.myHashes.delete(t - HASH_EVERY * 60);
      this._compareHash(t);
    }
  }

  /** Hash del anfitrión para el tick `t`: se compara con el propio en cuanto estén los dos. */
  _onHostHash(m) {
    const d = m.data;
    if (m.peer !== this.hostPeer || !d || !d.host || !Number.isInteger(d.t)) return;
    this.hostHashes.set(d.t, d.h);
    if (this.hostHashes.size > 60) this.hostHashes.delete(d.t - HASH_EVERY * 60);
    this._compareHash(d.t);
  }

  _compareHash(t) {
    const mine = this.myHashes.get(t);
    const host = this.hostHashes.get(t);
    if (mine === undefined || host === undefined || this.desynced) return;
    if (mine !== host) this.desynced = true;
  }

  // ---- bucle

  /** ¿Se ha cortado nuestra conexión con el servidor? (el canal se reconecta solo) */
  _offline() {
    return typeof this.room.connected === 'function' && !this.room.connected();
  }

  /** Turnos seguidos listos para jugar a partir del siguiente tick. */
  _ready(max = 64) {
    let n = 0;
    while (n < max && this.turns.has(this.game.ticks + 1 + n)) n++;
    return n;
  }

  _playNext() {
    const t = this.game.ticks + 1;
    const intents = this.turns.get(t);
    this.turns.delete(t);
    this._guestStep(intents);
  }

  /** Llamar en cada frame: avanza la simulación al ritmo que toque. */
  update() {
    if (this.game.phase === 'ended' || this.hostGone) return;
    const now = this.now();
    const offline = this._offline();
    if (this.isHost) {
      if (this.waiting.size && now - this.waitStart < LOAD_WAIT_MS) {
        this.last = now;
        const total = this.peerToPlayer.size - 1;
        this.status = `Sincronizando jugadores (${total - this.waiting.size}/${total})…`;
        return;
      }
      if (this.waitStart !== null) {
        this.waitStart = null;
        this.waiting.clear();
        this.status = '';
      }
      // Sin conexión, el anfitrión sigue (los invitados piden lo que se pierda al volver)
      if (offline) this.status = OFFLINE_NOTE;
      else if (this.status === OFFLINE_NOTE) this.status = '';
      this.acc += Math.min(1000, now - this.last);
      this.last = now;
      let steps = 0;
      while (this.acc >= TICK_MS && steps < 10) {
        this._hostStep();
        this.acc -= TICK_MS;
        steps++;
      }
      return;
    }
    let steps = 0;
    const ready = this._ready();
    // Muchos turnos pendientes (tras un corte o con la pestaña en segundo plano): se recuperan de golpe
    if (ready > CATCHUP_TURNS) this.status = 'Sincronizando partida…';
    if (!this.smooth || ready > CATCHUP_TURNS) {
      // Sin suavizado, o muy por detrás: todo lo que haya (hasta 60 por llamada),
      // dejando el colchón para no quedarse sin turnos al momento siguiente
      const keep = this.smooth ? SMOOTH_BUFFER : 0;
      while (steps < 60 && ready - steps > keep && this.turns.has(this.game.ticks + 1)) {
        this._playNext();
        steps++;
      }
      this.playAcc = 0;
    } else {
      const dt = Math.min(250, Math.max(0, now - this.playLast));
      if (!ready) this.playAcc = Math.min(TICK_MS, this.playAcc + dt); // el próximo, en cuanto llegue
      else {
        this.playAcc += dt;
        // A ritmo normal, y algo más deprisa si se acumulan (hasta volver al colchón)
        const every = ready <= SMOOTH_BUFFER ? TICK_MS : ready <= 5 ? TICK_MS * 0.9 : TICK_MS * 0.75;
        while (this.playAcc >= every && steps < ready) {
          this._playNext();
          this.playAcc -= every;
          steps++;
        }
      }
    }
    this.playLast = now;
    if (steps) {
      this.lastAdvance = now;
      // (mientras se recuperan muchos turnos se sigue viendo «Sincronizando partida…»)
      if (this._ready() <= CATCHUP_TURNS) {
        this.status = this.desynced
          ? 'Te has desincronizado del anfitrión: lo que ves puede no coincidir con los demás'
          : this.hostBackground
            ? 'El anfitrión tiene la partida en segundo plano: puede ir más lenta'
            : '';
      }
    }
    // Falta el siguiente turno pero ya llegan otros posteriores: se ha perdido
    // un mensaje, se pide enseguida. Si no llega nada, se pide pasado un rato.
    const gap = this.turns.size > 0 && !this.turns.has(this.game.ticks + 1);
    if (gap ? now - this.lastResendAsk > GAP_RESEND_MS : !steps && now - this.lastAdvance > RESEND_AFTER_MS && now - this.lastResendAsk > 1000) {
      this.lastResendAsk = now;
      this.room.emit('resend', { r: this.ronda, from: this.game.ticks + 1 }).catch(() => {});
    }
    if (!steps) {
      if (offline) this.status = OFFLINE_NOTE;
      else if (now - this.lastAdvance > 4000) this.status = 'Esperando al anfitrión…';
      else if (this.status === OFFLINE_NOTE) this.status = '';
    }
    for (const [u, entry] of this.outbox) {
      if (now - entry.sentAt > INTENT_RETRY_MS) {
        entry.sentAt = now;
        this.room.emit('intent', { r: this.ronda, u, i: entry.intent }).catch(() => {});
      }
    }
  }

  stop() {
    this._stopTicker?.();
    clearInterval(this._loadTimer);
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}
