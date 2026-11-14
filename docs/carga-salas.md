# Prueba de carga de las salas

Generado por `node herramientas/carga-salas.js` (auditoría DEV06). Cada cliente es completo: sala, simulación y lockstep, con el mismo cliente MQTT por WebSocket que la web. Los clientes despliegan y mandan órdenes al azar (expansión, ataques y emojis) cada 2–6 s. «Confirmación» = desde que un invitado manda una orden hasta que la ve aplicada en un turno del anfitrión. «Arranque» = desde «Iniciar partida» (con los 3 s de cuenta atrás) hasta tener el inicio completo.

| Fecha | Clientes | Duración | Mapa | IA / colonias | Ticks/s (anfitrión) | Desincronizaciones | Retraso máx. de un invitado | Confirmación p50 / p95 / máx. | Órdenes | Arranque | Memoria | Equipo · red · build |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-14 13:09 | 16 | 2 min | europa | 60 / 278 | 9.88 | 0 clientes · 0/2 huellas distintas | 0 ticks | 147 / 225 / 303 ms | 353 | 3.3 s (2 fragmentos) | 1645 MB por hilo | 4 × Intel(R) Xeon(R) Processor @ 2.30GHz, 17 GB · servidor de pruebas en el mismo equipo (WebSocket local) · fd0f7ae + entrega C (DEV06) |
| 2026-11-14 13:20 | 32 | 10 min | mediano | 60 / 130 | 9.89 | 0 clientes · 0/11 huellas distintas | 2 ticks | 129 / 216 / 516 ms | 3646 | 3.3 s (3 fragmentos) | 2891 MB por hilo | 4 × Intel(R) Xeon(R) Processor @ 2.30GHz, 17 GB · servidor de pruebas en el mismo equipo (WebSocket local) · fd0f7ae + entrega C (DEV06) |
