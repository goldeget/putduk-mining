const parameters = new URLSearchParams(window.location.search);
const listeners = new Set();
export const fixtureState = {
  calls: [],
  networkMode: parameters.get("network") ?? "throw",
  sdkMode: parameters.get("sdk") ?? "ready",
  actionDelayMs: 0,
  phoneMode: parameters.get("phone") ?? "error",
  ready: false,
  emitAuth(event) {
    for (const listener of listeners) listener(event);
  },
};
window.__PUTDUK_FIXTURE__ = fixtureState;

export function recordMockCall(operation) {
  // Never retain passwords, TOTP codes, request bodies or personal identifiers.
  fixtureState.calls.push({ operation, at: performance.now() });
}

export function listenToMockAuth(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function installFixtureBoundary() {
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : (input.url ?? String(input));
    const parsed = new URL(url, window.location.origin);
    recordMockCall(`fetch:${init?.method ?? "GET"}:${parsed.pathname}`);
    if (fixtureState.networkMode === "stall") {
      return new Promise((_resolve, reject) => {
        const abort = () =>
          reject(new DOMException("Fixture request aborted", "AbortError"));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    if (fixtureState.networkMode === "throw")
      throw new TypeError("LOCAL_FIXTURE_NETWORK_FAILURE");
    if (fixtureState.networkMode === "malformed")
      return new Response("invalid", { status: 502 });
    if (fixtureState.networkMode === "json-stall")
      return { ok: true, json: () => new Promise(() => {}) };
    if (parsed.pathname === "/api/v1/admin/session/mfa-confirmed") {
      return Response.json({
        data: {
          recorded: true,
          adminSessionId: "00000000-0000-4000-8000-000000000002",
        },
      });
    }
    if (parsed.pathname === "/api/v1/admin/session/step-up") {
      const body = JSON.parse(init?.body ?? "{}");
      return Response.json({
        data: {
          token: "fixture-only-invalid-outside-this-harness",
          commandFamily:
            fixtureState.networkMode === "wrong-family"
              ? "SAFE_MODE"
              : body.commandFamily,
        },
      });
    }
    return Response.json(
      { error: { code: "LOCAL_FIXTURE_COMMAND_BLOCKED" } },
      { status: 503 },
    );
  };
}
