// Transporte en tiempo real para el multijugador. Las dos variantes ofrecen
// la misma interfaz (la de la capacidad `room` de Claude):
//   canal.emit(tema, datos) · canal.on(tema, fn) · canal.presence(parche)
//   canal.peers() · canal.onPeers(fn) · canal.connected() · canal.leave()
//
// - Dentro de Claude: `room` conecta a todas las personas con el enlace abierto.
// - Fuera (fichero suelto, hosting propio): BroadcastChannel entre pestañas
//   del mismo navegador. Sirve para probar; para jugar entre equipos fuera de
//   Claude haría falta un servidor (ver ROADMAP.md).

export async function connectTransport() {
  const claude = typeof window !== 'undefined' ? window.claude : null;
  if (claude && typeof claude.use === 'function') {
    try {
      const room = await claude.use('room');
      if (room) return new ClaudeTransport(room);
    } catch {
      /* sin room: probamos la alternativa local */
    }
  }
  if (typeof BroadcastChannel !== 'undefined') return new LocalTransport();
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

// ------------------------------------------------- alternativa entre pestañas

const HEARTBEAT_MS = 1500;
const PEER_TIMEOUT_MS = 5000;

class LocalTransport {
  constructor() {
    this.kind = 'local';
    this.peerId = Math.random().toString(36).slice(2, 12);
    this.lobby = new LocalChannel('vestibulo', this.peerId);
  }

  async join(name) {
    return new LocalChannel(`sala:${name}`, this.peerId);
  }
}

class LocalChannel {
  constructor(name, peerId) {
    this.name = name;
    this.peerId = peerId;
    this.bc = new BroadcastChannel(`dominia:${name}`);
    this.mine = {};
    this.others = new Map(); // peer → { presence, updatedAt, lastSeen }
    this.topics = new Map(); // tema → Set(fn)
    this.peerFns = new Set();
    this.bc.onmessage = (e) => this._recv(e.data);
    this._hb = setInterval(() => {
      this._send({ t: 'p', presence: this.mine });
      this._expire();
    }, HEARTBEAT_MS);
    this._onHide = () => this.leave();
    window.addEventListener('pagehide', this._onHide);
    this._send({ t: 'hola', presence: this.mine });
  }

  _send(m) {
    if (this.bc) this.bc.postMessage({ ...m, peer: this.peerId });
  }

  _recv(m) {
    if (!m || m.peer === this.peerId) return;
    if (m.t === 'p' || m.t === 'hola') {
      const prev = this.others.get(m.peer);
      const changed = !prev || JSON.stringify(prev.presence) !== JSON.stringify(m.presence);
      this.others.set(m.peer, {
        presence: Object.freeze({ ...m.presence }),
        updatedAt: changed ? Date.now() : prev.updatedAt,
        lastSeen: Date.now(),
      });
      if (m.t === 'hola') this._send({ t: 'p', presence: this.mine });
      if (!prev) this._notify({ joined: [this._peer(m.peer)] });
      else if (changed) this._notify({ updated: [this._peer(m.peer)] });
    } else if (m.t === 'adios') {
      if (this.others.delete(m.peer)) this._notify({ left: [{ peer: m.peer, presence: {} }] });
    } else if (m.t === 'e') {
      this._deliver(m.topic, m.data, m.peer, false);
    }
  }

  _expire() {
    const now = Date.now();
    const left = [];
    for (const [peer, info] of this.others) {
      if (now - info.lastSeen > PEER_TIMEOUT_MS) {
        this.others.delete(peer);
        left.push({ peer, presence: info.presence });
      }
    }
    if (left.length) this._notify({ left });
  }

  _peer(peer) {
    if (peer === this.peerId) {
      return { peer, presence: this.mine, isMe: true, sameTab: true, by: null, kind: 'viewer', guest: false, updatedAt: Date.now() };
    }
    const info = this.others.get(peer);
    return { peer, presence: info ? info.presence : {}, isMe: false, sameTab: false, by: null, kind: 'viewer', guest: false, updatedAt: info ? info.updatedAt : 0 };
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
    return !!this.bc;
  }

  onConnection(fn) {
    queueMicrotask(() => fn(this.connected()));
    return () => {};
  }

  leave() {
    if (!this.bc) return Promise.resolve();
    this._send({ t: 'adios' });
    clearInterval(this._hb);
    window.removeEventListener('pagehide', this._onHide);
    this.bc.close();
    this.bc = null;
    this.topics.clear();
    this.peerFns.clear();
    return Promise.resolve();
  }
}
