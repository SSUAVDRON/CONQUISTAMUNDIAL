// Iconos de edificios dibujados con primitivas de canvas. Se usan igual en el
// mapa y en los botones de construcción, así siempre coinciden.

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
