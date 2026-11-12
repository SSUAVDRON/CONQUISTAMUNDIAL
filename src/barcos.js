// Barcos vistos desde arriba, orientados según su rumbo. Se dibujan en
// coordenadas de pantalla: (x, y) es el centro, `ang` el rumbo en radianes y
// `len` la eslora en píxeles. `color` es el color CSS del dueño y `mine`
// marca los del jugador (contorno blanco).

const OUTLINE_MINE = '#ffffff';
const OUTLINE = 'rgba(0, 0, 0, 0.7)';

/** Estela en «V» detrás del casco. */
function wakeLines(ctx, len, w, strength) {
  if (strength <= 0) return;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const grad = ctx.createLinearGradient(-len * 0.5, 0, -len * 1.9, 0);
    grad.addColorStop(0, `rgba(240, 250, 255, ${0.55 * strength})`);
    grad.addColorStop(1, 'rgba(240, 250, 255, 0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(1, w * 0.28);
    ctx.beginPath();
    ctx.moveTo(-len * 0.42, side * w * 0.3);
    ctx.quadraticCurveTo(-len * 1.1, side * w * 0.9, -len * 1.9, side * w * 1.8);
    ctx.stroke();
  }
  // Remolino de la hélice
  const g2 = ctx.createLinearGradient(-len * 0.5, 0, -len * 1.4, 0);
  g2.addColorStop(0, `rgba(255, 255, 255, ${0.45 * strength})`);
  g2.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.strokeStyle = g2;
  ctx.lineWidth = Math.max(1, w * 0.45);
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, 0);
  ctx.lineTo(-len * 1.4, 0);
  ctx.stroke();
}

