// Interfaz HTML de la partida: panel del jugador, clasificación, diplomacia,
// eventos, tooltip y pantalla de fin. (El inicio está en home.js.)
import { BUILDINGS, BUILDING_KINDS, CONFIG, EMOJIS, RES, TERRAIN_NAMES, TICK_MS } from './config.js';
import { rgbToCss } from './colors.js';
import { formatNumber, formatPercent, formatTime } from './format.js';
import { drawBuildingReal, flagCss, hasFlag } from './icons.js';

const $ = (id) => document.getElementById(id);
const MAX_EVENTS = 5;
const EVENT_MS = 6000;

/** Iconos de los avisos (SVG de 16×16, trazo con currentColor). */
const EVENT_ICONS = {
  ataque: '<path d="M3 13 L11 5 M5 14 L13 6 M10.5 3.5 L13.5 2.5 L12.5 5.5 M13 13 L5 5 M11 14 L3 6 M5.5 3.5 L2.5 2.5 L3.5 5.5" />',
  naval: '<circle cx="8" cy="3.5" r="1.5"/><path d="M8 5v9 M5 7.5h6 M2.5 9.5c0 3 2.5 4.5 5.5 4.5s5.5-1.5 5.5-4.5"/>',
  misil: '<path d="M10.5 2.5 L13.5 2.5 L13.5 5.5 L7 12 L4 9 Z M4 9 L2 9.5 L2.5 7.5 L5 7 M7 12 L6.5 14 L8.5 13.5 L9 11 M3 13 L5 11"/>',
  escudo: '<path d="M8 1.8 L13.5 4 V8 C13.5 11 11 13.3 8 14.3 C5 13.3 2.5 11 2.5 8 V4 Z M5.5 8 L7.3 9.8 L10.8 6.2"/>',
  alianza: '<path d="M1.5 7 L4.5 4.5 L7.5 6 L10 4.5 L14.5 7 M4.5 4.5 L2 10 L6.5 13.5 L8.5 12 M14.5 7 L12 11 L9.5 13 L7 10.5 M12 11 L9 8.5"/>',
  oro: '<ellipse cx="8" cy="5" rx="5" ry="2.2"/><path d="M3 5v6c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2V5 M3 8c0 1.2 2.2 2.2 5 2.2S13 9.2 13 8"/>',
  edificio: '<path d="M2 14 V7 L6 4 L10 7 V14 Z M10 14 V9 H14 V14 M1 14 H15 M5 14 V11 H7 V14"/>',
  muerte: '<path d="M8 2 C4.7 2 3 4.3 3 7 C3 8.7 3.8 9.8 5 10.5 V13 H11 V10.5 C12.2 9.8 13 8.7 13 7 C13 4.3 11.3 2 8 2 Z M6.5 13 V11.5 M9.5 13 V11.5"/><circle cx="6" cy="7" r="1.1"/><circle cx="10" cy="7" r="1.1"/>',
  logro: '<path d="M8 1.8 L9.9 5.8 L14.2 6.3 L11 9.2 L11.9 13.5 L8 11.3 L4.1 13.5 L5 9.2 L1.8 6.3 L6.1 5.8 Z"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2 V11.2 M8 4.8 V5"/>',
};

/**
 * Solo los avisos importantes llegan al recuadro: paces y roturas, países
 * derrotados, barcos y misiles contra ti, tu puerto destruido, logros e
 * inicio. El resto (obras, saqueos, tus propios ataques…) ya se ve en el
 * mapa o en las tarjetas de combate.
 */
const IMPORTANT = [
  /alianza|traiciona|traidor/i,
  /eliminad|derrotad/i,
  /contra ti|casillas tuyas|iba hacia ti|tu antimisiles/i,
  /uno de tus puertos/i,
  /logro|comienza la conquista/i,
];
const NOT_IMPORTANT = [/propuesta de alianza enviada/i];
function isImportant(text) {
  return IMPORTANT.some((r) => r.test(text)) && !NOT_IMPORTANT.some((r) => r.test(text));
}

/** Tipo de aviso según su texto (para el icono). */
function eventCategory(text) {
  const t = text.toLowerCase();
  if (/logro/.test(t)) return 'logro';
  if (/misil|💥|🚀|arrasad/.test(t)) return /derribad/.test(t) ? 'escudo' : 'misil';
  if (/derribad|🛡/.test(t)) return 'escudo';
  if (/alianza|aliad|traici|traidor|🤝|💔/.test(t)) return 'alianza';
  if (/eliminad|derrotad|ha caído/.test(t)) return 'muerte';
  if (/oro|botín|robado|🏴/.test(t)) return 'oro';
  if (/barco|buque|puerto|mercante|pesquero|desembar|🚢|⚓|mar\b/.test(t)) return 'naval';
  if (/construid|ciudad|fortaleza|fábrica|silo|antimisiles|edificio|mejorad|nivel/.test(t)) return 'edificio';
  if (/ataca|tropas|⚔|conquista|frontera/.test(t)) return 'ataque';
  return 'info';
}

/** Quita el emoji del principio (el aviso ya lleva su icono). */
const stripLeadingEmoji = (text) => text.replace(/^(?:\p{Extended_Pictographic}|[⚔⚓])\uFE0F?\s*/u, '');
const MAX_FRONTS = 4;
const FRONT_GRACE_MS = 1800; // un combate que termina se queda un momento atenuado

/** Cifra que se acerca suavemente a su valor (sin saltos ni parpadeos). */
class Counter {
  constructor(el, fmt = formatNumber) {
    this.el = el;
    this.fmt = fmt;
    this.value = null;
    this.target = 0;
    this.text = '';
  }

  set(target) {
    this.target = target;
    if (this.value === null) {
      this.value = target;
      this._write();
    }
  }

