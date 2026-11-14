# Calibración de aperturas

Generado por `node herramientas/aperturas.js` (motor doc-1.9; perfiles clasico-10 / trinchera-9). La partida rápida del menú: el mundo con 90 naciones de la IA en dificultad normal y 299 colonias; semillas 1, 2, 3. Sin pantalla y determinista: para cada semilla, las seis partidas tienen las mismas naciones, colonias y semilla, y solo cambian la salida y las órdenes. 36 partidas en 225 s.

Tropas, techo y banco en cifras del HUD (internas ÷ 10); oro e ingreso pasivo tal cual. «Comprometidas» = tropas en ataques y barcos (ya no defienden). Tiempos en segundos desde el final del despliegue.

**Aperturas**

- **Expansión:** un 25 % de las tropas a tierra libre cada vez que no hay frente abierto; ninguna obra.
- **Economía:** un pueblo en cuanto se puede pagar (en una casilla propia que no sea frontera) y un 15 % a crecer.
- **Banco y defensa:** guarda el 40 % de las tropas en la capital a los 5 s y luego cada 15 s, mejora la capital en cuanto puede (oro y tropas) y un 15 % a crecer.

**Salidas:** «Recomendada» = la del botón «Elegir por mí» (`recommendSpawn`: zona inicial completa, sitio libre, lejos de las naciones); «Al azar» = una casilla válida al azar, repetible por semilla.

## Clásico (clasico-10)

### Salidas

| Semilla | Salida | Zona inicial | Recortes | Terreno | Sitio libre | Nación más cercana | Ataques < 60 s (expansión / economía / banco) |
|---|---|---|---|---|---|---|---|
| 1 | Recomendada | 52/52 | — | llanura 100 % | amplio | 2142 km | 0 / 0 / 0 |
| 1 | Al azar | 32/52 ⚠ | recortada por río 20 | llanura 19 % · meseta 81 % | amplio | 666 km | 0 / 0 / 0 |
| 2 | Recomendada | 52/52 | — | llanura 100 % | amplio | 3255 km | 0 / 0 / 0 |
| 2 | Al azar | 46/52 ⚠ | recortada por río 6 | llanura 100 % | amplio | 3411 km | 0 / 0 / 0 |
| 3 | Recomendada | 52/52 | — | llanura 100 % | amplio | 1857 km | 0 / 0 / 0 |
| 3 | Al azar | 52/52 | — | meseta 94 % · montaña 6 % | amplio | 961 km | 0 / 0 / 0 |

Zonas iniciales incompletas: recomendada 0/3, al azar 2/3.

### Resumen a los 120 s (mediana de las semillas)

| Apertura | Salida | Territorio | Techo | Disponibles | Comprometidas | Banco | Oro | Ingreso | Ataques < 60 s | Primera obra |
|---|---|---|---|---|---|---|---|---|---|---|
| Expansión | Recomendada | 1955 cas. | 28,9k | 28,8k | 0 | 8,3k | 160,7k | 1,4k/s | 0,0 | — |
| Expansión | Al azar | 1422 cas. | 25,6k | 25,6k | 0 | 7,7k | 153,6k | 1,3k/s | 0,0 | — |
| Economía | Recomendada | 1501 cas. | 38,1k | 37,4k | 0 | 4,0k | 67,0k | 2,0k/s | 0,0 | Pueblo (36 s) |
| Economía | Al azar | 939 cas. | 34,2k | 33,5k | 0 | 6,8k | 61,5k | 1,9k/s | 0,0 | Pueblo (36 s) |
| Banco y defensa | Recomendada | 1293 cas. | 24,7k | 24,7k | 0 | 7,4k | 149,5k | 1,3k/s | 0,0 | Mejorar la capital (119 s) |
| Banco y defensa | Al azar | 748 cas. | 20,6k | 20,6k | 0 | 6,2k | 145,1k | 1,2k/s | 0,0 | — |

### Tabla por semilla y apertura

