# Calibración del perfil Clásico

Generado por `node herramientas/calibrar.js` (motor doc-1.0, perfiles clasico-1 / trinchera-1). Simulaciones sin pantalla, deterministas; semillas 1, 2, 3 (las mismas para cada valor de cada barrido). Cifras «visibles» = internas ÷ 10, como en el HUD.

Referencias de FrontWars: lecturas del HUD recogidas en la auditoría técnica (9-nov-2026). No se ha jugado FrontWars para este informe.

## A. Regeneración a igual reserva y techo

Varias lecturas de FrontWars se tomaron durante la expansión, así que no se compara la serie en el tiempo: para cada pareja reserva/techo leída en su HUD se calcula la tasa de Trinchera **con esa misma reserva y ese techo** (×10 internos), por el mismo camino que usa el juego (`Player.growthPerTick`, sin bonos), y se compara con lo que mostraba su HUD.

| Reserva / techo (visibles) | HUD FrontWars | Clásico (paceRegen 1) | Desvío | Trinchera (0,6) |
|---|---|---|---|---|
| 5890 / 12.100 | 395/s | 394,6/s | -0,1 % | 236,7/s |
| 6030 / 13.600 | 436/s | 435,2/s | -0,2 % | 261,1/s |
| 8020 / 19.200 | 560/s | 559,3/s | -0,1 % | 335,6/s |
| 12.500 / 23.300 | 613/s | 613,8/s | +0,1 % | 368,3/s |
| 15.200 / 25.400 | 611/s | 612,8/s | +0,3 % | 367,7/s |

**Resultado:** las cinco lecturas quedan dentro de ±5 % (o del redondeo del HUD) con `paceRegen = 1` y sin bonos. **Se cierra paceRegen = 1 en Clásico.**

Curva en reposo con 52 casillas (techo 12.141 visibles): la tasa crece hasta ~42 % del techo y tiende a 0 al llenarse.

| Ocupación del techo | Clásico (visibles/s) |
|---|---|
| 20 % | 325,9 |
| 40 % | 401,5 |
| 60 % | 358,5 |
| 80 % | 220,6 |
| 95 % | 62,5 |
| 100 % | 0,0 |

## B. Reposo (sin atacar ni construir)

Humano solo en el mundo, tierra adentro; tiempo desde el final del despliegue.

**Clásico** (clasico-1)

| t | Reserva | Techo | Regeneración | Oro | Oro pasivo |
|---|---|---|---|---|---|
| 0 s | 2500 | 12.141 | 330/s | 0 | 1000/s |
| 5 s | 4343 | 12.141 | 397/s | 5000 | 1000/s |
| 10 s | 6334 | 12.141 | 387/s | 10.000 | 1000/s |
| 20 s | 9519 | 12.141 | 235/s | 20.000 | 1000/s |
| 30 s | 11.138 | 12.141 | 101/s | 30.000 | 1000/s |
| 60 s | 12.099 | 12.141 | 5/s | 60.000 | 1000/s |
| 90 s | 12.139 | 12.141 | 0/s | 90.000 | 1000/s |
| 120 s | 12.141 | 12.141 | 0/s | 120.000 | 1000/s |

**Trinchera** (trinchera-1)

| t | Reserva | Techo | Regeneración | Oro | Oro pasivo |
|---|---|---|---|---|---|
| 0 s | 2500 | 12.141 | 208/s | 0 | 1050/s |
| 5 s | 3625 | 12.141 | 240/s | 5250 | 1050/s |
| 10 s | 4864 | 12.141 | 253/s | 10.500 | 1050/s |
| 20 s | 7308 | 12.141 | 225/s | 21.000 | 1050/s |
| 30 s | 9248 | 12.141 | 160/s | 31.500 | 1050/s |
| 60 s | 11.690 | 12.141 | 30/s | 63.000 | 1050/s |
| 90 s | 12.080 | 12.141 | 4/s | 94.500 | 1050/s |
| 120 s | 12.133 | 12.141 | 1/s | 126.000 | 1050/s |

En Clásico el oro pasivo es exactamente 1000/s (sin bono de capital: el perfil no tiene puntos estratégicos), como las lecturas de FrontWars (8,90k a 9 s, 35,1k a 35 s, 53,7k a 53 s).

## C. Tierra libre (PROVISIONAL)

Barrido de `paceNeutral` con las mismas 3 semillas para cada valor. Terreno alrededor de cada despliegue (llanura / meseta / montaña): semilla 1: 82 / 12 / 6 %; semilla 2: 99 / 1 / 0 %; semilla 3: 100 / 0 / 0 %. Coste por casilla y bajas sin tocar (documento). Tiempos en segundos desde el clic; «no llega» = ese frente se agotó antes.

### Muestra comparable con FrontWars: ~1,27k visibles (12.700 internas) en el frente

