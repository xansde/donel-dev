// Ledger no celular — os arquivos da PWA, embutidos no bundle do main (`?raw` do Vite). Não têm dado
// nenhum: saem sem token. O que é do dono vem só por /api, com token.

import type { MobileAsset } from './server';
import indexHtml from './pwa/index.html?raw';
import appJs from './pwa/app.js?raw';
import appCss from './pwa/app.css?raw';
import manifest from './pwa/manifest.webmanifest?raw';
import icon from './pwa/icon.svg?raw';

export const PWA_ASSETS: Readonly<Record<string, MobileAsset>> = {
  '/index.html': { contentType: 'text/html; charset=utf-8', body: indexHtml },
  '/app.js': { contentType: 'text/javascript; charset=utf-8', body: appJs },
  '/app.css': { contentType: 'text/css; charset=utf-8', body: appCss },
  '/manifest.webmanifest': { contentType: 'application/manifest+json; charset=utf-8', body: manifest },
  '/icon.svg': { contentType: 'image/svg+xml', body: icon },
};
