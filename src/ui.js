// Interfaz HTML de la partida: panel del jugador, clasificación, diplomacia,
// eventos, tooltip y pantalla de fin. (El inicio está en home.js.)
import { BUILDINGS, BUILDING_KINDS, CONFIG, EMOJIS, RES, TERRAIN_NAMES, TICK_MS } from './config.js';
import { rgbToCss } from './colors.js';
import { fmtTroops, fmtTroopsCount, formatCount, formatNumber, formatPercent, formatShare, formatTime, hudSnapshot } from './format.js';
import { drawBuildingReal, flagCss, hasFlag } from './icons.js';
import { POI_TYPES } from './estrategia.js';
import { BRANCHES, SPECS, SPEC_IDS, TECHS, TECH_IDS, techAvailable } from './tecnologias.js';
import { MECH, regenPerTick, tradeGold } from './mecanicas.js';

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
 * Solo los avisos importantes llegan al recuadro: paces y roturas, jugadores
 * derrotados (la muerte de los bots no), a quién conquistas tú, barcos y
 * misiles contra ti, tu puerto destruido, logros e inicio. El resto (obras, saqueos, tus propios ataques…) ya se ve en el
 * mapa o en las tarjetas de combate.
 */
const IMPORTANT = [
  /alianza|traiciona|traidor/i,
  /eliminad|derrotad|has conquistado/i,
  /^💡|pacto|paz firmada|te ofrece la paz|🆘|^⭐|investigada|capitales|supremacía/i,
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
/**
 * Cifra animada: cuando cambia el objetivo, va hasta él a ritmo constante en
 * `dur` ms. Si el objetivo cambia a cada turno y `dur` dura lo mismo que un
 * turno, la cifra cuenta de forma continua (sin acelerones ni frenazos).
 */
class Counter {
  constructor(el, fmt = formatNumber, dur = 210) {
    this.el = el;
    this.fmt = fmt;
    this.dur = dur;
    this.value = null;
    this.target = 0;
    this.from = 0;
    this.t = 0;
    this.text = '';
  }

  set(target) {
    if (this.value === null) {
      this.value = this.target = this.from = target;
      this._write();
      return;
    }
    if (target === this.target) return;
    this.target = target;
    this.from = this.value;
    this.t = 0;
  }

  step(dt) {
    if (this.value === null || this.value === this.target) return;
    this.t += dt;
    const k = Math.min(1, this.t / this.dur);
    this.value = this.from + (this.target - this.from) * k;
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
    this._ratio = 0.2;
    this._fronts = new Map(); // clave → { li, a, d, gone }
    this._lbRows = new Map(); // id → fila de la clasificación
    this._lbAt = -Infinity; // última vez que se actualizó
    this._lbIndex = new Map();
    this._counters = new Set();
    this._lastEvent = null;
    // Las del panel cambian a cada turno (cada 100 ms): se animan en lo que dura uno
    // La reserva no se anima: cambia de golpe en cada turno, igual que el próximo envío (hudSnapshot)
    this._snap = null;
    this._pop = this._counter($('pj-pob'), fmtTroopsCount, 115);
    this._troopsMax = this._counter($('pj-tropas-max'), fmtTroops, 115);
    this._gold = this._counter($('pj-oro'), formatCount, 115);
    this._liveTick = -1;

    $('ratio').addEventListener('input', () => this.handlers.onRatio?.(Number($('ratio').value) / 100));
    // Reparto soldados / trabajadores: se envía al soltar y, mientras se
    // arrastra, como mucho cada 0,25 s (en multijugador va por la red)
    const reparto = $('reparto');
    const sendShare = () => {
      this._shareSentAt = performance.now();
      this.handlers.onShare?.(Number(reparto.value) / 100);
    };
    reparto.addEventListener('input', () => {
      this._shareDragAt = performance.now();
      this._showShare(Number(reparto.value) / 100);
      if (!(performance.now() - (this._shareSentAt || 0) < 250)) sendShare();
    });
    reparto.addEventListener('change', sendShare);

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

    // Diplomacia ampliada: pacto (romperlo pide confirmación), paz y ayuda
    this._pactArmedUntil = 0;
    $('pn-pacto').addEventListener('click', () => {
      const id = this.nationId;
      if (!id) return;
      if ($('pn-pacto').dataset.action === 'break') {
        if (performance.now() < this._pactArmedUntil) {
          this._pactArmedUntil = 0;
          this.handlers.onPact?.(id, false);
        } else {
          this._pactArmedUntil = performance.now() + 4000;
          $('pn-pacto').textContent = '¿Romper el pacto? Pulsa otra vez';
        }
      } else this.handlers.onPact?.(id, true);
    });
    $('pn-paz').addEventListener('click', () => this.handlers.onPeace?.(this.nationId, Number($('pn-tributo').value)));
    $('pn-ayuda').addEventListener('click', () => this.handlers.onAskHelp?.());

    // Panel de desarrollo
    $('btn-desarrollo').addEventListener('click', () => this.toggleDev());
    $('pd-cerrar').addEventListener('click', () => this.toggleDev(false));
    for (const tab of document.querySelectorAll('[data-pd]')) {
      tab.addEventListener('click', () => this._devTab(tab.dataset.pd));
    }
    $('pd-economia').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-spec]');
      if (b && !b.disabled) this.handlers.onSpec?.(b.dataset.spec);
    });
    $('pd-tecnologias').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tech]');
      if (b && !b.disabled) this.handlers.onResearch?.(b.dataset.tech);
    });

    // Propuestas recibidas (alianza, pacto o paz)
    this._requests = new Map(); // clave → tarjeta
    $('solicitudes').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-from]');
      if (!btn) return;
      const from = Number(btn.dataset.from);
      const accept = btn.dataset.accept === '1';
      const kind = btn.dataset.offer || '';
      if (kind) this.handlers.onRespondOffer?.(from, kind, accept);
      else this.handlers.onRespondAlliance?.(from, accept);
      this._removeRequest(kind ? `${kind}:${from}` : from);
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
      $('hud').classList.toggle('pj-plegado', folded);
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
      if (e.ctrlKey || e.metaKey || e.altKey || $('hud').hidden) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      // Atajos: V panel, I desarrollo
      if (e.code === 'KeyV') setFolded(!panel.classList.contains('plegado'));
      else if (e.code === 'KeyI') this.toggleDev();
    });
    // En el ordenador (pantalla ancha y ratón): edificios en una barra propia
    // abajo en el centro y el resto del panel abajo a la izquierda. En el
    // móvil y las pantallas estrechas, todo junto como siempre.
    const obras = panel.querySelector('.pj-obras');
    const wide = window.matchMedia?.('(min-width: 1100px) and (min-height: 620px) and (hover: hover) and (pointer: fine)');
    const layout = () => {
      const desk = !!wide?.matches;
      $('hud').classList.toggle('escritorio', desk);
      $('barra-obras').hidden = !desk;
      if (desk && obras.parentElement !== $('barra-obras')) $('barra-obras').append(obras);
      else if (!desk && obras.parentElement !== panel) panel.append(obras);
    };
    layout();
    wide?.addEventListener?.('change', layout);
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
    for (const c of [this._pop, this._troopsMax, this._gold]) c.value = null;
    this._snap = null;
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
    $('pn-tropas').textContent = fmtTroops(p.troops);
    $('pn-terr').textContent = formatShare(p.tiles, game.map.landCount);
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
    $('pn-env-tropas').textContent = `Enviar ${pct}% tropas (${fmtTroops(human.troops * ratio)})`;
    $('pn-env-oro').textContent = `Enviar ${pct}% oro (${formatNumber(human.gold * ratio)})`;
    $('pn-env-tropas').disabled = $('pn-env-oro').disabled = !allied || !playing;
    if (!allied && !note) note = 'Solo puedes enviar tropas y oro a tus aliados. La cantidad sigue la fuerza de ataque.';
    $('pn-nota').textContent = note;

    // Pacto de no agresión, paz y ayuda
    const diplo = document.querySelector('.pn-diplo');
    diplo.hidden = p.weak;
    const pact = game.pactBetween(human.id, p.id);
    if (pact) {
      const left = formatTime(Math.max(0, (pact.until - game.ticks) / 10));
      chip.textContent = `${pact.kind === 'peace' ? 'Paz' : 'Pacto'} · ${left}`;
      chip.className = 'chip bien';
    }
    const pb = $('pn-pacto');
    if (pact) {
      pb.dataset.action = 'break';
      if (performance.now() >= this._pactArmedUntil) pb.textContent = `Romper ${pact.kind === 'peace' ? 'la paz' : 'el pacto'}`;
      pb.className = 'peligro';
      pb.disabled = !playing;
    } else {
      pb.dataset.action = 'propose';
      pb.className = '';
      const check = game.canOffer(human, p, 'pact');
      const incoming = game.pendingOffer(p.id, human.id, 'pact');
      pb.textContent = incoming ? 'Aceptar su pacto' : check.ok ? `Pacto de no agresión (${CONFIG.pactTicks / 600} min)` : check.reason;
      pb.disabled = !playing || (!check.ok && !incoming) || allied;
      if (allied) pb.textContent = 'Pacto: ya sois aliados';
    }
    const war = game.atWar(human, p);
    document.querySelector('.pn-paz').hidden = !war || !!pact;
    const peace = game.canOffer(human, p, 'peace');
    $('pn-paz').disabled = !playing || !peace.ok;
    $('pn-paz').textContent = peace.ok ? 'Ofrecer paz' : peace.reason;
    $('pn-ayuda').hidden = !allied;
    const helpWait = Math.ceil(((human.helpAt ?? -Infinity) + CONFIG.helpCooldownTicks - game.ticks) / 10);
    $('pn-ayuda').disabled = !playing || helpWait > 0;
    $('pn-ayuda').textContent = helpWait > 0 ? `🆘 Ayuda pedida (${helpWait} s)` : '🆘 Pedir ayuda a tus aliados';
  }

  addRequest(game, evt) {
    const kind = evt.offer || '';
    const key = kind ? `${kind}:${evt.fromId}` : evt.fromId;
    if (this._requests.has(key)) return;
    const p = game.players[evt.fromId];
    const card = document.createElement('div');
    card.className = `solicitud ${kind ? `sol-${kind}` : ''}`;
    const offer = kind ? game.pendingOffer(p.id, game.human?.id, kind) : null;
    const gold = offer && offer.tribute ? ` y <b>${formatNumber(Math.floor(p.gold * offer.tribute))}</b> de oro` : '';
    const what = kind === 'pact' ? `te propone un pacto de no agresión (${CONFIG.pactTicks / 600} min)` : kind === 'peace' ? `te ofrece la paz${gold}` : 'te propone una alianza';
    card.innerHTML = `
      <div class="sol-texto"><span class="muestra" style="background:${rgbToCss(p.color)}"></span>
        <span><b>${escapeHtml(p.name)}</b> ${what}</span></div>
      <div class="sol-botones">
        <button type="button" data-from="${p.id}" data-offer="${kind}" data-accept="0">Rechazar</button>
        <button type="button" class="principal" data-from="${p.id}" data-offer="${kind}" data-accept="1">Aceptar</button>
      </div>
      <div class="sol-tiempo"><div></div></div>`;
    $('solicitudes').prepend(card);
    this._requests.set(key, card);
  }

  _removeRequest(key) {
    this._requests.get(key)?.remove();
    this._requests.delete(key);
  }

  _updateRequests(game, human) {
    for (const [key, card] of this._requests) {
      const offer = typeof key === 'string' ? key.split(':') : null;
      const req = offer ? game.pendingOffer(Number(offer[1]), human.id, offer[0]) : game.pendingRequest(key, human.id);
      if (!req) {
        this._removeRequest(key);
        continue;
      }
      const left = Math.max(0, (req.expires - game.ticks) / (offer ? CONFIG.offerTicks : CONFIG.allianceRequestTicks));
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
      xp.textContent = `+${progress.xp} XP · +${progress.coins || 0} 🪙${progress.levelUp ? ` · ¡Subes al nivel ${progress.level}!` : ''}`;
      box.append(xp);
      for (const d of progress.daily || []) {
        const li = document.createElement('p');
        li.className = 'fin-logro';
        li.textContent = `${d.icon} Reto diario: ${d.name} (+${d.coins} 🪙)`;
        box.append(li);
      }
      if (progress.dailyBonus) {
        const li = document.createElement('p');
        li.className = 'fin-logro';
        li.textContent = `📅 ¡Los tres retos de hoy! (+${progress.dailyBonus} 🪙)`;
        box.append(li);
      }
      for (const a of progress.achievements) {
        const li = document.createElement('p');
        li.className = 'fin-logro';
        li.textContent = `${a.icon} Logro conseguido: ${a.name}${a.coins ? ` (+${a.coins} 🪙)` : ''}`;
        box.append(li);
      }
    }
    $('fin').hidden = false;
  }

  hideEnd() {
    $('fin').hidden = true;
  }

  /** Rótulo del reparto: «70 % soldados · 30 % trabajadores». */
  _showShare(s) {
    const pct = Math.round(s * 100);
    $('reparto-valor').textContent = `${pct}%`;
    $('reparto-txt').textContent = `soldados · ${100 - pct}% trab.`;
    $('reparto').style.setProperty('--valor', `${pct}%`);
  }

  setRatio(r) {
    this._ratio = r;
    $('ratio').value = Math.round(r * 100);
    $('ratio-valor').textContent = `${Math.round(r * 100)}%`;
    if (this._snap) this._paintReserve({ ...hudSnapshot(this._snap.reserva, r), fija: this._snap.fija });
  }

  /** Reserva y próximo envío, del mismo turno (una sola fuente de datos). */
  _paintReserve(snap) {
    this._snap = snap;
    const reserva = fmtTroopsCount(snap.reserva);
    // Con oro fijo, la cifra grande de «Tropas» es la reserva: la misma, sin animar
    if (snap.fija && $('pj-pob').textContent !== reserva) $('pj-pob').textContent = reserva;
    const envio = `próximo envío ${fmtTroops(snap.envio)}`;
    if ($('pj-tropas').textContent !== reserva) $('pj-tropas').textContent = reserva;
    if ($('ratio-tropas').textContent !== envio) $('ratio-tropas').textContent = envio;
  }

  /** El próximo envío con la fuerza de ataque actual (internas), el mismo que ves en el panel. */
  nextSend(human) {
    if (this._snap) return this._snap.envio;
    return human ? hudSnapshot(human.troops, this._ratio).envio : 0;
  }

  pushEvent(evt) {
    // Respuestas a tus acciones: una pista breve encima del panel
    if (evt.feedback) {
      this._hint(stripLeadingEmoji(evt.text), evt.kind);
      return;
    }
    // La muerte de los bots no se avisa (se ve en el mapa y en la clasificación)
    if (evt.bot || !isImportant(evt.text)) return;
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
  /** Pista breve encima del panel (pública). */
  hint(text, kind = 'info') {
    if (text) this._hint(text, kind);
  }

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

  /**
   * Botín: monedas que salen de (sx, sy) en pantalla, se abren un poco y
   * vuelan hasta tu contador de oro, que da un golpe al recibirlas.
   */
  flyCoins(sx, sy, small = false) {
    const target = $('pj-oro');
    if (!target || target.closest('[hidden]')) return;
    const r = target.getBoundingClientRect();
    const tx = r.left + Math.min(24, r.width / 2);
    const ty = r.top + r.height / 2;
    const n = small ? 7 : 12;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'moneda-vuela';
      document.body.append(c);
      const jx = sx + (Math.random() - 0.5) * 90;
      const jy = sy - 20 - Math.random() * 50;
      const anim = c.animate(
        [
          { transform: `translate(${sx}px, ${sy}px) scale(0.5)`, opacity: 0 },
          { transform: `translate(${jx}px, ${jy}px) scale(1.15)`, opacity: 1, offset: 0.3 },
          { transform: `translate(${tx}px, ${ty}px) scale(0.75)`, opacity: 0.95 },
        ],
        { duration: 850 + i * 40, delay: i * 40, easing: 'cubic-bezier(0.45, 0, 0.7, 0.5)', fill: 'both' },
      );
      anim.onfinish = () => c.remove();
    }
    clearTimeout(this._goldHit);
    this._goldHit = setTimeout(() => {
      target.classList.remove('oro-golpe');
      void target.offsetWidth; // reinicia la animación
      target.classList.add('oro-golpe');
    }, 850);
  }

  _counter(el, fmt, dur) {
    const c = new Counter(el, fmt, dur);
    this._counters.add(c);
    return c;
  }

  /**
   * Cifras principales del panel (tropas, población, máximo y oro): se leen
   * en cuanto cambia el turno, no cada 200 ms, para que cuenten sin tirones.
   * Llamar en cada fotograma; solo hace algo cuando hay turno nuevo.
   */
  liveNumbers(game, human) {
    if (!human || game.ticks === this._liveTick) return;
    this._liveTick = game.ticks;
    const fija = human.economy !== 'workers';
    this._paintReserve({ ...hudSnapshot(human.troops, this._ratio), fija });
    if (!fija) this._pop.set(human.population());
    this._troopsMax.set(human.maxTroops());
    this._gold.set(human.gold);
  }

  /** Avanza las cifras animadas (llamar en cada frame). */
  animate(dt) {
    for (const c of this._counters) c.step(dt);
  }

  update(game, human, ratio, buildMode) {
    this._ratio = ratio;
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
    } else if (game.inTruce?.()) {
      // Regla de tregua: recordatorio con la cuenta atrás
      const left = Math.ceil(((game.truceUntil() - game.ticks) * TICK_MS) / 1000);
      aviso.textContent = `Tregua: nadie puede atacar a otras naciones durante ${formatTime(left)}. Expándete y conquista colonias`;
      aviso.hidden = false;
    } else {
      aviso.hidden = true;
    }

    const playingTicks = Math.max(0, game.ticks - CONFIG.spawnTicks);
    const limit = game._timeLimitMin ? game._timeLimitMin() : game.rules?.timeLimitMin || 0;
    // Con límite de tiempo, el reloj muestra cuánto queda
    $('reloj').textContent = limit
      ? `${formatTime(Math.max(0, limit * 60 - (playingTicks * TICK_MS) / 1000))} restantes`
      : formatTime((playingTicks * TICK_MS) / 1000);

    // Panel del jugador
    $('pj-color').style.background = rgbToCss(human.color);
    $('panel-jugador').style.setProperty('--pj-color', rgbToCss(human.color));
    $('pj-nombre').textContent = human.name;
    const max = human.maxTroops();
    const coop = this.coop;
    const roleName = coop?.role === 'militar' ? 'Mando militar' : coop?.role === 'economia' ? 'Economía y diplomacia' : '';
    $('pj-estado').textContent = !human.alive ? 'Derrotado · modo espectador' : coop ? `${roleName ? `${roleName} · ` : ''}con ${coop.partnerName}` : '';
    // Economía fija (la del documento): solo tropas, sin reparto ni trabajadores
    const workersMode = human.economy === 'workers';
    $('panel-jugador').classList.toggle('economia-fija', !workersMode);
    const label = workersMode ? 'Población' : 'Tropas';
    if ($('pj-pob-etq').textContent !== label) $('pj-pob-etq').textContent = label;
    const pop = human.population();
    const fill = Math.min(1, pop / max);
    $('pj-barra').style.width = `${fill * 100}%`;
    // Dentro de la barra: la parte de soldados (dorada) y la de trabajadores
    $('pj-barra').style.setProperty('--soldados', `${pop > 0 ? Math.round((100 * human.troops) / pop) : 100}%`);
    // Casi al máximo: la barra brilla (buen momento para atacar)
    $('pj-barra').parentElement.classList.toggle('lleno', fill >= 0.95 && human.alive);
    const perSecond = 1000 / TICK_MS;
    const playing = game.phase === 'playing';
    if (this._snap && ratio !== this._snapRatio) this._paintReserve({ ...hudSnapshot(this._snap.reserva, ratio), fija: this._snap.fija });
    this._snapRatio = ratio;
    if (human.economy === 'workers') this._pop.set(pop);
    this._troopsMax.set(max);
    const growth = human.growthPerTick() * perSecond;
    $('pj-crec').textContent = playing ? `${growth < 0 ? '−' : '+'}${fmtTroops(Math.abs(growth))}/s` : '';
    $('pj-crec').classList.toggle('baja', growth < 0);
    $('pj-trab').textContent = `${fmtTroops(human.workers)} trab.`;
    // El deslizador sigue al reparto real salvo mientras lo estás moviendo
    if (!(performance.now() - (this._shareDragAt || 0) < 1500)) {
      $('reparto').value = Math.round(human.soldierShare * 100);
      this._showShare(human.soldierShare);
    }
    this._gold.set(human.gold);
    $('pj-oro-ritmo').textContent = playing ? `+${formatNumber(human.goldPerTick() * perSecond)}/s` : '';
    $('pj-terr').textContent = formatShare(human.tiles, landCount);
    $('pj-barcos').textContent = `${human.boatCount}/${human.maxBoats()}`;
    $('pj-buques').textContent = human.buildings.warship ? ` · ${human.buildings.warship} buque${human.buildings.warship > 1 ? 's' : ''}` : '';
    $('ratio-valor').textContent = `${Math.round(ratio * 100)}%`;
    $('ratio').style.setProperty('--valor', `${Math.round(ratio * 100)}%`);

    const works = {};
    for (const b of game.sites) if (b.owner === human.id) works[b.kind] = (works[b.kind] || 0) + 1;
    for (const [kind, btn] of this._buildButtons) {
      const cost = game.buildCost(human, kind);
      let unavailable = human.gold < cost;
      // Lo que falta para poder pagarlo, como relleno del botón
      btn.style.setProperty('--progreso', `${Math.round(Math.min(1, human.gold / cost) * 100)}%`);
      btn.classList.toggle('en-obras', !!works[kind]);
      if (BUILDINGS[kind].unit === 'missile') {
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
    this._updateOrders(game, human);
    this._sampleEconomy(game, human);
    if (!$('panel-desarrollo').hidden) this._renderDev(game, human);
    this._advise(game, human);
    if (buildMode !== this._lastBuildMode) {
      this._lastBuildMode = buildMode;
      const roi = buildMode && this._roi(game, human)[buildMode];
      if (roi) this._hint(roi, 'info');
    }
  }

  // ---------------------------------------------------- órdenes y desarrollo

  _updateOrders(game, human) {
    // Aviso en el botón de desarrollo: hay oro para investigar y nada en marcha
    const can = game.profile.techs && game.phase === 'playing' && human.alive && !human.research && human.gold >= game.techCost(human);
    $('btn-desarrollo').querySelector('.punto-aviso').hidden = !can;
    // Sin tecnologías (Clásico): el panel sigue, solo con la economía
    const tabTec = document.querySelector('[data-pd="tecnologias"]');
    if (tabTec && tabTec.hidden === game.profile.techs) {
      tabTec.hidden = !game.profile.techs;
      if (!game.profile.techs) this._devTab('economia');
    }
  }

  toggleDev(force) {
    const panel = $('panel-desarrollo');
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    $('btn-desarrollo').setAttribute('aria-pressed', String(open));
    if (open) {
      this._devAt = 0;
      this.closeNation();
    }
  }

  _devTab(tab) {
    for (const b of document.querySelectorAll('[data-pd]')) b.setAttribute('aria-selected', String(b.dataset.pd === tab));
    $('pd-economia').hidden = tab !== 'economia';
    $('pd-tecnologias').hidden = tab !== 'tecnologias';
    this._devAt = 0;
  }

  /** Guarda cada segundo lo ganado y gastado por fuente (para el ritmo por minuto). */
  _sampleEconomy(game, human) {
    const snaps = (this._ecoSnaps ??= []);
    const last = snaps[snaps.length - 1];
    if (last && (last.game !== game || game.ticks < last.t)) snaps.length = 0;
    else if (last && game.ticks - last.t < 10) return;
    snaps.push({ game, t: game.ticks, income: { ...human.income }, spent: { ...human.spent } });
    while (snaps.length > 61) snaps.shift();
  }

  /** Ritmo por minuto de cada fuente (último minuto). */
  _rates() {
    const snaps = this._ecoSnaps || [];
    if (snaps.length < 2) return null;
    const a = snaps[0];
    const b = snaps[snaps.length - 1];
    const k = 600 / Math.max(1, b.t - a.t);
    const out = { income: {}, spent: {} };
    for (const key in b.income) out.income[key] = (b.income[key] - a.income[key]) * k;
    for (const key in b.spent) out.spent[key] = (b.spent[key] - a.spent[key]) * k;
    return out;
  }

  /**
   * Qué daría comprar ahora una ciudad, una fábrica o un puerto (con las
   * reglas del documento de mecánicas): la ciudad sube el techo de tropas y,
   * con él, la regeneración; fábricas y puertos dan oro con trenes y mercantes.
   */
  _roi(game, h) {
    const out = {};
    const cap = h.maxTroops();
    const extra = MECH.cityCapBonus * h.capMult * (1 + h.mods.cap);
    const P = h.economy === 'workers' ? h.troops + h.workers : h.troops;
    const k = h.paceRegen * h.regenMult * h.troopMult * Math.max(0.1, 1 + h.mods.growth) * 10;
    const gain = (regenPerTick(P, cap + extra) - regenPerTick(P, cap)) * k;
    out.city = `${BUILDINGS.city.name} (${formatNumber(game.buildCost(h, 'city'))}): +${fmtTroops(extra)} de techo de tropas → ~+${fmtTroops(Math.max(0, gain))} tropas/s ahora`;
    out.factory = `${BUILDINGS.factory.name} (${formatNumber(game.buildCost(h, 'factory'))}): vías a las ciudades, puertos y fábricas cercanas; cada tren da ${formatNumber(MECH.trainRewards.self)} de oro (${formatNumber(MECH.trainRewards.ally)} en estaciones aliadas)`;
    out.port = `${BUILDINGS.port.name} (${formatNumber(game.buildCost(h, 'port'))}): mercantes a puertos de otros jugadores; al llegar, los dos cobráis (~${formatNumber(tradeGold(100))} a 100 casillas, ~${formatNumber(tradeGold(300))} a 300)`;
    return out;
  }

  /** Contenido del panel de desarrollo (4 veces por segundo como mucho). */
  _renderDev(game, h) {
    const now = performance.now();
    if (now - (this._devAt || 0) < 250) return;
    this._devAt = now;
    if (!$('pd-economia').hidden) {
      const r = this._rates();
      const inc = r ? r.income : {};
      const sp = r ? r.spent : {};
      const total = Object.values(inc).reduce((a, b) => a + b, 0);
      // Desglose por fuente (TR04): la base pasiva aparte de los bonos y los eventos
      const techs = game.profile.techs;
      const rows = [
        ['Oro base (pasivo, cada turno)', inc.base],
        game.profile.points || techs ? ['Bonos (puntos estratégicos, tecnologías, especialización)', inc.bonus] : null,
        h.economy === 'workers' ? ['Trabajadores', inc.workers] : null,
        ['Trenes y mercantes', inc.trade],
        game.profile.points ? ['Puntos estratégicos tomados', inc.conquest] : null,
        ['Botín (eliminaciones)', inc.loot],
        ['Regalos de aliados', inc.gifts],
      ].filter(Boolean);
      const bar = (v) => `<span class="pd-barra"><span style="width:${total > 0 ? Math.round((100 * (v || 0)) / total) : 0}%"></span></span>`;
      const roi = this._roi(game, h);
      const specCost = h.spec ? formatNumber(CONFIG.specChangeCost * game.rules.priceMult) : 'gratis';
      $('pd-economia').innerHTML = `
        <div class="pd-total"><span>Oro por minuto</span><strong>${formatNumber(total)}</strong><small>último minuto · ahora tienes ${formatNumber(h.gold)}</small></div>
        <table class="pd-tabla"><tbody>
          ${rows.map(([n, v]) => `<tr><td>${n}</td><td>${formatNumber(v || 0)}</td><td>${bar(v)}</td></tr>`).join('')}
          <tr class="gasto"><td>Gastado en edificios</td><td>${formatNumber(sp.buildings || 0)}</td><td></td></tr>
          ${techs ? `<tr class="gasto"><td>Gastado en investigación</td><td>${formatNumber(sp.research || 0)}</td><td></td></tr>` : ''}
        </tbody></table>
        <h4>Si construyes ahora</h4>
        <ul class="pd-roi">${['city', 'factory', 'port'].map((k) => `<li>${roi[k]}</li>`).join('')}</ul>
        ${techs ? `<h4>Especialización <small>(${h.spec ? `cambiarla cuesta ${specCost}` : 'la primera es gratis'})</small></h4>
        <div class="pd-specs">${SPEC_IDS.map((id) => `
          <button type="button" class="pd-spec${h.spec === id ? ' activa' : ''}" data-spec="${id}" ${h.spec === id || game.phase !== 'playing' ? 'disabled' : ''}>
            <strong>${SPECS[id].name}</strong><span>${SPECS[id].desc}</span></button>`).join('')}</div>` : `<p class="pd-nota">Perfil ${game.profile.name}: sin tecnologías ni especialización.</p>`}`;
    } else {
      const cost = game.techCost(h);
      const time = Math.round(game.techTime(h) / 10);
      const res = h.research;
      const head = res
        ? `<div class="pd-invest">Investigando <b>${TECHS[res.id].name}</b><span class="pd-barra"><span style="width:${Math.round((100 * (game.ticks - res.start)) / Math.max(1, res.end - res.start))}%"></span></span>${Math.ceil((res.end - game.ticks) / 10)} s</div>`
        : `<div class="pd-invest"><span>Siguiente investigación: <b>${formatNumber(cost)}</b> de oro · ${time} s. Cada una encarece la siguiente: no podrás tenerlas todas.</span></div>`;
      const col = (branch) => TECH_IDS.filter((id) => TECHS[id].branch === branch).map((id) => {
        const t = TECHS[id];
        const done = h.techs.has(id);
        const doing = res && res.id === id;
        const av = techAvailable(h, id);
        const state = done ? '<em class="ok">✓ Investigada</em>' : doing ? '<em>En marcha…</em>' : av.ok ? `<em>${formatNumber(cost)} · ${time} s</em>` : `<em class="no">${av.reason}</em>`;
        const dis = done || doing || !av.ok || h.gold < cost || game.phase !== 'playing';
        return `<button type="button" class="pd-tec${done ? ' hecha' : ''}${doing ? ' marcha' : ''}" data-tech="${id}" ${dis ? 'disabled' : ''}>
          <span class="pd-nivel">Nv ${t.tier}</span><strong>${t.name}</strong><span>${t.desc}</span>${state}</button>`;
      }).join('');
      $('pd-tecnologias').innerHTML = `${head}<div class="pd-ramas">${Object.keys(BRANCHES).map((b) => `<div class="pd-rama"><h4>${BRANCHES[b]}</h4>${col(b)}</div>`).join('')}</div>`;
    }
  }

  /**
   * Consejos (💡): población al máximo, oro sin usar, un vecino mucho más
   * fuerte en tu frontera, soldados ociosos o un punto estratégico libre
   * cerca. Cada uno, como mucho cada minuto o dos.
   */
  _advise(game, h) {
    if (this.tips === false || game.phase !== 'playing' || !h.alive) return;
    const now = performance.now();
    if (now - (this._adviceAt || 0) < 1000) return;
    this._adviceAt = now;
    const last = (this._tipLast ??= {});
    const say = (key, text, every) => {
      if (now - (last[key] || -Infinity) < every) return false;
      last[key] = now;
      this.pushEvent({ text: `💡 ${text}`, kind: 'warn', tick: game.ticks });
      return true;
    };
    const max = h.maxTroops();
    const pop = h.population();
    this._fullSince = pop >= max * 0.97 ? this._fullSince || now : 0;
    if (this._fullSince && now - this._fullSince > 10000 && say('lleno', 'Tu población está al máximo y ya no crece: amplía territorio, construye ciudades o ataca', 90000)) return;
    const cheapest = Math.min(game.buildCost(h, 'city'), game.buildCost(h, 'fort'));
    if (h.gold > Math.max(600000, cheapest * 2) && !h.research && say('oro', `Tienes ${formatNumber(h.gold)} de oro sin usar: construye o investiga (tecla I)`, 120000)) return;
    const nbs = game.neighborSummary(h).counts;
    for (const id of nbs.keys()) {
      const t = game.players[id];
      if (!t || t.weak || h.allies.has(id) || game.pactBetween(h.id, id)) continue;
      if (t.troops > Math.max(500, h.troops * 2.5) && say(`fuerte${id}`, `${t.name} tiene ${Math.round(t.troops / Math.max(1, h.troops))} veces tus soldados en tu frontera: construye puestos defensivos (R), propón un pacto o pide ayuda`, 120000)) return;
    }
    let attacking = false;
    for (const [id, atk] of h.attacks) if (id && !atk.done) attacking = true;
    this._idleSince = !attacking && h.soldierShare >= 0.7 && pop >= max * 0.8 ? this._idleSince || now : 0;
    if (this._idleSince && now - this._idleSince > 60000 && say('ociosos', 'Muchos soldados sin usar: pasa parte a trabajadores (Reparto) para ganar más oro', 150000)) return;
    const home = h.capitalTile >= 0 ? h.capitalTile : h.spawnTile;
    if (home >= 0) {
      for (const pt of game.points) {
        if (game.owner[pt.tile] !== 0 || last[`p${pt.id}`]) continue;
        const d2 = (pt.x - game.map.x(home)) ** 2 + (pt.y - game.map.y(home)) ** 2;
        if (d2 < (40 * RES) ** 2) {
          last[`p${pt.id}`] = now;
          say(`punto${pt.id}`, `Hay un ${POI_TYPES[pt.kind].name.toLowerCase()} libre cerca: haz clic en él para conquistarlo (${POI_TYPES[pt.kind].desc.toLowerCase()})`, 0);
          return;
        }
      }
    }
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
        retreat: mine && !atk.retreatAt ? atk.targetId : null,
        prep: atk.retreatAt > 0,
        // Retirada: lo que volvería (el mismo cálculo que aplica el motor)
        outcome: mine ? game.retreatOutcome(atk) : null,
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
      }
      const o = c.outcome;
      const mid = c.prep && o ? `Retirada ${o.seconds.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s` : c.middle;
      if (f.vs.textContent !== mid) f.vs.textContent = mid;
      f.li.classList.toggle('retirada', !!c.prep);
      if (o && f.caps) {
        // En retirada: qué vuelve y qué se pierde; si no, las leyendas normales
        const caps = c.prep ? [`vuelven ~${fmtTroops(o.refund)}`, o.lost >= 1 ? `pierdes ~${fmtTroops(o.lost)}` : 'sin pérdidas'] : c.captions;
        caps.forEach((t, k) => {
          if (f.caps[k] && f.caps[k].textContent !== t) f.caps[k].textContent = t;
        });
      }
      if (f.btn) {
        // Una sola orden: mientras se resuelve, sin ✕
        f.btn.hidden = !!c.prep;
        f.btn.disabled = !!c.prep;
        if (o && !c.prep) {
          const secs = ((MECH.retreatTicks * TICK_MS) / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 });
          const title = o.ratio < 1
            ? `Retirarse: en ${secs} s vuelven ~${fmtTroops(o.refund)} de ${fmtTroops(o.troops)} (se pierde el ${Math.round(MECH.retreatPenalty * 100)} %)`
            : `Retirarse: en ${secs} s vuelven las ${fmtTroops(o.troops)} tropas, sin pérdidas`;
          if (f.btn.title !== title) f.btn.title = title;
        }
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
    const caps = [];
    for (const text of c.captions || ['', '']) {
      const s = document.createElement('span');
      s.textContent = text;
      legend.append(s);
      caps.push(s);
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
    let btn = null;
    if (c.retreat !== null && c.retreat !== undefined) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'f-retirar';
      btn.dataset.target = c.retreat;
      btn.title = 'Retirarse';
      btn.setAttribute('aria-label', 'Retirarse');
      btn.textContent = '✕';
      li.append(btn);
    }
    $('frentes').append(li);
    return { li, vs, aEl, dEl, barA, barD, caps, btn, a: this._counter(aEl, fmtTroops), d: this._counter(dEl, fmtTroops), gone: 0 };
  }

  /** Barra superior: tu puesto y el líder frente a la meta de victoria. */
  _updateTopBar(game, human) {
    const alive = game.players.filter((p) => p && p.alive && p.tiles > 0).sort((a, b) => b.tiles - a.tiles);
    const rank = alive.indexOf(human);
    $('dato-puesto').textContent = rank >= 0 ? `${rank + 1}.º de ${alive.length}` : `${alive.length} en pie`;
    // Objetivo de la partida según el modo de victoria
    const st = game.victoryStatus ? game.victoryStatus() : null;
    const leader = st ? st.leader : alive[0];
    if (leader) {
      const name = leader === human ? 'Tú' : leader.name;
      let text;
      let near;
      if (!st || st.mode === 'dominio') {
        const goal = Math.round(game.rules.winShare * 100);
        const share = Math.round((leader.tiles / game.map.landCount) * 100);
        text = `${name} ${share} % / ${goal} %`;
        near = share >= goal * 0.75;
      } else if (st.mode === 'capitales') {
        text = `${name} ${st.value}/${st.goal} capitales`;
        near = st.value >= st.goal * 0.75;
      } else if (st.mode === 'economia') {
        text = `${name} ${formatNumber(st.value)}/${formatNumber(st.goal)} oro/min`;
        near = st.value >= st.goal * 0.75;
      } else {
        text = `${name} ${formatNumber(st.value)} puntos`;
        near = false;
      }
      const hold = game.goalHolder && game.goalHolder.id === leader.id ? game.goalHolder : null;
      if (hold && st && (st.mode === 'capitales' || st.mode === 'economia')) {
        const need = st.mode === 'capitales' ? CONFIG.capitalHoldTicks : CONFIG.economyHoldTicks;
        text += ` · gana en ${Math.max(0, Math.ceil((hold.since + need - game.ticks) / 10))} s`;
        near = true;
      }
      $('dato-lider').textContent = text;
      $('dato-lider-caja').classList.toggle('cerca', near && leader !== human);
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
        li.innerHTML = '<span class="pos"></span><span class="marca-pais"></span><span class="nom"><span class="nom-txt"></span><span class="marcas"></span></span><span class="pct"></span><span class="oro"></span><span class="tro"></span><span class="lb-barra"><span></span></span>';
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
      set('.oro', formatNumber(p.gold));
      set('.tro', fmtTroops(p.troops));
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

  /** Línea del tooltip con el punto estratégico cercano y su efecto. */
  _pointTip(game, tile) {
    const pt = game.pointNear(tile);
    if (!pt) return '';
    const o = game.owner[pt.tile];
    const who = o ? ` · de ${escapeHtml(game.players[o].name)}` : ' · sin dueño';
    return `<div class="tip-punto">⭐ <b>${escapeHtml(pt.name)}</b>${who}<br><span class="suave">${POI_TYPES[pt.kind].desc}</span></div>`;
  }

  /** Estimación de lo que daría un ataque con la fuerza de ataque actual. */
  _attackTip(game, targetId) {
    const h = game.human;
    if (!h || !h.alive || game.phase !== 'playing' || targetId === h.id || (targetId && h.allies.has(targetId))) return '';
    const troops = this.nextSend(h);
    if (troops < 1) return '';
    const e = game.estimateAttack(h, targetId, troops);
    const risk = targetId ? ` · riesgo ${e.risk}` : '';
    return `<div class="tip-estim">Próximo envío ${fmtTroops(troops)}: ~${formatNumber(e.tiles)} casillas${risk}${e.uncertain ? ' (incierto: fortalezas o pasos)' : ''}</div>`;
  }

  updateTooltip(game, tile, sx, sy) {
    const tip = $('tooltip');
    if (tile < 0) {
      tip.hidden = true;
      return;
    }
    const map = game.map;
    const terrain = `${TERRAIN_NAMES[map.terrain[tile]]}${map.river[tile] ? ' · río' : ''}`;
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
      if (game.fortMultiplier(p, tile) > 1) extra.push('puesto defensivo cerca');
      extra.push(terrain);
      const human = game.human;
      const tag = p === human ? ' (tú)' : human && human.allies.has(p.id) ? ' · 🤝 aliado' : game.isTraitor(p) ? ' · traidor' : p.weak ? ' · colonia' : '';
      tip.innerHTML = `<b>${escapeHtml(p.name)}</b>${tag}<br>
        ${fmtTroops(p.troops)} tropas · ${formatShare(p.tiles, map.landCount)}<br>
        <span class="suave">${extra.join(' · ')}</span>${this._pointTip(game, tile)}${this._attackTip(game, o)}`;
    } else {
      tip.innerHTML = `<b>Tierra libre</b><br><span class="suave">${terrain}</span>${this._pointTip(game, tile)}${this._attackTip(game, 0)}`;
    }
    tip.hidden = false;
    // Dentro de la ventana: se mide la caja (ya con el texto ajustado) y, si
    // no cabe a la derecha o debajo del ratón, va al otro lado; nunca fuera
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = sx + 16 + w > vw - 8 ? sx - 16 - w : sx + 16;
    let top = sy + 16 + h > vh - 8 ? sy - 16 - h : sy + 16;
    left = Math.max(8, Math.min(vw - w - 8, left));
    top = Math.max(8, Math.min(vh - h - 8, top));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