| Semilla | Salida | Apertura | t | Territorio | Techo | Disponibles | Comprometidas | Banco | Oro | Ingreso | Primera obra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Recomendada | Expansión | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 1 | Recomendada | Expansión | 30 s | 908 cas. | 21,9k | 13,0k | 234 | 0 | 34,5k | 1,3k/s | — |
| 1 | Recomendada | Expansión | 60 s | 3436 cas. | 36,5k | 21,9k | 338 | 0 | 76,1k | 1,6k/s | — |
| 1 | Recomendada | Expansión | 120 s | 4754 cas. | 42,2k | 41,7k | 0 | 7,1k | 175,9k | 1,7k/s | — |
| 1 | Recomendada | Economía | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 1 | Recomendada | Economía | 30 s | 552 cas. | 18,8k | 13,2k | 165 | 0 | 33,6k | 1,2k/s | — |
| 1 | Recomendada | Economía | 60 s | 1232 cas. | 30,3k | 25,3k | 0 | 0 | 37,9k | 1,6k/s | Pueblo (36 s) |
| 1 | Recomendada | Economía | 120 s | 3030 cas. | 46,5k | 45,3k | 0 | 797 | 75,1k | 2,1k/s | Pueblo (36 s) |
| 1 | Recomendada | Banco y defensa | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 1 | Recomendada | Banco y defensa | 30 s | 486 cas. | 18,2k | 9,6k | 157 | 4,4k | 33,6k | 1,2k/s | — |
| 1 | Recomendada | Banco y defensa | 60 s | 1027 cas. | 22,8k | 18,8k | 43 | 6,6k | 70,7k | 1,3k/s | — |
| 1 | Recomendada | Banco y defensa | 120 s | 2408 cas. | 31,4k | 29,1k | 0 | 9,4k | 5,6k | 1,5k/s | Mejorar la capital (117 s) |
| 1 | Al azar | Expansión | 0 s | 32 cas. | 11,6k | 2,5k | 0 | 0 | 0 | 1,0k/s | — |
| 1 | Al azar | Expansión | 30 s | 294 cas. | 16,1k | 9,9k | 2,6k | 0 | 32,9k | 1,1k/s | — |
| 1 | Al azar | Expansión | 60 s | 924 cas. | 22,0k | 20,5k | 0 | 0 | 70,4k | 1,3k/s | — |
| 1 | Al azar | Expansión | 120 s | 924 cas. | 22,0k | 22,0k | 0 | 6,6k | 146,8k | 1,3k/s | — |
| 1 | Al azar | Economía | 0 s | 32 cas. | 11,6k | 2,5k | 0 | 0 | 0 | 1,0k/s | — |
| 1 | Al azar | Economía | 30 s | 125 cas. | 13,6k | 12,0k | 0 | 0 | 32,3k | 1,1k/s | — |
| 1 | Al azar | Economía | 60 s | 566 cas. | 25,0k | 22,0k | 45 | 0 | 33,8k | 1,5k/s | Pueblo (37 s) |
| 1 | Al azar | Economía | 120 s | 567 cas. | 31,0k | 30,2k | 0 | 6,8k | 52,3k | 1,8k/s | Pueblo (37 s) |
| 1 | Al azar | Banco y defensa | 0 s | 32 cas. | 11,6k | 2,5k | 0 | 0 | 0 | 1,0k/s | — |
| 1 | Al azar | Banco y defensa | 30 s | 125 cas. | 13,6k | 9,7k | 0 | 4,0k | 32,3k | 1,1k/s | — |
| 1 | Al azar | Banco y defensa | 60 s | 484 cas. | 18,2k | 16,5k | 30 | 5,4k | 67,3k | 1,2k/s | — |
| 1 | Al azar | Banco y defensa | 120 s | 487 cas. | 18,2k | 18,2k | 0 | 5,5k | 138,9k | 1,2k/s | — |
| 2 | Recomendada | Expansión | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Recomendada | Expansión | 30 s | 935 cas. | 22,1k | 14,1k | 64 | 0 | 35,0k | 1,3k/s | — |
| 2 | Recomendada | Expansión | 60 s | 1955 cas. | 28,9k | 25,7k | 0 | 0 | 75,9k | 1,4k/s | — |
| 2 | Recomendada | Expansión | 120 s | 1955 cas. | 28,9k | 28,8k | 0 | 8,7k | 160,7k | 1,4k/s | — |
| 2 | Recomendada | Economía | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Recomendada | Economía | 30 s | 600 cas. | 19,3k | 13,7k | 36 | 0 | 33,9k | 1,2k/s | — |
| 2 | Recomendada | Economía | 60 s | 1296 cas. | 30,7k | 26,7k | 82 | 0 | 39,3k | 1,6k/s | Pueblo (35 s) |
| 2 | Recomendada | Economía | 120 s | 1311 cas. | 36,8k | 36,3k | 0 | 7,1k | 67,0k | 1,9k/s | Pueblo (35 s) |
| 2 | Recomendada | Banco y defensa | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Recomendada | Banco y defensa | 30 s | 526 cas. | 18,6k | 9,7k | 27 | 4,6k | 33,8k | 1,2k/s | — |
| 2 | Recomendada | Banco y defensa | 60 s | 1047 cas. | 23,0k | 19,9k | 50 | 6,8k | 71,9k | 1,3k/s | — |
| 2 | Recomendada | Banco y defensa | 120 s | 1049 cas. | 23,0k | 23,0k | 0 | 6,9k | 149,5k | 1,3k/s | — |
| 2 | Al azar | Expansión | 0 s | 46 cas. | 12,0k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Al azar | Expansión | 30 s | 644 cas. | 19,7k | 11,2k | 1,4k | 0 | 33,6k | 1,2k/s | — |
| 2 | Al azar | Expansión | 60 s | 1417 cas. | 25,6k | 21,2k | 3,2k | 0 | 72,8k | 1,3k/s | — |
| 2 | Al azar | Expansión | 120 s | 1422 cas. | 25,6k | 25,6k | 0 | 7,7k | 153,6k | 1,3k/s | — |
| 2 | Al azar | Economía | 0 s | 46 cas. | 12,0k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Al azar | Economía | 30 s | 369 cas. | 16,9k | 11,4k | 986 | 0 | 32,9k | 1,2k/s | — |
| 2 | Al azar | Economía | 60 s | 1125 cas. | 29,5k | 23,7k | 1,1k | 0 | 36,5k | 1,6k/s | Pueblo (36 s) |
| 2 | Al azar | Economía | 120 s | 1135 cas. | 35,6k | 34,9k | 0 | 6,1k | 61,8k | 1,9k/s | Pueblo (36 s) |
| 2 | Al azar | Banco y defensa | 0 s | 46 cas. | 12,0k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Al azar | Banco y defensa | 30 s | 327 cas. | 16,5k | 9,0k | 656 | 4,2k | 32,9k | 1,2k/s | — |
| 2 | Al azar | Banco y defensa | 60 s | 985 cas. | 22,5k | 17,8k | 467 | 6,4k | 69,5k | 1,3k/s | — |
| 2 | Al azar | Banco y defensa | 120 s | 1021 cas. | 22,8k | 22,8k | 0 | 6,8k | 146,9k | 1,3k/s | — |
| 3 | Recomendada | Expansión | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Recomendada | Expansión | 30 s | 814 cas. | 21,2k | 12,9k | 755 | 0 | 34,4k | 1,3k/s | — |
| 3 | Recomendada | Expansión | 60 s | 1644 cas. | 27,0k | 19,0k | 3,4k | 0 | 73,2k | 1,4k/s | — |
| 3 | Recomendada | Expansión | 120 s | 1730 cas. | 27,5k | 27,5k | 0 | 8,3k | 156,4k | 1,4k/s | — |
| 3 | Recomendada | Economía | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Recomendada | Economía | 30 s | 559 cas. | 18,9k | 13,4k | 167 | 0 | 33,8k | 1,2k/s | — |
| 3 | Recomendada | Economía | 60 s | 1399 cas. | 31,4k | 24,7k | 385 | 0 | 37,7k | 1,6k/s | Pueblo (36 s) |
| 3 | Recomendada | Economía | 120 s | 1501 cas. | 38,1k | 37,4k | 0 | 4,0k | 66,6k | 2,0k/s | Pueblo (36 s) |
| 3 | Recomendada | Banco y defensa | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Recomendada | Banco y defensa | 30 s | 494 cas. | 18,3k | 9,7k | 129 | 4,6k | 33,7k | 1,2k/s | — |
| 3 | Recomendada | Banco y defensa | 60 s | 1165 cas. | 23,8k | 18,8k | 194 | 6,5k | 70,9k | 1,3k/s | — |
| 3 | Recomendada | Banco y defensa | 120 s | 1293 cas. | 24,7k | 24,7k | 0 | 7,4k | 150,4k | 1,3k/s | Mejorar la capital (120 s) |
| 3 | Al azar | Expansión | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Al azar | Expansión | 30 s | 760 cas. | 20,7k | 13,6k | 33 | 0 | 34,6k | 1,2k/s | — |
| 3 | Al azar | Expansión | 60 s | 1607 cas. | 26,8k | 24,1k | 0 | 0 | 74,8k | 1,4k/s | — |
| 3 | Al azar | Expansión | 120 s | 1607 cas. | 26,8k | 26,8k | 0 | 8,0k | 157,0k | 1,4k/s | — |
| 3 | Al azar | Economía | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Al azar | Economía | 30 s | 463 cas. | 18,0k | 13,5k | 18 | 0 | 33,7k | 1,2k/s | — |
| 3 | Al azar | Economía | 60 s | 939 cas. | 28,2k | 25,1k | 0 | 0 | 37,7k | 1,6k/s | Pueblo (36 s) |
| 3 | Al azar | Economía | 120 s | 939 cas. | 34,2k | 33,5k | 0 | 7,9k | 61,5k | 1,9k/s | Pueblo (36 s) |
| 3 | Al azar | Banco y defensa | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Al azar | Banco y defensa | 30 s | 396 cas. | 17,2k | 9,6k | 14 | 4,7k | 33,5k | 1,2k/s | — |
| 3 | Al azar | Banco y defensa | 60 s | 748 cas. | 20,6k | 18,6k | 0 | 6,2k | 70,4k | 1,2k/s | — |
| 3 | Al azar | Banco y defensa | 120 s | 748 cas. | 20,6k | 20,6k | 0 | 6,2k | 145,1k | 1,2k/s | — |

