// Minimal service worker — provides install/activate so the app is PWA-installable.
// We intentionally do NOT cache anything aggressively; this keeps updates instant
// and avoids stale assets on a frequently-changing dev build.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No-op pass-through. The browser handles the request normally.
});
