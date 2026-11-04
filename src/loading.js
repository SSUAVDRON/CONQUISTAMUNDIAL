// Pantalla de carga: muestra los pasos reales de preparar la partida, una
// barra de progreso y un consejo. Dura un mínimo para que dé tiempo a leerlo.

const $ = (id) => document.getElementById(id);

export const TIPS = [
  'Las montañas y mesetas cuestan más tropas y tiempo: rodéalas.',
  'Cerca del máximo tus tropas crecen despacio: ataca antes de llenarte.',
  'Un puerto saca pesqueros y mercantes que te dan oro sin hacer nada.',
  'Tus buques de guerra capturan los pesqueros y mercantes enemigos.',
  'Dos misiles a la vez saturan una batería antimisiles.',
  'Aliarte con los vecinos del líder es la mejor defensa.',
  'Romper una alianza te marca como traidor: conquistarte será más barato.',
  'Cada fábrica suma un 25 % al oro que ganas.',
  'Clic derecho (o mantener pulsado) sobre una nación abre su ficha.',
  'Mayús + clic construye varios edificios seguidos.',
  'Si la pantalla se pone roja, alguien te está atacando: mira tu panel.',
  'Las fortalezas hacen que conquistarte cueste dos veces y media más.',
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
  box.hidden = false;
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
    setTimeout(() => {
      box.hidden = true;
    }, 350);
  }
  return result;
}
