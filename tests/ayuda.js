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
