# Hoja de ruta

## ✅ Fase 1 — Núcleo jugable (hecho)

- Mundo procedural con semilla: continentes, islas, mesetas y montañas
- Despliegue inicial con cuenta atrás
- Tropas con crecimiento dependiente del territorio
- Ataques por tierra con frente que avanza casilla a casilla, coste según terreno
  y densidad del defensor, anulación de ataques cruzados, retirada
- Barcos de transporte con ruta por mar
- Bots con personalidad (agresividad, ritmo de expansión)
- Clasificación, avisos y tooltip (la pausa y la aceleración se quitaron después)
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

## ✅ Tarjetas de combate en rojo/verde y precios nuevos (hecho)

- Tarjetas VS rojas si te atacan y verdes si atacas, con leyenda bajo cada cifra
- Edificios mucho más caros (ciudad 125k, antimisiles 1,5M, silo 1M, misil 500k)
  con el oro ×25 para mantener el ritmo; silos, misiles y antimisiles quedan
  relativamente más caros que antes

## ✅ Gráficos, colonias, niveles y obras (hecho)

- Mapa con relieve iluminado, playas, espuma, mar con profundidad, olas y nubes
- Batallas animadas: destellos al conquistar, chispas y humo, flechas de avance
- Barcos dibujados con rumbo y estela; misiles, explosiones e interceptaciones nuevas
- Avisos en un recuadro abajo a la derecha; panel inferior ancho y minimizable (V)
- Puertos en cualquier costa (el clic se ajusta a la orilla); 3 transportes a la vez
- Colonias débiles con oro; saqueo de oro casilla a casilla
- Aliados con franjas verdes y 🤝
- Edificios por niveles (1-5), inflación del 12 % por compra y obras con duración

## ✅ Casillas pequeñas, HUD plegable e inicio renovado (hecho)

- Mapas a 4× resolución (factor `RES`, 16 veces más casillas), con todo
  reescalado; rutas por mar en dos pasos (rejilla gruesa y pasillo fino)
- Tropas más lentas y conquista más barata; alerta roja proporcional
- Combates bajo la clasificación; paneles plegables; aliados en verde
- Buque de guerra circular con barra de vida; rastro de los desembarcos
- Inicio con portada ilustrada, modos ilustrados, arsenal, botones nuevos
- Personalización: estandartes, marcos, color del nombre, más símbolos y
  formas, colores rápidos y tarjeta de perfil
- Buques de guerra autónomos que patrullan una zona; barcos más lentos;
  número de nivel sobre los edificios
- Oro proporcional (√ del territorio; puertos y fábricas con rendimiento
  decreciente); conquista más rápida cuantas más tropas mandas
- Antimisiles con recarga de 20 s visible (anillo con segundos) e
  interceptación con estela y rótulo «¡DERRIBADO!»; resumen del panel más
  compacto con el máximo de tropas grande
- Mapa de colores planos (montañas gris claro, sin sombras de nubes ni
  contornos oscuros); salida pequeña e irregular; expansión con formas
  irregulares (lóbulos de ruido, terreno y azar)
- Mapa físico: color por altura y relieve sombreado; en los mapas reales,
  altura de verdad (ETOPO5 de NOAA) que también decide el tipo de terreno
- Muchas más colonias (según la tierra del mapa, hasta 140) y más rivales
  (partida rápida con 45, hasta 90); expansión inicial gradual (la tierra
  libre cuesta más tropas y se avanza más despacio)
- Fluidez: una sola imagen de mapa recortada a la vista, subida del
  territorio por bloques visibles, brillo de conquista en el territorio,
  resolución adaptable y clasificación más tranquila
- Antimisiles y silos con icono triangular; puertos que se mejoran con un
  clic encima; buques con zona fija elegida al botarlos
- Iconos de edificios a color y fáciles de reconocer; panel solo con icono y
  precio; estructuras más caras y potentes (antimisiles 3M, inflación 25 %);
  raíles y trenes de las fábricas, también hacia edificios enemigos
