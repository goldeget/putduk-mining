export type PushTransportResult = {
  status: string;
  httpStatus: number | null;
};

export type PushSubscription = {
  endpoint: string;
  p256dh: string;
  authSecret: string;
};

export type PushPayload = {
  notificationId: string;
  title: "퍼뜩";
  body: "새 알림을 확인해 주세요.";
  route: "/notifications";
};

export function processPushDeliveryBatch(
  client: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data?: unknown; error?: unknown }>;
  },
  options: {
    workerId: string;
    transport: (
      subscription: PushSubscription,
      payload: PushPayload,
    ) => Promise<PushTransportResult>;
    batchSize?: number;
    leaseSeconds?: number;
  },
): Promise<{
  claimed: number;
  accepted: number;
  expired: number;
  retried: number;
  cancelled: number;
  failed: number;
  unknown: number;
}>;
