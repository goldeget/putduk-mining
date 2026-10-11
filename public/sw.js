/* global self, clients, caches */
const CACHE_NAME = "putduk-shell-v6";
const APP_SHELL = [
  "/offline",
  "/brand/favicon/favicon.svg",
  "/brand/pwa/putduk-pwa-dark-192.png",
  "/brand/mascot/putduk-miner-384-v1.webp",
];
const exactRoutes = new Set([
  "/",
  "/home",
  "/start",
  "/mining",
  "/wallet",
  "/wallet/deposit",
  "/wallet/withdraw",
  "/products",
  "/products/allocation",
  "/events",
  "/notifications",
  "/menu",
  "/menu/account",
  "/menu/notifications",
  "/support",
  "/ai",
]);
function safeDeepLink(value) {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\%?#\s\u0000-\u001f\u007f]/.test(value)
  )
    return null;
  return exactRoutes.has(value) ||
    /^\/events\/(?:notices\/)?[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    ? value
    : null;
}
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("putduk-shell-") && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        async () =>
          (await caches.match("/offline")) ??
          new Response("연결을 확인한 뒤 다시 열어 주세요.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      ),
    );
  } else if (
    !url.search &&
    APP_SHELL.includes(url.pathname) &&
    url.pathname !== "/offline"
  ) {
    // Exact public artwork only. No private API, account, auth, query or chunk caching.
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then(
          async (cache) =>
            (await cache.match(event.request)) ?? fetch(event.request),
        ),
    );
  }
});
self.addEventListener("push", (event) => {
  let input = null;
  try {
    input = event.data?.json();
  } catch {
    /* Generic privacy-preserving body. */
  }
  const id =
    typeof input?.notificationId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      input.notificationId,
    )
      ? input.notificationId.toLowerCase()
      : null;
  const url = safeDeepLink(input?.url) ?? "/notifications";
  event.waitUntil(
    self.registration.showNotification("퍼뜩 채굴", {
      body: "새로운 알림이 도착했습니다. 앱에서 확인해 주세요.",
      icon: "/brand/pwa/putduk-pwa-dark-192.png",
      badge: "/brand/notification/putduk-notification-badge-96.png",
      ...(id ? { tag: "putduk:" + id } : {}),
      data: { url },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeDeepLink(event.notification.data?.url) ?? "/notifications";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const existing = windows.find((client) => {
          try {
            return (
              new URL(client.url).origin === self.location.origin &&
              "navigate" in client &&
              "focus" in client
            );
          } catch {
            return false;
          }
        });
        if (existing) {
          const navigated = await existing.navigate(target);
          if (navigated) return navigated.focus();
        }
        return clients.openWindow(target);
      }),
  );
});
