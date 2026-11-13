// Empaqueta el juego en un único HTML autocontenido (sin dependencias).
//
//   node herramientas/empaquetar.js
//
// Genera en dist/:
//   - dominia.html   documento completo: se abre con doble clic, sin servidor
//   - fragmento.html el mismo contenido sin <html>/<head>/<body>, para
//                    plataformas que envuelven la página (artefactos de Claude)
//   - web/           para el hosting (herramientas/hostinger.sh): index.html
//                    sin los mapas y mapas-<huella>.json aparte. El HTML cambia
//                    en cada versión; los mapas casi nunca, y con la huella en
//                    el nombre el navegador los guarda para siempre (~1,8 MB
//                    comprimidos que no se vuelven a bajar en cada versión)
//
// Cada módulo de src/ se compacta (sin comentarios ni sangría), se envuelve en
// una función y los import/export se sustituyen por un registro mínimo. Solo admite la sintaxis que usa este
// proyecto: `import { a, b as c } from './x.js'` y `export function|class|const`.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compactJs } from './compactar.js';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+)\.js';?[ \t]*$/gm;
const EXPORT_RE = /^export\s+(async\s+function|function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;

/**
 * Los módulos de src/ en un solo script. Con `externalMaps`, mapas-reales.js
 * queda vacío (los datos los descarga mapas-carga.js) y su JSON se devuelve
 * aparte en `maps`.
 */
async function bundleModules({ externalMaps = false } = {}) {
  const files = (await readdir(SRC)).filter((f) => f.endsWith('.js')).sort();
  const parts = [];
  let maps = null;
  for (const file of files) {
    const name = file.slice(0, -3);
    // Sin comentarios ni sangría (~20 % menos de código; ver compactar.js)
    let code = compactJs(await readFile(join(SRC, file), 'utf8'));
    if (externalMaps && name === 'mapas-reales') {
      const m = /^export const REAL_MAP_DATA = (\{[\s\S]*\});\s*$/m.exec(code);
      if (!m) throw new Error('mapas-reales.js: no se encuentra REAL_MAP_DATA');
      // Dentro se queda lo ligero (nombre, tamaño, países: ~17 KB); fuera, el
      // terreno y el relieve
      const all = JSON.parse(m[1]);
      const light = {};
      const heavy = {};
      for (const [id, { rle, relief, ...rest }] of Object.entries(all)) {
        light[id] = rest;
        heavy[id] = relief ? { rle, relief } : { rle };
      }
      maps = JSON.stringify(heavy);
      code = `export const REAL_MAP_DATA = ${JSON.stringify(light)};\n`;
    }
    const exported = [];
    code = code.replace(IMPORT_RE, (_, names, mod) => {
      const list = names
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/\s+as\s+/, ': '));
      return `const { ${list.join(', ')} } = __require('${mod}');`;
    });
    code = code.replace(EXPORT_RE, (_, kw, id) => {
      exported.push(id);
      return `${kw} ${id}`;
    });
    if (/^\s*(import|export)\b/m.test(code)) {
      throw new Error(`${file}: sintaxis de import/export no soportada por el empaquetador`);
    }
    parts.push(`__define('${name}', function () {\n${code}\nreturn { ${exported.join(', ')} };\n});`);
  }
  const js = `(function () {
'use strict';
const __factories = {};
const __cache = {};
function __define(name, factory) { __factories[name] = factory; }
function __require(name) {
  if (!(name in __cache)) {
    if (!__factories[name]) throw new Error('Módulo no encontrado: ' + name);
    __cache[name] = __factories[name]();
  }
  return __cache[name];
}
${parts.join('\n')}
__require('main');
})();`;
  // Que el paquete sea JavaScript válido (si el compactador se equivocara, aquí se para)
  new Function(js);
  return { js, maps };
}

/**
 * Sello de compilación: commit (con «-dirty» si hay cambios sin guardar) y
 * fecha UTC. Va en <meta name="trinchera-build"> y en window.__TRINCHERA_BUILD;
 * el juego lo enseña en Ajustes, para saber qué versión sirve el hosting.
 */
function buildStamp() {
  let commit = 'sin-git';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { cwd: ROOT }).toString().trim();
    if (dirty) commit += '-dirty';
  } catch {
    /* fuera de un repositorio */
  }
  const fecha = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${commit} ${fecha} UTC`;
}

/** Evita que el código cierre la etiqueta <script> antes de tiempo. */
const safeForScript = (js) => js.replace(/<\/script/gi, '<\\/script');

async function main() {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const css = await readFile(join(ROOT, 'css', 'estilo.css'), 'utf8');
  const js = safeForScript((await bundleModules()).js);
  const web = await bundleModules({ externalMaps: true });
  const mapsName = `mapas-${createHash('sha256').update(web.maps).digest('hex').slice(0, 12)}.json`;

  const title = /<title>([\s\S]*?)<\/title>/.exec(html)[1].trim();
  const body = /<body[^>]*>([\s\S]*?)<\/body>/.exec(html)[1]
    .replace(/\s*<script type="module" src="(\.\/)?src\/main\.js(\?v=[0-9a-f]+)?"><\/script>\s*/, '\n')
    .trim();
  const viewport = /<meta name="viewport"[^>]*>/.exec(html)[0];
  // Hojas externas permitidas (la fuente del logotipo en Google Fonts)
  const fonts = (html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/g) || []).join('\n');

  const build = buildStamp();
  const head = `<title>${title}</title>\n<meta name="trinchera-build" content="${build}">\n${fonts}\n<style>\n${css}\n</style>`;
  const stamp = `<script>window.__TRINCHERA_BUILD = ${JSON.stringify(build)};</script>`;
  const content = `${body}\n${stamp}\n<script>\n${js}\n</script>`;
  const fragment = `${head}\n${content}\n`;
  const page = (headHtml, bodyHtml) => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
${viewport}
${headHtml}
</head>
<body>
${bodyHtml}
</body>
</html>
`;
  const full = page(head, content);
  // La web: los mapas aparte (se piden en cuanto empieza a cargar, en paralelo con el resto)
  const webHead = `${head}\n<link rel="preload" href="${mapsName}" as="fetch" crossorigin="anonymous">`;
  const webContent = `${body}\n${stamp}\n<script>window.__TRINCHERA_MAPAS = ${JSON.stringify(mapsName)};</script>\n<script>\n${safeForScript(web.js)}\n</script>`;
  const webPage = page(webHead, webContent);

  await mkdir(DIST, { recursive: true });
  await writeFile(join(DIST, 'fragmento.html'), fragment);
  await writeFile(join(DIST, 'dominia.html'), full);
  await rm(join(DIST, 'web'), { recursive: true, force: true });
  await mkdir(join(DIST, 'web'), { recursive: true });
  await writeFile(join(DIST, 'web', 'index.html'), webPage);
  await writeFile(join(DIST, 'web', mapsName), web.maps);
  const kb = (s) => `${Math.round(Buffer.byteLength(s) / 1024)} KB`;
  console.log(`dist/dominia.html (${kb(full)}), dist/fragmento.html (${kb(fragment)}) y dist/web (${kb(webPage)} + ${mapsName} ${kb(web.maps)}) generados · compilación ${build}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
