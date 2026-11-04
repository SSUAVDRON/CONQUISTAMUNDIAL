# Trinchera

> La carpeta del proyecto se sigue llamando `dominia/` (primer nombre provisional).

Juego de estrategia de conquista territorial en el navegador. Empiezas con un
pequeño territorio en un mundo generado al azar y compites contra naciones
controladas por el ordenador por dominar el mundo, casilla a casilla.

Sin dependencias ni paso de compilación: HTML + CSS + JavaScript (módulos ES).

## Pantallas

El inicio tiene cuatro modos en tarjetas: **Partida rápida** (mundo
real contra 90 países y cientos de colonias, un clic), **Contra la IA** (galería de mapas con
miniaturas pintadas como en la partida y opciones), **Multijugador** y **Tutorial** (partida guiada paso a
paso que avanza con lo que haces). Antes de cada partida hay una pantalla de
carga con los pasos reales y un consejo.

| Pestaña | Qué hay |
|---|---|
| Jugar | Portada con nuestro mapa del mundo (Europa, el Mediterráneo y Oriente Próximo con las naciones repartidas, en el mismo estilo que la partida) y «Jugar ahora», los cuatro modos (tarjetas de texto, sin ilustraciones) y «Tu arsenal» (los edificios y unidades dibujados como en el juego, con su precio). En «Contra la IA» y en las salas multijugador (las ajusta el anfitrión) se elige: mapa, naciones rivales (1-200), dificultad y las reglas de la partida (ver «Reglas personalizables»). |
| Perfil | Tarjeta de perfil (estandarte, emblema con marco, nombre, título y nivel), nombre, color (con 16 colores rápidos), emblema (7 formas, 20 símbolos y colores), título, nivel y estadísticas. |
| Apariencia | Estandarte (8), marco del emblema (bronce, plata, oro, laurel), color de tu nombre en el mapa (8) y patrón del territorio (lo ven también los demás online). Muchos se desbloquean con nivel o logros. |
| Logros | 16 logros; desbloquean símbolos, patrones y títulos. |
| Clasificación | Global (todos los jugadores del enlace), tus récords y tu historial. |
| Ajustes | Borde rojo al ser atacado, tropas de los ataques sobre el mapa, emojis, animaciones del menú, repetir el tutorial y créditos. |

Cada partida da experiencia (territorio, eliminaciones, edificios, victoria…);
los niveles desbloquean formas de emblema y patrones. El perfil se guarda en el
navegador y, en el enlace de Claude, también en tu cuenta.

## Mapas

- **Mundo real:** Mundo, Europa, Norteamérica, Sudamérica, África y Asia. Los
  bots son países reales con su bandera (los más grandes del mapa, hasta uno
  por país) y aparecen en su ubicación. Cordilleras y mesetas reales hacen más lento y
  caro avanzar.
- **Aleatorios:** pequeño, mediano y grande, generados con la semilla.

En todos los mapas se eliminan las islas de menos de 40 casillas y los lagos de
menos de 12, para no perder el tiempo conquistando islotes.

