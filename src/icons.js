// Iconos de edificios dibujados con primitivas de canvas. Se usan igual en el
// mapa y en los botones de construcción, así siempre coinciden.
import { FLAG_COLS, FLAG_H, FLAG_INDEX, FLAG_SPRITE, FLAG_W } from './banderas.js';

const TAU = Math.PI * 2;

/**
 * Dibuja el icono de `kind` centrado en (cx, cy) con tamaño `size` px.
 * `disc` (opcional) pinta un círculo de fondo; `ring` su contorno.
 */
/**
 * Triángulo equilátero con la punta arriba y las esquinas redondeadas,
 * centrado en (0, 0) con «radio» `R` (del centro a cada vértice).
 */
function roundedTriangle(ctx, R, r) {
  const pts = [0, 1, 2].map((i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    return [Math.cos(a) * R, Math.sin(a) * R + R * 0.18];
  });
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[2], pts[0]);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < 3; i++) {
    const p = pts[i];
    const n = pts[(i + 1) % 3];
    ctx.arcTo(p[0], p[1], n[0], n[1], r);
  }
  ctx.closePath();
}

export function drawBuildingIcon(ctx, kind, cx, cy, size, { glyph = '#fff', disc = null, ring = null } = {}) {
  ctx.save();
  ctx.translate(cx, cy);
  const k = size / 20;
  ctx.scale(k, k);
  // Antimisiles y silo van en un triángulo (se distinguen de un vistazo)
  const tri = kind === 'sam' || kind === 'silo';
  if (disc) {
    ctx.beginPath();
    if (tri) roundedTriangle(ctx, 12.5, 2.4);
    else ctx.arc(0, 0, 10, 0, TAU);
    ctx.fillStyle = disc;
    ctx.fill();
    if (ring) {
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ring;
      ctx.stroke();
    }
    if (tri) {
      // El dibujo, algo más pequeño y bajado al centro del triángulo
      ctx.translate(0, 2.6);
      ctx.scale(0.72, 0.72);
    }
  }
  ctx.fillStyle = glyph;
  ctx.strokeStyle = glyph;
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'city') {
    // Casa con tejado a dos aguas y una torre detrás
    ctx.fillRect(1.5, -6.5, 4.5, 12);
    ctx.beginPath();
    ctx.moveTo(-6.5, 5.5);
    ctx.lineTo(-6.5, -0.5);
    ctx.lineTo(-2.5, -4);
    ctx.lineTo(1.5, -0.5);
    ctx.lineTo(1.5, 5.5);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'port') {
    // Ancla
    ctx.beginPath();
    ctx.arc(0, -5.2, 1.8, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -3.4);
    ctx.lineTo(0, 6.2);
    ctx.moveTo(-3.6, -1.2);
    ctx.lineTo(3.6, -1.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0.8, 5.6, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
  } else if (kind === 'warship') {
    // Casco con puente y cañón
    ctx.beginPath();
    ctx.moveTo(-8, 1.5);
    ctx.lineTo(8, 1.5);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-3.5, -3, 5, 4.5);
    ctx.fillRect(-1.5, -6.5, 1.6, 3.5);
    ctx.beginPath();
    ctx.moveTo(1.5, -1.2);
    ctx.lineTo(7, -3.2);
    ctx.stroke();
  } else if (kind === 'factory') {
    // Nave con tejado en dientes de sierra y chimenea
    ctx.beginPath();
    ctx.moveTo(-7.5, 6.5);
    ctx.lineTo(-7.5, -1);
    ctx.lineTo(-4.5, -3.5);
    ctx.lineTo(-4.5, -1);
    ctx.lineTo(-1.5, -3.5);
    ctx.lineTo(-1.5, -1);
    ctx.lineTo(1.5, -3.5);
    ctx.lineTo(1.5, 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(3, -7, 3, 13.5);
  } else if (kind === 'silo') {
    // Cohete vertical dentro de un foso
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.quadraticCurveTo(3, -5, 3, -1);
    ctx.lineTo(3, 4);
    ctx.lineTo(-3, 4);
    ctx.lineTo(-3, -1);
    ctx.quadraticCurveTo(-3, -5, 0, -8);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-7, 5, 14, 2.2);
  } else if (kind === 'sam') {
    // Lanzador con dos interceptores inclinados
    ctx.fillRect(-7, 3.5, 14, 3);
    ctx.save();
    ctx.translate(-1, 3);
    ctx.rotate(-0.75);
    ctx.fillRect(-1.2, -9, 2.4, 9);
    ctx.restore();
    ctx.save();
    ctx.translate(3, 3);
    ctx.rotate(-0.75);
    ctx.fillRect(-1.2, -9, 2.4, 9);
    ctx.restore();
  } else if (kind === 'missile') {
    // Misil en diagonal con aletas
    ctx.save();
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, -8.5);
    ctx.quadraticCurveTo(2.4, -5.5, 2.4, -2);
    ctx.lineTo(2.4, 5);
    ctx.lineTo(-2.4, 5);
    ctx.lineTo(-2.4, -2);
    ctx.quadraticCurveTo(-2.4, -5.5, 0, -8.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-2.4, 2);
    ctx.lineTo(-5, 7.5);
    ctx.lineTo(-2.4, 5.5);
    ctx.moveTo(2.4, 2);
    ctx.lineTo(5, 7.5);
    ctx.lineTo(2.4, 5.5);
    ctx.fill();
    ctx.restore();
  } else if (kind === 'fort') {
    // Torre almenada
    ctx.beginPath();
    ctx.moveTo(-6, 6.5);
    ctx.lineTo(-6, -6.5);
    ctx.lineTo(-3.6, -6.5);
    ctx.lineTo(-3.6, -4);
    ctx.lineTo(-1.2, -4);
    ctx.lineTo(-1.2, -6.5);
    ctx.lineTo(1.2, -6.5);
    ctx.lineTo(1.2, -4);
    ctx.lineTo(3.6, -4);
    ctx.lineTo(3.6, -6.5);
    ctx.lineTo(6, -6.5);
    ctx.lineTo(6, 6.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------- emblemas

const EMBLEM_SHAPES = {
  circulo(ctx) {
    ctx.arc(0, 0, 9.5, 0, TAU);
  },
  insignia(ctx) {
    ctx.moveTo(0, -10);
    ctx.lineTo(8.8, -5.5);
    ctx.lineTo(8.8, 3.5);
    ctx.lineTo(0, 10);
    ctx.lineTo(-8.8, 3.5);
    ctx.lineTo(-8.8, -5.5);
    ctx.closePath();
  },
  sello(ctx) {
    // Círculo con el borde ondulado, como un sello de lacre
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * TAU;
      const r = 9.2 + Math.sin(a * 12) * 0.7;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
  },
  escudo(ctx) {
    ctx.moveTo(-8.5, -9);
    ctx.lineTo(8.5, -9);
    ctx.lineTo(8.5, 0);
    ctx.quadraticCurveTo(8.5, 7, 0, 10);
    ctx.quadraticCurveTo(-8.5, 7, -8.5, 0);
    ctx.closePath();
  },
  rombo(ctx) {
    ctx.moveTo(0, -10);
    ctx.lineTo(9.5, 0);
    ctx.lineTo(0, 10);
    ctx.lineTo(-9.5, 0);
    ctx.closePath();
  },
  hexagono(ctx) {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 9.8, Math.sin(a) * 9.8);
    }
    ctx.closePath();
  },
  estandarte(ctx) {
    ctx.moveTo(-8, -10);
    ctx.lineTo(8, -10);
    ctx.lineTo(8, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-8, 10);
    ctx.closePath();
  },
  octogono(ctx) {
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i + Math.PI / 8;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 10, Math.sin(a) * 10);
    }
    ctx.closePath();
  },
  cruzado(ctx) {
    ctx.moveTo(-3.5, -10);
    ctx.lineTo(3.5, -10);
    ctx.lineTo(3.5, -3.5);
    ctx.lineTo(10, -3.5);
    ctx.lineTo(10, 3.5);
    ctx.lineTo(3.5, 3.5);
    ctx.lineTo(3.5, 10);
    ctx.lineTo(-3.5, 10);
    ctx.lineTo(-3.5, 3.5);
    ctx.lineTo(-10, 3.5);
    ctx.lineTo(-10, -3.5);
    ctx.lineTo(-3.5, -3.5);
    ctx.closePath();
  },
};

