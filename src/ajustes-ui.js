// Página de Ajustes: una sección a la vista (Gráficos, Mapa, Partida,
// Interfaz, Sonido, Controles y Más), cada opción en su fila con lo que hace
// y su control. Todo se aplica al momento. Sale de SECTIONS (ajustes.js).
import { BUILDINGS, BUILDING_KINDS } from './config.js';
import { GFX_PRESETS, SECTIONS, SETTINGS_DEFAULTS, applyPreset, presetOf, sectionKeys } from './ajustes.js';
import { rodar, teclasGrupo } from './movimiento.js';
import { defaultProfile } from './profile.js';

const $ = (id) => document.getElementById(id);
const STORE = 'trinchera.ajustesSeccion';

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

/** Grupo de botones excluyentes (como el resto del juego: .segmentos con role=radio). */
function segmented(options, current, onPick, label) {
  const box = el('div', { class: 'segmentos aj-seg', role: 'radiogroup', 'aria-label': label });
  for (const [value, text] of options) {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(value === current), text });
    b.dataset.valor = String(value);
    b.addEventListener('click', () => {
      for (const x of box.children) x.setAttribute('aria-checked', String(x === b));
      rodar(box);
      onPick(value);
    });
    box.append(b);
  }
  teclasGrupo(box);
  return box;
}

/** Selector de calidad gráfica (página de Ajustes y menú en partida). */
export function presetPicker(a, onPick, { compact = false } = {}) {
  const box = el('div', { class: `aj-presets${compact ? ' compacto' : ''}`, role: 'radiogroup', 'aria-label': 'Calidad gráfica' });
  const cur = presetOf(a);
  for (const [id, P] of Object.entries(GFX_PRESETS)) {
    const b = el(
      'button',
      { type: 'button', role: 'radio', class: 'aj-preset', 'aria-checked': String(id === cur), 'data-preset': id, title: P.hint },
      // Barras de nivel (1 a 4), como las de la cobertura: se entiende de un vistazo
      el('span', { class: 'aj-barras', 'aria-hidden': 'true', 'data-n': String(P.level) }, el('i'), el('i'), el('i'), el('i')),
      el('span', { class: 'aj-preset-nombre', text: P.name }),
      compact ? null : el('span', { class: 'aj-preset-pista', text: P.hint }),
    );
    b.addEventListener('click', () => onPick(id));
    box.append(b);
  }
  teclasGrupo(box);
  return box;
}

/** Marca el preajuste que coincide (o ninguno: «personalizada»). */
export function syncPresetPicker(box, a) {
  if (!box) return;
  const cur = presetOf(a);
  for (const b of box.querySelectorAll('[data-preset]')) b.setAttribute('aria-checked', String(b.dataset.preset === cur));
  box.classList.toggle('personalizada', cur === 'personalizada');
  rodar(box);
}

const kbd = (...keys) => keys.map((k) => el('kbd', { text: k }));

/** Atajos de teclado (en el ordenador). */
function shortcuts() {
  const rows = [
    ['Mover la cámara', kbd('W', 'A', 'S', 'D'), ' o las flechas'],
    ['Acercar y alejar', ['rueda del ratón, ', ...kbd('+', '−')]],
    ['Ir a tu nación', kbd('C')],
    ['Fuerza del ataque (10 %…100 %)', [...kbd('1'), '…', ...kbd('0'), ' · ', ...kbd('Mayús'), '+ rueda']],
    ['Información avanzada', [...kbd('Mayús'), ' (mantener)']],
    ['Guardar tropas en la capital', [...kbd('X'), ' · sacarlas: ', ...kbd('Mayús', 'X')]],
    ['Construir varias veces', [...kbd('Mayús'), ' + clic']],
    ['Plegar el panel de abajo', kbd('V')],
    ['Desarrollo e investigación', kbd('I')],
    ['Mandar un emoji a todos', kbd('Y')],
    ['Silenciar el sonido', kbd('N')],
    ['Menú de la partida', kbd('Esc')],
  ];
  const builds = BUILDING_KINDS.filter((k) => BUILDINGS[k].key).map((k) => el('span', { class: 'aj-tecla-obra' }, el('kbd', { text: BUILDINGS[k].key.replace('Key', '') }), ` ${BUILDINGS[k].short || BUILDINGS[k].name}`));
  const list = el('div', { class: 'aj-atajos' });
  for (const [label, keys, extra] of rows) list.append(el('div', { class: 'aj-atajo' }, el('span', { class: 'aj-atajo-que', text: label }), el('span', { class: 'aj-atajo-teclas' }, ...[].concat(keys), extra || null)));
  list.append(el('div', { class: 'aj-atajo aj-atajo-obras' }, el('span', { class: 'aj-atajo-que', text: 'Edificios y armas' }), el('span', { class: 'aj-atajo-teclas' }, ...builds)));
  return list;
}

