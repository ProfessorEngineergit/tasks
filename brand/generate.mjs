// Generates the OpenDone icon set.
//   node brand/generate.mjs          -> SVGs in brand/ and web/icons/
//   node brand/generate.mjs --png    -> also PNGs (needs Playwright + Chromium)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const C = {
  bgTop: '#18211C', bgBottom: '#0A0D0B',
  open: ['#1A4230', '#123020'], openEdge: '#2F6447',
  doing: ['#29A472', '#1B7A53'],
  done: ['#5CF2AE', '#2BD58C'],
  check: '#0A0D0B',
};

function tiles({ s, r, x0, g, yb, step, checkW = 0.15, id = '' }) {
  const t = [0, 1, 2].map(i => ({ x: x0 + i * (s + g), y: yb - i * step }));
  const [a, b, c] = t;
  const chk = `M${c.x + s * 0.24} ${c.y + s * 0.52} L${c.x + s * 0.44} ${c.y + s * 0.72} L${c.x + s * 0.77} ${c.y + s * 0.32}`;
  const grad = (n, [top, bottom]) =>
    `<linearGradient id="${n}${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
  const defs = grad('t1', C.open) + grad('t2', C.doing) + grad('t3', C.done);
  const body = `
  <rect x="${a.x}" y="${a.y}" width="${s}" height="${s}" rx="${r}" fill="url(#t1${id})"/>
  <rect x="${a.x + s * 0.007}" y="${a.y + s * 0.007}" width="${s * 0.986}" height="${s * 0.986}" rx="${r * 0.97}" fill="none" stroke="${C.openEdge}" stroke-opacity=".8" stroke-width="${s * 0.013}"/>
  <rect x="${b.x}" y="${b.y}" width="${s}" height="${s}" rx="${r}" fill="url(#t2${id})"/>
  <rect x="${b.x + s * 0.01}" y="${b.y + s * 0.01}" width="${s * 0.98}" height="${s * 0.18}" rx="${s * 0.09}" fill="#fff" opacity=".07"/>
  <rect x="${c.x}" y="${c.y}" width="${s}" height="${s}" rx="${r}" fill="url(#t3${id})"/>
  <rect x="${c.x + s * 0.01}" y="${c.y + s * 0.01}" width="${s * 0.98}" height="${s * 0.18}" rx="${s * 0.09}" fill="#fff" opacity=".14"/>
  <path d="${chk}" fill="none" stroke="${C.check}" stroke-width="${s * checkW}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return { defs, body };
}

const bgDefs = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bgTop}"/><stop offset="1" stop-color="${C.bgBottom}"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/></linearGradient>`;

function appIcon({ maskable = false } = {}) {
  // Maskable icons get a full-bleed background and a smaller motif (safe zone 80%).
  const scale = maskable ? 0.78 : 1;
  const s = 236 * scale, g = 30 * scale, step = 150 * scale;
  const T = tiles({ s, r: 60 * scale, g, step, x0: (1024 - (3 * s + 2 * g)) / 2, yb: 512 + step - s / 2 });
  const bg = maskable
    ? `<rect width="1024" height="1024" fill="url(#bg)"/>`
    : `<rect width="1024" height="1024" rx="232" fill="url(#bg)"/>
  <rect x="3" y="3" width="1018" height="1018" rx="229" fill="none" stroke="url(#rim)" stroke-width="6"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>${bgDefs}${T.defs}</defs>
  ${bg}${T.body}
</svg>\n`;
}

function favicon() {
  const s = 17, g = 2.5, step = 11.5;
  const T = tiles({ s, r: 5, g, step, x0: (64 - (3 * s + 2 * g)) / 2, yb: 32 + step - s / 2, checkW: 0.19 });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>${T.defs}</defs>
  <rect width="64" height="64" rx="14" fill="#0F1411"/>${T.body}
</svg>\n`;
}

function mark() {
  const s = 100, g = 13, step = 64;
  const T = tiles({ s, r: 26, g, step, x0: 0, yb: 2 * step });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${3 * s + 2 * g} ${s + 2 * step}">
  <defs>${T.defs}</defs>${T.body}
</svg>\n`;
}

const out = {
  'icon.svg': appIcon(),
  'icon-maskable.svg': appIcon({ maskable: true }),
  'favicon.svg': favicon(),
  'mark.svg': mark(),
};
const targets = [here, join(root, 'web', 'icons')];
for (const dir of targets) {
  mkdirSync(dir, { recursive: true });
  for (const [name, svg] of Object.entries(out)) writeFileSync(join(dir, name), svg);
}
console.log('SVGs written to', targets.map(d => d.replace(root + '/', '')).join(', '));

if (process.argv.includes('--png')) {
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pngs = [
    ['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512],
    ['icon-maskable.svg', 'icon-maskable-512.png', 512],
    ['icon-maskable.svg', 'apple-touch-icon.png', 180],
  ];
  for (const [src, name, size] of pngs) {
    await page.setViewportSize({ width: size, height: size });
    const data = Buffer.from(out[src]).toString('base64');
    await page.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml;base64,${data}" width="${size}" height="${size}">`);
    await page.waitForTimeout(100);
    const buf = await page.screenshot({ omitBackground: true });
    for (const dir of targets) writeFileSync(join(dir, name), buf);
  }
  await browser.close();
  console.log('PNGs written');
}
