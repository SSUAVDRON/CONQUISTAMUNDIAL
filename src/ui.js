// Interfaz HTML de la partida: panel del jugador, clasificación, diplomacia,
// eventos, tooltip y pantalla de fin. (El inicio está en home.js.)
import { BUILDINGS, BUILDING_KINDS, CONFIG, EMOJIS, TERRAIN_NAMES, TICK_MS } from './config.js';
import { rgbToCss } from './colors.js';
import { formatNumber, formatPercent, formatTime } from './format.js';
import { drawBuildingIcon, flagCss, hasFlag } from './icons.js';

const $ = (id) => document.getElementById(id);
const MAX_EVENTS = 5;
const EVENT_MS = 6000;

export class UI {
  constructor() {
    this.handlers = {};
    this._attackRows = new Map();
    this._leaderSig = '';

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
      btn.title = `${def.name}: ${def.desc} (tecla ${def.key.slice(3)})`;
      const icon = document.createElement('canvas');
      icon.width = 48;
      icon.height = 48;
      drawBuildingIcon(icon.getContext('2d'), kind, 24, 24, 40, { glyph: '#f2f4f8' });
      const text = document.createElement('span');
      text.className = 'b-texto';
      text.innerHTML = `<span class="b-nombre">${def.name}</span><span class="b-coste"></span>`;
      const count = document.createElement('span');
      count.className = 'b-num';
      btn.append(icon, text, count);
      btn.addEventListener('click', () => this.handlers.onBuildMode?.(kind));
      $('construir').append(btn);
      this._buildButtons.set(kind, btn);
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
    $('frentes').replaceChildren();
    $('solicitudes').replaceChildren();
    this._requests.clear();
    this._attackRows.clear();
    this._leaderSig = '';
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
    const box = $('eventos');
    const el = document.createElement('div');
    el.className = `evento ${evt.kind}`;
    el.textContent = evt.text;
    box.prepend(el);
    while (box.children.length > MAX_EVENTS) box.lastChild.remove();
    setTimeout(() => el.classList.add('saliendo'), EVENT_MS);
    setTimeout(() => el.remove(), EVENT_MS + 700);
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
      } else {
        const where = def.unit ? 'cerca de uno de tus puertos' : def.coastal ? 'en tu costa' : 'en tu territorio';
        aviso.textContent = `Toca ${where} para construir: ${def.name} (${cost} de oro). Esc para cancelar`;
      }
      aviso.hidden = false;
    } else {
      aviso.hidden = true;
    }

    const playingTicks = Math.max(0, game.ticks - CONFIG.spawnTicks);
    $('reloj').textContent = formatTime((playingTicks * TICK_MS) / 1000);

    // Panel del jugador
    $('pj-color').style.background = rgbToCss(human.color);
    $('pj-nombre').textContent = human.name;
    const max = human.maxTroops();
    $('pj-estado').textContent = human.alive ? '' : 'Derrotado · modo espectador';
    $('pj-barra').style.width = `${Math.min(100, (human.troops / max) * 100)}%`;
    const perSecond = 1000 / TICK_MS;
    const playing = game.phase === 'playing';
    $('pj-tropas').textContent = `${formatNumber(human.troops)} / ${formatNumber(max)}`;
    $('pj-crec').textContent = playing ? `+${formatNumber(human.growthPerTick() * perSecond)}/s` : '';
    $('pj-oro').textContent = formatNumber(human.gold);
    $('pj-oro-ritmo').textContent = playing ? `+${formatNumber(human.goldPerTick() * perSecond)}/s` : '';
    $('pj-terr').textContent = formatPercent(human.tiles / landCount);
    $('pj-barcos').textContent = `${human.boatCount}/${human.maxBoats()}`;
    $('pj-buques').textContent = human.buildings.warship ? `${human.buildings.warship} buque${human.buildings.warship > 1 ? 's' : ''} · clic en el mar` : '';
    $('ratio-valor').textContent = `${Math.round(ratio * 100)}%`;
    $('ratio-tropas').textContent = `(${formatNumber(human.troops * ratio)} tropas)`;

    for (const [kind, btn] of this._buildButtons) {
      const cost = game.buildCost(human, kind);
      let unavailable = human.gold < cost;
      if (kind === 'missile') {
        // Coste y silos listos
        const silos = game.buildings.filter((b) => b.owner === human.id && b.kind === 'silo');
        const ready = silos.filter((b) => b.readyAt <= game.ticks).length;
        btn.querySelector('.b-coste').textContent = silos.length ? `${formatNumber(cost)} · ${ready}/${silos.length} listos` : 'Necesita silo';
        btn.querySelector('.b-num').textContent = '';
        unavailable = unavailable || !ready;
      } else {
        btn.querySelector('.b-coste').textContent = `${formatNumber(cost)} oro`;
        btn.querySelector('.b-num').textContent = human.buildings[kind] ? `×${human.buildings[kind]}` : '';
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

  /** Borde rojo mientras te atacan por tierra, mar o aire (desactivable en Ajustes). */
  _updateThreat(game, human) {
    const box = $('alerta-roja');
    const on =
      this.redAlert !== false &&
      human.alive &&
      (game.attacks.some((a) => !a.done && a.targetId === human.id && a.troops >= 1) ||
        game.boats.some((b) => b.targetId === human.id) ||
        game.missiles.some((m) => m.targetId === human.id));
    box.classList.toggle('activa', on);
    // Más intenso si hay un misil en camino
    box.classList.toggle('fuerte', on && game.missiles.some((m) => m.targetId === human.id));
  }

  /**
   * Tarjetas de combate a la derecha: quién ataca a quién y con cuántas tropas
   * (ataques, desembarcos y misiles en los que participa el jugador). Las que
   * le atacan van primero y en rojo. Clic = la cámara va a ese frente.
   */
  _updateAttacks(game, human) {
    const list = $('frentes');
    const seen = new Set();
    const cards = [];
    const side = (p, fallback) => (p ? { name: p.name, flag: p.flag, color: p.color } : { name: fallback, flag: '', color: null });
    for (const atk of game.attacks) {
      if (atk.done || atk.troops < 1) continue;
      const mine = atk.attacker === human;
      const incoming = atk.targetId === human.id;
      if (!mine && !incoming) continue;
      const target = atk.targetId ? game.players[atk.targetId] : null;
      cards.push({
        key: `a${atk.attacker.id}-${atk.targetId}`,
        incoming,
        left: side(atk.attacker),
        right: side(target, 'Tierra libre'),
        a: formatNumber(atk.troops),
        d: target ? formatNumber(target.troops) : '—',
        share: target ? atk.troops / (atk.troops + Math.max(1, target.troops)) : 1,
        middle: target ? 'VS' : 'Expansión',
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
        incoming,
        left: side(game.players[b.owner]),
        right: side(target, 'Tierra libre'),
        a: formatNumber(b.troops),
        d: target ? formatNumber(target.troops) : '—',
        share: target ? b.troops / (b.troops + Math.max(1, target.troops)) : 1,
        middle: 'Desembarco',
      });
    }
    for (const m of game.missiles) {
      const mine = m.owner === human.id;
      const incoming = m.targetId === human.id;
      if (!mine && !incoming) continue;
      const left = Math.max(0, Math.ceil(((1 - m.progress) * m.dist) / CONFIG.missileSpeed / (1000 / TICK_MS)));
      cards.push({
        key: `m${m.id}`,
        incoming,
        left: side(game.players[m.owner]),
        right: side(game.players[m.targetId], '—'),
        a: 'Misil',
        d: `${left} s`,
        share: m.progress,
        middle: 'Impacto',
      });
    }
    cards.sort((x, y) => Number(y.incoming) - Number(x.incoming));

    const MAX = 5;
    for (const c of cards.slice(0, MAX)) {
      seen.add(c.key);
      let li = this._attackRows.get(c.key);
      if (!li) {
        li = this._frontCard(c);
        this._attackRows.set(c.key, li);
      }
      li.querySelector('.f-a').textContent = c.a;
      li.querySelector('.f-d').textContent = c.d;
      li.querySelector('.f-barra span').style.width = `${Math.round(Math.max(0.04, Math.min(1, c.share)) * 100)}%`;
      list.append(li); // también reordena
    }
    for (const [key, li] of this._attackRows) {
      if (!seen.has(key)) {
        li.remove();
        this._attackRows.delete(key);
      }
    }
    let more = list.querySelector('.f-mas');
    if (cards.length > MAX) {
      if (!more) {
        more = document.createElement('li');
        more.className = 'f-mas';
      }
      more.textContent = `y ${cards.length - MAX} combate${cards.length - MAX > 1 ? 's' : ''} más`;
      list.append(more);
    } else if (more) {
      more.remove();
    }
  }

  /** Construye la tarjeta "A · tropas  VS  tropas · B". */
  _frontCard(c) {
    const li = document.createElement('li');
    li.className = `frente ${c.incoming ? 'entrante' : 'saliente'}`;
    li.dataset.key = c.key;
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.title = 'Ir a este frente';
    const who = (s, align) => {
      const box = document.createElement('span');
      box.className = `f-lado ${align}`;
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
    const a = document.createElement('strong');
    a.className = 'f-a';
    const vs = document.createElement('span');
    vs.className = 'f-vs';
    vs.textContent = c.middle;
    const d = document.createElement('strong');
    d.className = 'f-d';
    mid.append(a, vs, d);
    const bar = document.createElement('div');
    bar.className = 'f-barra';
    bar.append(document.createElement('span'));
    li.append(top, mid, bar);
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
    return li;
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

  _updateLeaderboard(game, human, landCount) {
    const alive = game.players.filter((p) => p && p.alive && p.tiles > 0).sort((a, b) => b.tiles - a.tiles);
    const rows = alive.slice(0, 10);
    const humanRank = alive.indexOf(human);
    if (humanRank >= 10) rows.push(human);
    const html = rows
      .map((p) => {
        const rank = alive.indexOf(p) + 1;
        const marks = (human.allies.has(p.id) ? ' <span class="marca aliado" title="Aliado">🤝</span>' : '') +
          (game.isTraitor(p) ? ' <span class="marca traidor" title="Traidor">⚠</span>' : '');
        return `<li data-id="${p.id}" class="${p === human ? 'yo' : ''}">
          <span class="pos">${rank}</span>
          ${hasFlag(p.flag) ? `<span class="bandera" style="${flagCss(p.flag, 16)}"></span>` : `<span class="muestra" style="background:${rgbToCss(p.color)}"></span>`}
          <span class="nom">${escapeHtml(p.name)}${marks}</span>
          <span class="pct">${formatPercent(p.tiles / landCount)}</span>
          <span class="tro">${formatNumber(p.troops)}</span>
        </li>`;
      })
      .join('');
    if (html !== this._leaderSig) {
      $('lista-clasificacion').innerHTML = html;
      this._leaderSig = html;
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
      const b = game.buildingNear(tile, 2);
      const extra = [];
      if (b) extra.push(BUILDINGS[b.kind].name);
      if (game.fortMultiplier(p, tile) > 1) extra.push('zona fortificada');
      extra.push(terrain);
      const human = game.human;
      const tag = p === human ? ' (tú)' : human && human.allies.has(p.id) ? ' · aliado' : game.isTraitor(p) ? ' · traidor' : '';
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
