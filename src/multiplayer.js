// Multijugador: salas (vestíbulo de espera) y sincronización "lockstep".
//
// Cómo funciona: todos ejecutan la misma simulación determinista con la misma
// semilla. Solo viajan las acciones. El anfitrión marca el ritmo: en cada tick
// recoge las acciones recibidas, las aplica y las reparte a los demás como un
// "turno". Los invitados avanzan solo cuando tienen el turno siguiente. Los
// mensajes pueden perderse: los invitados piden reenvíos y repiten sus
// acciones hasta verlas confirmadas en un turno.
import { BUILDINGS, CONFIG, MAP_IDS, TICK_MS, cleanRules } from './config.js';
import { MECH, PROFILES, rulesetId } from './mecanicas.js';
import { selfPeer } from './net.js';

export const ROOM_TOPICS = ['start', 'turn', 'intent', 'resend', 'hash', 'cargado'];

/**
 * Huella de los parámetros del motor (MECH, perfiles, CONFIG y edificios): si
 * dos clientes tienen versiones distintas del juego, no coincide.
 */
const FINGERPRINT = (() => {
  const s = JSON.stringify([MECH, PROFILES, CONFIG, BUILDINGS]);
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
  const rules = cleanRules(d.settings.rules);
  const mine = roomRuleset(rules);
  if (d.ruleset !== mine) return { ok: false, reason: 'version', theirs: String(d.ruleset || 'desconocida'), mine };
  return {
    ok: true,
    payload: {
      seed: d.seed >>> 0,
      ruleset: mine,
      settings: {
        mapSize: MAP_IDS.includes(d.settings.mapSize) ? d.settings.mapSize : 'mundo',
        bots: Math.max(0, Math.min(60, Math.floor(d.settings.bots) || 0)),
        difficulty: ['facil', 'normal', 'dificil', 'imposible'].includes(d.settings.difficulty) ? d.settings.difficulty : 'normal',
        rules,
        clasificatoria: !!d.settings.clasificatoria,
      },
      players: d.players.slice(0, MAX_HUMANS).map((p) => ({ peer: String(p.peer), ...cleanPlayer(p) })),
    },
  };
}
export const MAX_HUMANS = 8;

const TURN_TICKS = 2; // ticks por mensaje del anfitrión (≈5 mensajes/s)
const MAX_MSG_BYTES = 3500; // por debajo del límite de 4 KiB
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
  const all = peers
    .filter((p) => p.presence && p.presence.jugador)
    .sort((a, b) => (b.presence.anfitrion ? 1 : 0) - (a.presence.anfitrion ? 1 : 0) || (Number(a.presence.desde) || 0) - (Number(b.presence.desde) || 0) || (a.peer < b.peer ? -1 : 1));
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
  const players = listed.slice(0, info.plazas);
  const waiting = listed.slice(info.plazas);
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
  }

  /** Entra en el canal. `observer`: solo mira (ficha de invitación), sin ocupar plaza. */
  async open({ observer = false } = {}) {
    this.observer = observer && !this.isHost;
    this.openedAt = Date.now();
    this.room = await this.transport.join(`sala-${this.code}`);
    this.unsubs.push(this.room.onPeers(() => this._changed()));
    this.unsubs.push(this.room.on('start', (m) => this._onStart(m)));
    this.unsubs.push(this.room.on('cuenta', (m) => this._onCountdownMsg(m)));
    this.unsubs.push(this.room.on('cancelar', (m) => this._onCancelMsg(m)));
    if (this.room.onConnection) this.unsubs.push(this.room.onConnection((on) => this.onConnection?.(on)) || (() => {}));
    if (this.isHost) {
      await this.room.presence({ jugador: this.me, anfitrion: true, ajustes: this.settings, rev: this.rev, info: this.info, estado: 'vestibulo', version: FINGERPRINT, desde: Date.now(), rango: this.rankClaim || null });
      this._advertise();
    } else if (!this.observer) await this.join();
    this._tick = setInterval(() => this._watchCountdown(), 250);
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
    this.room.presence({ info: this.info });
    this._advertise();
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
      // Versión de reglas con la que simula el anfitrión: cada invitado la comprueba
      ruleset: roomRuleset(this.settings.rules),
      settings: this.settings,
      // Lo que se ve de cada uno en la partida y en la presentación (nivel, título, marco, estandarte…)
      players: players.map(({ peer, name, color, emblem, pattern, level, title, frame, banner, nameColor }) => ({ peer, name, color, emblem, pattern, level, title, frame, banner, nameColor })),
    };
    this.payload = payload;
    this.room.emit('start', payload);
    // Los mensajes pueden perderse: se repite durante el despliegue
    const t0 = Date.now();
    this._startTimer = setInterval(() => {
      if (Date.now() - t0 > START_REPEAT_FOR_MS) clearInterval(this._startTimer);
      else this.room?.emit('start', payload);
    }, START_REPEAT_MS);
    this._advertise();
    this.room.presence({ estado: 'jugando' });
    return payload;
  }

  _onStart(msg) {
    if (!msg.data || msg.data.v !== 1) return;
    if (this.started && !msg.isMe) return;
    if (this.isHost && !msg.isMe) return;
    if (this._startHandled) return;
    const host = this.host();
    if (!msg.isMe && (!host || msg.peer !== host.peer)) return; // solo vale el del anfitrión
    const check = checkStartPayload(msg.data);
    if (!check.ok) {
      // Otra versión del juego: no se simula (se avisa una vez y se sigue en la sala)
      if (check.reason === 'version' && !this._versionWarned) {
        this._versionWarned = true;
        this.onVersionMismatch?.(check.theirs, check.mine);
      }
      return;
    }
    this._startHandled = true;
    this.started = true;
    this.countdown = null;
    this.onStart?.(check.payload, msg.isMe ? this.myPeer() : msg.peer);
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

const INTENT_TYPES = new Set(['action', 'build', 'cancelAttack', 'proposeAlliance', 'respondAlliance', 'breakAlliance', 'donate', 'emoji', 'share', 'research', 'spec', 'proposePact', 'respondPact', 'offerPeace', 'respondPeace', 'askHelp']);
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
  if (['city', 'port', 'fort', 'factory', 'silo', 'sam', 'warship', 'missile', 'hbomb', 'mirv'].includes(raw.kind)) out.kind = raw.kind;
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
  constructor(room, game, { isHost, hostPeer, myPlayerId, peerToPlayer, mySlot = myPlayerId, myPeer = null, smooth = false, now = () => performance.now() }) {
    this.room = room;
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
    this.onHostLeft = null;
    this.myPeer = myPeer;
    /** true en el juego: el invitado reproduce los turnos a ritmo constante (ver CATCHUP_TURNS). */
    this.smooth = smooth;
    this.now = now;

    if (isHost) {
      this.queue = []; // acciones para el próximo tick
      this.seen = new Set();
      this.history = new Map(); // tick → acciones aplicadas
      this.batch = [];
      this.hashes = new Map();
      this.acc = 0;
      this.last = now();
      this.lastResend = new Map();
      this.unsubs.push(room.on('intent', (m) => this._onIntent(m)));
      this.unsubs.push(room.on('resend', (m) => this._onResend(m)));
      this.unsubs.push(room.on('hash', (m) => this._onHash(m)));
      // Antes del primer turno, espera a que todos hayan cargado el mapa (si
      // no, quien carga despacio pierde parte del despliegue)
      this.waiting = new Set([...peerToPlayer.keys()].filter((peer) => peer !== hostPeer && peer !== myPeer));
      this.waitStart = now();
      this.unsubs.push(room.on('cargado', (m) => this.waiting.delete(m.peer)));
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
      this.unsubs.push(room.on('turn', (m) => this._onTurn(m)));
      // Hashes del anfitrión, para que el invitado sepa si se ha desincronizado
      this.myHashes = new Map();
      this.hostHashes = new Map();
      this.unsubs.push(room.on('hash', (m) => this._onHostHash(m)));
      // Avisa de que ya ha cargado (y repite hasta que llegue el primer turno)
      const announce = () => {
        if (this.game.ticks > 0 || this.turns.size || this.hostGone) {
          clearInterval(this._loadTimer);
          return;
        }
        room.emit('cargado', {}).catch(() => {});
      };
      this._loadTimer = setInterval(announce, 1000);
      announce();
      this.unsubs.push(
        room.onPeers((c) => {
          if (c.left.some((p) => p.peer === this.hostPeer)) {
            this.hostGone = true;
            this.onHostLeft?.();
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
      this.room.emit('intent', { u, i: clean }).catch(() => {});
    }
  }

  // ---- anfitrión

  _onIntent(m) {
    const pid = this.peerToPlayer.get(m.peer); // el remitente lo pone la plataforma, no los datos
    const d = m.data;
    if (!pid || !d || typeof d.u !== 'string' || d.u.length > 24 || this.seen.has(d.u)) return;
    const intent = cleanIntent(d.i);
    if (!intent) return;
    this.seen.add(d.u);
    this.queue.push({ ...intent, playerId: pid, u: d.u });
  }

  _onResend(m) {
    const from = m.data && m.data.from;
    if (!Number.isInteger(from)) return;
    const now = this.now();
    if (now - (this.lastResend.get(m.peer) ?? -Infinity) < 250) return;
    this.lastResend.set(m.peer, now);
    let turns = [];
    let bytes = 20;
    for (let t = Math.max(from, this.game.ticks - 2999); t <= this.game.ticks && t < from + RESEND_MAX_TURNS; t++) {
      const entry = [t, this.history.get(t) || []];
      const size = JSON.stringify(entry).length;
      if (bytes + size > MAX_MSG_BYTES) break;
      turns.push(entry);
      bytes += size;
    }
    if (turns.length) this.room.emit('turn', { turns }).catch(() => {});
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
    const intents = this.queue.splice(0, 30);
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
      this.room.emit('hash', { t, h, host: true }).catch(() => {});
    }
    const entry = [t, intents];
    const size = JSON.stringify(this.batch).length + JSON.stringify(entry).length;
    if (this.batch.length && size > MAX_MSG_BYTES) this._flush();
    this.batch.push(entry);
    if (this.batch.length >= TURN_TICKS) this._flush();
  }

  _flush() {
    if (!this.batch.length) return;
    // bg: la pestaña del anfitrión está en segundo plano (los invitados lo avisan)
    const bg = typeof document !== 'undefined' && document.hidden ? 1 : 0;
    this.room.emit('turn', bg ? { turns: this.batch, bg } : { turns: this.batch }).catch(() => {});
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
      this.room.emit('hash', { t, h }).catch(() => {});
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
        this.status = 'Esperando a que todos carguen el mapa…';
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
      this.status = this.desynced
        ? 'Te has desincronizado del anfitrión: lo que ves puede no coincidir con los demás'
        : this.hostBackground
          ? 'El anfitrión tiene la partida en segundo plano: puede ir más lenta'
          : '';
    }
    // Falta el siguiente turno pero ya llegan otros posteriores: se ha perdido
    // un mensaje, se pide enseguida. Si no llega nada, se pide pasado un rato.
    const gap = this.turns.size > 0 && !this.turns.has(this.game.ticks + 1);
    if (gap ? now - this.lastResendAsk > GAP_RESEND_MS : !steps && now - this.lastAdvance > RESEND_AFTER_MS && now - this.lastResendAsk > 1000) {
      this.lastResendAsk = now;
      this.room.emit('resend', { from: this.game.ticks + 1 }).catch(() => {});
    }
    if (!steps) {
      if (offline) this.status = OFFLINE_NOTE;
      else if (now - this.lastAdvance > 4000) this.status = 'Esperando al anfitrión…';
      else if (this.status === OFFLINE_NOTE) this.status = '';
    }
    for (const [u, entry] of this.outbox) {
      if (now - entry.sentAt > INTENT_RETRY_MS) {
        entry.sentAt = now;
        this.room.emit('intent', { u, i: entry.intent }).catch(() => {});
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
