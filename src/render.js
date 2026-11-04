// Dibujo en canvas: terreno (una vez), capa de territorios (incremental),
// barcos y nombres de las naciones.
import { CONFIG, TERRAIN } from './config.js';
import { rgbToCss, shadeRgb } from './colors.js';
import { formatNumber } from './format.js';
import { drawBuildingIcon } from './icons.js';

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
    this.border = new Uint32Array(this.game.players.length);
    for (const p of this.game.players) {
      if (!p) continue;
      const [r, g, b] = p.color;
      this.fill[p.id] = pack(r, g, b, FILL_ALPHA);
      // Frontera blanca para el humano y verde para sus aliados: se reconocen de un vistazo
      const human = this.game.human;
      const bc = p.isHuman ? [255, 255, 255] : human && human.allies.has(p.id) ? [120, 235, 165] : shadeRgb(p.color, 0.55);
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
    this.pixels[i] = p.border.has(i) ? this.border[o] : this.fill[o];
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
    this._drawLabels();
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
        ring: p.isHuman ? '#ffffff' : 'rgba(0,0,0,0.7)',
      });
    }
  }

  _drawBuildPreview(kind, tile) {
    const { ctx, game, camera } = this;
    const human = game.human;
    if (!human) return;
    const map = game.map;
    const ok = game.canBuild(human, kind, tile).ok;
    const [sx, sy] = camera.worldToScreen(map.x(tile) + 0.5, map.y(tile) + 0.5);
    const color = ok ? '#5fd38d' : '#ff6b6b';
    if (kind === 'fort') {
      ctx.beginPath();
      ctx.arc(sx, sy, CONFIG.fortRadius * camera.zoom, 0, Math.PI * 2);
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
      ctx.strokeStyle = p.isHuman ? '#ffffff' : 'rgba(0,0,0,0.75)';
      ctx.stroke();
      if (camera.zoom >= 4) {
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
      ctx.fillStyle = p.isHuman ? '#fff6c8' : allied ? '#b8f5cf' : traitor ? '#ffb4a8' : '#ffffff';
      ctx.strokeText(name, sx, sy - size * 0.35);
      ctx.fillText(name, sx, sy - size * 0.35);
      const s2 = size * 0.78;
      ctx.font = `500 ${s2}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, s2 / 5);
      const troops = formatNumber(p.troops);
      ctx.strokeText(troops, sx, sy + size * 0.6);
      ctx.fillText(troops, sx, sy + size * 0.6);
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
