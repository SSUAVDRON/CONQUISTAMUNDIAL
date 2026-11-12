// Interfaz de Amigos y Clan (pestañas del perfil) y avisos de invitación a
// sala. Los datos y las acciones están en social.js; aquí solo se pintan.
//
// Sin cuenta: invita a crearla. En el enlace de Claude (sin API): explica que
// amigos y clanes están en la web con cuenta.
import { drawEmblem, drawFrame } from './icons.js';
import { NAME_COLORS, SHAPES, SYMBOLS } from './profile.js';
import { timeAgo } from './cuenta-ui.js';

const $ = (id) => document.getElementById(id);
const CLAN_MAX = 30;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

const SVG = {
  copiar: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  buscar: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m10.5 10.5 3.6 3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  mas: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  amigos: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="11" cy="5.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.5 13c0-2.5 1.8-4 4-4s4 1.5 4 4M9 9.3c.6-.2 1.3-.3 2-.3 2 0 3.5 1.3 3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  clan: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 13.5 4v4c0 3.2-2.4 5.3-5.5 6.4C4.9 13.3 2.5 11.2 2.5 8V4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m5.6 8 1.7 1.7L10.6 6.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  corona: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 12V5l3 2.5L8 3l3 4.5L14 5v7z" fill="currentColor"/></svg>',
  estrella: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 9.9 5.9l4.4.5-3.3 3 .9 4.4L8 11.6l-3.9 2.2.9-4.4-3.3-3 4.4-.5z" fill="currentColor"/></svg>',
  sala: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5V6l5.5-3.5L13.5 6v7.5M6 13.5V9h4v4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};
const icon = (name) => {
  const s = document.createElement('span');
  s.className = 'soc-ic';
  s.innerHTML = SVG[name] || '';
  return s;
};

/** Emblema con su marco, en un lienzo (en caché por su aspecto). */
const emblemCache = new Map();
function emblemImg(emblema, marco, size = 48) {
  const key = JSON.stringify([emblema, marco, size]);
  let url = emblemCache.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = c.height = size * 2;
    const ctx = c.getContext('2d');
    drawEmblem(ctx, emblema || { shape: 'escudo', symbol: 'estrella', bg: '#2f7dff', fg: '#ffffff' }, size, size, size * 1.32);
    if (marco) drawFrame(ctx, marco, size, size, size * 1.32);
    url = c.toDataURL();
    if (emblemCache.size > 300) emblemCache.clear();
    emblemCache.set(key, url);
  }
  return el('img', { class: 'soc-emblema', src: url, alt: '', width: size, height: size });
}

const nameColor = (f) => {
  const c = NAME_COLORS.find((x) => x.id === f.colorNombre);
  return c && c.color ? c.color : f.emblema?.bg || '#ffd23f';
};

const formatCode = (c) => (c && c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c || '');

/** «En línea», «En una sala», «Jugando» o «Visto hace…». */
function presence(p, now) {
  if (p.estado === 'partida') return { cls: 'jugando', text: 'Jugando' };
  if (p.estado === 'sala') return { cls: 'sala', text: 'En una sala' };
  if (p.estado === 'menu') return { cls: 'linea', text: 'En línea' };
  return { cls: 'fuera', text: p.visto ? `Visto ${timeAgo(p.visto * 1000, now)}` : 'Desconectado' };
}

const ROLES = { lider: 'Líder', oficial: 'Oficial', miembro: 'Miembro' };

