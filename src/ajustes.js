// Ajustes del jugador: valores por defecto, preajustes de calidad gráfica y
// la descripción de cada opción (de aquí sale la página de Ajustes). Solo
// datos y cuentas: lo usan el perfil, el bucle de la partida y la interfaz.

/** Opciones nuevas de gráficos, mapa, partida, sonido y controles (las de antes siguen en el perfil). */
export const SETTINGS_DEFAULTS = {
  // Gráficos
  resolucion: 'auto', // 'auto' (se adapta a los fps) | 'alta' | 'media' | 'baja'
  fpsMax: 0, // 0 = sin límite; 60 o 30
  efectosMapa: true, // olas, brillos, estelas, humo y avance suave del territorio
  particulas: 'normal', // 'alta' | 'normal' | 'baja'
  temblor: true, // temblor de cámara y destello en las explosiones cercanas
  vineta: true, // bordes de la pantalla algo más oscuros
  contadorFps: false,
  // Mapa
  nombres: 'todos', // 'todos' | 'grandes' (naciones grandes y jugadores) | 'jugadores'
  banderas: true, // banderas y emblemas junto a los nombres
  // Partida
  infoAvanzada: false, // la información avanzada siempre a la vista (si no, con Mayús)
  minimapa: true,
  // Interfaz
  escalaUI: 1, // tamaño de los paneles de la partida
  // Sonido
  volGeneral: 1,
  // Controles
  velCamara: 1, // multiplica la velocidad de WASD / flechas
  zoomRueda: 1, // multiplica lo que acerca cada golpe de rueda
  invertirRueda: false,
};

/** Lo que fija cada preajuste de calidad (el resto de opciones no cambia). */
export const GFX_KEYS = ['resolucion', 'fpsMax', 'efectosMapa', 'particulas', 'temblor', 'vineta'];
export const GFX_PRESETS = {
  bateria: { name: 'Ahorro', hint: 'Menos batería y calor', level: 1, values: { resolucion: 'baja', fpsMax: 30, efectosMapa: false, particulas: 'baja', temblor: false, vineta: false } },
  rendimiento: { name: 'Rendimiento', hint: 'Más fluidez en equipos modestos', level: 2, values: { resolucion: 'media', fpsMax: 0, efectosMapa: true, particulas: 'baja', temblor: true, vineta: false } },
  equilibrada: { name: 'Equilibrada', hint: 'Recomendada: se adapta sola', level: 3, values: { resolucion: 'auto', fpsMax: 0, efectosMapa: true, particulas: 'normal', temblor: true, vineta: true } },
  maxima: { name: 'Máxima', hint: 'La mejor imagen', level: 4, values: { resolucion: 'alta', fpsMax: 0, efectosMapa: true, particulas: 'alta', temblor: true, vineta: true } },
};

/** ¿Qué preajuste coincide con los ajustes? ('personalizada' si ninguno). */
export function presetOf(a) {
  for (const [id, P] of Object.entries(GFX_PRESETS)) {
    if (GFX_KEYS.every((k) => (a[k] ?? SETTINGS_DEFAULTS[k]) === P.values[k])) return id;
  }
  return 'personalizada';
}

/** Aplica un preajuste de calidad (solo las opciones gráficas). */
export function applyPreset(a, id) {
  const P = GFX_PRESETS[id];
  if (P) Object.assign(a, P.values);
  return a;
}

/**
 * Densidad de píxeles del mapa con una resolución fija (`native`: la de la
 * pantalla, ya con su tope). 'auto' devuelve null: la decide el bucle según
 * los fps.
 */
export function fixedDpr(mode, native) {
  if (mode === 'alta') return native;
  if (mode === 'media') return native > 1.25 ? 1.25 : Math.max(0.75, Math.round(native * 0.85 * 100) / 100);
  if (mode === 'baja') return native > 1 ? 1 : 0.7;
  return null;
}

/** Partículas por nivel: cuántas caben a la vez y qué parte de las de adorno entra. */
export const PARTICLES = { alta: { max: 2400, keep: 1 }, normal: { max: 1600, keep: 1 }, baja: { max: 600, keep: 0.4 } };

/**
 * Completa y corrige los ajustes guardados (valores desconocidos → por
 * defecto). Quien tenía quitadas las animaciones (antes, una sola opción para
 * los menús y el mapa) sigue sin las del mapa.
 */
