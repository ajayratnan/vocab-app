// Basic service worker for offline support
const CACHE_NAME = 'vocab-cache-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/flashcards.html',
  '/dashboard.html',
  '/admin.html',
  '/styles.css',
  '/script.js',
  '/manifest.json',
  '/data/default_words.csv',
  '/public/logo.png',
  '/public/icon-192x192.png',
  '/public/icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});