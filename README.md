# Trinchera

> Repositorio: `SSUAVDRON/CONQUISTAMUNDIAL`. La rama `main` tiene el código y
> la rama `hostinger`, solo la web que publica Hostinger. Algunos nombres
> internos (`dist/dominia.html`, `package.json`) conservan el primer nombre
> provisional del proyecto, «dominia».

Juego de estrategia de conquista territorial en el navegador. Empiezas con un
pequeño territorio en un mundo generado al azar y compites contra naciones
controladas por el ordenador por dominar el mundo, casilla a casilla.

Sin dependencias ni paso de compilación: HTML + CSS + JavaScript (módulos ES).

## Pantallas

**Al abrir el juego**, una pantalla de carga (ya en el HTML, se ve desde el
primer pintado) cubre todo mientras se preparan las fuentes, las banderas, el
mapa del mundo, su terreno, la cuenta, el menú y la partida de fondo. Tiene un
horizonte con un frente que avanza y brasas que suben, el mapa del mundo que se
descubre con un escáner dorado y en el que van cayendo chinchetas con las
banderas de algunos países, la lista de pasos (cada uno se marca al terminar),
un contador de porcentaje y **consejos de juego** que van rotando con sus
puntos. Todo se anima con `transform` y `opacity` (en la tarjeta gráfica), así
que no se para aunque un paso ocupe el hilo principal. Al terminar, «Listo»,
y la pantalla se abre como **dos puertas** (arriba y abajo) que dejan ver el
menú, que entra escalonado: cabecera, pestañas y tarjetas. Dura lo justo
(1,8 s como mínimo, para que dé tiempo a leer un consejo) y, con movimiento
reducido, sin animaciones. Lo que salía al abrir (un reto `?reto`, una
clasificatoria que quedó a medias) espera a que acabe.

El menú va fluido también en móviles: la partida de fondo se dibuja a ~20 fps
(~16 en táctiles) en vez de en cada fotograma, sin radar giratorio a pantalla
completa (obligaba a recomponer toda la pantalla) y el brillo de los botones se
mueve con `transform`.

El inicio tiene cuatro modos en tarjetas ilustradas: **Partida rápida** (mundo
real contra 90 países y cientos de colonias, un clic), **Contra la IA**,
**Multijugador** y **Partida personalizada**. Antes de cada partida hay una
pantalla de carga con los pasos reales y un consejo.

**Cuenta** (en la web, con `api/cuentas.php`): «Entrar» en la cabecera abre
un diálogo con las pestañas Entrar y Crear cuenta (correo y contraseña de 8
caracteres como mínimo). La cuenta guarda **todo el perfil** (nivel, logros,
monedas, compras, aspecto, rango, historial y ajustes) y lo une con el de cada
dispositivo al entrar, al arrancar, al cambiar algo y al acabar una partida;
la fila de la tabla de rangos es la misma en todos tus dispositivos. Con
sesión, una nube verde en tu ficha y el bloque «Cuenta» del perfil
(sincronizar ahora, cerrar sesión). A los jugadores sin cuenta, una tarjeta en
Jugar les invita a guardar su progreso (se puede descartar). Google y Apple:
la API ya tiene la tabla de proveedores y dirá cuáles están activos. En el
enlace de Claude no hay cuentas: sigue la nube de Claude.

Las pestañas cambian con una transición corta (sale la vista y entra la nueva)
y un subrayado que se desliza; se manejan también con el teclado (flechas,
Inicio y Fin). Los diálogos (fin de partida, confirmación, guía, compra,
novedades, menú en partida) atrapan el foco, se cierran con Escape o tocando
fuera y devuelven el foco a donde estaba. Todo respeta «Animaciones» de
Ajustes y la preferencia del sistema de reducir el movimiento.

| Pestaña | Qué hay |
|---|---|
| Jugar | Portada animada con nuestro mapa del mundo (solo se anima mientras se ve), «Jugar ahora», **Guía** y Tutorial; los cuatro modos; misiones diarias con barras, la última partida y las novedades (fundido entre ellas y «Ver todas» en un diálogo); el arsenal por categorías. **Contra la IA** es un solo formulario: mapa (selector de tarjetas con miniatura, el mismo que en «Crear sala» y en el editor de la sala), rivales y dificultad arriba; «Reglas avanzadas» plegables con su resumen; y una barra fija abajo con el resumen de la partida y «Empezar partida». «Partida personalizada» abre el mismo formulario con las reglas desplegadas. **Multijugador** muestra tarjetas de carga al conectar, «Crea la primera» si no hay salas públicas y «Reintentar» si no hay conexión. |
| Progreso | **Retos de hoy** (3 al día, cambian a medianoche; cada uno da monedas y hacer los tres da un bonus), **retos de la semana** (3 por semana, de lunes a domingo, más largos y mejor pagados, con su bonus) y 57 logros en rejilla (entre ellos los de puesto, ligas, rachas, retos semanales y retos por enlace): conseguidos en color con su fecha y pendientes en gris; los que dependen de una cifra acumulada muestran su progreso («7/10», campo `meta` de los logros). |
| Perfil | **Resumen**: tarjeta (estandarte, emblema con marco, nombre, título y nivel), nombre y color del territorio (16 colores rápidos), nivel y estadísticas que suben al abrirlo (también puesto medio, mejor puesto, clasificatorias, retos y monedas ganadas), tu rango con la gráfica de tus PL y tus últimas partidas (cada una abre su ficha con la curva de tu territorio). **Aspecto**: una vista previa fija de tu nación que cambia en directo; emblema (9 formas, 27 símbolos y colores, o la **bandera de un país**), marco (12), estandarte (20, algunos animados), patrón del territorio (15; lo ven también los demás online), color del nombre en el mapa (14) y títulos en fichas. Se desbloquean con nivel, con logros o **comprándolos con monedas**: al pulsar uno a la venta sale una ficha con la muestra, el precio y lo que te queda. La ficha de la cabecera también lleva aquí. |
| Arsenal | Todo lo que se construye o lanza, con su precio, su tecla y, al pasar el ratón o enfocar la tarjeta, el detalle. |
| Clasificación | **Rangos** (tu rango y la tabla global de la temporada), Global (todos los jugadores del enlace), tus récords y tu historial (con puesto y la curva de tu territorio), en sub-pestañas. Pulsar a un jugador abre su ficha pública; pulsar una partida, su ficha. |
| Ajustes | En grupos: **Partida** (borde rojo al ser atacado, puntero, tropas de los ataques, emojis, consejos), **Interfaz** (animaciones), **Sonido** (música y efectos, cada uno con su volumen, que se apaga con su sonido) y **Más** (tutorial, guía, «Restablecer ajustes» con confirmación, créditos y versión). |

**Clasificatoria** (tarjeta en Jugar): partidas que cuentan para tu rango de
la temporada.

- **Ligas**: Hierro, Bronce, Plata, Oro, Platino y Diamante, con divisiones IV–I
  de 100 puntos de liga (PL); luego Maestro, Gran Maestro y Leyenda, sin
  divisiones. Insignia propia de cada liga (también junto a tu emblema en la
  cabecera).
- **Colocación**: las 5 primeras partidas no dan rango visible: miden tu nivel
  oculto (MMR, empieza en 1000) y te colocan en una liga.
- **PL**: según tu puesto entre las naciones frente a lo esperado de tu rango
  (ganar da unos +20; quedar a media tabla o abajo, resta), ajustados si tu MMR
  va por delante o por detrás de tu rango. Tras ascender, **escudo** de 3
  partidas: no bajas de división.
- **Contra la IA**: el mundo, 90 naciones, perfil Clásico y reglas fijas; la IA
  es más difícil cuanto más alta tu liga. **Abandonar cuenta como quedar el
  último**, también si cierras la página a medias (al volver se resuelve).
- **Salas clasificatorias** (multijugador): el mundo, Clásico, 40 naciones de la
  IA y reglas fijas. Elo entre las personas (quién quedó por delante de quién) y
  una parte pequeña según tu puesto entre todas las naciones. Cada navegador
  firma su rango para la sala con una clave ECDSA P-256 y los demás lo
  comprueban. Si se va el anfitrión, no cuenta para nadie.
