import type { PushTransportResult } from "./push-delivery.mjs";
export function approvedLocalPushConfig(
  env?: Record<string, string | undefined>,
): {
  url: string;
  secret: string;
  vapid: { publicKey: string; privateKey: string; subject: string };
};
export function runApprovedLocalPush(options?: {
  env?: Record<string, string | undefined>;
  send?: (
    input: {
      endpoint: string;
      p256dh: string;
      authSecret: string;
      notificationId: string;
      deepLink: string;
    },
    config: { publicKey: string; privateKey: string; subject: string },
  ) => Promise<PushTransportResult>;
  client?: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data?: unknown; error?: unknown }>;
  };
}): Promise<{
  claimed: number;
  accepted: number;
  expired: number;
  retried: number;
  cancelled: number;
  failed: number;
  unknown: number;
}>;
