// Prueba de carga de las salas (auditoría DEV06): N clientes completos (sala,
// simulación y lockstep) contra un servidor MQTT por WebSocket, el mismo
// cliente que usa la web. Cada cliente es un «jugador» que despliega y manda
// órdenes al azar; al final se comparan las huellas del estado de todos.
//
//   node herramientas/carga-salas.js --clientes 16 --min 2
//   node herramientas/carga-salas.js --clientes 32 --min 10 --mapa europa
//   node herramientas/carga-salas.js ... --broker wss://servidor/mqtt   (otro servidor)
//
// Sin --broker arranca el servidor de pruebas (herramientas/broker-local.js)
// en este equipo. Escribe el resultado en docs/carga-salas.md (se añade).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus, totalmem } from 'node:os';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};

if (isMainThread) {
  const N = Math.max(2, Math.min(32, Number(arg('clientes', 16))));
  const MIN = Number(arg('min', 2));
  const MAP = arg('mapa', 'europa');
  const BOTS = Number(arg('bots', 60));
  const THREADS = Math.min(N, Number(arg('hilos', Math.max(1, cpus().length))));
  const code = `c${Math.random().toString(36).slice(2, 6)}`;
  let broker = null;
  let url = arg('broker', null);
  if (!url) {
    const { startBroker } = await import('./broker-local.js');
    broker = await startBroker(0);
    url = broker.url;
  }
  console.log(`${N} clientes · ${MIN} min · mapa ${MAP} · ${BOTS} naciones de la IA · ${THREADS} hilos · ${url}`);
  // Reparto de clientes entre hilos (el 0, el anfitrión, en el primero)
  const groups = Array.from({ length: THREADS }, () => []);
  for (let i = 0; i < N; i++) groups[i % THREADS].push(i);
  const results = [];
  const hashes = new Map(); // tick → Map(cliente → huella)
  const started = Date.now();
  await Promise.all(
    groups.map(
      (ids) =>
        new Promise((resolve, reject) => {
          const w = new Worker(fileURLToPath(import.meta.url), { workerData: { ids, N, MIN, MAP, BOTS, url, code } });
          w.on('message', (m) => {
            if (m.type === 'hash') {
              if (!hashes.has(m.t)) hashes.set(m.t, new Map());
              hashes.get(m.t).set(m.id, m.h);
            } else if (m.type === 'log') console.log(m.text);
            else if (m.type === 'result') results.push(m);
          });
          w.on('error', reject);
          w.on('exit', resolve);
        }),
    ),
  );
  await broker?.close();
  // Huellas: en cada tick comparado, todos los clientes que llegaron a él coinciden
  let compared = 0;
  let mismatches = 0;
  for (const m of hashes.values()) {
    if (m.size < 2) continue;
    compared++;
    if (new Set(m.values()).size > 1) mismatches++;
  }
  const host = results.find((r) => r.host);
  const lat = results.flatMap((r) => r.latencies).sort((a, b) => a - b);
  const pct = (q) => (lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]) : NaN);
  const desynced = results.filter((r) => r.desynced).length;
  const lagMax = Math.max(0, ...results.map((r) => r.lagMax || 0));
  const colonies = host ? host.colonies : '—';
  const commit = (() => {
    try {
      return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    } catch {
      return '—';
    }
  })();
  const row = {
    fecha: new Date().toISOString().slice(0, 16).replace('T', ' '),
    clientes: N,
    min: MIN,
    mapa: MAP,
    bots: BOTS,
    colonias: colonies,
    tps: host ? host.tps.toFixed(2) : '—',
    ticks: host ? host.ticks : 0,
    desinc: `${desynced} clientes · ${mismatches}/${compared} huellas distintas`,
    lag: `${lagMax} ticks`,
    p50: pct(0.5),
    p95: pct(0.95),
    max: lat.length ? Math.round(lat[lat.length - 1]) : NaN,
    ordenes: lat.length,
    arranque: host ? `${(host.startMs / 1000).toFixed(1)} s (${host.fragments} fragmentos)` : '—',
    memoria: `${Math.round(Math.max(...results.map((r) => r.rssMb)))} MB por hilo`,
  };
  console.log(JSON.stringify(row, null, 1));
  const file = join(ROOT, 'docs', 'carga-salas.md');
  await mkdir(join(ROOT, 'docs'), { recursive: true });
  const header = `# Prueba de carga de las salas\n\nGenerado por \`node herramientas/carga-salas.js\` (auditoría DEV06). Cada cliente es completo: sala, simulación y lockstep, con el mismo cliente MQTT por WebSocket que la web. Los clientes despliegan y mandan órdenes al azar (expansión, ataques y emojis) cada 2–6 s. «Confirmación» = desde que un invitado manda una orden hasta que la ve aplicada en un turno del anfitrión. «Arranque» = desde «Iniciar partida» (con los 3 s de cuenta atrás) hasta tener el inicio completo.\n\n| Fecha | Clientes | Duración | Mapa | IA / colonias | Ticks/s (anfitrión) | Desincronizaciones | Retraso máx. de un invitado | Confirmación p50 / p95 / máx. | Órdenes | Arranque | Memoria | Equipo · red · build |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  let prev = '';
  try {
    prev = await readFile(file, 'utf8');
  } catch {
    /* primera vez */
  }
  const line = `| ${row.fecha} | ${row.clientes} | ${row.min} min | ${row.mapa} | ${row.bots} / ${row.colonias} | ${row.tps} | ${row.desinc} | ${row.lag} | ${row.p50} / ${row.p95} / ${row.max} ms | ${row.ordenes} | ${row.arranque} | ${row.memoria} | ${cpus().length} × ${cpus()[0]?.model?.trim() || 'CPU'}, ${Math.round(totalmem() / 1e9)} GB · ${broker ? 'servidor de pruebas en el mismo equipo (WebSocket local)' : url} · ${commit} |\n`;
  await writeFile(file, prev && prev.includes('| Fecha |') ? prev : header);
  await appendFile(file, line);
  console.log(`docs/carga-salas.md (${Math.round((Date.now() - started) / 1000)} s)`);
  process.exit(0);
} else {
  // ------------------------------------------------------------- un hilo
  const { ids, N, MIN, MAP, BOTS, url, code } = workerData;
  const { connectTransport } = await import('../src/net.js');
  const { Sala, NetSync, stateHash } = await import('../src/multiplayer.js');
  const { DEFAULT_RULES, colonyCount } = await import('../src/config.js');
  const { loadRealMap, generateMap } = await import('../src/map.js');
  const { Game } = await import('../src/game.js');
  const { Rng, hashString } = await import('../src/rng.js');
  const { MAP_SIZES } = await import('../src/config.js');
  const log = (text) => parentPort.postMessage({ type: 'log', text });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = (i) => ({ name: i ? `Jugador ${i}` : 'Anfitrión', color: `#${((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(0, 6)}`, emblem: { shape: 'escudo', symbol: 'estrella', bg: '#2f7dff', fg: '#ffffff' }, pattern: 'liso', level: 10 + i, title: 'Recluta' });
  const settings = { bots: BOTS, mapSize: MAP, difficulty: 'normal', rules: { ...DEFAULT_RULES, profile: 'clasico' } };

  /** La partida a partir del inicio, igual en todos los clientes (como main.js: humanos, IA y colonias). */
  function buildGame(payload) {
    const s = payload.settings;
    const real = MAP_SIZES[s.mapSize] ? null : loadRealMap(s.mapSize);
    const map = real ? real.map : generateMap(MAP_SIZES[s.mapSize].w, MAP_SIZES[s.mapSize].h, payload.seed);
    const game = new Game({ map, seed: payload.seed, rules: s.rules });
    const peerToPlayer = new Map();
    for (const p of payload.players) {
      const pl = game.addPlayer(p.name, [40, 120, 255], true);
      peerToPlayer.set(p.peer, pl.id);
    }
    game.addBots(s.bots, s.difficulty, real ? real.countries : null);
    const colonies = s.rules.colonies ?? colonyCount(map.landCount, s.bots);
    game.addColonies(colonies);
    game.start();
    return { game, peerToPlayer, colonies };
  }

  async function client(id) {
    const t = await connectTransport({ brokerUrl: url, peerId: `k${String(id).padStart(2, '0')}${Math.random().toString(36).slice(2, 8)}` });
    const isHost = id === 0;
    const sala = new Sala(t, { code, isHost, me: me(id), settings: isHost ? settings : null, info: { nombre: 'Carga', plazas: N } });
    const out = { id, host: isHost, latencies: [], desynced: false, lagMax: 0, ticks: 0, tps: 0, rssMb: 0 };
    if (!isHost) await wait(300 + id * 120); // llegan escalonados
    await sala.open();
    const t0 = Date.now();
    const startP = new Promise((resolve) => {
      sala.onStart = (payload, hostPeer) => resolve({ payload, hostPeer });
    });
    if (isHost) {
      while (!(sala.status().total === N && sala.status().canStart)) {
        if (Date.now() - t0 > 120000) throw new Error(`solo ${sala.status().total}/${N} en la sala`);
        await wait(250);
      }
      log(`sala llena y lista: ${N} clientes`);
      sala.beginCountdown();
    } else {
      while (sala.status().rev == null || !sala.status().players.some((p) => p.isMe)) await wait(150);
      sala.setReady(true);
      // si cambia la revisión, se vuelve a confirmar
      const keep = setInterval(() => {
        if (!sala.started && !sala.myReadyValid()) sala.setReady(true);
      }, 1000);
      startP.then(() => clearInterval(keep));
    }
    const startReq = Date.now();
    const { payload, hostPeer } = await startP;
    out.startMs = Date.now() - startReq;
    out.fragments = sala.fragments ? sala.fragments.length : 0;
    const { game, peerToPlayer, colonies } = buildGame(payload);
    out.colonies = colonies;
    const myPeer = sala.myPeer();
    const myPlayerId = peerToPlayer.get(myPeer);
    const sync = new NetSync(sala.room, game, { isHost, hostPeer, myPlayerId, peerToPlayer, mySlot: payload.players.findIndex((p) => p.peer === myPeer), myPeer, ronda: payload.ronda });
    // Confirmación de órdenes (invitados): de localIntent al turno que la aplica
    const sentAt = new Map();
    if (!isHost) {
      const step = sync._guestStep.bind(sync);
      sync._guestStep = (intents) => {
        for (const raw of intents) {
          const at = raw && sentAt.get(raw.u);
          if (at !== undefined) {
            out.latencies.push(performance.now() - at);
            sentAt.delete(raw.u);
          }
        }
        step(intents);
      };
    }
    const rng = new Rng(hashString(`carga:${id}`));
    const me2 = game.players[myPlayerId];
    const land = game.map.landTiles;
    let nextOrder = performance.now() + 2000 + rng.float() * 3000;
    let spawned = false;
    const endAt = Date.now() + MIN * 60000;
    const tStart = Date.now();
    let ticks0 = 0;
    return new Promise((resolve) => {
      const loop = setInterval(() => {
        sync.update();
        if (game.ticks % 500 === 0 && game.ticks > 0 && game.ticks !== out._lastHash) {
          out._lastHash = game.ticks;
          parentPort.postMessage({ type: 'hash', id, t: game.ticks, h: stateHash(game) });
        }
        const now = performance.now();
        // Despliegue: una casilla libre al azar
        if (!spawned && game.phase === 'spawn' && game.ticks > 5) {
          spawned = true;
          for (let k = 0; k < 200; k++) {
            const tile = land[Math.floor(rng.float() * land.length)];
            if (game.owner[tile] === 0) {
              sync.localIntent({ type: 'action', tile, ratio: 0.2 });
              if (!isHost) sentAt.set(`${sync.mySlot}.${sync.counter}`, now);
              break;
            }
          }
        }
        if (game.phase === 'playing' && now >= nextOrder && me2 && me2.alive) {
          nextOrder = now + 2000 + rng.float() * 4000;
          // Expansión o ataque cerca de su capital, o un emoji
          const r = rng.float();
          let intent;
          if (r < 0.75 && me2.capital) {
            const m = game.map;
            const cx = m.x(me2.capital.tile);
            const cy = m.y(me2.capital.tile);
            const x = Math.max(0, Math.min(m.width - 1, cx + Math.round((rng.float() - 0.5) * 160)));
            const y = Math.max(0, Math.min(m.height - 1, cy + Math.round((rng.float() - 0.5) * 160)));
            intent = { type: 'action', tile: m.index(x, y), ratio: 0.15 + rng.float() * 0.2 };
          } else intent = { type: 'emoji', targetId: 1 + Math.floor(rng.float() * N), emoji: '🙂' };
          sync.localIntent(intent);
          if (!isHost) sentAt.set(`${sync.mySlot}.${sync.counter}`, now);
        }
        if (isHost && !ticks0 && game.phase === 'playing') ticks0 = game.ticks;
        if (!isHost && sync.hostGone) out.hostGone = true;
        if (Date.now() >= endAt) {
          clearInterval(loop);
          out.ticks = game.ticks;
          out.tps = (game.ticks / ((Date.now() - tStart) / 1000));
          out.desynced = !!sync.desynced;
          out.rssMb = process.memoryUsage().rss / 1e6;
          sync.stop();
          sala.leave().finally(() => {
            t.close?.();
            resolve(out);
          });
        }
      }, 20);
      // Retraso de cada invitado respecto del anfitrión (lo mide el hilo del anfitrión, que lo publica en presencia)
      if (!isHost) {
        const lagT = setInterval(() => {
          const host = sala.room?.peers().find((p) => p.peer === hostPeer);
          const ht = host && host.presence && host.presence.tick;
          if (Number.isFinite(ht)) out.lagMax = Math.max(out.lagMax, ht - game.ticks);
          if (Date.now() >= endAt) clearInterval(lagT);
        }, 1000);
      } else {
        const pubT = setInterval(() => {
          sala.room?.presence({ tick: game.ticks });
          if (Date.now() >= endAt) clearInterval(pubT);
        }, 2000);
      }
    });
  }

  const results = await Promise.all(ids.map((id) => client(id).catch((e) => ({ id, host: id === 0, error: String(e && e.message), latencies: [], rssMb: 0 }))));
  for (const r of results) {
    if (r.error) log(`cliente ${r.id}: ${r.error}`);
    parentPort.postMessage({ type: 'result', ...r });
  }
  process.exit(0);
}
