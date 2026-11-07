// Formato compacto de cifras: 950, 12.3k, 1.45M

export function formatNumber(n) {
  n = Math.max(0, Math.floor(n));
  if (n < 1000) return String(n);
  if (n < 100000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1000000) return Math.round(n / 1000) + 'k';
  return (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
}

/**
 * Como formatNumber pero con más cifras, para las que se ven contar (tus
 * tropas, población y oro): exacto hasta 9999, luego 12.34k, 123.4k y 1.234M.
 * Así la cifra cambia casi a cada fotograma en vez de a saltos de 100.
 */
export function formatCount(n) {
  n = Math.max(0, Math.floor(n));
  if (n < 10000) return String(n);
  if (n < 100000) return (n / 1000).toFixed(2) + 'k';
  if (n < 1000000) return (n / 1000).toFixed(1) + 'k';
  return (n / 1000000).toFixed(3) + 'M';
}

/** Tropas en el mapa: exactas hasta 9999 (caben igual que «3.6k»), luego como formatNumber. */
export function formatTroops(n) {
  n = Math.max(0, Math.floor(n / TROOP_SCALE));
  return n < 10000 ? String(n) : formatNumber(n);
}

/**
 * Escala de las tropas en pantalla. Por dentro siguen el documento (25 000 al
 * empezar, techo de 121 410…); en pantalla se muestran ÷ 10, como en el juego
 * de referencia, para que las cifras no salgan hinchadas: 2500, 12.1k…
 */
export const TROOP_SCALE = 10;

/** Tropas (o población) en texto: formatNumber de la cifra en pantalla. */
export function fmtTroops(n) {
  return formatNumber(n / TROOP_SCALE);
}

/** Tropas en los contadores que se ven contar (formatCount de la cifra en pantalla). */
export function fmtTroopsCount(n) {
  return formatCount(n / TROOP_SCALE);
}

export function formatPercent(x) {
  const v = x * 100;
  return (v < 10 ? v.toFixed(1) : Math.round(v)) + '%';
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