Los mapas reales salen de [Natural Earth](https://www.naturalearthdata.com)
(países y lagos) y del relieve mundial
[ETOPO5 de NOAA](https://www.ngdc.noaa.gov/mgg/global/etopo5.HTML), ambos de
dominio público. La altura real decide el terreno (llanura por debajo de 700 m,
meseta hasta 1800 m, montaña por encima) y el dibujo del relieve. Para
regenerarlos o añadir regiones (`DEFS` en el script):

```bash
node herramientas/mapas.js <carpeta con los .geojson de Natural Earth> <ETOPO5.DOS>
```

Necesita `ne_50m_admin_0_countries` y `ne_50m_lakes` (GeoJSON, en
github.com/nvkelso/natural-earth-vector) y el fichero `ETOPO5.DOS` de NOAA.
Escribe `src/mapas-reales.js`.

Las banderas son de [flag-icons](https://github.com/lipis/flag-icons) (MIT).
Para regenerar el sprite (`src/banderas.js`) con los SVG `4x3` de esa colección:

```bash
node herramientas/banderas.cjs <carpeta con los .svg>
```

Créditos y licencias de terceros: `herramientas/LICENCIAS.md`.

## Multijugador

- **En el enlace de Claude** (capacidad `room`): crea una sala, comparte el
  código de 5 caracteres y quien tenga el enlace con acceso de colaborador puede
  entrar. Hasta 8 personas más los bots que elija el anfitrión.
- **Fuera de Claude** (fichero suelto o tu hosting): solo entre pestañas del
  mismo navegador, útil para probar. Jugar entre equipos fuera de Claude
  necesita un servidor (ver `ROADMAP.md`).

Funciona por *lockstep*: todos ejecutan la misma simulación determinista con la
misma semilla y solo viajan las acciones. El anfitrión marca el ritmo y reparte
las acciones de cada tick; si se pierde un mensaje, el invitado pide reenvío y
repite sus acciones hasta verlas confirmadas. Cada 10 s se comparan huellas del
estado para detectar desincronizaciones. Por eso la simulación no usa
`Math.pow` ni nada que pueda variar entre navegadores.

## Jugar

**Sin instalar nada:** genera el juego en un solo fichero y ábrelo con doble clic.

```bash
cd dominia
npm run empaquetar
```

Se crea `dist/dominia.html`: funciona sin servidor ni conexión, en cualquier
navegador. Es el fichero que puedes mandar a alguien o subir tal cual.

**Para desarrollar:**

```bash
cd dominia
npm start
```

Abre <http://localhost:8080> **en el mismo ordenador** donde ejecutas el
comando (`localhost` siempre es tu propia máquina). `index.html` sin servidor no
funciona: los módulos ES necesitan HTTP; para eso está `dist/dominia.html`.

## Publicarlo en la web (Hostinger u otro hosting)

Son ficheros estáticos. Opción más simple: sube `dist/dominia.html` como
`public_html/dominia/index.html` y estará en `https://tu-dominio/dominia/`.
También vale subir `index.html`, `css/` y `src/` tal cual. No hace falta PHP ni
base de datos.

## Reglas

| Concepto | Cómo funciona |
|---|---|
| Reglas personalizables | Colonias o bots débiles (automático según el mapa, o de 0 a 300), oro inicial (0 a 10M), victoria al 50/70/90 %, crecimiento de tropas, ingresos de oro y precios de los edificios (×0,5, ×1 o ×2), tregua inicial (sin, 1, 3 o 5 min: nadie puede atacar a otras naciones ni lanzar misiles, pero sí expandirse y conquistar colonias; se ve una cuenta atrás), límite de tiempo (sin, 10, 20 o 30 min: al acabar gana quien tenga más territorio; el reloj marca lo que queda) y qué está permitido: misiles y antimisiles, buques de guerra, alianzas, desembarcos y fábricas con sus trenes. Las mismas en «Contra la IA» y en la sala multijugador, donde las ve todo el mundo en el resumen. |
| Despliegue | Los primeros 15 s haces clic donde quieres empezar (puedes cambiarlo). Si no eliges, se te asigna un sitio. Cada nación empieza con una mancha pequeña e irregular (unas 250 casillas; las colonias, menos). |
| Expansión | Al hacer clic en tierra libre (o en un vecino), avanza sobre todo **hacia donde has hecho clic**: crece sobre todo el lado de tu país que mira hacia allí, con bordes irregulares (no un frente perfecto) y algo hacia los lados, y lo de detrás apenas se mueve; otro clic en otra dirección reorienta el avance. Los bots crecen con formas irregulares (lóbulos de ruido, terreno y azar), sin dirección fija. La forma es irregular a lo grande pero limpia de cerca: una casilla casi rodeada por ti (3 o 4 vecinas tuyas) se conquista la primera, y la tierra libre que queda encerrada dentro de tu país pasa a ser tuya sola, así que no quedan casillas sueltas difíciles de clicar.|
| Mapa | Casillas muy pequeñas: los mapas tienen 4 veces la resolución del principio en cada eje (16 veces más casillas; el mundo, 3520×1597). Todo lo que se mide en casillas se adapta con el factor `RES` de `config.js`. Las rutas por mar se buscan primero en una rejilla gruesa y luego solo por ese pasillo, así que siguen siendo rápidas. |
| Tropas | Crecen solas, en campana: lo más rápido con la **mitad** de tu máximo; con muy pocas tropas se genera menos (nunca menos del 15 % del pico) y por encima del 60 % cada vez menos, hasta parar en el tope (al 30 %: 86 % del ritmo; 50 %: 100 %; 80 %: 64 %; 90 %: 36 %). En la barra de tropas del panel se marca esa franja. El ritmo en el pico es 18,4 + 0,345 × (casillas ÷ 16)^0,75 tropas por turno. Empiezas con 2.500 y un máximo de base de 3.000 más lo que da el territorio y las ciudades.|
| Atacar | Clic en tierra libre o en una nación vecina: se envía el % de tus tropas que marque **Fuerza de ataque**. Repetir el clic refuerza el ataque. |
| Coste | Tierra libre: 3 tropas por casilla, así que te expandes en proporción a las tropas que mandas: con pocas, poco; con muchas, mucho (en el mundo con 90 naciones, hacia el minuto 1 está ocupado un 40 % de la tierra y a los 3 minutos casi toda). Naciones: depende de su densidad (tropas ÷ casillas). Mesetas ×1,4 y montañas ×2 en coste y tiempo. |
| Contraataque | Si dos naciones se atacan a la vez, las tropas de ambos ataques se anulan primero. |
| Retirada | El botón ✕ de un ataque lo cancela; vuelve la mitad de sus tropas. |
| Velocidad de conquista | Cuantas más tropas mandas, más rápido avanzas: en tierra libre según las tropas por casilla de frente, contra una nación según tu superioridad sobre su densidad (hasta ×3,5). |
| Barcos | Clic en una costa sin frontera terrestre: sale un barco de transporte desde tu costa más cercana (máx. 3 a la vez; los puertos no suman). |
| Naciones | Hasta 200 rivales en cualquier mapa (partida rápida: 90). En los mapas reales primero salen los países de verdad, con su bandera y en su sitio (mundo 151, Europa 52, África 72, Asia 74, Sudamérica 20, Norteamérica 17); si pides más, el resto son naciones inventadas repartidas por el mapa. |
| Colonias | Además de las naciones aparecen colonias («Colonia de…», «Aldea de…», «Misión de…»): crecen a menos de la mitad, cuesta menos conquistarlas, no construyen ni firman alianzas y guardan su oro. Presa fácil al empezar. Hay muchísimas: una por cada 500 casillas de tierra de la rejilla original, hasta 300 (unas 225 en el mundo); con menos de 20 rivales, proporcionalmente menos. |
| Saqueo | Cada casilla que conquistas a un país te da su parte de su oro (oro ÷ casillas). Cada 5 s un aviso resume lo saqueado (y lo que te saquean). |
| Buques de guerra | Se botan desde un puerto propio terminado (máx. 3 por puerto y 1 más por cada nivel extra de puerto; 300k de oro con inflación). Van solos y su zona **se elige al botarlos y ya no se cambia**: con la T, clic en el mar (sale del puerto propio más cercano que dé a ese mar y la vista previa muestra el círculo que patrullará) o en tu costa (patrulla junto al puerto). La zona se ve como un círculo discontinuo. A tiro disparan a buques enemigos, hunden transportes de tropas y **capturan** pesqueros y mercantes rivales (pasan a producir para ti); si un intruso entra en su zona, lo persiguen. No atacan puertos. |
| Barcos de tropas | Salen de cualquier costa tuya, no hace falta puerto. Todos los barcos van algo más despacio que al principio (transportes, buques, pesqueros y mercantes). Dejan una línea fina desde donde salieron (y punteada hasta donde van): todos ven de dónde viene un desembarco. |
| Alerta | Si te atacan por tierra, mar o con un misil, el borde de la pantalla se pone rojo: más rojo y con latido más rápido cuanto más te atacan (tropas frente a las tuyas, número de atacantes, misiles). Desactivable en Ajustes. |
| Tropas a la vista | Cada combate tuyo tiene una tarjeta debajo de la clasificación: quién ataca a quién, tropas del atacante **VS** tropas del defensor, con una leyenda bajo cada cifra («te ataca con» / «tus tropas», «atacas con» / «sus tropas») y una barra de fuerzas. **Roja** si te atacan (van primero) y **verde** si atacas tú; los marcadores del mapa usan los mismos colores. También para desembarcos y misiles (con la cuenta atrás del impacto). Clic en la tarjeta: la cámara vuela al frente y lo marca. En el mapa, cada frente lleva además su marcador de tropas. |
| Avisos | En un recuadro abajo a la derecha, solo lo importante: alianzas y traiciones (de todos), países derrotados, barcos y misiles que vienen hacia ti, tu puerto destruido, logros e inicio de partida. Con icono según el tipo; los repetidos se agrupan (×N). Las respuestas a tus acciones («Te falta oro», «Buque botado»…) salen como una pista breve encima del panel. |
| Paneles plegables | Clasificación, combates y avisos se pliegan desde su cabecera (se recuerda). Plegados, la clasificación muestra tu puesto, los combates cuántos te atacan y cuántos ataques tuyos hay, y los avisos cuántos nuevos tienes. |
| Clasificación | Tus aliados salen en verde; las colonias, en gris cursiva; tu nombre, en tu color de nombre. |
| Panel de abajo | Centrado y compacto: tu estado, la fuerza de ataque y los edificios, solo con su icono y su precio (el nombre sale al pasar el ratón; en gris los que no puedes pagar, con una barra de cuánto oro te falta y un martillo si hay obras). Se minimiza con su botón o la tecla **V**. |
| Gráficos | Mapa físico en píxeles nítidos: el color sale de la altura (verde en las tierras bajas, arena en las mesetas, pardo y gris en la montaña, blanco en las cumbres; en la franja de desiertos las tierras bajas tiran a arena) y el relieve se sombrea con luz del noroeste. En los mapas reales la altura es la de verdad (ETOPO5 de NOAA); en los aleatorios, la del generador. Un filo claro en la costa y un mar liso azul marino. Las casillas recién conquistadas brillan un instante (se pintan en el propio territorio, sin coste por fotograma), saltan chispas y humo en los frentes y unas flechas marcan hacia dónde avanza cada ataque. Barcos dibujados con su rumbo y estela; misiles con humo y sombra; explosión con fogonazo, onda expansiva, hongo de humo y cráter; los antimisiles lanzan un interceptor visible (estela continua y rótulo «¡DERRIBADO!» / «FALLO»). Todo se desactiva con «Animaciones» en Ajustes. |
| Edificios en el mapa | Pictogramas lisos (bloque de edificios, ancla, fábrica, torre, misil, lanzador, barco), pequeños y discretos: en el mapa, en claro sobre un disco oscuro semitransparente (un triángulo para silo y antimisiles) con un anillo fino del color del dueño (y filo blanco si son tuyos). En el panel, el pictograma blanco con su tecla arriba a la izquierda y el precio. |
| Territorio y nombres | Cada nación se pinta en un tono suave y semitransparente de su color (el relieve se ve debajo), sin franja interior, con un borde fino de su tono oscuro; el tuyo con borde blanco y tus aliados con franjas y borde verdes. Los nombres van en texto oscuro con un halo claro y las tropas de los rivales en blanco con un contorno oscuro suave (lo tuyo, en tu color vivo). Al alejar la cámara los nombres no encogen con el país: tienen un tamaño mínimo legible (las colonias, algo menor) y, si dos se pisan, se ve el del país más grande (antes tú, tus aliados y los demás jugadores; las colonias, al final). Los **jugadores de verdad** llevan delante del nombre una insignia redonda de su color con una silueta de persona, para distinguirlos de los bots.|
| Sonido | Música de fondo ambiental (acordes lentos, un bajo suave y notas sueltas con eco, generada al momento) y efectos discretos: clic, obras y edificio terminado, ataque, barco, misil, explosión e intercepción (más flojos cuanto más lejos de la cámara), cañonazos, monedas de tus trenes, avisos y fin de partida. Todo sintetizado en el navegador, sin ficheros de audio. En Ajustes: música y efectos por separado con su volumen; botón de altavoz en la barra superior (o tecla **N**) para silenciarlo todo. Empieza a sonar con el primer clic (los navegadores no dejan sonar antes). |
| Rendimiento | Mar y tierra van en una sola imagen y solo se dibuja la parte visible (alejado, desde una copia reducida); el territorio se sube a la tarjeta gráfica por bloques de 128×128 y solo los que cambian y se ven; las alianzas entre bots no obligan a repintar; los nombres se recalculan sobre una rejilla gruesa; la clasificación se reordena una vez por segundo. En pantallas de alta densidad, si el equipo no llega a ~40 fps el mapa se dibuja a menos píxeles (los paneles siguen nítidos). Como mucho 3 turnos de simulación por fotograma: si el equipo va justo, la partida va un pelín más lenta en vez de dar tirones. |
| Barra superior | Tiempo de partida, tu puesto entre las naciones en pie y el líder con su territorio frente a la meta de victoria (se pone ámbar si se acerca). |
| Oro | Se gana solo, casi en proporción a tu territorio (casillas^0,75), y además **cada casilla de tierra libre que conquistas te da 15 de oro al momento**: expandirse rinde. Puertos y fábricas suman +15 % / +35 % por nivel con rendimiento decreciente (bonus = % × n ÷ (1 + 0,12 n)). Una nación pequeña gana unos pocos miles por segundo; una grande, unas decenas de miles. Al eliminar a una nación te llevas el oro que le quede. Oro inicial opcional: de 0 a 10M en las partidas personalizadas. |
| Edificios | Se construyen en tu territorio con oro. Deben estar a 5 casillas o más de otro edificio. Si te conquistan la casilla, el edificio (con su nivel) pasa al conquistador. |
| Obras | Cada edificio tarda en construirse y no hace nada hasta terminar (anillo de progreso sobre el icono): fortaleza 4 s, ciudad 5 s, puerto y fábrica 6 s, silo 9 s, **antimisiles 16 s**. Subir de nivel tarda el 80 % de eso. |
| Inflación | Cada compra (edificio, mejora o buque) encarece un **25 %** todo lo demás (así no se llena el mapa de estructuras). Silos, misiles y antimisiles tienen precio fijo. |
| Niveles | Con un edificio seleccionado, clic sobre uno tuyo del mismo tipo: sube de nivel (hasta 5; el número del nivel sale en una chapa dorada encima del edificio). Cuesta precio actual × 0,8 × nivel. Cada nivel repite el efecto: ciudad +15k tropas, puerto +15 % de oro y un pesquero más, fábrica +35 % de oro y +8 casillas de raíles con trenes un 25 % más rentables, fortaleza +2 de radio y +0,4 de defensa, silo −15 % de recarga, antimisiles +3 de radio, +7 % de acierto y −12 % de recarga. |
| Ciudad | +15.000 tropas máximas. 300k de oro (sin inflación). |
| Puerto | En la costa: basta con hacer clic cerca de tu orilla (se coloca en la casilla costera libre más cercana, hasta 6 casillas, también si pulsas en el agua). +15 % de oro. Saca 2 pesqueros que faenan cerca y dan oro mientras naveguen, y cada 20-40 s un mercante hacia el puerto de otra nación con la que no estés en guerra: al llegar cobráis los dos (tú más). 250k. Para subirlo de nivel, clic sobre él (o en el agua de al lado). |
| Fortaleza | En un radio de 12 casillas, conquistarte cuesta ×3 tropas y tiempo. 200k. |
| Fábrica | +35 % de oro. Además tiende **raíles** hasta las ciudades y puertos a su alcance (38 casillas, +8 por nivel; como mucho 6, los más cercanos, en la misma masa de tierra), **también los de otros jugadores, enemigos incluidos**. Por cada raíl sale un tren cada 15-30 s: al llegar a la estación y al volver a la fábrica da oro al dueño de la fábrica (3k + 30 por casilla de vía, +25 % por nivel); si la estación es de otro, su dueño se lleva la mitad. Verás «+oro» cuando llega uno tuyo o pasa por tu estación. 400k. |
| Silo | Icono triangular. Permite lanzar misiles; cada silo recarga en 15 s. 2M fijo. |
| Misil | 750k fijo, lanzado desde un silo a 220 casillas como máximo. Arrasa un círculo de radio 8: las casillas enemigas quedan libres, se destruyen sus edificios, el defensor pierde tropas y los barcos y buques alcanzados sufren daños. Nunca afecta a ti ni a tus aliados. |
| Antimisiles | Icono triangular. Dispara a los misiles enemigos que pasan a 22 casillas o menos; acierta un 65 % de las veces y después **recarga 20 s** (−12 % por nivel). Se ve el interceptor subir con su estela y un rótulo «¡DERRIBADO!» o «FALLO»; mientras recarga, un anillo azul se llena con los segundos que faltan (los silos, igual en naranja) y, listo, un punto verde. Varios misiles a la vez saturan la defensa. 3M fijo. |
| Alianzas | Los aliados se ven con **franjas verdes** sobre su territorio, frontera verde y 🤝 junto al nombre. Clic derecho (o mantener pulsado) sobre otra nación abre su ficha: proponer alianza, enviar tropas u oro (solo a aliados, según la fuerza de ataque) y emojis. Máximo 3 aliados. Los aliados no pueden atacarse; al firmar, los ataques entre ambos se detienen y las tropas vuelven. |
| Propuestas | Las que recibes aparecen con Aceptar/Rechazar y caducan a los 15 s. Si te rechazan, debes esperar 1 min para volver a proponer. |
| Traición | Romper una alianza (pide doble confirmación) te marca como traidor 60 s: conquistarte cuesta ×0,6 y los bots no se fían de ti. |
| Victoria | Controlar el 70 % de la tierra, ser el último en pie o que solo queden naciones aliadas entre sí. |

### Controles

- **Arrastrar**: mover el mapa · **Rueda / pellizco**: zoom · **WASD / flechas**: desplazarse
- **1–9 / 0**: fuerza de ataque 10 %–100 % · **Mayús + rueda**: ajuste fino
- **Q / E / R / F / G / H / T**: ciudad / puerto / fortaleza / fábrica / silo / antimisiles / buque (o los botones del panel), luego clic en el mapa
- **M**: apuntar un misil (clic en territorio enemigo)
- **T + clic en el mar**: botar un buque de guerra con esa zona de patrulla (fija)
- **Mayús + clic** al construir: colocar varios seguidos · **Esc / clic derecho**: cancelar
- **Clic derecho / mantener pulsado** sobre otra nación: ficha de diplomacia
- **C** o botón **Mi nación**: la cámara vuela a tu nación · **+ / −**: zoom · **Esc**: cerrar
- **Puntero**: sobre tu nación flota la marca «TÚ»; si la pierdes de vista, una flecha en el borde de la pantalla apunta hacia ella (pulsarla te lleva). Se desactiva en Ajustes.
- **Clic en una tarjeta de combate** (a la derecha): la cámara vuela a ese frente
- Clic en la clasificación: centra la cámara en esa nación y abre su ficha

En el mapa, tu frontera es blanca, la de tus aliados verde y los traidores llevan ⚠.

### Los bots

Cada bot tiene personalidad: agresividad, ritmo de expansión, gusto por la
diplomacia y lealtad. Expanden, construyen, se alían con vecinos de su talla y
contra el líder (y le abandonan si pasa del 35 %), envían refuerzos a aliados
atacados, no perdonan una traición y contestan a tus emojis.

## Estructura del código

```
dominia/
├── index.html          Menú, HUD y pantalla de fin
├── css/estilo.css
├── servidor.js         Servidor estático para desarrollo (npm start)
├── herramientas/
│   ├── empaquetar.js   Genera dist/dominia.html, todo en un fichero (npm run empaquetar)
│   └── mapas.js        Genera src/mapas-reales.js desde Natural Earth
├── src/
│   ├── config.js       ← Todos los números de equilibrio (empieza aquí para ajustar)
│   ├── main.js         Bucle principal y unión de las piezas
│   ├── game.js         Simulación: propiedad de casillas, ataques, barcos, victoria
│   ├── bot.js          IA de las naciones rivales
│   ├── map.js          Mundo procedural y carga de mapas reales
│   ├── mapas-reales.js GENERADO: mapas reales (herramientas/mapas.js)
│   ├── player.js       Estado de cada nación
│   ├── attack.js       Estado de un ataque (frente de casillas)
│   ├── render.js       Dibujo en canvas: terreno, territorios, barcos, nombres
│   ├── camera.js       Zoom y desplazamiento
│   ├── input.js        Ratón, táctil y teclado
│   ├── ui.js           Interfaz de la partida: panel, construcción, diplomacia, avisos
│   ├── home.js         Pantallas de inicio (modos, galería, opciones, ajustes) y sala
│   ├── loading.js      Pantalla de carga
│   ├── tutorial.js     Tutorial guiado
│   ├── banderas.js     GENERADO: sprite de banderas (herramientas/banderas.cjs)
│   ├── profile.js      Perfil, niveles, logros y desbloqueos
│   ├── multiplayer.js  Salas y sincronización lockstep
│   ├── net.js          Transporte: room de Claude o pestañas del navegador
│   ├── cloud.js        Perfil en la nube y clasificación global (db + user)
│   ├── icons.js        Iconos de edificios, emblemas y patrones
│   └── rng.js, noise.js, heap.js, colors.js, names.js, format.js
└── tests/              simulación, edificios, buques, misiles, comercio, diplomacia, mapas, perfil y multijugador
```

Decisiones de diseño que conviene conservar:

- **La simulación (`game.js`, `map.js`, `bot.js`…) no toca el DOM.** Se puede
  ejecutar en Node; así funcionan los tests y así podrá correr en un servidor.
- **Es determinista.** Toda la aleatoriedad sale de un generador con semilla y
  las acciones del jugador entran como *intents* que se aplican al inicio de cada
  tick. Misma semilla + mismas acciones = misma partida. Es la base para el
  multijugador (ver `ROADMAP.md`).
- **Tick fijo de 100 ms** independiente de los FPS. Las partidas van siempre a
  velocidad normal (no hay pausa ni aceleración en la partida).
- **Imports simples.** El empaquetador solo entiende `import { a } from './x.js'`
  y `export function|class|const`. Si añades otra forma, falla con un mensaje
  claro en vez de generar un fichero roto.

## Tests

```bash
cd dominia
npm test
```

Comprueban la generación del mapa, la coherencia de los datos tras miles de
ticks de bots, el determinismo, el despliegue del jugador, los ataques, los
barcos, el oro, los edificios y la diplomacia (que nunca haya ataques entre
aliados, traiciones, envíos, caducidad de propuestas, victoria en alianza).

El test de multijugador simula una red que pierde el 30 % de los mensajes y
comprueba que anfitrión e invitado acaban con exactamente el mismo estado.

Para depurar en el navegador, el estado está en la consola como
`window.__dominia` (`__dominia.game`, `__dominia.human`, `__dominia.profile`…).

## Capacidades del enlace de Claude

Al publicar como artefacto se declaran:

- `room` con los temas `start`, `turn`, `intent`, `resend` y `hash` abiertos a
  colaboradores (los lectores pueden mirar pero no jugar online).
- `db` con reglas: `clasificacion` la leen todos y cada persona solo escribe su
  propia fila (`clasificacion/{self}`); `data/users/<id>/perfil` es privado.
- `user` para saber qué fila es de cada persona (sin nombres ni correos).

Sin estas capacidades (fuera de Claude) el juego funciona igual, en local.