// --------------------------------------------- iconos de edificios (mapa)
// Pictogramas lisos de un solo color (blanco), sin detalles: un bloque de
// edificios, una fábrica, un ancla, una torre, un misil, un lanzador y un
// barco. En el mapa llevan contorno oscuro y el color del dueño (peana bajo
// ciudad, puerto y fábrica; fondo de la forma en fortaleza, silo y antimisiles).

const GLYPH_DARK = '#141a22';

/** Rectángulo girado `a` radianes alrededor de su centro (cx, cy), como polígono. */
function rotRect(p, cx, cy, w, h, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) p.lineTo(pts[i][0], pts[i][1]);
  p.closePath();
}

function polyTo(p, pts) {
  p.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
  p.closePath();
}

/**
 * Cada pictograma: { fill: Path2D, rule, stroke?: Path2D, lw? } en una caja de
 * 20 × 20 centrada en 0. `rule` 'evenodd' hace huecos (ventanas, puertas).
 */
let GLYPHS = null;
function glyphs() {
  if (GLYPHS) return GLYPHS;
  const city = new Path2D();
  city.rect(-0.6, -8, 7.6, 15); // bloque alto
  city.rect(-8, -2.4, 6.8, 9.4); // bloque bajo
  for (const [x, y] of [[1, -6], [4, -6], [1, -2.6], [4, -2.6], [1, 0.8], [4, 0.8], [-6.6, -0.6], [-3.6, -0.6]]) city.rect(x, y, 2, 2);
  city.rect(-5.2, 3.2, 2.2, 3.8); // puerta

  const factory = new Path2D();
  polyTo(factory, [-8, 7, -8, -2, -4.4, -5, -4.4, -2, -0.8, -5, -0.8, -2, 2.8, -2, 2.8, -8, 5.8, -8, 5.8, 7]);
  for (const x of [-6.4, -2.8]) factory.rect(x, 1, 2, 2);
  factory.rect(3.3, 1, 2, 2);
  factory.moveTo(8.2, -9.4);
  factory.arc(6.6, -9.4, 1.6, 0, TAU);

  const port = new Path2D();
  polyTo(port, [5.8, 1.6, 7.9, 3.6, 4.6, 4]);
  polyTo(port, [-5.8, 1.6, -7.9, 3.6, -4.6, 4]);
  const anchor = new Path2D();
  anchor.moveTo(1.8, -6.2);
  anchor.arc(0, -6.2, 1.8, 0, TAU);
  anchor.moveTo(0, -4.4);
  anchor.lineTo(0, 6.6);
  anchor.moveTo(-3.6, -1.6);
  anchor.lineTo(3.6, -1.6);
  anchor.moveTo(5.9, 1.6);
  anchor.arc(0, 0.4, 6.2, 0.06 * Math.PI, 0.94 * Math.PI);

  const fort = new Path2D();
  polyTo(fort, [-6.4, 7, -6.4, -6, -4, -6, -4, -3.8, -1.2, -3.8, -1.2, -6, 1.2, -6, 1.2, -3.8, 4, -3.8, 4, -6, 6.4, -6, 6.4, 7]);
  fort.moveTo(-2.2, 7);
  fort.lineTo(-2.2, 3);
  fort.arc(0, 3, 2.2, Math.PI, 0);
  fort.lineTo(2.2, 7);
  fort.closePath();
  fort.rect(-0.9, -1.8, 1.8, 2.4);

  const silo = new Path2D();
  polyTo(silo, [0, -9, 2.2, -4, 2.2, 3.4, 4.6, 6.8, 4.6, 7.6, 2.2, 6.4, -2.2, 6.4, -4.6, 7.6, -4.6, 6.8, -2.2, 3.4, -2.2, -4]);

  const sam = new Path2D();
  sam.rect(-7.6, 3, 15.2, 2.6);
  for (const x of [-4.8, 0, 4.8]) {
    sam.moveTo(x + 1.4, 6.4);
    sam.arc(x, 6.4, 1.4, 0, TAU);
  }
  rotRect(sam, 0.2, 0.2, 10.5, 3.8, -0.6); // tubos del lanzador
  for (const off of [-0.95, 0.95]) {
    // puntas de los dos misiles, al final de los tubos
    const a = -0.6;
    const bx = 0.2 + Math.cos(a) * 5.25 - Math.sin(a) * off;
    const by = 0.2 + Math.sin(a) * 5.25 + Math.cos(a) * off;
    const tx = bx + Math.cos(a) * 2.4;
    const ty = by + Math.sin(a) * 2.4;
    const nx = -Math.sin(a) * 0.85;
    const ny = Math.cos(a) * 0.85;
    polyTo(sam, [bx + nx, by + ny, tx, ty, bx - nx, by - ny]);
  }
  sam.rect(-7, -1.6, 1.2, 4.6); // mástil del radar
  sam.moveTo(-3.6, -2.4);
  sam.ellipse(-6.4, -2.4, 2.8, 1.4, -0.4, 0, Math.PI);

  const warship = new Path2D();
  polyTo(warship, [-9.2, 1, 9.2, 1, 6.6, 5.4, -6.6, 5.4]);
  warship.rect(-3.8, -3.2, 5.4, 4.4);
  warship.rect(-1.9, -6.8, 1.4, 3.8);
  rotRect(warship, 4.6, -1.9, 6.2, 1.3, -0.33);

  const missile = new Path2D();
  const m = new DOMMatrix().rotate(45);
  missile.addPath(silo, m);
  // Bomba H: el misil más grande, con un anillo (la explosión mayor)
  const hbomb = new Path2D();
  hbomb.addPath(silo, new DOMMatrix().rotate(45).scale(1.1));
  const hring = new Path2D();
  hring.arc(0, 0, 8.6, 0, Math.PI * 2);
  // MIRV: tres cabezas pequeñas que se separan
  const mirv = new Path2D();
  for (const [x, y] of [[-4.5, 3], [0, -1.5], [4.5, 3]]) mirv.addPath(silo, new DOMMatrix().translate(x, y).rotate(45).scale(0.55));

  GLYPHS = {
    city: { fill: city, rule: 'evenodd' },
    factory: { fill: factory, rule: 'evenodd' },
    port: { fill: port, rule: 'nonzero', stroke: anchor, lw: 2.2 },
    fort: { fill: fort, rule: 'evenodd' },
    silo: { fill: silo, rule: 'nonzero' },
    sam: { fill: sam, rule: 'nonzero' },
    warship: { fill: warship, rule: 'nonzero' },
    missile: { fill: missile, rule: 'nonzero' },
    hbomb: { fill: hbomb, rule: 'nonzero', stroke: hring, lw: 1.4 },
    mirv: { fill: mirv, rule: 'nonzero' },
  };
  return GLYPHS;
}

