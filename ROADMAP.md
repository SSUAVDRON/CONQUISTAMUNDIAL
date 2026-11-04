# Hoja de ruta

## ✅ Fase 1 — Núcleo jugable (hecho)

- Mundo procedural con semilla: continentes, islas, mesetas y montañas
- Despliegue inicial con cuenta atrás
- Tropas con crecimiento dependiente del territorio
- Ataques por tierra con frente que avanza casilla a casilla, coste según terreno
  y densidad del defensor, anulación de ataques cruzados, retirada
- Barcos de transporte con ruta por mar
- Bots con personalidad (agresividad, ritmo de expansión)
- Clasificación, avisos, tooltip, velocidad 1×/2×/4× y pausa
- Partida de bots de fondo en el menú
- Tests de simulación

## ✅ Fase 2 — Economía y construcción (hecho)

- Oro pasivo según territorio; botín al eliminar a una nación
- Ciudad (+tropas máximas), puerto (+1 barco, +10 % de oro) y fortaleza
  (defensa ×2,5 en radio 10), con coste creciente por unidad
- Los edificios se capturan junto con su casilla
- Barra de construcción con vista previa válida/no válida y radio de la fortaleza
- La IA construye: fortalezas ante vecinos fuertes, ciudades y puertos
- Empaquetado en un solo HTML que funciona sin servidor

Pendiente de esta fase, si hace falta al probar:
- Que los barcos salgan del puerto más cercano en vez de cualquier costa
- Gastar oro en reclutar tropas de golpe
- Ajustar precios y efectos tras jugar varias partidas

## ✅ Fase 3 — Diplomacia (hecho)

- Alianzas: proponer, aceptar/rechazar (caducan a los 15 s), romper con doble
  confirmación; máximo 3 aliados; espera de 1 min tras un rechazo
- Traición: 60 s marcado, defensa ×0,6, los bots le guardan rencor
- Los aliados no se atacan; al firmar se detienen los ataques entre ambos
- Envío de tropas y oro entre aliados
- Victoria compartida si solo quedan aliados
- Bots: se alían contra el líder y le abandonan cuando se acerca a ganar,
  refuerzan a aliados atacados, contestan emojis
- Ficha de nación (clic derecho / pulsación larga / clasificación), tarjetas de
  propuesta, fronteras verdes para aliados, ⚠ para traidores, burbujas de emoji

Ideas para más adelante: pedir ayuda a los aliados con un botón, ver en el mapa
contra quién lucha cada aliado, alianzas que caducan y se renuevan.

## ✅ Inicio, perfil y comunidad (hecho)

- Pantallas de inicio con pestañas: jugar, perfil, apariencia, logros, clasificación
- Perfil: nombre, color, emblema (5 formas, 12 símbolos), título, nivel por experiencia
- 16 logros con recompensas (símbolos, patrones de territorio, títulos)
- Clasificación global (enlace de Claude), récords e historial locales
- Dificultad de los bots (fácil, normal, difícil)
- Salas multijugador con código y lista de salas abiertas, lockstep con
  recuperación de mensajes perdidos y control de desincronización

## ✅ Mapas reales, buques y tropas visibles (hecho)

- Mapas del mundo, Europa, Norteamérica, Sudamérica, África y Asia (Natural
  Earth, dominio público) con cordilleras, mesetas y lagos; bots como países
- Buques de guerra: se botan en puertos, navegan con clic en el mar, hunden
  transportes y buques y destruyen puertos; la IA los usa
- Tropas de cada ataque visibles en el frente y en el panel (también las que
  te atacan y los barcos en camino)

## ✅ Misiles, antimisiles y fábricas (hecho)

- Fábricas (+25 % de oro cada una)
- Silos y misiles que arrasan una zona enemiga (recarga, alcance, coste)
- Antimisiles con probabilidad de acierto y recarga; la IA los usa todos
- Mapas sin islas ni lagos diminutos

## ✅ Trinchera: inicio, tutorial y comercio naval (hecho)

- Nombre, logotipo propio y pantallas de carga con pasos reales y consejos
- Inicio con modos animados, galería de mapas, reglas de partida y ajustes
- Tutorial interactivo de 9 pasos (logro «Recluta»)
- Banderas reales en los países (flag-icons, MIT)
- Pesqueros y mercantes automáticos; los buques capturan los rivales
- Barcos más lentos; borde rojo al ser atacado

## Próximo

- Sonido y música propios
- Elegir jugar como un país concreto en los mapas reales

- Misiles de distintos tamaños o con efectos duraderos (zona inhabitable un tiempo)
- Más mapas reales: Oceanía, Oriente Medio, el Mediterráneo, un continente a
  más resolución (basta con añadir regiones en `herramientas/mapas.js`)
- Elegir jugar como un país concreto en los mapas reales

## Fase 5 — Multijugador fuera de Claude

Las salas ya funcionan dentro del enlace de Claude (`room`). Para jugar desde tu
propio dominio hace falta un servidor que haga lo mismo que `room`:

1. Servidor Node con WebSocket que reenvíe los mensajes de cada sala
   (`net.js` ya separa el transporte: basta con una tercera variante)
2. Hosting que admita Node y WebSockets (un plan de hosting compartido normal
   no suele permitirlo; un VPS o un servicio tipo Render/Fly sí)
3. Volver a entrar en una partida tras perder la conexión
4. Cambio de anfitrión si el anfitrión se va (ahora la partida termina)

## Fase 6 — Pulido

- Mapas del mundo real a partir de datos de dominio público (p. ej. Natural Earth)
- Sonido y música propios
- Estadísticas de fin de partida, repeticiones (gratis gracias al determinismo)
- PWA instalable en móvil
- Cuentas y ranking
