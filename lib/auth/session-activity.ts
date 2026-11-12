/** Activity only refreshes an already-authorized server session; it never grants access. */
export function createSessionActivity({
  send,
  isVisible,
  now = Date.now,
}: {
  send: () => Promise<void>;
  isVisible: () => boolean;
  now?: () => number;
}) {
  let lastActivity = now();
  let lastAttempt = lastActivity;
  let pending = false;
  let stopped = false;
  return {
    recordActivity() {
      if (!stopped && isVisible()) lastActivity = now();
    },
    async tick() {
      const at = now();
      if (
        stopped ||
        pending ||
        !isVisible() ||
        at - lastActivity > 90_000 ||
        at - lastAttempt < 60_000
      )
        return;
      pending = true;
      lastAttempt = at;
      try {
        await send();
      } catch {
        // A temporary connection failure must not sign out or discard a form.
      } finally {
        pending = false;
      }
    },
    stop() {
      stopped = true;
    },
  };
}
