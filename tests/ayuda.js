// Utilidades compartidas por los tests.

/** Termina al momento todas las obras en curso (los tests no esperan a que acaben). */
export function terminarObras(game) {
  for (const b of game.sites) b.buildEnd = game.ticks;
  game._updateSites();
}

/** Construye y, si sale bien, termina la obra en el acto. */
export function buildNow(game, p, kind, tile) {
  const ok = game.build(p, kind, tile);
  if (ok) terminarObras(game);
  return ok;
}

/** Una casilla propia de `p` donde se puede construir `kind` (o -1). */
export function casillaPara(game, p, kind) {
  for (const t of game.map.landTiles) {
    if (game.owner[t] === p.id && game.canBuild(p, kind, t).ok) return t;
  }
  return -1;
}

/**
 * Reglas para comprobar las fórmulas del documento aisladas: sin la capital
 * amurallada (que ocupa la casilla de salida) ni el oro del territorio de
 * doc-1.6. Lo nuevo tiene sus propios tests (economia.test.js).
 */
export const DOC = { capitals: false, taxes: false };