/** Pinta un pictograma en `color`; con `outline`, antes un contorno oscuro (se lee sobre cualquier fondo). */
function paintGlyph(ctx, g, color, outline) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (outline) {
    ctx.strokeStyle = GLYPH_DARK;
    ctx.lineWidth = 2.4;
    ctx.stroke(g.fill);
    if (g.stroke) {
      ctx.lineWidth = g.lw + 2.4;
      ctx.stroke(g.stroke);
    }
  }
  ctx.fillStyle = color;
  ctx.fill(g.fill, g.rule);
  if (g.stroke) {
    ctx.strokeStyle = color;
    ctx.lineWidth = g.lw;
    ctx.stroke(g.stroke);
  }
}

/**
 * Icono de edificio. Sin `ring` (panel de construcción): solo el pictograma
 * blanco. Con `ring` (el color del dueño, en el mapa): pictograma claro sobre
 * un disco oscuro semitransparente (triángulo para silo y antimisiles) con un
 * anillo fino de ese color. `outline`: tuyo (filo blanco por fuera).
 */
export function drawBuildingReal(ctx, kind, cx, cy, size, { ring = null, outline = false, color = '#ffffff' } = {}) {
  const g = glyphs()[kind];
  if (!g) return;
  ctx.save();
  ctx.translate(cx, cy);
  const k = size / 20;
  ctx.scale(k, k);
  if (!ring) {
    ctx.scale(1.05, 1.05);
    paintGlyph(ctx, g, color, false);
    ctx.restore();
    return;
  }
  const tri = kind === 'sam' || kind === 'silo';
  ctx.beginPath();
  if (tri) roundedTriangle(ctx, 12.5, 2.4);
  else ctx.arc(0, 0, 10, 0, TAU);
  ctx.fillStyle = 'rgba(30, 34, 42, 0.62)';
  ctx.fill();
  ctx.lineJoin = 'round';
  if (outline) {
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = ring;
  ctx.stroke();
  if (tri) {
    ctx.translate(0, 2.4);
    ctx.scale(0.62, 0.62);
  } else ctx.scale(0.7, 0.7);
  paintGlyph(ctx, g, color === '#ffffff' ? '#eef2f7' : color, false);
  ctx.restore();
}

function star(ctx, r1, r2, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = (Math.PI / points) * i - Math.PI / 2;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

/** Símbolos en una caja de unos 12×12 centrada en el origen. */
const EMBLEM_SYMBOLS = {
  estrella(ctx) {
    star(ctx, 6.5, 2.7, 5);
  },
  aguila(ctx) {
    // Águila de frente con las alas abiertas
    ctx.beginPath();
    ctx.moveTo(0, -4.5);
    ctx.quadraticCurveTo(-3.5, -6.5, -7.5, -5);
    ctx.quadraticCurveTo(-6.5, -2.5, -4.5, -1.5);
    ctx.quadraticCurveTo(-7, -0.8, -7.5, 1.2);
    ctx.quadraticCurveTo(-4.5, 1, -2.4, 0.8);
    ctx.lineTo(-2.6, 4.2);
    ctx.lineTo(-1, 3.2);
    ctx.lineTo(0, 6.8);
    ctx.lineTo(1, 3.2);
    ctx.lineTo(2.6, 4.2);
    ctx.lineTo(2.4, 0.8);
    ctx.quadraticCurveTo(4.5, 1, 7.5, 1.2);
    ctx.quadraticCurveTo(7, -0.8, 4.5, -1.5);
    ctx.quadraticCurveTo(6.5, -2.5, 7.5, -5);
    ctx.quadraticCurveTo(3.5, -6.5, 0, -4.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -5.6, 1.6, 0, TAU);
    ctx.fill();
  },
  castillo(ctx) {
    ctx.beginPath();
    ctx.moveTo(-6.5, 6);
    ctx.lineTo(-6.5, -4.5);
    for (const x of [-6.5, -3.5, -0.5, 2.5]) {
      ctx.lineTo(x, -6.5);
      ctx.lineTo(x + 1.5, -6.5);
      ctx.lineTo(x + 1.5, -4.5);
      ctx.lineTo(x + 3, -4.5);
    }
    ctx.lineTo(6.5, -6.5);
    ctx.lineTo(6.5, 6);
    ctx.lineTo(1.8, 6);
    ctx.lineTo(1.8, 2);
    ctx.quadraticCurveTo(0, 0, -1.8, 2);
    ctx.lineTo(-1.8, 6);
    ctx.closePath();
    ctx.fill();
  },
  copo(ctx) {
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.moveTo(0, 0);
      ctx.lineTo(c * 7, s * 7);
      // Ramitas
      for (const d of [3.5, 5.3]) {
        const bx = c * d;
        const by = s * d;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a + 0.8) * 1.8, by + Math.sin(a + 0.8) * 1.8);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a - 0.8) * 1.8, by + Math.sin(a - 0.8) * 1.8);
      }
    }
    ctx.stroke();
  },
  ojo(ctx, bg) {
    ctx.beginPath();
    ctx.moveTo(-7.5, 0);
    ctx.quadraticCurveTo(0, -7, 7.5, 0);
    ctx.quadraticCurveTo(0, 7, -7.5, 0);
    ctx.closePath();
    ctx.fill();
    const prev = ctx.fillStyle;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, 2.8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = prev;
    ctx.beginPath();
    ctx.arc(0, 0, 1.3, 0, TAU);
    ctx.fill();
  },
  lis(ctx) {
    // Flor de lis
    ctx.beginPath();
    ctx.moveTo(0, -7.5);
    ctx.quadraticCurveTo(2.6, -4, 1, 0.5);
    ctx.lineTo(-1, 0.5);
    ctx.quadraticCurveTo(-2.6, -4, 0, -7.5);
    ctx.closePath();
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 1, 0.5);
      ctx.quadraticCurveTo(s * 2.5, -4.5, s * 6, -3);
      ctx.quadraticCurveTo(s * 7, -0.5, s * 4.5, 0.2);
      ctx.quadraticCurveTo(s * 5, 2.5, s * 2.2, 2.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(-4.5, 1.6, 9, 1.6);
    ctx.beginPath();
    ctx.moveTo(-1.2, 3.2);
    ctx.lineTo(1.2, 3.2);
    ctx.lineTo(0.6, 7);
    ctx.lineTo(-0.6, 7);
    ctx.closePath();
    ctx.fill();
  },
  brujula(ctx, bg) {
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 6.8, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(1.8, 0);
    ctx.lineTo(0, 6);
    ctx.lineTo(-1.8, 0);
    ctx.closePath();
    ctx.fill();
    const prev = ctx.fillStyle;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(1.8, 0);
    ctx.lineTo(-1.8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = prev;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(0, -1.2);
    ctx.lineTo(6, 0);
    ctx.lineTo(0, 1.2);
    ctx.closePath();
    ctx.fill();
  },
  engranaje(ctx, bg) {
    ctx.beginPath();
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU;
      const r = i % 2 ? 5.2 : 7;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    const prev = ctx.fillStyle;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, 2.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = prev;
  },
  montana(ctx) {
    ctx.beginPath();
    ctx.moveTo(-7, 5);
    ctx.lineTo(-2, -4);
    ctx.lineTo(1, 1);
    ctx.lineTo(3, -2);
    ctx.lineTo(7, 5);
    ctx.closePath();
    ctx.fill();
  },
  ola(ctx) {
    ctx.lineWidth = 1.8;
    for (const y of [-2.5, 2.5]) {
      ctx.beginPath();
      ctx.moveTo(-7, y);
      ctx.quadraticCurveTo(-3.5, y - 3.5, 0, y);
      ctx.quadraticCurveTo(3.5, y + 3.5, 7, y);
      ctx.stroke();
    }
  },
  arbol(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(6, 3);
    ctx.lineTo(-6, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-1.2, 3, 2.4, 4);
  },
  corona(ctx) {
    ctx.beginPath();
    ctx.moveTo(-7, 5);
    ctx.lineTo(-7, -4);
    ctx.lineTo(-3.5, 0);
    ctx.lineTo(0, -6);
    ctx.lineTo(3.5, 0);
    ctx.lineTo(7, -4);
    ctx.lineTo(7, 5);
    ctx.closePath();
    ctx.fill();
  },
  torre(ctx) {
    ctx.beginPath();
    ctx.moveTo(-5, 7);
    ctx.lineTo(-5, -6);
    ctx.lineTo(-3, -6);
    ctx.lineTo(-3, -4);
    ctx.lineTo(-1, -4);
    ctx.lineTo(-1, -6);
    ctx.lineTo(1, -6);
    ctx.lineTo(1, -4);
    ctx.lineTo(3, -4);
    ctx.lineTo(3, -6);
    ctx.lineTo(5, -6);
    ctx.lineTo(5, 7);
    ctx.closePath();
    ctx.fill();
  },
  ancla(ctx) {
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, -5, 1.6, 0, TAU);
    ctx.moveTo(0, -3.4);
    ctx.lineTo(0, 6.5);
    ctx.moveTo(-3.5, -1);
    ctx.lineTo(3.5, -1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 1, 5.5, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
  },
  espadas(ctx) {
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-6, 6);
    ctx.lineTo(6, -6);
    ctx.moveTo(6, 6);
    ctx.lineTo(-6, -6);
    ctx.moveTo(-5.5, 2);
    ctx.lineTo(-2, 5.5);
    ctx.moveTo(5.5, 2);
    ctx.lineTo(2, 5.5);
    ctx.stroke();
  },
  luna(ctx, bg) {
    ctx.beginPath();
    ctx.arc(0, 0, 6.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(3, -2, 5.5, 0, TAU);
    ctx.fill();
  },
  sol(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0, 3.6, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      ctx.moveTo(Math.cos(a) * 5.2, Math.sin(a) * 5.2);
      ctx.lineTo(Math.cos(a) * 7.5, Math.sin(a) * 7.5);
    }
    ctx.stroke();
  },
  rayo(ctx) {
    ctx.beginPath();
    ctx.moveTo(1.5, -7.5);
    ctx.lineTo(-4.5, 1);
    ctx.lineTo(-0.5, 1);
    ctx.lineTo(-2, 7.5);
    ctx.lineTo(4.5, -1.5);
    ctx.lineTo(0.5, -1.5);
    ctx.closePath();
    ctx.fill();
  },
  cruz(ctx) {
    ctx.fillRect(-1.6, -7, 3.2, 14);
    ctx.fillRect(-6, -2.8, 12, 3.2);
  },
  diana(ctx, bg) {
    for (const [r, c] of [[7, null], [4.8, bg], [2.6, null]]) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      if (c) {
        const prev = ctx.fillStyle;
        ctx.fillStyle = c;
        ctx.fill();
        ctx.fillStyle = prev;
      } else ctx.fill();
    }
  },
  corazon(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, 6.5);
    ctx.bezierCurveTo(-8, 1, -6.5, -7, 0, -3);
    ctx.bezierCurveTo(6.5, -7, 8, 1, 0, 6.5);
    ctx.closePath();
    ctx.fill();
  },
  trebol(ctx) {
    for (const [x, y] of [[0, -3.6], [-3.6, 0.6], [3.6, 0.6]]) {
      ctx.beginPath();
      ctx.arc(x, y, 3.1, 0, TAU);
      ctx.fill();
    }
    ctx.fillRect(-0.8, 1, 1.6, 6);
  },
  flecha(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -7.5);
    ctx.lineTo(5.5, -1.5);
    ctx.lineTo(2, -1.5);
    ctx.lineTo(2, 7);
    ctx.lineTo(-2, 7);
    ctx.lineTo(-2, -1.5);
    ctx.lineTo(-5.5, -1.5);
    ctx.closePath();
    ctx.fill();
  },
  casco(ctx) {
    ctx.beginPath();
    ctx.moveTo(-7.5, 3);
    ctx.quadraticCurveTo(-7, -6, 0, -6.5);
    ctx.quadraticCurveTo(7, -6, 7.5, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-8.5, 3, 17, 2.2);
  },
  avion(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -7.5);
    ctx.quadraticCurveTo(1.4, -6, 1.3, -2);
    ctx.lineTo(7.5, 1.5);
    ctx.lineTo(7.5, 3);
    ctx.lineTo(1.2, 1.2);
    ctx.lineTo(1, 5);
    ctx.lineTo(3, 6.8);
    ctx.lineTo(3, 7.6);
    ctx.lineTo(0, 6.8);
    ctx.lineTo(-3, 7.6);
    ctx.lineTo(-3, 6.8);
    ctx.lineTo(-1, 5);
    ctx.lineTo(-1.2, 1.2);
    ctx.lineTo(-7.5, 3);
    ctx.lineTo(-7.5, 1.5);
    ctx.lineTo(-1.3, -2);
    ctx.quadraticCurveTo(-1.4, -6, 0, -7.5);
    ctx.closePath();
    ctx.fill();
  },
  calavera(ctx, bg) {
    ctx.beginPath();
    ctx.arc(0, -1.5, 5.6, 0, TAU);
    ctx.fill();
    ctx.fillRect(-3.2, 2.5, 6.4, 4.2);
    const prev = ctx.fillStyle;
    ctx.fillStyle = bg;
    for (const x of [-2.2, 2.2]) {
      ctx.beginPath();
      ctx.arc(x, -1.6, 1.5, 0, TAU);
      ctx.fill();
    }
    ctx.fillRect(-0.4, 3.2, 0.8, 3.5);
    ctx.fillRect(-2.3, 3.2, 0.8, 3.5);
    ctx.fillRect(1.5, 3.2, 0.8, 3.5);
    ctx.fillStyle = prev;
  },
  llama(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -7.5);
    ctx.bezierCurveTo(5, -2, 6, 2, 4, 5);
    ctx.quadraticCurveTo(0, 8.5, -4, 5);
    ctx.bezierCurveTo(-6, 2, -3, -1, -1.5, -2.5);
    ctx.quadraticCurveTo(-0.5, 0, 1, -0.5);
    ctx.quadraticCurveTo(1.5, -4, 0, -7.5);
    ctx.closePath();
    ctx.fill();
  },
};

