// Ledger no celular — os arquivos da PWA, embutidos no bundle do main (`?raw` do Vite). Não têm dado
// nenhum: saem sem token. O que é do dono vem só por /api, com token.

import type { MobileAsset } from './server';
import indexHtml from './pwa/index.html?raw';
import appJs from './pwa/app.js?raw';
import pedirJs from './pwa/pedir.js?raw';
import appCss from './pwa/app.css?raw';
import manifest from './pwa/manifest.webmanifest?raw';
import icon from './pwa/icon.svg?raw';
import serviceWorker from './pwa/sw.js?raw';

export const PWA_ASSETS: Readonly<Record<string, MobileAsset>> = {
  '/index.html': { contentType: 'text/html; charset=utf-8', body: indexHtml },
  '/app.js': { contentType: 'text/javascript; charset=utf-8', body: appJs },
  // Pedir pelo Oráculo: o pedido solto ao Líder (texto ou voz), à parte do baralho.
  '/pedir.js': { contentType: 'text/javascript; charset=utf-8', body: pedirJs },
  '/app.css': { contentType: 'text/css; charset=utf-8', body: appCss },
  '/manifest.webmanifest': { contentType: 'application/manifest+json; charset=utf-8', body: manifest },
  '/icon.svg': { contentType: 'image/svg+xml', body: icon },
  // Aviso no celular: o service worker mostra o aviso com o app fechado (só funciona no endereço https).
  '/sw.js': { contentType: 'text/javascript; charset=utf-8', body: serviceWorker },
};
