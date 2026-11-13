// Datos de los mapas reales. En la web (dist/web, ver herramientas/empaquetar.js)
// el terreno y el relieve no van dentro del HTML (sí el nombre, el tamaño y
// los países): se descargan aparte, de un archivo con su huella en
// el nombre que el navegador guarda para siempre, y entran en REAL_MAP_DATA
// antes de usarse. Así cada versión nueva del juego no obliga a bajar otra
// vez ~1,8 MB de mapas que no han cambiado. En desarrollo, en el artifact y
// en dist/dominia.html (un solo archivo) ya vienen dentro y esto no hace nada.
import { REAL_MAP_DATA } from './mapas-reales.js';

let loading = null;

/** Se cumple cuando REAL_MAP_DATA tiene los mapas (descargándolos si hace falta). */
export function loadMapData() {
  const url = typeof window !== 'undefined' ? window.__TRINCHERA_MAPAS : '';
  if (!url || REAL_MAP_DATA.mundo?.rle) return Promise.resolve();
  if (!loading) {
    loading = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`mapas: HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        // Lo ligero (nombre, tamaño, países) ya estaba; llega el terreno y el relieve
        for (const [id, heavy] of Object.entries(data)) Object.assign((REAL_MAP_DATA[id] ??= {}), heavy);
      })
      .catch((err) => {
        loading = null; // se puede reintentar
        throw err;
      });
  }
  return loading;
}
