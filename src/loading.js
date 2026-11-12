// Pantalla de carga: muestra los pasos reales de preparar la partida, una
// barra de progreso y un consejo. Dura un mínimo para que dé tiempo a leerlo.

import { mostrar } from './movimiento.js';
import { flagCss, hasFlag } from './icons.js';

const $ = (id) => document.getElementById(id);

export const TIPS = [
  'Las montañas y mesetas cuestan más tropas y tiempo: rodéalas.',
  'Tus tropas crecen más rápido cerca del 40 % del máximo: ataca antes de llenarte.',
  'Con la regla de trabajadores: más trabajadores, más oro; más soldados, más fuerza.',
  'La fuerza de ataque es un porcentaje de tus soldados, no de toda la población.',
  'Un puerto lanza mercantes a los puertos de otros jugadores: al llegar, cobráis los dos.',
  'Tus buques de guerra capturan los mercantes enemigos y hunden sus transportes.',
  'Dos misiles a la vez saturan una batería antimisiles.',
  'Aliarte con los vecinos del líder es la mejor defensa.',
  'Romper una alianza te marca como traidor: conquistarte será más barato.',
  'Las fábricas tienden vías: cada tren que llega a una estación te da oro.',
  'Clic derecho (o mantener pulsado) sobre una nación abre su ficha.',
  'Mayús + clic construye varios edificios seguidos.',
  'Si el borde de la pantalla se pone rojo, alguien te está atacando: mira las tarjetas de combate.',
  'Si pierdes de vista tu nación, sigue la flecha del borde o pulsa C.',
  'Cerca de un puesto defensivo, conquistarte cuesta el triple de tiempo y de bajas.',
  'Las colonias son débiles y guardan oro: conquístalas pronto.',
  'Si eliminas a una nación, te quedas con todo su oro.',
  'Haz clic sobre un edificio tuyo con su tipo seleccionado para subirlo de nivel.',
  'Cada compra encarece el resto: elige bien qué construyes primero.',
  'Los antimisiles tardan en construirse: no esperes a ver el misil.',
  'Pulsa V para minimizar el panel de abajo y ver más mapa.',
  'Para un puerto basta con hacer clic cerca de tu costa.',
  'Los ríos son fronteras: no se cruzan por tierra. Si llegan al mar, se navegan y admiten puertos en sus orillas.',
  'Al otro lado de un río solo se llega en barco: necesitas un puerto.',
  'Los edificios están en tres grupos: Economía, Defensa y Ataque.',
];

/** Espera a que el navegador pinte (para que la barra avance de verdad). */
const nextPaint = () =>
  new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta `steps` ([{ label, run }]) mostrando la pantalla de carga.
 * Devuelve lo que devuelva el último paso.
 */
export async function withLoading(title, steps, { minMs = 1300 } = {}) {
  const box = $('carga');
  const started = performance.now();
  $('carga-mapa').textContent = title;
  $('carga-consejo').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  $('carga-progreso').style.width = '0%';
  box.classList.remove('saliendo');
  clearTimeout(box._fuera);
  mostrar(box, { y: 0, scale: 1.02, ms: 260 });
  let result;
  try {
    for (let i = 0; i < steps.length; i++) {
      $('carga-paso').textContent = steps[i].label;
      $('carga-progreso').style.width = `${Math.round((i / steps.length) * 100)}%`;
      await nextPaint();
      result = await steps[i].run(result);
    }
    $('carga-paso').textContent = '¡A las trincheras!';
    $('carga-progreso').style.width = '100%';
    const left = minMs - (performance.now() - started);
    if (left > 0) await wait(left);
  } finally {
    box.classList.add('saliendo');
    box._fuera = setTimeout(() => {
      box.hidden = true;
    }, 350);
  }
  return result;
}

/**
 * Pantalla de arranque (#arranque, en el HTML desde el principio): pasos con
 * su texto, la lista de pasos que se van marcando, la barra y el porcentaje
 * (con transform: sigue avanzando aunque el paso bloquee el hilo principal),
 * consejos que rotan solos (animación CSS) y el mapa del mundo que se va
 * descubriendo con las banderas de los países. Al terminar, las dos puertas se
 * abren y entra el menú.
 */
