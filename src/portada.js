// Portada del inicio: nuestro mapa del mundo como si hubiera una partida en
// marcha. Naciones con su color y su bandera, capitales, puntos
// estratégicos, flechas de ataque que avanzan, explosiones en los frentes y
// buques patrullando. El mapa se pinta una vez; encima, una animación suave
// (30 fps como mucho y solo mientras se ve el inicio).
import { paintMapPreview } from './terreno.js';
import { drawFlag, drawPointIcon, flagReady } from './icons.js';
import { drawWarship } from './barcos.js';

function hslRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export class CoverArt {
  /**
   * `data`: mapa real decodificado ({ w, h, terrain, relief, countries }).
   * `crop`: recorte en fracciones del mapa ({ x0, x1, y0 }) y `labelFrom`: desde
   * qué fracción del ancho se rotulan países (lo de la izquierda queda tapado).
   */
  constructor(canvas, data, { crop = null, labelFrom = 0.44 } = {}) {
    this.canvas = canvas;
    this.data = data;
    this.crop = crop || { x0: 0.235, x1: 0.67, y0: 0.13 };
    this.labelFrom = labelFrom;
    this.raf = 0;
    this.last = 0;
    this._paintBase();
  }

  _paintBase() {
    const { canvas, data } = this;
    const W = canvas.width;
    const H = canvas.height;
    // De la costa de América a Oriente Próximo: Europa y el Mediterráneo, a la derecha
    const x0 = Math.round(data.w * this.crop.x0);
    const x1 = Math.round(data.w * this.crop.x1);
    const cropW = x1 - x0;
    const cropH = Math.round((cropW * H) / W);
    const y0 = Math.round(data.h * this.crop.y0);
    const base = document.createElement('canvas');
    base.width = W;
    base.height = H;
    paintMapPreview(base, data, [x0, y0, x1, y0 + cropH]);
    const ctx = base.getContext('2d');
    const k = W / cropW;
    const toScreen = (tile) => [((tile % data.w) - x0 + 0.5) * k, (Math.floor(tile / data.w) - y0 + 0.5) * k];
    // Países a la vista (o cerca): territorio de cada uno por cercanía a su centro (pesando su tamaño)
    const nations = [];
    data.countries.forEach(([name, tile, area, iso], i) => {
      const [x, y] = toScreen(tile);
      if (x < -W * 0.3 || y < -H * 0.5 || x > W * 1.3 || y > H * 1.5) return;
      const hue = (i * 137.508 + 20) % 360;
      nations.push({ name, iso, x, y, area, w: (area / Math.PI) * k * k * 0.7, c: hslRgb(hue, 0.28, 0.68), e: hslRgb(hue, 0.28, 0.4) });
    });
    this.nations = nations;
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const owner = new Int16Array(W * H).fill(-1);
    const maxD2 = (110 * k) ** 2;
    const land = new Uint8Array(W * H);
    for (let py = 0; py < H; py++) {
      const ty = Math.min(data.h - 1, Math.floor(y0 + (py + 0.5) / k));
      for (let px = 0; px < W; px++) {
        const tx = Math.min(data.w - 1, Math.floor(x0 + (px + 0.5) / k));
        const tr = data.terrain[ty * data.w + tx];
        if (tr === 0) continue;
        land[py * W + px] = tr;
        let best = -1;
        let bestV = Infinity;
        let bestD2 = 0;
        for (let n = 0; n < nations.length; n++) {
          const q = nations[n];
          const d2 = (q.x - px) ** 2 + (q.y - py) ** 2;
          const v = d2 - q.w;
          if (v < bestV) {
            bestV = v;
            best = n;
            bestD2 = d2;
          }
        }
        if (best >= 0 && bestD2 < maxD2 + nations[best].w) owner[py * W + px] = best;
      }
    }
    for (let i = 0; i < W * H; i++) {
      const o = owner[i];
      if (o < 0) continue;
      const x = i % W;
      const edge = (x > 0 && owner[i - 1] !== o) || (x < W - 1 && owner[i + 1] !== o) || (i >= W && owner[i - W] !== o) || (i < W * (H - 1) && owner[i + W] !== o);
      const [r, g, b] = edge ? nations[o].e : nations[o].c;
      // Como en la partida: relleno apagado y semitransparente, frontera opaca
      const a = edge ? 1 : 0.5;
      const p = i * 4;
      d[p] = d[p] + (r - d[p]) * a;
      d[p + 1] = d[p + 1] + (g - d[p + 1]) * a;
      d[p + 2] = d[p + 2] + (b - d[p + 2]) * a;
    }
    ctx.putImageData(img, 0, 0);
    this.base = base;

    // Lo que se anima, en la parte que no tapa el texto (derecha)
    const visible = nations.filter((n) => n.x > W * this.labelFrom && n.x < W - 20 && n.y > 20 && n.y < H - 16).sort((a, b) => b.area - a.area);
    // Rótulos sin pisarse: de mayor a menor, se salta el que choca con uno ya puesto
    const meas = document.createElement('canvas').getContext('2d');
    meas.font = '600 15px system-ui, sans-serif';
    const boxes = [];
    this.labels = [];
    for (const n of visible) {
      if (this.labels.length >= 8) break;
      const w = meas.measureText(n.name).width + (n.iso ? 26 : 0) + 8;
      const box = [n.x - w / 2, n.y - 12, n.x + w / 2, n.y + 30];
      if (box[0] < 4 || box[2] > W - 4) continue;
      if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      this.labels.push(n);
    }
    // Frentes: parejas de vecinos cercanos entre los más grandes
    const fronts = [];
    const used = new Set();
    for (const a of visible.slice(0, 14)) {
      if (fronts.length >= 4) break;
      let best = null;
      let bd = Infinity;
      for (const b of visible) {
        if (b === a || used.has(b)) continue;
        const dd = Math.hypot(a.x - b.x, a.y - b.y);
        if (dd > 55 && dd < 190 && dd < bd) {
          bd = dd;
          best = b;
        }
      }
      if (best && !used.has(a)) {
        fronts.push({ from: a, to: best, hostile: fronts.length % 2 === 0 });
        used.add(a);
        used.add(best);
      }
    }
    this.fronts = fronts;
    // Puntos estratégicos: un paso en las montañas, un puerto clave en la costa y un núcleo industrial
    const pick = (test) => {
      for (let y = 30; y < H - 30; y += 7) {
        for (let x = Math.round(W * 0.5); x < W - 30; x += 9) if (test(x, y)) return [x, y];
      }
      return null;
    };
    const coast = (x, y) => land[y * W + x] && (!land[y * W + x - 4] || !land[y * W + x + 4] || !land[(y - 4) * W + x] || !land[(y + 4) * W + x]);
    this.points = [
      ['paso', pick((x, y) => land[y * W + x] === 3 && x > W * 0.62)],
      ['puerto', pick((x, y) => x > W * 0.72 && coast(x, y))],
      ['industria', this.labels[2] ? [this.labels[2].x + 26, this.labels[2].y + 18] : null],
    ].filter((p) => p[1]);
    // Buques: en el mar, en zonas despejadas
    const sea = (x, y) => x > 0 && y > 0 && x < W && y < H && !land[(y | 0) * W + (x | 0)];
    const ships = [];
    for (const [fx, fy] of [[0.5, 0.75], [0.86, 0.85], [0.58, 0.3]]) {
      let sx = W * fx;
      let sy = H * fy;
      for (let r = 0; r < 60 && !(sea(sx, sy) && sea(sx + 14, sy) && sea(sx - 14, sy)); r += 3) {
        sx += 3;
        sy -= 1;
      }
      if (sea(sx, sy)) ships.push({ x: sx, y: sy, phase: ships.length * 2.1 });
    }
    this.ships = ships;
  }

  /** ¿Animaciones apagadas? (Ajustes o el sistema; se mira en cada fotograma) */
  _still() {
    return document.body.classList.contains('sin-animaciones') || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  start() {
    if (this.raf) return;
    const loop = (now) => {
      if (this._still()) {
        // Se apagaron las animaciones: una imagen fija y se para
        this.raf = 0;
        this.draw(1.2);
        return;
      }
      this.raf = requestAnimationFrame(loop);
      if (now - this.last < 33) return;
      this.last = now;
      this.draw(now / 1000);
    };
    if (this._still()) this.draw(1.2);
    else this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  draw(t) {
    const ctx = this.canvas.getContext('2d');
    ctx.drawImage(this.base, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Flechas de ataque que avanzan (rojas y verdes) y su explosión en el frente
    for (const f of this.fronts) {
      const { from: a, to: b } = f;
      const mx = (a.x + b.x) / 2 - (b.y - a.y) * 0.25;
      const my = (a.y + b.y) / 2 + (b.x - a.x) * 0.25;
      const col = f.hostile ? '255, 95, 95' : '95, 211, 141';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.lineWidth = 11;
      ctx.strokeStyle = `rgba(${col}, 0.2)`;
      ctx.stroke();
      ctx.setLineDash([14, 10]);
      ctx.lineDashOffset = -t * 40;
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = `rgba(${col}, 0.95)`;
      ctx.stroke();
      ctx.setLineDash([]);
      // Punta de flecha
      const ang = Math.atan2(b.y - my, b.x - mx);
      ctx.beginPath();
      ctx.moveTo(b.x + Math.cos(ang) * 11, b.y + Math.sin(ang) * 11);
      ctx.lineTo(b.x + Math.cos(ang + 2.5) * 14, b.y + Math.sin(ang + 2.5) * 14);
      ctx.lineTo(b.x + Math.cos(ang - 2.5) * 14, b.y + Math.sin(ang - 2.5) * 14);
      ctx.closePath();
      ctx.fillStyle = `rgba(${col}, 0.95)`;
      ctx.fill();
      // Explosión latiendo un poco antes de la punta
      const ex = b.x - Math.cos(ang) * 16;
      const ey = b.y - Math.sin(ang) * 16;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3 + a.x);
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 14 + pulse * 14);
      g.addColorStop(0, 'rgba(255, 240, 190, 0.9)');
      g.addColorStop(0.4, 'rgba(255, 150, 60, 0.55)');
      g.addColorStop(1, 'rgba(255, 90, 30, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(ex - 30, ey - 30, 60, 60);
      for (let s = 0; s < 5; s++) {
        const k = (t * 1.6 + s / 5) % 1;
        const sa = s * 1.26 + a.y;
        ctx.fillStyle = `rgba(255, 220, 140, ${1 - k})`;
        ctx.beginPath();
        ctx.arc(ex + Math.cos(sa) * k * 22, ey + Math.sin(sa) * k * 22 - k * 8, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Buques de guerra patrullando
    for (const s of this.ships) {
      const a = t * 0.35 + s.phase;
      const x = s.x + Math.cos(a) * 10;
      const y = s.y + Math.sin(a) * 4;
      drawWarship(ctx, x, y, a + Math.PI / 2, 13, s.phase > 2 ? '#e0483f' : '#2f7dff', false, null, 1);
    }
    // Puntos estratégicos
    for (const [kind, [x, y]] of this.points) drawPointIcon(ctx, kind, x, y, 22);
    // Naciones: bandera, nombre y su capital
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const n of this.labels) {
      const flag = flagReady() && n.iso;
      const tw = ctx.measureText(n.name).width;
      const x = n.x - (tw + (flag ? 26 : 0)) / 2;
      if (flag) drawFlag(ctx, n.iso, x + 10, n.y, 13);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.strokeText(n.name, x + (flag ? 24 : 0), n.y);
      ctx.fillStyle = 'rgba(48, 48, 48, 0.95)';
      ctx.fillText(n.name, x + (flag ? 24 : 0), n.y);
    }
    for (const n of this.labels.slice(0, 5)) {
      drawPointIcon(ctx, 'capital', n.x, n.y + 20, 16, { ring: `rgb(${n.e.join(',')})` });
    }
  }
}
