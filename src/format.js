// Formato compacto de cifras: 950, 12.3k, 1.45M

export function formatNumber(n) {
  n = Math.max(0, Math.floor(n));
  if (n < 1000) return String(n);
  if (n < 100000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1000000) return Math.round(n / 1000) + 'k';
  return (n / 1000000).toFixed(2).replace(/0$/, '') + 'M';
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
