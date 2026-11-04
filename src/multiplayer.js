// Multijugador: salas (vestíbulo de espera) y sincronización "lockstep".
//
// Cómo funciona: todos ejecutan la misma simulación determinista con la misma
// semilla. Solo viajan las acciones. El anfitrión marca el ritmo: en cada tick
// recoge las acciones recibidas, las aplica y las reparte a los demás como un
// "turno". Los invitados avanzan solo cuando tienen el turno siguiente. Los
// mensajes pueden perderse: los invitados piden reenvíos y repiten sus
// acciones hasta verlas confirmadas en un turno.
import { MAP_IDS, TICK_MS, cleanRules } from './config.js';
import { selfPeer } from './net.js';

export const ROOM_TOPICS = ['start', 'turn', 'intent', 'resend', 'hash'];
export const MAX_HUMANS = 8;

const TURN_TICKS = 2; // ticks por mensaje del anfitrión (≈5 mensajes/s)
const MAX_MSG_BYTES = 3500; // por debajo del límite de 4 KiB
const HASH_EVERY = 100; // ticks entre comprobaciones de sincronía
const RESEND_AFTER_MS = 700;
const INTENT_RETRY_MS = 1500;
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

/** Salas que anuncian en el vestíbulo quienes las han creado. */
export function openRooms(transport) {
  if (!transport) return [];
  return transport.lobby
    .peers()
    .filter((p) => !p.sameTab && p.presence && p.presence.sala && p.presence.sala.abierta)
    .map((p) => ({ ...p.presence.sala, peer: p.peer }))
    .filter((s) => typeof s.code === 'string' && /^[a-z0-9]{5}$/.test(s.code));
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
    emblem: { shape: word(e.shape, 'escudo'), symbol: word(e.symbol, 'estrella'), bg: hex(e.bg, '#888888'), fg: hex(e.fg, '#ffffff') },
    pattern: word(p.pattern, 'liso'),
    level: Number.isFinite(p.level) ? Math.max(1, Math.min(999, Math.floor(p.level))) : 1,
    title: String(p.title || '').slice(0, 24),
  };
}

// ------------------------------------------------------------------ salas

export class Sala {
  /**
   * @param transport  resultado de connectTransport()
   * @param opts { code, isHost, me: {name,color,emblem,pattern,level,title}, settings }
   */
  constructor(transport, { code, isHost, me, settings }) {
    this.transport = transport;
    this.code = code;
    this.isHost = isHost;
    this.me = me;
    this.settings = settings;
    this.room = null;
    this.started = false;
    this.unsubs = [];
    this.onChange = null; // () => void
    this.onStart = null; // (payload, hostPeer) => void
    this._startTimer = null;
  }

  async open() {
    this.room = await this.transport.join(`sala-${this.code}`);
    this.unsubs.push(this.room.onPeers(() => this.onChange?.()));
    this.unsubs.push(this.room.on('start', (m) => this._onStart(m)));
    await this.room.presence({
      jugador: this.me,
      anfitrion: this.isHost,
      ajustes: this.isHost ? this.settings : null,
    });
    if (this.isHost) this._advertise(true);
  }

  myPeer() {
    return this.room ? selfPeer(this.room) : null;
  }

  host() {
    if (!this.room) return null;
    return this.room.peers().find((p) => p.presence && p.presence.anfitrion) || null;
  }

  /** Jugadores en la sala: el anfitrión primero, luego por orden estable. */
  players() {
    if (!this.room) return [];
    return this.room
      .peers()
      .filter((p) => p.presence && p.presence.jugador)
      .sort((a, b) => (b.presence.anfitrion ? 1 : 0) - (a.presence.anfitrion ? 1 : 0) || (a.peer < b.peer ? -1 : 1))
      .slice(0, MAX_HUMANS)
      .map((p) => ({ peer: p.peer, isMe: p.sameTab, host: !!p.presence.anfitrion, ...cleanPlayer(p.presence.jugador) }));
  }

  hostSettings() {
    const h = this.host();
    return h && h.presence.ajustes ? h.presence.ajustes : null;
  }

  setSettings(settings) {
    this.settings = settings;
    if (!this.isHost || !this.room) return;
    this.room.presence({ ajustes: settings });
    this._advertise(true);
  }

  _advertise(open) {
    this.transport.lobby.presence({
      sala: open
        ? {
            code: this.code,
            nombre: this.me.name,
            jugadores: Math.max(1, this.players().length),
            mapa: this.settings.mapSize,
            bots: this.settings.bots,
            abierta: true,
          }
        : null,
    });
  }

