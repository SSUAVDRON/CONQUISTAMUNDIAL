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

## Fase 3 — Diplomacia

- Alianzas (proponer / aceptar / romper, con penalización por traición)
- Los aliados no se atacan y comparten visión del frente
- Bots que forman alianzas contra el líder
- Emojis / mensajes rápidos

## Fase 4 — Guerra naval y armas especiales

- Buques de guerra que hunden barcos de transporte
- Armas de largo alcance que arrasan una zona (caras y con tiempo de carga)
- Defensas antiaéreas

## Fase 5 — Multijugador online

La simulación ya es determinista y funciona por *intents*, así que el modelo
natural es **lockstep**:

1. Servidor Node con WebSocket que solo reenvía intents agrupados por tick
2. Cada cliente ejecuta la misma simulación con la misma semilla
3. Lobby: crear/unirse a salas, partidas públicas y privadas con código
4. Detección de desincronización (checksum del mapa de propietarios cada N ticks)

Riesgo a vigilar: `Math.pow`/`Math.sqrt` pueden diferir en el último bit entre
motores JavaScript. Antes de abrir el multijugador hay que pasar a aritmética
entera (o de punto fijo) en la simulación, o hacer el servidor autoritativo.

## Fase 6 — Pulido

- Mapas del mundo real a partir de datos de dominio público (p. ej. Natural Earth)
- Sonido y música propios
- Estadísticas de fin de partida, repeticiones (gratis gracias al determinismo)
- PWA instalable en móvil
- Cuentas y ranking
