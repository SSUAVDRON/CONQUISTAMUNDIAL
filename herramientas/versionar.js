// Versiona las direcciones de los módulos de index.html con la huella de su
// contenido: un «import map» hace que `./render.js` se pida como
// `src/render.js?v=<huella>`. Así una CDN no puede mezclar un módulo de hoy
// con una copia vieja de otro (cada archivo cambia de dirección solo cuando
// cambia su contenido). Lo comprueba tests/versiones.test.js.
//
//   node herramientas/versionar.js          → reescribe index.html
//   node herramientas/versionar.js --check  → falla si no está al día
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- versiones: generado por herramientas/versionar.js -->';
const END = '<!-- /versiones -->';

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);

/** index.html con el import map y las huellas al día. */
export async function versionedIndex() {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const files = (await readdir(join(ROOT, 'src'))).filter((f) => f.endsWith('.js')).sort();
  const imports = {};
  for (const f of files) imports[`./src/${f}`] = `./src/${f}?v=${hash(await readFile(join(ROOT, 'src', f)))}`;
  const css = hash(await readFile(join(ROOT, 'css', 'estilo.css')));
  const map = `${START}\n  <script type="importmap">\n  ${JSON.stringify({ imports }, null, 2).replace(/\n/g, '\n  ')}\n  </script>\n  ${END}`;
  let out = html.includes(START) ? html.replace(new RegExp(`${START}[\\s\\S]*?${END}`), map) : html.replace('<link rel="stylesheet" href="css/estilo.css', `${map}\n  <link rel="stylesheet" href="css/estilo.css`);
  out = out.replace(/href="css\/estilo\.css(\?v=[0-9a-f]+)?"/, `href="css/estilo.css?v=${css}"`);
  out = out.replace(/<script type="module" src="src\/main\.js(\?v=[0-9a-f]+)?"><\/script>/, `<script type="module" src="${imports['./src/main.js']}"></script>`);
  return { html, out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { html, out } = await versionedIndex();
  if (process.argv.includes('--check')) {
    if (html !== out) {
      console.error('index.html no tiene las huellas al día: node herramientas/versionar.js');
      process.exit(1);
    }
    console.log('index.html al día');
  } else if (html !== out) {
    await writeFile(join(ROOT, 'index.html'), out);
    console.log('index.html actualizado');
  } else console.log('index.html ya estaba al día');
}
