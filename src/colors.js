// Utilidades de color para los jugadores.

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Colores bien repartidos en el círculo cromático (ángulo áureo). */
export function botColor(index, rng) {
  const hue = (index * 137.508 + 20) % 360;
  const sat = 0.5 + rng.float() * 0.35;
  const light = 0.42 + rng.float() * 0.16;
  return hslToRgb(hue, sat, light);
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [47, 125, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToCss([r, g, b], a = 1) {
  return a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

export function shadeRgb([r, g, b], f) {
  if (f < 1) return [Math.round(r * f), Math.round(g * f), Math.round(b * f)];
  const t = f - 1;
  return [Math.round(r + (255 - r) * t), Math.round(g + (255 - g) * t), Math.round(b + (255 - b) * t)];
}
