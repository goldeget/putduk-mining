/* global self, clients, caches */
const CACHE_NAME = "workroom-admin-public-v1";
const APP_SHELL = ["/offline.html", "/workroom-icon.svg"];
const exactRoutes = new Set(["/", "/notifications", "/support"]);
function safeDeepLink(value) {
  if (
    typeof value === "string" &&
    /^\/support\?thread=[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$/.test(
      value,
    )
  )
    return value;
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\%?#\s\u0000-\u001f\u007f]/.test(value)
  )
    return null;
  return exactRoutes.has(value) ? value : null;
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
              (key) =>
                key.startsWith("workroom-admin-public-") && key !== CACHE_NAME,
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
          (await caches.match("/offline.html")) ??
          new Response("연결을 확인한 뒤 다시 열어 주세요.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      ),
    );
  } else if (
    !url.search &&
    APP_SHELL.includes(url.pathname) &&
    url.pathname !== "/offline.html"
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
    /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$/.test(
      input.notificationId,
    )
      ? input.notificationId.toLowerCase()
      : null;
  const url = safeDeepLink(input?.url) ?? "/notifications";
  event.waitUntil(
    self.registration
      .showNotification("WORKROOM", {
        body: "새로운 알림이 도착했습니다. 앱에서 확인해 주세요.",
        icon: "/workroom-icon.svg",
        badge: "/workroom-icon.svg",
        ...(id ? { tag: "putduk:" + id } : {}),
        data: { url },
      })
      .then(() => {
        // A best-effort dot means an incoming event, never an invented unread count.
        return self.navigator?.setAppBadge?.().catch(() => undefined);
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
