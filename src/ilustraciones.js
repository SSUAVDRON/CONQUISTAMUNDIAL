// Ilustraciones del inicio, dibujadas con canvas (sin imágenes externas):
// siluetas a contraluz al atardecer, como carteles de guerra. La portada
// (soldados subiendo una colina con la bandera de Trinchera), las tarjetas de
// modo (tanques, sala de mando, tropas con banderas, mapa con compás) y las
// miniaturas de novedades. Todo es decorativo: no toca la partida.
import { paintMapPreview } from './terreno.js';

const TAU = Math.PI * 2;

/** Generador pseudoaleatorio pequeño (las ilustraciones salen siempre iguales). */
function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Cielo de atardecer: de azul noche arriba a naranja junto al horizonte. */
function sunsetSky(ctx, W, H, { glowX = 0.5, glowY = 0.62, warm = 1, top = '#0b1426' } = {}) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(0.45, `rgb(${Math.round(40 + 40 * warm)}, ${Math.round(38 + 10 * warm)}, ${Math.round(70 - 10 * warm)})`);
  g.addColorStop(0.75, `rgb(${Math.round(150 + 80 * warm)}, ${Math.round(80 + 40 * warm)}, ${Math.round(50)})`);
  g.addColorStop(1, `rgb(${Math.round(200 + 50 * warm)}, ${Math.round(120 + 50 * warm)}, 60)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Resplandor del sol
  const r = Math.max(W, H) * 0.55;
  const s = ctx.createRadialGradient(W * glowX, H * glowY, 0, W * glowX, H * glowY, r);
  s.addColorStop(0, `rgba(255, 226, 150, ${0.95 * warm})`);
  s.addColorStop(0.08, `rgba(255, 190, 90, ${0.75 * warm})`);
  s.addColorStop(0.35, `rgba(240, 120, 50, ${0.32 * warm})`);
  s.addColorStop(1, 'rgba(240, 120, 50, 0)');
  ctx.fillStyle = s;
  ctx.fillRect(0, 0, W, H);
}

/** Nubes alargadas teñidas por el sol. */
function clouds(ctx, W, H, seed, { y0 = 0.15, y1 = 0.55, n = 9, color = '255, 170, 110', alpha = 0.22 } = {}) {
  const rnd = rand(seed);
  for (let i = 0; i < n; i++) {
    const x = rnd() * W;
    const y = H * (y0 + rnd() * (y1 - y0));
    const w = W * (0.12 + rnd() * 0.3);
    const h = H * (0.02 + rnd() * 0.05);
    const g = ctx.createRadialGradient(x, y, 0, x, y, w / 2);
    g.addColorStop(0, `rgba(${color}, ${alpha})`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, h / (w / 2));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, w / 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/** Línea de colinas suave entre y0 e y1 (fracciones de H), rellena hasta abajo. */
function hills(ctx, W, H, seed, y0, y1, color, bumps = 4) {
  const rnd = rand(seed);
  const ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) {
    const u = x / W;
    const v = (Math.sin(u * bumps * 3.1 + ph[0]) * 0.5 + Math.sin(u * bumps * 7.3 + ph[1]) * 0.25 + Math.sin(u * bumps * 13.7 + ph[2]) * 0.12) * 0.5 + 0.5;
    ctx.lineTo(x, H * (y0 + (y1 - y0) * v));
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Soldado en silueta (de perfil, mirando a la derecha) con casco, mochila y
 * fusil. (x, y) = pies; `s` = altura en píxeles; `step` (0-1) = zancada.
 */
export function soldier(ctx, x, y, s, { step = 0.5, flip = false, lean = 0.12, rifle = true, color = '#0a0d14' } = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.scale(s / 100, s / 100);
  ctx.rotate(lean);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Piernas (zancada)
  const a = (step - 0.5) * 0.9;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(0, -46);
  ctx.lineTo(Math.sin(a) * 26, -24);
  ctx.lineTo(Math.sin(a) * 30 + 4, 0);
  ctx.moveTo(0, -46);
  ctx.lineTo(-Math.sin(a) * 22, -24);
  ctx.lineTo(-Math.sin(a) * 30 - 2, 0);
  ctx.stroke();
  // Botas
  ctx.fillRect(Math.sin(a) * 30 - 1, -4, 12, 5);
  ctx.fillRect(-Math.sin(a) * 30 - 7, -4, 12, 5);
  // Torso y mochila
  ctx.beginPath();
  ctx.moveTo(-9, -48);
  ctx.lineTo(9, -48);
  ctx.lineTo(10, -80);
  ctx.lineTo(-8, -82);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-20, -82, 13, 26, 4);
  ctx.fill();
  // Cabeza y casco
  ctx.beginPath();
  ctx.arc(2, -89, 7, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(1, -93, 12, 7, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(-12, -94, 25, 3);
  // Brazos y fusil
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(4, -76);
  ctx.lineTo(16, -62);
  ctx.lineTo(24, -70);
  ctx.stroke();
  if (rifle) {
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-6, -58);
    ctx.lineTo(44, -86);
    ctx.stroke();
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-8, -57);
    ctx.lineTo(4, -64);
    ctx.stroke();
  }
  ctx.restore();
}

/** Tanque en silueta mirando a la derecha. (x, y) = suelo; `s` = largo. */
export function tank(ctx, x, y, s, { color = '#0a0d14', turret = 0 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 100, s / 100);
  ctx.fillStyle = color;
  // Orugas
  ctx.beginPath();
  ctx.roundRect(-50, -16, 100, 16, 8);
  ctx.fill();
  // Casco
  ctx.beginPath();
  ctx.moveTo(-48, -16);
  ctx.lineTo(-42, -30);
  ctx.lineTo(40, -30);
  ctx.lineTo(52, -16);
  ctx.closePath();
  ctx.fill();
  // Torreta y cañón
  ctx.save();
  ctx.translate(-2, -32);
  ctx.rotate(turret);
  ctx.beginPath();
  ctx.moveTo(-24, 2);
  ctx.lineTo(-18, -14);
  ctx.lineTo(16, -14);
  ctx.lineTo(24, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(18, -11, 54, 5);
  ctx.fillRect(68, -12, 8, 7);
  ctx.restore();
  // Ruedas (un poco más claras: dan volumen)
  ctx.fillStyle = 'rgba(255, 210, 150, 0.08)';
  for (let i = -38; i <= 38; i += 15) {
    ctx.beginPath();
    ctx.arc(i, -8, 5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Escudo de Trinchera (el del logotipo) centrado en (x, y) con alto h. */
export function emblem(ctx, x, y, h, { stroke = '#e8b04a', fill = '#131b2b' } = {}) {
  const k = h / 56;
  ctx.save();
  ctx.translate(x - 32 * k, y - 32 * k);
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.moveTo(32, 4);
  ctx.lineTo(56, 12);
  ctx.lineTo(56, 30);
  ctx.bezierCurveTo(56, 45, 45, 55, 32, 60);
  ctx.bezierCurveTo(19, 55, 8, 45, 8, 30);
  ctx.lineTo(8, 12);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(12, 41);
  ctx.lineTo(19, 34.5);
  ctx.lineTo(26, 41);
  ctx.lineTo(33, 34.5);
  ctx.lineTo(40, 41);
  ctx.lineTo(47, 34.5);
  ctx.lineTo(52.5, 39);
  ctx.lineWidth = 3.4;
  ctx.stroke();
  ctx.restore();
}

/** Bandera ondeando en un mástil: (x, y) = pie del mástil, h = alto del mástil. */
function flag(ctx, x, y, h, t, { cloth = '#151b28', withEmblem = true, w = 0.62 } = {}) {
  ctx.save();
  ctx.strokeStyle = '#0a0d14';
  ctx.lineWidth = Math.max(2, h * 0.025);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h);
  ctx.stroke();
  const fw = h * w;
  const fh = h * 0.38;
  const top = y - h + h * 0.03;
  const wave = (u, ph) => Math.sin(u * 5.2 - t * 3 + ph) * fh * 0.09 * u;
  ctx.beginPath();
  ctx.moveTo(x, top);
  for (let u = 0; u <= 1.001; u += 0.05) ctx.lineTo(x + fw * u, top + wave(u, 0) + u * fh * 0.06);
  for (let u = 1; u >= -0.001; u -= 0.05) ctx.lineTo(x + fw * u, top + fh + wave(u, 0.6) + u * fh * 0.1);
  ctx.closePath();
  ctx.fillStyle = cloth;
  ctx.fill();
  // Brillo del sol en la tela
  const g = ctx.createLinearGradient(x, top, x + fw, top + fh);
  g.addColorStop(0, 'rgba(255, 190, 110, 0.05)');
  g.addColorStop(0.6, 'rgba(255, 190, 110, 0.18)');
  g.addColorStop(1, 'rgba(255, 190, 110, 0.02)');
  ctx.fillStyle = g;
  ctx.fill();
  if (withEmblem) emblem(ctx, x + fw * 0.52, top + fh * 0.5 + wave(0.52, 0.3), fh * 0.62);
  ctx.restore();
}

/** Brasas que suben (para dar vida a la escena). */
function embers(ctx, W, H, t, seed, n = 26, x0 = 0, x1 = 1) {
  const rnd = rand(seed);
  for (let i = 0; i < n; i++) {
    const bx = W * (x0 + rnd() * (x1 - x0));
    const speed = 0.04 + rnd() * 0.08;
    const k = (rnd() + t * speed) % 1;
    const x = bx + Math.sin(t * 0.8 + i) * 10;
    const y = H * (1 - k);
    ctx.fillStyle = `rgba(255, ${Math.round(150 + 80 * rnd())}, 80, ${0.7 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + rnd() * 1.4, 0, TAU);
    ctx.fill();
  }
}

