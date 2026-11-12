// Cuenta de Trinchera en la web: crear cuenta y entrar con correo y
// contraseña (api/cuentas.php), y el perfil entero guardado en el servidor
// para jugar desde cualquier dispositivo. Preparada para Google y Apple: la
// API dirá qué proveedores hay (de momento, ninguno).
//
// En el enlace de Claude no hay API: ahí sigue la nube de Claude.
import { mergeProfiles, saveProfile } from './profile.js';
import { Ladder, apiIdentity, setApiIdentity } from './ladder.js';

const API = 'api/cuentas.php';
const KEY = 'trinchera.cuenta';

/** Error de la API con su código HTTP y el campo que falla (si lo dice). */
export class AccountError extends Error {
  constructor(message, status = 0, body = {}) {
    super(message);
    this.status = status;
    this.field = body.campo || '';
    this.body = body;
  }
}

/**
 * Sesión y sincronización. `onChange(state)` cada vez que cambia algo
 * (entrar, salir, sincronizar, error). `fetchFn`, `base` y `storage` se
 * pueden cambiar en los tests.
 */
export class Account {
  constructor({ onChange = () => {}, fetchFn = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null, base = '', storage = typeof localStorage !== 'undefined' ? localStorage : null } = {}) {
    this.onChange = onChange;
    this.fetch = fetchFn;
    this.url = `${base}${API}`;
    this.storage = storage;
    this.syncing = null;
    this.error = '';
    this.session = this._load();
  }

  /** ¿Hay cuentas en este sitio? (la web servida por http(s), fuera de Claude) */
  static available(loc = typeof location !== 'undefined' ? location : null) {
    return Ladder.webAvailable(loc);
  }

  get signedIn() {
    return !!(this.session && this.session.token);
  }

  /** Lo que la interfaz necesita saber. */
  get state() {
    const s = this.session || {};
    return { signedIn: this.signedIn, email: s.email || '', name: s.nombre || '', syncedAt: s.sincronizado || 0, syncing: !!this.syncing, error: this.error };
  }

  _load() {
    try {
      const s = JSON.parse(this.storage?.getItem(KEY) || 'null');
      return s && /^[0-9a-f]{64}$/.test(s.token || '') ? s : null;
    } catch {
      return null;
    }
  }

  _save() {
    try {
      if (this.session) this.storage?.setItem(KEY, JSON.stringify(this.session));
      else this.storage?.removeItem(KEY);
    } catch {
      /* sin almacenamiento: la sesión dura lo que la pestaña */
    }
  }

  _emit() {
    try {
      this.onChange(this.state);
    } catch {
      /* la interfaz no debe romper la cuenta */
    }
  }