  step(dt) {
    if (this.value === null || this.value === this.target) return;
    this.value += (this.target - this.value) * (1 - Math.exp(-dt / 140));
    if (Math.abs(this.target - this.value) < 0.5) this.value = this.target;
    this._write();
  }

  _write() {
    const t = this.fmt(this.value);
    if (t !== this.text) {
      this.text = t;
      this.el.textContent = t;
    }
  }
}

export class UI {
  constructor() {
    this.handlers = {};
    this._fronts = new Map(); // clave → { li, a, d, gone }
    this._lbRows = new Map(); // id → fila de la clasificación
    this._lbAt = -Infinity; // última vez que se actualizó
    this._lbIndex = new Map();
    this._counters = new Set();
    this._lastEvent = null;
    this._troops = this._counter($('pj-tropas'));
    this._troopsMax = this._counter($('pj-tropas-max'));
    this._gold = this._counter($('pj-oro'));

    $('ratio').addEventListener('input', () => this.handlers.onRatio?.(Number($('ratio').value) / 100));

    $('btn-salir').addEventListener('click', () => this.handlers.onExit?.());
    $('fin-seguir').addEventListener('click', () => this.hideEnd());
    $('fin-nueva').addEventListener('click', () => this.handlers.onExit?.(true));
    $('conf-no').addEventListener('click', () => {
      $('confirmar').hidden = true;
    });
    $('conf-si').addEventListener('click', () => {
      $('confirmar').hidden = true;
      this.handlers.onExit?.(true);
    });

    // Ficha de nación (diplomacia)
    this.nationId = 0;
    this._breakArmedUntil = 0;
    $('pn-cerrar').addEventListener('click', () => this.closeNation());
    $('pn-alianza').addEventListener('click', () => {
      const id = this.nationId;
      if (!id) return;
      if ($('pn-alianza').dataset.action === 'break') {
        // Romper exige un segundo clic: te marca como traidor
        if (performance.now() < this._breakArmedUntil) {
          this._breakArmedUntil = 0;
          this.handlers.onBreakAlliance?.(id);
        } else {
          this._breakArmedUntil = performance.now() + 4000;
          $('pn-alianza').textContent = '¿Seguro? Pulsa otra vez';
        }
      } else {
        this.handlers.onProposeAlliance?.(id);
      }
    });
    $('pn-env-tropas').addEventListener('click', () => this.handlers.onDonate?.(this.nationId, 'troops'));
    $('pn-env-oro').addEventListener('click', () => this.handlers.onDonate?.(this.nationId, 'gold'));
    for (const emoji of EMOJIS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = emoji;
      b.setAttribute('aria-label', `Enviar ${emoji}`);
      b.addEventListener('click', () => this.handlers.onEmoji?.(this.nationId, emoji));
      $('pn-emojis').append(b);
    }

    // Propuestas recibidas
    this._requests = new Map(); // fromId → tarjeta
    $('solicitudes').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-from]');
      if (!btn) return;
      this.handlers.onRespondAlliance?.(Number(btn.dataset.from), btn.dataset.accept === '1');
      this._removeRequest(Number(btn.dataset.from));
    });

    this._buildButtons = new Map();
    for (const kind of BUILDING_KINDS) {
      const def = BUILDINGS[kind];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.kind = kind;
      btn.title = def.unit
        ? `${def.name}: ${def.desc} (tecla ${def.key.slice(3)})`
        : `${def.name}: ${def.desc}. Sobre uno tuyo: subir de nivel (tecla ${def.key.slice(3)})`;
      const icon = document.createElement('canvas');
      icon.width = 48;
      icon.height = 48;
      drawBuildingReal(icon.getContext('2d'), kind, 24, 24, 44);
      // Sin nombre (ocupa menos): el nombre sale al pasar el ratón
      btn.setAttribute('aria-label', def.name);
      const text = document.createElement('span');
      text.className = 'b-texto';
      text.innerHTML = '<span class="b-coste"></span>';
      const count = document.createElement('span');
      count.className = 'b-num';
      // La tecla, arriba a la izquierda
      const key = document.createElement('span');
      key.className = 'b-tecla';
      key.textContent = def.key.slice(3);
      btn.append(key, icon, text, count);
      btn.addEventListener('click', () => this.handlers.onBuildMode?.(kind));
      $('construir').append(btn);
      this._buildButtons.set(kind, btn);
    }

    // Clasificación, combates y avisos: cabecera que pliega el panel (se recuerda)
    this._unread = 0;
    for (const id of ['clasificacion', 'combates', 'avisos']) {
      this._foldable($(id), (folded) => {
        if (id === 'avisos' && !folded) this._setUnread(0);
      });
    }

    // Panel inferior: se puede minimizar (botón o tecla V); se recuerda
    const panel = $('panel-jugador');
    const setFolded = (folded) => {
      panel.classList.toggle('plegado', folded);
      $('pj-plegar').setAttribute('aria-expanded', String(!folded));
      $('pj-plegar').title = folded ? 'Mostrar el panel completo (tecla V)' : 'Minimizar el panel (tecla V)';
      try {
        localStorage.setItem('trinchera.panelPlegado', folded ? '1' : '0');
      } catch {
        // sin almacenamiento: solo dura esta visita
      }
    };
    let folded = false;
    try {
      folded = localStorage.getItem('trinchera.panelPlegado') === '1';
    } catch {
      folded = false;
    }
    setFolded(folded);
    $('pj-plegar').addEventListener('click', () => setFolded(!panel.classList.contains('plegado')));
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyV' || e.ctrlKey || e.metaKey || e.altKey || $('hud').hidden) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      setFolded(!panel.classList.contains('plegado'));
    });
    // Su altura real, para que los avisos se coloquen encima cuando no caben al lado
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        document.documentElement.style.setProperty('--pj-alto', `${Math.round(panel.offsetHeight)}px`);
      }).observe(panel);
    }

    $('lista-clasificacion').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (li) this.handlers.onFocusPlayer?.(Number(li.dataset.id));
    });

    // Tarjetas de combate: ✕ = retirarse; el resto de la tarjeta lleva la cámara al frente
    $('frentes').addEventListener('click', (e) => {
      const retreat = e.target.closest('button[data-target]');
      if (retreat) {
        this.handlers.onCancelAttack?.(Number(retreat.dataset.target));
        return;
      }
      const card = e.target.closest('[data-key]');
      if (card) this.handlers.onFocusFront?.(card.dataset.key);
    });
    $('frentes').addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.key) {
        e.preventDefault();
        this.handlers.onFocusFront?.(e.target.dataset.key);
      }
    });
  }

  on(handlers) {
    Object.assign(this.handlers, handlers);
  }

  /** Oculta la interfaz de partida (al volver al inicio). */
  hideHud() {
    $('hud').hidden = true;
    $('fin').hidden = true;
    $('confirmar').hidden = true;
    $('eventos').replaceChildren();
    this._setUnread(0);
  }

  /** Mensaje fijo de estado de la red (o vacío para quitarlo). */
  setNetNote(text) {
    const box = $('aviso');
    if (text) {
      box.textContent = text;
      box.hidden = false;
      box.dataset.red = '1';
    } else if (box.dataset.red) {
      delete box.dataset.red;
      box.hidden = true;
    }
  }

  showHud() {
    $('hud').hidden = false;
    $('fin').hidden = true;
    $('eventos').replaceChildren();
    this._setUnread(0);
    $('frentes').replaceChildren();
    $('combates').hidden = true;
    $('solicitudes').replaceChildren();
    $('lista-clasificacion').replaceChildren();
    this._requests.clear();
    for (const f of this._fronts.values()) this._dropFront(f);
    this._fronts.clear();
    this._lbRows.clear();
    this._lbAt = -Infinity;
    this._lbIndex.clear();
    for (const c of [this._troops, this._troopsMax, this._gold]) c.value = null;
    this.closeNation();
  }

  // ------------------------------------------------------------- diplomacia

  openNation(id) {
    this.nationId = id;
    this._breakArmedUntil = 0;
    $('panel-nacion').hidden = false;
  }

  closeNation() {
    this.nationId = 0;
    $('panel-nacion').hidden = true;
  }

  _updateNation(game, human, ratio) {
    if (!this.nationId) return;
    const p = game.players[this.nationId];
    if (!p || !p.alive) {
      this.closeNation();
      return;
    }
    const allied = human.allies.has(p.id);
    const swatch = $('pn-color');
    if (hasFlag(p.flag)) {
      swatch.className = 'bandera grande';
      swatch.style.cssText = flagCss(p.flag, 24);
    } else {
      swatch.className = 'muestra';
      swatch.style.cssText = `background:${rgbToCss(p.color)}`;
    }
    $('pn-nombre').textContent = p.name;
    $('pn-tropas').textContent = formatNumber(p.troops);
    $('pn-terr').textContent = formatPercent(p.tiles / game.map.landCount);
    $('pn-aliados').textContent = p.allies.size
      ? [...p.allies].map((id) => game.players[id].name).join(', ')
      : 'ninguno';

    const chip = $('pn-relacion');
    let relation = 'Neutral';
    let tone = '';
    if (allied) [relation, tone] = ['Aliado', 'bien'];
    else if (p.attacks.has(human.id)) [relation, tone] = ['Te ataca', 'mal'];
    else if (human.attacks.has(p.id)) [relation, tone] = ['En guerra', 'mal'];
    if (game.isTraitor(p)) [relation, tone] = [allied ? 'Aliado · traidor' : 'Traidor', 'mal'];
    chip.textContent = relation;
    chip.className = `chip ${tone}`;

    const btn = $('pn-alianza');
    const playing = game.phase === 'playing' && human.alive;
    let note = '';
    if (allied) {
      btn.dataset.action = 'break';
      if (performance.now() >= this._breakArmedUntil) btn.textContent = 'Romper alianza';
      btn.disabled = !playing;
      btn.className = 'peligro';
      note = `Romperla te marca como traidor ${CONFIG.traitorTicks / 10} s y te hace más fácil de conquistar.`;
    } else {
      btn.dataset.action = 'propose';
      btn.className = 'principal';
      const check = game.canPropose(human, p);
      const incoming = game.pendingRequest(p.id, human.id);
      btn.textContent = incoming ? 'Aceptar su alianza' : check.ok ? 'Proponer alianza' : check.reason;
      btn.disabled = !playing || (!check.ok && !incoming);
      if (game.isTraitor(p)) note = 'Ha traicionado una alianza hace poco.';
    }
    const pct = Math.round(ratio * 100);
    $('pn-env-tropas').textContent = `Enviar ${pct}% tropas (${formatNumber(human.troops * ratio)})`;
    $('pn-env-oro').textContent = `Enviar ${pct}% oro (${formatNumber(human.gold * ratio)})`;
    $('pn-env-tropas').disabled = $('pn-env-oro').disabled = !allied || !playing;
    if (!allied && !note) note = 'Solo puedes enviar tropas y oro a tus aliados. La cantidad sigue la fuerza de ataque.';
    $('pn-nota').textContent = note;
  }

  addRequest(game, evt) {
    if (this._requests.has(evt.fromId)) return;
    const p = game.players[evt.fromId];
    const card = document.createElement('div');
    card.className = 'solicitud';
    card.innerHTML = `
      <div class="sol-texto"><span class="muestra" style="background:${rgbToCss(p.color)}"></span>
        <span><b>${escapeHtml(p.name)}</b> te propone una alianza</span></div>
      <div class="sol-botones">
        <button type="button" data-from="${p.id}" data-accept="0">Rechazar</button>
        <button type="button" class="principal" data-from="${p.id}" data-accept="1">Aceptar</button>
      </div>
      <div class="sol-tiempo"><div></div></div>`;
    $('solicitudes').prepend(card);
    this._requests.set(evt.fromId, card);
  }

  _removeRequest(fromId) {
    this._requests.get(fromId)?.remove();
    this._requests.delete(fromId);
  }

  _updateRequests(game, human) {
    for (const [fromId, card] of this._requests) {
      const req = game.pendingRequest(fromId, human.id);
      if (!req) {
        this._removeRequest(fromId);
        continue;
      }
      const left = Math.max(0, (req.expires - game.ticks) / CONFIG.allianceRequestTicks);
      card.querySelector('.sol-tiempo div').style.width = `${left * 100}%`;
    }
  }

  confirmExit() {
    $('confirmar').hidden = false;
    $('conf-no').focus();
  }

  /** `progress`: { xp, level, levelUp, achievements: [{icon, name}] } o null. */
  showEnd(title, text, progress = null) {
    $('fin-titulo').textContent = title;
    $('fin-texto').textContent = text;
    const box = $('fin-progreso');
    box.replaceChildren();
    if (progress) {
      const xp = document.createElement('p');
      xp.className = 'fin-xp';
      xp.textContent = `+${progress.xp} XP${progress.levelUp ? ` · ¡Subes al nivel ${progress.level}!` : ''}`;
      box.append(xp);
      for (const a of progress.achievements) {
        const li = document.createElement('p');
        li.className = 'fin-logro';
        li.textContent = `${a.icon} Logro conseguido: ${a.name}`;
        box.append(li);
      }
    }
    $('fin').hidden = false;
  }

  hideEnd() {
    $('fin').hidden = true;
  }

  setRatio(r) {
    $('ratio').value = Math.round(r * 100);
    $('ratio-valor').textContent = `${Math.round(r * 100)}%`;
  }

  pushEvent(evt) {
    // Respuestas a tus acciones: una pista breve encima del panel
    if (evt.feedback) {
      this._hint(stripLeadingEmoji(evt.text), evt.kind);
      return;
    }
    if (!isImportant(evt.text)) return;
    const box = $('eventos');
    const now = performance.now();
    // El mismo aviso varias veces seguidas: un solo aviso con contador
    const last = this._lastEvent;
    if (last && last.text === evt.text && now - last.at < 4000 && last.el.isConnected) {
      last.count++;
      last.at = now;
      last.el.querySelector('.ev-veces').textContent = `×${last.count}`;
      last.el.classList.remove('rebote');
      void last.el.offsetWidth; // reinicia la animación del rebote
      last.el.classList.add('rebote');
      return;
    }
    const el = document.createElement('div');
    const cat = eventCategory(evt.text);
    el.className = `evento ${evt.kind || 'info'} cat-${cat}`;
    el.style.setProperty('--dur', `${EVENT_MS}ms`);
    const icon = document.createElement('span');
    icon.className = 'ev-icono';
    icon.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${EVENT_ICONS[cat]}</svg>`;
    const text = document.createElement('span');
    text.className = 'ev-texto';
    text.textContent = stripLeadingEmoji(evt.text);
    const times = document.createElement('span');
    times.className = 'ev-veces';
    const bar = document.createElement('span');
    bar.className = 'ev-tiempo';
    el.append(icon, text, times, bar);
    // Los nuevos entran por abajo, junto a la esquina; los viejos suben y se van
    box.append(el);
    this._lastEvent = { text: evt.text, at: now, count: 1, el };
    const live = [...box.children].filter((c) => !c.classList.contains('saliendo'));
    for (const old of live.slice(0, Math.max(0, live.length - MAX_EVENTS))) this._dismissEvent(old);
    setTimeout(() => this._dismissEvent(el), EVENT_MS);
    if ($('avisos').classList.contains('plegado')) {
      this._setUnread(this._unread + 1);
      const cab = $('avisos').querySelector('.cab-plegable');
      cab.classList.remove('aviso-nuevo', 'aviso-peligro');
      void cab.offsetWidth;
      cab.classList.add(evt.kind === 'danger' ? 'aviso-peligro' : 'aviso-nuevo');
    }
    this._syncAvisos();
  }

  /** Pista breve (2,5 s) encima del panel de abajo. */
  _hint(text, kind = 'info') {
    const el = $('pista');
    el.textContent = text;
    el.className = `pista ${kind}`;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('visible');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      el.classList.remove('visible');
      this._hintTimer = setTimeout(() => {
        el.hidden = true;
      }, 300);
    }, 2500);
  }

  /** Sale deslizándose a la derecha y se pliega para que los demás bajen sin saltos. */
  _dismissEvent(el) {
    if (!el.isConnected || el.classList.contains('saliendo')) return;
    el.style.maxHeight = `${el.offsetHeight}px`;
    void el.offsetHeight;
    el.classList.add('saliendo');
    setTimeout(() => {
      el.remove();
      this._syncAvisos();
    }, 450);
  }

  /** El recuadro de avisos se oculta si no hay ninguno (salvo plegado, para poder abrirlo). */
  _syncAvisos() {
    $('avisos').classList.toggle('vacio', !$('eventos').children.length && !this._unread);
  }

  _setUnread(n) {
    this._unread = n;
    const badge = $('cab-avisos');
    badge.textContent = n ? String(n) : '';
    badge.classList.toggle('nuevos', n > 0);
    this._syncAvisos();
  }

  /**
   * Panel plegable: la cabecera (.cab-plegable) pliega o despliega el cuerpo.
   * El estado se recuerda en este navegador. `onChange(folded)` opcional.
   */
  _foldable(section, onChange) {
    const key = `trinchera.plegado.${section.dataset.plegable}`;
    const btn = section.querySelector('.cab-plegable');
    const set = (folded, save = true) => {
      section.classList.toggle('plegado', folded);
      btn.setAttribute('aria-expanded', String(!folded));
      if (save) {
        try {
          localStorage.setItem(key, folded ? '1' : '0');
        } catch {
          // sin almacenamiento: dura esta visita
        }
      }
      onChange?.(folded);
    };
    let folded = false;
    try {
      folded = localStorage.getItem(key) === '1';
    } catch {
      folded = false;
    }
    set(folded, false);
    btn.addEventListener('click', () => set(!section.classList.contains('plegado')));
  }

  _counter(el, fmt) {
    const c = new Counter(el, fmt);
    this._counters.add(c);
    return c;
  }

  /** Avanza las cifras animadas (llamar en cada frame). */
  animate(dt) {
    for (const c of this._counters) c.step(dt);
  }

  update(game, human, ratio, buildMode) {
    const landCount = game.map.landCount;

    // Aviso central: despliegue o construcción en curso
    const aviso = $('aviso');
    if (aviso.dataset.red) {
      // el estado de la red tiene prioridad
    } else if (game.phase === 'spawn') {
      const left = Math.max(0, Math.ceil(((CONFIG.spawnTicks - game.ticks) * TICK_MS) / 1000));
      aviso.textContent = human.spawned
        ? `Posición elegida. Puedes cambiarla. Empieza en ${left} s`
        : `Haz clic en el mapa para elegir dónde empezar. Quedan ${left} s`;
      aviso.hidden = false;
    } else if (buildMode) {
      const def = BUILDINGS[buildMode];
      const cost = formatNumber(game.buildCost(human, buildMode));
      if (def.unit === 'missile') {
        aviso.textContent = `Elige un objetivo enemigo para el misil (${cost} de oro). Esc para cancelar`;
      } else if (def.unit === 'ship') {
        aviso.textContent = `Haz clic en el mar donde patrullará el buque (${cost} de oro): la zona no se podrá cambiar. Esc para cancelar`;
      } else {
        const where = def.coastal ? 'en tu costa' : 'en tu territorio';
        const up = ` · Sobre ${def.fem ? 'una' : 'uno'} tuy${def.fem ? 'a' : 'o'}: subir de nivel`;
        aviso.textContent = `Toca ${where} para construir: ${def.name} (${cost} de oro)${up}. Esc para cancelar`;
      }
      aviso.hidden = false;
    } else {
      aviso.hidden = true;
    }

    const playingTicks = Math.max(0, game.ticks - CONFIG.spawnTicks);
    $('reloj').textContent = formatTime((playingTicks * TICK_MS) / 1000);

    // Panel del jugador
    $('pj-color').style.background = rgbToCss(human.color);
    $('panel-jugador').style.setProperty('--pj-color', rgbToCss(human.color));
    $('pj-nombre').textContent = human.name;
    const max = human.maxTroops();
    $('pj-estado').textContent = human.alive ? '' : 'Derrotado · modo espectador';
    const fill = Math.min(1, human.troops / max);
    $('pj-barra').style.width = `${fill * 100}%`;
    // Casi al máximo: la barra brilla (buen momento para atacar)
    $('pj-barra').parentElement.classList.toggle('lleno', fill >= 0.95 && human.alive);
    const perSecond = 1000 / TICK_MS;
    const playing = game.phase === 'playing';
    this._troops.set(human.troops);
    this._troopsMax.set(max);
    $('pj-crec').textContent = playing ? `+${formatNumber(human.growthPerTick() * perSecond)}/s` : '';
    this._gold.set(human.gold);
    $('pj-oro-ritmo').textContent = playing ? `+${formatNumber(human.goldPerTick() * perSecond)}/s` : '';
    $('pj-terr').textContent = formatPercent(human.tiles / landCount);
    $('pj-barcos').textContent = `${human.boatCount}/${human.maxBoats()}`;
    $('pj-buques').textContent = human.buildings.warship ? `${human.buildings.warship} buque${human.buildings.warship > 1 ? 's' : ''}` : '';
    $('ratio-valor').textContent = `${Math.round(ratio * 100)}%`;
    $('ratio-tropas').textContent = `${formatNumber(human.troops * ratio)} tropas`;
    $('ratio').style.setProperty('--valor', `${Math.round(ratio * 100)}%`);

    const works = {};
    for (const b of game.sites) if (b.owner === human.id) works[b.kind] = (works[b.kind] || 0) + 1;
    for (const [kind, btn] of this._buildButtons) {
      const cost = game.buildCost(human, kind);
      let unavailable = human.gold < cost;
      // Lo que falta para poder pagarlo, como relleno del botón
      btn.style.setProperty('--progreso', `${Math.round(Math.min(1, human.gold / cost) * 100)}%`);
      btn.classList.toggle('en-obras', !!works[kind]);
      if (kind === 'missile') {
        // Coste y silos listos
        const silos = game.buildings.filter((b) => b.owner === human.id && b.kind === 'silo');
        const ready = silos.filter((b) => b.readyAt <= game.ticks).length;
        btn.querySelector('.b-coste').textContent = silos.length ? `${formatNumber(cost)} · ${ready}/${silos.length}` : formatNumber(cost);
        btn.querySelector('.b-num').textContent = '';
        unavailable = unavailable || !ready;
      } else {
        btn.querySelector('.b-coste').textContent = formatNumber(cost);
        btn.querySelector('.b-num').textContent = human.buildings[kind] ? `×${human.buildings[kind]}${works[kind] ? ' 🔨' : ''}` : '';
      }
      btn.classList.toggle('caro', unavailable);
      btn.hidden = !game.isAllowed(kind);
      btn.classList.toggle('activo', buildMode === kind);
      btn.disabled = !playing || !human.alive;
    }

    this._updateAttacks(game, human);
    this._updateTopBar(game, human);
    this._updateThreat(game, human);
    this._updateLeaderboard(game, human, landCount);
    this._updateNation(game, human, ratio);
    this._updateRequests(game, human);
  }

  /**
   * Borde rojo mientras te atacan (desactivable en Ajustes). Su intensidad va
   * de 0 a 1 según cuánto te atacan: tropas enemigas frente a las tuyas,
   * cuántos atacantes y si hay misiles en camino. Sube y baja poco a poco.
   */
  _updateThreat(game, human) {
    const box = $('alerta-roja');
    let incoming = 0;
    let fronts = 0;
    if (this.redAlert !== false && human.alive) {
      for (const a of game.attacks) {
        if (!a.done && a.targetId === human.id && a.troops >= 1) {
          incoming += a.troops;
          fronts++;
        }
      }
      for (const b of game.boats) {
        if (b.targetId === human.id) {
          incoming += b.troops;
          fronts++;
        }
      }
    }
    const missiles = this.redAlert !== false && human.alive ? game.missiles.filter((m) => m.targetId === human.id).length : 0;
    let target = 0;
    if (fronts || missiles) {
      const ratio = incoming / Math.max(1, human.troops);
      target = Math.min(1, 0.12 + Math.min(0.5, ratio * 0.45) + (fronts - 1) * 0.1 + missiles * 0.3);
    }
    this._threat = (this._threat || 0) + (target - (this._threat || 0)) * 0.35;
    if (this._threat < 0.02) this._threat = 0;
    box.style.setProperty('--amenaza', this._threat.toFixed(3));
    box.classList.toggle('activa', this._threat > 0);
  }

  /**
   * Tarjetas de combate a la derecha: quién ataca a quién y con cuántas tropas
   * (ataques, desembarcos y misiles en los que participa el jugador). Las que
   * le atacan van primero y en rojo. Clic = la cámara va a ese frente.
   *
   * Sin parpadeos: cada tarjeta se crea una vez y se actualiza en su sitio;
   * solo se mueve si cambia el orden, y al terminar el combate se queda un
   * momento atenuada en vez de desaparecer (un ataque que se reanuda enseguida
   * reutiliza su tarjeta).
   */
  _updateAttacks(game, human) {
    const list = $('frentes');
    const now = performance.now();
    const cards = [];
    const side = (p, fallback) =>
      p ? { name: p === human ? 'Tú' : p.name, flag: p.flag, color: p.color, me: p === human } : { name: fallback, flag: '', color: null };
    for (const atk of game.attacks) {
      if (atk.done || atk.troops < 1) continue;
      const mine = atk.attacker === human;
      const incoming = atk.targetId === human.id;
      if (!mine && !incoming) continue;
      const target = atk.targetId ? game.players[atk.targetId] : null;
      cards.push({
        key: `a${atk.attacker.id}-${atk.targetId}`,
        kind: target ? 'ataque' : 'expansion',
        incoming,
        left: side(atk.attacker),
        right: side(target, 'Tierra libre'),
        a: atk.troops,
        d: target ? target.troops : null,
        middle: target ? 'VS' : 'Expansión',
        captions: incoming
          ? ['te ataca con', 'tus tropas']
          : target ? ['atacas con', 'sus tropas'] : ['expandes con', ''],
        retreat: mine ? atk.targetId : null,
      });
    }
    for (const b of game.boats) {
      const mine = b.owner === human.id;
      const incoming = b.targetId === human.id;
      if (!mine && !incoming) continue;
      const target = b.targetId ? game.players[b.targetId] : null;
      cards.push({
        key: `b${b.id}`,
        kind: 'desembarco',
        incoming,
        left: side(game.players[b.owner]),
        right: side(target, 'Tierra libre'),
        a: b.troops,
        d: target ? target.troops : null,
        middle: 'Desembarco',
        captions: incoming
          ? ['desembarca con', 'tus tropas']
          : target ? ['desembarcas con', 'sus tropas'] : ['desembarcas con', ''],
      });
    }
    for (const m of game.missiles) {
      const mine = m.owner === human.id;
      const incoming = m.targetId === human.id;
      if (!mine && !incoming) continue;
      cards.push({
        key: `m${m.id}`,
        kind: 'misil',
        incoming,
        left: side(game.players[m.owner]),
        right: side(game.players[m.targetId], '—'),
        a: null,
        aText: 'Misil',
        d: null,
        dText: `${Math.max(0, Math.ceil(((1 - m.progress) * m.dist) / CONFIG.missileSpeed / (1000 / TICK_MS)))} s`,
        progress: m.progress,
        middle: 'Impacto',
        captions: [incoming ? 'misil enemigo' : 'tu misil', 'impacta en'],
      });
    }
    cards.sort((x, y) => Number(y.incoming) - Number(x.incoming));

    const shown = cards.slice(0, MAX_FRONTS);
    const live = new Set();
    shown.forEach((c, i) => {
      live.add(c.key);
      let f = this._fronts.get(c.key);
      if (!f) {
        f = this._newFront(c);
        this._fronts.set(c.key, f);
      }
      if (f.gone) {
        f.gone = 0;
        f.li.classList.remove('saliendo');
        f.vs.textContent = c.middle;
      }
      // Cifras (animadas) y barra de fuerzas
      if (c.a === null) f.aEl.textContent = c.aText;
      else f.a.set(c.a);
      if (c.d === null) f.dEl.textContent = c.dText || '—';
      else {
        // El defensor pierde tropas: la cifra «encaja el golpe»
        if (f.lastD !== undefined && c.d < f.lastD * 0.985) this._pulse(f.dEl, 'golpe', now);
        f.lastD = c.d;
        f.d.set(c.d);
      }
      const share = c.kind === 'misil' ? c.progress : c.d === null ? 1 : c.a / (c.a + Math.max(1, c.d));
      const pct = Math.round(Math.max(0.04, Math.min(1, share)) * 100);
      f.barA.style.width = `${pct}%`;
      f.barD.style.width = `${100 - pct}%`;
      // Solo se mueve si no está ya en su sitio (moverla reiniciaría animaciones)
      if (list.children[i] !== f.li) list.insertBefore(f.li, list.children[i] || null);
    });
    for (const [key, f] of this._fronts) {
      if (live.has(key)) continue;
      if (!f.gone) {
        f.gone = now;
        f.li.classList.add('saliendo');
        f.vs.textContent = 'Fin';
      } else if (now - f.gone > FRONT_GRACE_MS) {
        this._dropFront(f);
        this._fronts.delete(key);
      }
    }
    // Cabecera: cuántos te atacan y cuántos ataques tuyos hay
    const inc = cards.filter((c) => c.incoming).length;
    const out = cards.length - inc;
    const box = $('combates');
    box.hidden = !list.querySelector('.frente');
    box.classList.toggle('amenaza', inc > 0);
    $('cab-combates').innerHTML = `${inc ? `<span class="cc-rojo">🛡 ${inc}</span>` : ''}${out ? `<span class="cc-verde">⚔ ${out}</span>` : ''}`;
    let more = this._moreFronts;
    if (cards.length > MAX_FRONTS) {
      if (!more) {
        more = this._moreFronts = document.createElement('li');
        more.className = 'f-mas';
      }
      more.textContent = `y ${cards.length - MAX_FRONTS} combate${cards.length - MAX_FRONTS > 1 ? 's' : ''} más`;
      if (list.lastElementChild !== more) list.append(more);
    } else if (more) {
      more.remove();
    }
  }

  /** Reinicia una animación CSS en `el` (como mucho cada 1,5 s: sin agobiar). */
  _pulse(el, cls, now) {
    if (now - (el._pulseAt || 0) < 1500) return;
    el._pulseAt = now;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  _dropFront(f) {
    f.li.remove();
    this._counters.delete(f.a);
    this._counters.delete(f.d);
  }

  /** Crea una tarjeta "A · tropas  VS  tropas · B" (una sola vez por combate). */
  _newFront(c) {
    const li = document.createElement('li');
    li.className = `frente ${c.incoming ? 'entrante' : 'saliente'} tipo-${c.kind} nueva`;
    li.addEventListener('animationend', () => li.classList.remove('nueva'), { once: true });
    li.dataset.key = c.key;
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.title = 'Ir a este frente';
    const who = (s, align) => {
      const box = document.createElement('span');
      box.className = `f-lado ${align}${s.me ? ' yo' : ''}`;
      const mark = document.createElement('span');
      if (hasFlag(s.flag)) {
        mark.className = 'bandera';
        mark.style.cssText = flagCss(s.flag, 16);
      } else {
        mark.className = 'muestra';
        mark.style.background = s.color ? rgbToCss(s.color) : 'transparent';
      }
      const name = document.createElement('span');
      name.className = 'f-nombre';
      name.textContent = s.name;
      if (align === 'der') box.append(name, mark);
      else box.append(mark, name);
      return box;
    };
    const top = document.createElement('div');
    top.className = 'f-fila';
    top.append(who(c.left, 'izq'), who(c.right, 'der'));
    const mid = document.createElement('div');
    mid.className = 'f-fila f-cifras';
    const aEl = document.createElement('strong');
    aEl.className = 'f-a';
    const vs = document.createElement('span');
    vs.className = 'f-vs';
    vs.textContent = c.middle;
    const dEl = document.createElement('strong');
    dEl.className = 'f-d';
    mid.append(aEl, vs, dEl);
    // Qué es cada cifra («te ataca con» / «tus tropas»…)
    const legend = document.createElement('div');
    legend.className = 'f-fila f-leyenda';
    for (const text of c.captions || ['', '']) {
      const s = document.createElement('span');
      s.textContent = text;
      legend.append(s);
    }
    // Barra de fuerzas: atacante (rojo si te atacan, verde si atacas) frente a defensor
    const bar = document.createElement('div');
    bar.className = 'f-barra';
    const barA = document.createElement('span');
    barA.className = 'f-barra-a';
    const barD = document.createElement('span');
    barD.className = 'f-barra-d';
    bar.append(barA, barD);
    li.append(top, mid, legend, bar);
    li.setAttribute('aria-label', c.incoming ? `Te atacan: ${c.left.name}` : `Atacas: ${c.right.name}`);
    if (c.retreat !== null && c.retreat !== undefined) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'f-retirar';
      btn.dataset.target = c.retreat;
      btn.title = 'Retirarse (se pierde la mitad de las tropas del ataque)';
      btn.setAttribute('aria-label', 'Retirarse');
      btn.textContent = '✕';
      li.append(btn);
    }
    $('frentes').append(li);
    return { li, vs, aEl, dEl, barA, barD, a: this._counter(aEl), d: this._counter(dEl), gone: 0 };
  }

  /** Barra superior: tu puesto y el líder frente a la meta de victoria. */
  _updateTopBar(game, human) {
    const alive = game.players.filter((p) => p && p.alive && p.tiles > 0).sort((a, b) => b.tiles - a.tiles);
    const rank = alive.indexOf(human);
    $('dato-puesto').textContent = rank >= 0 ? `${rank + 1}.º de ${alive.length}` : `${alive.length} en pie`;
    const leader = alive[0];
    const goal = Math.round(game.rules.winShare * 100);
    if (leader) {
      const share = Math.round((leader.tiles / game.map.landCount) * 100);
      $('dato-lider').textContent = `${leader === human ? 'Tú' : leader.name} ${share} % / ${goal} %`;
      $('dato-lider-caja').classList.toggle('cerca', share >= goal * 0.75 && leader !== human);
    }
  }

  /**
   * Clasificación con filas estables: se actualizan en su sitio y, si alguien
   * sube o baja de puesto, la fila se desliza hasta su nueva posición.
   */
  _updateLeaderboard(game, human, landCount) {
    // Una vez por segundo: con muchos jugadores el orden cambia sin parar y
    // las animaciones de las filas se pisaban (y medirlas cuesta)
    const now = performance.now();
    if (now - this._lbAt < 950) return;
    this._lbAt = now;
    const list = $('lista-clasificacion');
    const alive = game.players.filter((p) => p && p.alive && p.tiles > 0).sort((a, b) => b.tiles - a.tiles);
    const rows = alive.slice(0, 10);
    const rank = alive.indexOf(human);
    if (rank >= 10) rows.push(human);
    $('cab-puesto').textContent = rank >= 0 ? `${rank + 1}.º` : '';
    const leaderTiles = alive.length ? alive[0].tiles : 1;
    const animate = !document.body.classList.contains('sin-animaciones');
    const before = new Map();
    if (animate) for (const [id, li] of this._lbRows) before.set(id, li.getBoundingClientRect().top);

    rows.forEach((p, i) => {
      let li = this._lbRows.get(p.id);
      if (!li) {
        li = document.createElement('li');
        li.dataset.id = p.id;
        li.innerHTML = '<span class="pos"></span><span class="marca-pais"></span><span class="nom"><span class="nom-txt"></span><span class="marcas"></span></span><span class="pct"></span><span class="tro"></span><span class="lb-barra"><span></span></span>';
        const mark = li.querySelector('.marca-pais');
        if (hasFlag(p.flag)) {
          mark.className = 'marca-pais bandera';
          mark.style.cssText = flagCss(p.flag, 16);
        } else {
          mark.className = 'marca-pais muestra';
          mark.style.background = rgbToCss(p.color);
        }
        li.querySelector('.nom-txt').textContent = p.name;
        this._lbRows.set(p.id, li);
      }
      const rank = alive.indexOf(p) + 1;
      const set = (sel, text) => {
        const el = li.querySelector(sel);
        if (el.textContent !== text) el.textContent = text;
      };
      set('.pos', String(rank));
      set('.pct', formatPercent(p.tiles / landCount));
      set('.tro', formatNumber(p.troops));
      set('.marcas', `${human.allies.has(p.id) ? ' 🤝' : ''}${game.isTraitor(p) ? ' ⚠' : ''}`);
      li.querySelector('.lb-barra span').style.width = `${Math.round((p.tiles / leaderTiles) * 100)}%`;
      li.classList.toggle('yo', p === human);
      li.classList.toggle('aliado', human.allies.has(p.id));
      li.classList.toggle('colonia', !!p.weak);
      // Destello al subir o bajar de puesto
      const prev = this._lbIndex.get(p.id);
      if (prev !== undefined && prev !== rank && animate) {
        li.classList.remove('sube', 'baja');
        void li.offsetWidth;
        li.classList.add(rank < prev ? 'sube' : 'baja');
      }
      this._lbIndex.set(p.id, rank);
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
    });
    const keep = new Set(rows.map((p) => p.id));
    for (const [id, li] of this._lbRows) {
      if (!keep.has(id)) {
        li.remove();
        this._lbRows.delete(id);
      }
    }
    // FLIP: cada fila que cambió de posición parte de donde estaba
    if (animate) {
      for (const [id, top] of before) {
        const li = this._lbRows.get(id);
        if (!li) continue;
        const dy = top - li.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) continue;
        li.style.transition = 'none';
        li.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          li.style.transition = 'transform 0.35s ease';
          li.style.transform = '';
        });
      }
    }
  }

  updateTooltip(game, tile, sx, sy) {
    const tip = $('tooltip');
    if (tile < 0) {
      tip.hidden = true;
      return;
    }
    const map = game.map;
    const terrain = TERRAIN_NAMES[map.terrain[tile]];
    if (!map.isLand(tile)) {
      tip.hidden = true;
      return;
    }
    const o = game.owner[tile];
    if (o) {
      const p = game.players[o];
      const b = game.buildingNear(tile, 2 * RES);
      const extra = [];
      if (b) {
        const lvl = b.level ? ` nv. ${b.level}` : '';
        const work = b.target ? ` · obras ${Math.round(game.buildProgress(b) * 100)} %` : '';
        extra.push(`${BUILDINGS[b.kind].name}${lvl}${work}`);
      }
      if (game.fortMultiplier(p, tile) > 1) extra.push('zona fortificada');
      extra.push(terrain);
      const human = game.human;
      const tag = p === human ? ' (tú)' : human && human.allies.has(p.id) ? ' · 🤝 aliado' : game.isTraitor(p) ? ' · traidor' : p.weak ? ' · colonia' : '';
      tip.innerHTML = `<b>${escapeHtml(p.name)}</b>${tag}<br>
        ${formatNumber(p.troops)} tropas · ${formatPercent(p.tiles / map.landCount)}<br>
        <span class="suave">${extra.join(' · ')}</span>`;
    } else {
      tip.innerHTML = `<b>Tierra libre</b><br><span class="suave">${terrain}</span>`;
    }
    tip.hidden = false;
    const w = tip.offsetWidth;
    const left = sx + 16 + w > window.innerWidth ? sx - 16 - w : sx + 16;
    tip.style.left = `${left}px`;
    tip.style.top = `${sy + 16}px`;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
