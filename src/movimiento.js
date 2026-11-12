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

// ------------------------------------------------------------- diálogos

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Diálogos abiertos, el último encima. */
const abiertos = [];

function enfocables(el) {
  return Array.from(el.querySelectorAll(FOCUSABLE)).filter((x) => !x.closest('[hidden]') && x.offsetParent !== null);
}

function teclaDialogo(e) {
  const top = abiertos[abiertos.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    if (top.o.sinEscape) return;
    e.preventDefault();
    e.stopPropagation();
    cerrarDialogo(top.el, 'escape');
    return;
  }
  if (e.key !== 'Tab') return;
  const f = enfocables(top.el);
  if (!f.length) {
    e.preventDefault();
    return;
  }
  const first = f[0];
  const last = f[f.length - 1];
  const a = document.activeElement;
  if (!top.el.contains(a)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && a === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && a === last) {
    e.preventDefault();
    first.focus();
  }
}

/** ¿Hay algún diálogo abierto? (para que Escape no haga otra cosa a la vez) */
export function hayDialogo() {
  return abiertos.length > 0;
}

/**
 * Abre `el` como diálogo modal: aparece con una transición, el foco pasa
 * dentro (a `o.foco` o al primer control) y Tab no sale de él. Escape lo
 * cierra (salvo `o.sinEscape`) y el foco vuelve a donde estaba.
 * `o.alCerrar(motivo)` se llama al cerrarlo ('escape' o lo que se pase a
 * `cerrarDialogo`).
 */
export function abrirDialogo(el, o = {}) {
  if (!el) return;
  const ya = abiertos.findIndex((d) => d.el === el);
  if (ya >= 0) abiertos.splice(ya, 1);
  const prev = ya >= 0 ? null : document.activeElement;
  abiertos.push({ el, o, prev });
  if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
  // Clic en el fondo o en un botón [data-cerrar]: cerrar
  if (!el._dialogo) {
    el._dialogo = true;
    el.addEventListener('click', (e) => {
      const d = abiertos.find((x) => x.el === el);
      if (!d) return;
      if (e.target.closest?.('[data-cerrar]')) cerrarDialogo(el, 'cerrar');
      else if (e.target === el && !d.o.sinFondo) cerrarDialogo(el, 'fondo');
    });
  }
  el.setAttribute('aria-modal', 'true');
  if (abiertos.length === 1) document.addEventListener('keydown', teclaDialogo, true);
  if (ya < 0) document.dispatchEvent(new CustomEvent('dialogo', { detail: 'abrir' }));
  mostrar(el, { y: 0, scale: 1, ms: o.ms ?? 200 });
  const card = o.tarjeta === false ? null : el.querySelector(o.tarjeta || '.tarjeta, .dialogo-caja');
  if (card && card.animate && !sinMovimiento()) {
    card.animate(
      [{ opacity: 0, transform: 'translateY(10px) scale(0.96)' }, { opacity: 1, transform: 'none' }],
      { duration: o.ms ? o.ms + 60 : 280, easing: 'cubic-bezier(0.2, 1.2, 0.4, 1)' },
    );
  }
  const foco = (typeof o.foco === 'string' ? el.querySelector(o.foco) : o.foco) || enfocables(el)[0];
  if (foco) foco.focus({ preventScroll: true });
  else {
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
  }
}

/** Cierra el diálogo `el` (si está abierto) y devuelve el foco. */
export function cerrarDialogo(el, motivo = 'cerrar') {
  const i = abiertos.findIndex((d) => d.el === el);
  if (i < 0) {
    if (el && !el.hidden) ocultar(el, { y: 0, scale: 1 });
    return;
  }
  const [d] = abiertos.splice(i, 1);
  if (!abiertos.length) document.removeEventListener('keydown', teclaDialogo, true);
  ocultar(el, { y: 0, scale: 1, ms: 150 });
  document.dispatchEvent(new CustomEvent('dialogo', { detail: 'cerrar' }));
  const back = d.prev;
  if (back && back.isConnected && back.offsetParent !== null && typeof back.focus === 'function') back.focus({ preventScroll: true });
  d.o.alCerrar?.(motivo);
}

