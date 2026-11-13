// Amigos, invitaciones a sala y clanes (en la web, con cuenta): habla con
// api/social.php usando la sesión de cuenta.js. La interfaz está en
// social-ui.js. Sin cuenta, o en el enlace de Claude (sin API), no hace nada.
import { levelInfo, titleName } from './profile.js';
import { rankOf, inPlacement } from './rangos.js';

const API = 'api/social.php';

export class SocialError extends Error {
  constructor(message, status = 0, body = {}) {
    super(message);
    this.status = status;
    this.field = body.campo || '';
  }
}

/** Ficha pública de tu perfil: lo que ven tus amigos y tu clan (nada privado). */
export function cardOf(profile) {
  const s = profile.stats || {};
  const card = {
    nombre: profile.nombre || 'Mi nación',
    nivel: levelInfo(profile.xp || 0).level,
    titulo: titleName(profile) || '',
    emblema: profile.emblema,
    marco: profile.marco,
    estandarte: profile.estandarte,
    colorNombre: profile.colorNombre,
    victorias: s.victorias || 0,
    partidas: s.partidas || 0,
    mejor: s.mejorPct || 0,
  };
  const r = profile.rango;
  if (r && r.partidas > 0 && !inPlacement(r)) {
    const k = rankOf(r.puntos);
    card.liga = { nombre: k.label, pl: Math.round(r.puntos) };
  }
  return card;
}

/**
 * Estado social y acciones. `onChange(data)` cada vez que llegan datos
 * nuevos (o un error). `data`: lo que devuelve la acción «social» de la API.
 */
export class Social {
  constructor(account, { onChange = () => {}, fetchFn = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null, base = '' } = {}) {
    this.account = account;
    this.onChange = onChange;
    this.fetch = fetchFn;
    this.url = `${base}${API}`;
    this.data = null;
    this.error = '';
    this.estado = 'menu';
    this._cardJson = '';
    this._timer = null;
    this._busy = null;
  }

  get ready() {
    return !!(this.account && this.account.signedIn);
  }

  async call(accion, data = {}) {
    if (!this.ready) throw new SocialError('Inicia sesión para usar amigos y clanes.', 401);
    if (!this.fetch) throw new SocialError('Sin conexión.');
    let res;
    try {
      res = await this.fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion, token: this.account.session.token, ...data }), cache: 'no-store' });
    } catch {
      throw new SocialError('No hay conexión con el servidor. Inténtalo de nuevo.');
    }
    let body = {};
    try {
      body = await res.json();
    } catch {
      /* respuesta vacía */
    }
    if (!res.ok) throw new SocialError(res.status === 404 && !body.error ? 'Este servidor no tiene amigos ni clanes.' : body.error || 'Algo ha fallado. Inténtalo de nuevo.', res.status, body);
    return body;
  }

  /**
   * Trae amigos, solicitudes, invitaciones y tu clan (y te marca en línea).
   * Con `fresh`, si ya había una petición en marcha (de antes de una acción),
   * pide otra al terminar: lo que se pinta incluye lo que acabas de hacer.
   */
  refresh(fresh = false) {
    if (!this.ready) {
      this.data = null;
      return Promise.resolve(null);
    }
    if (this._busy) return fresh ? this._busy.then(() => this.refresh()) : this._busy;
    if (this.estadoFn) this.estado = this.estadoFn();
    this._last = Date.now();
    this._busy = this.call('social', { estado: this.estado })
      .then((d) => {
        this.data = d;
        this.error = '';
        this._emit();
        return d;
      })
      .catch((err) => {
        this.error = err.message;
        this._emit();
        return null;
      })
      .finally(() => {
        this._busy = null;
      });
    return this._busy;
  }

  _emit() {
    try {
      this.onChange(this.data, this.error);
    } catch {
      /* la interfaz no debe romper esto */
    }
  }

  /** Sondeo: cada `ms` (30 s en el menú; menos a menudo en partida). */
  poll(ms) {
    clearInterval(this._timer);
    this._timer = null;
    if (!ms || !this.ready) return;
    this._timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      // En partida, cada 90 s basta (solo para seguir «en línea»)
      if (this.estadoFn && this.estadoFn() === 'partida' && Date.now() - (this._last || 0) < 85000) return;
      this.refresh();
    }, ms);
  }

  /** Dónde estás: 'menu', 'sala' o 'partida' (lo ven tus amigos). */
  setEstado(estado) {
    this.estado = estado;
  }

  /** Olvida la última ficha mandada (al cambiar de cuenta, para mandar la nueva). */
  forgetCard() {
    this._cardJson = '';
  }

  /** Manda tu ficha pública si ha cambiado. */
  async saveCard(profile) {
    if (!this.ready) return;
    const card = cardOf(profile);
    const json = JSON.stringify(card);
    if (json === this._cardJson) return;
    this._cardJson = json;
    try {
      await this.call('ficha_guardar', { ficha: card });
    } catch {
      this._cardJson = '';
    }
  }

  // Acciones (cada una refresca los datos al terminar)
  async _act(accion, data) {
    const out = await this.call(accion, data);
    await this.refresh(true);
    return out;
  }
  search(texto) {
    return this.call('buscar', { texto });
  }
  addFriend(codigo) {
    return this._act('amigo_solicitar', { codigo });
  }
  respondFriend(id, aceptar) {
    return this._act('amigo_responder', { id, aceptar });
  }
  removeFriend(id) {
    return this._act('amigo_quitar', { id });
  }
  invite(id, sala, red) {
    return this.call('invitar', { id, sala, red });
  }
  dismissInvite(id) {
    return this._act('invitacion_borrar', { id });
  }
  clans(texto = '') {
    return this.call('clanes', { texto });
  }
  clan(id) {
    return this.call('clan_ver', { id });
  }
  createClan(c) {
    return this._act('clan_crear', c);
  }
  joinClan(id) {
    return this._act('clan_unirse', { id });
  }
  cancelClan(id) {
    return this._act('clan_cancelar', { id });
  }
  respondClan(cuenta, aceptar) {
    return this._act('clan_responder', { cuenta, aceptar });
  }
  leaveClan() {
    return this._act('clan_salir');
  }
  kick(cuenta) {
    return this._act('clan_expulsar', { cuenta });
  }
  setRole(cuenta, rol) {
    return this._act('clan_rol', { cuenta, rol });
  }
  editClan(c) {
    return this._act('clan_editar', c);
  }
}
