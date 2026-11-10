// Pantalla de carga: muestra los pasos reales de preparar la partida, una
// barra de progreso y un consejo. Dura un mínimo para que dé tiempo a leerlo.

import { mostrar } from './movimiento.js';

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