## Trinchera (trinchera-9)

### Salidas

| Semilla | Salida | Zona inicial | Recortes | Terreno | Sitio libre | Nación más cercana | Ataques < 60 s (expansión / economía / banco) |
|---|---|---|---|---|---|---|---|
| 1 | Recomendada | 52/52 | — | llanura 100 % | amplio | 2142 km | 0 / 0 / 0 |
| 1 | Al azar | 32/52 ⚠ | recortada por río 20 | llanura 19 % · meseta 81 % | amplio | 666 km | 0 / 0 / 0 |
| 2 | Recomendada | 52/52 | — | llanura 100 % | amplio | 3255 km | 0 / 0 / 0 |
| 2 | Al azar | 46/52 ⚠ | recortada por río 6 | llanura 100 % | amplio | 3411 km | 0 / 0 / 0 |
| 3 | Recomendada | 52/52 | — | llanura 100 % | amplio | 1857 km | 0 / 0 / 0 |
| 3 | Al azar | 52/52 | — | meseta 94 % · montaña 6 % | amplio | 961 km | 0 / 0 / 0 |

Zonas iniciales incompletas: recomendada 0/3, al azar 2/3.

### Resumen a los 120 s (mediana de las semillas)

| Apertura | Salida | Territorio | Techo | Disponibles | Comprometidas | Banco | Oro | Ingreso | Ataques < 60 s | Primera obra |
|---|---|---|---|---|---|---|---|---|---|---|
| Expansión | Recomendada | 1255 cas. | 24,5k | 22,1k | 65 | 0 | 148,3k | 1,4k/s | 0,0 | — |
| Expansión | Al azar | 1004 cas. | 22,6k | 17,6k | 2,2k | 1,4k | 143,4k | 1,4k/s | 0,0 | — |
| Economía | Recomendada | 901 cas. | 33,9k | 29,7k | 97 | 0 | 59,0k | 2,0k/s | 0,0 | Pueblo (36 s) |
| Economía | Al azar | 741 cas. | 32,5k | 25,9k | 804 | 0 | 53,9k | 1,9k/s | 0,0 | Pueblo (36 s) |
| Banco y defensa | Recomendada | 708 cas. | 20,3k | 18,6k | 113 | 6,0k | 143,8k | 1,3k/s | 0,0 | — |
| Banco y defensa | Al azar | 597 cas. | 19,3k | 15,6k | 1,4k | 5,4k | 139,6k | 1,3k/s | 0,0 | — |