export class SettingsUI {
  /**
   * @param profile perfil (lee y escribe profile.ajustes)
   * @param h { onChange(key), onReset(), info() → { pantalla, mapa, auto, fps } }
   */
  constructor(profile, h) {
    this.profile = profile;
    this.h = h;
    this.nav = $('aj-nav');
    this.body = $('aj-contenido');
    if (!this.nav || !this.body) return;
    this._build();
    let start = 'graficos';
    try {
      start = localStorage.getItem(STORE) || start;
    } catch {
      /* sin almacenamiento: la primera sección */
    }
    this.show(SECTIONS.some((s) => s.id === start) ? start : 'graficos', false);
  }

  get a() {
    return this.profile.ajustes;
  }

  _build() {
    this.controls = new Map(); // key → { type, node, input?, out? }
    this.nav.replaceChildren(
      ...SECTIONS.map((s) =>
        el(
          'button',
          { type: 'button', role: 'tab', id: `aj-tab-${s.id}`, 'aria-controls': `aj-sec-${s.id}`, 'aria-selected': 'false', 'data-sec': s.id, onclick: () => this.show(s.id) },
          el('span', { class: 'aj-nav-icono', 'aria-hidden': 'true', text: s.icon }),
          el('span', { class: 'aj-nav-txt' }, el('b', { text: s.title }), el('small', { text: s.nav || s.desc })),
        ),
      ),
    );
    teclasGrupo(this.nav);
    const mas = this.body.querySelector('[data-sec="mas"]');
    for (const s of SECTIONS) {
      if (s.id === 'mas') {
        if (mas) {
          mas.id = `aj-sec-mas`;
          mas.setAttribute('aria-labelledby', 'aj-tab-mas');
        }
        continue;
      }
      const sec = el('section', { class: 'aj-seccion', id: `aj-sec-${s.id}`, 'data-sec': s.id, role: 'tabpanel', 'aria-labelledby': `aj-tab-${s.id}`, hidden: true });
      const reset = el('button', { type: 'button', class: 'aj-reset-sec', text: 'Restablecer', title: `Dejar ${s.title.toLowerCase()} como venían` });
      reset.addEventListener('click', () => this.resetSection(s.id));
      sec.append(el('header', { class: 'aj-cab' }, el('div', {}, el('h2', {}, el('span', { class: 'aj-icono', 'aria-hidden': 'true', text: s.icon }), s.title), el('p', { text: s.desc })), reset));
      const list = el('div', { class: 'aj-lista' });
      for (const it of s.items) {
        const row = this._row(it);
        if (row) (it.type === 'presets' ? sec : list).append(row);
      }
      sec.append(list);
      if (s.id === 'graficos') {
        this.infoBox = el('p', { class: 'aj-info', 'aria-live': 'polite' });
        sec.append(this.infoBox);
      }
      if (mas) this.body.insertBefore(sec, mas);
      else this.body.append(sec);
    }
  }

  _row(it) {
    const a = this.a;
    const text = (id) => el('div', { class: 'aj-texto' }, el('span', { class: 'aj-titulo', id }, it.label), it.desc ? el('span', { class: 'aj-desc', text: it.desc }) : null);
    const id = `aj-${it.key}`;
    if (it.type === 'presets') {
      const box = presetPicker(a, (pid) => {
        applyPreset(this.a, pid);
        this.sync();
        this._changed('calidad');
      });
      this.presets = box;
      return el('div', { class: 'aj-bloque-presets' }, el('div', { class: 'aj-presets-cab' }, el('span', { class: 'aj-titulo', text: 'Calidad gráfica' }), el('span', { class: 'aj-personalizada', text: 'Personalizada' })), box);
    }
    if (it.type === 'shortcuts') {
      return el('div', { class: 'aj-fila aj-fila-ancha' }, text(`${id}-t`), shortcuts());
    }
    if (it.type === 'toggle') {
      const input = el('input', { type: 'checkbox', id, role: 'switch' });
      input.checked = (a[it.key] ?? SETTINGS_DEFAULTS[it.key] ?? true) !== false;
      input.addEventListener('change', () => {
        this.a[it.key] = input.checked;
        this._changed(it.key, row);
      });
      const row = el('label', { class: 'aj-fila', for: id }, text(`${id}-t`), el('span', { class: 'aj-control interruptor' }, input));
      this.controls.set(it.key, { type: 'toggle', input });
      return row;
    }
    if (it.type === 'seg') {
      const box = segmented(it.options, a[it.key] ?? SETTINGS_DEFAULTS[it.key], (v) => {
        this.a[it.key] = v;
        this._changed(it.key, row);
      }, it.label);
      box.id = id;
      const row = el('div', { class: 'aj-fila' }, text(`${id}-t`), el('div', { class: 'aj-control' }, box));
      this.controls.set(it.key, { type: 'seg', node: box });
      return row;
    }
    if (it.type === 'range') {
      const { input, out, wrap } = this._slider(id, it.key, 1);
      const row = el('div', { class: 'aj-fila' }, text(`${id}-t`), el('div', { class: 'aj-control' }, wrap));
      input.addEventListener('change', () => this._changed(it.key, row, true));
      this.controls.set(it.key, { type: 'range', input, out });
      return row;
    }
    if (it.type === 'sound') {
      const tog = el('input', { type: 'checkbox', id, role: 'switch', 'aria-labelledby': `${id}-t` });
      tog.checked = a[it.key] !== false;
      const def = it.vol === 'volMusica' ? 0.5 : 0.8;
      const { input, out, wrap } = this._slider(`aj-vol-${it.key}`, it.vol, def);
      const row = el('div', { class: 'aj-fila aj-fila-sonido' }, text(`${id}-t`), el('div', { class: 'aj-control aj-sonido-ctl' }, el('span', { class: 'interruptor' }, tog), wrap));
      tog.addEventListener('change', () => {
        this.a[it.key] = tog.checked;
        this._syncSound();
        this._changed(it.key, row);
      });
      input.addEventListener('change', () => this._changed(it.vol, row, true));
      this.controls.set(it.key, { type: 'toggle', input: tog });
      this.controls.set(it.vol, { type: 'range', input, out, def });
      return row;
    }
    return null;
  }