En FrontWars, tras el primer clic había ~1,27k en el frente a 0:13 y 202 a 0:17; del cambio de techo (13,6k → 19,2k) la auditoría deduce **~467 casillas en 4 s**. Es un indicador indirecto (supone la misma fórmula de techo): orienta el barrido, no cierra el valor.

| paceNeutral | Casillas a los 4 s | 100 cas. (s) | 250 cas. (s) | 500 cas. (s) | Fin del frente (s) | Casillas al acabar |
|---|---|---|---|---|---|---|
| 0,07 | 32 [32–33] | 10,0 [9,8–10,1] | 19,8 [19,5–19,9] | 32,7 [32,3–32,8] | 86,8 [85,3–86,8] | 804 [790–805] |
| 0,25 | 158 [155–161] | 2,9 [2,8–2,9] | 5,6 [5,6–5,7] | 9,3 [9,2–9,3] | 24,4 [24,0–24,5] | 795 [784–800] |
| 0,50 | 416 [412–421] | 1,5 [1,4–1,5] | 2,8 [2,8–2,9] | 4,7 [4,7–4,7] | 12,3 [12,1–12,4] | 794 [782–803] |
| 0,75 | 628 [620–635] | 1,0 [1,0–1,0] | 1,9 [1,9–2,0] | 3,2 [3,1–3,2] | 8,2 [8,1–8,2] | 795 [780–798] |
| 1,00 | 730 [717–732] | 0,8 [0,8–0,8] | 1,5 [1,5–1,5] | 2,4 [2,4–2,4] | 6,2 [6,1–6,2] | 795 [783–796] |

Valor más cercano al indicador de FrontWars: **paceNeutral = 0,50** (416 casillas a los 4 s frente a ~467). Queda como **provisional**.

Segundo indicador, también indirecto: el frente de FrontWars pasó de ~1,27k a 202 visibles en esos 4 s (~1,07k gastadas). Con las bajas por casilla del documento (1,6 / 2 / 2,4 visibles en llanura / meseta / montaña) serían ~670 / ~535 / ~445 casillas según el terreno, que no se conoce. Los dos indicadores se solapan hacia ~450–500 casillas, lo que también apunta a 0,5; con terreno llano, a 0,75–1. Hace falta la medición directa de la lista final para cerrarlo.

### Envíos al 10, 20 y 40 % de la reserva en t = 5 s

**10 %**

| paceNeutral | Enviadas (vis.) | 100 cas. (s) | 250 cas. (s) | 500 cas. (s) | Fin (s) | Casillas | Bajas (vis.) |
|---|---|---|---|---|---|---|---|
| 0,07 | 434 | 18,3 [17,8–18,7] | 68,4 [66,1–70,6] | no llega | no llega | 270 [266–274] | 443 |
| 0,25 | 434 | 5,2 [5,1–5,3] | 19,6 [19,5–19,9] | no llega | 26,9 [26,5–27,2] | 274 [273–274] | 434 |
| 0,50 | 434 | 2,6 [2,6–2,7] | 10,0 [9,8–10,0] | no llega | 13,5 [13,3–13,7] | 273 [273–274] | 434 |
| 0,75 | 434 | 1,8 [1,8–1,8] | 6,7 [6,5–6,8] | no llega | 9,0 [8,9–9,2] | 273 [272–275] | 434 |
| 1,00 | 434 | 1,4 [1,4–1,4] | 5,1 [5,0–5,1] | no llega | 6,8 [6,8–6,9] | 272 [271–274] | 434 |

**20 %**

| paceNeutral | Enviadas (vis.) | 100 cas. (s) | 250 cas. (s) | 500 cas. (s) | Fin (s) | Casillas | Bajas (vis.) |
|---|---|---|---|---|---|---|---|
| 0,07 | 869 | 10,0 [9,8–10,1] | 21,1 [20,9–21,2] | 55,7 [54,4–56,4] | 86,5 [85,8–87,5] | 548 [544–550] | 869 |
| 0,25 | 869 | 2,9 [2,8–2,9] | 6,0 [6,0–6,0] | 16,0 [15,7–16,1] | 24,3 [24,3–24,6] | 546 [541–547] | 869 |
| 0,50 | 869 | 1,5 [1,5–1,5] | 3,0 [3,0–3,1] | 8,2 [8,1–8,2] | 12,3 [12,2–12,4] | 542 [539–546] | 869 |
| 0,75 | 869 | 1,0 [1,0–1,0] | 2,1 [2,1–2,1] | 5,5 [5,4–5,6] | 8,2 [8,2–8,3] | 542 [539–544] | 869 |
| 1,00 | 869 | 0,8 [0,8–0,8] | 1,6 [1,6–1,6] | 4,2 [4,1–4,2] | 6,2 [6,2–6,3] | 542 [538–543] | 869 |