/**
 * Escena de la portada: atardecer, una colina con soldados que suben y la
 * bandera de Trinchera en lo alto. `W`, `H`: tamaño del lienzo (la escena
 * se centra en torno a `cx`, en fracción del ancho). `t`: tiempo (bandera y brasas).
 */
export function drawHeroScene(ctx, W, H, t = 0, cx = 0.56) {
  sunsetSky(ctx, W, H, { glowX: cx - 0.06, glowY: 0.7, warm: 1 });
  clouds(ctx, W, H, 7, { y0: 0.12, y1: 0.6, n: 12 });
  hills(ctx, W, H, 3, 0.66, 0.8, 'rgba(46, 38, 52, 0.9)', 3);
  hills(ctx, W, H, 11, 0.76, 0.9, 'rgba(24, 22, 32, 0.95)', 5);
  // La colina de la bandera
  const hx = W * cx;
  ctx.fillStyle = '#0a0d14';
  ctx.beginPath();
  ctx.moveTo(hx - W * 0.2, H);
  ctx.bezierCurveTo(hx - W * 0.09, H * 0.9, hx - W * 0.05, H * 0.6, hx + W * 0.01, H * 0.58);
  ctx.bezierCurveTo(hx + W * 0.06, H * 0.57, hx + W * 0.12, H * 0.82, hx + W * 0.22, H);
  ctx.closePath();
  ctx.fill();
  // Alambradas y cruces de madera en la ladera
  ctx.strokeStyle = '#0a0d14';
  ctx.lineWidth = 2;
  for (const [u, v, hh] of [[-0.11, 0.86, 0.1], [0.075, 0.74, 0.12], [0.115, 0.83, 0.08]]) {
    const x = hx + W * u;
    const y = H * v;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - H * hh);
    ctx.moveTo(x - H * hh * 0.3, y - H * hh * 0.7);
    ctx.lineTo(x + H * hh * 0.3, y - H * hh * 0.7);
    ctx.stroke();
  }
  // Bandera en la cima
  flag(ctx, hx + W * 0.005, H * 0.585, H * 0.5, t);
  // Soldados subiendo (de menor a mayor: profundidad)
  const s = H * 0.21;
  const troop = [[-0.16, 0.99, 1.0, 0.2], [-0.12, 0.92, 0.92, 0.7], [-0.085, 0.84, 0.86, 0.35], [-0.05, 0.73, 0.8, 0.8], [0.04, 0.66, 0.78, 0.4], [0.08, 0.74, 0.84, 0.15]];
  troop.forEach(([u, v, k, st], i) => soldier(ctx, hx + W * u, H * v, s * k, { step: (st + Math.sin(t * 1.5 + i) * 0.04) % 1, flip: u > 0.02, lean: u > 0.02 ? 0.08 : 0.22 }));
  embers(ctx, W, H, t, 5, 30, cx - 0.25, cx + 0.2);
}

