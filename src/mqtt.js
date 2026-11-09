// Cliente MQTT 3.1.1 mínimo sobre WebSocket, sin dependencias. Solo lo que
// necesitan las salas: conectar, suscribirse, publicar (QoS 0, con o sin
// «retain»), latido y reconexión automática. Sirve con cualquier servidor
// público que acepte MQTT por WebSocket seguro (wss://…/mqtt).
//
// Los mensajes de las salas no son secretos ni fiables: cualquiera que conozca
// el tema puede leerlos o escribirlos; el juego valida todo lo que recibe.

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Une trozos de bytes (arrays de números o Uint8Array). */
function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Cadena MQTT: 2 bytes de longitud + UTF-8. */
function mqttString(s) {
  const b = enc.encode(s);
  return concat([[b.length >> 8, b.length & 255], b]);
}

/** «Remaining length» (entero de longitud variable, 7 bits por byte). */
export function encodeLength(n) {
  const out = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    out.push(d);
  } while (n > 0);
  return out;
}

function packet(type, flags, body) {
  return concat([[(type << 4) | flags], encodeLength(body.length), body]);
}

export function connectPacket({ clientId, keepAlive = 20, clean = true, will = null }) {
  const flags = (clean ? 2 : 0) | (will ? 4 | (will.retain ? 32 : 0) : 0);
  const parts = [mqttString('MQTT'), [4, flags, keepAlive >> 8, keepAlive & 255], mqttString(clientId)];
  if (will) parts.push(mqttString(will.topic), mqttString(will.payload || ''));
  return packet(1, 0, concat(parts));
}

export function subscribePacket(id, filters) {
  return packet(8, 2, concat([[id >> 8, id & 255], ...filters.flatMap((f) => [mqttString(f), [0]])]));
}

export function unsubscribePacket(id, filters) {
  return packet(10, 2, concat([[id >> 8, id & 255], ...filters.map((f) => mqttString(f))]));
}

export function publishPacket(topic, payload, retain = false) {
  const body = typeof payload === 'string' ? enc.encode(payload) : payload;
  return packet(3, retain ? 1 : 0, concat([mqttString(topic), body]));
}

export const PINGREQ = new Uint8Array([0xc0, 0]);
export const DISCONNECT = new Uint8Array([0xe0, 0]);

/**
 * Lee los paquetes completos de `buf` (puede traer varios o uno a medias).
 * Devuelve { packets, rest }: lo que sobra se guarda para el siguiente trozo.
 */
export function parsePackets(buf) {
  const packets = [];
  let i = 0;
  while (i < buf.length) {
    if (i + 2 > buf.length) break;
    const head = buf[i];
    let mult = 1;
    let len = 0;
    let j = i + 1;
    let done = false;
    for (let k = 0; k < 4 && j < buf.length; k++, j++) {
      len += (buf[j] & 127) * mult;
      mult *= 128;
      if (!(buf[j] & 128)) {
        done = true;
        j++;
        break;
      }
    }
    if (!done || j + len > buf.length) break; // incompleto
    const body = buf.subarray(j, j + len);
    const type = head >> 4;
    if (type === 3) {
      const qos = (head >> 1) & 3;
      const tl = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tl));
      const start = 2 + tl + (qos > 0 ? 2 : 0);
      packets.push({ type: 'publish', topic, payload: dec.decode(body.subarray(start)), retain: !!(head & 1), qos, id: qos > 0 ? (body[2 + tl] << 8) | body[3 + tl] : 0 });
    } else if (type === 2) packets.push({ type: 'connack', code: body[1] });
    else if (type === 9) packets.push({ type: 'suback' });
    else if (type === 11) packets.push({ type: 'unsuback' });
    else if (type === 13) packets.push({ type: 'pingresp' });
    else packets.push({ type: 'other', code: type });
    i = j + len;
  }
  return { packets, rest: buf.subarray(i) };
}

/**
 * Cliente con reconexión: si se corta, vuelve a conectar (1, 2, 4… hasta 10 s)
 * y se vuelve a suscribir. Mientras está desconectado, publicar no hace nada
 * (QoS 0): las salas repiten lo importante (presencia cada 1,5 s).
 */