  /** Solo el anfitrión: reparte la semilla y la lista de jugadores. */
  start() {
    if (!this.isHost || this.started) return null;
    const players = this.players();
    const payload = {
      v: 1,
      seed: (Math.random() * 0xffffffff) >>> 0,
      settings: this.settings,
      players: players.map(({ peer, name, color, emblem, pattern }) => ({ peer, name, color, emblem, pattern })),
    };
    this.payload = payload;
    this.room.emit('start', payload);
    // Los mensajes pueden perderse: se repite durante el despliegue
    const t0 = Date.now();
    this._startTimer = setInterval(() => {
      if (Date.now() - t0 > START_REPEAT_FOR_MS) clearInterval(this._startTimer);
      else this.room?.emit('start', payload);
    }, START_REPEAT_MS);
    this._advertise(false);
    this.room.presence({ estado: 'jugando' });
    return payload;
  }

  _onStart(msg) {
    if (this.started || !msg.data || msg.data.v !== 1) return;
    const host = this.host();
    if (!msg.isMe && (!host || msg.peer !== host.peer)) return; // solo vale el del anfitrión
    const d = msg.data;
    if (!Number.isFinite(d.seed) || !Array.isArray(d.players) || !d.settings) return;
    this.started = true;
    const payload = {
      seed: d.seed >>> 0,
      settings: {
        mapSize: MAP_IDS.includes(d.settings.mapSize) ? d.settings.mapSize : 'mundo',
        bots: Math.max(0, Math.min(60, Math.floor(d.settings.bots) || 0)),
        difficulty: ['facil', 'normal', 'dificil'].includes(d.settings.difficulty) ? d.settings.difficulty : 'normal',
        rules: cleanRules(d.settings.rules),
      },
      players: d.players.slice(0, MAX_HUMANS).map((p) => ({ peer: String(p.peer), ...cleanPlayer(p) })),
    };
    this.onStart?.(payload, msg.isMe ? this.myPeer() : msg.peer);
  }

  async leave() {
    clearInterval(this._startTimer);
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.isHost) this._advertise(false);
    const room = this.room;
    this.room = null;
    if (room) await room.leave().catch(() => {});
  }
}

// ------------------------------------------------------------- lockstep

const INTENT_TYPES = new Set(['action', 'build', 'cancelAttack', 'proposeAlliance', 'respondAlliance', 'breakAlliance', 'donate', 'emoji', 'moveWarship']);