- Muchas más naciones (hasta 200; partida rápida 90; más países reales en los
  mapas y naciones inventadas si se piden más) y colonias (hasta 300)
- 15 s para elegir dónde empezar; más tropas al principio; la expansión
  avanza hacia donde haces clic y en proporción a las tropas enviadas
- Oro al expandirse (por casilla libre) e ingresos casi proporcionales al
  territorio; música de fondo y efectos de sonido sintetizados
- Estilo más sobrio: pictogramas blancos para los edificios, territorio
  suave y semitransparente con bordes finos y nombres en texto oscuro
- Inicio con nuestros mapas: portada y miniaturas pintadas desde los datos
  de los mapas, en el mismo estilo que la partida
- Partidas personalizadas: naciones (1-200), colonias (auto o 0-300) y oro
  inicial libre (0-10M)
- Reglas personalizables también en multijugador; nuevas: ritmos de tropas y
  oro, precios, tregua inicial, límite de tiempo, alianzas, desembarcos y
  fábricas activables
- Nombres más grandes al alejar (sin solaparse) e insignia de persona para
  los jugadores; expansión sin casillas sueltas; +15 % de tropas
- Desplegables con el estilo del juego (fondo oscuro, flecha propia, lista
  legible); tropas de los rivales en blanco en vez de negro
- Móvil: panel inferior compacto con los 8 edificios a la vista, HUD más
  pequeño en vertical y en horizontal; dibujo más ligero (resolución 1,5×,
  nombres y cifras guardados como imágenes, sin desenfoques) y corregido el
  desfase del mapa en pantallas muy densas
- Expansión redondeada (sin brazos finos), en todas direcciones con algo de
  sesgo hacia el clic; +25 % de tropas; oro fijo (sin oro por territorio ni
  por expandirse), botín y recompensa al eliminar con lluvia de monedas;
  efectos de sonido más altos y muchos nuevos (fanfarria al conquistar);
  IA más agresiva y lista (reserva, mejores objetivos, remates, contraataques)
- Población y economía nuevas: población con máximo (territorio y ciudades)
  que crece más rápido hacia el 43 %, reparto soldados/trabajadores con
  deslizador (el ataque es un % de los soldados), oro de los trabajadores
  y la IA cambia de reparto según la fase
- Mejoras estratégicas: puntos estratégicos (capitales, núcleos industriales,
  puertos clave, pasos), órdenes militares (rápido, preparado, defensa
  fortificada, avance continuo), 12 tecnologías y especialización
  económica, panel de desarrollo con ingresos por fuente y retorno de
  inversiones, pactos de no agresión, paz con tributo y petición de ayuda,
  victorias por capitales, economía y supervivencia, estimaciones y
  consejos, y cooperativo de dos jugadores por nación con roles opcionales
- Minimapa abajo a la izquierda (clic o arrastrar para ir; plegable),
  portada animada del inicio y tarjetas de modo sin descripciones
- Monedas (partidas, logros y retos), 3 retos diarios con bonus, 38 logros,
  tienda en Apariencia y títulos, muchas skins nuevas (formas, símbolos,
  estandartes, marcos, colores y patrones) y la bandera de un país como emblema
- Fluidez: lo conquistado en cada turno aparece poco a poco hasta el
  siguiente (en todos los frentes a la vez), las tropas cuentan de forma
  continua (exactas hasta 9999 en el mapa; tus cifras con más precisión) y
  los nombres se deslizan a su sitio nuevo en vez de saltar
- Fronteras de dos franjas con el color vivo del país (fuera más oscuro),
  relleno más transparente y terreno con grano de píxel
- Ríos: los reales de Natural Earth en los mapas del mundo y ríos que bajan
  de las montañas al mar en los aleatorios; cruzarlos cuesta ×1,6

## Próximo

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
- Estadísticas de fin de partida, repeticiones (gratis gracias al determinismo)
- PWA instalable en móvil
- Cuentas y ranking
