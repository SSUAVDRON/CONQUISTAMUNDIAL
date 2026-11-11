# Calibración del perfil Clásico

Generado por `node herramientas/calibrar.js` (motor doc-1.3, perfiles clasico-4 / trinchera-3). Simulaciones sin pantalla, deterministas; semillas 1, 2, 3 (las mismas para cada valor de cada barrido). Cifras «visibles» = internas ÷ 10, como en el HUD.

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

**Clásico** (clasico-4)

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

**Trinchera** (trinchera-3)

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

Barrido de `paceNeutral` con las mismas 3 semillas para cada valor. Terreno alrededor de cada despliegue (llanura / meseta / montaña): semilla 1: 26 / 56 / 18 %; semilla 2: 76 / 24 / 0 %; semilla 3: 77 / 23 / 0 %. Coste de tiempo por casilla del documento; bajas por casilla de doc-1.2 (el doble que el documento) y, por encima de ~6.600 tropas, la aceleración con raíz de doc-1.2. Tiempos en segundos desde el clic; «no llega» = ese frente se agotó antes.

### Muestra comparable con FrontWars: ~1,27k visibles (12.700 internas) en el frente

En FrontWars, tras el primer clic había ~1,27k en el frente a 0:13 y 202 a 0:17; del cambio de techo (13,6k → 19,2k) la auditoría deduce **~467 casillas en 4 s**. Es un indicador indirecto (supone la misma fórmula de techo): orienta el barrido, no cierra el valor.

| paceNeutral | Casillas a los 4 s | 100 cas. (s) | 250 cas. (s) | 500 cas. (s) | Fin del frente (s) | Casillas al acabar |
|---|---|---|---|---|---|---|
| 0,07 | 47 [46–47] | 7,8 [7,7–7,8] | 17,8 [17,8–18,8] | no llega | 53,5 [53,0–54,4] | 391 [359–391] |
| 0,25 | 199 [193–200] | 2,2 [2,2–2,3] | 5,1 [5,1–5,4] | no llega | 15,1 [14,9–15,3] | 391 [358–391] |
| 0,50 | 338 [314–338] | 1,2 [1,2–1,2] | 2,6 [2,6–2,7] | no llega | 7,6 [7,5–7,7] | 391 [358–391] |
| 0,75 | 378 [348–378] | 0,8 [0,8–0,8] | 1,8 [1,8–1,9] | no llega | 5,1 [5,0–5,2] | 390 [358–391] |
| 1,00 | no llega | 0,6 [0,6–0,6] | 1,3 [1,3–1,4] | no llega | 3,9 [3,8–3,9] | 390 [359–391] |

Valor más cercano al indicador de FrontWars: **paceNeutral = 0,75** (378 casillas a los 4 s frente a ~467). Queda como **provisional**.

Segundo indicador, también indirecto: el frente de FrontWars pasó de ~1,27k a 202 visibles en esos 4 s (~1,07k gastadas). Con las bajas por casilla del documento (1,6 / 2 / 2,4 visibles en llanura / meseta / montaña; desde doc-1.2 el juego cobra el doble) serían ~670 / ~535 / ~445 casillas según el terreno, que no se conoce. Los dos indicadores se solapan hacia ~450–500 casillas, lo que también apunta a 0,5; con terreno llano, a 0,75–1. Hace falta la medición directa de la lista final para cerrarlo.

### Envíos al 10, 20 y 40 % de la reserva en t = 5 s

**10 %**

| paceNeutral | Enviadas (vis.) | 100 cas. (s) | 250 cas. (s) | 500 cas. (s) | Fin (s) | Casillas | Bajas (vis.) |
|---|---|---|---|---|---|---|---|
| 0,07 | 434 | 26,4 [26,0–27,9] | no llega | no llega | 60,8 [58,9–61,0] | 134 [128–135] | 434 |
| 0,25 | 434 | 7,5 [7,3–7,9] | no llega | no llega | 17,1 [16,6–17,1] | 134 [128–135] | 434 |
| 0,50 | 434 | 3,8 [3,7–4,1] | no llega | no llega | 8,6 [8,4–8,6] | 134 [127–135] | 434 |
| 0,75 | 434 | 2,5 [2,5–2,7] | no llega | no llega | 5,8 [5,6–5,8] | 134 [128–135] | 434 |
| 1,00 | 434 | 1,9 [1,9–2,1] | no llega | no llega | 4,3 [4,2–4,4] | 134 [127–135] | 434 |

**20 %**

