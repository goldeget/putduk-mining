import { z } from "zod";
import {
  processPushDeliveryBatch,
  type PushPayload,
  type PushSubscription,
  type PushTransportResult,
} from "./push-delivery.mjs";
import { readSafeModeDecision } from "../lib/safe-mode/component-pause.mjs";

export interface RuntimeClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: unknown }>;
}
const uuid = z.uuid();
export const dueJobSchema = z
  .strictObject({
    memberId: uuid,
    roundId: uuid,
    dueAt: z.iso.datetime({ offset: true }),
    generation: uuid,
  })
  .refine((job) => job.generation === job.roundId);
export type DueJob = z.infer<typeof dueJobSchema>;
export async function runtimeRpc(
  client: RuntimeClient,
  operation: string,
  input: Record<string, unknown>,
) {
  const result = await client.rpc("workroom_app_worker", {
    p_operation: operation,
    p_input: input,
  });
  if (result.error) throw new Error(`WORKROOM_${operation}_FAILED`);
  return result.data;
}
export async function readWorkroomDueJobs(
  client: RuntimeClient,
  memberId?: string,
): Promise<DueJob[]> {
  const input = {
    limit: 100,
    ...(memberId ? { memberId: uuid.parse(memberId) } : {}),
  };
  const value = z
    .strictObject({ jobs: z.array(dueJobSchema).max(100) })
    .safeParse(await runtimeRpc(client, "DUE", input));
  if (
    !value.success ||
    value.data.jobs.some((job) => memberId && job.memberId !== memberId)
  )
    throw new Error("WORKROOM_DUE_INVALID");
  return value.data.jobs;
}
export async function recoverWorkroomJobs(
  client: RuntimeClient,
  scope: { memberId?: string; roundId?: string } = {},
) {
  const input = {
    limit: 100,
    ...(scope.memberId ? { memberId: uuid.parse(scope.memberId) } : {}),
    ...(scope.roundId ? { roundId: uuid.parse(scope.roundId) } : {}),
  };
  const result = z
    .strictObject({ settled: z.number().int().min(0).max(100) })
    .safeParse(await runtimeRpc(client, "RECOVER", input));
  if (!result.success) throw new Error("WORKROOM_RECOVER_INVALID");
  return result.data.settled;
}
/** Preserve the audited claim/envelope/lease/admission protocol; only the RPC routing changes. */
export async function dispatchWorkroomPush(
  client: RuntimeClient,
  options: {
    workerId: string;
    transport: (
      subscription: PushSubscription,
      payload: PushPayload,
    ) => Promise<PushTransportResult>;
    batchSize?: number;
  },
) {
  const decision = await readSafeModeDecision(client, "NOTIFICATION");
  if (decision === "UNKNOWN")
    throw new Error("WORKROOM_PUSH_SAFE_MODE_UNKNOWN");
  if (decision === "PAUSED")
    return {
      claimed: 0,
      accepted: 0,
      expired: 0,
      retried: 0,
      cancelled: 0,
      failed: 0,
      unknown: 0,
      deviceDisplayVerified: false as const,
    };
  const adapter: RuntimeClient = {
    rpc: async (name, args) => {
      const mapping = {
        claim_notification_push_deliveries: [
          "CLAIM_PUSH",
          { workerId: args.p_worker_id, leaseSeconds: args.p_lease_seconds },
        ],
        check_push_delivery_admission: [
          "ADMIT_PUSH",
          {
            workerId: args.p_worker_id,
            deliveryId: args.p_delivery_id,
            leaseToken: args.p_lease_token,
            attempt: args.p_attempt,
          },
        ],
        settle_notification_push_delivery: [
          "ACK_PUSH",
          {
            workerId: args.p_worker_id,
            deliveryId: args.p_delivery_id,
            leaseToken: args.p_lease_token,
            attempt: args.p_attempt,
            status: args.p_status,
            httpStatus: args.p_http_status,
            errorCode: args.p_error_code,
          },
        ],
      } as const;
      const mapped = mapping[name as keyof typeof mapping];
      if (!mapped) throw new Error("WORKROOM_PUSH_RPC_REJECTED");
      return client.rpc("workroom_app_worker", {
        p_operation: mapped[0],
        p_input: mapped[1],
      });
    },
  };
  return {
    ...(await processPushDeliveryBatch(adapter, {
      ...options,
      batchSize: options.batchSize ?? 5,
      leaseSeconds: 60,
    })),
    deviceDisplayVerified: false as const,
  };
}

export interface MemberAlarmNamespace {
  getByName(name: string): { arm(memberId: string): Promise<unknown> };
}
export async function scheduleWorkroomJobs(
  client: RuntimeClient,
  alarms: MemberAlarmNamespace,
  memberId?: string,
) {
  const jobs = await readWorkroomDueJobs(client, memberId);
  let scheduled = 0;
  // Leave room for service RPCs, DNS, and encrypted sends under Free Worker
  // per-invocation subrequest limits. RECOVER remains authoritative for all due
  // jobs, and START independently arms its own member immediately.
  for (const owner of [...new Set(jobs.map((job) => job.memberId))].slice(
    0,
    8,
  )) {
    await alarms.getByName(owner).arm(owner);
    scheduled += 1;
  }
  return scheduled;
}
