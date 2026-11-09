// Transporte en tiempo real para el multijugador. Las tres variantes ofrecen
// la misma interfaz (la de la capacidad `room` de Claude):
//   canal.emit(tema, datos) · canal.on(tema, fn) · canal.presence(parche)
//   canal.peers() · canal.onPeers(fn) · canal.connected() · canal.leave()
//
// - Dentro de Claude: `room` conecta a todas las personas con el enlace abierto.
// - En la web (Hostinger u otro hosting): un servidor MQTT público por
//   WebSocket seguro conecta navegadores de distintos dispositivos. Es gratis
//   y sin cuentas, pero público: cualquiera que conozca el canal puede leer o
//   escribir, así que el juego valida todo lo que recibe.
// - Si no hay ninguno (o con ?red=local): BroadcastChannel entre pestañas del
//   mismo navegador, para probar.
import { MqttClient } from './mqtt.js';

/** Servidores MQTT públicos por WebSocket seguro, en orden de preferencia. */
export const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://mqtt.eclipseprojects.io/mqtt'];
/** Prefijo de los temas MQTT del juego (cambia con incompatibilidades de protocolo). */
export const TOPIC_PREFIX = 'trinchera-ssuav/v1';

const HEARTBEAT_MS = 1500;
/** Tras este silencio, un par se marca «reconectando» (sigue en la lista). */
export const STALE_MS = 4000;
/** Vestíbulo: se olvida a quien lleva este tiempo sin dar señales. */
const LOBBY_TIMEOUT_MS = 6000;
/** Salas: la plaza se reserva este tiempo para que pueda volver a conectar. */
export const ROOM_TIMEOUT_MS = 15000;

const hasWindow = typeof window !== 'undefined';

/**
 * Identidad de esta página: la misma mientras siga abierta, también tras un
 * corte de conexión (el cliente MQTT se reconecta solo y la presencia vuelve
 * con el mismo par, así que conserva su plaza en la sala).
 */
const PAGE_PEER = Math.random().toString(36).slice(2, 12);
function tabPeerId() {
  return PAGE_PEER;
}

/**
 * Elige el transporte. `prefer`: 'local' (solo pestañas), un índice de
 * servidor MQTT (el del anfitrión, que llega en el enlace de invitación) o
 * nada (el primero que responda).
 */
export async function connectTransport({ prefer = null, brokerUrl = null, peerId = null } = {}) {
  const pid = peerId || tabPeerId();
  const claude = hasWindow ? window.claude : null;
  if (claude && typeof claude.use === 'function') {
    try {
      const room = await claude.use('room');
      if (room) return new ClaudeTransport(room);
    } catch {
      /* sin room: probamos las alternativas */
    }
  }
  if (prefer !== 'local' && typeof WebSocket !== 'undefined') {
    // Servidor propio o de pruebas (?broker=ws://…): solo ese
    if (brokerUrl) {
      try {
        const client = await new MqttClient(brokerUrl, { clientId: `trinchera-${tabPeerId()}-${Math.random().toString(36).slice(2, 6)}` }).connect(5000);
        return new MqttTransport(client, -1, brokerUrl, pid);
      } catch {
        /* sigue con los públicos */
      }
    }
    const order = Number.isInteger(prefer) && BROKERS[prefer] ? [prefer, ...BROKERS.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...BROKERS.keys()];
    for (const i of order) {
      try {
        const client = await new MqttClient(BROKERS[i], { clientId: `trinchera-${tabPeerId()}-${Math.random().toString(36).slice(2, 6)}` }).connect(5000);
        return new MqttTransport(client, i, null, pid);
      } catch {
        /* siguiente servidor */
      }
    }
  }
  if (typeof BroadcastChannel !== 'undefined') return new LocalTransport(pid);
  return null;
}

/** Etiqueta de esta pestaña dentro de un canal (o null si aún no se sabe). */
export function selfPeer(channel) {
  const me = channel.peers().find((p) => p.sameTab);
  return me ? me.peer : null;
}

class ClaudeTransport {
  constructor(room) {
    this.kind = 'claude';
    this.lobby = room;
  }

  join(name) {
    return this.lobby.join(name);
  }
}

// ---------------------------------------------- buses (por dónde viajan)

/** Pestañas del mismo navegador. */
class LocalBus {
  constructor(name) {
    this.bc = new BroadcastChannel(`dominia:${name}`);
    this.fn = null;
    this.bc.onmessage = (e) => this.fn?.(e.data);
  }

