// Dibujo en canvas: terreno (una vez), capa de territorios (incremental),
// barcos y nombres de las naciones.
import { CONFIG, TERRAIN } from './config.js';
import { rgbToCss, shadeRgb } from './colors.js';
import { formatNumber } from './format.js';
import { PATTERN_FNS, drawBuildingIcon, drawEmblem, emblemFor } from './icons.js';

const { WATER, PLAINS, HIGHLAND, MOUNTAIN } = TERRAIN;
const FILL_ALPHA = 150;
const LABEL_INTERVAL_MS = 400;

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Empaqueta RGBA en un uint32 (little-endian, como ImageData en la práctica). */
const pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

export class Renderer {
  constructor(canvas, game, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.camera = camera;
    this.dpr = window.devicePixelRatio || 1;
    const { width, height } = game.map;

    this.terrainCanvas = makeCanvas(width, height);
    this._paintTerrain();

    this.territoryCanvas = makeCanvas(width, height);
    this.tctx = this.territoryCanvas.getContext('2d');
    this.image = this.tctx.createImageData(width, height);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this._buildPalette();
    this.diploVersion = game.diploVersion;
    game.trackDirty = true;
    game.dirty.length = 0;
    this._paintAllTerritory();

    this.distField = new Uint16Array(game.map.size);
    this.labels = [];
    this.lastLabelTime = -Infinity;
    this.highlightTile = -1;
  }

  setDpr(dpr) {
    this.dpr = dpr;
  }

  _buildPalette() {
    this.fill = new Uint32Array(this.game.players.length);
    this.alt = new Uint32Array(this.game.players.length);
    this.border = new Uint32Array(this.game.players.length);
    this.patterns = new Array(this.game.players.length).fill(null);
    for (const p of this.game.players) {
      if (!p) continue;
      const [r, g, b] = p.color;
      this.fill[p.id] = pack(r, g, b, FILL_ALPHA);
      // Patrón del perfil: algunas casillas con un tono más oscuro
      this.patterns[p.id] = PATTERN_FNS[p.pattern] || null;
      const [ar, ag, ab] = shadeRgb(p.color, 0.72);
      this.alt[p.id] = pack(ar, ag, ab, Math.min(255, FILL_ALPHA + 40));
      // Frontera blanca para el humano y verde para sus aliados: se reconocen de un vistazo
      const human = this.game.human;
      const bc = p === human ? [255, 255, 255] : human && human.allies.has(p.id) ? [120, 235, 165] : shadeRgb(p.color, 0.55);
      this.border[p.id] = pack(bc[0], bc[1], bc[2], 255);
    }
  }

