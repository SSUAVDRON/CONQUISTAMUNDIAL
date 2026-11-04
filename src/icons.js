// Iconos de edificios dibujados con primitivas de canvas. Se usan igual en el
// mapa y en los botones de construcción, así siempre coinciden.
import { FLAG_COLS, FLAG_H, FLAG_INDEX, FLAG_SPRITE, FLAG_W } from './banderas.js';

const TAU = Math.PI * 2;

/**
 * Dibuja el icono de `kind` centrado en (cx, cy) con tamaño `size` px.
 * `disc` (opcional) pinta un círculo de fondo; `ring` su contorno.
 */
export function drawBuildingIcon(ctx, kind, cx, cy, size, { glyph = '#fff', disc = null, ring = null } = {}) {
  ctx.save();
  ctx.translate(cx, cy);
  const k = size / 20;
  ctx.scale(k, k);
  if (disc) {
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, TAU);
    ctx.fillStyle = disc;
    ctx.fill();
    if (ring) {
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = ring;
      ctx.stroke();
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
