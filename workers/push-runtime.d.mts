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
    /** safe_mode_controls 읽기용. 없으면 안전 모드를 확인할 수 없어 보내지 않는다. */
    from?: (table: string) => unknown;
  };
}): Promise<{
  claimed: number;
  accepted: number;
  expired: number;
  retried: number;
  cancelled: number;
  failed: number;
  unknown: number;
  /** 안전 모드로 멈춰 있어 아무것도 claim하지 않았다. */
  safeModePaused?: boolean;
}>;