  _paintTerrain() {
    const map = this.game.map;
    const ctx = this.terrainCanvas.getContext('2d');
    const img = ctx.createImageData(map.width, map.height);
    const d = img.data;
    const deep = [16, 38, 78];
    const shallow = [44, 96, 152];
    const shore = [70, 128, 176];
    const plainsLo = [104, 156, 78];
    const plainsHi = [150, 172, 96];
    const hiLo = [168, 156, 104];
    const hiHi = [136, 120, 84];
    const mtLo = [118, 110, 104];
    const mtHi = [236, 236, 242];
    const nb = new Int32Array(4);
    for (let i = 0; i < map.size; i++) {
      const t = map.terrain[i];
      const s = map.shade[i] / 255;
      let c;
      if (t === WATER) {
        let nearLand = false;
        const n = map.neighbors(i, nb);
        for (let k = 0; k < n; k++) if (map.terrain[nb[k]] !== WATER) nearLand = true;
        c = nearLand ? shore : mix(shallow, deep, Math.min(1, s));
      } else if (t === PLAINS) c = mix(plainsLo, plainsHi, s);
      else if (t === HIGHLAND) c = mix(hiLo, hiHi, s);
      else if (t === MOUNTAIN) c = mix(mtLo, mtHi, s * s);
      // Grano sutil para que no parezca plano
      const h = ((i * 2654435761) >>> 0) / 4294967296;
      const g = (h - 0.5) * (t === WATER ? 6 : 10);
      d[i * 4] = c[0] + g;
      d[i * 4 + 1] = c[1] + g;
      d[i * 4 + 2] = c[2] + g;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  _paintTile(i) {
    const o = this.game.owner[i];
    if (!o) {
      this.pixels[i] = 0;
      return;
    }
    const p = this.game.players[o];
    if (p.border.has(i)) {
      this.pixels[i] = this.border[o];
      return;
    }
    const pattern = this.patterns[o];
    const w = this.game.map.width;
    this.pixels[i] = pattern && pattern(i % w, (i / w) | 0) ? this.alt[o] : this.fill[o];
  }

  _paintAllTerritory() {
    for (let i = 0; i < this.pixels.length; i++) this._paintTile(i);
    this.tctx.putImageData(this.image, 0, 0);
  }

  _flushDirty() {
    const dirty = this.game.dirty;
    if (!dirty.length) return;
    for (let k = 0; k < dirty.length; k++) this._paintTile(dirty[k]);
    dirty.length = 0;
    this.tctx.putImageData(this.image, 0, 0);
  }

  /**
   * Para colocar cada nombre buscamos la casilla más alejada de su frontera
   * (transformada de distancia en dos pasadas). Esa distancia da también el
   * tamaño de letra.
   */
  _updateLabels() {
    const { owner, players, map } = this.game;
    const W = map.width;
    const H = map.height;
    const d = this.distField;
    for (let i = 0; i < d.length; i++) {
      const o = owner[i];
      if (!o) {
        d[i] = 0;
        continue;
      }
      const x = i % W;
      const edge =
        x === 0 || x === W - 1 || i < W || i >= d.length - W ||
        owner[i - 1] !== o || owner[i + 1] !== o || owner[i - W] !== o || owner[i + W] !== o;
      d[i] = edge ? 1 : 65535;
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (d[i] <= 1) continue;
        let v = d[i - 1] + 1;
        if (v < d[i]) d[i] = v;
        v = d[i - W] + 1;
        if (v < d[i]) d[i] = v;
      }
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        if (d[i] <= 1) continue;
        let v = d[i + 1] + 1;
        if (v < d[i]) d[i] = v;
        v = d[i + W] + 1;
        if (v < d[i]) d[i] = v;
      }
    }
    const best = new Uint16Array(players.length);
    const at = new Int32Array(players.length).fill(-1);
    for (let i = 0; i < d.length; i++) {
      const o = owner[i];
      if (o && d[i] > best[o]) {
        best[o] = d[i];
        at[o] = i;
      }
    }
    this.labels = [];
    for (const p of players) {
      if (!p || !p.alive || at[p.id] < 0) continue;
      this.labels.push({ player: p, x: (at[p.id] % W) + 0.5, y: Math.floor(at[p.id] / W) + 0.5, r: best[p.id] });
    }
  }

  /**
   * `overlay`: { buildMode, hoverTile } para la vista previa de construcción.
   */
  draw(now, overlay = {}) {
    const { ctx, camera, dpr, game } = this;
    if (game.diploVersion !== this.diploVersion) {
      // Cambió alguna alianza: recolorear fronteras de aliados
      this.diploVersion = game.diploVersion;
      this._buildPalette();
      game.dirty.length = 0;
      this._paintAllTerritory();
    }
    this._flushDirty();
    if (now - this.lastLabelTime > LABEL_INTERVAL_MS) {
      this._updateLabels();
      this.lastLabelTime = now;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0c1f3f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const z = camera.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, -camera.x * z, -camera.y * z);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainCanvas, 0, 0);
    ctx.drawImage(this.territoryCanvas, 0, 0);

