// Efectos visuales: partículas (chispas, fuego, humo, escombros, espuma),
// ondas expansivas, marcas de cráter y piezas con guion propio (proyectiles
// de buque, interceptores, misiles derribados). Solo es dibujo: no toca la
// simulación y usa tiempo real (segundos), no ticks.
//
// Las posiciones van en casillas del mapa; `z` es la altura (en casillas) y se
// dibuja desplazando hacia arriba, con lo que chispas y escombros hacen arcos.

import { RES } from './config.js';

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Sprite circular difuminado de un color (se escala al dibujar). */
function glowSprite(r, g, b, core = 0.25) {
  const s = 64;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(core, `rgba(${r},${g},${b},0.85)`);
  grad.addColorStop(0.6, `rgba(${r},${g},${b},0.28)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  return c;
}

/** Bocanada de humo irregular. */
function smokeSprite(r, g, b) {
  const s = 64;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  for (let k = 0; k < 7; k++) {
    const x = s / 2 + rnd(-10, 10);
    const y = s / 2 + rnd(-10, 10);
    const rad = rnd(12, 20);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  }
  return c;
}

/** Cráter: centro oscuro, borde chamuscado. */
function scorchSprite() {
  const s = 128;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(20, 14, 10, 0.85)');
  grad.addColorStop(0.45, 'rgba(36, 26, 18, 0.7)');
  grad.addColorStop(0.75, 'rgba(60, 40, 24, 0.35)');
  grad.addColorStop(1, 'rgba(60, 40, 24, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  // Brasas
  for (let k = 0; k < 26; k++) {
    const a = rnd(0, TAU);
    const d = rnd(0, s * 0.3);
    ctx.fillStyle = `rgba(255, ${Math.round(rnd(80, 160))}, 40, ${rnd(0.3, 0.8)})`;
    ctx.fillRect(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 2, 2);
  }
  return c;
}

let SPRITES = null;
function sprites() {
  if (!SPRITES) {
    SPRITES = {
      fire: glowSprite(255, 170, 70, 0.2),
      core: glowSprite(255, 246, 220, 0.35),
      red: glowSprite(255, 80, 50),
      blue: glowSprite(150, 215, 255, 0.3),
      gold: glowSprite(255, 215, 90, 0.3),
      smoke: smokeSprite(70, 70, 74),
      dark: smokeSprite(28, 26, 26),
      dust: smokeSprite(150, 128, 96),
      steam: smokeSprite(225, 236, 242),
      scorch: scorchSprite(),
    };
  }
  return SPRITES;
}

/** Sprites que se dibujan sumando luz. */
const ADDITIVE = new Set(['fire', 'core', 'red', 'blue', 'gold']);

export class Fx {
  constructor() {
    this.parts = [];
    this.decals = [];
    this.scripts = [];
    this.max = 1600;
    this.shake = 0;
    this.flash = 0; // destello de toda la pantalla (0-1)
    sprites();
  }

  /** Sprite de brillo cálido (para halos). */
  get glow() {
    return sprites().fire;
  }

  clear() {
    this.parts.length = 0;
    this.decals.length = 0;
    this.scripts.length = 0;
    this.shake = 0;
    this.flash = 0;
  }

  /**
   * Añade una partícula. Campos: x, y, z, vx, vy, vz (casillas/s), g (gravedad
   * sobre z), drag, life (s), s0 → s1 (tamaño en casillas), min (px mínimos),
   * a0 (opacidad), sprite | spark | ring | chunk, color.
   */
  add(p) {
    if (this.parts.length >= this.max) return;
    // Las recetas usan medidas de la rejilla original: se pasan a casillas actuales
    if (!p.raw) {
      if (p.vx) p.vx *= RES;
      if (p.vy) p.vy *= RES;
      if (p.vz) p.vz *= RES;
      if (p.g) p.g *= RES;
      if (p.s0) p.s0 *= RES;
      if (p.s1) p.s1 *= RES;
      if (p.z && !p.zAbs) p.z *= RES;
    }
    p.age = 0;
    p.z ??= 0;
    p.vx ??= 0;
    p.vy ??= 0;
    p.vz ??= 0;
    p.g ??= 0;
    p.drag ??= 0;
    p.s1 ??= p.s0;
    p.a0 ??= 1;
    p.min ??= 0;
    this.parts.push(p);
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    const parts = this.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        parts[i] = parts[parts.length - 1];
        parts.pop();
        continue;
      }
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        if (!p.g) p.vz *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.g || p.vz) {
        p.vz -= p.g * dt;
        p.z += p.vz * dt;
        if (p.z < 0) {
          p.z = 0;
          p.vz *= -0.25;
          p.vx *= 0.4;
          p.vy *= 0.4;
        }
      }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += dt;
      if (d.age >= d.life) this.decals.splice(i, 1);
    }
    for (let i = this.scripts.length - 1; i >= 0; i--) {
      if (!this.scripts[i].update(dt, this)) this.scripts.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - dt * 14);
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  /** Marcas en el suelo (cráteres, manchas de aceite): debajo de todo lo demás. */
  drawDecals(ctx, cam) {
    if (!this.decals.length) return;
    const S = sprites();
    const z = cam.zoom;
    for (const d of this.decals) {
      const r = d.r * z;
      const sx = (d.x - cam.x) * z;
      const sy = (d.y - cam.y) * z;
      if (sx < -r || sy < -r || sx > cam.viewW + r || sy > cam.viewH + r) continue;
      ctx.globalAlpha = Math.min(1, (d.life - d.age) / 3) * d.a;
      ctx.drawImage(S[d.sprite], sx - r, sy - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  /** Partículas y piezas con guion (en coordenadas de pantalla, CSS px). */
  draw(ctx, cam) {
    const S = sprites();
    const z = cam.zoom;
    const W = cam.viewW;
    const H = cam.viewH;
    // Primero lo que tapa (humo, escombros), luego lo que brilla
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass ? 'lighter' : 'source-over';
      for (const p of this.parts) {
        const add = p.spark || (p.sprite && ADDITIVE.has(p.sprite)) || p.glowRing;
        if ((pass === 1) !== !!add) continue;
        const t = p.age / p.life;
        const size = Math.max(p.min, (p.s0 + (p.s1 - p.s0) * t) * z);
        const sx = (p.x - cam.x) * z;
        const sy = (p.y - p.z - cam.y) * z;
        if (sx < -size - 20 || sy < -size - 20 || sx > W + size + 20 || sy > H + size + 20) continue;
        const fade = p.fadeIn ? Math.min(1, t / p.fadeIn) * (1 - t) : 1 - t * t;
        const a = p.a0 * fade;
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        if (p.sprite) {
          ctx.drawImage(S[p.sprite], sx - size, sy - size, size * 2, size * 2);
        } else if (p.spark) {
          // Trazo en la dirección del movimiento
          const len = Math.min(18, Math.hypot(p.vx, p.vy - p.vz) * z * 0.045 + 1.5);
          const ang = Math.atan2(p.vy - p.vz, p.vx);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, size * 0.5);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - Math.cos(ang) * len, sy - Math.sin(ang) * len);
          ctx.stroke();
        } else if (p.ring) {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, (p.lw || 0.6) * z * (1 - t * 0.7));
          ctx.beginPath();
          ctx.arc(sx, sy, size, 0, TAU);
          ctx.stroke();
        } else if (p.chunk) {
          ctx.fillStyle = p.color;
          ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (const s of this.scripts) s.draw(ctx, cam);
  }

  // ------------------------------------------------------------ recetas

  /** Choque en el frente: chispas, fogonazo y algo de humo. */
  skirmish(x, y, big = false) {
    const n = big ? 4 : 2;
    for (let k = 0; k < n; k++) {
      const a = rnd(0, TAU);
      const v = rnd(2, 6);
      this.add({
        x, y, z: 0.2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(1, 4), g: 14, drag: 2,
        life: rnd(0.25, 0.5), s0: 0.18, min: 1, spark: true, color: Math.random() < 0.5 ? '#ffd27a' : '#ff9d4a',
      });
    }
    this.add({ x: x + rnd(-0.4, 0.4), y: y + rnd(-0.4, 0.4), life: rnd(0.1, 0.18), s0: rnd(0.7, 1.2), s1: 0.4, min: 3, sprite: 'fire', a0: 0.9 });
    if (Math.random() < (big ? 0.6 : 0.3)) {
      this.add({
        x, y, z: 0.3, vx: rnd(-0.4, 0.4), vy: rnd(-0.4, 0.4), vz: rnd(0.4, 0.9), drag: 0.6,
        life: rnd(1, 1.8), s0: 0.6, s1: rnd(1.6, 2.4), min: 2, sprite: 'smoke', a0: 0.5, fadeIn: 0.15,
      });
    }
  }

  /** Polvo al ocupar tierra libre. */
  dust(x, y) {
    this.add({ x, y, vx: rnd(-0.3, 0.3), vy: rnd(-0.3, 0.3), vz: 0.3, drag: 1, life: rnd(0.6, 1), s0: 0.4, s1: 1.4, min: 1, sprite: 'dust', a0: 0.35, fadeIn: 0.2 });
  }

  /** Explosión de misil (radio R en casillas). */
  explosion(x, y, R) {
    this.shake = Math.max(this.shake, 9);
    this.flash = Math.max(this.flash, 0.55);
    this.add({ x, y, life: 0.45, s0: R * 2.4, s1: R * 3, min: 70, sprite: 'core', a0: 1 });
    this.add({ x, y, life: 0.7, s0: R * 1.6, s1: R * 2.5, min: 50, sprite: 'fire', a0: 1 });
    this.add({ x, y, life: 0.9, s0: R * 1.2, s1: R * 2, min: 36, sprite: 'red', a0: 0.8 });
    // Onda expansiva doble
    this.add({ x, y, life: 0.8, s0: R * 0.3, s1: R * 3.4, min: 10, ring: true, glowRing: true, color: 'rgba(255, 236, 200, 0.95)', lw: 1.1 });
    this.add({ x, y, life: 1.3, s0: R * 0.2, s1: R * 2.4, min: 6, ring: true, color: 'rgba(120, 96, 70, 0.75)', lw: 2 });
    // Bola de fuego que sube
    for (let k = 0; k < 14; k++) {
      const a = rnd(0, TAU);
      const d = rnd(0, R * 0.55);
      this.add({
        x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: rnd(0, R * 0.3),
        vx: Math.cos(a) * rnd(0.5, 2), vy: Math.sin(a) * rnd(0.5, 2), vz: rnd(1, 4), drag: 1.5,
        life: rnd(0.7, 1.4), s0: rnd(R * 0.3, R * 0.55), s1: rnd(R * 0.6, R * 0.95), min: 10,
        sprite: Math.random() < 0.3 ? 'red' : 'fire', a0: 0.95,
      });
    }
    // Chispas y escombros en arco
    for (let k = 0; k < 64; k++) {
      const a = rnd(0, TAU);
      const v = rnd(R * 0.8, R * 3.4);
      const spark = k % 3 !== 0;
      this.add({
        x, y, z: 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(R * 0.6, R * 2.2), g: R * 3.2, drag: 0.8,
        life: rnd(0.7, 1.6), s0: spark ? 0.25 : rnd(0.3, 0.5), min: spark ? 1.6 : 2,
        spark, chunk: !spark, color: spark ? (Math.random() < 0.5 ? '#ffe2a0' : '#ff8c3a') : '#2a2420',
      });
    }
    // Columna de humo que sube y dura (hongo)
    for (let k = 0; k < 22; k++) {
      const a = rnd(0, TAU);
      const d = rnd(0, R * 0.7);
      this.add({
        x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: rnd(0, R * 0.4),
        vx: rnd(-0.6, 0.6) + 0.5, vy: rnd(-0.6, 0.3), vz: rnd(1, k < 8 ? 5 : 2.5), drag: 0.4,
        life: rnd(2.8, 5), s0: R * 0.35, s1: rnd(R * 0.9, R * 1.5), min: 8,
        sprite: Math.random() < 0.5 ? 'dark' : 'smoke', a0: 0.7, fadeIn: 0.12,
      });
    }
    // Brasas que quedan en el suelo
    for (let k = 0; k < 18; k++) {
      const a = rnd(0, TAU);
      const d = rnd(0, R * 0.9);
      this.add({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, life: rnd(1.5, 3), s0: rnd(0.25, 0.5), min: 2, sprite: 'fire', a0: 0.7, fadeIn: 0.3 });
    }
    this.decals.push({ x, y, r: R * 1.25 * RES, age: 0, life: 14, a: 0.9, sprite: 'scorch' });
  }

  /** Estallido en el aire (misil derribado) a altura z. */
  airburst(x, y, z) {
    this.flash = Math.max(this.flash, 0.2);
    this.add({ zAbs: true, x, y, z, life: 0.35, s0: 4, s1: 5.5, min: 44, sprite: 'core' });
    this.add({ zAbs: true, x, y, z, life: 0.6, s0: 2.6, s1: 4.2, min: 30, sprite: 'blue', a0: 0.95 });
    this.add({ zAbs: true, x, y, z, life: 0.65, s0: 2, s1: 3.6, min: 24, sprite: 'fire', a0: 0.9 });
    this.add({ zAbs: true, x, y, z, life: 0.6, s0: 0.4, s1: 7, min: 8, ring: true, glowRing: true, color: 'rgba(190, 230, 255, 0.95)', lw: 0.6 });
    for (let k = 0; k < 6; k++) {
      this.add({ zAbs: true, x: x + rnd(-1, 1), y: y + rnd(-1, 1), z: z + rnd(-0.5, 0.5), vx: rnd(-1, 1), vy: rnd(-1, 1), vz: rnd(-0.5, 1), drag: 1.2, life: rnd(0.5, 0.9), s0: 1, s1: 1.8, min: 6, sprite: 'fire', a0: 0.85 });
    }
    // Fragmentos que caen ardiendo
    for (let k = 0; k < 40; k++) {
      const a = rnd(0, TAU);
      const v = rnd(2, 8);
      this.add({ zAbs: true,
        x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(-1, 5), g: 12, drag: 0.6,
        life: rnd(0.9, 1.8), s0: 0.2, min: 1.2, spark: true, color: Math.random() < 0.6 ? '#fff1c9' : '#ffa552',
      });
    }
    for (let k = 0; k < 5; k++) {
      this.add({ zAbs: true, x: x + rnd(-1, 1), y: y + rnd(-1, 1), z, vx: rnd(-0.5, 0.5), vy: rnd(-0.5, 0.5), vz: rnd(-0.3, 0.3), drag: 0.5, life: rnd(1.8, 3), s0: 0.8, s1: 2.6, min: 4, sprite: 'smoke', a0: 0.55, fadeIn: 0.1 });
    }
    this.shake = Math.max(this.shake, 2);
  }

  /** Petardazo pequeño (interceptor que falla). */
  pop(x, y, z) {
    this.add({ zAbs: true, x, y, z, life: 0.25, s0: 1.2, s1: 2, min: 10, sprite: 'fire' });
    this.add({ zAbs: true, x, y, z, life: 1.6, s0: 0.5, s1: 1.8, min: 4, sprite: 'smoke', a0: 0.5, vz: 0.4, fadeIn: 0.1 });
  }

  /** Salpicadura en el agua (proyectil, barco hundido). */
  splash(x, y, size = 1) {
    this.add({ x, y, life: 0.6, s0: 0.2 * size, s1: 1.8 * size, min: 3, ring: true, color: 'rgba(235, 248, 255, 0.85)', lw: 0.25 * size });
    this.add({ x, y, life: 0.9, s0: 0.3 * size, s1: 2.6 * size, min: 3, ring: true, color: 'rgba(200, 235, 255, 0.5)', lw: 0.18 * size });
    for (let k = 0; k < 8 * size; k++) {
      const a = rnd(0, TAU);
      const v = rnd(0.5, 2.5) * size;
      this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(2, 5) * size, g: 16, drag: 1, life: rnd(0.4, 0.8), s0: 0.16, min: 1, spark: true, color: '#e9f6ff' });
    }
    this.add({ x, y, vz: 0.6, life: 1.2, s0: 0.5 * size, s1: 1.6 * size, min: 3, sprite: 'steam', a0: 0.5, fadeIn: 0.1 });
  }

  /** Barco hundido: llamarada, salpicadura, humo y mancha. */
  sink(x, y, big = false) {
    const k = big ? 1.8 : 1;
    this.add({ x, y, life: 0.35, s0: 1.4 * k, s1: 2.6 * k, min: 12, sprite: 'core' });
    for (let i = 0; i < 6 * k; i++) {
      this.add({ x: x + rnd(-0.5, 0.5) * k, y: y + rnd(-0.5, 0.5) * k, vz: rnd(0.5, 2), drag: 1, life: rnd(0.5, 1), s0: 0.6 * k, s1: 1.4 * k, min: 5, sprite: 'fire', a0: 0.9 });
    }
    for (let i = 0; i < 14 * k; i++) {
      const a = rnd(0, TAU);
      const v = rnd(1, 4) * k;
      this.add({ x, y, z: 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(1, 4) * k, g: 12, drag: 0.8, life: rnd(0.5, 1.1), s0: 0.22, min: 1.2, chunk: i % 2 === 0, spark: i % 2 === 1, color: i % 2 ? '#ffc070' : '#3b302a' });
    }
    this.splash(x, y, big ? 1.6 : 1);
    for (let i = 0; i < 5 * k; i++) {
      this.add({ x: x + rnd(-0.6, 0.6), y: y + rnd(-0.6, 0.6), vx: 0.4, vz: rnd(0.4, 1.2), drag: 0.4, life: rnd(2, 3.5), s0: 0.5 * k, s1: 2.2 * k, min: 4, sprite: 'dark', a0: 0.6, fadeIn: 0.1 });
    }
    this.decals.push({ x, y, r: 1.8 * k * RES, age: 0, life: 9, a: 0.55, sprite: 'dark' });
    if (big) this.shake = Math.max(this.shake, 3);
  }

  /** Desembarco: espuma y polvo en la playa. */
  landing(x, y) {
    this.splash(x, y, 0.7);
    for (let k = 0; k < 3; k++) this.dust(x + rnd(-0.6, 0.6), y + rnd(-0.6, 0.6));
  }

  /** Captura de un barco civil: destello con el color del captor y monedas. */
  capture(x, y, color) {
    this.add({ x, y, life: 0.7, s0: 0.3, s1: 3, min: 4, ring: true, glowRing: true, color, lw: 0.35 });
    for (let k = 0; k < 8; k++) {
      const a = rnd(0, TAU);
      this.add({ x, y, vx: Math.cos(a) * 1.5, vy: Math.sin(a) * 1.5, vz: rnd(2, 4), g: 8, life: rnd(0.6, 1), s0: 0.35, min: 2.5, sprite: 'gold', a0: 1 });
    }
  }

  /** Estela de espuma detrás de un barco que navega. */
  wake(x, y, ang, size) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const back = ang + Math.PI;
    const sp = 0.5 * size;
    this.add({
      x: x + Math.cos(back) * 0.4 * size, y: y + Math.sin(back) * 0.4 * size,
      vx: Math.cos(back + side * 0.5) * sp, vy: Math.sin(back + side * 0.5) * sp, drag: 1.5,
      life: rnd(0.8, 1.4), s0: 0.12 * size, s1: 0.45 * size, min: 1, sprite: 'steam', a0: 0.6,
    });
  }

  /** Humo del motor de un misil. */
  trail(x, y, z) {
    this.add({ zAbs: true, x: x + rnd(-0.15, 0.15), y: y + rnd(-0.15, 0.15), z, vz: rnd(-0.1, 0.2), drag: 0.5, life: rnd(1, 1.8), s0: 0.35, s1: rnd(1, 1.6), min: 2, sprite: 'steam', a0: 0.45 });
  }

  /** Fogonazo del cañón. */
  muzzle(x, y, ang) {
    this.add({ x: x + Math.cos(ang) * 0.5, y: y + Math.sin(ang) * 0.5, life: 0.12, s0: 0.9, s1: 0.5, min: 5, sprite: 'core' });
    this.add({ x: x + Math.cos(ang) * 0.7, y: y + Math.sin(ang) * 0.7, vx: Math.cos(ang) * 1.2, vy: Math.sin(ang) * 1.2, drag: 1, life: 0.9, s0: 0.4, s1: 1.2, min: 2, sprite: 'smoke', a0: 0.5, fadeIn: 0.1 });
  }

  /** Proyectil de buque hasta (tx, ty); al llegar, salpica o estalla. */
  shell(x, y, tx, ty, onWater) {
    const T = 0.22 + (Math.hypot(tx - x, ty - y) / RES) * 0.02;
    let t = 0;
    const fx = this;
    this.scripts.push({
      update(dt) {
        t += dt;
        if (t < T) return true;
        if (onWater) fx.splash(tx, ty, 0.8);
        else fx.skirmish(tx, ty, true);
        fx.add({ x: tx, y: ty, life: 0.18, s0: 0.8, s1: 1.4, min: 6, sprite: 'fire' });
        return false;
      },
      draw(ctx, cam) {
        const k = t / T;
        const px = x + (tx - x) * k;
        const py = y + (ty - y) * k - Math.sin(Math.PI * k) * 1.2 * RES;
        const sx = (px - cam.x) * cam.zoom;
        const sy = (py - cam.y) * cam.zoom;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ffe7b0';
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1.5, cam.zoom * RES * 0.18), 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      },
    });
  }

  /**
   * Rótulo flotante sobre el mapa («¡DERRIBADO!»): tamaño fijo en pantalla,
   * sube un poco y se apaga. Va aparte de las partículas para que nunca se pierda.
   */
  label(x, y, text, color, px = 14, life = 1.8) {
    let age = 0;
    this.scripts.push({
      update(dt) {
        age += dt;
        return age < life;
      },
      draw(ctx, cam) {
        const t = age / life;
        const z = cam.zoom;
        const sx = (x - cam.x) * z;
        const sy = (y - cam.y) * z - 14 - t * 22;
        const pop = t < 0.1 ? 0.6 + 4 * t : 1;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - t) * 2.2);
        ctx.font = `900 ${Math.round(px * pop)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(3, px / 3.5);
        ctx.strokeStyle = 'rgba(6, 12, 24, 0.85)';
        ctx.strokeText(text, sx, sy);
        ctx.fillStyle = color;
        ctx.fillText(text, sx, sy);
        ctx.restore();
      },
    });
  }

  /**
   * Interceptor desde la batería (sx, sy) hasta un misil que va por (mx, my, mz)
   * con velocidad (vx, vy, vz). `hit`: si lo derriba (el misil se sigue
   * dibujando hasta el choque). Deja una estela continua que se desvanece
   * y un rótulo «¡DERRIBADO!» / «FALLO» donde se cruzan.
   */
  intercept(sx, sy, mx, my, mz, vx, vy, vz, hit, missileColor) {
    const T = 0.8; // lo bastante lento para verlo subir
    const FADE = 1.4; // la estela sigue a la vista un rato tras el choque
    const ex = mx + vx * T + (hit ? 0 : rnd(-2, 2) * RES);
    const ey = my + vy * T + (hit ? 0 : rnd(-2, 2) * RES);
    const ez = Math.max(0.5 * RES, mz + vz * T);
    let t = 0;
    let done = false;
    const fx = this;
    let puff = 0;
    // Posición (en el plano de pantalla) del interceptor en la fracción k del vuelo
    const at = (k) => [sx + (ex - sx) * k, sy + (ey - sy) * k - ez * k * k];
    // Fogonazo y humo de lanzamiento en la batería
    this.add({ x: sx, y: sy, life: 0.9, s0: 0.8, s1: 3, min: 8, sprite: 'steam', a0: 0.8, vz: 0.6 });
    this.add({ x: sx, y: sy, life: 0.3, s0: 1.4, s1: 0.6, min: 16, sprite: 'blue' });
    this.add({ x: sx, y: sy, life: 0.5, s0: 0.3, s1: 2.5, min: 6, ring: true, glowRing: true, color: 'rgba(170, 220, 255, 0.9)', lw: 0.25 });
    this.scripts.push({
      update(dt) {
        const k0 = Math.min(1, t / T);
        t += dt;
        const k1 = Math.min(1, t / T);
        // Humo del motor repartido por el tramo recorrido en este fotograma
        if (!done) {
          puff += dt;
          const n = Math.floor(puff / 0.015);
          puff -= n * 0.015;
          for (let i = 1; i <= n; i++) {
            const k = k0 + ((k1 - k0) * i) / n;
            fx.add({ x: sx + (ex - sx) * k, y: sy + (ey - sy) * k, z: ez * k * k, zAbs: true, drag: 0.5, life: rnd(1.1, 1.7), s0: 0.45, s1: 1.6, min: 4, sprite: 'steam', a0: 0.6 });
          }
        }
        if (!done && t >= T) {
          done = true;
          if (hit) fx.airburst(ex, ey, ez);
          else fx.pop(ex, ey, ez);
          fx.label(ex, ey - ez, hit ? '¡DERRIBADO!' : 'FALLO', hit ? '#bfe6ff' : '#d4d8e0', hit ? 18 : 14);
        }
        return t < T + FADE;
      },
      draw(ctx, cam) {
        const k = Math.min(1, t / T);
        const z = cam.zoom;
        const fade = done ? Math.max(0, 1 - (t - T) / FADE) : 1;
        // Estela: línea fina y continua de la batería a la cabeza
        const N = 18;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const [px, py] = at((k * i) / N);
          const X = (px - cam.x) * z;
          const Y = (py - cam.y) * z;
          if (i) ctx.lineTo(X, Y);
          else ctx.moveTo(X, Y);
        }
        ctx.globalAlpha = 0.22 * fade;
        ctx.strokeStyle = '#7cc8ff';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.globalAlpha = 0.85 * fade;
        ctx.strokeStyle = '#e6f4ff';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
        if (done) return;
        // Cabeza del interceptor
        const [px, py] = at(k);
        const hx = (px - cam.x) * z;
        const hy = (py - cam.y) * z;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(sprites().blue, hx - 16, hy - 16, 32, 32);
        ctx.globalCompositeOperation = 'source-over';
        // Interceptor: un misil pequeño, blanco y azul, apuntando hacia donde va
        const ang = Math.atan2(ey - sy - 2 * ez * k, ex - sx);
        drawMissileSprite(ctx, hx, hy, ang, Math.min(22, Math.max(13, z * RES * 2.2)), '#5ab8ff', t);
        // El misil condenado sigue su vuelo hasta el choque
        if (hit) {
          const qx = mx + vx * t;
          const qy = my + vy * t;
          const qz = mz + vz * t;
          drawMissileSprite(ctx, (qx - cam.x) * z, (qy - qz - cam.y) * z, Math.atan2(vy - vz, vx), Math.min(30, Math.max(16, z * RES * 3)), missileColor, t);
        }
      },
    });
  }
}

