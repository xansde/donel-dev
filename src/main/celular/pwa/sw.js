// Oráculo Harrow no celular — service worker dos avisos. O PC manda o aviso cifrado pelo serviço de push do
// navegador; aqui ele vira notificação mesmo com o app fechado. O toque abre a carta.
'use strict';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch (erro) {
    dados = {};
  }
  var titulo = typeof dados.title === 'string' && dados.title ? dados.title : 'Oráculo Harrow';
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: typeof dados.body === 'string' ? dados.body : 'Uma carta esperando você.',
      tag: typeof dados.tag === 'string' ? dados.tag : undefined,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: typeof dados.url === 'string' && dados.url.charAt(0) === '/' ? dados.url : '/' },
    }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var alvo = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (janelas) {
      for (var i = 0; i < janelas.length; i++) {
        if ('focus' in janelas[i]) {
          janelas[i].navigate(alvo);
          return janelas[i].focus();
        }
      }
      return self.clients.openWindow(alvo);
    }),
  );
});