/** Solo deja pasar campos conocidos y con tipos válidos. */
function cleanIntent(raw) {
  if (!raw || typeof raw !== 'object' || !INTENT_TYPES.has(raw.type)) return null;
  const out = { type: raw.type };
  const int = (v) => (Number.isInteger(v) && v >= 0 && v < 1e7 ? v : undefined);
  if (int(raw.tile) !== undefined) out.tile = raw.tile;
  if (int(raw.targetId) !== undefined) out.targetId = raw.targetId;
  if (int(raw.fromId) !== undefined) out.fromId = raw.fromId;
  if (typeof raw.ratio === 'number' && raw.ratio >= 0 && raw.ratio <= 1) out.ratio = raw.ratio;
  if (typeof raw.accept === 'boolean') out.accept = raw.accept;
  if (['city', 'port', 'fort', 'factory', 'silo', 'sam', 'warship', 'missile'].includes(raw.kind)) out.kind = raw.kind;
  if (raw.resource === 'troops' || raw.resource === 'gold') out.resource = raw.resource;
  if (typeof raw.emoji === 'string' && raw.emoji.length <= 8) out.emoji = raw.emoji;
  return out;
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
   * @param opts { isHost, hostPeer, myPlayerId, peerToPlayer: Map<peer, playerId> }
   */
  constructor(room, game, { isHost, hostPeer, myPlayerId, peerToPlayer }) {
    this.room = room;
    this.game = game;
    this.isHost = isHost;
    this.hostPeer = hostPeer;
    this.myPlayerId = myPlayerId;
    this.peerToPlayer = peerToPlayer;
    this.counter = 0;
    this.unsubs = [];
    this.status = ''; // texto para la interfaz cuando hay problemas
    this.desynced = false;
    this.hostGone = false;
    this.onHostLeft = null;

    if (isHost) {
      this.queue = []; // acciones para el próximo tick
      this.seen = new Set();
      this.history = new Map(); // tick → acciones aplicadas
      this.batch = [];
      this.hashes = new Map();
      this.acc = 0;
      this.last = performance.now();
      this.lastResend = new Map();
      this.unsubs.push(room.on('intent', (m) => this._onIntent(m)));
      this.unsubs.push(room.on('resend', (m) => this._onResend(m)));
      this.unsubs.push(room.on('hash', (m) => this._onHash(m)));
      // Si la pestaña pasa a segundo plano, requestAnimationFrame se para: este
      // temporizador mantiene la partida en marcha para los demás.
      this._timer = setInterval(() => this.update(), 100);
    } else {
      this.turns = new Map();
      this.outbox = new Map(); // uid → { intent, sentAt }
      this.lastAdvance = performance.now();
      this.lastResendAsk = -Infinity;
      this.unsubs.push(room.on('turn', (m) => this._onTurn(m)));
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
    const u = `${this.myPlayerId}.${++this.counter}`;
    if (this.isHost) {
      this.queue.push({ ...clean, playerId: this.myPlayerId, u });
    } else {
      this.outbox.set(u, { intent: clean, sentAt: performance.now() });
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
    const now = performance.now();
    if (now - (this.lastResend.get(m.peer) ?? -Infinity) < 400) return;
    this.lastResend.set(m.peer, now);
    let turns = [];
    let bytes = 20;
    for (let t = from; t <= this.game.ticks && t < from + 60; t++) {
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
    if (!d || !Number.isInteger(d.t)) return;
    const mine = this.hashes.get(d.t);
    if (mine !== undefined && mine !== d.h) {
      this.status = 'Aviso: un jugador se ha desincronizado';
    }
  }

  _hostStep() {
    const intents = this.queue.splice(0, 30);
    for (const it of intents) this.game.queueIntent(it);
    this.game.tick();
    const t = this.game.ticks;
    this.history.set(t, intents);
    if (this.history.size > 3000) this.history.delete(t - 3000);
    if (t % HASH_EVERY === 0) {
      this.hashes.set(t, stateHash(this.game));
      if (this.hashes.size > 60) this.hashes.delete(t - HASH_EVERY * 60);
    }
    const entry = [t, intents];
    const size = JSON.stringify(this.batch).length + JSON.stringify(entry).length;
    if (this.batch.length && size > MAX_MSG_BYTES) this._flush();
    this.batch.push(entry);
    if (this.batch.length >= TURN_TICKS) this._flush();
  }

  _flush() {
    if (!this.batch.length) return;
    this.room.emit('turn', { turns: this.batch }).catch(() => {});
    this.batch = [];
  }

  // ---- invitado

  _onTurn(m) {
    if (m.peer !== this.hostPeer || !m.data || !Array.isArray(m.data.turns)) return;
    for (const entry of m.data.turns) {
      if (!Array.isArray(entry) || !Number.isInteger(entry[0]) || !Array.isArray(entry[1])) continue;
      if (entry[0] > this.game.ticks) this.turns.set(entry[0], entry[1]);
    }
  }

  _guestStep(intents) {
    for (const raw of intents) {
      const clean = cleanIntent(raw);
      if (clean && Number.isInteger(raw.playerId)) this.game.queueIntent({ ...clean, playerId: raw.playerId });
      if (raw && typeof raw.u === 'string') this.outbox.delete(raw.u);
    }
    this.game.tick();
    const t = this.game.ticks;
    if (t % HASH_EVERY === 0) this.room.emit('hash', { t, h: stateHash(this.game) }).catch(() => {});
  }

  // ---- bucle

  /** Llamar en cada frame: avanza la simulación al ritmo que toque. */
  update() {
    if (this.game.phase === 'ended' || this.hostGone) return;
    const now = performance.now();
    if (this.isHost) {
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
    while (this.turns.has(this.game.ticks + 1) && steps < 60) {
      const t = this.game.ticks + 1;
      const intents = this.turns.get(t);
      this.turns.delete(t);
      this._guestStep(intents);
      steps++;
    }
    if (steps) {
      this.lastAdvance = now;
      this.status = '';
    } else if (now - this.lastAdvance > RESEND_AFTER_MS && now - this.lastResendAsk > 1000) {
      this.lastResendAsk = now;
      this.room.emit('resend', { from: this.game.ticks + 1 }).catch(() => {});
      if (now - this.lastAdvance > 4000) this.status = 'Esperando al anfitrión…';
    }
    for (const [u, entry] of this.outbox) {
      if (now - entry.sentAt > INTENT_RETRY_MS) {
        entry.sentAt = now;
        this.room.emit('intent', { u, i: entry.intent }).catch(() => {});
      }
    }
  }

  stop() {
    clearInterval(this._timer);
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}