| paceNeutral | Enviadas (vis.) | 100 cas. (s) | 250 cas. (s) | 500 cas. (s) | Fin (s) | Casillas | Bajas (vis.) |
|---|---|---|---|---|---|---|---|
| 0,07 | 869 | 9,9 [9,8–10,1] | 37,9 [37,6–53,2] | no llega | 55,6 [54,2–56,4] | 267 [250–269] | 869 |
| 0,25 | 869 | 2,8 [2,8–2,9] | 10,7 [10,6–15,0] | no llega | 15,6 [15,3–15,9] | 267 [250–269] | 869 |
| 0,50 | 869 | 1,5 [1,4–1,5] | 5,4 [5,3–5,4] · no llega 1/3 | no llega | 7,9 [7,7–8,0] | 267 [249–269] | 869 |
| 0,75 | 869 | 1,0 [1,0–1,0] | 3,6 [3,6–3,6] · no llega 1/3 | no llega | 5,3 [5,2–5,4] | 267 [249–269] | 869 |
| 1,00 | 869 | 0,8 [0,8–0,8] | 2,8 [2,7–2,8] · no llega 1/3 | no llega | 4,0 [3,9–4,0] | 267 [249–269] | 869 |

**40 %**

| paceNeutral | Enviadas (vis.) | 100 cas. (s) | 250 cas. (s) | 500 cas. (s) | Fin (s) | Casillas | Bajas (vis.) |
|---|---|---|---|---|---|---|---|
| 0,07 | 1737 | 6,5 [6,5–6,6] | 14,0 [14,0–14,2] | 34,2 [34,2–34,2] · no llega 1/3 | 51,4 [50,7–52,8] | 530 [481–533] | 1737 |
| 0,25 | 1737 | 1,9 [1,9–1,9] | 4,0 [4,0–4,1] | 9,6 [9,6–9,7] · no llega 1/3 | 14,5 [14,4–14,9] | 530 [480–533] | 1737 |
| 0,50 | 1737 | 1,0 [1,0–1,0] | 2,0 [2,0–2,1] | 4,9 [4,9–4,9] · no llega 1/3 | 7,3 [7,2–7,5] | 530 [480–533] | 1737 |
| 0,75 | 1737 | 0,7 [0,7–0,7] | 1,4 [1,4–1,4] | 3,3 [3,3–3,3] · no llega 1/3 | 4,9 [4,9–5,0] | 529 [479–533] | 1737 |
| 1,00 | 1737 | 0,5 [0,5–0,5] | 1,1 [1,1–1,1] | 2,5 [2,5–2,5] · no llega 1/3 | 3,7 [3,7–3,8] | 529 [479–533] | 1737 |

### Variantes al 20 %: segundo envío y cancelación a los 5 s del clic

| paceNeutral | Dos envíos: 500 cas. (s) | Dos envíos: fin (s) | Dos envíos: casillas | Cancelado: casillas | Cancelado: bajas (vis.) |
|---|---|---|---|---|---|
| 0,07 | no llega | 54,2 [52,0–54,9] | 480 [436–481] | 48 [47–48] | 154 |
| 0,25 | no llega | 16,8 [16,3–17,0] | 480 [435–481] | 169 [162–171] | 550 |
| 0,50 | no llega | 10,4 [10,2–10,5] | 480 [435–481] | 245 [230–246] | 794 |
| 0,75 | no llega | 8,5 [8,3–8,5] | 479 [435–481] | 265 [248–266] | 862 |
| 1,00 | no llega | 4,0 [3,9–4,0] | 267 [249–269] | 267 [249–269] | 869 |

## D. Contacto y retirada (PROVISIONAL)

Dos países vecinos en terreno llano fijo (mapa generado con toda la tierra en llanura); el defensor tiene ~1500 casillas y no regenera. Se ataca con 20.000 internas (2.000 visibles); D/A = tropas del defensor ÷ las enviadas. Se mide a los 10 s (o al acabarse el frente).

