// Fichas de lo que da cada cosa (doc-1.7): qué te da un edificio, una mejora
// de la capital o una bomba, con las cifras de tu partida (tu oro, tu techo,
// tus tecnologías…), qué tienes ya, qué cambia al subir de nivel y cómo se
// usa. Solo lee el estado: no toca la simulación.
//
// Las tropas van a la escala de la pantalla (fmtTroops: ÷10) y el oro por
// segundo (10 turnos), igual que el resto del panel.

import { BUILDINGS, CONFIG, RES, TICK_MS, BUILD_GROUPS } from './config.js';
import { MECH, regenPerTick, tradeGold } from './mecanicas.js';
import { fmtTroops, formatNumber } from './format.js';
import { LUGARES } from './lugares.js';

const PER_SEC = 1000 / TICK_MS;
const pct = (x) => `${Math.round(x * 100)} %`;
const dec = (x) => {
  const s = (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  return s.endsWith(',0') ? s.slice(0, -2) : s;
};
const secs = (ticks) => `${dec((ticks * TICK_MS) / 1000)} s`;
const dist = (tiles) => `${Math.round(tiles / RES)}`;

/** Grupo de la barra al que pertenece `kind` (para el color de la ficha). */
export function groupOf(kind) {
  const g = BUILD_GROUPS.find((x) => x.kinds.includes(kind));
  return g ? g.id : 'economia';
}

/** Tiempo de obra de un edificio nuevo (o de su siguiente nivel) en turnos. */
function buildTicks(p, kind, upgrade = false) {
  const def = BUILDINGS[kind];
  if (!def.build) return 0;
  return Math.max(1, Math.round(def.build * (upgrade ? CONFIG.upgradeTimeMult : 1) * (1 - (p.mods.buildSpeed || 0))));
}

const capFactor = (p) => p.capMult * (1 + p.mods.cap);
const goldFactor = (p) => p.goldMult * (1 + p.mods.gold);

/** Tropas por segundo de más que daría subir el techo en `extra` (con las tropas de ahora). */
function regenGain(p, extra) {
  const cap = p.maxTroops();
  const P = p.economy === 'workers' ? p.troops + p.workers : p.troops;
  const k = p.paceRegen * p.regenMult * p.troopMult * Math.max(0.1, 1 + p.mods.growth) * PER_SEC;
  return Math.max(0, (regenPerTick(P, cap + extra) - regenPerTick(P, cap)) * k);
}

/**
 * Ficha de `kind` para el jugador `p`:
 * { kind, name, group, tag, cost, time, summary, gives: [{icon, label, value, note}],
 *   have, next: {title, rows: [{label, from, to}]} | null, how, key, maxed }
 * Iconos: oro, tropas, techo, escudo, alcance, reloj, barco, tren, bomba, banco, muralla, diana.
 */
export function buildingCard(game, p, kind) {
  const def = BUILDINGS[kind];
  const key = def.key ? def.key.slice(3) : '';
  const cost = game.buildCost(p, kind);
  const count = p.buildings[kind] || 0;
  const levels = p.levels[kind] || 0;
  const card = { kind, name: def.name, group: groupOf(kind), tag: 'Edificio', cost, time: 0, summary: '', gives: [], have: '', next: null, how: '', key, maxed: false };
  const where = def.coastal ? 'en tu costa' : 'en tu territorio';
  const upHow = `Sobre ${def.fem ? 'una tuya' : 'uno tuyo'}: sube de nivel (hasta ${CONFIG.maxLevel}).`;
  card.time = buildTicks(p, kind);

  switch (kind) {
    case 'capUp': {
      const C = MECH.capital;
      const cap = p.capital;
      const up = cap ? cap.up || 0 : 0;
      card.tag = 'Mejora';
      card.givesTitle = 'Cada nivel te da';
      card.name = 'Mejorar la capital';
      card.time = cap ? Math.max(1, Math.round((C.buildTicks + C.buildTicksPerLevel * up) * (1 - (p.mods.buildSpeed || 0)))) : 0;
      card.summary = 'Tu capital da más oro, guarda más tropas en su banco y se defiende mejor. Se mejora al momento, sin elegir sitio.';
      const b = p.goldBreakdown();
      const passive = (b.base + b.tax + b.villages + b.workers) * PER_SEC;
      const bank = (lvl) => p.maxTroops() * (C.bankBase + C.bankPerLevel * lvl);
      const wall = (lvl) => C.wallMult + C.wallMultPerLevel * lvl;
      const outer = (lvl) => C.outerMult + C.outerMultPerLevel * lvl;
      const shots = (lvl) => CONFIG.capitalSamShots + Math.floor(lvl / CONFIG.capitalSamShotsEvery);
      card.gives = [
        { icon: 'oro', label: 'Oro pasivo', value: `+${pct(C.gold)}`, note: `≈ +${formatNumber(passive * C.gold)}/s más` },
        { icon: 'banco', label: 'Banco de tropas', value: `+${pct(C.bankPerLevel)} del techo`, note: `+${fmtTroops(p.maxTroops() * C.bankPerLevel)} de sitio` },
        { icon: 'muralla', label: 'Murallas', value: `+${dec(C.wallMultPerLevel)} de defensa` },
      ];
      if (!cap) {
        card.have = 'No tienes capital.';
        card.haveWarn = true;
        card.maxed = true;
      } else if (up >= C.maxLevel) {
        card.maxed = true;
        card.have = `Nivel ${up} (el máximo): +${pct(C.gold * up)} de oro, banco de ${fmtTroops(bank(up))} tropas, murallas ×${dec(wall(up))}.`;
      } else {
        card.have = `Nivel ${up} de ${C.maxLevel}${up ? `: +${pct(C.gold * up)} de oro` : ''} · banco ${fmtTroops(cap.bank || 0)} / ${fmtTroops(bank(up))}.`;
        card.next = {
          title: `Nivel ${up} → ${up + 1}`,
          rows: [
            { label: 'Oro pasivo', from: `+${pct(C.gold * up)}`, to: `+${pct(C.gold * (up + 1))}` },
            { label: 'Banco de tropas', from: fmtTroops(bank(up)), to: fmtTroops(bank(up + 1)) },
            { label: 'Murallas', from: `×${dec(wall(up))}`, to: `×${dec(wall(up + 1))}` },
            { label: 'Afueras', from: `×${dec(outer(up))}`, to: `×${dec(outer(up + 1))}` },
            { label: 'Escudo antimisiles', from: `${shots(up)} por salva`, to: `${shots(up + 1)} por salva` },
          ].filter((r) => r.from !== r.to),
        };
      }
      card.how = cap && cap.work ? 'Ya tiene una obra en marcha: espera a que acabe.' : 'Clic y empieza la obra. Una obra a la vez, hasta el nivel 10.';
      break;
    }
    case 'village': {
      const gold = MECH.village.gold * goldFactor(p) * PER_SEC;
      const capT = MECH.village.cap * capFactor(p);
      card.summary = 'Pequeño y barato: da oro y tropas sin ocupar casi sitio.';
      card.gives = [
        { icon: 'oro', label: 'Oro', value: `+${formatNumber(gold)}/s` },
        { icon: 'techo', label: 'Techo de tropas', value: `+${fmtTroops(capT)}` },
      ];
      card.have = count ? `${count} ${count === 1 ? 'pueblo' : 'pueblos'}${levels > count ? ` (${levels} niveles)` : ''}: +${formatNumber(gold * levels)}/s de oro y +${fmtTroops(capT * levels)} de techo.` : 'Ningún pueblo todavía.';
      card.givesTitle = 'Qué te da (y otra vez cada nivel)';
      card.how = `Clic ${where}. ${upHow}`;
      break;
    }
    case 'city': {
      const extra = MECH.cityCapBonus * capFactor(p);
      card.summary = 'Sube tu techo de tropas: cabe más ejército y se regenera más rápido.';
      card.gives = [
        { icon: 'techo', label: 'Techo de tropas', value: `+${fmtTroops(extra)}` },
        { icon: 'tropas', label: 'Regeneración', value: `≈ +${fmtTroops(regenGain(p, extra))}/s`, note: 'con tus tropas de ahora' },
      ];
      card.have = count ? `${count} ${count === 1 ? 'ciudad' : 'ciudades'}${levels > count ? ` (${levels} niveles)` : ''}: +${fmtTroops(extra * levels)} de techo.` : 'Ninguna ciudad todavía.';
      card.givesTitle = 'Qué te da (y otra vez cada nivel)';
      card.how = `Clic ${where}. ${upHow}`;
      break;
    }
    case 'port': {
      const F = MECH.fishing;
      card.summary = 'Abre el mar: mercantes que comercian, pesqueros y barcos para desembarcar.';
      card.gives = [
        { icon: 'oro', label: 'Mercantes', value: `${formatNumber(tradeGold(100))}–${formatNumber(tradeGold(300))}`, note: 'por viaje; también cobra el puerto de destino' },
        { icon: 'barco', label: 'Pesqueros', value: `hasta ${F.maxPerPort}`, note: `≈ ${formatNumber(F.base * 1.4)} de oro por viaje (una barca por nivel)` },
        { icon: 'barco', label: 'Desembarcos y buques', value: 'Permite', note: 'sin puerto no salen barcos' },
      ];
      card.have = count ? `${count} ${count === 1 ? 'puerto' : 'puertos'}${levels > count ? ` (${levels} niveles)` : ''}.` : 'Ningún puerto todavía.';
      card.next = { title: 'Cada nivel', rows: [
        { label: 'Mercantes', from: '', to: 'salen más a menudo' },
        { label: 'Pesca', from: '', to: `+1 barca y +${pct(F.levelBonus)} por viaje` },
      ] };
      card.how = `Clic en tu costa (se pone en la orilla más cercana). ${upHow} Comparte precio con las fábricas.`;
      break;
    }
    case 'factory': {
      card.summary = 'Tiende vías de tren hasta tus ciudades, puertos y otras fábricas cercanas.';
      card.gives = [
        { icon: 'tren', label: 'Cada tren', value: `+${formatNumber(MECH.trainRewards.self)}`, note: `de oro al llegar (${formatNumber(MECH.trainRewards.ally)} en una estación aliada)` },
        { icon: 'alcance', label: 'Alcance de las vías', value: `${dist(game.railRange(1))} casillas` },
      ];
      card.have = count ? `${count} ${count === 1 ? 'fábrica' : 'fábricas'}${levels > count ? ` (${levels} niveles)` : ''}.` : 'Ninguna fábrica todavía: hacen falta ciudades o puertos cerca.';
      card.next = { title: 'Cada nivel', rows: [{ label: 'Alcance de las vías', from: '', to: `+${dist(CONFIG.railRangePerLevel)} casillas` }] };
      card.how = `Clic ${where}, cerca de tus ciudades y puertos. ${upHow} Comparte precio con los puertos.`;
      break;
    }
    case 'fort': {
      const r = game.fortRadius(1) * (1 + (p.mods.fortRadius || 0));
      card.summary = 'Protege una zona: quien te ataque ahí tarda y pierde mucho más.';
      card.gives = [
        { icon: 'escudo', label: 'Defensa', value: `×${dec(CONFIG.fortDefenseMult)}`, note: 'tiempo y bajas del atacante' },
        { icon: 'alcance', label: 'Radio', value: `${dist(r)} casillas` },
      ];
      card.have = count ? `${count} ${count === 1 ? 'puesto' : 'puestos'}${levels > count ? ` (${levels} niveles)` : ''}.` : 'Ningún puesto todavía.';
      card.next = { title: 'Cada nivel', rows: [
        { label: 'Defensa', from: '', to: `+${dec(CONFIG.fortMultPerLevel)}` },
        { label: 'Radio', from: '', to: `+${dist(CONFIG.fortRadiusPerLevel)} casillas` },
      ] };
      card.how = `Clic ${where}, en la frontera que quieras guardar. ${upHow}`;
      break;
    }
    case 'sam': {
      const hit = (lvl) => Math.min(CONFIG.samHitMax, CONFIG.samHitChance + CONFIG.samHitPerLevel * (lvl - 1) + (p.mods.samHit || 0));
      const shots = (lvl) => CONFIG.samShots + CONFIG.samShotsPerLevel * (lvl - 1);
      const reload = (lvl) => Math.round(CONFIG.samReload * (1 - CONFIG.samReloadPerLevel * (lvl - 1)));
      card.summary = 'Derriba las bombas enemigas que pasan cerca, también las que van a por tus vecinos.';
      card.gives = [
        { icon: 'alcance', label: 'Alcance', value: `${dist(game.samRange(1))} casillas` },
        { icon: 'diana', label: 'Salva', value: `${shots(1)} disparos`, note: `${pct(hit(1))} de acierto cada uno: si el primero falla, el segundo lo intenta` },
        { icon: 'reloj', label: 'Recarga', value: secs(reload(1)) },
      ];
      card.have = count ? `${count} ${count === 1 ? 'batería' : 'baterías'}${levels > count ? ` (${levels} niveles)` : ''}.` : 'Ninguna batería todavía.';
      card.next = { title: 'Nivel 1 → 2', rows: [
        { label: 'Alcance', from: dist(game.samRange(1)), to: dist(game.samRange(2)) },
        { label: 'Disparos por salva', from: `${shots(1)}`, to: `${shots(2)}` },
        { label: 'Acierto', from: pct(hit(1)), to: pct(hit(2)) },
        { label: 'Recarga', from: secs(reload(1)), to: secs(reload(2)) },
      ] };
      card.how = `Clic ${where}, cerca de lo que quieras proteger. ${upHow}`;
      break;
    }
    case 'warship': {
      card.tag = 'Unidad';
      card.summary = 'Un buque de guerra que vigila una zona del mar para siempre.';
      card.gives = [
        { icon: 'barco', label: 'Hunde', value: 'barcos y buques', note: 'enemigos que entren en su zona' },
        { icon: 'oro', label: 'Captura', value: 'mercantes', note: 'enemigos: su oro es tuyo' },
        { icon: 'escudo', label: 'Vida', value: `${CONFIG.warshipHp}` },
      ];
      card.have = !p.active.port ? 'Necesitas un puerto terminado.' : count ? `${count} ${count === 1 ? 'buque' : 'buques'} (hasta ${CONFIG.warshipsPerPort} por puerto).` : `Ningún buque todavía (hasta ${CONFIG.warshipsPerPort} por puerto).`;
      card.haveWarn = !p.active.port;
      card.how = 'Necesita un puerto. Clic en el mar donde patrullará: la zona ya no se puede cambiar.';
      break;
    }
    case 'silo': {
      card.summary = 'La lanzadera de las bombas.';
      card.gives = [
        { icon: 'bomba', label: 'Permite lanzar', value: 'bombas', note: 'atómicas, H y MIRV' },
        { icon: 'reloj', label: 'Recarga', value: secs(CONFIG.siloReload) },
      ];
      card.have = count ? `${count} ${count === 1 ? 'silo' : 'silos'}.` : 'Ningún silo todavía.';
      card.next = { title: 'Cada nivel', rows: [{ label: 'Recarga', from: '', to: `−${pct(CONFIG.siloReloadPerLevel)}` }] };
      card.how = `Clic ${where}. ${upHow}`;
      break;
    }
    case 'missile':
    case 'hbomb':
    case 'mirv': {
      card.tag = 'Bomba';
      const R = CONFIG.missileRadius;
      const silos = game.buildings.filter((b) => b.owner === p.id && b.kind === 'silo' && b.level > 0);
      const ready = silos.filter((b) => b.readyAt <= game.ticks).length;
      if (kind === 'missile') {
        card.summary = 'Arrasa una zona enemiga: las casillas quedan libres y el defensor pierde tropas.';
        card.gives = [{ icon: 'bomba', label: 'Radio', value: `${dist(R)} casillas` }];
      } else if (kind === 'hbomb') {
        card.summary = 'Como la atómica, pero arrasa una zona mucho mayor.';
        card.gives = [{ icon: 'bomba', label: 'Radio', value: `${dist(R * CONFIG.hbombRadius)} casillas`, note: `${dec(CONFIG.hbombRadius)} veces la atómica` }];
      } else {
        card.summary = 'Se divide en muchas cabezas que caen por todo el país enemigo.';
        card.gives = [{ icon: 'bomba', label: 'Cabezas', value: `${CONFIG.mirvWarheads}`, note: `de radio ${dist(R * CONFIG.mirvRadius)} cada una` }];
      }
      card.gives.push({ icon: 'tropas', label: 'Tropas del defensor', value: 'mueren', note: 'según las que tenga por casilla' });
      card.gives.push({ icon: 'escudo', label: 'Pueden derribarla', value: '', note: 'los antimisiles y el escudo de las capitales; dentro de las murallas de una capital no arrasa' });
      card.have = silos.length ? `${ready} de ${silos.length} ${silos.length === 1 ? 'silo listo' : 'silos listos'}.` : 'Necesitas un silo (Ataque · tecla G).';
      card.haveWarn = !ready;
      card.how = 'Clic en el objetivo enemigo, al alcance de un silo listo.';
      break;
    }
    default:
      card.summary = def.desc || '';
      card.how = `Clic ${where}.`;
  }
  return card;
}

/** Una línea corta con lo principal (la bandeja del móvil). */
export function shortEffect(game, p, kind) {
  switch (kind) {
    case 'capUp': {
      const cap = p.capital;
      if (cap && cap.up >= MECH.capital.maxLevel) return 'Al máximo';
      return `+${pct(MECH.capital.gold)} oro`;
    }
    case 'village':
      return `+${formatNumber(MECH.village.gold * goldFactor(p) * PER_SEC)}/s · +${fmtTroops(MECH.village.cap * capFactor(p))}`;
    case 'city':
      return `+${fmtTroops(MECH.cityCapBonus * capFactor(p))} tropas`;
    case 'port':
      return 'Comercio';
    case 'factory':
      return `Trenes +${formatNumber(MECH.trainRewards.self)}`;
    case 'fort':
      return `Defensa ×${dec(CONFIG.fortDefenseMult)}`;
    case 'sam':
      return `Derriba bombas`;
    case 'warship':
      return 'Patrulla el mar';
    case 'silo':
      return 'Lanza bombas';
    case 'missile':
      return `Radio ${dist(CONFIG.missileRadius)}`;
    case 'hbomb':
      return `Radio ${dist(CONFIG.missileRadius * CONFIG.hbombRadius)}`;
    case 'mirv':
      return `${CONFIG.mirvWarheads} cabezas`;
    default:
      return '';
  }
}

/**
 * Bonos que tiene `p` ahora: los de los lugares de interés (los de un rato,
 * con lo que les queda, y los de para siempre, sumados) y los de su capital.
 * [{ id, icon, title, value, text, left }] (left: segundos, o null).
 */
export function activeBonuses(game, p) {
  const out = [];
  const cap = p.capital;
  if (cap && cap.up > 0 && game.buildingAt.get(cap.tile) === cap) {
    out.push({ id: 'capital', icon: '🏰', title: `Capital nivel ${cap.up}`, value: `+${pct(MECH.capital.gold * cap.up)} oro`, text: `Tu capital a nivel ${cap.up}: +${pct(MECH.capital.gold * cap.up)} de oro pasivo, banco de tropas del ${pct(MECH.capital.bankBase + MECH.capital.bankPerLevel * cap.up)} de tu techo y murallas ×${dec(MECH.capital.wallMult + MECH.capital.wallMultPerLevel * cap.up)}.`, left: null });
  }
  for (const b of p.buffs || []) {
    const left = Math.max(0, Math.ceil(((b.until - game.ticks) * TICK_MS) / 1000));
    if (left <= 0) continue;
    const def = LUGARES[b.kind];
    out.push({ id: `buff-${b.kind}-${b.until}`, icon: def.icon, title: def.name, value: def.short || '', text: `${def.desc}.`, left, total: Math.round(((def.ticks || 0) * TICK_MS) / 1000) });
  }
  const perm = p.permMods || {};
  const permNames = { gold: 'de oro', cap: 'de techo de tropas', growth: 'de crecimiento' };
  const permShort = { gold: 'oro', cap: 'techo', growth: 'crecim.' };
  for (const [k, v] of Object.entries(perm)) {
    if (!v) continue;
    const src = Object.values(LUGARES).filter((d) => d.perm && d.perm[k]);
    const icon = src[0] ? src[0].icon : '⭐';
    out.push({ id: `perm-${k}`, icon, title: 'Para siempre', value: `+${pct(v)} ${permShort[k] || k}`, text: `Lugares de interés tomados: +${pct(v)} ${permNames[k] || k} para el resto de la partida.`, left: null });
  }
  return out;
}