export function normalizeSettingsExtra(a) {
  if (a.efectosMapa === undefined && a.animaciones === false) a.efectosMapa = false;
  const pick = (k, allowed) => {
    if (!allowed.includes(a[k])) a[k] = SETTINGS_DEFAULTS[k];
  };
  pick('resolucion', ['auto', 'alta', 'media', 'baja']);
  pick('fpsMax', [0, 30, 60]);
  pick('particulas', ['alta', 'normal', 'baja']);
  pick('nombres', ['todos', 'grandes', 'jugadores']);
  pick('escalaUI', [0.9, 1, 1.1, 1.25]);
  pick('velCamara', [0.6, 1, 1.6]);
  pick('zoomRueda', [0.6, 1, 1.6]);
  for (const k of ['efectosMapa', 'temblor', 'vineta', 'contadorFps', 'banderas', 'infoAvanzada', 'minimapa', 'invertirRueda']) {
    if (typeof a[k] !== 'boolean') a[k] = SETTINGS_DEFAULTS[k];
  }
  const v = Number(a.volGeneral);
  a.volGeneral = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  return a;
}

/**
 * La página de Ajustes: secciones con sus opciones. Tipos: 'toggle',
 * 'seg' (opciones [valor, texto]), 'range' (0-100 en pantalla, 0-1 guardado),
 * 'presets' (los de calidad) y 'sound' (interruptor con su volumen).
 * `live`: se nota en la partida al momento (todas, salvo que se diga).
 */