export class MqttClient {
  constructor(url, { clientId, keepAlive = 20, WebSocketImpl = globalThis.WebSocket } = {}) {
    this.url = url;
    this.clientId = clientId || `trinchera-${Math.random().toString(36).slice(2, 12)}`;
    this.keepAlive = keepAlive;
    this.WS = WebSocketImpl;
    this.ws = null;
    this.isConnected = false;
    this.closed = false;
    this.filters = new Set();
    this.msgFns = new Set();
    this.stateFns = new Set();
    this.buf = new Uint8Array(0);
    this.nextId = 1;
    this.retry = 0;
    this._ping = null;
  }

  /** Primera conexión: se resuelve con CONNACK o falla (timeout, error o rechazo). */
  connect(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.closed = true;
          this._drop();
          reject(err);
        } else resolve(this);
      };
      const timer = setTimeout(() => done(new Error('tiempo agotado')), timeoutMs);
      this._open(done);
    });
  }

  _open(onFirst) {
    let ws;
    try {
      ws = new this.WS(this.url, ['mqtt']);
    } catch (err) {
      onFirst?.(err);
      if (!onFirst) this._schedule();
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws.send(connectPacket({ clientId: this.clientId, keepAlive: this.keepAlive }));
    ws.onmessage = (e) => {
      const chunk = new Uint8Array(e.data instanceof ArrayBuffer ? e.data : e.data.buffer || e.data);
      const all = this.buf.length ? concat([this.buf, chunk]) : chunk;
      const { packets, rest } = parsePackets(all);
      this.buf = rest.length ? rest.slice() : new Uint8Array(0);
      for (const p of packets) this._handle(p, onFirst);
    };
    ws.onerror = () => {
      if (!this.isConnected) onFirst?.(new Error('no se pudo conectar'));
    };
    ws.onclose = () => {
      const was = this.isConnected;
      this._drop();
      if (!this.closed) {
        if (was) this._emitState(false);
        this._schedule();
      } else onFirst?.(new Error('cerrado'));
    };
  }

  _handle(p, onFirst) {
    if (p.type === 'connack') {
      if (p.code !== 0) {
        onFirst?.(new Error(`rechazado (${p.code})`));
        this.ws?.close();
        return;
      }
      this.isConnected = true;
      this.retry = 0;
      if (this.filters.size) this._send(subscribePacket(this._id(), [...this.filters]));
      clearInterval(this._ping);
      this._ping = setInterval(() => this._send(PINGREQ), Math.max(5, this.keepAlive * 0.6) * 1000);
      onFirst?.();
      this._emitState(true);
    } else if (p.type === 'publish') {
      for (const fn of [...this.msgFns]) fn(p.topic, p.payload, p.retain);
    }
  }

  _schedule() {
    if (this.closed) return;
    const wait = Math.min(10000, 1000 * 2 ** this.retry++);
    setTimeout(() => {
      if (!this.closed && !this.isConnected) this._open(null);
    }, wait);
  }

  _drop() {
    this.isConnected = false;
    clearInterval(this._ping);
    this._ping = null;
    this.buf = new Uint8Array(0);
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* ya estaba cerrado */
      }
    }
    this.ws = null;
  }

  _id() {
    const id = this.nextId;
    this.nextId = (this.nextId % 65535) + 1;
    return id;
  }

  _send(bytes) {
    if (this.ws && this.isConnected) {
      try {
        this.ws.send(bytes);
      } catch {
        /* se reconectará */
      }
    }
  }

  _emitState(on) {
    for (const fn of [...this.stateFns]) fn(on);
  }

  subscribe(filter) {
    if (this.filters.has(filter)) return;
    this.filters.add(filter);
    if (this.isConnected) this._send(subscribePacket(this._id(), [filter]));
  }

  unsubscribe(filter) {
    if (!this.filters.delete(filter)) return;
    if (this.isConnected) this._send(unsubscribePacket(this._id(), [filter]));
  }

  publish(topic, payload, { retain = false } = {}) {
    this._send(publishPacket(topic, payload, retain));
  }

  onMessage(fn) {
    this.msgFns.add(fn);
    return () => this.msgFns.delete(fn);
  }

  onState(fn) {
    this.stateFns.add(fn);
    return () => this.stateFns.delete(fn);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this._send(DISCONNECT);
    this._drop();
  }
}

/** ¿Encaja `topic` con el filtro MQTT `filter` (con + y #)? */
export function topicMatches(filter, topic) {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}
