// El compactador del paquete (herramientas/compactar.js) solo quita comentarios
// y sangría: la sintaxis sigue siendo válida y la simulación compactada da
// exactamente lo mismo que la original (misma huella de estado, turno a turno).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compactJs } from '../herramientas/compactar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

test('compactar: casos difíciles (cadenas, plantillas, expresiones regulares, comentarios)', () => {
  const src = [
    "const a = 'no // es un comentario'; // sí lo es",
    'const b = "/* tampoco */";',
    'const c = `línea 1',
    '  // dentro de la plantilla se queda',
    '  ${a /* fuera */ + `anidada ${b}`}`;',
    'const r = /\\/\\/[/*]x/g.test(c) ? 1 / 2 : 3; /* bloque',
    '   de varias líneas */',
    'const d = a',
    '/* en medio */ + b;',
    'function f() { return /a\\/b/.source; }',
  ].join('\n');
  const out = compactJs(src);
  assert.ok(!out.includes('sí lo es') && !out.includes('bloque') && !out.includes('fuera') && !out.includes('en medio'));
  assert.ok(out.includes("'no // es un comentario'") && out.includes('"/* tampoco */"'));
  assert.ok(out.includes('línea 1\n  // dentro de la plantilla se queda\n  ${'), 'el texto de la plantilla, intacto');
  // Mismo resultado al ejecutarlo
  const run = (code) => new Function(`${code}\nreturn [a, b, c, r, d, f()];`)();
  assert.deepEqual(run(out), run(src));
});

test('compactar: todos los módulos de src siguen siendo JavaScript válido', () => {
  for (const f of readdirSync(SRC).filter((x) => x.endsWith('.js'))) {
    const out = compactJs(readFileSync(join(SRC, f), 'utf8'));
    const body = out.replace(/^import\s*\{[^}]*\}\s*from\s*'[^']+';?\s*$/gm, '').replace(/^export\s+/gm, '');
    assert.doesNotThrow(() => new Function(body), `${f}`);
  }
});

test('compactar: la simulación compactada da la misma partida, turno a turno', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'compacto-'));
  try {
    for (const f of readdirSync(SRC).filter((x) => x.endsWith('.js'))) writeFileSync(join(dir, f), compactJs(readFileSync(join(SRC, f), 'utf8')));
    const load = async (base) => {
      const u = (m) => pathToFileURL(join(base, m)).href;
      const [{ RES }, { generateMap }, { Game }, { stateHash }] = await Promise.all([import(u('config.js')), import(u('map.js')), import(u('game.js')), import(u('multiplayer.js'))]);
      const map = generateMap(160 * RES, 100 * RES, 99);
      const game = new Game({ map, seed: 99 });
      game.addPlayer('Tú', [255, 0, 0], true);
      game.addBots(5);
      game.addColonies(6);
      game.start();
      const hashes = [];
      for (let i = 0; i < 900; i++) {
        game.tick();
        if (i % 50 === 0) hashes.push(stateHash(game));
      }
      return hashes;
    };
    assert.deepEqual(await load(dir), await load(SRC));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