export class SocialUI {
  /**
   * `social`: el de social.js (o null si este sitio no tiene API).
   * `accountUI`: para abrir «Entrar» / «Crear cuenta».
   * `getRoom()`: tu sala abierta ({ code, red }) o null (para invitar).
   * `onJoinInvite(inv)`: entrar en la sala de una invitación.
   */
  constructor(social, { accountUI = null, getRoom = () => null, onJoinInvite = () => {}, onSummary = () => {}, isBusy = () => false } = {}) {
    this.social = social;
    this.isBusy = isBusy;
    this.accountUI = accountUI;
    this.getRoom = getRoom;
    this.onJoinInvite = onJoinInvite;
    this.onSummary = onSummary;
    this.available = false; // ¿hay API en este sitio?
    this.tab = null;
    this.clanView = null; // detalle del clan (el tuyo o el que miras)
    this.clanList = null;
    this.results = null;
    this.searchText = '';
    this.clanSearch = '';
    this._seenInvites = new Set();
    this._confirm = null;
    this.editing = false;
    this.draft = { nombre: '', tag: '', descripcion: '', abierto: true, insignia: { shape: 'escudo', symbol: 'corona', bg: '#8a1c1c', fg: '#ffd23f' } };
    // Las pestañas del perfil avisan al cambiar (ver home.js, _profileTab)
    $('perfil-pestanas')?.addEventListener('pestana', (e) => this.show(e.detail));
    this.toast = el('div', { class: 'soc-aviso', role: 'status', 'aria-live': 'polite', hidden: true });
    document.body.append(this.toast);
  }

  /** ¿Hay amigos y clanes en este sitio? (lo dice la API al arrancar) */
  setAvailable(on) {
    this.available = !!on;
    this.render();
  }

  /** La pestaña del perfil que se ve ('resumen', 'amigos', 'clan' o 'aspecto'). */
  show(tab) {
    this.tab = tab;
    if (tab === 'amigos' || tab === 'clan') {
      this.render();
      if (this.social?.ready) {
        this.social.refresh();
        if (tab === 'clan') this._loadClans();
      }
    }
  }

  /** Datos nuevos de la API (o un error). */
  update(data) {
    this._badges(data);
    this._invites(data);
    this.onSummary(data ? { clan: data.clan, amigos: data.amigos.length, enLinea: data.amigos.filter((a) => a.estado !== 'fuera').length } : null);
    // Con la pestaña del clan a la vista, sus miembros y solicitudes se recargan en cada sondeo
    if (this.tab === 'clan' && data?.clan && !this._clanLoading) this._loadClan(data.clan.id);
    this.render();
  }

  // ------------------------------------------------------------------ pintar

  render() {
    if (this.tab === 'amigos') this._renderFriends();
    else if (this.tab === 'clan') this._renderClan();
  }

  /** Sin API o sin cuenta: lo que hay que hacer para tener amigos y clanes. */
  _gate(box, what) {
    if (!this.available) {
      box.replaceChildren(
        this._empty('amigos', `${what} están en la web`, 'Para añadir amigos y crear o unirte a un clan, juega en la web de Trinchera con tu cuenta (correo y contraseña). Ahí verás quién está en línea y podrás invitarle a tu sala.'),
      );
      return true;
    }
    if (!this.social?.ready) {
      box.replaceChildren(
        this._empty(
          'amigos',
          `Crea una cuenta para ver ${what.toLowerCase()}`,
          'Con una cuenta tienes tu código de amigo, ves quién está en línea, invitas a tus amigos a tu sala y puedes fundar un clan o unirte a uno. Tu progreso se guarda también.',
          el('button', { type: 'button', class: 'principal', text: 'Crear cuenta', onclick: () => this.accountUI?.open('crear') }),
          el('button', { type: 'button', class: 'btn-sec', text: 'Entrar', onclick: () => this.accountUI?.open('entrar') }),
        ),
      );
      return true;
    }
    if (!this.social.data) {
      box.replaceChildren(el('div', { class: 'soc-cargando', text: this.social.error || 'Cargando…' }));
      return true;
    }
    return false;
  }

  _empty(ic, title, text, ...actions) {
    return el('div', { class: 'soc-vacio' }, el('span', { class: 'soc-vacio-ic' }, icon(ic)), el('h3', { text: title }), el('p', { text }), actions.length ? el('div', { class: 'soc-vacio-botones' }, ...actions) : null);
  }

  _section(title, extra, ...kids) {
    return el('section', { class: 'soc-seccion' }, el('h3', { class: 'soc-h' }, el('span', { text: title }), extra ? el('small', { text: extra }) : null), ...kids);
  }