| pacePvp | D/A | Defensor | Primera casilla (s) | Casillas a los 2 s | Fin del frente (s) | Casillas al acabar | Bajas atacante (vis.) | Bajas defensor (vis.) |
|---|---|---|---|---|---|---|---|---|
| 0,5 | 0,5 | nación | 0,1 [0,1–0,1] | 444 [442–492] | 4,7 [4,1–4,7] | 616 [611–617] | 2000 | 369 |
| 0,5 | 0,5 | nación + puesto | 0,1 [0,1–0,1] | 431 [417–469] | 4,7 [4,1–5,8] | 589 [583–603] | 2000 | 357 |
| 0,5 | 0,5 | colonia | 0,1 [0,1–0,1] | 444 [442–492] | 4,7 [4,1–4,7] | 616 [611–617] | 2000 | 369 |
| 0,5 | 1,0 | nación | 0,1 [0,1–0,1] | 228 [227–249] | 7,1 [6,9–8,3] | 319 [319–320] | 2000 | 382 |
| 0,5 | 1,0 | nación + puesto | 0,1 [0,1–0,1] | 216 [202–225] | 7,3 [5,6–8,4] | 295 [294–308] | 2000 | 357 |
| 0,5 | 1,0 | colonia | 0,1 [0,1–0,1] | 228 [227–249] | 7,1 [6,9–8,3] | 319 [319–320] | 2000 | 382 |
| 0,5 | 2,0 | nación | 0,1 [0,1–0,1] | 115 [115–131] | 8,9 [8,0–9,8] · no llega 1/3 | 224 [224–226] | 2000 | 537 |
| 0,5 | 2,0 | nación + puesto | 0,1 [0,1–0,1] | 104 [91–109] | 8,9 [8,0–9,8] · no llega 1/3 | 204 [202–214] | 2000 | 490 |
| 0,5 | 2,0 | colonia | 0,1 [0,1–0,1] | 115 [115–131] | 8,9 [8,0–9,8] · no llega 1/3 | 224 [224–226] | 2000 | 537 |
| 1,0 | 0,5 | nación | 0,1 [0,1–0,1] | 617 [611–617] | 2,2 [1,9–2,3] | 618 [611–618] | 2000 | 369 |
| 1,0 | 0,5 | nación + puesto | 0,1 [0,1–0,1] | 586 [583–601] | 2,3 [2,0–2,8] | 589 [583–603] | 2000 | 357 |
| 1,0 | 0,5 | colonia | 0,1 [0,1–0,1] | 617 [611–617] | 2,2 [1,9–2,3] | 618 [611–618] | 2000 | 369 |
| 1,0 | 1,0 | nación | 0,1 [0,1–0,1] | 301 [300–313] | 3,5 [3,4–4,1] | 319 [319–320] | 2000 | 382 |
| 1,0 | 1,0 | nación + puesto | 0,1 [0,1–0,1] | 289 [275–289] | 3,7 [2,8–4,2] | 295 [294–308] | 2000 | 357 |
| 1,0 | 1,0 | colonia | 0,1 [0,1–0,1] | 301 [300–313] | 3,5 [3,4–4,1] | 319 [319–320] | 2000 | 382 |
| 1,0 | 2,0 | nación | 0,1 [0,1–0,1] | 174 [173–190] | 4,9 [4,0–5,6] | 224 [224–226] | 2000 | 537 |
| 1,0 | 2,0 | nación + puesto | 0,1 [0,1–0,1] | 163 [150–168] | 5,0 [4,0–5,7] | 204 [202–214] | 2000 | 490 |
| 1,0 | 2,0 | colonia | 0,1 [0,1–0,1] | 174 [173–190] | 4,9 [4,0–5,6] | 224 [224–226] | 2000 | 537 |

El ritmo (pacePvp) cambia cuánto tarda el frente, no cuántas casillas gana: con estas cifras el ataque se agota por bajas. En el motor, colonia y nación se resuelven igual (OpenFront aplica ×0,7 a la magnitud contra bots; no está implementado sin medirlo en FrontWars).

Retirada a 1 s del clic (D/A = 1, nación), pacePvp 1: vuelve el 75 % de lo que sigue en el frente.

| Semilla | Casillas ganadas | Vuelven (vis.) | Perdidas: combate + 25 % (vis.) |
|---|---|---|---|
| 1 | 227 | 565 | 1435 |
| 2 | 250 | 427 | 1573 |
| 3 | 229 | 552 | 1448 |

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
| paceNeutral | 0,25 | provisional (barrido C: el más cercano al indicador es 0,75) |
| pacePvp | 1,00 | provisional (D: sin muestra comparable) |
| Oro pasivo | 1000/s | cuadra con FrontWars (B) |
| Primera ciudad | 125.000 | precio igual; delta de techo pendiente de medir en FrontWars |

### Mediciones de FrontWars que faltan para cerrar los provisionales

1. Tierra libre: con el mapa y el despliegue registrados, casillas propias exactas (o recorte al mismo zoom) a 100/250/500 y fin del frente tras un clic al 10, 20 y 40 %, tres repeticiones.
2. Combate: D/A = 0,5 / 1 / 2 contra nación y colonia, con y sin puesto, en terreno y tramo fijos: primera casilla, avance a los 10 s y bajas de los dos lados.
3. Retirada: plazo, reembolso y estado de la tarjeta en un caso medido.
4. Primera ciudad: incremento del techo con el territorio quieto.