function shadow(ctx, len, w) {
  ctx.fillStyle = 'rgba(0, 20, 40, 0.28)';
  ctx.beginPath();
  ctx.ellipse(len * 0.06, w * 0.28, len * 0.52, w * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Casco puntiagudo: proa en +x. */
function hullPath(ctx, len, w, bow = 0.28, stern = 0.85) {
  ctx.beginPath();
  ctx.moveTo(len * 0.5, 0);
  ctx.quadraticCurveTo(len * 0.38, -w * 0.5, len * (0.5 - bow), -w * 0.5);
  ctx.lineTo(-len * 0.46, -w * 0.5);
  ctx.quadraticCurveTo(-len * 0.5, -w * 0.5, -len * 0.5, -w * 0.5 * stern);
  ctx.lineTo(-len * 0.5, w * 0.5 * stern);
  ctx.quadraticCurveTo(-len * 0.5, w * 0.5, -len * 0.46, w * 0.5);
  ctx.lineTo(len * (0.5 - bow), w * 0.5);
  ctx.quadraticCurveTo(len * 0.38, w * 0.5, len * 0.5, 0);
  ctx.closePath();
}

/** Versión mínima cuando el barco se ve muy pequeño. */
function tiny(ctx, x, y, ang, len, color, mine) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(len * 0.6, 0);
  ctx.lineTo(-len * 0.45, -len * 0.38);
  ctx.lineTo(-len * 0.45, len * 0.38);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = mine ? OUTLINE_MINE : OUTLINE;
  ctx.stroke();
  ctx.restore();
}

/** Lancha de desembarco con las tropas en cubierta. */
export function drawTransport(ctx, x, y, ang, len, color, mine, moving = 1) {
  if (len < 8) return tiny(ctx, x, y, ang, Math.max(5, len), color, mine);
  const w = len * 0.46;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  wakeLines(ctx, len, w, moving);
  shadow(ctx, len, w);
  // Casco de proa roma (rampa delante)
  ctx.beginPath();
  ctx.moveTo(len * 0.5, -w * 0.38);
  ctx.quadraticCurveTo(len * 0.5, -w * 0.5, len * 0.4, -w * 0.5);
  ctx.lineTo(-len * 0.44, -w * 0.5);
  ctx.quadraticCurveTo(-len * 0.5, -w * 0.5, -len * 0.5, -w * 0.38);
  ctx.lineTo(-len * 0.5, w * 0.38);
  ctx.quadraticCurveTo(-len * 0.5, w * 0.5, -len * 0.44, w * 0.5);
  ctx.lineTo(len * 0.4, w * 0.5);
  ctx.quadraticCurveTo(len * 0.5, w * 0.5, len * 0.5, w * 0.38);
  ctx.closePath();
  ctx.fillStyle = '#4b5661';
  ctx.fill();
  ctx.lineWidth = Math.max(1, len * 0.06);
  ctx.strokeStyle = mine ? OUTLINE_MINE : OUTLINE;
  ctx.stroke();
  // Bodega con el color del dueño
  ctx.fillStyle = color;
  ctx.fillRect(-len * 0.34, -w * 0.32, len * 0.7, w * 0.64);
  // Rampa
  ctx.fillStyle = '#6c7884';
  ctx.fillRect(len * 0.36, -w * 0.36, len * 0.1, w * 0.72);
  // Cascos de los soldados
  if (len >= 14) {
    ctx.fillStyle = 'rgba(40, 48, 36, 0.9)';
    const r = Math.max(1, len * 0.045);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.beginPath();
        ctx.arc(-len * 0.24 + i * len * 0.15, (j ? 1 : -1) * w * 0.15, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Puente de mando a popa
  ctx.fillStyle = '#d7dde3';
  ctx.fillRect(-len * 0.47, -w * 0.22, len * 0.12, w * 0.44);
  ctx.restore();
}

/**
 * Buque de guerra como insignia circular (se reconoce a cualquier zoom):
 * anillo del color del dueño, fondo oscuro y la silueta del buque dentro,
 * girada según su rumbo, con las torretas apuntando al blanco si dispara.
 * `r` es el radio en píxeles; `aim`, el ángulo de tiro (o null).
 */
export function drawWarship(ctx, x, y, ang, r, color, mine, aim = null, moving = 1) {
  ctx.save();
  ctx.translate(x, y);
  // Estela corta detrás de la insignia
  if (moving > 0.05) {
    ctx.save();
    ctx.rotate(ang);
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const g = ctx.createLinearGradient(-r * 0.8, 0, -r * 2.4, 0);
      g.addColorStop(0, `rgba(230, 245, 255, ${0.45 * moving})`);
      g.addColorStop(1, 'rgba(230, 245, 255, 0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(1, r * 0.14);
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, side * r * 0.35);
      ctx.quadraticCurveTo(-r * 1.5, side * r * 0.7, -r * 2.4, side * r * 1.1);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Sin círculo alrededor: el casco, más grande, con la cubierta del color
  // de su dueño y el contorno blanco si es tuyo
  const L = r * 1.9;
  const W = r * 0.56;
  const hull = () => {
    ctx.beginPath();
    ctx.moveTo(L * 0.5, 0);
    ctx.quadraticCurveTo(L * 0.3, -W * 0.5, L * 0.15, -W * 0.5);
    ctx.lineTo(-L * 0.44, -W * 0.5);
    ctx.lineTo(-L * 0.5, -W * 0.3);
    ctx.lineTo(-L * 0.5, W * 0.3);
    ctx.lineTo(-L * 0.44, W * 0.5);
    ctx.lineTo(L * 0.15, W * 0.5);
    ctx.quadraticCurveTo(L * 0.3, W * 0.5, L * 0.5, 0);
    ctx.closePath();
  };
  // Sombra con la forma del casco (desplazada en pantalla, no con el rumbo)
  ctx.save();
  ctx.translate(r * 0.08, r * 0.14);
  ctx.rotate(ang);
  hull();
  ctx.fillStyle = 'rgba(0, 10, 25, 0.38)';
  ctx.fill();
  ctx.restore();
  // Silueta del buque, girada con su rumbo
  ctx.save();
  ctx.rotate(ang);
  hull();
  ctx.fillStyle = '#c9d2da';
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, r * 0.09);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = mine ? '#ffffff' : 'rgba(10, 16, 24, 0.7)';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(-L * 0.36, -W * 0.24, L * 0.62, W * 0.48);
  ctx.fillStyle = '#eef2f5';
  ctx.fillRect(-L * 0.1, -W * 0.3, L * 0.2, W * 0.6);
  const turret = (tx) => {
    ctx.save();
    ctx.translate(tx, 0);
    ctx.rotate(aim === null ? 0 : aim - ang);
    ctx.fillStyle = '#2e3a46';
    ctx.fillRect(0, -W * 0.08, L * 0.2, W * 0.16);
    ctx.beginPath();
    ctx.arc(0, 0, W * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = '#3d4a57';
    ctx.fill();
    ctx.restore();
  };
  turret(L * 0.27);
  turret(-L * 0.27);
  ctx.restore();
  ctx.restore();
}

const CONTAINERS = ['#d9a441', '#4f8fd6', '#c95a4a', '#5fae6b'];

/** Mercante: casco oscuro con contenedores y puente blanco a popa. */
export function drawCargo(ctx, x, y, ang, len, color, mine, moving = 1, seed = 0) {
  if (len < 9) return tiny(ctx, x, y, ang, Math.max(5, len), color, mine);
  const w = len * 0.3;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  wakeLines(ctx, len, w, moving);
  shadow(ctx, len, w);
  hullPath(ctx, len, w, 0.22, 0.85);
  ctx.fillStyle = '#2f3540';
  ctx.fill();
  ctx.lineWidth = Math.max(1, len * 0.035);
  ctx.strokeStyle = mine ? OUTLINE_MINE : OUTLINE;
  ctx.stroke();
  // Contenedores: el primero de cada fila, del color del dueño
  const cols = 5;
  const cw = (len * 0.6) / cols;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 3 === 0 ? color : CONTAINERS[(i * 3 + j + seed) % CONTAINERS.length];
      ctx.fillRect(-len * 0.28 + i * cw + 0.5, (j ? 0 : -1) * w * 0.34 + 0.5, cw - 1, w * 0.34 - 1);
    }
  }
  // Puente
  ctx.fillStyle = '#eef1f4';
  ctx.fillRect(-len * 0.44, -w * 0.36, len * 0.13, w * 0.72);
  ctx.restore();
}
