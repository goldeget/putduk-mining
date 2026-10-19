import { listenToMockAuth } from "../safety";

/**
 * Local-only stand-in for the member Supabase browser client. It reports the
 * fixture owner as the signed-in browser session; no network or token exists.
 */
export function createSupabaseBrowserClient() {
  return {
    auth: {
      onAuthStateChange(callback) {
        const owner =
          new URLSearchParams(window.location.search).get("owner") ??
          "fixture-owner";
        const initial = setTimeout(
          () => callback("INITIAL_SESSION", { user: { id: owner } }),
          30,
        );
        const stopListening = listenToMockAuth((event) =>
          callback(
            event,
            event === "SIGNED_OUT" ? null : { user: { id: owner } },
          ),
        );
        return {
          data: {
            subscription: {
              unsubscribe() {
                clearTimeout(initial);
                stopListening();
              },
            },
          },
        };
      },
    },
  };
}
