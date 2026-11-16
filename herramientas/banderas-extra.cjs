// Genera src/banderas-extra.js: el segundo atlas de banderas (las que no
// salen en los mapas) y el catálogo de todas las que se pueden elegir para
// el emblema, con su nombre y su grupo.
//
//   node herramientas/banderas-extra.cjs <carpeta flag-icons 4x3> <carpeta wikimedia>
//
// · flag-icons (MIT, https://github.com/lipis/flag-icons): los países y
//   territorios que no están en src/banderas.js, Cataluña, Galicia, País
//   Vasco e Inglaterra, Escocia, Gales e Irlanda del Norte.
// · Wikimedia Commons (símbolos oficiales y banderas históricas, dominio
//   público): las comunidades autónomas que faltan, los territorios de
//   Euskal Herria, la II República, banderas históricas y regiones. Se
//   descargan con «Special:FilePath/<archivo>» (los nombres, en EXTRA).
//
// Cada bandera se recorta al centro a 4:3 (sin deformarla) y se pinta a
// CELL_W × CELL_H. Los nombres de los países salen de Intl en español.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CELL_W = 80;
const CELL_H = 60;
const COLS = 16;
const ROOT = path.join(__dirname, '..');

// [id, nombre, grupo, fuente, recorte] · fuente: 'fi:<código>' (flag-icons) o 'wiki' (descargada como <id>.svg);
// recorte opcional { zoom, from: 'left' }: los pendones con la punta curva se recortan desde el asta
const EXTRA = [
  // Comunidades y ciudades autónomas
  ['es-an', 'Andalucía', 'es', 'wiki'], // Flag_of_Andalucía.svg
  ['es-ar', 'Aragón', 'es', 'wiki'], // Flag_of_Aragon.svg
  ['es-as', 'Asturias', 'es', 'wiki'], // Flag_of_Asturias.svg
  ['es-ib', 'Illes Balears', 'es', 'wiki'], // Flag_of_the_Balearic_Islands.svg
  ['es-cn', 'Canarias', 'es', 'fi:ic'],
  ['es-cb', 'Cantabria', 'es', 'wiki'], // Flag_of_Cantabria.svg
  ['es-cm', 'Castilla-La Mancha', 'es', 'wiki'], // Flag_of_Castile-La_Mancha.svg
  ['es-cl', 'Castilla y León', 'es', 'wiki'], // Flag_of_Castile_and_León.svg
  ['es-ct', 'Cataluña', 'es', 'fi:es-ct'],
  ['es-vc', 'Comunitat Valenciana', 'es', 'wiki'], // Flag_of_the_Valencian_Community_(2x3).svg
  ['es-ex', 'Extremadura', 'es', 'wiki'], // Flag_of_Extremadura_(with_coat_of_arms).svg
  ['es-ga', 'Galicia', 'es', 'fi:es-ga'],
  ['es-md', 'Comunidad de Madrid', 'es', 'wiki'], // Flag_of_the_Community_of_Madrid.svg
  ['es-mc', 'Región de Murcia', 'es', 'wiki'], // Flag_of_the_Region_of_Murcia.svg
  ['es-nc', 'Navarra', 'es', 'wiki'], // Bandera_de_Navarra.svg
  ['es-pv', 'País Vasco (Euskadi)', 'es', 'fi:es-pv'],
  ['es-ri', 'La Rioja', 'es', 'wiki'], // Flag_of_La_Rioja_(with_coat_of_arms).svg
  ['es-ce', 'Ceuta', 'es', 'wiki'], // Flag_of_Ceuta.svg
  ['es-ml', 'Melilla', 'es', 'wiki'], // Flag_of_Melilla.svg
  // Euskal Herria y sus territorios históricos (Nafarroa, arriba)
  ['eus', 'Euskal Herria (ikurriña)', 'eus', 'fi:es-pv'],
  ['eus-ar', 'Araba (Álava)', 'eus', 'wiki'], // Flag_of_Álava.svg
  ['eus-bi', 'Bizkaia', 'eus', 'wiki'], // Bandera_de_Vizcaya.svg
  ['eus-gi', 'Gipuzkoa', 'eus', 'wiki'], // Flag_of_Guipúzcoa.svg
  ['eus-lap', 'Lapurdi', 'eus', 'wiki'], // Flag_of_Lapurdi.svg
  ['eus-zub', 'Zuberoa', 'eus', 'wiki'], // Flag_of_Zuberoa.svg
  // Históricas
  ['his-rep2', 'II República Española', 'his', 'wiki'], // Flag_of_Spain_(1931–1939).svg
  ['his-borg', 'Cruz de Borgoña (Imperio español)', 'his', 'wiki'], // Flag_of_Cross_of_Burgundy.svg
  ['his-cast', 'Corona de Castilla', 'his', 'wiki', { zoom: 1.32, from: 'left' }], // Royal_Banner_of_the_Crown_of_Castille_(15th_Century_Style).svg
  ['his-leon', 'Reino de León', 'his', 'wiki', { zoom: 1.32, from: 'left' }], // Royal_Banner_of_León.svg
  ['his-arag', 'Corona de Aragón', 'his', 'fi:es-ct'], // la senyera real
  ['his-nav', 'Reino de Navarra', 'his', 'wiki'], // Bandera_de_Reino_de_Navarra.svg
  ['his-roma', 'Imperio romano', 'his', 'wiki'], // Vexilloid_of_the_Roman_Empire.svg
  ['his-oto', 'Imperio otomano', 'his', 'wiki'], // Flag_of_the_Ottoman_Empire_(1844–1922).svg
  ['his-ahu', 'Austria-Hungría', 'his', 'wiki'], // Flag_of_Austria-Hungary_(1869-1918).svg
  ['his-pru', 'Reino de Prusia', 'his', 'wiki'], // Flag_of_Prussia_(1892-1918).svg
  ['his-urss', 'Unión Soviética', 'his', 'wiki'], // Flag_of_the_Soviet_Union.svg
  ['his-yug', 'Yugoslavia', 'his', 'wiki'], // Flag_of_Yugoslavia_(1946-1992).svg
  // Naciones y regiones
  ['gb-eng', 'Inglaterra', 'reg', 'fi:gb-eng'],
  ['gb-sct', 'Escocia', 'reg', 'fi:gb-sct'],
  ['gb-wls', 'Gales', 'reg', 'fi:gb-wls'],
  ['gb-nir', 'Irlanda del Norte', 'reg', 'fi:gb-nir'],
  ['reg-bre', 'Bretaña', 'reg', 'wiki'], // Flag_of_Brittany.svg
  ['reg-cor', 'Córcega', 'reg', 'wiki'], // Flag_of_Corsica.svg
  ['reg-occ', 'Occitania', 'reg', 'wiki'], // Flag_of_Occitania.svg
  ['reg-sar', 'Cerdeña', 'reg', 'wiki'], // Flag_of_Sardinia,_Italy.svg
  ['reg-sic', 'Sicilia', 'reg', 'wiki'], // Sicilian_Flag.svg
  ['reg-bav', 'Baviera', 'reg', 'wiki'], // Flag_of_Bavaria_(lozengy).svg
  ['reg-baq', 'Baviera (franjas)', 'reg', 'wiki'], // Flag_of_Bavaria_(striped).svg
  ['reg-fla', 'Flandes', 'reg', 'wiki'], // Flag_of_Flanders.svg
  ['reg-wal', 'Valonia', 'reg', 'wiki'], // Flag_of_Wallonia.svg
  ['reg-que', 'Quebec', 'reg', 'wiki'], // Flag_of_Quebec.svg
  ['reg-cal', 'California', 'reg', 'wiki'], // Flag_of_California.svg
  ['reg-tex', 'Texas', 'reg', 'wiki'], // Flag_of_Texas.svg
  ['reg-kur', 'Kurdistán', 'reg', 'wiki'], // Flag_of_Kurdistan.svg
  ['reg-tib', 'Tíbet', 'reg', 'wiki'], // Flag_of_Tibet.svg
  // Organizaciones
  ['eu', 'Unión Europea', 'org', 'fi:eu'],
  ['un', 'Naciones Unidas', 'org', 'fi:un'],
];