/** Misil visto desde arriba, apuntando en `ang` (pantalla), con llama. */
export function drawMissileSprite(ctx, x, y, ang, len, color, time) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const w = len * 0.22;
  // Llama del motor
  const flick = 0.75 + Math.sin(time * 60) * 0.12 + Math.random() * 0.13;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(sprites().fire, -len * 1.05 - len * 0.5 * flick, -len * 0.35, len * flick, len * 0.7);
  ctx.drawImage(sprites().core, -len * 0.75, -w * 0.9, len * 0.4, w * 1.8);
  ctx.globalCompositeOperation = 'source-over';
  // Aletas
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, 0);
  ctx.lineTo(-len * 0.62, -w * 1.5);
  ctx.lineTo(-len * 0.38, -w * 0.5);
  ctx.lineTo(-len * 0.38, w * 0.5);
  ctx.lineTo(-len * 0.62, w * 1.5);
  ctx.closePath();
  ctx.fill();
  // Cuerpo
  ctx.beginPath();
  ctx.moveTo(len * 0.5, 0);
  ctx.quadraticCurveTo(len * 0.36, -w * 0.62, len * 0.2, -w * 0.55);
  ctx.lineTo(-len * 0.5, -w * 0.5);
  ctx.lineTo(-len * 0.5, w * 0.5);
  ctx.lineTo(len * 0.2, w * 0.55);
  ctx.quadraticCurveTo(len * 0.36, w * 0.62, len * 0.5, 0);
  ctx.fillStyle = '#eef1f5';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();
  // Ojiva con el color del lanzador
  ctx.beginPath();
  ctx.moveTo(len * 0.5, 0);
  ctx.quadraticCurveTo(len * 0.36, -w * 0.62, len * 0.24, -w * 0.56);
  ctx.lineTo(len * 0.24, w * 0.56);
  ctx.quadraticCurveTo(len * 0.36, w * 0.62, len * 0.5, 0);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}
