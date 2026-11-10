// Movimiento de la interfaz: elementos que aparecen y desaparecen con una
// transición corta (opacidad y un pequeño desplazamiento) en vez de saltar.
// Usa la Web Animations API (transform y opacidad: la gráfica lo hace sin
// recalcular la página). Respeta «Animaciones» de Ajustes y la preferencia
// del sistema de reducir el movimiento.

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

/** ¿Hay que evitar las animaciones? */
export function sinMovimiento() {
  if (typeof document === 'undefined') return true;
  return document.body.classList.contains('sin-animaciones') || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** `o.base`: transformación propia del elemento (p. ej. translateX(-50%) para centrarlo). */
function frames(o) {
  const x = o.x || 0;
  const y = o.y ?? 6;
  const s = o.scale ?? 0.98;
  const base = o.base ? `${o.base} ` : '';
  return [
    { opacity: 0, transform: `${base}translate(${x}px, ${y}px) scale(${s})` },
    { opacity: 1, transform: o.base || 'none' },
  ];
}

/**
 * Muestra `el` (quita `hidden`) con una entrada suave. Si estaba saliendo,
 * la salida se cancela. `o`: { x, y, scale, ms, base }.
 */
export function mostrar(el, o = {}) {
  if (!el) return;
  if (el._salida) {
    el._salida.cancel();
    el._salida = null;
  }
  if (!el.hidden) return;
  el.hidden = false;
  if (sinMovimiento() || !el.animate) return;
  el.animate(frames(o), { duration: o.ms ?? 200, easing: EASE_OUT });
}

/** Oculta `el` (pone `hidden` al terminar) con una salida suave. */
export function ocultar(el, o = {}) {
  if (!el || el.hidden || el._salida) return;
  if (sinMovimiento() || !el.animate) {
    el.hidden = true;
    return;
  }
  const a = el.animate(frames(o).reverse(), { duration: o.ms ?? 140, easing: EASE_IN, fill: 'forwards' });
  el._salida = a;
  a.onfinish = () => {
    el._salida = null;
    el.hidden = true;
    a.cancel(); // quita el estado final de la animación (lo oculta `hidden`)
  };
}

/** Muestra u oculta según `visible`. */
export function alternar(el, visible, o = {}) {
  if (visible) mostrar(el, o);
  else ocultar(el, o);
}

/**
 * FLIP: anima los hijos de `box` desde donde estaban hasta donde están tras
 * `cambiar()` (filas que suben o bajan de puesto se deslizan).
 */
export function deslizar(box, cambiar, ms = 260) {
  if (!box || sinMovimiento()) {
    cambiar();
    return;
  }
  const antes = new Map();
  for (const c of box.children) antes.set(c, c.getBoundingClientRect().top);
  cambiar();
  for (const c of box.children) {
    const top = antes.get(c);
    if (top === undefined || c.hidden) continue;
    const dy = top - c.getBoundingClientRect().top;
    if (Math.abs(dy) < 1 || !c.animate) continue;
    c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: ms, easing: EASE_OUT });
  }
}

/**
 * Pone `html` en `box` cambiando solo lo que difiere (textos, atributos y
 * nodos nuevos o sobrantes). Los botones que ya estaban siguen siendo los
 * mismos elementos: no se pierde un clic a medias ni el hover.
 */
export function actualizarHtml(box, html) {
  if (!box) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  parchear(box, tpl.content);
}

function parchear(a, b) {
  const an = Array.from(a.childNodes);
  const bn = Array.from(b.childNodes);
  for (let i = 0; i < bn.length; i++) {
    const x = an[i];
    const y = bn[i];
    if (!x) {
      a.appendChild(y);
      continue;
    }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) {
      a.replaceChild(y, x);
      continue;
    }
    if (x.nodeType === 3 || x.nodeType === 8) {
      if (x.data !== y.data) x.data = y.data;
      continue;
    }
    if (x.nodeType === 1) {
      for (const { name, value } of Array.from(y.attributes)) if (x.getAttribute(name) !== value) x.setAttribute(name, value);
      for (const { name } of Array.from(x.attributes)) if (!y.hasAttribute(name)) x.removeAttribute(name);
      parchear(x, y);
    }
  }
  for (let i = bn.length; i < an.length; i++) an[i].remove();
}
