// One-off: render docs/images/*.svg to matching .png files via headless chromium.
// Usage: node scripts/render-svg-to-png.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'docs', 'images');

// pnpm flattens playwright under node_modules/.pnpm; import by absolute path
// so this script works both under pnpm and npm installs.
async function loadPlaywright() {
  const repoRoot = path.resolve(__dirname, '..');
  const directPath = path.join(repoRoot, 'node_modules', 'playwright', 'index.mjs');
  const candidates = [directPath];
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (entry.startsWith('playwright@')) {
        candidates.push(path.join(pnpmDir, entry, 'node_modules', 'playwright', 'index.mjs'));
      }
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return import(pathToFileURL(c).href);
  }
  throw new Error('playwright not found in node_modules');
}

const { chromium } = await loadPlaywright();

const svgs = [
  { svg: 'fan-in-before-after.svg', png: 'fan-in-before-after.png', w: 1200, h: 640 },
  { svg: 'cycle-deferred-inbound.svg', png: 'cycle-deferred-inbound.png', w: 1200, h: 520 },
];

const browser = await chromium.launch();
for (const { svg, png, w, h } of svgs) {
  const content = fs.readFileSync(path.join(ROOT, svg), 'utf8');
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.setContent(
    `<html><body style="margin:0;padding:0;background:#fff">${content}</body></html>`
  );
  await page.screenshot({ path: path.join(ROOT, png), fullPage: true, omitBackground: false });
  await page.close();
  console.log(`wrote ${png}`);
}
await browser.close();