### Tabla por semilla y apertura

| Semilla | Salida | Apertura | t | Territorio | Techo | Disponibles | Comprometidas | Banco | Oro | Ingreso | Primera obra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Recomendada | Expansión | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 1 | Recomendada | Expansión | 30 s | 213 cas. | 15,0k | 9,6k | 113 | 0 | 34,6k | 1,2k/s | — |
| 1 | Recomendada | Expansión | 60 s | 244 cas. | 15,4k | 14,2k | 13 | 0 | 70,1k | 1,2k/s | — |
| 1 | Recomendada | Expansión | 120 s | 1255 cas. | 24,5k | 22,1k | 51 | 0 | 148,3k | 1,4k/s | — |
| 1 | Recomendada | Economía | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 1 | Recomendada | Economía | 30 s | 144 cas. | 13,9k | 9,5k | 84 | 0 | 34,1k | 1,2k/s | — |
| 1 | Recomendada | Economía | 60 s | 166 cas. | 20,3k | 16,8k | 13 | 0 | 35,5k | 1,5k/s | Pueblo (36 s) |
| 1 | Recomendada | Economía | 120 s | 901 cas. | 33,9k | 29,2k | 97 | 0 | 58,0k | 2,0k/s | Pueblo (36 s) |
| 1 | Recomendada | Banco y defensa | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 1 | Recomendada | Banco y defensa | 30 s | 144 cas. | 13,9k | 6,0k | 84 | 3,5k | 34,1k | 1,2k/s | — |
| 1 | Recomendada | Banco y defensa | 60 s | 166 cas. | 14,3k | 11,9k | 13 | 4,3k | 68,8k | 1,2k/s | — |
| 1 | Recomendada | Banco y defensa | 120 s | 687 cas. | 20,1k | 17,9k | 113 | 5,9k | 142,7k | 1,3k/s | — |
| 1 | Al azar | Expansión | 0 s | 32 cas. | 11,6k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 1 | Al azar | Expansión | 30 s | 123 cas. | 13,6k | 9,1k | 266 | 0 | 33,7k | 1,1k/s | — |
| 1 | Al azar | Expansión | 60 s | 170 cas. | 14,4k | 13,2k | 78 | 0 | 68,4k | 1,2k/s | — |
| 1 | Al azar | Expansión | 120 s | 535 cas. | 18,7k | 15,2k | 2,2k | 2,5k | 139,5k | 1,3k/s | — |
| 1 | Al azar | Economía | 0 s | 32 cas. | 11,6k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 1 | Al azar | Economía | 30 s | 83 cas. | 12,8k | 9,1k | 176 | 0 | 33,4k | 1,1k/s | — |
| 1 | Al azar | Economía | 60 s | 110 cas. | 19,4k | 16,0k | 68 | 0 | 34,0k | 1,5k/s | Pueblo (36 s) |
| 1 | Al azar | Economía | 120 s | 334 cas. | 28,5k | 23,0k | 2,3k | 0 | 50,3k | 1,8k/s | Pueblo (36 s) |
| 1 | Al azar | Banco y defensa | 0 s | 32 cas. | 11,6k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 1 | Al azar | Banco y defensa | 30 s | 83 cas. | 12,8k | 5,8k | 176 | 3,4k | 33,4k | 1,1k/s | — |
| 1 | Al azar | Banco y defensa | 60 s | 110 cas. | 13,4k | 11,3k | 68 | 4,0k | 67,4k | 1,1k/s | — |
| 1 | Al azar | Banco y defensa | 120 s | 281 cas. | 15,9k | 13,5k | 1,4k | 4,4k | 136,5k | 1,2k/s | — |
| 2 | Recomendada | Expansión | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Recomendada | Expansión | 30 s | 214 cas. | 15,0k | 9,6k | 107 | 0 | 34,6k | 1,2k/s | — |
| 2 | Recomendada | Expansión | 60 s | 247 cas. | 15,5k | 14,2k | 0 | 0 | 70,1k | 1,2k/s | — |
| 2 | Recomendada | Expansión | 120 s | 1337 cas. | 25,0k | 23,5k | 65 | 0 | 151,2k | 1,4k/s | — |
| 2 | Recomendada | Economía | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Recomendada | Economía | 30 s | 143 cas. | 13,9k | 9,5k | 84 | 0 | 34,1k | 1,2k/s | — |
| 2 | Recomendada | Economía | 60 s | 169 cas. | 20,3k | 16,8k | 1 | 0 | 35,5k | 1,5k/s | Pueblo (36 s) |
| 2 | Recomendada | Economía | 120 s | 958 cas. | 34,3k | 30,8k | 44 | 0 | 61,2k | 2,0k/s | Pueblo (36 s) |
| 2 | Recomendada | Banco y defensa | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Recomendada | Banco y defensa | 30 s | 143 cas. | 13,9k | 6,0k | 84 | 3,5k | 34,1k | 1,2k/s | — |
| 2 | Recomendada | Banco y defensa | 60 s | 169 cas. | 14,3k | 11,9k | 1 | 4,3k | 68,8k | 1,2k/s | — |
| 2 | Recomendada | Banco y defensa | 120 s | 734 cas. | 20,5k | 19,3k | 22 | 6,1k | 145,0k | 1,3k/s | — |
| 2 | Al azar | Expansión | 0 s | 46 cas. | 12,0k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Al azar | Expansión | 30 s | 170 cas. | 14,4k | 9,4k | 219 | 0 | 34,2k | 1,2k/s | — |
| 2 | Al azar | Expansión | 60 s | 217 cas. | 15,0k | 13,8k | 56 | 0 | 69,4k | 1,2k/s | — |
| 2 | Al azar | Expansión | 120 s | 1004 cas. | 22,6k | 18,3k | 924 | 1,4k | 143,4k | 1,4k/s | — |
| 2 | Al azar | Economía | 0 s | 46 cas. | 12,0k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Al azar | Economía | 30 s | 117 cas. | 13,5k | 9,4k | 151 | 0 | 33,8k | 1,1k/s | — |
| 2 | Al azar | Economía | 60 s | 147 cas. | 20,0k | 16,5k | 48 | 0 | 34,9k | 1,5k/s | Pueblo (36 s) |
| 2 | Al azar | Economía | 120 s | 741 cas. | 32,5k | 25,9k | 804 | 0 | 53,9k | 1,9k/s | Pueblo (36 s) |
| 2 | Al azar | Banco y defensa | 0 s | 46 cas. | 12,0k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 2 | Al azar | Banco y defensa | 30 s | 117 cas. | 13,5k | 5,9k | 151 | 3,5k | 33,8k | 1,1k/s | — |
| 2 | Al azar | Banco y defensa | 60 s | 147 cas. | 14,0k | 11,7k | 48 | 4,2k | 68,3k | 1,2k/s | — |
| 2 | Al azar | Banco y defensa | 120 s | 599 cas. | 19,3k | 15,6k | 468 | 5,4k | 139,6k | 1,3k/s | — |
| 3 | Recomendada | Expansión | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Recomendada | Expansión | 30 s | 209 cas. | 14,9k | 9,6k | 123 | 0 | 34,6k | 1,2k/s | — |
| 3 | Recomendada | Expansión | 60 s | 242 cas. | 15,4k | 14,2k | 17 | 0 | 70,1k | 1,2k/s | — |
| 3 | Recomendada | Expansión | 120 s | 1130 cas. | 23,6k | 20,9k | 868 | 0 | 146,9k | 1,4k/s | — |
| 3 | Recomendada | Economía | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Recomendada | Economía | 30 s | 142 cas. | 13,9k | 9,5k | 87 | 0 | 34,1k | 1,2k/s | — |
| 3 | Recomendada | Economía | 60 s | 167 cas. | 20,3k | 16,8k | 7 | 0 | 35,4k | 1,5k/s | Pueblo (36 s) |
| 3 | Recomendada | Economía | 120 s | 898 cas. | 33,8k | 29,7k | 304 | 0 | 59,0k | 2,0k/s | Pueblo (36 s) |
| 3 | Recomendada | Banco y defensa | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Recomendada | Banco y defensa | 30 s | 142 cas. | 13,9k | 6,0k | 87 | 3,5k | 34,1k | 1,2k/s | — |
| 3 | Recomendada | Banco y defensa | 60 s | 167 cas. | 14,3k | 11,9k | 7 | 4,3k | 68,8k | 1,2k/s | — |
| 3 | Recomendada | Banco y defensa | 120 s | 708 cas. | 20,3k | 18,6k | 155 | 6,0k | 143,8k | 1,3k/s | — |
| 3 | Al azar | Expansión | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Al azar | Expansión | 30 s | 182 cas. | 14,5k | 9,5k | 99 | 0 | 34,4k | 1,2k/s | — |
| 3 | Al azar | Expansión | 60 s | 344 cas. | 16,7k | 11,1k | 2,8k | 0 | 69,6k | 1,2k/s | — |
| 3 | Al azar | Expansión | 120 s | 1119 cas. | 23,5k | 17,6k | 5,3k | 0 | 149,6k | 1,4k/s | — |
| 3 | Al azar | Economía | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Al azar | Economía | 30 s | 124 cas. | 13,6k | 9,4k | 81 | 0 | 33,9k | 1,1k/s | — |
| 3 | Al azar | Economía | 60 s | 213 cas. | 21,0k | 14,4k | 2,1k | 0 | 35,1k | 1,5k/s | Pueblo (36 s) |
| 3 | Al azar | Economía | 120 s | 749 cas. | 32,6k | 29,8k | 0 | 0 | 59,9k | 1,9k/s | Pueblo (36 s) |
| 3 | Al azar | Banco y defensa | 0 s | 52 cas. | 12,1k | 2,5k | 0 | 0 | 0 | 1,1k/s | — |
| 3 | Al azar | Banco y defensa | 30 s | 124 cas. | 13,6k | 5,9k | 81 | 3,5k | 33,9k | 1,1k/s | — |
| 3 | Al azar | Banco y defensa | 60 s | 201 cas. | 14,8k | 10,3k | 1,5k | 4,2k | 68,5k | 1,2k/s | — |
| 3 | Al azar | Banco y defensa | 120 s | 597 cas. | 19,3k | 16,1k | 2,6k | 5,7k | 143,6k | 1,3k/s | — |

## Cómo leerlo

- Antes de cambiar un multiplicador, se vuelve a generar este informe con las mismas semillas y se comparan las tres aperturas: un cambio de fórmula dice qué medida quiere corregir (por ejemplo, el territorio de la expansión a los 60 s) y qué les pasa a las otras dos.
- La amortización que muestran las fichas (coste ÷ oro por segundo, más el tiempo de obra) es orientativa: con +300/s y 40k, el pueblo se paga en ~133 s de funcionamiento. La columna «Ingreso» de la apertura de economía muestra cuánto suben de verdad los pueblos en estas partidas.
- Los ataques que entran antes del primer minuto y las zonas incompletas comparan las salidas recomendadas con las de al azar en las mismas partidas.