export const SECTIONS = [
  {
    id: 'graficos',
    nav: 'Calidad y fluidez',
    title: 'Gráficos',
    icon: '◈',
    desc: 'Calidad de imagen y fluidez del mapa.',
    items: [
      { key: 'calidad', type: 'presets', label: 'Calidad' },
      { key: 'resolucion', type: 'seg', label: 'Resolución del mapa', desc: 'Automática la baja sola si el equipo no llega a ~40 fps y la vuelve a subir si va sobrado.', options: [['auto', 'Automática'], ['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']] },
      { key: 'fpsMax', type: 'seg', label: 'Límite de fotogramas', desc: 'Con 30 fps el móvil gasta menos batería y se calienta menos. En el móvil, «Sin límite» llega como mucho a 60.', options: [[0, 'Sin límite'], [60, '60 fps'], [30, '30 fps']] },
      { key: 'efectosMapa', type: 'toggle', label: 'Animaciones del mapa', desc: 'Olas, brillos, estelas de los barcos, humo y el avance suave del territorio.' },
      { key: 'particulas', type: 'seg', label: 'Partículas', desc: 'Chispas de los frentes, humo y restos de las explosiones.', options: [['alta', 'Muchas'], ['normal', 'Normales'], ['baja', 'Pocas']] },
      { key: 'temblor', type: 'toggle', label: 'Temblor y destellos', desc: 'La cámara tiembla y la pantalla destella con las explosiones cercanas.' },
      { key: 'vineta', type: 'toggle', label: 'Viñeta', desc: 'Bordes de la pantalla algo más oscuros para centrar la mirada (en el ordenador).' },
      { key: 'contadorFps', type: 'toggle', label: 'Contador de fps', desc: 'Los fotogramas por segundo, en una esquina durante la partida.' },
    ],
  },
  {
    id: 'mapa',
    nav: 'Nombres y marcas',
    title: 'Mapa',
    icon: '⌖',
    desc: 'Qué se dibuja sobre el mapa.',
    items: [
      { key: 'nombres', type: 'seg', label: 'Nombres de los países', desc: 'Tú, tus aliados y los demás jugadores se nombran siempre.', options: [['todos', 'Todos'], ['grandes', 'Naciones grandes'], ['jugadores', 'Solo jugadores']] },
      { key: 'banderas', type: 'toggle', label: 'Banderas junto a los nombres', desc: 'La bandera o el emblema de cada nación delante de su nombre.' },
      { key: 'marcadores', type: 'toggle', label: 'Tropas de cada ataque', desc: 'Una pastilla con las tropas que quedan en cada frente.' },
      { key: 'puntero', type: 'toggle', label: 'Puntero hacia tu nación', desc: 'La marca «TÚ» y una flecha en el borde cuando tu país no se ve.' },
      { key: 'emojis', type: 'toggle', label: 'Burbujas de emoji', desc: 'Los globos de emoji que se mandan las naciones y la IA, sobre el mapa. Los tuyos los mandas con 😀 o la tecla Y.' },
      { key: 'alerta', type: 'toggle', label: 'Borde rojo al ser atacado', desc: 'La pantalla se tiñe de rojo por el lado del ataque.' },
    ],
  },
  {
    id: 'partida',
    nav: 'Ayudas e información',
    title: 'Partida',
    icon: '⚔',
    desc: 'Ayudas e información durante la partida.',
    items: [
      { key: 'consejos', type: 'toggle', label: 'Consejos', desc: 'Avisos con 💡: población al máximo, oro sin usar, vecinos peligrosos…' },
      { key: 'infoAvanzada', type: 'toggle', label: 'Información avanzada siempre', desc: 'Las cifras detalladas de fichas y paneles a la vista. Si no, se ven manteniendo Mayús.' },
      { key: 'minimapa', type: 'toggle', label: 'Minimapa', desc: 'El mapa pequeño de la esquina al empezar (se puede plegar en la partida).' },
    ],
  },
  {
    id: 'interfaz',
    nav: 'Tamaño y movimiento',
    title: 'Interfaz',
    icon: '✦',
    desc: 'Tamaño y movimiento de los menús y paneles.',
    items: [
      { key: 'escalaUI', type: 'seg', label: 'Tamaño de los paneles', desc: 'La barra de arriba, la clasificación, el panel de abajo y el minimapa. Más grandes, solo hasta donde quepan en la pantalla.', options: [[0.9, 'Pequeño'], [1, 'Normal'], [1.1, 'Grande'], [1.25, 'Muy grande']] },
      { key: 'animaciones', type: 'toggle', label: 'Animaciones de los menús', desc: 'Transiciones de pantallas, pestañas y tarjetas. Si tu sistema pide reducir el movimiento, se quitan igualmente.' },
    ],
  },
  {
    id: 'sonido',
    nav: 'Volumen y música',
    title: 'Sonido',
    icon: '♪',
    desc: 'Volumen general, música y efectos.',
    items: [
      { key: 'volGeneral', type: 'range', label: 'Volumen general' },
      { key: 'musica', type: 'sound', vol: 'volMusica', label: 'Música', desc: 'Calma en paz y más bélica cuando hay guerra.' },
      { key: 'efectos', type: 'sound', vol: 'volEfectos', label: 'Efectos de sonido', desc: 'Conquistas, explosiones, botones y avisos.' },
    ],
  },
  {
    id: 'controles',
    nav: 'Cámara y atajos',
    title: 'Controles',
    icon: '✥',
    desc: 'Cámara, rueda del ratón y atajos de teclado.',
    items: [
      { key: 'velCamara', type: 'seg', label: 'Velocidad de la cámara', desc: 'Al moverla con WASD o las flechas.', options: [[0.6, 'Lenta'], [1, 'Normal'], [1.6, 'Rápida']] },
      { key: 'zoomRueda', type: 'seg', label: 'Zoom con la rueda', desc: 'Cuánto acerca o aleja cada golpe de rueda (o del panel táctil).', options: [[0.6, 'Suave'], [1, 'Normal'], [1.6, 'Rápido']] },
      { key: 'invertirRueda', type: 'toggle', label: 'Invertir la rueda', desc: 'Rueda hacia arriba para alejar.' },
      { key: 'atajos', type: 'shortcuts', label: 'Atajos de teclado' },
    ],
  },
  { id: 'mas', nav: 'Ayuda y créditos', title: 'Más', icon: '…', desc: 'Ayuda, restablecer y créditos.', items: [] },
];

/** Claves que restablece cada sección (las de la página, menos los preajustes y atajos). */
export function sectionKeys(id) {
  const s = SECTIONS.find((x) => x.id === id);
  if (!s) return [];
  const keys = [];
  for (const it of s.items) {
    if (it.type === 'presets' || it.type === 'shortcuts') continue;
    keys.push(it.key);
    if (it.vol) keys.push(it.vol);
  }
  return keys;
}