  /** Deslizador 0-100 con su cifra (guardado de 0 a 1). */
  _slider(id, key, def) {
    const v = Math.round((this.a[key] ?? def) * 100);
    const input = el('input', { type: 'range', id, min: '0', max: '100', step: '1', value: String(v), 'aria-label': 'Volumen' });
    const out = el('output', { class: 'aj-valor', for: id, text: `${v}` });
    const paint = () => input.style.setProperty('--llenado', `${input.value}%`);
    paint();
    input.addEventListener('input', () => {
      out.textContent = input.value;
      paint();
      this.a[key] = Number(input.value) / 100;
      this.h.onChange?.(key, true);
    });
    return { input, out, wrap: el('div', { class: 'aj-deslizador' }, input, out) };
  }

  /** Tras cambiar algo: se guarda y se aplica; la fila destella un momento. */
  _changed(key, row = null, done = false) {
    this.h.onChange?.(key, false);
    if (this.presets) syncPresetPicker(this.presets, this.a);
    this.renderInfo();
    if (row && !done) {
      row.classList.remove('cambiado');
      void row.offsetWidth;
      row.classList.add('cambiado');
    }
  }

  _syncSound() {
    for (const [tog, vol] of [['musica', 'volMusica'], ['efectos', 'volEfectos']]) {
      const t = this.controls.get(tog);
      const v = this.controls.get(vol);
      if (!t || !v) continue;
      v.input.disabled = !t.input.checked;
      v.input.closest('.aj-deslizador')?.classList.toggle('apagado', !t.input.checked);
    }
  }

  /** Pone los controles según el perfil (al restablecer o al cambiar algo desde el menú en partida). */
  sync() {
    if (!this.controls) return;
    const a = this.a;
    for (const [key, c] of this.controls) {
      const v = a[key] ?? SETTINGS_DEFAULTS[key] ?? c.def ?? true;
      if (c.type === 'toggle') c.input.checked = v !== false;
      else if (c.type === 'seg') {
        for (const b of c.node.children) b.setAttribute('aria-checked', String(b.dataset.valor === String(v)));
        rodar(c.node);
      } else if (c.type === 'range') {
        const n = Math.round((v ?? 1) * 100);
        c.input.value = String(n);
        c.out.textContent = String(n);
        c.input.style.setProperty('--llenado', `${n}%`);
      }
    }
    this._syncSound();
    syncPresetPicker(this.presets, a);
    this.renderInfo();
  }

  /** Línea de información de Gráficos: pantalla, resolución del mapa y fps de la última partida. */
  renderInfo() {
    if (!this.infoBox) return;
    const i = this.h.info?.();
    if (!i) return;
    const fmt = (x) => `${(Math.round(x * 100) / 100).toLocaleString('es-ES')}×`;
    const parts = [`Pantalla ${fmt(i.pantalla)}`, `mapa a ${fmt(i.mapa)}${i.auto ? ' (automática)' : ''}`];
    if (i.fps) parts.push(`última partida: ${i.fps} fps de media`);
    this.infoBox.textContent = parts.join(' · ');
  }

  /** Enseña una sección (y la recuerda para la próxima vez). */
  show(id, focus = false) {
    this.current = id;
    for (const b of this.nav.querySelectorAll('[data-sec]')) b.setAttribute('aria-selected', String(b.dataset.sec === id));
    rodar(this.nav);
    for (const s of this.body.querySelectorAll('.aj-seccion, [data-sec="mas"]')) s.hidden = s.dataset.sec !== id;
    try {
      localStorage.setItem(STORE, id);
    } catch {
      /* sin almacenamiento */
    }
    if (id === 'graficos') this.renderInfo();
    if (focus) this.nav.querySelector(`[data-sec="${id}"]`)?.focus();
    // En el móvil, la pestaña elegida a la vista (la barra se desplaza)
    this.nav.querySelector(`[data-sec="${id}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  /** «Restablecer» de una sección: sus opciones como venían. */
  resetSection(id) {
    const a = this.a;
    const d = defaultProfile().ajustes;
    for (const k of sectionKeys(id)) if (k in d) a[k] = d[k];
    this.sync();
    this.h.onChange?.('*', false);
    this.h.onFlash?.(`${SECTIONS.find((s) => s.id === id)?.title || 'Sección'}: como venía.`);
  }
}
