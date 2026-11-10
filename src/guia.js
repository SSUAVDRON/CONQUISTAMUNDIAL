// Guía del juego: un diálogo con pestañas (Controles, Economía, Combate y
// Diplomacia) con textos cortos e iconos. Sustituye a la lista larga de
// «Cómo se juega». Se abre desde Jugar, Ajustes y el menú en partida.
import { abrirDialogo, rodar, teclasGrupo } from './movimiento.js';

/** Iconos pequeños (trazos de 16 × 16). */
const ICONS = {
  raton: 'M8 1.5 a4.5 4.5 0 0 1 4.5 4.5 v4 a4.5 4.5 0 0 1 -9 0 v-4 A4.5 4.5 0 0 1 8 1.5 Z M8 1.5 V6.5 M3.5 6.5 H12.5',
  teclado: 'M1.5 4 h13 v8 h-13 Z M4 6.5 h0.01 M6.5 6.5 h0.01 M9 6.5 h0.01 M11.5 6.5 h0.01 M4.5 9.5 h7',
  bandera: 'M4 14.5 V2 M4 2.5 h8 l-2 3 2 3 H4',
  mapa: 'M1.5 4 l4 -1.5 5 1.5 4 -1.5 v9.5 l-4 1.5 -5 -1.5 -4 1.5 Z M5.5 2.5 v9.5 M10.5 4 v9.5',
  moneda: 'M8 3 a5 2.2 0 1 0 0.01 0 Z M3 5.2 v5.6 c0 1.2 2.2 2.2 5 2.2 s5 -1 5 -2.2 V5.2',
  ciudad: 'M2 14 V7 l3 -2 v9 M5 14 V4 h5 v10 M10 14 V8 h4 v6 M1 14 h14',
  engranaje: 'M8 10 a2 2 0 1 0 0 -4 a2 2 0 1 0 0 4 M8 1.5 v2 M8 12.5 v2 M1.5 8 h2 M12.5 8 h2 M3.4 3.4 l1.4 1.4 M11.2 11.2 l1.4 1.4 M3.4 12.6 l1.4 -1.4 M11.2 4.8 l1.4 -1.4',
  tropas: 'M5.5 3 a2 2 0 1 0 0.01 0 M11 3.5 a1.7 1.7 0 1 0 0.01 0 M1.5 13 c0 -2.5 1.8 -4 4 -4 s4 1.5 4 4 M9 9.3 c0.6 -0.2 1.3 -0.3 2 -0.3 c2 0 3.5 1.3 3.5 3.5',
  espadas: 'M3 3 L13 13 M13 3 L3 13 M2.5 10.5 L5.5 13.5 M10.5 13.5 L13.5 10.5',
  retirada: 'M13.2 8.6 A5.3 5.3 0 1 1 11.6 4.2 M12.2 1.6 V4.8 H9',
  cerco: 'M8 2 a6 6 0 1 0 0.01 0 M8 5.5 a2.5 2.5 0 1 0 0.01 0',
  barco: 'M2 10 h12 l-2 3.5 H4 Z M8 10 V2.5 M8 3 l4 4 H8',
  bomba: 'M7 5 a4.5 4.5 0 1 0 0.01 0 M10 4 l2 -2 M12 2 l1.5 0.5',
  escudo: 'M8 1.5 L13.5 3.5 V8 c0 3.2 -2.4 5.5 -5.5 6.5 C4.9 13.5 2.5 11.2 2.5 8 V3.5 Z',
  manos: 'M1.5 8 l3 -3 3 2 3 -2 4 3 M4.5 5 l-3 3 4 4 M11.5 5 l3 3 -4 4 M6 9.5 l2 2 M8 8 l2 2',
  corona: 'M2.5 12.5 h11 l-1 -7 -3 3 L8 4 6.5 8.5 l-3 -3 Z',
  pergamino: 'M4 2.5 h8 v11 H4 Z M6 5.5 h4 M6 8 h4 M6 10.5 h2.5',
  reloj: 'M8 2.5 a5.5 5.5 0 1 0 0.01 0 M8 5 V8.5 l2.5 1.5',
};

