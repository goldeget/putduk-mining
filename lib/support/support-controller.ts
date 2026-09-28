import {
  parseChannelSession,
  planSupportSync,
  type ChannelSession,
  type SupportAppearance,
  type SupportSyncState,
} from "@/lib/support/channel-session";
import {
  resolveChannelTalkPort,
  runSupportCommand,
  type ChannelTalkPort,
} from "@/lib/support/channel-port";

export type SupportSyncRequest = {
  appearance: SupportAppearance;
  pathname: string;
  pluginKey: string;
  search: string;
};

const initialState = (): SupportSyncState => ({
  identityKey: null,
  page: null,
  appearance: null,
});

export function createSupportController(options: {
  fetchSession: () => Promise<unknown>;
  resolvePort?: (pluginKey: string) => ChannelTalkPort | null;
}) {
  const resolvePort = options.resolvePort ?? resolveChannelTalkPort;
  let state = initialState();
  let desired: SupportSyncRequest | null = null;
  let pumping = false;
  let booted = false;
  const listeners = new Set<() => void>();

  const publish = (next: boolean) => {
    if (booted === next) {
      return;
    }
    booted = next;
    for (const listener of listeners) {
      listener();
    }
  };

  async function apply(current: SupportSyncRequest, port: ChannelTalkPort) {
    let session: ChannelSession = { mode: "anonymous" };
    try {
      session = parseChannelSession(await options.fetchSession());
    } catch {
      session = { mode: "anonymous" };
    }
    if (desired) {
      return;
    }

    const plan = planSupportSync(state, {
      appearance: current.appearance,
      pathname: current.pathname,
      pluginKey: current.pluginKey,
      search: current.search,
      session,
    });

    for (const command of plan.commands) {
      if (desired) {
        try {
          port.shutdown();
        } catch {
          // 상담 중단 실패가 앱 흐름을 막지 않는다.
        }
        state = initialState();
        publish(false);
        return;
      }
      await runSupportCommand(port, command);
    }

    if (desired) {
      try {
        port.shutdown();
      } catch {
        // 새 요청이 이전 boot를 덮기 전에 신원을 지운다.
      }
      state = initialState();
      publish(false);
      return;
    }

    state = plan.next;
    publish(state.identityKey !== null);
  }

  async function pump() {
    if (pumping) {
      return;
    }
    pumping = true;
    try {
      while (desired) {
        const current = desired;
        desired = null;
        const port = resolvePort(current.pluginKey);
        if (!port) {
          state = initialState();
          publish(false);
          continue;
        }
        try {
          await apply(current, port);
        } catch {
          try {
            port.shutdown();
          } catch {
            // SDK 장애는 상담만 건너뛴다.
          }
          state = initialState();
          publish(false);
        }
      }
    } finally {
      pumping = false;
      if (desired) {
        void pump();
      }
    }
  }

  return {
    request(input: SupportSyncRequest) {
      desired = input;
      void pump();
    },
    snapshot() {
      return state;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isBooted() {
      return booted;
    },
  };
}
