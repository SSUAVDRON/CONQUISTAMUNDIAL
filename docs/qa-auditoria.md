# QA de la auditoría de desarrollo (14-nov-2026)

Casos QA01–QA10 de la auditoría, con lo que se ha comprobado, cómo y lo que
queda pendiente porque depende de un dispositivo, de la red publicada o de
personas reales. Build y versión: ver el sello de compilación del paquete
(`npm run empaquetar`) y `PROTOCOL` / `RULES_FINGERPRINT` en `src/multiplayer.js`.

**Cambios de protocolo y reglas.** El protocolo de sala pasa a la versión 3
(plazas concedidas por el anfitrión, inicio en fragmentos con acuse de recibo y
reparto de órdenes por emisor): entra en la huella de reglas, así que un
cliente de antes ve «Otra versión del juego: recarga la página» y no puede
mezclarse. Las reglas de simulación (`MECH_VERSION`, perfiles) no cambian.
**Perfiles y historiales**: los de antes se migran al leerlos (configuración de
la IA y de las salas por separado; rango mixto conservado como histórico y dos
colas nuevas); los historiales sin configuración guardada siguen mostrándose
(«Repetir» propone revisar la configuración).

| Caso | Estado | Cómo se ha comprobado |
|---|---|---|
| QA01 Repetición e historial | Superado | `tests/repeticion.test.js` (configuración completa, preferencias cambiadas, ceros, historial antiguo); navegador: «Repetir partida» tras cambiar preferencias conserva las 90 naciones Clásicas, reglas, dificultad y colonias. |
| QA02 Tutorial adaptable | Superado (emulado) | Los nueve pasos a 320, 390 y 720 px y en escritorio (Playwright, con toques en el móvil). Pendiente: teléfono físico. |
| QA03 Despliegue | Superado | `tests/salida.test.js` (costa, río, montaña, ocupación, rival cercano, misma recomendación con la misma semilla); navegador: aviso de salida y zona dibujada. `docs/aperturas.md`: la recomendada sale siempre con zona completa (0/3 recortadas frente a 2/3 al azar). |
| QA04 Combate y economía | Superado | `tests/prevision.test.js` (envío y reserva al 20, 50 y 100 % con la cuenta del motor; defensa con capital, murallas y terreno), `tests/amortizacion.test.js` (pueblo de 40k a +300/s ≈ 133 s, con los bonos efectivos y la obra aparte; aviso al terminar una obra con las cifras del motor). |
| QA05 Sala y reglas | Superado en local; pendiente entre redes distintas | Dos pestañas: entrar por código y por enlace, confirmar, editar varias reglas en el borrador (el invitado sigue listo), aplicar (una revisión; el invitado ve qué ha cambiado y confirma de nuevo), descartar y empezar juntos. Pendiente: dos dispositivos en redes distintas por los servidores públicos (no accesibles desde el entorno de pruebas). |
| QA06 Interrupción y recuperación | Superado (pestañas) | Abandono del anfitrión a los 20 s: informe con la duración real, una sola entrada en el historial y vuelta a Multijugador; corte breve: «Reconectando…» y plaza reservada 15 s (`tests/conexion.test.js`). |
| QA07 Dos rondas | Superado | `tests/multijugador.test.js` y `tests/salas.test.js` (mismo código, semilla nueva, listo reiniciado, mensajes de otra ronda descartados, inicio de la ronda anterior ignorado); navegador: revancha en el mismo vestíbulo. |
| QA08 Admisión y carga | Superado con el servidor de pruebas; pendiente sobre el publicado | `tests/salas32.test.js` (última plaza disputada, aforo que no baja de los admitidos, 32 clientes reales en una sala, fragmentos perdidos, desordenados y contradictorios, 32 emisores). Carga: `docs/carga-salas.md` (16 clientes 2 min en Europa con 60 naciones de la IA y 278 colonias; 32 clientes 10 min con 60 naciones de la IA). Pendiente: repetir sobre los servidores públicos y en un móvil físico. |
| QA09 Rangos y migración | Superado | `tests/rangos-colas.test.js` (cada modalidad en su rango, perfil antiguo conservado como histórico, colocación, abandono, final repetido y tras recargar, anulación una sola vez, unión de dos dispositivos); navegador: Competitivo con las dos colas, el rango mixto histórico y el aviso de una vez. |
| QA10 Cifras y presentación | Superado | Mismo puesto en HUD, informe e historial; colonias etiquetadas aparte; sin «null», «undefined» ni «NaN» en creador, vestíbulo, HUD, informe e historial; misiones de Trinchera marcadas como tales (barrido con Playwright). |

**Aforo publicado.** `VALIDATED_SEATS` (`src/multiplayer.js`) fija el mayor
aforo que se ofrece al crear o editar una sala. Está en 32 por la prueba de
carga con el servidor de pruebas (mismo cliente MQTT por WebSocket y mismo
protocolo que la web). Si la prueba con los servidores públicos no lo supera:

    node herramientas/carga-salas.js --clientes 32 --min 10 --broker wss://broker.emqx.io:8084/mqtt

se baja esa constante al mayor aforo que sí lo haya superado.

**Objetivos frente a mediciones.** Objetivos de la auditoría: 10 minutos sin
desincronizaciones, 10 ticks por segundo sostenidos y percentil 95 de la
confirmación de órdenes por debajo de 1 s. Las mediciones, con sus
condiciones, están en `docs/carga-salas.md`.