// Códigos de flag-icons que no son países elegibles
const SKIP = new Set(['xx', 'pc', 'arab', 'asean', 'cefta', 'eac', 'bv', 'hm', 'cp', 'dg', 'um', 'sj', 'io', 'tf', 'ic', 'eu', 'un', 'es-ct', 'es-ga', 'es-pv', 'gb-eng', 'gb-sct', 'gb-wls', 'gb-nir', 'sh-ac', 'sh-hl', 'sh-ta']);

// Nombres más cortos o más claros que los de Intl
const NAMES = {
  hk: 'Hong Kong', mo: 'Macao', ps: 'Palestina', us: 'Estados Unidos', gb: 'Reino Unido', ax: 'Åland', bq: 'Caribe neerlandés',
  cd: 'R. D. del Congo', cg: 'Congo', kp: 'Corea del Norte', kr: 'Corea del Sur', ci: 'Costa de Marfil', tl: 'Timor Oriental', va: 'Vaticano',
  xk: 'Kosovo', eh: 'Sáhara Occidental', mk: 'Macedonia del Norte', cz: 'Chequia', aq: 'Antártida',
};

/** Medidas del SVG (width/height o viewBox) y la versión grande para pintarla nítida. */
function prepare(svg) {
  const head = svg.slice(svg.indexOf('<svg'), svg.indexOf('>', svg.indexOf('<svg')) + 1);
  const attr = (n) => {
    const m = head.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`));
    return m ? m[1] : null;
  };
  const num = (v) => (v && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : NaN);
  let w = num(attr('width'));
  let h = num(attr('height'));
  const vb = attr('viewBox');
  let box = vb ? vb.trim().split(/[\s,]+/).map(Number) : null;
  if ((!w || !h) && box) [w, h] = [box[2], box[3]];
  if (!w || !h) [w, h] = [640, 480];
  if (!box) box = [0, 0, w, h];
  const H = 720;
  const W = Math.round((H * w) / h);
  let tag = head.replace(/\s(width|height)\s*=\s*["'][^"']*["']/g, '');
  if (!vb) tag = tag.replace('<svg', `<svg viewBox="${box.join(' ')}"`);
  tag = tag.replace('<svg', `<svg width="${W}" height="${H}" preserveAspectRatio="none"`);
  return { svg: svg.replace(head, tag), w: W, h: H };
}

async function main() {
  const [fiDir, wikiDir] = process.argv.slice(2);
  if (!fiDir || !wikiDir) {
    console.error('Uso: node herramientas/banderas-extra.cjs <carpeta flag-icons 4x3> <carpeta wikimedia>');
    process.exit(1);
  }
  const main = fs.readFileSync(path.join(ROOT, 'src', 'banderas.js'), 'utf8');
  const mainIndex = JSON.parse(main.match(/FLAG_INDEX = (\{.*?\});/)[1]);
  const dn = new Intl.DisplayNames(['es'], { type: 'region' });
  const nameOf = (code) => NAMES[code] || dn.of(code.toUpperCase());

  // Países que no están en el atlas de los mapas (de flag-icons)
  const countries = fs
    .readdirSync(fiDir)
    .map((f) => f.replace(/\.svg$/, ''))
    .filter((c) => /^[a-z]{2}$/.test(c) && !Object.hasOwn(mainIndex, c) && !SKIP.has(c))
    .sort();
  const items = [];
  for (const c of countries) items.push({ id: c, name: nameOf(c), group: 'pais', file: path.join(fiDir, `${c}.svg`) });
  for (const [id, name, group, src, crop] of EXTRA) {
    const file = src.startsWith('fi:') ? path.join(fiDir, `${src.slice(3)}.svg`) : path.join(wikiDir, `${id}.svg`);
    if (!fs.existsSync(file)) {
      console.warn(`Falta ${id} (${file}): no se incluye`);
      continue;
    }
    items.push({ id, name, group, file, crop });
  }
  const flags = items.map((it) => ({ id: it.id, crop: it.crop || null, ...prepare(fs.readFileSync(it.file, 'utf8')) }));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const result = await page.evaluate(
    async ({ flags, CELL_W, CELL_H, COLS }) => {
      const rows = Math.ceil(flags.length / COLS);
      const canvas = document.createElement('canvas');
      canvas.width = CELL_W * COLS;
      canvas.height = CELL_H * rows;
      const ctx = canvas.getContext('2d');
      // Paso intermedio: de 720 px de alto a 4 veces la celda (y de ahí a la celda), sin dientes
      const mid = document.createElement('canvas');
      mid.width = CELL_W * 4;
      mid.height = CELL_H * 4;
      const m = mid.getContext('2d');
      m.imageSmoothingQuality = 'high';
      ctx.imageSmoothingQuality = 'high';
      const index = {};
      const failed = [];
      for (let i = 0; i < flags.length; i++) {
        const f = flags[i];
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(f.svg);
        try {
          await img.decode();
        } catch {
          failed.push(f.id);
          continue;
        }
        // Recorte al centro a 4:3 (sin deformar la bandera)
        const r = CELL_W / CELL_H;
        let sw = f.w;
        let sh = f.h;
        if (sw / sh > r) sw = sh * r;
        else sh = sw / r;
        // Pendones con la punta curva: más cerca y desde el asta
        const z = f.crop ? f.crop.zoom || 1 : 1;
        sw /= z;
        sh /= z;
        const sx = f.crop && f.crop.from === 'left' ? 0 : (f.w - sw) / 2;
        m.clearRect(0, 0, mid.width, mid.height);
        m.drawImage(img, sx, (f.h - sh) / 2, sw, sh, 0, 0, mid.width, mid.height);
        const n = Object.keys(index).length;
        ctx.drawImage(mid, (n % COLS) * CELL_W, Math.floor(n / COLS) * CELL_H, CELL_W, CELL_H);
        index[f.id] = n;
      }
      return { url: canvas.toDataURL('image/webp', 0.88), index, failed };
    },
    { flags, CELL_W, CELL_H, COLS },
  );
  await browser.close();
  if (result.failed.length) console.warn(`No se han podido pintar: ${result.failed.join(', ')}`);

  // Catálogo: todas las banderas elegibles (las de los mapas y las nuevas)
  const catalog = [];
  for (const code of Object.keys(mainIndex).sort()) catalog.push([code, nameOf(code), 'pais']);
  for (const it of items) if (Object.hasOwn(result.index, it.id)) catalog.push([it.id, it.name, it.group]);
  const order = { es: 0, eus: 1, his: 2, reg: 3, pais: 4, org: 5 };
  catalog.sort((a, b) => order[a[2]] - order[b[2]] || (a[2] === 'pais' ? a[1].localeCompare(b[1], 'es') : 0));

  const out = `// GENERADO por herramientas/banderas-extra.cjs — no editar a mano.
// Banderas de flag-icons (https://github.com/lipis/flag-icons), licencia MIT
// © Panayiotis Lipiridis, y de Wikimedia Commons (símbolos oficiales y
// banderas históricas, dominio público). Ver herramientas/LICENCIAS.md.
export const EXTRA_W = ${CELL_W};
export const EXTRA_H = ${CELL_H};
export const EXTRA_COLS = ${COLS};
export const EXTRA_INDEX = ${JSON.stringify(result.index)};
/** Todas las banderas que se pueden elegir: [id, nombre, grupo]. */
export const FLAG_CATALOG = ${JSON.stringify(catalog)};
export const EXTRA_SPRITE = ${JSON.stringify(result.url)};
`;
  fs.writeFileSync(path.join(ROOT, 'src', 'banderas-extra.js'), out);
  console.log(`src/banderas-extra.js: ${Object.keys(result.index).length} banderas nuevas (${Math.round(result.url.length / 1024)} KB), ${catalog.length} en el catálogo`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