- **Temporadas** de dos meses: al cambiar, recompensa en monedas según tu mejor
  liga y reinicio suave (el MMR se acerca a 1000 y repites 2 partidas de
  colocación).
- **Tabla global**: en el enlace de Claude, en su base de datos; en la web, con
  `api/rangos.php` (ver «Publicarlo en la web»); si no hay ninguna, el rango se
  guarda en tu perfil.

**Al acabar una partida** sale su **resumen** sobre el mapa, en pestañas:
Resumen (puesto «3.º de 91», duración, máximo de territorio, eliminaciones,
edificios, recompensas que suben y el cambio de rango), Gráficas (tu territorio y
el de las 6 primeras naciones, tus tropas y tu oro), Momentos clave
(eliminaciones, alianzas, traiciones, capitales, bombas…) y Repetición (el mapa
cada 6 s, con reproducir, barra y ×1/×2/×4). La grabación solo observa la
partida, así que vale también en multijugador.

**Social**: «Compartir» (el menú del sistema o copiar el texto) y, en la web,
un **reto por enlace** («¿Me superas?»): quien lo abre juega exactamente esa
partida (mapa, rivales, dificultad, reglas y semilla) y ve si supera tu máximo
de territorio.

**En partida**, el botón «Menú» (o Escape, si no hay nada que cancelar) abre
un menú con «Continuar», ajustes rápidos (música, efectos, animaciones y
puntero), la Guía y «Abandonar» (con confirmación). La partida no se pausa.
La **Guía** reúne lo esencial en cuatro pestañas: Controles, Economía, Combate
y Diplomacia.

Cada partida da experiencia (territorio, eliminaciones, edificios, victoria…)
y monedas (más con los logros y los retos diarios); los niveles desbloquean
formas de emblema y patrones, y las monedas se gastan en la tienda de
Aspecto. El perfil se guarda en el navegador y, en el enlace de Claude,
también en tu cuenta.

## Mapas

- **Mundo real:** Mundo, Europa, Norteamérica, Sudamérica, África y Asia. Los
  bots son países reales con su bandera (los más grandes del mapa, hasta uno
  por país) y aparecen cerca de su ubicación, en el mejor hueco. Cordilleras y mesetas reales hacen más lento y
  caro avanzar.
- **Aleatorios:** pequeño, mediano y grande, generados con la semilla.
- **Ríos** (`doc-1.4`): en todos los mapas (los reales, con los ríos de
  verdad; en los aleatorios nacen en las montañas y bajan hasta el mar). Son
  **agua**: fronteras que no se cruzan por tierra (al otro lado se llega en
  barco). Si llegan al mar o a un lago son **navegables**: puertos en sus
  orillas, y desembarcos, mercantes y buques navegan por ellos; si no, son solo
  frontera (el tooltip lo dice). Al cargar, los tramos sueltos se unen por el
  camino más corto (hasta 24 casillas) al agua o a otro río, sin cerrar
  anillos; el Nilo y el Rin llevan su desembocadura marcada (si no, el Nilo
  acababa en Suez y el Rin se unía al Danubio). La tierra que queda aislada
  entre ríos con menos de 12 casillas pasa a río, y los puntos reales que caen
  en uno pasan a la tierra más cercana. Un río cierra un cerco como una
  frontera (el mar no) y la zona inicial no cruza ríos.

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
Escribe `src/mapas-reales.js`. Los ríos van aparte (`src/rios.js`), desde
`ne_50m_rivers_lake_centerlines` de Natural Earth:

```bash
node herramientas/rios.js <ne_50m_rivers_lake_centerlines.geojson>
```

