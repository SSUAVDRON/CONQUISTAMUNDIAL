# Dominia

Juego de estrategia de conquista territorial en el navegador. Empiezas con un
pequeño territorio en un mundo generado al azar y compites contra naciones
controladas por el ordenador por dominar el mundo, casilla a casilla.

Sin dependencias ni paso de compilación: HTML + CSS + JavaScript (módulos ES).

## Pantallas

| Pestaña | Qué hay |
|---|---|
| Jugar | Partida contra la IA (rivales, mapa, dificultad, semilla) y multijugador: crear sala, unirse con código o desde la lista de salas abiertas. |
| Perfil | Nombre, color, emblema (forma, símbolo y colores), título, nivel y estadísticas. |
| Apariencia | Patrón del territorio (lo ven también los demás en partidas online). |
| Logros | 16 logros; desbloquean símbolos, patrones y títulos. |
| Clasificación | Global (todos los jugadores del enlace), tus récords y tu historial. |

Cada partida da experiencia (territorio, eliminaciones, edificios, victoria…);
los niveles desbloquean formas de emblema y patrones. El perfil se guarda en el
navegador y, en el enlace de Claude, también en tu cuenta.

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
| Barcos | Clic en una costa sin frontera terrestre: sale un barco desde tu costa más cercana (máx. 3 + 1 por puerto). |
| Oro | Se gana solo, según tu territorio (+10 % por cada puerto). Si eliminas a una nación, te llevas su oro. |
| Edificios | Se construyen en tu territorio con oro; cada uno del mismo tipo cuesta más que el anterior. Si te conquistan la casilla, el edificio pasa al conquistador. Deben estar a 5 casillas o más de otro edificio. |
| Ciudad | +15.000 tropas máximas. 5k de oro, +5k por cada ciudad que ya tengas. |
| Puerto | En la costa. +1 barco simultáneo y +10 % de oro. 4k, +4k. |
| Fortaleza | En un radio de 10 casillas, conquistarte cuesta ×2,5 tropas y tiempo. 3k, +3k. |
| Alianzas | Clic derecho (o mantener pulsado) sobre otra nación abre su ficha: proponer alianza, enviar tropas u oro (solo a aliados, según la fuerza de ataque) y emojis. Máximo 3 aliados. Los aliados no pueden atacarse; al firmar, los ataques entre ambos se detienen y las tropas vuelven. |
| Propuestas | Las que recibes aparecen con Aceptar/Rechazar y caducan a los 15 s. Si te rechazan, debes esperar 1 min para volver a proponer. |
| Traición | Romper una alianza (pide doble confirmación) te marca como traidor 60 s: conquistarte cuesta ×0,6 y los bots no se fían de ti. |
| Victoria | Controlar el 70 % de la tierra, ser el último en pie o que solo queden naciones aliadas entre sí. |

### Controles

- **Arrastrar**: mover el mapa · **Rueda / pellizco**: zoom · **WASD / flechas**: desplazarse
- **1–9 / 0**: fuerza de ataque 10 %–100 % · **Mayús + rueda**: ajuste fino
- **Q / E / R**: construir ciudad / puerto / fortaleza (o los botones del panel), luego clic en el mapa
- **Mayús + clic** al construir: colocar varios seguidos · **Esc / clic derecho**: cancelar
- **Clic derecho / mantener pulsado** sobre otra nación: ficha de diplomacia
- **Espacio**: pausa · **C**: centrar en tu nación · **+ / −**: zoom · **Esc**: cerrar
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
│   └── empaquetar.js   Genera dist/dominia.html, todo en un fichero (npm run empaquetar)
├── src/
│   ├── config.js       ← Todos los números de equilibrio (empieza aquí para ajustar)
│   ├── main.js         Bucle principal y unión de las piezas
│   ├── game.js         Simulación: propiedad de casillas, ataques, barcos, victoria
│   ├── bot.js          IA de las naciones rivales
│   ├── map.js          Generación procedural del mundo
│   ├── player.js       Estado de cada nación
│   ├── attack.js       Estado de un ataque (frente de casillas)
│   ├── render.js       Dibujo en canvas: terreno, territorios, barcos, nombres
│   ├── camera.js       Zoom y desplazamiento
│   ├── input.js        Ratón, táctil y teclado
│   ├── ui.js           Interfaz de la partida: panel, construcción, diplomacia, avisos
│   ├── home.js         Pantallas de inicio y sala de espera
│   ├── profile.js      Perfil, niveles, logros y desbloqueos
│   ├── multiplayer.js  Salas y sincronización lockstep
│   ├── net.js          Transporte: room de Claude o pestañas del navegador
│   ├── cloud.js        Perfil en la nube y clasificación global (db + user)
│   ├── icons.js        Iconos de edificios, emblemas y patrones
│   └── rng.js, noise.js, heap.js, colors.js, names.js, format.js
└── tests/              simulación, edificios, diplomacia, perfil y multijugador
```

Decisiones de diseño que conviene conservar:

- **La simulación (`game.js`, `map.js`, `bot.js`…) no toca el DOM.** Se puede
  ejecutar en Node; así funcionan los tests y así podrá correr en un servidor.
- **Es determinista.** Toda la aleatoriedad sale de un generador con semilla y
  las acciones del jugador entran como *intents* que se aplican al inicio de cada
  tick. Misma semilla + mismas acciones = misma partida. Es la base para el
  multijugador (ver `ROADMAP.md`).
- **Tick fijo de 100 ms** independiente de los FPS; la velocidad 2×/4× solo
  ejecuta más ticks por segundo.
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
