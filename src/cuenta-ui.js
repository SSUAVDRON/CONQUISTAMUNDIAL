// Interfaz de la cuenta: botón «Entrar» de la cabecera, diálogo con las
// pestañas Entrar y Crear cuenta, bloque «Cuenta» del perfil y la tarjeta que
// invita a los nuevos a guardar su progreso. La lógica está en cuenta.js.
import { abrirDialogo, cerrarDialogo, sinMovimiento } from './movimiento.js';

const $ = (id) => document.getElementById(id);
const DISMISS_KEY = 'trinchera.cuenta.aviso';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Fuerza de una contraseña: { score 0-4, label }. */
export function passwordStrength(pw) {
  const s = String(pw || '');
  if (!s) return { score: 0, label: '' };
  let score = 0;
  if (s.length >= 8) score++;
  if (s.length >= 12) score++;
  const kinds = [/[a-záéíóúñü]/, /[A-ZÁÉÍÓÚÑÜ]/, /\d/, /[^\wáéíóúñüÁÉÍÓÚÑÜ]/].filter((re) => re.test(s)).length;
  if (kinds >= 2) score++;
  if (kinds >= 3) score++;
  if (s.length < 8) score = Math.min(score, 1);
  return { score, label: ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Muy buena'][score] };
}

/** «hace un momento», «hace 5 min», «hace 2 h» o la fecha. */
export function timeAgo(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export class AccountUI {
  /**
   * `account`: la de cuenta.js (o null si este sitio no tiene cuentas).
   * `onSynced()`: el perfil ha cambiado con lo de la cuenta (repintar).
   */
  constructor(account, { profile, onSynced = () => {} } = {}) {
    this.account = account;
    this.profile = profile;
    this.onSynced = onSynced;
    this.available = false;
    this.mode = 'entrar';
    this.busy = false;
    if (!$('dialogo-cuenta')) return;
    $('btn-cuenta').addEventListener('click', () => this.open('entrar'));
    $('tcu-crear').addEventListener('click', () => this.open('crear'));
    $('tcu-entrar').addEventListener('click', () => this.open('entrar'));
    $('tcu-cerrar').addEventListener('click', () => this._dismissCard());
    for (const tab of document.querySelectorAll('.cu-pestanas [role="tab"]')) tab.addEventListener('click', () => this.setMode(tab.dataset.modo));
    $('cu-ver').addEventListener('click', () => {
      const input = $('cu-password');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('cu-ver').setAttribute('aria-pressed', show ? 'true' : 'false');
      $('cu-ver').setAttribute('aria-label', show ? 'Ocultar la contraseña' : 'Mostrar la contraseña');
    });
    $('cu-password').addEventListener('input', () => this._strength());
    // Al corregir un campo, su error desaparece
    for (const id of ['cu-email', 'cu-password', 'cu-nombre']) {
      $(id).addEventListener('input', () => {
        $(id).classList.remove('mal');
        if ($('cu-error').classList.contains('visible')) this._error('');
      });
    }
    $('cu-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
  }

  /** ¿Hay cuentas aquí? (lo dice main.js tras preguntar al servidor) */
  setAvailable(on) {
    this.available = !!(on && this.account);
    this.render();
  }

  open(mode = 'entrar') {
    if (!this.available) return;
    $('cu-form').reset();
    $('cu-password').type = 'password';
    $('cu-ver').setAttribute('aria-pressed', 'false');
    for (const id of ['cu-email', 'cu-password', 'cu-nombre']) $(id).classList.remove('mal');
    $('cu-form').hidden = false;
    $('cu-hecho').hidden = true;
    document.querySelector('.cu-pestanas').hidden = false;
    this.setMode(mode, { animate: false });
    if (mode === 'crear' && this.profile && this.profile.nombre) $('cu-nombre').value = this.profile.nombre.slice(0, 18);
    abrirDialogo($('dialogo-cuenta'), { foco: mode === 'crear' && !$('cu-nombre').value ? '#cu-nombre' : '#cu-email' });
  }

  setMode(mode, { animate = true } = {}) {
    const box = $('dialogo-cuenta');
    const body = $('cu-cuerpo');
    const before = body.offsetHeight;
    this.mode = mode === 'crear' ? 'crear' : 'entrar';
    box.dataset.modo = this.mode;
    for (const tab of document.querySelectorAll('.cu-pestanas [role="tab"]')) tab.setAttribute('aria-selected', tab.dataset.modo === this.mode ? 'true' : 'false');
    for (const el of box.querySelectorAll('[data-solo]')) el.hidden = el.dataset.solo !== this.mode;
    $('cu-password').setAttribute('autocomplete', this.mode === 'crear' ? 'new-password' : 'current-password');
    box.querySelector('.cu-enviar-txt').textContent = this.mode === 'crear' ? 'Crear cuenta' : 'Entrar';
    this._error('');
    this._strength();
    // La caja cambia de alto con suavidad (Crear cuenta tiene un campo más)
    if (animate && !sinMovimiento() && body.animate) {
      const after = body.offsetHeight;
      if (before && after && before !== after) body.animate([{ height: `${before}px` }, { height: `${after}px` }], { duration: 260, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
    }
  }

  async submit() {
    if (this.busy || !this.account) return;
    const email = $('cu-email').value.trim();
    const password = $('cu-password').value;
    const name = $('cu-nombre').value.trim();
    if (!EMAIL_RE.test(email)) return this._error('Escribe un correo válido.', 'cu-email');
    if (this.mode === 'crear' && password.length < 8) return this._error('La contraseña tiene que tener al menos 8 caracteres.', 'cu-password');
    if (!password) return this._error('Escribe tu contraseña.', 'cu-password');
    this._busy(true);
    try {
      if (this.mode === 'crear') await this.account.register({ email, password, name }, this.profile);
      else await this.account.signIn({ email, password }, this.profile);
      this.onSynced();
      this._done();
    } catch (err) {
      const field = { email: 'cu-email', password: 'cu-password' }[err.field] || (err.status === 401 ? 'cu-password' : '');
      this._error(err.message || 'Algo ha fallado. Inténtalo de nuevo.', field);
    } finally {
      this._busy(false);
    }
  }

  /** Repinta todo lo de la cuenta (cabecera, tarjeta y perfil). */
  render(state = this.account ? this.account.state : null) {
    if (!$('btn-cuenta')) return;
    const on = this.available && !!state;
    const signedIn = on && state.signedIn;
    $('btn-cuenta').hidden = !on || signedIn;
    $('chip-nube').hidden = !signedIn;
    if (signedIn) $('chip-nube').title = `Progreso guardado en tu cuenta (${state.email})`;
    const card = $('tarjeta-cuenta');
    // La invitación sale después de la primera partida (DEV10): antes, las entradas a jugar van primero
    const played = (this.profile?.stats?.partidas || 0) > 0;
    const showCard = on && !signedIn && played && !this._dismissed();
    if (card.hidden === showCard) card.hidden = !showCard;
    const block = $('perfil-cuenta');
    block.hidden = !on;
    if (!on) return;
    block.classList.toggle('con-sesion', signedIn);
    block.classList.toggle('sincronizando', !!state.syncing);
    $('pc-titulo').textContent = signedIn ? state.email : 'Sin cuenta';
    $('pc-estado').textContent = signedIn
      ? state.syncing
        ? 'Sincronizando…'
        : state.error
          ? state.error
          : state.syncedAt
            ? `Sincronizado ${timeAgo(state.syncedAt)}`
            : 'Sin sincronizar todavía'
      : state.error || 'Tu progreso solo está en este dispositivo.';
    const btns = $('pc-botones');
    const want = signedIn ? 'sesion' : 'sin';
    if (btns.dataset.estado !== want) {
      btns.dataset.estado = want;
      const mk = (text, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.textContent = text;
        b.addEventListener('click', fn);
        return b;
      };
      btns.replaceChildren(
        ...(signedIn
          ? [
              mk('Sincronizar ahora', 'btn-sec', () => this.account.sync(this.profile).then(() => this.onSynced()).catch(() => {})),
              mk('Cerrar sesión', 'btn-fantasma', () => this.account.signOut()),
            ]
          : [mk('Crear cuenta', 'principal', () => this.open('crear')), mk('Entrar', 'btn-sec', () => this.open('entrar'))]),
      );
    }
  }

  _done() {
    const fresh = this.mode === 'crear';
    $('cu-hecho-titulo').textContent = fresh ? '¡Cuenta creada, comandante!' : '¡Bienvenido de vuelta!';
    $('cu-hecho-texto').textContent = fresh ? 'Tu progreso de este dispositivo ya está en tu cuenta. Entra con ella en cualquier otro y lo tendrás todo.' : 'Tu progreso se ha unido al de tu cuenta.';
    $('cu-form').hidden = true;
    document.querySelector('.cu-pestanas').hidden = true;
    $('cu-hecho').hidden = false;
    $('cu-hecho').querySelector('button').focus({ preventScroll: true });
  }

  _busy(on) {
    this.busy = on;
    $('cu-enviar').classList.toggle('cargando', on);
    $('cu-enviar').disabled = on;
    $('dialogo-cuenta').setAttribute('aria-busy', on ? 'true' : 'false');
  }

  _error(text, fieldId = '') {
    const p = $('cu-error');
    p.textContent = text;
    p.classList.toggle('visible', !!text);
    if (!text) return;
    if (fieldId) {
      $(fieldId).classList.add('mal');
      $(fieldId).focus({ preventScroll: true });
    }
    // Pequeña sacudida de la caja
    const box = document.querySelector('.dialogo-cuenta');
    if (box.animate && !sinMovimiento()) {
      box.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 320, easing: 'ease-out' });
    }
  }

  _strength() {
    const { score, label } = passwordStrength($('cu-password').value);
    const bar = $('cu-fuerza');
    bar.style.transform = `scaleX(${$('cu-password').value ? Math.max(0.12, score / 4) : 0})`;
    bar.dataset.nivel = String(score);
    $('cu-fuerza-txt').textContent = label;
  }

  _dismissed() {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  }

  _dismissCard() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* sin almacenamiento: vuelve a salir la próxima vez */
    }
    const card = $('tarjeta-cuenta');
    const hide = () => {
      card.hidden = true;
    };
    if (card.animate && !sinMovimiento()) {
      card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px) scale(0.98)' }], { duration: 220, easing: 'ease-in' }).finished.then(hide, hide);
    } else hide();
  }

  close() {
    cerrarDialogo($('dialogo-cuenta'));
  }
}