/**
 * Marco alrededor del emblema (perfil). `kind`: ninguno, bronce, plata, oro o
 * laurel. Se dibuja centrado en (cx, cy) para un emblema de tamaño `size`.
 */
export function drawFrame(ctx, kind, cx, cy, size) {
  if (!kind || kind === 'ninguno') return;
  const r = size * 0.56;
  ctx.save();
  ctx.translate(cx, cy);
  if (kind === 'laurel') {
    ctx.fillStyle = '#7fc46a';
    ctx.strokeStyle = 'rgba(0, 40, 0, 0.6)';
    ctx.lineWidth = Math.max(1, size * 0.012);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const a = Math.PI / 2 + side * (0.35 + i * 0.32);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + (side > 0 ? -Math.PI / 2.6 : Math.PI / 2.6) + Math.PI / 2);
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.035, size * 0.085, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
    return;
  }
  if (kind === 'llamas') {
    // Lenguas de fuego alrededor
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const len = size * (0.12 + (i % 2) * 0.07);
      ctx.save();
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, -r, 0, -r - len);
      g.addColorStop(0, '#ff4a1c');
      g.addColorStop(0.6, '#ffb02e');
      g.addColorStop(1, 'rgba(255, 240, 160, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-size * 0.07, -r + size * 0.02);
      ctx.quadraticCurveTo(-size * 0.02, -r - len * 0.6, 0, -r - len);
      ctx.quadraticCurveTo(size * 0.02, -r - len * 0.6, size * 0.07, -r + size * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.lineWidth = size * 0.05;
    ctx.strokeStyle = '#ff7a1c';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const gems = { esmeralda: ['#7dffb2', '#0c7a45'], rubi: ['#ff8aa1', '#9c0f2e'], zafiro: ['#8ec5ff', '#1641a8'], hielo: ['#ffffff', '#7fd3ff'], diamante: ['#ffffff', '#9fb8d6'], corona: ['#fff0a8', '#b8860b'] }[kind];
  if (gems) {
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, gems[0]);
    g.addColorStop(0.5, gems[1]);
    g.addColorStop(1, gems[0]);
    ctx.lineWidth = size * (kind === 'diamante' ? 0.09 : 0.075);
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    // Gemas talladas alrededor (o cristales de hielo)
    const n = kind === 'diamante' ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2;
      ctx.save();
      ctx.translate(Math.cos(a) * r, Math.sin(a) * r);
      ctx.rotate(a);
      const s = size * (kind === 'diamante' ? 0.05 : 0.065);
      ctx.beginPath();
      if (kind === 'hielo') {
        ctx.moveTo(0, -s * 1.8);
        ctx.lineTo(s * 0.6, 0);
        ctx.lineTo(0, s * 1.8);
        ctx.lineTo(-s * 0.6, 0);
      } else {
        ctx.moveTo(0, -s);
        ctx.lineTo(s, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s, 0);
      }
      ctx.closePath();
      ctx.fillStyle = gems[0];
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, size * 0.008);
      ctx.strokeStyle = gems[1];
      ctx.stroke();
      ctx.restore();
    }
    if (kind === 'corona') {
      // Corona dorada encima
      ctx.save();
      ctx.translate(0, -r - size * 0.06);
      const w = size * 0.32;
      const h = size * 0.17;
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.lineTo(-w / 2, -h / 2);
      ctx.lineTo(-w / 4, 0);
      ctx.lineTo(0, -h * 0.8);
      ctx.lineTo(w / 4, 0);
      ctx.lineTo(w / 2, -h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.closePath();
      ctx.fillStyle = '#ffd34d';
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, size * 0.01);
      ctx.strokeStyle = '#8a5d08';
      ctx.stroke();
      ctx.restore();
    }
    if (kind === 'diamante') {
      // Destellos
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      for (const a of [-2.3, -0.4, 1.9]) {
        ctx.save();
        ctx.translate(Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12);
        ctx.scale(size / 140, size / 140);
        star(ctx, 7, 1.6, 4);
        ctx.restore();
      }
    }
    ctx.restore();
    return;
  }
  const tones = { bronce: ['#f0b37a', '#8a4f22'], plata: ['#f4f7fb', '#7d8794'], oro: ['#fff0a8', '#b8860b'] }[kind];
  if (!tones) {
    ctx.restore();
    return;
  }
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, tones[0]);
  g.addColorStop(0.5, tones[1]);
  g.addColorStop(1, tones[0]);
  ctx.lineWidth = size * 0.07;
  ctx.strokeStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
  // Remaches
  ctx.fillStyle = tones[0];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r, Math.sin(a) * r, size * 0.02, 0, TAU);
    ctx.fill();
  }
  if (kind === 'oro') {
    // Estrellitas arriba
    ctx.fillStyle = '#ffe680';
    for (const dx of [-0.22, 0, 0.22]) {
      ctx.save();
      ctx.translate(dx * size, -r - size * (dx ? 0.02 : 0.07));
      ctx.scale(size / 120, size / 120);
      star(ctx, 6, 2.6, 5);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Emblema = forma de fondo + símbolo. `e` = { shape, symbol, bg, fg }. */
export function drawEmblem(ctx, e, cx, cy, size) {
  if (!e) return;
  ctx.save();
  ctx.translate(cx, cy);
  const k = size / 20;
  ctx.scale(k, k);
  ctx.beginPath();
  (EMBLEM_SHAPES[e.shape] || EMBLEM_SHAPES.escudo)(ctx);
  // Bandera de un país como emblema: rellena la forma (si ya está cargada)
  const flagImg = e.flag && hasFlag(e.flag) ? flagSprite() : null;
  if (flagImg) {
    ctx.save();
    ctx.clip();
    const i = FLAG_INDEX[e.flag];
    const h = 22;
    const w = (h * FLAG_W) / FLAG_H;
    ctx.drawImage(flagImg, (i % FLAG_COLS) * FLAG_W, Math.floor(i / FLAG_COLS) * FLAG_H, FLAG_W, FLAG_H, -w / 2, -h / 2, w, h);
    // Brillo suave para que parezca un escudo y no un recorte
    const g = ctx.createLinearGradient(-10, -10, 10, 10);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
    g.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(-11, -11, 22, 22);
    ctx.restore();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.fillStyle = e.bg;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();
  ctx.fillStyle = e.fg;
  ctx.strokeStyle = e.fg;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  (EMBLEM_SYMBOLS[e.symbol] || EMBLEM_SYMBOLS.estrella)(ctx, e.bg);
  ctx.restore();
}

/** Emblema estable para quien no ha elegido uno (los bots): sale de su nombre. */
export function emblemFor(player) {
  if (player.emblem) return player.emblem;
  let h = 2166136261;
  for (let i = 0; i < player.name.length; i++) h = Math.imul(h ^ player.name.charCodeAt(i), 16777619);
  h >>>= 0;
  const shapes = ['escudo', 'circulo', 'rombo', 'hexagono', 'estandarte'];
  const symbols = Object.keys(EMBLEM_SYMBOLS);
  const [r, g, b] = player.color;
  const light = r * 0.3 + g * 0.59 + b * 0.11 > 150;
  player.emblem = {
    shape: shapes[h % shapes.length],
    symbol: symbols[(h >>> 4) % symbols.length],
    bg: `rgb(${r},${g},${b})`,
    fg: light ? '#1d2230' : '#ffffff',
  };
  return player.emblem;
}

// ------------------------------------------------------------- patrones

/**
 * Patrones del territorio: devuelven true en las casillas que se pintan con
 * el tono alternativo. Solo afectan al dibujo, nunca a la simulación.
 */
export const PATTERN_FNS = {
  liso: null,
  rayas: (x, y) => (x + y) % 6 < 2,
  puntos: (x, y) => x % 4 === 1 && y % 4 === 1,
  rejilla: (x, y) => x % 6 === 0 || y % 6 === 0,
  cuadros: (x, y) => ((x >> 2) + (y >> 2)) % 2 === 0,
  ondas: (x, y) => (y + Math.round(1.6 * Math.sin(x / 2.2))) % 6 < 2,
  diamantes: (x, y) => Math.abs((x % 8) - 4) + Math.abs((y % 8) - 4) < 2,
  espiga: (x, y) => ((x % 8 < 4 ? x + y : x - y) % 8 + 8) % 8 < 2,
  mosaico: (x, y) => ((x * 7 + y * 13) ^ (x * y)) % 5 === 0,
  estrellas: (x, y) => {
    const cx = x % 10;
    const cy = y % 10;
    const ox = (Math.floor(y / 10) % 2) * 5;
    const dx = Math.abs(((cx + ox) % 10) - 5);
    const dy = Math.abs(cy - 5);
    return (dx === 0 && dy <= 2) || (dy === 0 && dx <= 2) || (dx === 1 && dy === 1);
  },
  zigzag: (x, y) => (y + Math.abs((x % 8) - 4)) % 6 < 2,
  escamas: (x, y) => {
    const row = Math.floor(y / 4);
    const cx = (x + (row % 2) * 4) % 8;
    const cy = y % 4;
    const d = (cx - 4) * (cx - 4) + (cy - 4) * (cy - 4) * 1.6;
    return d >= 10 && d < 17;
  },
  camuflaje: (x, y) => Math.sin(x * 0.37 + Math.sin(y * 0.21) * 2.1) + Math.sin(y * 0.29 + Math.sin(x * 0.17) * 1.7) > 0.9,
  circuito: (x, y) => (x % 10 === 0 && y % 20 < 12) || (y % 10 === 0 && x % 20 > 6) || (x % 10 === 5 && y % 10 === 5),
  ladrillos: (x, y) => y % 5 === 0 || (x + (Math.floor(y / 5) % 2) * 5) % 10 === 0,
};

// -------------------------------------------------------------- banderas

let flagImage = null;
function flagSprite() {
  if (!flagImage && typeof Image !== 'undefined') {
    flagImage = new Image();
    flagImage.src = FLAG_SPRITE;
  }
  return flagImage && flagImage.complete && flagImage.naturalWidth ? flagImage : null;
}

/** Promesa que se cumple cuando la imagen de las banderas está lista (o falla: no bloquea). */
export function loadFlags() {
  flagSprite();
  const img = flagImage;
  if (!img || (img.complete && img.naturalWidth)) return Promise.resolve();
  if (typeof img.decode === 'function') return img.decode().catch(() => {});
  return new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  });
}

/** ¿Está ya cargada la imagen con todas las banderas? */
export function flagReady() {
  return !!flagSprite();
}

export function hasFlag(iso) {
  return !!iso && Object.hasOwn(FLAG_INDEX, iso);
}

/** Dibuja la bandera `iso` centrada en (cx, cy) con alto `h`. Devuelve false si no hay. */
export function drawFlag(ctx, iso, cx, cy, h) {
  if (!hasFlag(iso)) return false;
  const img = flagSprite();
  if (!img) return false;
  const i = FLAG_INDEX[iso];
  const w = (h * FLAG_W) / FLAG_H;
  ctx.drawImage(img, (i % FLAG_COLS) * FLAG_W, Math.floor(i / FLAG_COLS) * FLAG_H, FLAG_W, FLAG_H, cx - w / 2, cy - h / 2, w, h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  return true;
}

/** Estilo CSS para mostrar una bandera del sprite en un elemento de `w` px de ancho. */
export function flagCss(iso, w = 16) {
  if (!hasFlag(iso)) return '';
  const i = FLAG_INDEX[iso];
  const h = (w * FLAG_H) / FLAG_W;
  return `background-size:${FLAG_COLS * w}px auto;background-position:-${(i % FLAG_COLS) * w}px -${Math.floor(i / FLAG_COLS) * h}px`;
}

/** Para las hojas de estilo: el sprite como variable CSS (se llama una vez). */
export function installFlagSprite(root) {
  root.style.setProperty('--banderas', `url("${FLAG_SPRITE}")`);
  flagSprite();
}

/**
 * Icono de un punto estratégico: rombo con borde (dorado si no tiene dueño,
 * del color del dueño si lo tiene) y un símbolo blanco: corona (capital),
 * engranaje (núcleo industrial), timón (puerto clave) o montañas (paso).
 */
export function drawPointIcon(ctx, kind, cx, cy, size, { ring = null } = {}) {
  const r = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  // Rombo con las esquinas redondeadas
  ctx.beginPath();
  const k = r * 1.08;
  const c = r * 0.22;
  ctx.moveTo(0, -k + c);
  ctx.quadraticCurveTo(0, -k, c, -k + c);
  ctx.lineTo(k - c, -c);
  ctx.quadraticCurveTo(k, 0, k - c, c);
  ctx.lineTo(c, k - c);
  ctx.quadraticCurveTo(0, k, -c, k - c);
  ctx.lineTo(-k + c, c);
  ctx.quadraticCurveTo(-k, 0, -k + c, -c);
  ctx.closePath();
  ctx.fillStyle = 'rgba(16, 22, 36, 0.92)';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, size * 0.11);
  ctx.strokeStyle = ring || '#f2c14e';
  ctx.stroke();
  // Símbolo
  const s = r * 0.62;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (kind === 'capital') {
    ctx.moveTo(-s, s * 0.55);
    ctx.lineTo(-s, -s * 0.45);
    ctx.lineTo(-s * 0.5, s * 0.05);
    ctx.lineTo(0, -s * 0.7);
    ctx.lineTo(s * 0.5, s * 0.05);
    ctx.lineTo(s, -s * 0.45);
    ctx.lineTo(s, s * 0.55);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'industria') {
    const teeth = 8;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const rr = i % 2 ? s * 0.72 : s;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16, 22, 36, 0.92)';
    ctx.fill();
  } else if (kind === 'puerto') {
    ctx.lineWidth = Math.max(1.2, s * 0.22);
    ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.moveTo(Math.cos(a) * s * 0.2, Math.sin(a) * s * 0.2);
      ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
    }
    ctx.stroke();
  } else {
    // Paso de montaña: dos picos
    ctx.moveTo(-s, s * 0.6);
    ctx.lineTo(-s * 0.35, -s * 0.55);
    ctx.lineTo(0, s * 0.05);
    ctx.lineTo(s * 0.35, -s * 0.75);
    ctx.lineTo(s, s * 0.6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