  send(m) {
    this.bc?.postMessage(m);
  }

  onMessage(fn) {
    this.fn = fn;
  }

  connected() {
    return !!this.bc;
  }

  onConnection(fn) {
    queueMicrotask(() => fn(this.connected()));
    return () => {};
  }

  close() {
    this.bc?.close();
    this.bc = null;
  }
}

/** Un tema MQTT por canal, compartido por todos sus pares. */
class MqttBus {
  constructor(client, name) {
    this.client = client;
    this.topic = `${TOPIC_PREFIX}/c/${name}`;
    this.fn = null;
    this.unsub = client.onMessage((topic, payload) => {
      if (topic !== this.topic) return;
      let m;
      try {
        m = JSON.parse(payload);
      } catch {
        return;
      }
      this.fn?.(m);
    });
    client.subscribe(this.topic);
  }

  send(m) {
    this.client.publish(this.topic, JSON.stringify(m));
  }

  onMessage(fn) {
    this.fn = fn;
  }

  connected() {
    return this.client.isConnected;
  }

  onConnection(fn) {
    queueMicrotask(() => fn(this.connected()));
    return this.client.onState(fn);
  }

  close() {
    this.unsub();
    this.client.unsubscribe(this.topic);
    this.fn = null;
  }
}

class LocalTransport {
  constructor(peerId = tabPeerId()) {
    this.kind = 'local';
    this.peerId = peerId;
    this.lobby = new PeerChannel(new LocalBus('vestibulo'), this.peerId, { timeout: LOBBY_TIMEOUT_MS });
  }

  async join(name) {
    return new PeerChannel(new LocalBus(`sala:${name}`), this.peerId, { timeout: ROOM_TIMEOUT_MS });
  }

  close() {
    this.lobby.leave();
  }
}

export class MqttTransport {
  constructor(client, brokerIndex, brokerUrl = null, peerId = tabPeerId()) {
    this.kind = 'mqtt';
    this.client = client;
    /** Índice en BROKERS (va en el enlace de invitación) o -1 si es uno propio (brokerUrl). */
    this.brokerIndex = brokerIndex;
    this.brokerUrl = brokerUrl || BROKERS[brokerIndex];
    this.peerId = peerId;
    this.lobby = new PeerChannel(new MqttBus(client, 'vestibulo'), this.peerId, { timeout: LOBBY_TIMEOUT_MS });
  }

  async join(name) {
    return new PeerChannel(new MqttBus(this.client, `sala-${name}`), this.peerId, { timeout: ROOM_TIMEOUT_MS });
  }

  close() {
    this.lobby.leave();
    this.client.close();
  }
}

// ------------------------------------------- canal con presencia (común)

/**
 * Presencia por latidos: cada par repite la suya cada 1,5 s; quien calla más
 * de STALE_MS se marca «reconectando» (stale) y, pasado `timeout`, sale de la
 * lista. Al volver con la misma identidad recupera su sitio.
 */
export class PeerChannel {
  constructor(bus, peerId, { timeout = LOBBY_TIMEOUT_MS } = {}) {
    this.bus = bus;
    this.peerId = peerId;
    this.timeout = timeout;
    this.mine = {};
    this.others = new Map(); // peer → { presence, updatedAt, lastSeen }
    this.topics = new Map(); // tema → Set(fn)
    this.peerFns = new Set();
    this.open = true;
    bus.onMessage((m) => this._recv(m));
    this._hb = setInterval(() => {
      this._send({ t: 'p', presence: this.mine });
      this._expire();
    }, HEARTBEAT_MS);
    // Al volver la conexión, se anuncia de nuevo (los demás responden con la suya)
    this._unConn = bus.onConnection((on) => {
      if (on && this.open) this._send({ t: 'hola', presence: this.mine });
    });
    this._onHide = () => this.leave();
    if (hasWindow) window.addEventListener('pagehide', this._onHide);
    this._send({ t: 'hola', presence: this.mine });
  }

  _send(m) {
    if (this.open) this.bus.send({ ...m, peer: this.peerId });
  }