  /** Tarjeta de un jugador: emblema, nombre, clan, título y nivel, estado y botones. */
  _player(p, { now, sub = null, actions = [], rol = null } = {}) {
    const f = p.ficha || {};
    const pres = presence(p, now);
    const title = [f.titulo, `Nivel ${f.nivel || 1}`, f.liga ? f.liga.nombre : null].filter(Boolean).join(' · ');
    return el(
      'div',
      { class: `soc-tarjeta est-${f.estandarte || 'noche'}` },
      el('span', { class: 'soc-emb' }, emblemImg(f.emblema, f.marco), el('span', { class: `soc-punto ${pres.cls}`, title: pres.text })),
      el(
        'div',
        { class: 'soc-textos' },
        el(
          'strong',
          { class: 'soc-nombre' },
          p.clan ? el('span', { class: 'soc-tag', text: `[${p.clan.tag}]` }) : null,
          el('span', { class: 'soc-nombre-t', text: p.nombre, style: `color:${nameColor(f)}` }),
          rol ? el('span', { class: `soc-rol rol-${rol}` }, rol === 'lider' ? icon('corona') : rol === 'oficial' ? icon('estrella') : null, ROLES[rol]) : null,
        ),
        el('small', { class: 'soc-sub', text: sub || title }),
        el('small', { class: `soc-estado ${pres.cls}`, text: pres.text }),
      ),
      actions.length ? el('div', { class: 'soc-acciones' }, ...actions) : null,
    );
  }

