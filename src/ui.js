// Interfaz HTML: menú, panel del jugador, clasificación, eventos y tooltip.
import { BUILDINGS, BUILDING_KINDS, CONFIG, EMOJIS, TERRAIN_NAMES, TICK_MS } from './config.js';
import { rgbToCss } from './colors.js';
import { formatNumber, formatPercent, formatTime } from './format.js';
import { drawBuildingIcon } from './icons.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'dominia.prefs';
const MAX_EVENTS = 5;
const EVENT_MS = 6000;

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* almacenamiento no disponible: no pasa nada */
  }
}

export class UI {
  constructor() {
    this.handlers = {};
    this._attackRows = new Map();
    this._leaderSig = '';

    const prefs = loadPrefs();
    $('in-nombre').value = prefs.name || '';
    if (prefs.color) $('in-color').value = prefs.color;
    if (prefs.bots) $('in-bots').value = prefs.bots;
    if (prefs.map) $('in-mapa').value = prefs.map;
    $('out-bots').textContent = $('in-bots').value;

    $('in-bots').addEventListener('input', () => {
      $('out-bots').textContent = $('in-bots').value;
    });

    $('form-inicio').addEventListener('submit', (e) => {
      e.preventDefault();
      const opts = {
        name: $('in-nombre').value.trim() || 'Mi nación',
        color: $('in-color').value,
        bots: Number($('in-bots').value),
        mapSize: $('in-mapa').value,
        seed: $('in-semilla').value.trim(),
      };
      savePrefs({ name: opts.name, color: opts.color, bots: opts.bots, map: opts.mapSize });
      this.handlers.onStart?.(opts);
    });

    $('ratio').addEventListener('input', () => this.handlers.onRatio?.(Number($('ratio').value) / 100));

    for (const btn of document.querySelectorAll('#velocidad button')) {
      btn.addEventListener('click', () => this.handlers.onSpeed?.(Number(btn.dataset.vel)));
    }

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

    $('lista-ataques').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-target]');
      if (btn) this.handlers.onCancelAttack?.(Number(btn.dataset.target));
    });
  }

  on(handlers) {
    Object.assign(this.handlers, handlers);
  }

  showMenu() {
    $('menu').hidden = false;
    $('hud').hidden = true;
    $('fin').hidden = true;
    $('eventos').replaceChildren();
    $('in-nombre').focus();
  }

  showHud() {
    $('menu').hidden = true;
    $('hud').hidden = false;
    $('fin').hidden = true;
    $('eventos').replaceChildren();
    $('lista-ataques').replaceChildren();
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
    $('pn-color').style.background = rgbToCss(p.color);
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

  showEnd(title, text) {
    $('fin-titulo').textContent = title;
    $('fin-texto').textContent = text;
    $('fin').hidden = false;
  }

  hideEnd() {
    $('fin').hidden = true;
  }

  setRatio(r) {
    $('ratio').value = Math.round(r * 100);
    $('ratio-valor').textContent = `${Math.round(r * 100)}%`;
  }

  setSpeed(speed) {
    for (const btn of document.querySelectorAll('#velocidad button')) {
      btn.classList.toggle('activo', Number(btn.dataset.vel) === speed);
    }
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
    if (game.phase === 'spawn') {
      const left = Math.max(0, Math.ceil(((CONFIG.spawnTicks - game.ticks) * TICK_MS) / 1000));
      aviso.textContent = human.spawned
        ? `Posición elegida. Puedes cambiarla. Empieza en ${left} s`
        : `Haz clic en el mapa para elegir dónde empezar. Quedan ${left} s`;
      aviso.hidden = false;
    } else if (buildMode) {
      const def = BUILDINGS[buildMode];
      const where = def.coastal ? 'en tu costa' : 'en tu territorio';
      aviso.textContent = `Toca ${where} para construir: ${def.name} (${formatNumber(game.buildCost(human, buildMode))} de oro). Esc para cancelar`;
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
    $('ratio-valor').textContent = `${Math.round(ratio * 100)}%`;
    $('ratio-tropas').textContent = `(${formatNumber(human.troops * ratio)} tropas)`;

    for (const [kind, btn] of this._buildButtons) {
      const cost = game.buildCost(human, kind);
      btn.querySelector('.b-coste').textContent = `${formatNumber(cost)} oro`;
      btn.querySelector('.b-num').textContent = human.buildings[kind] ? `×${human.buildings[kind]}` : '';
      btn.classList.toggle('caro', human.gold < cost);
      btn.classList.toggle('activo', buildMode === kind);
      btn.disabled = !playing || !human.alive;
    }

    this._updateAttacks(game, human);
    this._updateLeaderboard(game, human, landCount);
    this._updateNation(game, human, ratio);
    this._updateRequests(game, human);
  }

  _updateAttacks(game, human) {
    const list = $('lista-ataques');
    const seen = new Set();
    for (const atk of human.attacks.values()) {
      seen.add(atk.targetId);
      let row = this._attackRows.get(atk.targetId);
      if (!row) {
        row = document.createElement('li');
        const label = document.createElement('span');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.target = atk.targetId;
        btn.title = 'Retirarse (se pierde la mitad de las tropas del ataque)';
        btn.textContent = '✕';
        row.append(label, btn);
        list.append(row);
        this._attackRows.set(atk.targetId, row);
      }
      const name = atk.targetId ? game.players[atk.targetId].name : 'Tierra libre';
      row.firstChild.textContent = `⚔ ${name} · ${formatNumber(atk.troops)}`;
    }
    for (const [id, row] of this._attackRows) {
      if (!seen.has(id)) {
        row.remove();
        this._attackRows.delete(id);
      }
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
        return `<li data-id="${p.id}" class="${p.isHuman ? 'yo' : ''}">
          <span class="pos">${rank}</span>
          <span class="muestra" style="background:${rgbToCss(p.color)}"></span>
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
      const tag = p.isHuman ? ' (tú)' : human && human.allies.has(p.id) ? ' · aliado' : game.isTraitor(p) ? ' · traidor' : '';
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
