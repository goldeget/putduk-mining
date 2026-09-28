import {
  isChannelTalkE2EPluginKey,
  type SupportAppearance,
  type SupportBootOption,
  type SupportCommand,
} from "@/lib/support/channel-session";

export type ChannelTalkPort = {
  boot(option: SupportBootOption): Promise<void>;
  setAppearance(appearance: SupportAppearance): Promise<void>;
  setPage(page: string): Promise<void>;
  showMessenger(): Promise<void>;
  shutdown(): Promise<void>;
  track(name: "PageView"): Promise<void>;
};

declare global {
  interface Window {
    __PUTDUK_SUPPORT_PORT__?: ChannelTalkPort;
  }
}

export function resolveChannelTalkPort(
  pluginKey: string,
): ChannelTalkPort | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (isChannelTalkE2EPluginKey(pluginKey)) {
    return window.__PUTDUK_SUPPORT_PORT__ ?? null;
  }
  return createRealChannelTalkPort();
}

function createRealChannelTalkPort(): ChannelTalkPort {
  let loading: Promise<
    typeof import("@channel.io/channel-web-sdk-loader")
  > | null = null;

  const load = () => {
    loading ??= import("@channel.io/channel-web-sdk-loader").then((sdk) => {
      sdk.loadScript();
      return sdk;
    });
    return loading;
  };

  return {
    async boot(option) {
      const sdk = await load();
      await new Promise<void>((resolve, reject) => {
        sdk.boot(option, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    async setAppearance(appearance) {
      const sdk = await load();
      sdk.setAppearance(appearance);
    },
    async setPage(page) {
      const sdk = await load();
      sdk.setPage(page);
    },
    async showMessenger() {
      const sdk = await load();
      sdk.showMessenger();
    },
    async shutdown() {
      const sdk = await load();
      sdk.shutdown();
    },
    async track(name) {
      const sdk = await load();
      sdk.track(name);
    },
  };
}

export async function runSupportCommand(
  port: ChannelTalkPort,
  command: SupportCommand,
): Promise<void> {
  switch (command.type) {
    case "shutdown":
      await port.shutdown();
      return;
    case "boot":
      await port.boot(command.option);
      return;
    case "setPage":
      await port.setPage(command.page);
      return;
    case "track":
      await port.track(command.name);
      return;
    case "setAppearance":
      await port.setAppearance(command.appearance);
      return;
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}