**40 %**

| paceNeutral | Enviadas (vis.) | 100 cas. (s) | 250 cas. (s) | 500 cas. (s) | Fin (s) | Casillas | Bajas (vis.) |
|---|---|---|---|---|---|---|---|
| 0,07 | 1737 | 10,0 [9,8–10,1] | 19,8 [19,5–19,9] | 31,6 [31,4–31,9] | 88,7 [87,2–89,2] | 1101 [1079–1102] | 1737 |
| 0,25 | 1737 | 2,9 [2,8–2,9] | 5,6 [5,6–5,7] | 9,0 [8,9–9,0] | 25,0 [24,5–25,2] | 1091 [1068–1093] | 1737 |
| 0,50 | 1737 | 1,5 [1,4–1,5] | 2,8 [2,8–2,9] | 4,6 [4,5–4,6] | 12,5 [12,4–12,7] | 1090 [1066–1091] | 1737 |
| 0,75 | 1737 | 1,0 [1,0–1,0] | 1,9 [1,9–2,0] | 3,1 [3,1–3,1] | 8,4 [8,3–8,5] | 1088 [1063–1091] | 1737 |
| 1,00 | 1737 | 0,8 [0,8–0,8] | 1,5 [1,5–1,5] | 2,3 [2,3–2,4] | 6,3 [6,3–6,4] | 1087 [1061–1088] | 1737 |

### Variantes al 20 %: segundo envío y cancelación a los 5 s del clic

| paceNeutral | Dos envíos: 500 cas. (s) | Dos envíos: fin (s) | Dos envíos: casillas | Cancelado: casillas | Cancelado: bajas (vis.) |
|---|---|---|---|---|---|
| 0,07 | 31,6 [31,4–31,9] | 88,5 [86,1–88,8] | 992 [970–993] | 42 [42–42] | 67 |
| 0,25 | 9,2 [9,1–9,2] | 25,0 [24,4–25,1] | 984 [960–985] | 207 [202–208] | 331 |
| 0,50 | 5,7 [5,7–5,7] | 13,7 [13,2–13,7] | 978 [962–986] | 395 [394–397] | 632 |
| 0,75 | 5,1 [5,1–5,1] | 10,4 [10,1–10,4] | 980 [960–984] | 486 [485–488] | 778 |
| 1,00 | 4,2 [4,1–4,2] | 8,9 [8,7–9,0] | 979 [958–980] | 521 [519–522] | 835 |

## D. Contacto y retirada (PROVISIONAL)

Dos países vecinos en terreno llano fijo (mapa generado con toda la tierra en llanura); el defensor tiene ~1500 casillas y no regenera. Se ataca con 20.000 internas (2.000 visibles); D/A = tropas del defensor ÷ las enviadas. Se mide a los 10 s (o al acabarse el frente).

| pacePvp | D/A | Defensor | Primera casilla (s) | Casillas a los 2 s | Fin del frente (s) | Casillas al acabar | Bajas atacante (vis.) | Bajas defensor (vis.) |
|---|---|---|---|---|---|---|---|---|
| 0,5 | 0,5 | nación | 0,1 [0,1–0,1] | 363 [357–401] | 6,1 [5,1–7,1] | 613 [609–623] | 2000 | 355 |
| 0,5 | 0,5 | nación + puesto | 0,1 [0,1–0,1] | 315 [311–373] | 5,6 [4,6–5,6] | 559 [552–578] | 2000 | 320 |
| 0,5 | 0,5 | colonia | 0,1 [0,1–0,1] | 363 [357–401] | 6,1 [5,1–7,1] | 613 [609–623] | 2000 | 355 |
| 0,5 | 1,0 | nación | 0,1 [0,1–0,1] | 221 [219–230] | 6,5 [5,8–7,8] | 319 [318–320] | 2000 | 370 |
| 0,5 | 1,0 | nación + puesto | 0,1 [0,1–0,1] | 169 [169–203] | 7,2 [6,7–7,9] | 266 [264–294] | 2000 | 320 |
| 0,5 | 1,0 | colonia | 0,1 [0,1–0,1] | 221 [219–230] | 6,5 [5,8–7,8] | 319 [318–320] | 2000 | 370 |
| 0,5 | 2,0 | nación | 0,1 [0,1–0,1] | 112 [111–115] | 9,7 [9,5–9,9] · no llega 1/3 | 225 [221–228] | 2000 | 521 |
| 0,5 | 2,0 | nación + puesto | 0,1 [0,1–0,1] | 64 [64–91] | 9,7 · no llega 2/3 | 177 [173–204] | 1998 | 444 |
| 0,5 | 2,0 | colonia | 0,1 [0,1–0,1] | 112 [111–115] | 9,7 [9,5–9,9] · no llega 1/3 | 225 [221–228] | 2000 | 521 |
| 1,0 | 0,5 | nación | 0,1 [0,1–0,1] | 609 [607–613] | 2,9 [2,3–3,4] | 614 [609–624] | 2000 | 355 |
| 1,0 | 0,5 | nación + puesto | 0,1 [0,1–0,1] | 547 [545–578] | 2,5 [2,1–2,7] | 559 [552–578] | 2000 | 320 |
| 1,0 | 0,5 | colonia | 0,1 [0,1–0,1] | 609 [607–613] | 2,9 [2,3–3,4] | 614 [609–624] | 2000 | 355 |
| 1,0 | 1,0 | nación | 0,1 [0,1–0,1] | 297 [295–306] | 3,2 [2,9–3,8] | 319 [318–320] | 2000 | 370 |
| 1,0 | 1,0 | nación + puesto | 0,1 [0,1–0,1] | 242 [241–278] | 3,6 [3,4–3,9] | 266 [264–294] | 2000 | 320 |
| 1,0 | 1,0 | colonia | 0,1 [0,1–0,1] | 297 [295–306] | 3,2 [2,9–3,8] | 319 [318–320] | 2000 | 370 |
| 1,0 | 2,0 | nación | 0,1 [0,1–0,1] | 169 [168–176] | 5,0 [4,8–5,5] | 225 [221–228] | 2000 | 521 |
| 1,0 | 2,0 | nación + puesto | 0,1 [0,1–0,1] | 121 [119–150] | 5,1 [4,9–5,5] | 177 [173–204] | 2000 | 444 |
| 1,0 | 2,0 | colonia | 0,1 [0,1–0,1] | 169 [168–176] | 5,0 [4,8–5,5] | 225 [221–228] | 2000 | 521 |