  async _post(accion, data = {}) {
    if (!this.fetch) throw new AccountError('Sin conexión.');
    let res;
    try {
      res = await this.fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion, ...data }), cache: 'no-store' });
    } catch {
      throw new AccountError('No hay conexión con el servidor. Inténtalo de nuevo.');
    }
    let body = {};
    try {
      body = await res.json();
    } catch {
      /* respuesta vacía o no JSON */
    }
    if (!res.ok) {
      const msg = res.status === 404 ? 'Este servidor no tiene cuentas.' : body.error || 'Algo ha fallado. Inténtalo de nuevo.';
      throw new AccountError(msg, res.status, body);
    }
    return body;
  }

  async _start(accion, data, profile) {
    const body = await this._post(accion, data);
    this.session = { token: body.token, email: body.cuenta.email, nombre: body.cuenta.nombre, version: 0, sincronizado: 0 };
    this.error = '';
    this._save();
    this._emit();
    // Lo que había en este dispositivo se une a lo de la cuenta
    if (profile) await this.sync(profile).catch(() => {});
    return this.state;
  }

  /** Crea la cuenta (y entra). */
  register({ email, password, name }, profile) {
    return this._start('registro', { email, password, nombre: name || '' }, profile);
  }

  /** Entra con correo y contraseña. */
  signIn({ email, password }, profile) {
    return this._start('entrar', { email, password }, profile);
  }

  /** Cierra la sesión (el progreso se queda también en este dispositivo). */
  async signOut() {
    const token = this.session?.token;
    this.session = null;
    this.error = '';
    this._save();
    this._emit();
    if (token) await this._post('salir', { token }).catch(() => {});
  }

  /** ¿Responde la API de cuentas en este servidor? (en uno estático, sin PHP, no) */
  async probe() {
    try {
      const body = await this._post('proveedores');
      this.providerList = Array.isArray(body.proveedores) ? body.proveedores : [];
      return true;
    } catch {
      return false;
    }
  }

  /** Proveedores externos activos (Google, Apple…) según el servidor. */
  async providers() {
    try {
      const body = await this._post('proveedores');
      return Array.isArray(body.proveedores) ? body.proveedores : [];
    } catch {
      return [];
    }
  }

  /**
   * Une el perfil de la cuenta con el de este dispositivo y guarda el
   * resultado en los dos. Si otro dispositivo guardó a la vez (409), vuelve a
   * unir con lo nuevo y a guardar. Cambia `profile` en el sitio.
   */
  sync(profile) {
    if (!this.signedIn) return Promise.resolve(false);
    if (this.syncing) {
      // Ya hay una en marcha: otra justo después (con los últimos cambios)
      this._again = true;
      return this.syncing;
    }
    this.syncing = this._sync(profile).finally(() => {
      this.syncing = null;
      if (this._again) {
        this._again = false;
        this.sync(profile).catch(() => {});
      }
      this._emit();
    });
    this._emit();
    return this.syncing;
  }

  async _sync(profile) {
    const token = this.session.token;
    try {
      const read = await this._post('perfil_leer', { token });
      let remote = read.perfil;
      let version = read.version || 0;
      if (read.cuenta) Object.assign(this.session, { email: read.cuenta.email, nombre: read.cuenta.nombre });
      for (let attempt = 0; attempt < 3; attempt++) {
        if (remote) {
          Object.assign(profile, mergeProfiles(profile, remote));
          // La fila de rangos de la cuenta manda sobre la de este dispositivo
          if (remote.apiRango) profile.apiRango = remote.apiRango;
        }
        this._shareLadderIdentity(profile);
        saveProfile(profile);
        try {
          const saved = await this._post('perfil_guardar', { token, perfil: profile, version });
          this.session.version = saved.version;
          this.session.sincronizado = Date.now();
          this.error = '';
          this._save();
          return true;
        } catch (err) {
          if (err.status !== 409) throw err;
          remote = err.body.perfil;
          version = err.body.version || 0;
        }
      }
      throw new AccountError('El perfil cambia en otro dispositivo: se sincronizará en un momento.');
    } catch (err) {
      if (err.status === 401) {
        // Sesión caducada o cerrada: hay que volver a entrar
        this.session = null;
        this._save();
        this.error = err.message;
      } else this.error = err.message || 'No se ha podido sincronizar.';
      throw err;
    }
  }

  /**
   * La fila de la tabla de rangos es la misma en todos tus dispositivos: su
   * id y secreto viajan en el perfil de la cuenta (que solo lees tú).
   */
  _shareLadderIdentity(profile) {
    const valid = (x) => x && /^[0-9a-f]{32}$/.test(x.id || '') && /^[0-9a-f]{64}$/.test(x.secreto || '');
    if (valid(profile.apiRango)) {
      const local = apiIdentity(this.storage);
      if (!local || local.id !== profile.apiRango.id) setApiIdentity(profile.apiRango, this.storage);
    } else {
      const local = apiIdentity(this.storage);
      if (valid(local)) profile.apiRango = { id: local.id, secreto: local.secreto };
    }
  }
}