/** Contenido de cada pestaña: [icono, título, texto]. */
const TABS = [
  {
    id: 'controles',
    name: 'Controles',
    items: [
      ['raton', 'Ratón y dedo', 'Arrastra para moverte y usa la rueda (o pellizca) para el zoom. Clic en tierra libre o en un vecino: atacar. Clic derecho o mantener pulsado sobre otra nación: su ficha.'],
      ['bandera', 'Despliegue', 'Los primeros segundos, haz clic donde quieras empezar: un disco de 52 casillas y 2500 tropas. «Elegir por mí» busca un buen sitio.'],
      ['teclado', 'Teclas', '1–9 y 0: fuerza de ataque del 10 al 100 % (o Mayús + rueda). C: ir a tu nación. V: plegar el panel de abajo. I: desarrollo. N: silenciar. + y −: zoom. Esc: cancelar o abrir el menú.'],
      ['ciudad', 'Construir', 'Q ciudad · E puerto · R puesto defensivo · F fábrica · G silo · H antimisiles · T buque · M bomba atómica · J bomba H · K MIRV. Luego, clic en el mapa. Mayús + clic construye varios seguidos.'],
      ['mapa', 'Minimapa y combates', 'El minimapa (abajo a la izquierda) lleva a cualquier sitio con un clic. Clic en una tarjeta de combate: la cámara vuela a ese frente.'],
    ],
  },
  {
    id: 'economia',
    name: 'Economía',
    items: [
      ['moneda', 'Oro', 'Ganas 100 de oro por turno (1000 por segundo) pase lo que pase. Además: mercantes, trenes, regalos de aliados y todo el oro de quien elimines.'],
      ['tropas', 'Trabajadores', 'Con la regla «Economía con trabajadores», el deslizador «Reparto» divide tu población entre soldados (atacan y defienden) y trabajadores (dan oro).'],
      ['ciudad', 'Edificios', 'Ciudades: +25 000 de techo de tropas por nivel. Puertos: mercantes que os pagan a los dos al llegar. Fábricas: vías y trenes que dan oro en cada estación. Las obras tardan unos segundos.'],
      ['engranaje', 'Precios', 'Cada compra encarece la siguiente de su familia; subir de nivel cuesta lo mismo que uno nuevo. Elige bien qué construyes primero.'],
      ['pergamino', 'Desarrollo (tecla I)', 'Ingresos por fuente y oro por minuto, especialización y, en el perfil Trinchera, 12 tecnologías en tres ramas.'],
    ],
  },
  {
    id: 'combate',
    name: 'Combate',
    items: [
      ['tropas', 'Tropas', 'Se regeneran solas, más rápido cerca del 42 % de tu techo y nada al llenarlo: no esperes con la barra llena. Más territorio y ciudades, más techo.'],
      ['espadas', 'Atacar', 'Sale el % de tus tropas que marque «Fuerza de ataque». En tierra libre cada casilla cuesta 1,6 tropas en llanura, 2 en meseta y 2,4 en montaña; contra otro país, más cuantos más defensores tenga.'],
      ['retirada', 'Retirada', 'La ✕ de una tarjeta de combate retira las tropas del frente a los 2 s. Contra otro país pierdes el 25 % de ellas; en tierra libre, nada.'],
      ['cerco', 'Cerco', 'Si rodeas una bolsa sin costa, de tierra libre o de otro país, es tuya al momento y sin bajas.'],
      ['barco', 'Barcos y buques', 'Clic en una costa sin frontera por tierra: sale un barco con tropas (3 a la vez como mucho). Los buques (T) patrullan la zona del mar que elijas y hunden barcos enemigos.'],
      ['bomba', 'Bombas', 'Con un silo (G) lanzas bombas atómicas (M), bombas H (J) y MIRV (K): arrasan y dejan las casillas libres. Los antimisiles (H) las derriban y recargan 20 s.'],
      ['escudo', 'Defensa', 'Cerca de un puesto defensivo, conquistarte cuesta el triple de tiempo y de bajas. Si el borde de la pantalla se pone rojo, te atacan.'],
    ],
  },
  {
    id: 'diplomacia',
    name: 'Diplomacia',
    items: [
      ['manos', 'Alianzas', 'En la ficha de otra nación: proponer o romper alianzas, enviar tropas u oro y mandar emojis. Los aliados no pueden atacarse. Romper una alianza te marca como traidor 60 s.'],
      ['pergamino', 'Pactos y paz', 'Pacto de no agresión de 5 minutos, paz (con un tributo si quieres) y «Pedir ayuda» a tus aliados contra quien más te ataca.'],
      ['corona', 'Victoria', 'Según la partida: dominación (el 70 % de la tierra), capitales, economía o supervivencia. También ganas si solo quedáis en pie tú y tus aliados.'],
      ['reloj', 'Perfiles de reglas', 'Clásico: ritmo ágil, sin puntos estratégicos ni tecnologías. Trinchera: más lento, con puntos estratégicos (capitales, núcleos industriales, puertos clave y pasos de montaña) y tecnologías.'],
    ],
  },
];

const $ = (id) => document.getElementById(id);

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.bandera);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

let built = false;

function build() {
  built = true;
  const tabs = $('guia-pestanas');
  const body = $('guia-cuerpo');
  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.id = `guia-tab-${t.id}`;
    b.dataset.guia = t.id;
    b.setAttribute('aria-controls', `guia-${t.id}`);
    b.textContent = t.name;
    b.addEventListener('click', () => show(t.id));
    tabs.append(b);
    const panel = document.createElement('ul');
    panel.className = 'guia-lista';
    panel.id = `guia-${t.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', b.id);
    panel.hidden = true;
    for (const [ic, title, text] of t.items) {
      const li = document.createElement('li');
      const i = document.createElement('span');
      i.className = 'guia-icono';
      i.append(icon(ic));
      const d = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = title;
      const p = document.createElement('p');
      p.textContent = text;
      d.append(strong, p);
      li.append(i, d);
      panel.append(li);
    }
    body.append(panel);
  }
  teclasGrupo(tabs, '[role="tab"]');
}

function show(id) {
  for (const b of $('guia-pestanas').querySelectorAll('[data-guia]')) b.setAttribute('aria-selected', String(b.dataset.guia === id));
  rodar($('guia-pestanas'));
  for (const t of TABS) $(`guia-${t.id}`).hidden = t.id !== id;
  $('guia-cuerpo').scrollTop = 0;
}

/** Abre la guía (en la pestaña `tab`, por defecto la primera). */
export function abrirGuia(tab = 'controles') {
  if (!$('guia')) return;
  if (!built) build();
  show(TABS.some((t) => t.id === tab) ? tab : 'controles');
  abrirDialogo($('guia'), { foco: '[role="tab"][aria-selected="true"]' });
}
