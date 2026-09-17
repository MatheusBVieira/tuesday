/**
 * Gera o ícone do app (electron/build/icon.png, 512×512) a partir do logo: as três barras.
 * O electron-builder converte o PNG em .ico. Rodar de novo só se o desenho mudar: npm run desktop:icone.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, 'build/icon.png');
mkdirSync(dirname(target), { recursive: true });

// O mesmo desenho do Logo (grade de 32), centralizado num quadrado arredondado.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#ffffff"/>
  <g transform="translate(64 64) scale(12)">
    <rect x="3" y="5" width="7.5" height="22" rx="3.75" fill="#0073ea"/>
    <rect x="12.25" y="5" width="7.5" height="15" rx="3.75" fill="#00c875"/>
    <rect x="21.5" y="5" width="7.5" height="9" rx="3.75" fill="#fdab3d"/>
  </g>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.screenshot({ path: target, omitBackground: true });
await browser.close();
console.log(`ícone gerado em ${target}`);