/** Quita sin animación los diálogos abiertos (los que cumplan `filtro`, o todos) al cambiar de pantalla. */
export function cerrarDialogos(filtro = null) {
  for (let i = abiertos.length - 1; i >= 0; i--) {
    const d = abiertos[i];
    if (filtro && !filtro(d.el)) continue;
    abiertos.splice(i, 1);
    if (d.el._salida) {
      d.el._salida.cancel();
      d.el._salida = null;
    }
    d.el.hidden = true;
  }
  if (!abiertos.length) document.removeEventListener('keydown', teclaDialogo, true);
}

// ------------------------------------------------------------- cifras

/**
 * Pone el número `a` en `el` contando desde el que tenía (o `o.de`) en
 * `o.ms` (por defecto ~600 ms). `o.formato(n)` da el texto.
 */
export function contar(el, a, o = {}) {
  if (!el) return;
  const fmt = o.formato || ((n) => String(Math.round(n)));
  const de = o.de ?? el._cifra ?? a;
  el._cifra = a;
  cancelAnimationFrame(el._cuenta || 0);
  if (de === a || sinMovimiento()) {
    el.textContent = fmt(a);
    return;
  }
  const ms = o.ms ?? Math.min(900, 380 + Math.abs(a - de) * 4);
  const t0 = performance.now();
  const paso = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const k = 1 - (1 - t) ** 3;
    el.textContent = fmt(de + (a - de) * k);
    if (t < 1) el._cuenta = requestAnimationFrame(paso);
  };
  el._cuenta = requestAnimationFrame(paso);
}

// ------------------------------------------------------------- barras

let vigia = null;

/**
 * Las barras `.llena-al-ver` de `raiz` se llenan (clase `llena`) cuando
 * aparecen en pantalla. El relleno es su hijo con `--p` (0 a 1).
 */
export function llenarAlVer(raiz = document) {
  const barras = raiz.querySelectorAll('.llena-al-ver:not(.llena)');
  if (!barras.length) return;
  if (sinMovimiento() || typeof IntersectionObserver === 'undefined') {
    for (const b of barras) b.classList.add('llena');
    return;
  }
  vigia ??= new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('llena');
      vigia.unobserve(e.target);
    }
  }, { threshold: 0.2 });
  for (const b of barras) vigia.observe(b);
}

// ------------------------------------------------------------- teclado

/**
 * Flechas, Inicio y Fin en un grupo de botones (pestañas o radios): el foco
 * se mueve al siguiente activo y lo elige (clic). Solo el elegido entra en
 * el orden de Tab. `sel`: selector de los botones del grupo.
 */
export function teclasGrupo(box, sel = '[role="tab"], [role="radio"]') {
  if (!box || box._teclas) return;
  box._teclas = sel;
  box.addEventListener('keydown', (e) => {
    const items = Array.from(box.querySelectorAll(sel)).filter((b) => !b.disabled && !b.hidden && b.offsetParent !== null);
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    if (j < 0) return;
    e.preventDefault();
    items[j].focus();
    items[j].click();
    // Si el clic ha rehecho los botones, el foco va al nuevo de la misma posición
    if (!box.contains(document.activeElement)) {
      const again = Array.from(box.querySelectorAll(sel)).filter((b) => !b.disabled && !b.hidden);
      again[j]?.focus();
    }
    rodar(box);
  });
  rodar(box);
}

/** Orden de Tab del grupo: solo el elegido (o el primero) tiene tabindex 0. */
export function rodar(box) {
  if (!box) return;
  const sel = box._teclas || '[role="tab"], [role="radio"]';
  const items = Array.from(box.querySelectorAll(sel));
  if (!items.length) return;
  const on = items.find((b) => b.getAttribute('aria-selected') === 'true' || b.getAttribute('aria-checked') === 'true') || items.find((b) => !b.disabled) || items[0];
  for (const b of items) b.tabIndex = b === on ? 0 : -1;
}