Las banderas son de [flag-icons](https://github.com/lipis/flag-icons) (MIT).
Para regenerar el sprite (`src/banderas.js`) con los SVG `4x3` de esa colección:

```bash
node herramientas/banderas.cjs <carpeta con los .svg>
```

Créditos y licencias de terceros: `herramientas/LICENCIAS.md`.

## Multijugador

**Salas.** Desde Multijugador: «Crear sala» (mapa, nombre, visibilidad y
plazas; las reglas, en «Reglas avanzadas»), «Unirse con código» y la lista de
salas públicas (miniatura, mapa, modo y plazas libres). En la sala:

- **Invitar**: «Copiar enlace» (o el código de 5 caracteres). El enlace abre una
  ficha de entrada con el nombre, el mapa y las plazas, y el botón «Unirme»; si
  la sala está llena, ya empezó, se cerró o usa otra versión, dice por qué.
- **Prepararse**: cada invitado pulsa «Estoy listo». La confirmación se ata a
  la revisión de la configuración: si el anfitrión cambia mapa, naciones,
  dificultad o reglas, hay que confirmar de nuevo (nombre, visibilidad y plazas
  no la invalidan). El pie dice cuántos están preparados y qué falta.
- **Empezar**: con todos listos y conectados (mínimo 2), el anfitrión inicia una
  cuenta atrás de 3 s que fija participantes, semilla y configuración; si alguien
  sale, se desconecta o deja de estar listo, se vuelve a la sala con el motivo.
  Antes de simular, cada invitado comprueba que tiene la misma versión de reglas.
- **Al empezar**: el anfitrión espera a que todos hayan cargado el mapa (como mucho 20 s) antes del primer turno. Cada invitado compara su estado con el del anfitrión y, si se desincroniza, se le avisa. El reloj del anfitrión va en un Worker: la partida no se frena si su pestaña queda en segundo plano (y, si lo está, los invitados lo ven).
- **Reconexión**: quien pierde la conexión sale como «Reconectando…» y conserva
  su plaza unos 15 s. Si el corte es tuyo, no das por ido a nadie: al volver
  tienen margen para dar señales (antes, un invitado con la red caída 15 s
  «perdía» al anfitrión y la partida acababa).
- **Conexión estable**: los servidores se prueban a la vez y gana el primero de
  la lista que funcione (todos acaban en el mismo; si el preferido no responde,
  no se esperan 5 s por cada uno). El cliente manda un latido cada 3 s y, si
  pasan 7 s sin recibir nada (una conexión «colgada», como al pasar de wifi a
  datos), reconecta; al volver a la pestaña o recuperar la red lo comprueba en
  el momento. Reintentos desde 0,5 s (como mucho cada 5 s). En partida, el
  aviso «Sin conexión: reconectando…»; al volver, el invitado pide lo que se
  perdió (hasta 200 turnos por mensaje) y se pone al día en 1-2 s.

**Por dónde va.**

- **En el enlace de Claude** (capacidad `room`): entre quienes tienen el enlace
  con acceso de colaborador.
- **En la web** (Hostinger u otro hosting): por un servidor MQTT público y
  gratuito (EMQX, HiveMQ o Eclipse, el primero que responda) desde cualquier
  dispositivo. Es público: quien conozca el canal podría leer los mensajes, y no
  hay garantía de servicio. El enlace de invitación lleva el servidor del
  anfitrión (`&b=`). Con `?broker=wss://…` se usa uno propio.
- **Sin servidor** (o con `?red=local`): solo entre pestañas del mismo
  navegador, como prueba («Prueba entre pestañas»).
- Para probar en local: `node herramientas/broker-local.js` y abrir el juego con
  `?broker=ws://localhost:1884/mqtt`.

Funciona por *lockstep*: todos ejecutan la misma simulación determinista con la
misma semilla y solo viajan las acciones. El anfitrión marca el ritmo y reparte
las acciones de cada tick (de dos en dos); el invitado los juega **de uno en
uno cada 100 ms** con un colchón pequeño, algo más deprisa si se acumulan y de
golpe si va muy atrás (pestaña en segundo plano, corte), así que se ve tan
fluido como el anfitrión en vez de a saltos. Si falta un turno pero llegan los
siguientes, lo pide al momento; si no llega nada, a los 0,7 s. Repite sus
acciones hasta verlas confirmadas. Cada 10 s se comparan huellas del
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

El juego son ficheros estáticos. La **tabla global de rangos** y las
**cuentas** de la web usan además un PHP pequeño (`api/rangos.php`,
`api/cuentas.php` y sus piezas comunes en `api/comun.php`; PHP 8 + PDO con
SQLite o MySQL); sin él, el juego funciona igual, sin cuentas, y el rango se
guarda en cada navegador.

**Con Git (Hostinger), en dos pasos.** Se sirve el juego **empaquetado en un
solo archivo** (`index.html` con su JavaScript y su CSS dentro): no puede
mezclar versiones como pasaba con los módulos sueltos y la caché de la CDN. El
paquete lleva un sello de compilación (commit y fecha) que se ve en Ajustes y en
`<meta name="trinchera-build">`.

```bash
bash herramientas/hostinger.sh prueba       # rama hostinger-prueba → …/prueba/
bash herramientas/hostinger.sh produccion   # rama hostinger (el mismo index.html validado en prueba)
```

En hPanel → Avanzado → Git, con el repositorio
`git@github.com:SSUAVDRON/CONQUISTAMUNDIAL.git` (la clave SSH de hPanel en
GitHub → Settings → Deploy keys, solo lectura):

1. **Prueba**: un repositorio con la rama `hostinger-prueba` y el directorio
   `prueba` → se valida en `https://tu-web/prueba/` (Ajustes muestra la
   compilación esperada; «Crear sala» abre el formulario; Partida rápida, el HUD
   nuevo).
2. **Producción**: la raíz (directorio en blanco) con la rama **`hostinger`**
   (no `main`). Si hPanel pide la carpeta vacía, borra ese despliegue, vacía
   `public_html` y vuelve a añadirlo.
3. **Purga la caché de la CDN** en hPanel tras cada publicación en producción.
4. Comprueba la dirección normal, sin parámetros, en una pestaña nueva y en un
   navegador que ya tenía la versión anterior (recarga normal).

Con el webhook de «Despliegue automático» (GitHub → Settings → Webhooks), cada
subida a esas ramas se publica sola. El `.htaccess` de las ramas no deja leer
`.git` y pide revalidar el HTML siempre (`no-cache, must-revalidate`).

**Rama `main` tal cual** (módulos sueltos): el `.htaccess` de la raíz no deja
leer `.git`, `tests/`, `herramientas/`, `docs/` ni los `.md`, y pide comprobar
siempre la última versión. Para que la CDN no mezcle módulos de versiones
distintas, `index.html` lleva un *import map* con la huella del contenido de
cada módulo (`src/render.js?v=…`): cada archivo cambia de dirección solo cuando
cambia. Tras tocar `src/` o `css/`: `node herramientas/versionar.js` (un test
falla si se olvida).

**A mano:** sube `dist/dominia.html` como `index.html` a la carpeta que quieras.

**Tabla de rangos en Hostinger**: `api/rangos.php` va con la web (en `main` y
en las ramas de `hostinger.sh`) y **no hace falta configurar nada**: la primera
vez crea una base de datos SQLite **fuera de `public_html`** (junto a esa
carpeta, donde la web no la puede servir): `trinchera-rangos.sqlite`, y
`trinchera-rangos-prueba.sqlite` para el despliegue de `…/prueba/`. Para
comprobarla, abre `https://tu-web/api/rangos.php?temporada=2026-6`: debe
responder `{"filas":[]}` (o las filas que haya).

**Con MySQL en su lugar** (opcional, para mucho tráfico):

1. En hPanel → Bases de datos → MySQL, crea una base de datos y su usuario.
2. Crea, **fuera de `public_html`** (en la carpeta de tu usuario, junto a
   `public_html`), el archivo `trinchera-config.php`:

   ```php
   <?php return [
     'dsn'  => 'mysql:host=localhost;dbname=uXXXX_trinchera;charset=utf8mb4',
     'user' => 'uXXXX_trinchera',
     'pass' => 'la contraseña del usuario',
     'sal'  => 'una cadena larga al azar',
   ];
   ```

3. Las tablas se crean solas la primera vez; desde entonces se usa MySQL en
   vez de la SQLite.

Cada navegador tiene un id y un secreto aleatorios; el servidor guarda solo el
hash del secreto, limita las escrituras (una cada 8 s por jugador y 120 por hora
por conexión), valida los datos y rechaza cambios de rango que no cuadran con
las partidas jugadas. Para probarla en local:
`TRINCHERA_DSN=sqlite:/tmp/rangos.db php -S localhost:8000` (los tests lo hacen
solos si hay PHP).

**Cuentas** (`api/cuentas.php`, misma base de datos y misma configuración):
tablas `cuentas`, `cuenta_proveedores` (Google y Apple, cuando se activen),
`sesiones` y `perfiles` (con versión). Contraseñas con `password_hash`; el
token de sesión es aleatorio y el servidor guarda solo su sha-256 con la sal;
las sesiones caducan a los 180 días sin uso; límites de 10 cuentas nuevas por
hora y conexión, y de intentos de entrar por conexión y por correo; perfiles de
64 KB como mucho; mismo mensaje si el correo no existe o la contraseña no es.
El token va en el cuerpo JSON (Hostinger quita la cabecera `Authorization`).
Cada cuenta se puede borrar con `borrar_cuenta` (token y contraseña: se va
todo lo suyo). Recuperar la contraseña por correo llegará más adelante. Para
comprobarla:
`curl -X POST -d '{"accion":"proveedores"}' https://tu-web/api/cuentas.php`
debe responder `{"proveedores":[]}`.

Fuera del enlace de Claude y sin cuenta, el perfil y la clasificación general
se guardan en cada navegador; el multijugador entre ordenadores va por el
servidor de salas público.

## Reglas

| Concepto | Cómo funciona |
|---|---|
| Reglas personalizables | Colonias o bots débiles (automático según el mapa, o de 0 a 300), oro inicial (0 a 10M), modo de victoria (dominación, capitales, economía o supervivencia), victoria al 50/70/90 % en dominación, crecimiento de tropas, ingresos de oro y precios de los edificios (×0,5, ×1 o ×2), tregua inicial (sin, 1, 3 o 5 min: nadie puede atacar a otras naciones ni lanzar misiles, pero sí expandirse y conquistar colonias; se ve una cuenta atrás), límite de tiempo (sin, 10, 20 o 30 min: al acabar gana quien tenga más territorio; el reloj marca lo que queda) y qué está permitido: misiles y antimisiles, buques de guerra, alianzas, desembarcos y fábricas con sus trenes. Las mismas en «Contra la IA» y en la sala multijugador, donde las ve todo el mundo en el resumen; en la sala, además, el cooperativo por parejas (con roles opcionales). |
| Despliegue | Los primeros 30 s haces clic donde quieres empezar (puedes cambiarlo). Arriba, un panel con un reloj y una barra que se vacía (ámbar en los últimos 10 s, rojo en los últimos 5; verde cuando ya has elegido) y «Elegir por mí»; los últimos 5 s, cuenta atrás grande con un «tic» por segundo. Si no eliges, se te asigna un sitio. Cada nación es su zona inicial: un disco de casillas (52, filas de 4-6-8-8-8-8-6-4) con un aro de una casilla en su color y el interior teñido y translúcido sobre el terreno; al empezar pasa al estilo normal del territorio. Cambiar de sitio es inmediato y no deja rastro en el sitio anterior. Alejado no se ven las placas de nombre de los bots (solo la tuya, la de otros jugadores y aliados): salen al acercar la cámara o cuando el país se ve grande. |
| Expansión | Al hacer clic en tierra libre (o en un vecino), tu país crece **en todas direcciones, algo más hacia donde has hecho clic** (el centro se desplaza hacia allí, pero sin brazos finos: las esquinas y huecos se rellenan antes de alargar puntas); otro clic en otra dirección reorienta el avance. En tierra libre las casillas se conquistan **por distancia al centro del país** (con un poco de azar para que el borde no salga recto y algo más tarde en meseta y montaña): todas las naciones crecen **parejas, en círculo**. Los bots se expanden en todas direcciones, con casi la misma parte de sus tropas, y refuerzan la ofensiva cuando se queda sin tropas, así que al empezar crecen a ritmo constante. La forma es limpia de cerca: una casilla casi rodeada por ti (3 o 4 vecinas tuyas) se conquista la primera, y la tierra libre que queda encerrada dentro de tu país pasa a ser tuya sola, así que no quedan casillas sueltas difíciles de clicar.|
| Mapa | Casillas muy pequeñas: `RES` 3 en `config.js` (1,5 veces la resolución de `RES` 2 en cada eje: 2,25 veces más casillas; el mundo, 3000×1500, y el resto de mapas reales y aleatorios en proporción). Las distancias y velocidades de `CONFIG` se adaptan con `RES`; las fórmulas del documento (`MECH`: zona inicial de 52 casillas, presupuesto de expansión por casilla del frente, bajas por casilla) van por casillas y no se escalan, así que, con casillas más pequeñas, la misma zona tarda más en llenarse. Los mapas reales se regeneran con `node herramientas/mapas.js` y `node herramientas/rios.js`. Las rutas por mar se buscan primero en una rejilla gruesa y luego solo por ese pasillo, así que siguen siendo rápidas. |
| Tropas | Reglas del documento «Especificación técnica: economía, tropas y expansión territorial» (en `src/mecanicas.js`). Empiezas con **52 casillas** (el disco de radio 4 desplazado −0,5; menos si toca el mar o a otro) y **25.000 tropas** (colonias 10.000). **Techo** = 2 × (casillas^0,6 × 1000 + 50.000) + 250.000 por nivel de ciudad terminado (121.411 con 52 casillas). **Regeneración** por turno = (10 + tropas^0,73 ÷ 4) × (1 − tropas ÷ techo): lo más rápido hacia el **42 %** del techo (3.303/s al empezar), 0 en el techo y nunca negativa. Las colonias tienen un tercio del techo y la mitad de regeneración; las naciones de la IA, ×0,5 / 0,75 / 1 / 1,25 de techo y ×0,9 / 0,95 / 1 / 1,05 de regeneración en fácil / normal / difícil / imposible. La **fuerza de ataque** (20 % al empezar) sale de la reserva al momento y la reserva sigue regenerándose. Regla opcional **«Economía con trabajadores»** (variante del documento, sección 07): población = soldados + trabajadores con el deslizador **Reparto** (el cambio es inmediato y no crea ni destruye población) y +1 de oro por turno cada 100 trabajadores. |
| Atacar | Clic en tierra libre o en una nación vecina: se envía el % de tus tropas que marque **Fuerza de ataque**. Repetir el clic refuerza el ataque. |
| Coste | Tierra libre: 3 tropas por casilla, así que te expandes en proporción a las tropas que mandas: con pocas, poco; con muchas, mucho (en el mundo con 90 naciones, hacia el minuto 1 está ocupado un 40 % de la tierra y a los 3 minutos casi toda). Naciones: depende de su densidad (tropas ÷ casillas). Mesetas ×1,4 y montañas ×2 en coste y tiempo. |
| Contraataque | Si dos naciones se atacan a la vez, las tropas de ambos ataques se anulan primero. |
| Retirada | El botón ✕ de un ataque lo cancela; vuelve la mitad de sus tropas. |
| Velocidad de conquista | Cuantas más tropas mandas, más rápido avanzas: en tierra libre según las tropas por casilla de frente, contra una nación según tu superioridad sobre su densidad (hasta ×3,5). |
| Barcos | Clic en una costa sin frontera terrestre: sale un barco de transporte desde tu costa más cercana (máx. 3 a la vez; los puertos no suman). **Hace falta al menos un puerto terminado** (si no, «Necesitas un puerto para mandar barcos»); los bots que quieren cruzar el mar se hacen primero uno. Todos los barcos (desembarcos, buques y mercantes) van un 40 % más lentos que antes (`doc-1.3`). Navegan también por los ríos que llegan al mar (`doc-1.4`): un río sirve para desembarcar en la otra orilla, pero uno que no llega al mar no se navega. Las rutas cruzan los estrechos: si la búsqueda por el pasillo de la ruta gruesa no llega (Ormuz, donde la ruta gruesa cruzaba la península de Musandam), se repite con un pasillo más ancho y, solo si tampoco, sin pasillo (con un tope menor); la ruta gruesa solo une dos celdas si su agua se toca de verdad por el borde (`doc-1.5`; antes podía «saltar» un istmo y obligar a la búsqueda cara). Los mercantes calculan como mucho una ruta nueva por turno (las ya calculadas se reutilizan) y un bot que no encuentra ruta para un desembarco espera 20 s antes de volver a intentarlo; el Bósforo y los Dardanelos se abren al cargar el mapa (con ~13 km por casilla desaparecían y el Mar Negro quedaba aislado). |
| Naciones | Hasta 200 rivales en cualquier mapa (partida rápida: 90). En los mapas reales primero salen los países de verdad, con su bandera y cerca de su sitio real (a menos de 10·RES casillas, en el mejor hueco: con la zona inicial entera, tierra adentro, en llano y separados de los demás; de media a 2-3 casillas de su punto) (mundo 156, Europa 52, África 72, Asia 74, Sudamérica 20, Norteamérica 17); si pides más, el resto son naciones inventadas repartidas por el mapa. La IA mantiene sus tropas hacia el 42 % del techo (donde más rápido se regeneran) y ataca con lo que sobra: elige al vecino que mejor puede ganar (pocas tropas por casilla, colonias, naciones ya en guerra con otros, traidores, rencores y el líder si se escapa), remata refuerzando un ataque que se agota, contraataca para anular tus ofensivas grandes (más en difícil e imposible) y los más agresivos pelean mientras se expanden. |
| Colonias | Además de las naciones aparecen colonias («Colonia de…», «Aldea de…», «Misión de…»): tienen menos tropas, cuesta menos conquistarlas, no construyen ni firman alianzas y guardan su oro. Presa fácil al empezar. En tierra libre se expanden casi al ritmo de una nación (`doc-1.4`): mandan el 30-45 % de sus tropas en cuanto no tienen expansión en marcha (o la que tienen se queda sin tropas), avanzan como una nación con un envío normal (6.600 tropas) aunque manden menos y pagan ×0,38 de bajas. Cada una es distinta (sale de la semilla y su id, sin gastar el azar de la partida): su ritmo va de ×0,8 a ×1,3 y su forma, de redonda a irregular. A los 60 s de juego, una colonia lleva de media ~85 % de las casillas de una nación. Hay muchísimas: una por cada 500 casillas de tierra de la rejilla original, hasta 300 (las 300 en el mundo); con menos de 20 rivales, proporcionalmente menos. Se reparten por superficie real (en el mapa del mundo, de proyección Miller, el norte sale estirado: antes ~125 de 300 caían al norte de 60°N y solo ~17 en África, tapada por las zonas de sus 34 países; ahora ~84 y ~43), pueden quedar más cerca de las naciones (24 casillas) que entre ellas y empiezan con su zona inicial entera. |
| Buques de guerra | Se botan desde un puerto propio terminado (máx. 3 por puerto y 1 más por cada nivel extra de puerto; min(1M, 250k × (buques + 1))). Van solos y su zona **se elige al botarlos y ya no se cambia**: con la T, clic en el mar (sale del puerto propio más cercano que dé a ese mar y la vista previa muestra el círculo que patrullará) o en tu costa (patrulla junto al puerto). La zona solo se ve al colocarlo (en la vista previa); en el mapa el buque es un casco con la cubierta del color de su dueño (filo blanco si es tuyo), su estela y su barra de vida, sin aro ni círculo alrededor. A tiro disparan a buques enemigos, hunden transportes de tropas y **capturan** mercantes rivales (pasan a ser tuyos); si un intruso entra en su zona, lo persiguen. No atacan puertos. |
| Barcos de tropas | Con al menos un puerto, salen de cualquier costa tuya. La casilla de desembarco se toma con las mismas bajas que cualquier otra. Dejan una línea fina desde donde salieron (y punteada hasta donde van): todos ven de dónde viene un desembarco. |
| Alerta | Si te atacan por tierra, mar o con un misil, el borde de la pantalla se pone rojo: más rojo y con latido más rápido cuanto más te atacan (tropas frente a las tuyas, número de atacantes, misiles). Desactivable en Ajustes. |
| Tropas a la vista | Cada combate tuyo tiene una tarjeta debajo de la clasificación: quién ataca a quién, tropas del atacante **VS** tropas del defensor, con una leyenda bajo cada cifra («te ataca con» / «tus tropas», «atacas con» / «sus tropas») y una barra de fuerzas. **Roja** si te atacan (van primero) y **verde** si atacas tú; los marcadores del mapa usan los mismos colores. También para desembarcos y misiles (con la cuenta atrás del impacto). Clic en la tarjeta: la cámara vuela al frente y lo marca. En el mapa, cada frente lleva además su marcador de tropas: una pastilla pequeña (15 px de alto, algo translúcida) del lado del atacante, detrás del frente, para que se vea lo que se ataca; las flechas del frente son discretas. |
| Avisos | En un recuadro abajo a la derecha, solo lo importante: alianzas y traiciones (de todos), jugadores derrotados (la muerte de los bots no se avisa), las naciones que conquistas tú, barcos y misiles que vienen hacia ti, tu puerto destruido, logros e inicio de partida. Con icono según el tipo; los repetidos se agrupan (×N). Las respuestas a tus acciones («Te falta oro», «Buque botado»…) salen como una pista breve encima del panel. |
| Paneles plegables | Clasificación, combates y avisos se pliegan desde su cabecera (se recuerda). Plegados, la clasificación muestra tu puesto, los combates cuántos te atacan y cuántos ataques tuyos hay, y los avisos cuántos nuevos tienes. |
| Clasificación | Tus aliados salen en verde; las colonias, en gris cursiva; tu nombre, en tu color de nombre. |
| Interfaz en el ordenador | Con pantalla ancha y ratón: arriba a la izquierda, la clasificación en tabla (puesto, nación, tierra, oro y tropas; tu fila siempre, y menos filas si falta altura); abajo a la izquierda, tus cifras y el ataque (con el minimapa encima); abajo en el centro, la barra de edificios (tecla, icono, precio y cuántos tienes); abajo a la derecha, los avisos. Al empezar la conquista, la cámara vuela a tu región. |
| Panel de abajo | En el móvil y en pantallas estrechas, centrado y compacto: tropas y su techo (con su regeneración por segundo), oro, territorio y barcos; la fuerza de ataque (y el reparto, con la economía de trabajadores); y los edificios en **tres grupos: Economía** (ciudad, puerto, fábrica), **Defensa** (puesto, antimisiles, buque) y **Ataque** (silo y bombas). En el móvil se ven solo los tres grupos (40 px, con un punto si hay algo que puedas pagar); al tocar uno sube una bandeja con sus edificios, nombre y precio, y al elegir uno se cierra (el grupo queda resaltado con su icono). En el ordenador, los tres grupos a la vista con su título de color, icono y precio (el nombre sale al pasar el ratón; en gris los que no puedes pagar, con una barra de cuánto oro te falta y un martillo si hay obras). Las teclas no cambian. Se minimiza con su botón o la tecla **V**. |
| Gráficos | Mapa en píxeles nítidos con zonas de color planas y limpias (sin moteado): llanura verde oliva, llanura seca, desierto tostado con claros de arena, montaña parda y cumbres claras, según la altura y el clima (en la franja de desiertos las tierras bajas tiran a arena); el relieve apenas se insinúa. En los mapas reales la altura es la de verdad (ETOPO5 de NOAA); en los aleatorios, la del generador. Costa con un contorno oscuro de una casilla y mar azul marino liso, algo más claro junto a la costa. Naciones en tonos pálidos y semitransparentes (se ve el terreno debajo), con una frontera fina y opaca en su mismo tono más oscuro: la capa del territorio lleva 2×2 píxeles por casilla y la frontera solo ocupa la mitad que da al vecino (media casilla; entre dos países, una casilla en total). Nombres y tropas en gris oscuro. Tu nación se resalta: frontera blanca por fuera y tu color por dentro, y nombre en color vivo. Las casillas recién conquistadas brillan un instante (se pintan en el propio territorio, sin coste por fotograma), saltan chispas y humo en los frentes y unas flechas marcan hacia dónde avanza cada ataque. Barcos dibujados con su rumbo y estela; misiles con humo y sombra; explosión con fogonazo, onda expansiva, hongo de humo y cráter; los antimisiles lanzan un interceptor visible (estela continua y rótulo «¡DERRIBADO!» / «FALLO»). Todo se desactiva con «Animaciones» en Ajustes. |
| Edificios en el mapa | Pictogramas lisos (bloque de edificios, ancla, fábrica, torre, misil, lanzador, barco), pequeños y discretos: en el mapa, en claro sobre un disco oscuro semitransparente (un triángulo para silo y antimisiles) con un anillo fino del color del dueño (y filo blanco si son tuyos). En el panel, el pictograma blanco con su tecla arriba a la izquierda y el precio. |
| Territorio y nombres | Cada nación se pinta en un tono suave y semitransparente de su color (el relieve se ve debajo), sin franja interior, con un borde fino de su tono oscuro; el tuyo con borde blanco y tus aliados con franjas y borde verdes. Los nombres van en texto oscuro con un halo claro y las tropas de los rivales en blanco con un contorno oscuro suave (lo tuyo, en tu color vivo). Al alejar la cámara los nombres no encogen con el país: tienen un tamaño mínimo legible (las colonias, algo menor); los de los bots solo salen con la cámara cerca o si el país se ve grande, y, si dos se pisan, se ve el del país más grande (antes tú, tus aliados y los demás jugadores; las colonias, al final). Los **jugadores de verdad** llevan delante del nombre una insignia redonda de su color con una silueta de persona, para distinguirlos de los bots.|
| Sonido | Música de fondo ambiental (acordes lentos, un bajo suave y notas sueltas con eco, generada al momento) y efectos bien audibles: clic, obras y edificio terminado, expansión (roce suave) y carga y tambores de marcha cuando atacas a una nación, golpes cuando pierdes casillas, **fanfarria al conquistar una nación** (más corta con una colonia) y lluvia de monedas del botín, tambores y cuerno cuando te declaran la guerra, cuerno al empezar la conquista, alianza firmada o rota, desembarco, barco o buque hundido, edificio capturado, barco, misil, explosión e intercepción (más flojos cuanto más lejos de la cámara), cañonazos, monedas de tus trenes y mercantes, avisos y fin de partida. Todo sintetizado en el navegador, sin ficheros de audio. En Ajustes: música y efectos por separado con su volumen; botón de altavoz en la barra superior (o tecla **N**) para silenciarlo todo. Empieza a sonar con el primer clic (los navegadores no dejan sonar antes). |
| Rendimiento | Mar y tierra van en una sola imagen y solo se dibuja la parte visible (alejado, desde una copia reducida); el territorio se sube a la tarjeta gráfica por bloques de 64×64 casillas (128×128 píxeles) y solo los que cambian y se ven; las alianzas entre bots no obligan a repintar; los nombres se recalculan sobre una rejilla gruesa y en tres fotogramas seguidos (sin tirón periódico), conservan su opacidad entre cálculos y el que ya se ve tiene preferencia si dos se pisan (no parpadean); la clasificación se reordena una vez por segundo y solo mide sus filas si cambia el orden. Solo brilla el terreno ganado en combate: el de tierra libre no (al empezar crecen cientos de países a la vez y el brillo hacía latir el mapa entero). En pantallas de alta densidad, si el equipo no llega a ~40 fps el mapa se dibuja a menos píxeles (los paneles siguen nítidos). Como mucho 3 turnos de simulación por fotograma: si el equipo va justo, la partida va un pelín más lenta en vez de dar tirones. Los nombres se guardan ya dibujados como imágenes (solo se rehacen si cambian) y las cifras de tropas se componen con un juego de dígitos pre-dibujados, en vez de dibujar texto con contorno en cada fotograma. La IA no repite cálculos de vecinos dentro del mismo turno y las colonias solo miran su frontera si de verdad pueden expandirse. Las estelas de los barcos fuera de pantalla no se dibujan y las de barcos ajenos van sin contorno oscuro; los cercos se buscan por tandas y las rutas de mercantes, de una en una (ver Combate y Barcos): en un Pixel 7 con la CPU ×4 más lenta, los fotogramas de más de 100 ms pasaron de ser habituales a ~5 de cada 2.000. |
| Estabilidad | Si el navegador descarta el contenido de los lienzos (Chrome en Android, con poca memoria o al volver de otra app: el mapa se quedaba en negro y sin territorio el resto de la partida), se detecta (eventos `contextlost`/`contextrestored`, `isContextLost()` cada 2 s y al volver a la pestaña) y se rehace todo: terreno, territorio (sus píxeles siguen en memoria), nombres, sprites, minimapa e iconos del panel; en el menú de partida, «🔄 Repintar el mapa» lo fuerza a mano. Cada fotograma pide el siguiente antes de nada y aísla simulación, dibujo, minimapa y paneles: un fallo no congela la partida, se registra (`src/errores.js`) y se puede copiar en Ajustes → Más → Último error. Al empezar otra partida o volver al menú se suelta la anterior antes de crear la nueva (~120 MB menos en el menú del móvil). Un cambio de alianza solo repinta las naciones afectadas; en el móvil, como mucho 2 turnos por fotograma. |
| Móvil | En vertical, el panel de abajo va en tres filas cortas (cifras, fuerza de ataque en una línea y los 8 edificios a la vez, sin deslizar); en horizontal, todo en una sola fila baja. Clasificación (3 primeros y tú), un combate y los dos últimos avisos, más pequeños; galería de mapas con tarjetas pequeñas. En pantallas táctiles el mapa se dibuja a 1,5× como mucho (y baja antes si va justo), sin viñeta, sin desenfoque detrás de los paneles (obligaba a recalcularlo en cada fotograma) ni rayas animadas, y la partida de fondo del menú va más tranquila. Un mapa apaisado en un móvil en vertical empieza más cerca (no como una franja). |
| Barra superior | Tiempo de partida, tu puesto entre las naciones en pie y el líder con su territorio frente a la meta de victoria (se pone ámbar si se acerca). |
| Oro | **Pasivo y fijo**: 100 por turno (1.000/s; las colonias 50), × el multiplicador de oro de la sala. No depende del territorio ni de las tropas, y expandirte o conquistar casillas **no da oro**. Al **eliminar** a un rival por completo te quedas con todo su oro (lluvia de monedas hasta tu contador y fanfarria). Además: **mercantes** (los dos dueños cobran floor((75.000 ÷ (1 + e^(−0,03 (d − 300))) + 50 d) × mult), con d = casillas de agua recorridas: ~5.185 a 100, 13.556 a 200, 52.500 a 300, 99.814 a 500), **trenes** (10.000 en estación propia o neutral, 35.000 aliada, 0 enemiga) y regalos de aliados. Oro inicial opcional: de 0 a 10M en las partidas personalizadas. |
| Edificios | Se construyen en tu territorio con oro. Deben estar a 5 casillas o más de otro edificio. Si te conquistan la casilla, el edificio (con su nivel) pasa al conquistador. |
| Obras | Cada edificio tarda en construirse y no hace nada hasta terminar (anillo de progreso sobre el icono): fortaleza 4 s, ciudad 5 s, puerto y fábrica 6 s, silo 9 s, **antimisiles 16 s**. Subir de nivel tarda el 80 % de eso. |
| Precios | Del documento (04.2): **ciudad** min(1M, 125k × 2^ciudades); **puerto y fábrica comparten escalera** min(1M, 125k × 2^(puertos + fábricas)); **puesto defensivo** min(250k, 50k × (n + 1)); **buque** min(1M, 250k × (n + 1)); **antimisiles** min(3M, 1,5M × (n + 1)); **silo** 1M; **bomba atómica** 750k; **bomba H** 5M; **MIRV** 25M. Los niveles subidos cuentan como edificios para la escalera. |
| Niveles | Con un edificio seleccionado, clic sobre uno tuyo del mismo tipo: sube de nivel (hasta 5; el número del nivel sale en una chapa dorada encima del edificio). Cuesta lo mismo que el siguiente de su tipo. Cada nivel repite el efecto: ciudad +250.000 de techo, fábrica +4 casillas de alcance de las vías, puesto defensivo +2 de radio y +0,4 de defensa, silo −15 % de recarga, antimisiles +3 de radio, +7 % de acierto y −12 % de recarga; los puertos de más nivel lanzan mercantes más a menudo. |
| Ciudad | +250.000 de techo de tropas por nivel (no añade tropas: sube el límite y con él la regeneración). |
| Puerto | En la costa: basta con hacer clic cerca de tu orilla (se coloca en la casilla costera libre más cercana, hasta `portSnap` = 6 × RES casillas, también si pulsas en el agua). Cada 10 turnos puede lanzar un mercante (probabilidad 1 ÷ max(1, floor(100 ÷ nivel² ÷ (rechazos + 1) ÷ saturación)), PROPUESTA del documento) hacia el puerto de otro jugador del mismo mar con el que no estés en guerra: al llegar cobráis **los dos**. No da oro por turno. Para subirlo de nivel, clic sobre él (o en el agua de al lado). |
| Puesto defensivo | En un radio de 12 casillas, el tiempo y las bajas de quien te ataca se multiplican por 3 («efectos de defensa» del combate del documento). |
| Fábrica | +35 % de oro. Además tiende **vías en ángulo recto** (un tramo en horizontal y otro en vertical, por donde crucen menos agua) hasta las ciudades, puertos y otras fábricas a su alcance (14 casillas de recorrido, +4 por nivel; se ve como un rombo al colocarla; como mucho 6, las más cercanas, en la misma masa de tierra), **también las de otros jugadores, enemigos incluidos**. Por cada vía sale un tren cada 15-30 s: al llegar a la estación y al volver a la fábrica da oro al dueño de la fábrica (3k + 30 por casilla de vía, +25 % por nivel); si la estación es de otro, su dueño se lleva la mitad. Verás «+oro» cuando llega uno tuyo o pasa por tu estación. 400k. |
| Silo | Icono triangular. Permite lanzar misiles; cada silo recarga en 15 s. 2M fijo. |
| Bombas | Desde un silo, a 220 × RES casillas como máximo: **bomba atómica** (750k, radio 8 × RES), **bomba H** (5M, radio ×2,2) y **MIRV** (25M: 24 cabezas pequeñas repartidas al azar por todo el país atacado, cada una se puede derribar). Arrasan: las casillas enemigas quedan libres, se destruyen sus edificios, el defensor pierde tropas y los barcos y buques alcanzados sufren daños. Nunca afectan a ti ni a tus aliados. |
| Antimisiles | Icono triangular. Dispara a los misiles enemigos que pasan a 22 casillas o menos; acierta un 65 % de las veces y después **recarga 20 s** (−12 % por nivel). Se ve el interceptor subir con su estela y un rótulo «¡DERRIBADO!» o «FALLO»; mientras recarga, un anillo azul se llena con los segundos que faltan (los silos, igual en naranja) y, listo, un punto verde. Varios misiles a la vez saturan la defensa. 3M fijo. |
| Alianzas | Los aliados se ven con **franjas verdes** sobre su territorio, frontera verde y 🤝 junto al nombre. Clic derecho (o mantener pulsado) sobre otra nación abre su ficha: proponer alianza, enviar tropas u oro (solo a aliados, según la fuerza de ataque) y emojis. Máximo 3 aliados. Los aliados no pueden atacarse; al firmar, los ataques entre ambos se detienen y las tropas vuelven. Además: **pactos de no agresión** de 5 min (no podéis atacaros ni lanzaros misiles; se ve el tiempo que queda; romperlo te marca como traidor), **ofertas de paz** cuando estáis en guerra (paran los ataques 2 min, con un tributo opcional del 10 o 25 % de tu oro) y **pedir ayuda** a tus aliados (los bots atacan a quien te ataca o te mandan tropas). La IA ofrece pactos a vecinos mucho más fuertes y pide la paz cuando va perdiendo. |
| Propuestas | Las que recibes aparecen con Aceptar/Rechazar y caducan a los 15 s. Si te rechazan, debes esperar 1 min para volver a proponer. |
| Traición | Romper una alianza (pide doble confirmación) te marca como traidor 60 s: conquistarte cuesta ×0,6 y los bots no se fían de ti. |
| Victoria | Cuatro modos (en las reglas de la partida): **dominación** (el 70 % de la tierra; también 50 o 90 %), **capitales** (controlar el 40 % de todas las capitales durante 60 s), **economía** (ingresar 900.000 de oro por minuto durante 2 min) y **supervivencia** (al acabar el tiempo —20 min si no hay límite— gana la mejor puntuación entre los vivos: territorio, eliminaciones y oro ganado). En todos, también se gana siendo el último en pie o si solo quedan naciones aliadas. La barra superior muestra el objetivo del modo y, si alguien lo cumple, cuánto le falta para ganar. |
| Puntos estratégicos | Rombos en el mapa, siempre visibles: **capitales** (corona; una por nación, donde se desplegó: conquistar una ajena da 30.000 de oro y su dueño crece un 15 % menos hasta recuperarla; cada capital que controles da +5 % de oro y de crecimiento), **núcleos industriales** (engranaje: +15 % de oro pasivo, con rendimiento decreciente), **puertos clave** (timón: +1 barco de transporte y +25 % de oro de trenes y mercantes) y **pasos de montaña** (picos: conquistar a su alrededor cuesta un 60 % más). Unos 1 por cada 75.000 casillas de tierra (entre 8 y 36), separados y colocados con la semilla. Avisos al tomarlos o perderlos; la IA los busca. |
| Perfiles de reglas | Versionados en `PROFILES` (`src/mecanicas.js`); el id viaja con la partida y se comprueba al empezar una sala. **Clásico** (`clasico-3`, el de Partida rápida y el de los jugadores nuevos): el ritmo de FrontWars, sin puntos estratégicos (ni capitales, ni su botín, ni la victoria por capitales) ni tecnologías/especialización; `paceRegen` 1 (cerrado: cuadra con el HUD de FrontWars a igual reserva y techo), `paceNeutral` **0,25** (la mitad del 0,5 de `clasico-1`, más cercano a FrontWars, porque la expansión inicial iba demasiado rápida) y `pacePvp` **1** (provisional). En el mundo de 3000×1500 con 90 naciones, contando desde que empieza la partida (con los 30 s de despliegue), la tierra ocupada va por ~1 % a los 30 s, ~28 % al minuto, ~74 % al minuto y medio y ~97 % a los 2 minutos; es decir, ~28 %, ~74 % y ~97 % a los 30, 60 y 90 s de juego (con `doc-1.2` las colonias ocupan tierra libre el doble de rápido: a los 30 s de juego tienen ~525 casillas de mediana, frente a ~2.700 de una nación). **Trinchera** (`trinchera-2`): ×0,07 en tierra libre, ×0,5 en guerras y ×0,6 de regeneración, con puntos estratégicos y tecnologías; en el mapa del mundo con 90 naciones la tierra ocupada va por ~7 % al minuto, ~40 % a los 2 y ~95 % a los 4. Las reglas guardadas antes de los perfiles se migran a `trinchera` (el valor histórico) antes de combinarse con los valores por defecto (`migrateRules`). Calibración: `node herramientas/calibrar.js` → `docs/calibracion-clasico.md`. |
| Cifras en pantalla | Las tropas se muestran **÷ 10** (`TROOP_SCALE` en `src/format.js`), como en el juego de referencia: por dentro siguen siendo las del documento (25.000 al empezar), en pantalla 2.500; el techo con 52 casillas sale como 12,1k y una ciudad suma 25.000. El oro no cambia. |
| Combate | Del documento (sección 05), con los cambios de `doc-1.2` (versión del motor). **Tierra libre**: presupuesto por turno = 2 × casillas del frente (× ritmo); cada casilla cuesta 2000 × coste ÷ tropas de tiempo, como mucho 100 (coste 16,5 llanura, 20 meseta, 25 montaña); por debajo de 5 (más de ~6.600 tropas en llanura) **más tropas siguen acelerando** con rendimiento decreciente, 5 × √(t ÷ 5), hasta 1,25 (×4, hacia las 100.000 tropas). El coste se recalcula con las tropas que le quedan al ataque: un ejército grande arranca rápido y frena al gastarse. Bajas: magnitud ÷ 2,5 (**32 / 40 / 48**, 3,2 / 4 / 4,8 en pantalla: el doble que el documento). Las **colonias** pagan la mitad (16 / 20 / 24) y van el doble de rápido en tierra libre. Orden de conquista: por distancia al centro del país mezclando la normal y la mayor de |dx|, |dy| (`growSquare` 0,45): crece como un cuadrado de esquinas redondeadas. **Contra otro país**: ratio = tropas del defensor ÷ del ataque; bajas del atacante por casilla = magnitud × traidor × clamp(ratio, 0,6, 2) × (0,463 + 0,0039 × tropas del defensor por casilla); el defensor pierde sus tropas ÷ casillas por cada casilla; cada casilla cuesta speedCost × coste × efectos de defensa ÷ ancho del frente (speedCost = f(ratio) × clamp(ratio ÷ 20, 1, 50) ÷ 8,55, con f = ratio entre 0,82 y 7,5; por debajo de 0,82, es decir con más de 1,22 veces las tropas del defensor, **sigue acelerando**: f = 0,82 × √(ratio ÷ 0,82), hasta ×3 más rápido; las bajas no cambian). **Retirada**: a los 20 turnos; contra otro país se pierde el 25 %. **Cerco**: una bolsa sin costa rodeada por ti (de tierra libre o del defensor) pasa a ser tuya al momento. Para no recorrer cientos de casillas de tierra abierta en cada conquista, a partir de 8 casillas una sonda en línea recta comprueba si la bolsa escapa (al borde, al agua, a otro dueño o por tamaño); da el mismo resultado que el recorrido completo, pero gasta mucho menos, así que el presupuesto del turno ya no se agota y los cercos se resuelven para todas las naciones. Desde `doc-1.5` cada ataque guarda las casillas que conquista y busca cercos alrededor de ellas cada 4 turnos (0,4 s), con su fase propia para que no coincidan todos: lo mismo que antes, pero sin tirones cuando cientos de países crecen a la vez. Los bonus de «imperio grande» del documento no tienen fórmula pública: quedan neutros (×1). Sin órdenes de ataque (rápido, preparado, fortificar ni avance continuo). |
| Desarrollo (tecla I) | **Economía**: oro por minuto e ingresos del último minuto por fuente (trabajadores, comercio, conquistas, botín, regalos) y gastos; qué daría construir ahora una ciudad (techo y regeneración), una fábrica o un puerto. **Especialización**: industria (+25 % de oro pasivo y los trenes de tus fábricas un 50 % más rentables, pero fábricas más caras), infraestructura (trenes y mercantes +60 %, raíles más largos, +1 barco) o desarrollo urbano (+15 % de población máxima, +10 % de crecimiento, ciudades un 20 % más baratas); la primera es gratis y cambiarla cuesta 300.000. **Tecnologías**: 12 en tres ramas (economía, ejército, defensa) con dos niveles; una a la vez, 150.000 la primera y cada una ×1,6 la siguiente (y 10 s más), así que no se pueden tener todas. La IA investiga según su carácter. |
| Información útil | Tooltip con el punto estratégico cercano y una **estimación del ataque** (casillas que ganarías y riesgo, «incierto» si hay puestos defensivos o pasos); al atacar, la misma estimación como pista; al elegir ciudad, fábrica o puerto, su rendimiento estimado. **Consejos** (💡, desactivables en Ajustes): población al máximo, oro sin usar, un vecino con muchos más soldados en tu frontera, soldados ociosos o un punto estratégico libre cerca. |
| Cooperativo | En la sala multijugador, «cada dos jugadores llevan una misma nación» (por orden de llegada: 1.º y 2.º, 3.º y 4.º…; el último va solo si sois impares) y, opcional, **roles**: el primero, mando militar (ataques, puestos defensivos, silos, antimisiles, buques y bombas); el segundo, economía y diplomacia (ciudades, puertos, fábricas, reparto, tecnologías, especialización, alianzas, pactos y ayudas). Lo que ordena tu compañero se ve en el mapa con su nombre. Si los dos dan órdenes a la vez, vale la última. |

### Controles

- **Arrastrar**: mover el mapa (al soltar en movimiento sigue un poco y frena) · **Rueda / pellizco**: zoom (la rueda, suave y hacia el cursor; con dos dedos también se desplaza) · **WASD / flechas**: desplazarse
- **1–9 / 0**: fuerza de ataque 10 %–100 % · **Mayús + rueda**: ajuste fino
- **Q / E / R / F / G / H / T**: ciudad / puerto / puesto defensivo / fábrica / silo / antimisiles / buque (o los botones del panel), luego clic en el mapa
- **M / J / K**: apuntar una bomba atómica / bomba H / MIRV (clic en territorio enemigo)
- **✕** en la tarjeta de un ataque: retirada (a los 2 s; contra otro país se pierde el 25 %)
- **T + clic en el mar**: botar un buque de guerra con esa zona de patrulla (fija)
- **Mayús + clic** al construir: colocar varios seguidos · **Esc / clic derecho**: cancelar
- **Clic derecho / mantener pulsado** sobre otra nación: ficha de diplomacia
- **C** o botón **Mi nación**: la cámara vuela a tu nación · **+ / −**: zoom · **Esc**: cancelar lo abierto o, si no hay nada, abrir el menú en partida
- **Puntero**: sobre tu nación flota la marca «TÚ»; si la pierdes de vista, una flecha en el borde de la pantalla apunta hacia ella (pulsarla te lleva). Se desactiva en Ajustes.
- **Clic en una tarjeta de combate** (a la derecha): la cámara vuela a ese frente
- Clic en la clasificación: la cámara vuela a esa nación y abre su ficha · Minimapa: un toque vuela allí; arrastrando, la vista sigue al dedo
- **Con el dedo** (`src/toque.js`): tocar el **nombre** de un país lo ataca a él (los nombres suelen salirse de sus fronteras; también con ratón). Hay tolerancia de ~24 px: si el toque cae en el agua, en lo tuyo o en un aliado, la orden va a lo atacable por tierra más cercano; si cae en un país al que irías en barco, solo se desvía a un país con frontera muy cerca (el barco a propósito se respeta). Unos anillos pequeños marcan a dónde va la orden. Un temblor de hasta 10 px sigue siendo un toque, cuenta el punto donde se apoyó el dedo y el toque que frena el mapa en movimiento no ataca. El lienzo mide lo mismo que la pantalla visible (antes, con `100vh`, se veía estirado con la barra del navegador y los toques caían más abajo).
- **Despliegue**: «🎲 Elegir por mí» busca un sitio donde quepa entera la zona inicial, lejos de los polos y con espacio respecto a las demás naciones (entre los que tienen espacio, al azar); las islas demasiado pequeñas salen en sombra y, si no puedes empezar en un sitio, se dice por qué. Los últimos 5 s, cuenta atrás grande y «¡Comienza!».
- **Al perder** (sin conexión): ×1 / ×2 / ×4 en la barra superior para mirar el resto de la partida. Mientras juegas, la partida va siempre a su ritmo.
- **Fin de partida**: la cámara se aleja hasta ver todo el mapa y aparece el resultado sobre él; «Revancha» repite la partida (mapa, rivales y reglas) con otra semilla.

En el mapa, tu frontera es blanca, la de tus aliados verde y los traidores llevan ⚠.

### Los bots

Cada bot tiene personalidad: agresividad, ritmo de expansión, gusto por la
diplomacia y lealtad. Expanden, construyen, se alían con vecinos de su talla y
contra el líder (y le abandonan si pasa del 35 %), envían refuerzos a aliados
atacados, no perdonan una traición y contestan a tus emojis.

## Estructura del código

```
CONQUISTAMUNDIAL/
├── index.html          Menú, HUD y pantalla de fin
├── css/estilo.css
├── servidor.js         Servidor estático para desarrollo (npm start)
├── api/rangos.php      Tabla global de rangos para la web (PHP 8 + PDO; configuración fuera de public_html)
├── api/cuentas.php     Cuentas: registro, entrar, sesiones y perfil con versiones
├── api/comun.php       Piezas comunes de la API (base de datos, respuesta, límites; no se sirve)
├── herramientas/
│   ├── empaquetar.js   Genera dist/dominia.html, todo en un fichero (npm run empaquetar)
│   ├── mapas.js        Genera src/mapas-reales.js desde Natural Earth
│   └── rios.js         Genera src/rios.js (ríos de los mapas reales)
├── src/
│   ├── config.js       ← Números de equilibrio propios (empieza aquí para ajustar)
│   ├── mecanicas.js    ← Fórmulas y valores del documento de mecánicas (tropas, oro, precios, combate, comercio)
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
│   ├── home.js         Pantallas de inicio (modos, selector de mapa, perfil y aspecto, tienda, progreso, ajustes) y sala
│   ├── movimiento.js   Transiciones de la interfaz: mostrar/ocultar, diálogos, cifras que suben, barras, teclado en pestañas
│   ├── guia.js         Guía del juego (diálogo con pestañas)
│   ├── resumen.js      Grabación de la partida (muestras, momentos, fotos del mapa), puesto final y gráficas
│   ├── fin.js          Pantalla de fin: resumen, gráficas, momentos clave, repetición y compartir
│   ├── rangos.js       Ligas, PL, MMR, colocación, escudo, temporadas e insignias
│   ├── ladder.js       Tabla global de rangos (base de datos de Claude o api/rangos.php)
│   ├── cuenta.js       Cuenta en la web: sesión, entrar, crear cuenta y sincronizar el perfil
│   ├── cuenta-ui.js    Interfaz de la cuenta: botón Entrar, diálogo, bloque del perfil y tarjeta
│   ├── identidad.js    Identidad firmada (ECDSA P-256) para las salas clasificatorias
│   ├── reto.js         Retos por enlace («Supera mi partida»)
│   ├── portada.js      Portada animada del inicio
│   ├── minimapa.js     Minimapa de la partida (clic para ir)
│   ├── loading.js      Pantalla de carga
│   ├── tutorial.js     Tutorial guiado
│   ├── banderas.js     GENERADO: sprite de banderas (herramientas/banderas.cjs)
│   ├── profile.js      Perfil, niveles, logros, retos diarios, monedas y tienda
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

## Diagnóstico

Con `?diag=1` en la dirección, la partida registra por turno y por evento (en
unidades internas; al exportar se añaden las visibles): build, versión del
motor, perfil, semilla, reglas, turno, jugador, casillas, reserva y techo,
trabajadores, regeneración, oro pasivo y de eventos, y por cada frente su
objetivo, ancho, presupuesto, tropas enviadas, casillas ganadas, bajas y
reembolso. Se descarga en JSON con **Ctrl+Mayús+D** o
`__trinchera.diag.exportar()`. El identificador de reglas que sirve el hosting
se ve en Ajustes (y en `__trinchera.version`).

## Tests

```bash
cd dominia
npm test
```

Comprueban la generación del mapa, la coherencia de los datos tras miles de
ticks de bots, el determinismo, el despliegue del jugador, los ataques, los
barcos, el oro, los edificios y la diplomacia (que nunca haya ataques entre
aliados, traiciones, envíos, caducidad de propuestas, victoria en alianza).

`tests/especificacion.test.js` reproduce los casos de prueba T01-T14 del
documento de mecánicas (52 casillas, techo 121.410,76, regeneración 330,27 por
turno, 10.000 de oro en 100 turnos, coste 6,6 y 32 bajas en llanura (doc-1.2), 500.000 la
segunda compra compartida…), los criterios de aceptación y una partida simulada
de 5 minutos.

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
