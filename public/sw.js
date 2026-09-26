/* global self, clients */

const CACHE_NAME = "putduk-shell-v2";
const APP_SHELL = ["/offline", "/icons/putduk-mark.svg"];

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
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") {
    return;
  }

  event.respondWith(fetch(event.request).catch(() => caches.match("/offline")));
});

self.addEventListener("push", (event) => {
  const fallback = {
    title: "퍼뜩 채굴",
    body: "새로운 알림이 도착했습니다.",
    url: "/",
  };

  let payload = fallback;
  try {
    payload = { ...fallback, ...event.data?.json() };
  } catch {
    payload = fallback;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/putduk-mark.svg",
      badge: "/icons/putduk-mark.svg",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedPath = event.notification.data?.url;
  const safePath =
    typeof requestedPath === "string" &&
    requestedPath.startsWith("/") &&
    !requestedPath.startsWith("//")
      ? requestedPath
      : "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const existing = windows.find((client) => "focus" in client);
        if (existing && "navigate" in existing) {
          return existing.navigate(safePath).then((client) => client?.focus());
        }
        return clients.openWindow(safePath);
      }),
  );
});
