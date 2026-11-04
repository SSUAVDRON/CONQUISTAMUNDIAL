# Trinchera

> La carpeta del proyecto se sigue llamando `dominia/` (primer nombre provisional).

Juego de estrategia de conquista territorial en el navegador. Empiezas con un
pequeño territorio en un mundo generado al azar y compites contra naciones
controladas por el ordenador por dominar el mundo, casilla a casilla.

Sin dependencias ni paso de compilación: HTML + CSS + JavaScript (módulos ES).

## Pantallas

El inicio tiene cuatro modos en tarjetas animadas: **Partida rápida** (mundo
real contra 30 países, un clic), **Contra la IA** (galería de mapas con
miniaturas y opciones), **Multijugador** y **Tutorial** (partida guiada paso a
paso que avanza con lo que haces). Antes de cada partida hay una pantalla de
carga con los pasos reales y un consejo.

| Pestaña | Qué hay |
|---|---|
| Jugar | Los cuatro modos. En «Contra la IA»: mapa, rivales, dificultad, victoria al 50/70/90 %, oro inicial, misiles y buques activables, semilla. |
| Perfil | Nombre, color, emblema (forma, símbolo y colores), título, nivel y estadísticas. |
| Apariencia | Patrón del territorio (lo ven también los demás en partidas online). |
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
(dominio público). Para regenerarlos o añadir regiones (`DEFS` en el script):

```bash
node herramientas/mapas.js <carpeta con los .geojson de Natural Earth>
```

Necesita `ne_50m_admin_0_countries`, `ne_50m_geography_regions_polys` y
`ne_50m_lakes` (GeoJSON, en github.com/nvkelso/natural-earth-vector). Escribe
`src/mapas-reales.js`.

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
| Despliegue | Los primeros 10 s haces clic donde quieres empezar (puedes cambiarlo). Si no eliges, se te asigna un sitio. |
| Tropas | Crecen solas. El máximo y la velocidad dependen de tu territorio; cerca del máximo el crecimiento se frena. |
| Atacar | Clic en tierra libre o en una nación vecina: se envía el % de tus tropas que marque **Fuerza de ataque**. Repetir el clic refuerza el ataque. |
| Coste | Tierra libre: 3 tropas por casilla. Naciones: depende de su densidad (tropas ÷ casillas). Mesetas ×1,4 y montañas ×2 en coste y tiempo. |
| Contraataque | Si dos naciones se atacan a la vez, las tropas de ambos ataques se anulan primero. |
| Retirada | El botón ✕ de un ataque lo cancela; vuelve la mitad de sus tropas. |
| Barcos | Clic en una costa sin frontera terrestre: sale un barco de transporte desde tu costa más cercana (máx. 3 + 1 por puerto). |
| Buques de guerra | Se botan desde un puerto propio (máx. 3 por puerto; 6k de oro, +3k cada uno). Clic en el mar mueve el más cercano. Actúan solos a 9 casillas: disparan a buques enemigos, hunden transportes de tropas, **capturan** pesqueros y mercantes rivales (pasan a producir para ti) y bombardean puertos hasta destruirlos. |
| Barcos de tropas | Salen de cualquier costa tuya, no hace falta puerto. |
| Alerta | Si te atacan por tierra, mar o con un misil, el borde de la pantalla se pone rojo (desactivable en Ajustes). |
| Tropas a la vista | Cada combate tuyo tiene una tarjeta a la derecha: quién ataca a quién, tropas del atacante **VS** tropas del defensor y una barra de fuerzas (roja si te atacan, primero las que te atacan). También para desembarcos y misiles (con la cuenta atrás del impacto). Clic en la tarjeta: la cámara vuela al frente y lo marca. En el mapa, cada frente lleva además su marcador de tropas. |
| Barra superior | Tiempo de partida, tu puesto entre las naciones en pie y el líder con su territorio frente a la meta de victoria (se pone ámbar si se acerca). |
| Oro | Se gana solo, según tu territorio (+10 % por cada puerto). Si eliminas a una nación, te llevas su oro. |
| Edificios | Se construyen en tu territorio con oro; cada uno del mismo tipo cuesta más que el anterior. Si te conquistan la casilla, el edificio pasa al conquistador. Deben estar a 5 casillas o más de otro edificio. |
| Ciudad | +15.000 tropas máximas. 5k de oro, +5k por cada ciudad que ya tengas. |
| Puerto | En la costa. +1 barco simultáneo y +10 % de oro. Saca 2 pesqueros que faenan cerca y dan oro mientras naveguen, y cada 20-40 s un mercante hacia el puerto de otra nación con la que no estés en guerra: al llegar cobráis los dos (tú más). 4k, +4k. |
| Fortaleza | En un radio de 10 casillas, conquistarte cuesta ×2,5 tropas y tiempo. 3k, +3k. |
| Fábrica | +25 % de oro por cada una. 6k, +6k. |
| Silo | Permite lanzar misiles; cada silo recarga en 15 s. 10k, +10k. |
| Misil | 12k cada uno, lanzado desde un silo a 220 casillas como máximo. Arrasa un círculo de radio 8: las casillas enemigas quedan libres, se destruyen sus edificios, el defensor pierde tropas y los barcos y buques alcanzados sufren daños. Nunca afecta a ti ni a tus aliados. |
| Antimisiles | Dispara a los misiles enemigos que pasan a 22 casillas o menos; acierta un 60 % de las veces y recarga en 8 s. Varios misiles a la vez saturan la defensa. 8k, +6k. |
| Alianzas | Clic derecho (o mantener pulsado) sobre otra nación abre su ficha: proponer alianza, enviar tropas u oro (solo a aliados, según la fuerza de ataque) y emojis. Máximo 3 aliados. Los aliados no pueden atacarse; al firmar, los ataques entre ambos se detienen y las tropas vuelven. |
| Propuestas | Las que recibes aparecen con Aceptar/Rechazar y caducan a los 15 s. Si te rechazan, debes esperar 1 min para volver a proponer. |
| Traición | Romper una alianza (pide doble confirmación) te marca como traidor 60 s: conquistarte cuesta ×0,6 y los bots no se fían de ti. |
| Victoria | Controlar el 70 % de la tierra, ser el último en pie o que solo queden naciones aliadas entre sí. |

### Controles

- **Arrastrar**: mover el mapa · **Rueda / pellizco**: zoom · **WASD / flechas**: desplazarse
- **1–9 / 0**: fuerza de ataque 10 %–100 % · **Mayús + rueda**: ajuste fino
- **Q / E / R / F / G / H / T**: ciudad / puerto / fortaleza / fábrica / silo / antimisiles / buque (o los botones del panel), luego clic en el mapa
- **M**: apuntar un misil (clic en territorio enemigo)
- **Clic en el mar**: mover tu buque de guerra más cercano
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