// ------------------------------------------------------------ tarjetas de modo

function vignette(ctx, W, H, strength = 0.65) {
  const g = ctx.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, `rgba(0, 0, 0, ${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Partida rápida: carros de combate avanzando al atardecer, con polvo. */
function artQuick(ctx, W, H) {
  sunsetSky(ctx, W, H, { glowX: 0.42, glowY: 0.58, warm: 1.1 });
  clouds(ctx, W, H, 21, { y0: 0.1, y1: 0.5, n: 10, alpha: 0.28 });
  hills(ctx, W, H, 4, 0.58, 0.68, 'rgba(50, 36, 40, 0.95)', 2);
  // Polvo
  for (let i = 0; i < 6; i++) {
    const g = ctx.createRadialGradient(W * (0.1 + i * 0.16), H * 0.72, 0, W * (0.1 + i * 0.16), H * 0.72, W * 0.16);
    g.addColorStop(0, 'rgba(255, 170, 100, 0.22)');
    g.addColorStop(1, 'rgba(255, 170, 100, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  hills(ctx, W, H, 9, 0.74, 0.8, '#0a0d14', 2);
  tank(ctx, W * 0.6, H * 0.79, W * 0.42, { turret: -0.05 });
  tank(ctx, W * 0.2, H * 0.77, W * 0.22, { color: '#1a1520', turret: -0.03 });
  tank(ctx, W * 0.9, H * 0.76, W * 0.18, { color: '#1d1822' });
  vignette(ctx, W, H, 0.5);
}

/** Contra la IA: sala de mando a oscuras ante una pantalla con el mapa del mundo. */
function artAI(ctx, W, H, worldData) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#081426');
  g.addColorStop(1, '#03070f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Pantalla con el mapa (en azul)
  const sx = W * 0.36;
  const sy = H * 0.06;
  const sw = W * 0.6;
  const sh = H * 0.5;
  if (worldData) {
    const map = document.createElement('canvas');
    map.width = Math.round(sw);
    map.height = Math.round(sh);
    paintMapPreview(map, worldData);
    const m = map.getContext('2d');
    m.globalCompositeOperation = 'color';
    m.fillStyle = '#1f6fd0';
    m.fillRect(0, 0, map.width, map.height);
    m.globalCompositeOperation = 'source-over';
    // Rejilla de la pantalla
    m.strokeStyle = 'rgba(140, 200, 255, 0.18)';
    m.lineWidth = 1;
    for (let x = 0; x < map.width; x += 18) {
      m.beginPath();
      m.moveTo(x, 0);
      m.lineTo(x, map.height);
      m.stroke();
    }
    for (let y = 0; y < map.height; y += 18) {
      m.beginPath();
      m.moveTo(0, y);
      m.lineTo(map.width, y);
      m.stroke();
    }
    ctx.globalAlpha = 0.9;
    ctx.drawImage(map, sx, sy);
    ctx.globalAlpha = 1;
  }
  // Brillo de la pantalla
  const glow = ctx.createRadialGradient(sx + sw / 2, sy + sh / 2, 0, sx + sw / 2, sy + sh / 2, sw * 0.8);
  glow.addColorStop(0, 'rgba(70, 150, 255, 0.35)');
  glow.addColorStop(1, 'rgba(70, 150, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // Mesa de mando y siluetas de pie
  ctx.fillStyle = '#04070d';
  ctx.fillRect(0, H * 0.78, W, H * 0.22);
  const people = [[0.48, 1.0, 0.95], [0.66, 1.0, 1.05], [0.84, 1.0, 0.9], [0.3, 1.0, 0.8]];
  for (const [u, v, k] of people) {
    const x = W * u;
    const y = H * v;
    const s = H * 0.5 * k;
    ctx.fillStyle = '#05080f';
    ctx.beginPath();
    ctx.arc(x, y - s * 0.86, s * 0.11, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.24, y);
    ctx.quadraticCurveTo(x - s * 0.26, y - s * 0.62, x, y - s * 0.72);
    ctx.quadraticCurveTo(x + s * 0.26, y - s * 0.62, x + s * 0.24, y);
    ctx.closePath();
    ctx.fill();
    // Borde iluminado por la pantalla
    ctx.strokeStyle = 'rgba(110, 180, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.86, s * 0.11, -Math.PI * 0.9, -Math.PI * 0.1);
    ctx.stroke();
  }
  vignette(ctx, W, H, 0.55);
}

/** Multijugador: tropas con banderas entre el humo, al anochecer. */
function artOnline(ctx, W, H) {
  sunsetSky(ctx, W, H, { glowX: 0.7, glowY: 0.55, warm: 0.55, top: '#0d1424' });
  clouds(ctx, W, H, 33, { y0: 0.2, y1: 0.7, n: 14, color: '190, 170, 160', alpha: 0.2 });
  hills(ctx, W, H, 6, 0.8, 0.86, '#0a0d14', 2);
  flag(ctx, W * 0.36, H * 0.82, H * 0.66, 0.6, { cloth: '#10141d', withEmblem: false, w: 0.45 });
  flag(ctx, W * 0.75, H * 0.84, H * 0.58, 1.6, { cloth: '#10141d', withEmblem: false, w: 0.45 });
  const s = H * 0.42;
  [[0.12, 0.9, 0.6], [0.24, 0.88, 1], [0.45, 0.86, 0.9], [0.58, 0.9, 1.05], [0.88, 0.9, 0.85]].forEach(([u, k, st], i) =>
    soldier(ctx, W * u, H * 0.86, s * k, { step: st % 1, flip: i % 2 === 1, lean: 0.02, rifle: i !== 3 }));
  vignette(ctx, W, H, 0.5);
}

/**
 * Competitivo: una fortaleza al anochecer con estandartes y, sobre ella, tu
 * insignia de rango con su luz (`badge(ctx, cx, cy, alto)`).
 */
function artRanked(ctx, W, H, badge) {
  sunsetSky(ctx, W, H, { glowX: 0.5, glowY: 0.4, warm: 0.7, top: '#120b24' });
  // Rayos de luz detrás de la insignia
  const cx = W * 0.5;
  const cy = H * 0.36;
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * W * 0.6, Math.sin(a) * W * 0.6);
    g.addColorStop(0, 'rgba(255, 220, 150, 0.32)');
    g.addColorStop(1, 'rgba(255, 220, 150, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, W * 0.6, a - 0.07, a + 0.07);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  clouds(ctx, W, H, 58, { y0: 0.45, y1: 0.7, n: 8, color: '170, 120, 200', alpha: 0.22 });
  hills(ctx, W, H, 12, 0.7, 0.8, 'rgba(36, 24, 48, 0.95)', 2);
  // Fortaleza: muralla almenada con dos torres y una puerta
  const base = H * 0.86;
  const wall = (x, w, h) => {
    ctx.fillRect(x, base - h, w, h);
    const m = Math.max(4, w / 9);
    for (let u = x; u < x + w - 1; u += m * 2) ctx.fillRect(u, base - h - m * 0.9, m, m * 0.9);
  };
  ctx.fillStyle = '#0b0912';
  wall(W * 0.3, W * 0.4, H * 0.16);
  wall(W * 0.24, W * 0.1, H * 0.3);
  wall(W * 0.66, W * 0.1, H * 0.3);
  wall(W * 0.45, W * 0.1, H * 0.22);
  ctx.fillStyle = 'rgba(255, 190, 100, 0.55)';
  ctx.beginPath();
  ctx.arc(W * 0.5, base - H * 0.05, W * 0.02, Math.PI, 0);
  ctx.lineTo(W * 0.52, base);
  ctx.lineTo(W * 0.48, base);
  ctx.closePath();
  ctx.fill();
  hills(ctx, W, H, 31, 0.86, 0.92, '#07060c', 3);
  flag(ctx, W * 0.29, H * 0.56, H * 0.3, 0.4, { cloth: '#3a1d55', withEmblem: false, w: 0.5 });
  flag(ctx, W * 0.71, H * 0.56, H * 0.3, 1.3, { cloth: '#3a1d55', withEmblem: false, w: 0.5 });
  if (badge) {
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, H * 0.42);
    glow.addColorStop(0, 'rgba(255, 228, 160, 0.55)');
    glow.addColorStop(1, 'rgba(255, 228, 160, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    badge(ctx, cx, cy + H * 0.02, H * 0.5);
  }
  vignette(ctx, W, H, 0.45);
}

/** Partida personalizada: mapa de papel con compás, regla y un avión. */
function artCustom(ctx, W, H, europeData) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#2b2418');
  g.addColorStop(1, '#5c4a2e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (europeData) {
    const map = document.createElement('canvas');
    map.width = W;
    map.height = H;
    paintMapPreview(map, europeData);
    const m = map.getContext('2d');
    m.globalCompositeOperation = 'color';
    m.fillStyle = '#a8865a';
    m.fillRect(0, 0, W, H);
    m.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.6;
    ctx.drawImage(map, 0, 0);
    ctx.globalAlpha = 1;
  }
  // Grietas del papel
  const rnd = rand(77);
  ctx.strokeStyle = 'rgba(40, 28, 14, 0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    let x = rnd() * W;
    let y = rnd() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rnd() - 0.5) * 40;
      y += (rnd() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Compás
  ctx.save();
  ctx.translate(W * 0.84, H * 0.22);
  ctx.strokeStyle = '#1b1610';
  ctx.fillStyle = '#1b1610';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-W * 0.07, H * 0.62);
  ctx.moveTo(0, 0);
  ctx.lineTo(W * 0.06, H * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, TAU);
  ctx.fill();
  ctx.restore();
  // Avión
  ctx.save();
  ctx.translate(W * 0.62, H * 0.32);
  ctx.rotate(-0.35);
  ctx.fillStyle = '#1b1610';
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(24, -3);
  ctx.lineTo(28, 0);
  ctx.lineTo(24, 3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(2, -2);
  ctx.lineTo(-6, -20);
  ctx.lineTo(-12, -20);
  ctx.lineTo(-8, 0);
  ctx.lineTo(-12, 20);
  ctx.lineTo(-6, 20);
  ctx.lineTo(2, 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  vignette(ctx, W, H, 0.6);
}

/**
 * Dibuja la ilustración de una tarjeta de modo en `canvas`.
 * `data`: { world, europe } (mapas reales decodificados) para las pantallas y el papel.
 */
export function drawModeArt(kind, canvas, data = {}) {
  const ctx = canvas.getContext('2d');
  // `canvas._escala`: lienzo a la densidad de la pantalla; se dibuja en medidas lógicas
  const k = canvas._escala || 1;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const W = canvas.width / k;
  const H = canvas.height / k;
  if (kind === 'rapida') artQuick(ctx, W, H);
  else if (kind === 'competitivo') artRanked(ctx, W, H, data.badge);
  else if (kind === 'ia') artAI(ctx, W, H, data.world);
  else if (kind === 'online') artOnline(ctx, W, H);
  else artCustom(ctx, W, H, data.europe);
}

/** Miniatura de una novedad: una pequeña escena de la portada. */
export function drawNewsArt(canvas, variant = 0) {
  const ctx = canvas.getContext('2d');
  const k = canvas._escala || 1;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const W = canvas.width / k;
  const H = canvas.height / k;
  if (variant === 1) {
    artQuick(ctx, W, H);
    return;
  }
  if (variant === 2) {
    artOnline(ctx, W, H);
    return;
  }
  drawHeroScene(ctx, W, H, 0.4, 0.55);
  vignette(ctx, W, H, 0.45);
}
