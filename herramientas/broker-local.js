// Servidor MQTT mínimo por WebSocket, solo para pruebas (sin dependencias).
//
//   node herramientas/broker-local.js [puerto]   → ws://localhost:1884/mqtt
//
// Luego abre el juego con ?broker=ws://localhost:1884/mqtt en dos pestañas o
// dos navegadores del mismo equipo. Implementa lo que usa el cliente del
// juego: CONNECT, SUBSCRIBE/UNSUBSCRIBE, PUBLISH QoS 0 (con «retain»),
// PINGREQ y DISCONNECT. Reenvía cada mensaje también a quien lo publicó (como
// hacen los servidores públicos).
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { publishPacket, topicMatches } from '../src/mqtt.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Arranca el servidor; devuelve { port, url, close() }. */
export function startBroker(port = 1884) {
  const clients = new Set();
  const retained = new Map(); // tema → payload (bytes)

  const server = createServer((req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain' });
    res.end('Servidor MQTT por WebSocket para pruebas');
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) return socket.destroy();
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    const wantsMqtt = String(req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim()).includes('mqtt');
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, ...(wantsMqtt ? ['Sec-WebSocket-Protocol: mqtt'] : []), '', ''].join('\r\n'));
    const c = { socket, subs: new Set(), wsBuf: Buffer.alloc(0), mqBuf: Buffer.alloc(0), alive: true };
    clients.add(c);
    const drop = () => {
      c.alive = false;
      clients.delete(c);
    };
    socket.on('close', drop);
    socket.on('error', drop);
    socket.on('data', (data) => {
      c.wsBuf = Buffer.concat([c.wsBuf, data]);
      for (;;) {
        const f = readFrame(c.wsBuf);
        if (!f) break;
        c.wsBuf = c.wsBuf.subarray(f.size);
        if (f.opcode === 8) {
          socket.end();
          return;
        }
        if (f.opcode === 9) {
          sendFrame(socket, f.payload, 10);
          continue;
        }
        if (f.opcode === 1 || f.opcode === 2 || f.opcode === 0) {
          c.mqBuf = Buffer.concat([c.mqBuf, f.payload]);
          c.mqBuf = handleMqtt(c, c.mqBuf);
        }
      }
    });
  });

  function deliver(topic, payload, retain) {
    const bytes = publishPacket(topic, payload, retain);
    for (const c of clients) {
      if (!c.alive) continue;
      for (const f of c.subs) {
        if (topicMatches(f, topic)) {
          sendFrame(c.socket, bytes, 2);
          break;
        }
      }
    }
  }

  function handleMqtt(c, buf) {
    let i = 0;
    while (i + 2 <= buf.length) {
      let mult = 1;
      let len = 0;
      let j = i + 1;
      let ok = false;
      for (let k = 0; k < 4 && j < buf.length; k++, j++) {
        len += (buf[j] & 127) * mult;
        mult *= 128;
        if (!(buf[j] & 128)) {
          ok = true;
          j++;
          break;
        }
      }
      if (!ok || j + len > buf.length) break;
      const head = buf[i];
      const body = buf.subarray(j, j + len);
      const type = head >> 4;
      if (type === 1) sendFrame(c.socket, Buffer.from([0x20, 2, 0, 0]), 2);
      else if (type === 8 || type === 10) {
        const id = body.subarray(0, 2);
        const filters = [];
        let o = 2;
        while (o < body.length) {
          const l = (body[o] << 8) | body[o + 1];
          filters.push(body.subarray(o + 2, o + 2 + l).toString('utf8'));
          o += 2 + l + (type === 8 ? 1 : 0);
        }
        if (type === 8) {
          for (const f of filters) c.subs.add(f);
          sendFrame(c.socket, Buffer.from([0x90, 2 + filters.length, id[0], id[1], ...filters.map(() => 0)]), 2);
          for (const [t, p] of retained) if (filters.some((f) => topicMatches(f, t))) sendFrame(c.socket, publishPacket(t, p, true), 2);
        } else {
          for (const f of filters) c.subs.delete(f);
          sendFrame(c.socket, Buffer.from([0xb0, 2, id[0], id[1]]), 2);
        }
      } else if (type === 3) {
        const tl = (body[0] << 8) | body[1];
        const topic = body.subarray(2, 2 + tl).toString('utf8');
        const qos = (head >> 1) & 3;
        const payload = new Uint8Array(body.subarray(2 + tl + (qos ? 2 : 0)));
        if (head & 1) {
          if (payload.length) retained.set(topic, payload);
          else retained.delete(topic);
        }
        deliver(topic, payload, false);
      } else if (type === 12) sendFrame(c.socket, Buffer.from([0xd0, 0]), 2);
      else if (type === 14) c.socket.end();
      i = j + len;
    }
    return buf.subarray(i);
  }

  return new Promise((resolve) => {
    server.listen(port, () => {
      const p = server.address().port;
      resolve({
        port: p,
        url: `ws://localhost:${p}/mqtt`,
        clients,
        close: () =>
          new Promise((r) => {
            for (const c of clients) c.socket.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

function readFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 15;
  const masked = !!(buf[1] & 128);
  let len = buf[1] & 127;
  let o = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    o = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    o = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < o + maskLen + len) return null;
  const mask = masked ? buf.subarray(o, o + 4) : null;
  const payload = Buffer.from(buf.subarray(o + maskLen, o + maskLen + len));
  if (mask) for (let k = 0; k < payload.length; k++) payload[k] ^= mask[k & 3];
  return { opcode, payload, size: o + maskLen + len };
}

function sendFrame(socket, data, opcode = 2) {
  if (socket.destroyed) return;
  const payload = Buffer.from(data);
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : (() => {
    const h = Buffer.alloc(10);
    h[0] = 0x80 | opcode;
    h[1] = 127;
    h.writeBigUInt64BE(BigInt(n), 2);
    return h;
  })();
  socket.write(Buffer.concat([head, payload]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 1884;
  startBroker(port).then((b) => console.log(`Servidor MQTT de pruebas en ${b.url} (abre el juego con ?broker=${b.url})`));
}