  _recv(m) {
    if (!m || typeof m !== 'object' || typeof m.peer !== 'string' || m.peer === this.peerId) return;
    if (m.t === 'p' || m.t === 'hola') {
      const prev = this.others.get(m.peer);
      const presence = m.presence && typeof m.presence === 'object' ? m.presence : {};
      const changed = !prev || JSON.stringify(prev.presence) !== JSON.stringify(presence);
      const wasStale = prev && Date.now() - prev.lastSeen > STALE_MS;
      this.others.set(m.peer, {
        presence: Object.freeze({ ...presence }),
        updatedAt: changed ? Date.now() : prev.updatedAt,
        lastSeen: Date.now(),
      });
      if (m.t === 'hola') this._send({ t: 'p', presence: this.mine });
      if (!prev) this._notify({ joined: [this._peer(m.peer)] });
      else if (changed || wasStale) this._notify({ updated: [this._peer(m.peer)] });
    } else if (m.t === 'adios') {
      if (this.others.delete(m.peer)) this._notify({ left: [{ peer: m.peer, presence: {} }] });
    } else if (m.t === 'e' && typeof m.topic === 'string') {
      const info = this.others.get(m.peer);
      if (info) info.lastSeen = Date.now();
      this._deliver(m.topic, m.data, m.peer, false);
    }
  }

  _expire() {
    const now = Date.now();
    const left = [];
    const stale = [];
    for (const [peer, info] of this.others) {
      const quiet = now - info.lastSeen;
      if (quiet > this.timeout) {
        this.others.delete(peer);
        left.push({ peer, presence: info.presence });
      } else if (quiet > STALE_MS && !info.flagged) {
        info.flagged = true;
        stale.push(this._peer(peer));
      } else if (quiet <= STALE_MS && info.flagged) {
        info.flagged = false;
        stale.push(this._peer(peer));
      }
    }
    if (left.length || stale.length) this._notify({ left, updated: stale });
  }

  _peer(peer) {
    if (peer === this.peerId) {
      return { peer, presence: this.mine, isMe: true, sameTab: true, by: null, kind: 'viewer', guest: false, updatedAt: Date.now(), stale: !this.connected() };
    }
    const info = this.others.get(peer);
    const quiet = info ? Date.now() - info.lastSeen : Infinity;
    return { peer, presence: info ? info.presence : {}, isMe: false, sameTab: false, by: null, kind: 'viewer', guest: false, updatedAt: info ? info.updatedAt : 0, stale: quiet > STALE_MS };
  }

  _deliver(topic, data, peer, mine) {
    const fns = this.topics.get(topic);
    if (!fns) return;
    const msg = { topic, data, peer, isMe: mine, sameTab: mine, by: null, kind: 'viewer', guest: false };
    for (const fn of [...fns]) fn(msg);
  }

  _notify({ joined = [], left = [], updated = [] }) {
    const change = { peers: this.peers(), joined, left, updated };
    for (const fn of [...this.peerFns]) fn(change);
  }

  emit(topic, data) {
    this._send({ t: 'e', topic, data });
    queueMicrotask(() => this._deliver(topic, data, this.peerId, true));
    return Promise.resolve();
  }

  on(topic, fn) {
    if (!this.topics.has(topic)) this.topics.set(topic, new Set());
    this.topics.get(topic).add(fn);
    return () => this.topics.get(topic)?.delete(fn);
  }

  presence(patch) {
    const next = { ...this.mine };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    this.mine = Object.freeze(next);
    this._send({ t: 'p', presence: this.mine });
    queueMicrotask(() => this._notify({ updated: [this._peer(this.peerId)] }));
    return Promise.resolve();
  }

  peers() {
    return [this._peer(this.peerId), ...[...this.others.keys()].map((p) => this._peer(p))];
  }

  onPeers(fn) {
    this.peerFns.add(fn);
    queueMicrotask(() => fn({ peers: this.peers(), joined: this.peers(), left: [], updated: [] }));
    return () => this.peerFns.delete(fn);
  }

  connected() {
    return this.open && this.bus.connected();
  }

  /** fn(true|false) al conectar o perder la conexión (MQTT); con pestañas, siempre true. */
  onConnection(fn) {
    return this.bus.onConnection(fn);
  }

  leave() {
    if (!this.open) return Promise.resolve();
    this._send({ t: 'adios' });
    this.open = false;
    clearInterval(this._hb);
    this._unConn?.();
    if (hasWindow) window.removeEventListener('pagehide', this._onHide);
    this.bus.close();
    this.topics.clear();
    this.peerFns.clear();
    return Promise.resolve();
  }
}
