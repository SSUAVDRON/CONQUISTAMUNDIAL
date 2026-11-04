// Genera src/banderas.js: todas las banderas en una sola imagen (sprite WebP)
// más un índice por código ISO. Herramienta de desarrollo: usa Playwright.
//
//   node herramientas/banderas.cjs <carpeta con los SVG 4x3 de flag-icons>
//
// Las banderas salen de flag-icons (https://github.com/lipis/flag-icons),
// licencia MIT © Panayiotis Lipiridis. Ver herramientas/LICENCIAS.md.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const CELL_W = 48;
const CELL_H = 36;
const COLS = 16;

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Uso: node herramientas/banderas.cjs <carpeta con los SVG>');
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter((f) => /^[a-z]{2}\.svg$/.test(f)).sort();
  const flags = files.map((f) => ({ code: f.slice(0, 2), svg: fs.readFileSync(path.join(dir, f), 'utf8') }));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const result = await page.evaluate(
    async ({ flags, CELL_W, CELL_H, COLS }) => {
      const rows = Math.ceil(flags.length / COLS);
      const canvas = document.createElement('canvas');
      canvas.width = CELL_W * COLS;
      canvas.height = CELL_H * rows;
      const ctx = canvas.getContext('2d');
      const index = {};
      for (let i = 0; i < flags.length; i++) {
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(flags[i].svg);
        await img.decode();
        ctx.drawImage(img, (i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H, CELL_W, CELL_H);
        index[flags[i].code] = i;
      }
      return { url: canvas.toDataURL('image/webp', 0.9), index };
    },
    { flags, CELL_W, CELL_H, COLS },
  );
  await browser.close();

  const out = `// GENERADO por herramientas/banderas.cjs — no editar a mano.
// Banderas de flag-icons (https://github.com/lipis/flag-icons), licencia MIT
// © Panayiotis Lipiridis. Ver herramientas/LICENCIAS.md.
export const FLAG_W = ${CELL_W};
export const FLAG_H = ${CELL_H};
export const FLAG_COLS = ${COLS};
export const FLAG_INDEX = ${JSON.stringify(result.index)};
export const FLAG_SPRITE = ${JSON.stringify(result.url)};
`;
  const target = path.join(__dirname, '..', 'src', 'banderas.js');
  fs.writeFileSync(target, out);
  console.log(`${flags.length} banderas → src/banderas.js (${Math.round(Buffer.byteLength(out) / 1024)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