El ritmo (pacePvp) cambia cuánto tarda el frente, no cuántas casillas gana: con estas cifras el ataque se agota por bajas. En el motor, colonia y nación se resuelven igual (OpenFront aplica ×0,7 a la magnitud contra bots; no está implementado sin medirlo en FrontWars).

Retirada a 1 s del clic (D/A = 1, nación), pacePvp 1: vuelve el 75 % de lo que sigue en el frente.

| Semilla | Casillas ganadas | Vuelven (vis.) | Perdidas: combate + 25 % (vis.) |
|---|---|---|---|
| 1 | 223 | 587 | 1413 |
| 2 | 232 | 539 | 1461 |
| 3 | 220 | 609 | 1391 |

En FrontWars se vio un ataque a Wolof Area con ~2.470 enviados contra ~2.490 de reserva (D/A ≈ 1) que avanzó la frontera y se cerró antes de 5 s. Aquí, con D/A = 1, el frente se cierra hacia los ~4 s con pacePvp 1 y hacia los ~8 s con 0,5: lo visto es compatible con 1. Pero sin el terreno, el tramo ni las bajas de esa muestra no se puede cerrar `pacePvp`: **1 queda como ensayo provisional**.

## E. Primera ciudad (sin comercio ni conquistas)

| Perfil | Precio | Se puede pagar a | Obra | Terminada a | Techo (vis.) |
|---|---|---|---|---|---|
| Clásico | 125.000 | 125,0 s | 5,0 s | 130,0 s | +25.000 |
| Trinchera | 125.000 | 119,1 s | 5,0 s | 124,1 s | +25.000 |

Obra de 50 turnos; la ciudad suma 25.000 visibles al techo al terminar, con el territorio quieto. En FrontWars el techo pasó de 25,6k a 50,9k mientras cambiaba el territorio: falta medirlo con el mapa quieto para comparar.

## Resumen y valores del perfil Clásico

| Parámetro | Valor | Estado |
|---|---|---|
| paceRegen | 1,00 | cerrado (A dentro de tolerancia) |
| paceNeutral | 0,50 | provisional (barrido C: el más cercano al indicador es 0,50) |
| pacePvp | 1,00 | provisional (D: sin muestra comparable) |
| Oro pasivo | 1000/s | cuadra con FrontWars (B) |
| Primera ciudad | 125.000 | precio igual; delta de techo pendiente de medir en FrontWars |

### Mediciones de FrontWars que faltan para cerrar los provisionales

1. Tierra libre: con el mapa y el despliegue registrados, casillas propias exactas (o recorte al mismo zoom) a 100/250/500 y fin del frente tras un clic al 10, 20 y 40 %, tres repeticiones.
2. Combate: D/A = 0,5 / 1 / 2 contra nación y colonia, con y sin puesto, en terreno y tramo fijos: primera casilla, avance a los 10 s y bajas de los dos lados.
3. Retirada: plazo, reembolso y estado de la tarjeta en un caso medido.
4. Primera ciudad: incremento del techo con el territorio quieto.