    this._drawBoats();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._drawBuildings();
    this._drawWarships();
    this._drawEffects();
    this._drawMissiles(now);
    this._drawLabels();
    this._drawAttackBadges();
    this._drawEmojis();
    if (game.phase === 'spawn') this._drawSpawnMarker(now);
    if (overlay.buildMode && overlay.hoverTile >= 0) this._drawBuildPreview(overlay.buildMode, overlay.hoverTile);
  }

  _buildingSize() {
    return Math.min(30, Math.max(10, this.camera.zoom * 3));
  }

  _drawBuildings() {
    const { ctx, game, camera } = this;
    if (camera.zoom < 1.1 || !game.buildings.length) return;
    const map = game.map;
    const size = this._buildingSize();
    for (const b of game.buildings) {
      const [sx, sy] = camera.worldToScreen(map.x(b.tile) + 0.5, map.y(b.tile) + 0.5);
      if (sx < -size || sy < -size || sx > camera.viewW + size || sy > camera.viewH + size) continue;
      const p = game.players[b.owner];
      drawBuildingIcon(ctx, b.kind, sx, sy, size, {
        disc: rgbToCss(shadeRgb(p.color, 0.7)),
        ring: p === game.human ? '#ffffff' : 'rgba(0,0,0,0.7)',
      });
      if (b.kind === 'port' && b.hp < CONFIG.portHp) this._hpBar(sx, sy - size * 0.75, size, b.hp / CONFIG.portHp);
    }
  }

  _hpBar(cx, cy, width, frac) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(cx - width / 2, cy - 2, width, 4);
    ctx.fillStyle = frac > 0.5 ? '#5fd38d' : frac > 0.25 ? '#ffc857' : '#ff6b6b';
    ctx.fillRect(cx - width / 2, cy - 2, width * Math.max(0, frac), 4);
  }

  /** Misiles en vuelo: arco, estela y, si te afectan, la zona de impacto. */
  _drawMissiles(now) {
    const { ctx, game, camera } = this;
    if (!game.missiles.length) return;
    const W = game.map.width;
    const human = game.human;
    for (const m of game.missiles) {
      const fx = (m.from % W) + 0.5;
      const fy = Math.floor(m.from / W) + 0.5;
      const tx = (m.to % W) + 0.5;
      const ty = Math.floor(m.to / W) + 0.5;
      const [sx0, sy0] = camera.worldToScreen(fx, fy);
      const [sx1, sy1] = camera.worldToScreen(tx, ty);
      const lift = Math.min(140, Math.hypot(sx1 - sx0, sy1 - sy0) * 0.25);
      const point = (t) => [sx0 + (sx1 - sx0) * t, sy0 + (sy1 - sy0) * t - Math.sin(Math.PI * t) * lift];
      const involved = human && (m.owner === human.id || m.targetId === human.id);
      if (involved) {
        const pulse = (Math.sin(now / 120) + 1) / 2;
        ctx.beginPath();
        ctx.arc(sx1, sy1, CONFIG.missileRadius * camera.zoom, 0, Math.PI * 2);
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = m.targetId === human.id ? `rgba(255, 80, 80, ${0.5 + pulse * 0.5})` : 'rgba(255, 200, 120, 0.7)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Estela
      ctx.beginPath();
      const steps = 16;
      for (let i = 0; i <= steps; i++) {
        const [x, y] = point((m.progress * i) / steps);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 220, 180, 0.55)';
      ctx.stroke();
      const [hx, hy] = point(m.progress);
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff3d6';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgbToCss(game.players[m.owner].color);
      ctx.stroke();
    }
  }

  /** Explosiones e intercepciones recientes. */
  _drawEffects() {
    const { ctx, game, camera } = this;
    if (!game.effects.length) return;
    const W = game.map.width;
    for (const e of game.effects) {
      const age = game.ticks - e.tick;
      const [x, y] = camera.worldToScreen(e.x, e.y);
      if (e.kind === 'boom') {
        if (age > 25) continue;
        const r = (CONFIG.missileRadius + age * 0.4) * camera.zoom;
        const a = Math.max(0, 1 - age / 25);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 120, 40, ${0.45 * a})`;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(255, 230, 160, ${a})`;
        ctx.stroke();
      } else {
        if (age > 10) continue;
        const a = Math.max(0, 1 - age / 10);
        const [bx, by] = camera.worldToScreen((e.from % W) + 0.5, Math.floor(e.from / W) + 0.5);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(x, y);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = e.kind === 'intercept' ? `rgba(140, 210, 255, ${a})` : `rgba(200, 200, 200, ${a * 0.6})`;
        ctx.stroke();
        if (e.kind === 'intercept') {
          ctx.beginPath();
          ctx.arc(x, y, 4 + age * 1.5, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
          ctx.stroke();
        }
      }
    }
  }

  _drawWarships() {
    const { ctx, game, camera } = this;
    if (!game.warships.length) return;
    const W = game.map.width;
    const size = Math.min(28, Math.max(12, camera.zoom * 2.8));
    for (const ws of game.warships) {
      let wx = (ws.tile % W) + 0.5;
      let wy = Math.floor(ws.tile / W) + 0.5;
      if (ws.path && ws.pos < ws.path.length - 1) {
        const n = ws.path[ws.pos + 1];
        const t = Math.min(1, ws.progress);
        wx = lerp(wx, (n % W) + 0.5, t);
        wy = lerp(wy, Math.floor(n / W) + 0.5, t);
      }
      const [sx, sy] = camera.worldToScreen(wx, wy);
      if (sx < -size || sy < -size || sx > camera.viewW + size || sy > camera.viewH + size) continue;
      const p = game.players[ws.owner];
      // Disparo: línea hasta el objetivo durante el tick en que dispara
      if (game.ticks - ws.fireTick <= 1 && ws.fireAt >= 0) {
        const [tx, ty] = camera.worldToScreen((ws.fireAt % W) + 0.5, Math.floor(ws.fireAt / W) + 0.5);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255, 190, 90, 0.9)';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tx, ty, 3 + (game.ticks % 2) * 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 150, 60, 0.8)';
        ctx.fill();
      }
      drawBuildingIcon(ctx, 'warship', sx, sy, size, {
        disc: rgbToCss(shadeRgb(p.color, 0.75)),
        ring: p === game.human ? '#ffffff' : 'rgba(0,0,0,0.75)',
      });
      if (ws.hp < CONFIG.warshipHp) this._hpBar(sx, sy - size * 0.72, size, ws.hp / CONFIG.warshipHp);
      // Destino del buque propio
      if (p === game.human && ws.path) {
        const dest = ws.path[ws.path.length - 1];
        const [dx, dy] = camera.worldToScreen((dest % W) + 0.5, Math.floor(dest / W) + 0.5);
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(dx, dy);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  _drawBuildPreview(kind, tile) {
    const { ctx, game, camera } = this;
    const human = game.human;
    if (!human) return;
    const map = game.map;
    const check = game.canBuild(human, kind, tile);
    const ok = check.ok;
    let [sx, sy] = camera.worldToScreen(map.x(tile) + 0.5, map.y(tile) + 0.5);
    if (kind === 'warship' && ok) {
      // El buque sale del puerto propio más cercano
      [sx, sy] = camera.worldToScreen(map.x(check.water) + 0.5, map.y(check.water) + 0.5);
    }
    const color = ok ? '#5fd38d' : '#ff6b6b';
    if (kind === 'missile') {
      // Zona que arrasará y trayectoria desde el silo elegido
      ctx.beginPath();
      ctx.arc(sx, sy, CONFIG.missileRadius * camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = ok ? 'rgba(255, 90, 60, 0.18)' : 'rgba(255, 107, 107, 0.08)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      if (ok) {
        const [ox, oy] = camera.worldToScreen(map.x(check.silo.tile) + 0.5, map.y(check.silo.tile) + 0.5);
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(sx, sy);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      return;
    }
    if (kind === 'fort' || kind === 'sam') {
      ctx.beginPath();
      ctx.arc(sx, sy, (kind === 'sam' ? CONFIG.samRange : CONFIG.fortRadius) * camera.zoom, 0, Math.PI * 2);
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const size = Math.max(18, this._buildingSize());
    ctx.globalAlpha = 0.9;
    drawBuildingIcon(ctx, kind, sx, sy, size, { disc: rgbToCss(human.color), ring: color });
    ctx.globalAlpha = 1;
  }

  _drawBoats() {
    const { ctx, game, camera } = this;
    const W = game.map.width;
    const r = Math.max(0.9, 4 / camera.zoom);
    for (const b of game.boats) {
      const a = b.path[b.pos];
      const nxt = b.path[Math.min(b.pos + 1, b.path.length - 1)];
      const t = Math.min(1, b.progress);
      const x = lerp(a % W, nxt % W, t) + 0.5;
      const y = lerp(Math.floor(a / W), Math.floor(nxt / W), t) + 0.5;
      const p = game.players[b.owner];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = rgbToCss(p.color);
      ctx.fill();
      ctx.lineWidth = r * 0.35;
      ctx.strokeStyle = p === game.human ? '#ffffff' : 'rgba(0,0,0,0.75)';
      ctx.stroke();
      const mine = game.human && (b.owner === game.human.id || b.targetId === game.human.id);
      if (camera.zoom >= 4 || mine) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${r * 1.1}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(formatNumber(b.troops), x, y - r * 1.1);
      }
    }
  }

  _drawLabels() {
    const { ctx, camera } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const L of this.labels) {
      const p = L.player;
      const [sx, sy] = camera.worldToScreen(L.x, L.y);
      const radiusPx = L.r * camera.zoom;
      const len = Math.max(4, p.name.length);
      const size = Math.min(radiusPx * 0.8, (radiusPx * 3) / len, 42);
      if (size < 7) continue;
      if (sx < -200 || sy < -100 || sx > camera.viewW + 200 || sy > camera.viewH + 100) continue;
      const human = this.game.human;
      const allied = human && human.allies.has(p.id);
      const traitor = this.game.isTraitor(p);
      const name = traitor ? `⚠ ${p.name}` : p.name;
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, size / 5);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.fillStyle = p === human ? '#fff6c8' : allied ? '#b8f5cf' : traitor ? '#ffb4a8' : '#ffffff';
      ctx.strokeText(name, sx, sy - size * 0.35);
      ctx.fillText(name, sx, sy - size * 0.35);
      if (size >= 11) {
        // Emblema a la izquierda del nombre
        const w = ctx.measureText(name).width;
        drawEmblem(ctx, emblemFor(p), sx - w / 2 - size * 0.75, sy - size * 0.35, size * 1.15);
      }
      const s2 = size * 0.78;
      ctx.font = `500 ${s2}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, s2 / 5);
      const troops = formatNumber(p.troops);
      ctx.strokeText(troops, sx, sy + size * 0.6);
      ctx.fillText(troops, sx, sy + size * 0.6);
    }
  }

  /**
   * Marcador con las tropas en el frente de cada ataque entre el humano y otra
   * nación: rojo si le atacan, con su color si ataca él.
   */
  _drawAttackBadges() {
    const { ctx, game, camera } = this;
    const human = game.human;
    if (!human || !game.attacks.length) return;
    const W = game.map.width;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 12px system-ui, sans-serif';
    for (const atk of game.attacks) {
      if (atk.done || atk.troops < 1 || !atk.targetId) continue;
      const incoming = atk.targetId === human.id;
      if (!incoming && atk.attacker !== human) continue;
      // Centro aproximado del frente: media de unas cuantas casillas candidatas
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const t of atk.inFrontier) {
        sx += t % W;
        sy += (t / W) | 0;
        if (++n >= 48) break;
      }
      if (!n) continue;
      const [x, y] = camera.worldToScreen(sx / n + 0.5, sy / n + 0.5);
      if (x < -60 || y < -30 || x > camera.viewW + 60 || y > camera.viewH + 30) continue;
      const text = `${incoming ? '🛡' : '⚔'} ${formatNumber(atk.troops)}`;
      const w = ctx.measureText(text).width + 14;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - 10, w, 20, 10);
      ctx.fillStyle = incoming ? 'rgba(190, 40, 40, 0.92)' : 'rgba(12, 18, 30, 0.88)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = incoming ? '#ffb3b3' : rgbToCss(human.color);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x, y + 0.5);
    }
  }

  /** Burbujas de emoji sobre quien lo envía (solo las que implican al humano). */
  _drawEmojis() {
    const { ctx, game, camera } = this;
    if (!game.emojis.length) return;
    const human = game.human;
    const map = game.map;
    for (const e of game.emojis) {
      if (human && e.to !== human.id && e.from !== human.id && e.to !== 0) continue;
      const sender = game.players[e.from];
      if (!sender.alive) continue;
      const label = this.labels.find((l) => l.player === sender);
      const wx = label ? label.x : map.x(sender.spawnTile) + 0.5;
      const wy = label ? label.y : map.y(sender.spawnTile) + 0.5;
      const [sx, sy0] = camera.worldToScreen(wx, wy);
      const age = game.ticks - e.tick;
      const sy = sy0 - 34 - age * 0.4;
      ctx.globalAlpha = Math.max(0, Math.min(1, (CONFIG.emojiTicks - age) / 10));
      ctx.beginPath();
      ctx.arc(sx, sy, 17, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgbToCss(sender.color);
      ctx.stroke();
      ctx.font = '20px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';
      ctx.fillText(e.emoji, sx, sy + 1);
      ctx.globalAlpha = 1;
    }
  }

  _drawSpawnMarker(now) {
    const { ctx, game, camera } = this;
    const h = game.human;
    if (!h || !h.spawned) return;
    const map = game.map;
    const [sx, sy] = camera.worldToScreen(map.x(h.spawnTile) + 0.5, map.y(h.spawnTile) + 0.5);
    const pulse = (Math.sin(now / 200) + 1) / 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 14 + pulse * 8, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + pulse * 0.5})`;
    ctx.stroke();
  }
}
