// Interfaz HTML: menú, panel del jugador, clasificación, eventos y tooltip.
import { CONFIG, TERRAIN_NAMES, TICK_MS } from './config.js';
import { rgbToCss } from './colors.js';
import { formatNumber, formatPercent, formatTime } from './format.js';

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
    this._attackRows.clear();
    this._leaderSig = '';
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

  update(game, human, ratio) {
    const landCount = game.map.landCount;

    // Aviso de fase de despliegue
    const aviso = $('aviso');
    if (game.phase === 'spawn') {
      const left = Math.max(0, Math.ceil(((CONFIG.spawnTicks - game.ticks) * TICK_MS) / 1000));
      aviso.textContent = human.spawned
        ? `Posición elegida. Puedes cambiarla — empieza en ${left}s`
        : `Haz clic en el mapa para elegir dónde empezar — ${left}s`;
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
    $('pj-tropas').textContent = `${formatNumber(human.troops)} / ${formatNumber(max)}`;
    $('pj-crec').textContent = game.phase === 'playing' ? `+${formatNumber(human.growthPerTick() * (1000 / TICK_MS))}/s` : '—';
    $('pj-terr').textContent = formatPercent(human.tiles / landCount);
    $('pj-barcos').textContent = `${human.boatCount}/${CONFIG.maxBoats}`;
    $('ratio-valor').textContent = `${Math.round(ratio * 100)}%`;
    $('ratio-tropas').textContent = `(${formatNumber(human.troops * ratio)} tropas)`;

    this._updateAttacks(game, human);
    this._updateLeaderboard(game, human, landCount);
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
        return `<li data-id="${p.id}" class="${p.isHuman ? 'yo' : ''}">
          <span class="pos">${rank}</span>
          <span class="muestra" style="background:${rgbToCss(p.color)}"></span>
          <span class="nom">${escapeHtml(p.name)}</span>
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
      tip.innerHTML = `<b>${escapeHtml(p.name)}</b>${p.isHuman ? ' (tú)' : ''}<br>
        ${formatNumber(p.troops)} tropas · ${formatPercent(p.tiles / map.landCount)}<br>
        <span class="suave">${terrain}</span>`;
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
