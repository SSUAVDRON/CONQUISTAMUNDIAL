// Pantalla de carga: muestra los pasos reales de preparar la partida, una
// barra de progreso y un consejo. Dura un mínimo para que dé tiempo a leerlo.

import { mostrar } from './movimiento.js';
import { paintMapPreview } from './terreno.js';

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
/** Dos fotogramas: el primero pinta la pantalla de carga y el segundo arranca su animación en la gráfica. */
const twoPaints = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Marca los pasos (insignias) hasta `index`: los anteriores, hechos; ese, en
 * marcha (si es el último + 1, todos hechos). La línea que los une se llena
 * hasta el paso en marcha.
 */
function markSteps(ol, index) {
  if (!ol) return;
  const items = [...ol.children];
  items.forEach((li, i) => {
    li.classList.toggle('hecho', i < index);
    li.classList.toggle('activo', i === index);
  });
  const n = items.length;
  ol.style.setProperty('--avance', String(n > 1 ? Math.min(1, Math.max(0, index) / (n - 1)) : 1));
}

/**
 * La barra hasta `f` (0-1) en `ms`, con su punta y su porcentaje. El relleno
 * se desplaza (no se estira): sus rayas no se deforman y va por la gráfica.
 */
function setBar(bar, tip, pct, f, ms) {
  f = Math.max(0.02, Math.min(1, f));
  for (const el of [bar, tip]) if (el) el.style.transitionDuration = `${ms}ms`;
  bar.style.transform = `translateX(${((f - 1) * 100).toFixed(2)}%)`;
  if (tip) tip.style.transform = `translateX(${((f - 1) * 100).toFixed(2)}%)`;
  pct?.style.setProperty('--arr-pct', String(Math.round(f * 100)));
}

/** Una insignia de paso: icono (de los símbolos #ico-… del HTML), sello de hecho y nombre. */
function stepBadge(name, icon, key = '') {
  const li = document.createElement('li');
  if (key) li.dataset.paso = key;
  li.innerHTML = `<span class="ins-medalla"><svg class="ins-ico"><use href="#ico-${icon}"/></svg><svg class="ins-hecho"><use href="#ico-hecho"/></svg></span><span class="ins-nombre"></span>`;
  li.querySelector('.ins-nombre').textContent = name;
  return li;
}

/**
 * Vista previa del mapa de la partida (en cuanto el primer paso lo ha leído):
 * el terreno en el lienzo, recortado a una proporción que quepa, y las
 * banderas de sus países (en los mapas reales), que caen con el escáner.
 */
function paintPreview(box, loaded) {
  const map = loaded && loaded.map;
  if (!map || !map.terrain) return false;
  const canvas = $('carga-lienzo');
  const W = 480;
  const ratio = map.height / map.width;
  const H = Math.round(W * Math.min(0.62, Math.max(0.36, ratio)));
  canvas.width = W;
  canvas.height = H;
  $('carga-vista').style.aspectRatio = `${W} / ${H}`;
  // Si el mapa es más alto que la vista, se enseña su franja central
  const cropH = Math.min(map.height, Math.round((map.width * H) / W));
  const y0 = Math.max(0, Math.round((map.height - cropH) / 2));
  paintMapPreview(canvas, { w: map.width, h: map.height, terrain: map.terrain, relief: map.relief, tileKm: (map.tileKm || 1) * 3, river: map.river, lat: map.lat }, [0, y0, map.width, y0 + cropH]);
  // (sin banderas encima: el campo de batalla limpio)
  box.classList.add('con-mapa');
  return true;
}

/**
 * Ejecuta `steps` ([{ label, name, icon, run }]) mostrando la pantalla de
 * carga: el mapa de la partida en cuanto se lee, un paso por insignia
 * (`name` e `icon`: su nombre corto y su símbolo #ico-…), la barra y un
 * consejo. Devuelve lo que devuelva el último paso. `onReady(result)` se
 * llama con la pantalla todavía tapándolo todo, justo antes de desvanecerse:
 * es el momento de quitar lo de debajo (el menú, la sala), para que al irse no
 * reaparezca la pantalla anterior ni un fotograma.
 */
