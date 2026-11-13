// Fallos en el navegador: que ninguno pare la partida y que quede constancia
// para poder arreglarlo. Se guardan los últimos (en memoria) y el último en
// localStorage; en Ajustes → Más se puede ver y copiar.

const KEY = 'trinchera.ultimoError';
const MAX = 20;
const ring = [];
let context = () => ({});
let notify = null;

/** Datos que acompañan a cada fallo (compilación, turno, fase…). */
export function setErrorContext(fn) {
  context = fn;
}

/** Quién avisa al jugador (una vez cada cierto tiempo, ver main.js). */
export function setErrorNotifier(fn) {
  notify = fn;
}

/** Registra un fallo de `where` (simulación, dibujo, interfaz…) sin relanzarlo. */
export function reportError(err, where = 'desconocido') {
  const msg = String((err && err.message) || err || 'Error');
  const last = ring[ring.length - 1];
  if (last && last.msg === msg && last.where === where) {
    // El mismo fallo en cada fotograma: se cuenta, no se repite
    last.count++;
    last.last = new Date().toISOString();
  } else {
    let extra = {};
    try {
      extra = context() || {};
    } catch {
      extra = {};
    }
    ring.push({
      where,
      msg,
      stack: String((err && err.stack) || '').split('\n').slice(0, 8).join('\n'),
      at: new Date().toISOString(),
      count: 1,
      ...extra,
    });
    if (ring.length > MAX) ring.shift();
  }
  const e = ring[ring.length - 1];
  try {
    localStorage.setItem(KEY, JSON.stringify(e));
  } catch {
    /* sin almacenamiento */
  }
  try {
    console.error(`[Trinchera] fallo en ${where}:`, err);
    notify?.(e);
  } catch {
    /* el aviso nunca debe fallar */
  }
  return e;
}

/** El último fallo registrado (de esta sesión o de una anterior), o null. */
export function lastError() {
  if (ring.length) return ring[ring.length - 1];
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

/** Texto para copiar y enviar. */
export function errorReport(e = lastError()) {
  if (!e) return '';
  const lines = [`Trinchera · ${e.at}${e.count > 1 ? ` (×${e.count})` : ''}`, `Dónde: ${e.where}`, `Error: ${e.msg}`];
  for (const k of ['build', 'tick', 'phase', 'map', 'device']) if (e[k] !== undefined) lines.push(`${k}: ${e[k]}`);
  if (e.stack) lines.push('', e.stack);
  return lines.join('\n');
}

/** Fallos sueltos del navegador (fuera del bucle de la partida). */
export function installGlobalHandlers() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (ev) => reportError(ev.error || ev.message, 'ventana'));
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason, 'promesa'));
}