export function bootLoader() {
  const box = $('arranque');
  if (!box) return null;
  const bar = $('arr-progreso');
  const text = $('arr-paso');
  const pct = $('arr-pct');
  const started = performance.now();
  // Cinco consejos distintos al azar: cada uno 5 s, en bucle
  const pool = [...TIPS];
  const tips = [];
  while (tips.length < 5 && pool.length) tips.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  const cycle = tips.length * 5;
  $('arr-tips').replaceChildren(
    ...tips.map((t, i) => {
      const p = document.createElement('p');
      p.className = 'arr-tip';
      p.textContent = t;
      p.style.setProperty('--d', `${i * 5}s`);
      p.style.setProperty('--ciclo', `${cycle}s`);
      return p;
    }),
  );
  $('arr-puntos').replaceChildren(
    ...tips.map((_, i) => {
      const d = document.createElement('i');
      d.style.setProperty('--d', `${i * 5}s`);
      d.style.setProperty('--ciclo', `${cycle}s`);
      return d;
    }),
  );
  const marks = [...document.querySelectorAll('#arr-pasos li')];
  return {
    /** Nuevo paso (`key`: su marca en la lista): la barra va hasta `to` (0-1) en unos `ms` (lo que suele tardar). */
    step(label, to, ms = 500, key = '') {
      text.textContent = label;
      text.classList.remove('cambia');
      void text.offsetWidth;
      text.classList.add('cambia');
      const f = Math.max(0.02, Math.min(1, to));
      bar.style.transitionDuration = `${ms}ms`;
      bar.style.transform = `scaleX(${f})`;
      pct?.style.setProperty('--arr-pct', String(Math.round(f * 100)));
      if (key) {
        let reached = false;
        for (const li of marks) {
          const here = li.dataset.paso === key;
          li.classList.toggle('activo', here);
          if (!reached && !here) li.classList.add('hecho');
          if (here) reached = true;
        }
      }
    },
    /**
     * Pinta el mapa en su lienzo y lo descubre con el escáner; `pins`
     * ([{ iso, x, y }], 0-1 sobre el lienzo) son banderas que caen cuando pasa.
     */
    map(draw, pins = []) {
      try {
        draw($('arr-lienzo'));
        const layer = $('arr-pines');
        layer.replaceChildren(
          ...pins.filter((p) => hasFlag(p.iso)).map((p) => {
            const pin = document.createElement('span');
            pin.className = 'arr-pin';
            pin.style.left = `${(p.x * 100).toFixed(2)}%`;
            pin.style.top = `${(p.y * 100).toFixed(2)}%`;
            // Cae cuando el escáner (1,7 s de izquierda a derecha) pasa por encima
            pin.style.setProperty('--d', `${(0.25 + p.x * 1.35).toFixed(2)}s`);
            const flag = document.createElement('i');
            flag.className = 'bandera';
            flag.style.cssText = flagCss(p.iso, 18);
            pin.append(flag);
            return pin;
          }),
        );
        box.classList.add('con-mapa');
        this.mapAt = performance.now();
      } catch {
        /* sin vista previa: sigue el radar */
      }
    },
    /**
     * Último paso y salida (un mínimo para que no sea un parpadeo): el centro
     * se aleja, una línea dorada cruza la pantalla y las puertas se abren;
     * `onOpen()` justo cuando empiezan a abrirse (para que entre el menú).
     */
    async done({ minMs = 1800, onOpen = () => {} } = {}) {
      this.step('¡A las trincheras!', 1, 300);
      for (const li of marks) {
        li.classList.remove('activo');
        li.classList.add('hecho');
      }
      box.classList.add('listo');
      // Un mínimo total y, si el mapa salió hace poco, que dé tiempo a verlo
      // descubrirse y a que caigan sus banderas
      const now = performance.now();
      await wait(Math.max(450, minMs - (now - started), this.mapAt ? 1700 - (now - this.mapAt) : 0));
      const still = document.body.classList.contains('sin-animaciones') || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      document.body.classList.remove('arrancando');
      if (still) {
        box.hidden = true;
        onOpen();
        return;
      }
      box.classList.add('saliendo');
      await wait(420);
      box.classList.add('abriendo');
      onOpen();
      await wait(880);
      box.hidden = true;
    },
  };
}