export async function withLoading(title, steps, { minMs = 1300, onReady = null } = {}) {
  const box = $('carga');
  const started = performance.now();
  const bar = $('carga-progreso');
  const tip = $('carga-punta');
  const pct = $('carga-pct');
  const list = $('carga-pasos');
  const text = $('carga-paso');
  $('carga-mapa').textContent = title;
  $('carga-consejo').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  if (list) {
    const ICONS = ['terreno', 'banderas', 'frente', 'revista'];
    list.style.setProperty('--n', String(steps.length));
    list.replaceChildren(...steps.map((st, i) => stepBadge(st.name || st.label.replace(/…$/, ''), st.icon || ICONS[i % ICONS.length])));
    markSteps(list, 0);
  }
  box.classList.remove('saliendo', 'listo', 'con-mapa');
  $('carga-pines').replaceChildren();
  setBar(bar, tip, pct, 0.02, 0);
  clearTimeout(box._fuera);
  mostrar(box, { y: 0, scale: 1.02, ms: 260 });
  let result;
  let ok = false;
  let painted = false;
  const say = (label) => {
    text.textContent = label;
    text.classList.remove('cambia');
    void text.offsetWidth;
    text.classList.add('cambia');
  };
  try {
    // Que se vea de verdad antes del primer paso pesado (que bloquea el hilo)
    await twoPaints();
    for (let i = 0; i < steps.length; i++) {
      say(steps[i].label);
      markSteps(list, i);
      // La barra avanza hacia el final del paso mientras dura (con transform: aunque el paso ocupe el navegador)
      setBar(bar, tip, pct, (i + 0.85) / steps.length, 1400);
      await nextPaint();
      result = await steps[i].run(result);
      setBar(bar, tip, pct, (i + 1) / steps.length, 250);
      // En cuanto está el mapa: su vista previa (se descubre durante los pasos siguientes)
      if (!painted) {
        try {
          painted = paintPreview(box, result);
        } catch {
          painted = true; // sin vista previa: sigue el radar
        }
      }
    }
    say('¡A las trincheras!');
    markSteps(list, steps.length);
    setBar(bar, tip, pct, 1, 250);
    box.classList.add('listo');
    // Un par de fotogramas con la carga aún delante: el primer dibujo del
    // mapa nuevo (el más caro: sube el territorio a la gráfica) pasa aquí y
    // no al desvanecerse la carga
    await twoPaints();
    await twoPaints();
    const left = minMs - (performance.now() - started);
    if (left > 0) await wait(left);
    ok = true;
  } finally {
    if (ok && onReady) {
      try {
        onReady(result);
      } catch {
        /* lo de debajo se queda como está */
      }
    }
    box.classList.add('saliendo');
    box._fuera = setTimeout(() => {
      box.hidden = true;
    }, 350);
  }
  return result;
}

/**
 * Pantalla de arranque (#arranque, en el HTML desde el principio): el logo
 * grande, consejos que rotan solos (animación CSS), el texto del paso y la
 * barra gruesa con su porcentaje (con transform: sigue avanzando aunque el
 * paso bloquee el hilo principal). Al terminar, las dos puertas se abren y
 * entra el menú.
 */
export function bootLoader() {
  const box = $('arranque');
  if (!box) return null;
  const bar = $('arr-progreso');
  const tip = $('arr-punta');
  const text = $('arr-paso');
  const pct = $('arr-pct');
  const list = $('arr-pasos');
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
      // Un segundo adelantados: el primero ya se ve al empezar (si la carga
      // ocupa el navegador, su animación de entrada podía no arrancar)
      p.style.setProperty('--d', `${i * 5 - 1}s`);
      p.style.setProperty('--ciclo', `${cycle}s`);
      return p;
    }),
  );
  $('arr-puntos').replaceChildren(
    ...tips.map((_, i) => {
      const d = document.createElement('i');
      d.style.setProperty('--d', `${i * 5 - 1}s`);
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
      setBar(bar, tip, pct, to, ms);
      if (key) {
        const i = marks.findIndex((li) => li.dataset.paso === key);
        if (i >= 0) markSteps(list, i);
      }
    },
    /**
     * Último paso y salida (un mínimo para que no sea un parpadeo): el centro
     * se aleja, una línea dorada cruza la pantalla y las puertas se abren;
     * `onOpen()` justo cuando empiezan a abrirse (para que entre el menú).
     */
    async done({ minMs = 1800, onOpen = () => {}, tap = null } = {}) {
      this.step('¡A las trincheras!', 1, 300);
      markSteps(list, marks.length);
      box.classList.add('listo');
      // Un mínimo total (que no sea un parpadeo)
      await wait(Math.max(450, minMs - (performance.now() - started)));
      // El navegador aún no deja sonar: «Toca para entrar» (ese toque abre las
      // puertas con su fanfarria). `tap()` se resuelve con el gesto.
      if (tap) {
        const touch = !!window.matchMedia?.('(pointer: coarse)').matches;
        text.textContent = touch ? 'Toca para entrar' : 'Pulsa en cualquier sitio para entrar';
        box.classList.add('esperando');
        await tap();
        box.classList.remove('esperando');
      }
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
