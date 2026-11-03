# Dominia

Juego de estrategia de conquista territorial en el navegador. Empiezas con un
pequeño territorio en un mundo generado al azar y compites contra naciones
controladas por el ordenador por dominar el mundo, casilla a casilla.

Sin dependencias ni paso de compilación: HTML + CSS + JavaScript (módulos ES).

## Jugar en local

```bash
cd dominia
npm start
```

Abre <http://localhost:8080>. (Si prefieres, también funciona con
`python3 -m http.server 8080`. **No** funciona abriendo `index.html` con doble
clic: los módulos ES necesitan servirse por HTTP.)

## Publicarlo en la web (Hostinger u otro hosting)

Son ficheros estáticos. Sube el contenido de `dominia/` (`index.html`, `css/`,
`src/`) a una carpeta del hosting, por ejemplo `public_html/dominia/`, y estará
en `https://tu-dominio/dominia/`. No hace falta PHP ni base de datos.

## Reglas

| Concepto | Cómo funciona |
|---|---|
| Despliegue | Los primeros 10 s haces clic donde quieres empezar (puedes cambiarlo). Si no eliges, se te asigna un sitio. |
| Tropas | Crecen solas. El máximo y la velocidad dependen de tu territorio; cerca del máximo el crecimiento se frena. |
| Atacar | Clic en tierra libre o en una nación vecina: se envía el % de tus tropas que marque **Fuerza de ataque**. Repetir el clic refuerza el ataque. |
| Coste | Tierra libre: 3 tropas por casilla. Naciones: depende de su densidad (tropas ÷ casillas). Mesetas ×1,4 y montañas ×2 en coste y tiempo. |
| Contraataque | Si dos naciones se atacan a la vez, las tropas de ambos ataques se anulan primero. |
| Retirada | El botón ✕ de un ataque lo cancela; vuelve la mitad de sus tropas. |
| Barcos | Clic en una costa sin frontera terrestre: sale un barco desde tu costa más cercana (máx. 3). |
| Victoria | Controlar el 70 % de la tierra, o ser el último en pie. |

### Controles

- **Arrastrar**: mover el mapa · **Rueda / pellizco**: zoom · **WASD / flechas**: desplazarse
- **1–9 / 0**: fuerza de ataque 10 %–100 % · **Mayús + rueda**: ajuste fino
- **Espacio**: pausa · **C**: centrar en tu nación · **+ / −**: zoom
- Clic en la clasificación: centra la cámara en esa nación

## Estructura del código

```
dominia/
├── index.html          Menú, HUD y pantalla de fin
├── css/estilo.css
├── servidor.js         Servidor estático para desarrollo (npm start)
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
│   ├── ui.js           Panel del jugador, clasificación, avisos
│   └── rng.js, noise.js, heap.js, colors.js, names.js, format.js
└── tests/simulacion.test.js
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

## Tests

```bash
cd dominia
npm test
```

Comprueban la generación del mapa, la coherencia de los datos tras miles de
ticks de bots, el determinismo, el despliegue del jugador, los ataques y los
barcos.