  _btn(text, cls, fn, opts = {}) {
    const b = el('button', { type: 'button', class: cls, text, title: opts.title || null, disabled: opts.disabled || null });
    b.addEventListener('click', async () => {
      if (b.disabled) return;
      // Las acciones que no se deshacen piden un segundo toque
      if (opts.confirm && this._confirm !== b) {
        this._confirm = b;
        b.dataset.texto = b.textContent;
        b.textContent = opts.confirm;
        b.classList.add('confirmar');
        setTimeout(() => {
          if (this._confirm === b) {
            this._confirm = null;
            b.textContent = b.dataset.texto;
            b.classList.remove('confirmar');
          }
        }, 3000);
        return;
      }
      this._confirm = null;
      b.disabled = true;
      try {
        await fn();
      } catch (err) {
        this._flash(err.message || 'Algo ha fallado.', 'error');
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }

  _flash(text, kind = 'ok') {
    const box = this.tab === 'clan' ? $('perfil-clan') : $('perfil-amigos');
    let m = box?.querySelector('.soc-mensaje');
    if (!box) return;
    if (!m) {
      m = el('div', { class: 'soc-mensaje', role: 'status' });
      box.prepend(m);
    }
    m.className = `soc-mensaje ${kind}`;
    m.textContent = text;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => m.remove(), 4000);
  }

  // ------------------------------------------------------------------ amigos

  _renderFriends() {
    const box = $('perfil-amigos');
    if (!box || this._gate(box, 'Los amigos')) return;
    const d = this.social.data;
    const now = (d.ahora || Date.now() / 1000) * 1000;
    const room = this.getRoom();
    const online = d.amigos.filter((a) => a.estado !== 'fuera').length;
    const parts = [];
    // Tu código y el buscador
    const input = el('input', { type: 'search', placeholder: 'Nombre de una nación o código (ABCD-2345)', value: this.searchText, 'aria-label': 'Buscar jugadores', maxlength: 30 });
    const form = el('form', { class: 'soc-buscar' }, icon('buscar'), input, el('button', { type: 'submit', class: 'principal', text: 'Buscar' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._search(input.value);
    });
    parts.push(
      el(
        'div',
        { class: 'soc-cab' },
        el(
          'div',
          { class: 'soc-codigo' },
          el('small', { text: 'Tu código de amigo' }),
          el('strong', { text: formatCode(d.yo.codigo) }),
          this._btn('Copiar', 'btn-sec soc-copiar', async () => {
            await navigator.clipboard?.writeText(formatCode(d.yo.codigo));
            this._flash('Código copiado: compártelo con quien quieras añadir.');
          }),
          el('p', { text: 'Pásaselo a tus amigos: con él te envían una solicitud.' }),
        ),
        el('div', { class: 'soc-cab-buscar' }, el('small', { text: 'Añadir amigos' }), form, this._results(now)),
      ),
    );
    // Invitaciones a sala
    if (d.invitaciones.length) {
      parts.push(
        this._section(
          'Te invitan a jugar',
          null,
          el('div', { class: 'soc-lista' }, ...d.invitaciones.map((i) => this._player(i.de, { now, sub: `Te invita a su sala ${i.sala.toUpperCase()} · ${timeAgo(i.creado * 1000, now)}`, actions: [this._btn('Unirme', 'principal', async () => this.onJoinInvite(i)), this._btn('Descartar', 'btn-sec', () => this.social.dismissInvite(i.id))] }))),
        ),
      );
    }
    // Solicitudes recibidas
    if (d.recibidas.length) {
      parts.push(
        this._section(
          'Solicitudes de amistad',
          String(d.recibidas.length),
          el('div', { class: 'soc-lista' }, ...d.recibidas.map((p) => this._player(p, { now, actions: [this._btn('Aceptar', 'principal', () => this.social.respondFriend(p.id, true).then(() => this._flash(`Ahora eres amigo de ${p.nombre}.`))), this._btn('Rechazar', 'btn-sec', () => this.social.respondFriend(p.id, false))] }))),
        ),
      );
    }
    // Amigos
    parts.push(
      this._section(
        'Amigos',
        d.amigos.length ? `${online} en línea · ${d.amigos.length}` : null,
        d.amigos.length
          ? el(
              'div',
              { class: 'soc-lista' },
              ...d.amigos.map((p) => {
                const acts = [];
                if (room && p.estado !== 'fuera') {
                  acts.push(this._btn('Invitar', 'principal', () => this.social.invite(p.id, room.code, room.red).then(() => this._flash(`Invitación enviada a ${p.nombre}.`)), { title: `Invitar a ${p.nombre} a tu sala ${room.code.toUpperCase()}` }));
                }
                acts.push(this._btn('Quitar', 'btn-sec btn-peligro', () => this.social.removeFriend(p.id), { confirm: '¿Quitar?' }));
                return this._player(p, { now, actions: acts });
              }),
            )
          : this._empty('amigos', 'Aún no tienes amigos', 'Busca a alguien por el nombre de su nación o pásale tu código. Cuando acepte, verás si está en línea y podrás invitarle a tu sala.'),
      ),
    );
    if (!room && d.amigos.some((a) => a.estado !== 'fuera')) parts.push(el('p', { class: 'nota', text: 'Crea una sala en Multijugador para invitar a tus amigos en línea.' }));
    // Enviadas
    if (d.enviadas.length) {
      parts.push(this._section('Solicitudes enviadas', String(d.enviadas.length), el('div', { class: 'soc-lista' }, ...d.enviadas.map((p) => this._player(p, { now, sub: `Enviada ${timeAgo(p.desde * 1000, now)}`, actions: [this._btn('Cancelar', 'btn-sec', () => this.social.removeFriend(p.id))] })))));
    }
    const msg = box.querySelector('.soc-mensaje');
    box.replaceChildren(...(msg ? [msg] : []), ...parts);
  }

  _results(now) {
    if (!this.results) return null;
    if (!this.results.length) return el('p', { class: 'soc-nada', text: 'No hay nadie con ese nombre o código.' });
    return el(
      'div',
      { class: 'soc-lista soc-resultados' },
      ...this.results.map((p) => {
        const rel = p.relacion;
        const act = rel === 'amigos'
          ? el('span', { class: 'soc-chapa ok', text: 'Amigos' })
          : rel === 'enviada'
          ? el('span', { class: 'soc-chapa', text: 'Enviada' })
          : this._btn(rel === 'recibida' ? 'Aceptar' : 'Añadir', 'principal', async () => {
              const r = await this.social.addFriend(p.codigo);
              p.relacion = r.estado === 'amigos' ? 'amigos' : 'enviada';
              this._flash(r.estado === 'amigos' ? `Ahora eres amigo de ${p.nombre}.` : `Solicitud enviada a ${p.nombre}.`);
            });
        return this._player(p, { now, actions: [act] });
      }),
    );
  }

  async _search(text) {
    this.searchText = text.trim();
    if (!this.searchText) {
      this.results = null;
      this.render();
      return;
    }
    try {
      // Un código completo: solicitud directa
      this.results = (await this.social.search(this.searchText)).jugadores;
    } catch (err) {
      this._flash(err.message, 'error');
      this.results = [];
    }
    this.render();
  }

  // -------------------------------------------------------------------- clan

  async _loadClan(id) {
    this._clanLoading = true;
    try {
      this.clanView = await this.social.clan(id);
    } catch (err) {
      this.clanView = null;
      if (err.status !== 404) this._flash(err.message, 'error');
    } finally {
      this._clanLoading = false;
    }
    this.render();
  }

  async _loadClans() {
    try {
      this.clanList = (await this.social.clans(this.clanSearch)).clanes;
    } catch (err) {
      this.clanList = [];
      this._flash(err.message, 'error');
    }
    this.render();
  }

  _insignia(ins, size = 56) {
    return emblemImg(ins, null, size);
  }

  _renderClan() {
    const box = $('perfil-clan');
    if (!box || this._gate(box, 'Los clanes')) return;
    const d = this.social.data;
    const now = (d.ahora || Date.now() / 1000) * 1000;
    const parts = d.clan ? this._myClan(d, now) : this._noClan(d, now);
    const msg = box.querySelector('.soc-mensaje');
    box.replaceChildren(...(msg ? [msg] : []), ...parts);
  }

  _clanHead(c, extra = []) {
    return el(
      'div',
      { class: 'clan-cab' },
      el('span', { class: 'clan-insignia' }, this._insignia(c.insignia, 72)),
      el(
        'div',
        { class: 'clan-textos' },
        el('small', { class: 'clan-etq', text: c.abierto ? 'Clan abierto' : 'Clan con solicitud' }),
        el('h2', { class: 'clan-nombre' }, el('span', { class: 'soc-tag grande', text: `[${c.tag}]` }), el('span', { text: c.nombre })),
        c.descripcion ? el('p', { class: 'clan-desc', text: c.descripcion }) : null,
        el(
          'div',
          { class: 'clan-datos' },
          el('span', {}, el('b', { text: `${c.miembros}/${CLAN_MAX}` }), ' miembros'),
          el('span', {}, el('b', { text: String(c.victorias) }), ' victorias'),
          el('span', {}, el('b', { text: String(c.nivel) }), ' niveles'),
        ),
      ),
      extra.length ? el('div', { class: 'clan-botones' }, ...extra) : null,
    );
  }

  _myClan(d, now) {
    const c = d.clan;
    const v = this.clanView && this.clanView.clan.id === c.id ? this.clanView : null;
    const rol = c.rol;
    const boss = rol === 'lider' || rol === 'oficial';
    const parts = [];
    if (this.editing && boss) {
      parts.push(this._clanForm(true));
    } else {
      parts.push(
        this._clanHead(c, [
          el('span', { class: `soc-rol rol-${rol} grande` }, rol === 'lider' ? icon('corona') : rol === 'oficial' ? icon('estrella') : null, `Eres ${ROLES[rol].toLowerCase()}`),
          boss ? this._btn('Editar', 'btn-sec', async () => {
            this.editing = true;
            this.draft = { ...this.draft, descripcion: c.descripcion, abierto: c.abierto, insignia: { ...c.insignia } };
            this.render();
          }) : null,
          this._btn('Salir del clan', 'btn-sec btn-peligro', async () => {
            await this.social.leaveClan();
            this.clanView = null;
            this._flash('Has salido del clan.');
            this._loadClans();
          }, { confirm: rol === 'lider' && c.miembros > 1 ? '¿Salir? El liderazgo pasa a otro' : c.miembros === 1 ? '¿Salir? El clan se disuelve' : '¿Seguro?' }),
        ].filter(Boolean)),
      );
    }
    if (!v) {
      parts.push(el('div', { class: 'soc-cargando', text: 'Cargando miembros…' }));
      return parts;
    }
    if (boss && v.solicitudes?.length) {
      parts.push(
        this._section(
          'Quieren entrar',
          String(v.solicitudes.length),
          el('div', { class: 'soc-lista' }, ...v.solicitudes.map((p) => this._player(p, { now, sub: `Lo pidió ${timeAgo(p.desde * 1000, now)}`, actions: [this._btn('Aceptar', 'principal', () => this.social.respondClan(p.id, true).then(() => this._reloadClan())), this._btn('Rechazar', 'btn-sec', () => this.social.respondClan(p.id, false).then(() => this._reloadClan()))] }))),
        ),
      );
    }
    const me = d.yo.id;
    parts.push(
      this._section(
        'Miembros',
        `${v.miembros.filter((m) => m.estado !== 'fuera').length} en línea · ${v.miembros.length}`,
        el(
          'div',
          { class: 'soc-lista' },
          ...v.miembros.map((m) => {
            const acts = [];
            if (m.id !== me) {
              if (rol === 'lider') {
                if (m.rol === 'miembro') acts.push(this._btn('Ascender', 'btn-sec', () => this.social.setRole(m.id, 'oficial').then(() => this._reloadClan()), { title: 'Hacerle oficial: acepta solicitudes, edita el clan y expulsa miembros' }));
                if (m.rol === 'oficial') acts.push(this._btn('Degradar', 'btn-sec', () => this.social.setRole(m.id, 'miembro').then(() => this._reloadClan())));
                acts.push(this._btn('Líder', 'btn-sec', () => this.social.setRole(m.id, 'lider').then(() => this._reloadClan()), { confirm: '¿Pasarle el clan?', title: 'Pasarle el liderazgo (tú quedas como oficial)' }));
              }
              if ((rol === 'lider' && m.rol !== 'lider') || (rol === 'oficial' && m.rol === 'miembro')) {
                acts.push(this._btn('Expulsar', 'btn-sec btn-peligro', () => this.social.kick(m.id).then(() => this._reloadClan()), { confirm: '¿Expulsar?' }));
              }
            }
            return this._player(m, { now, rol: m.rol, actions: acts });
          }),
        ),
      ),
    );
    return parts;
  }

  async _reloadClan() {
    const id = this.social.data?.clan?.id;
    if (id) await this._loadClan(id);
  }

  _noClan(d, now) {
    const parts = [];
    // Detalle de un clan que estás mirando
    if (this.clanView && !d.clan) {
      const v = this.clanView;
      const pedido = d.pedidos.includes(v.clan.id);
      parts.push(
        el('button', { type: 'button', class: 'enlace-ini soc-volver', text: '‹ Todos los clanes', onclick: () => {
          this.clanView = null;
          this.render();
        } }),
        this._clanHead(v.clan, [this._joinButton(v.clan, pedido)]),
        this._section('Miembros', `${v.miembros.length}/${CLAN_MAX}`, el('div', { class: 'soc-lista' }, ...v.miembros.map((m) => this._player(m, { now, rol: m.rol })))),
      );
      return parts;
    }
    parts.push(
      el(
        'div',
        { class: 'clan-intro' },
        el('span', { class: 'soc-vacio-ic' }, icon('clan')),
        el('div', {}, el('h3', { text: 'Únete a un clan o funda el tuyo' }), el('p', { text: `Un clan reúne hasta ${CLAN_MAX} jugadores con su etiqueta, como [TAG], junto a vuestro nombre. Sus victorias suman para el ranking de clanes.` })),
      ),
    );
    const grid = el('div', { class: 'clan-rejilla' });
    grid.append(this._clanForm(false), this._clanFinder(d));
    parts.push(grid);
    return parts;
  }

  _joinButton(c, pedido) {
    if (pedido) return this._btn('Pedido · Cancelar', 'btn-sec', () => this.social.cancelClan(c.id).then(() => this.render()));
    if (c.miembros >= CLAN_MAX) return el('span', { class: 'soc-chapa', text: 'Lleno' });
    return this._btn(c.abierto ? 'Unirme' : 'Pedir entrar', 'principal', async () => {
      const r = await this.social.joinClan(c.id);
      if (r.estado === 'dentro') {
        this.clanView = null;
        this._flash(`¡Ya eres de [${c.tag}] ${c.nombre}!`);
        this._loadClan(c.id);
      } else this._flash('Solicitud enviada: el líder o un oficial te aceptará.');
    });
  }

  _clanFinder(d) {
    const input = el('input', { type: 'search', placeholder: 'Nombre o etiqueta', value: this.clanSearch, 'aria-label': 'Buscar clanes', maxlength: 30 });
    const form = el('form', { class: 'soc-buscar' }, icon('buscar'), input, el('button', { type: 'submit', class: 'btn-sec', text: 'Buscar' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.clanSearch = input.value.trim();
      this._loadClans();
    });
    const list = this.clanList;
    return el(
      'div',
      { class: 'bloque clan-buscar' },
      el('h3', { text: this.clanSearch ? 'Clanes encontrados' : 'Ranking de clanes' }),
      form,
      list == null
        ? el('div', { class: 'soc-cargando', text: 'Cargando…' })
        : !list.length
        ? el('p', { class: 'soc-nada', text: this.clanSearch ? 'Ningún clan con ese nombre o etiqueta.' : 'Todavía no hay clanes: ¡funda el primero!' })
        : el(
            'ol',
            { class: 'clan-lista' },
            ...list.map((c, i) =>
              el(
                'li',
                { class: 'clan-fila' },
                el('span', { class: 'clan-pos', text: this.clanSearch ? '' : String(i + 1) }),
                el('button', { type: 'button', class: 'clan-fila-btn', onclick: async () => {
                  try {
                    this.clanView = await this.social.clan(c.id);
                  } catch (err) {
                    this._flash(err.message, 'error');
                  }
                  this.render();
                } },
                  this._insignia(c.insignia, 36),
                  el('span', { class: 'clan-fila-t' }, el('strong', {}, el('span', { class: 'soc-tag', text: `[${c.tag}]` }), ' ', c.nombre), el('small', { text: `${c.miembros}/${CLAN_MAX} · ${c.victorias} victorias${c.abierto ? ' · abierto' : ''}` })),
                ),
                this._joinButton(c, d.pedidos.includes(c.id)),
              ),
            ),
          ),
    );
  }

  /** Formulario para fundar (o editar) un clan, con su insignia. */
  _clanForm(edit) {
    const dr = this.draft;
    const preview = el('span', { class: 'clan-insignia' }, this._insignia(dr.insignia, 72));
    const repaint = () => preview.replaceChildren(this._insignia(dr.insignia, 72));
    const field = (label, input) => el('label', { class: 'campo' }, el('span', { text: label }), input);
    const nombre = el('input', { maxlength: 24, placeholder: 'Legión del Norte', value: dr.nombre });
    nombre.addEventListener('input', () => (dr.nombre = nombre.value));
    const tag = el('input', { maxlength: 5, placeholder: 'LDN', value: dr.tag, class: 'clan-tag-in', autocapitalize: 'characters' });
    tag.addEventListener('input', () => {
      tag.value = tag.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      dr.tag = tag.value;
    });
    const desc = el('textarea', { maxlength: 160, rows: 2, placeholder: 'Quiénes sois y a qué jugáis' });
    desc.value = dr.descripcion;
    desc.addEventListener('input', () => (dr.descripcion = desc.value));
    const abierto = el('input', { type: 'checkbox' });
    abierto.checked = !!dr.abierto;
    abierto.addEventListener('change', () => (dr.abierto = abierto.checked));
    const shapes = el('div', { class: 'clan-formas', role: 'radiogroup', 'aria-label': 'Forma' }, ...SHAPES.slice(0, 6).map((s) => {
      const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(dr.insignia.shape === s.id), title: s.name }, emblemImg({ ...dr.insignia, shape: s.id }, null, 30));
      b.addEventListener('click', () => {
        dr.insignia.shape = s.id;
        this.render();
      });
      return b;
    }));
    const symbols = el('select', { 'aria-label': 'Símbolo' }, ...SYMBOLS.map((s) => el('option', { value: s.id, text: s.name, selected: dr.insignia.symbol === s.id || null })));
    symbols.addEventListener('change', () => {
      dr.insignia.symbol = symbols.value;
      repaint();
    });
    const bg = el('input', { type: 'color', value: dr.insignia.bg, 'aria-label': 'Fondo' });
    bg.addEventListener('input', () => {
      dr.insignia.bg = bg.value;
      repaint();
    });
    const fg = el('input', { type: 'color', value: dr.insignia.fg, 'aria-label': 'Símbolo' });
    fg.addEventListener('input', () => {
      dr.insignia.fg = fg.value;
      repaint();
    });
    const submit = edit
      ? [this._btn('Guardar cambios', 'principal', async () => {
          await this.social.editClan({ descripcion: dr.descripcion, insignia: dr.insignia, abierto: dr.abierto });
          this.editing = false;
          this._flash('Clan actualizado.');
          this._reloadClan();
        }), this._btn('Cancelar', 'btn-sec', async () => {
          this.editing = false;
          this.render();
        })]
      : [this._btn('Fundar el clan', 'principal', async () => {
          const r = await this.social.createClan({ nombre: dr.nombre, tag: dr.tag, descripcion: dr.descripcion, insignia: dr.insignia, abierto: dr.abierto });
          this._flash(`¡Has fundado [${r.clan.tag}] ${r.clan.nombre}!`);
          this._loadClan(r.clan.id);
        })];
    return el(
      'div',
      { class: 'bloque clan-form' },
      el('h3', { text: edit ? 'Editar el clan' : 'Fundar un clan' }),
      el('div', { class: 'clan-form-insignia' }, preview, el('div', { class: 'clan-form-ins-op' }, shapes, el('div', { class: 'clan-form-colores' }, symbols, bg, fg))),
      edit ? null : el('div', { class: 'fila-2' }, field('Nombre', nombre), field('Etiqueta (2-5)', tag)),
      field('Descripción', desc),
      el('label', { class: 'clan-abierto' }, abierto, el('span', { text: 'Cualquiera puede unirse (si no, hay que pedirlo)' })),
      el('div', { class: 'clan-form-botones' }, ...submit),
    );
  }

  // ------------------------------------------------------- avisos y chapas

  _badges(d) {
    const nA = d ? d.recibidas.length + d.invitaciones.length : 0;
    const nC = d?.clan?.solicitudes || 0;
    for (const [id, n] of [['pp-amigos-n', nA], ['pp-clan-n', nC]]) {
      const b = $(id);
      if (!b) continue;
      b.hidden = !n;
      b.textContent = n > 9 ? '9+' : String(n);
    }
    const total = $('tab-perfil-n');
    if (total) {
      total.hidden = !(nA + nC);
      total.textContent = String(Math.min(9, nA + nC));
    }
  }

  /** Invitaciones nuevas a una sala: un aviso arriba con «Unirme». */
  _invites(d) {
    if (!d) return;
    // En mitad de una partida no se avisa (se verá al volver al menú)
    if (this.isBusy()) return;
    const fresh = d.invitaciones.filter((i) => !this._seenInvites.has(i.id));
    for (const i of d.invitaciones) this._seenInvites.add(i.id);
    if (!fresh.length) return;
    const i = fresh[0];
    const t = this.toast;
    t.replaceChildren(
      el('span', { class: 'soc-emb' }, emblemImg(i.de.ficha?.emblema, i.de.ficha?.marco, 36)),
      el('div', { class: 'soc-aviso-t' }, el('strong', { text: i.de.nombre }), el('span', { text: `te invita a su sala ${i.sala.toUpperCase()}` })),
      this._btn('Unirme', 'principal', async () => {
        t.hidden = true;
        this.onJoinInvite(i);
      }),
      this._btn('Ahora no', 'btn-sec', async () => {
        t.hidden = true;
      }),
    );
    t.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (t.hidden = true), 20000);
  }
}
