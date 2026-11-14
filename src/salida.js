// Cómo se describe una salida durante el despliegue (DEV03): la zona inicial
// que tendrías de verdad y por qué se recorta, el terreno, el espacio libre
// para crecer y la nación y colonia más cercanas. Los datos los da
// game.spawnInfo(); aquí solo se convierten en texto.

const pct = (n, total) => Math.round((100 * n) / Math.max(1, total));

/** Espacio libre conectado: amplio, medio o escaso (con la cifra). */
export function freeLabel(info) {
  const f = info.free / Math.max(1, info.freeCap);
  return f >= 0.99 ? 'amplio' : f >= 0.35 ? 'medio' : 'escaso';
}

/**
 * { zone, cuts, terrain, free, rival, risk } en texto corto, y `warn` si la
 * salida es mala (zona recortada, poco sitio o una nación muy cerca).
 */
export function describeSpawn(info) {
  if (!info) return null;
  const have = info.zone.length;
  const zone = have >= info.full ? `Zona inicial completa (${have} casillas)` : `Zona inicial ${have} de ${info.full} casillas`;
  const c = info.cut;
  const cutParts = [];
  if (c.costa) cutParts.push(`costa ${c.costa}`);
  if (c.rio) cutParts.push(`río ${c.rio}`);
  if (c.ocupada) cutParts.push(`ocupadas ${c.ocupada}`);
  if (c.otra) cutParts.push(`otra tierra ${c.otra}`);
  const cuts = cutParts.length ? `recortada por ${cutParts.join(', ')}` : '';
  const [llano, meseta, monte] = info.terrain;
  const terrainParts = [];
  if (llano) terrainParts.push(`llanura ${pct(llano, have)} %`);
  if (meseta) terrainParts.push(`meseta ${pct(meseta, have)} %`);
  if (monte) terrainParts.push(`montaña ${pct(monte, have)} %`);
  const free = `espacio libre alrededor: ${freeLabel(info)}`;
  const rival = info.rival ? `${info.rival.player.name} a ${info.rival.km} km` : 'ninguna nación cerca';
  const close = !!(info.rival && info.rival.tiles < 14 * Math.sqrt(info.full / 52) * 2);
  const warn = have < info.full || freeLabel(info) === 'escaso' || close;
  return {
    zone,
    cuts,
    terrain: terrainParts.join(' · '),
    free,
    rival,
    close,
    warn,
    /** Una línea para el aviso de despliegue. */
    line: [have >= info.full ? `${have}/${info.full} casillas` : `${have}/${info.full} casillas (${cutParts.join(', ')})`, freeLabel(info) === 'amplio' ? 'mucho sitio libre' : `sitio libre ${freeLabel(info)}`, info.rival ? `nación más cerca: ${rival}` : rival].join(' · '),
  };
}
