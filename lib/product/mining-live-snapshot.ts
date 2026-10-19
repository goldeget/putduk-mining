import { z } from "zod";
import { presentHomeCapacityProgress } from "./home-capacity-progress";
import {
  deriveLiveProjection,
  formatMicroKrwText,
  parseServerInstantMicros as instantMicros,
} from "./mining-live-projection";
import type { MiningServerDisplay } from "./mining-server-display";

const integerText = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(80);
const instant = z.string().datetime({ offset: true, precision: 6 });
const positiveIntegerText = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .max(80);
/** Opaque server-derived extrapolation bounds; never a rate, policy or formula. */
const miningLiveProjectionSchema = z
  .object({
    accruedMicroKrw: positiveIntegerText,
    windowMicros: positiveIntegerText,
    ceilingMicroKrw: integerText,
    horizonMicros: positiveIntegerText,
  })
  .strict();
export const miningLiveSnapshotSchema = z
  .object({
    scope: z.literal("GLOBAL_CYCLE"),
    cycleStartedAt: instant,
    cycleEnd: instant,
    stateRevision: integerText,
    conditionRevision: integerText,
    acceptedCursorAt: instant,
    evaluatedAt: instant,
    status: z.enum(["ACTIVE", "STOPPED"]),
    stopReason: z
      .enum([
        "NO_ACTIVE_ALLOCATION",
        "CAPACITY_USED",
        "SAFE_MODE",
        "FUNDING_BELOW_MINIMUM",
      ])
      .nullable(),
    pendingMicroKrw: integerText,
    committedKrw: integerText,
    capacityMicroKrw: integerText,
    usedMicroKrw: integerText,
    remainingMicroKrw: integerText,
    projection: miningLiveProjectionSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => {
    if (
      ![
        value.capacityMicroKrw,
        value.usedMicroKrw,
        value.remainingMicroKrw,
      ].every((amount) => /^(0|[1-9][0-9]*)$/.test(amount))
    )
      return false;
    const capacity = BigInt(value.capacityMicroKrw),
      used = BigInt(value.usedMicroKrw),
      remaining = BigInt(value.remainingMicroKrw);
    const start = instantMicros(value.cycleStartedAt),
      end = instantMicros(value.cycleEnd),
      accepted = instantMicros(value.acceptedCursorAt),
      evaluated = instantMicros(value.evaluatedAt);
    if (
      start === null ||
      end === null ||
      accepted === null ||
      evaluated === null
    )
      return false;
    return (
      used <= capacity &&
      remaining <= capacity &&
      used + remaining <= capacity &&
      capacity - used - remaining <= 1n &&
      (value.status === "ACTIVE") === (value.stopReason === null) &&
      start < end &&
      accepted <= evaluated &&
      evaluated >= start &&
      evaluated < end
    );
  });
export type MiningLiveSnapshot = z.infer<typeof miningLiveSnapshotSchema>;

/** Display refresh permission only; this never changes server mining status. */
export function canAutomaticallyReadMiningSnapshot(
  snapshot: MiningLiveSnapshot,
) {
  return (
    snapshot.status === "ACTIVE" &&
    BigInt(snapshot.capacityMicroKrw) > 0n &&
    BigInt(snapshot.remainingMicroKrw) > 0n &&
    BigInt(snapshot.usedMicroKrw) < BigInt(snapshot.capacityMicroKrw)
  );
}

/** Select existing server facts only; never send the private calculation inputs. */
export function toMiningLiveSnapshot(
  display: MiningServerDisplay | null,
): MiningLiveSnapshot | null {
  const runtime = display?.funded_runtime;
  if (!display?.available || runtime?.schema_version !== 2) return null;
  const parsed = miningLiveSnapshotSchema.safeParse({
    scope: "GLOBAL_CYCLE",
    cycleStartedAt: display.cycle_started_at,
    cycleEnd: display.cycle_end,
    stateRevision: runtime.state_revision,
    conditionRevision: runtime.condition_revision,
    acceptedCursorAt: runtime.accepted_cursor_at,
    evaluatedAt: runtime.evaluated_at,
    status: runtime.status,
    stopReason: runtime.stop_reason,
    pendingMicroKrw: display.pending_micro_krw,
    committedKrw: runtime.committed_reward_total_atomic,
    capacityMicroKrw: display.effective_capacity_micro_krw,
    usedMicroKrw: display.used_capacity_micro_krw,
    remainingMicroKrw: display.remaining_capacity_micro_krw,
    projection:
      deriveLiveProjection({
        status: runtime.status,
        pendingMicroKrw: display.pending_micro_krw ?? "",
        remainingMicroKrw: display.remaining_capacity_micro_krw ?? "",
        carry: {
          numerator: runtime.reward_carry.numerator,
          denominator: runtime.reward_carry.denominator,
        },
        acceptedCursorAt: runtime.accepted_cursor_at,
        evaluatedAt: runtime.evaluated_at,
        cycleEnd: display.cycle_end ?? "",
      }) ?? null,
  });
  return parsed.success ? parsed.data : null;
}

export function readMiningLiveEnvelope(value: unknown, ownerId: string) {
  const parsed = z
    .object({
      data: z
        .object({
          ownerId: z.string(),
          snapshot: z.unknown(),
        })
        .strict(),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success) return { ok: false, reason: "UNCONFIRMED" } as const;
  if (parsed.data.data.ownerId !== ownerId)
    return { ok: false, reason: "OWNER_MISMATCH" } as const;
  const snapshot = miningLiveSnapshotSchema
    .nullable()
    .safeParse(parsed.data.data.snapshot);
  if (!snapshot.success) return { ok: false, reason: "UNCONFIRMED" } as const;
  return { ok: true, snapshot: snapshot.data } as const;
}

/** Reject backwards or contradictory receipts; amounts may legitimately decrease. */
export function acceptMiningLiveSnapshot(
  previous: MiningLiveSnapshot | null,
  next: MiningLiveSnapshot,
): boolean {
  if (!previous) return true;
  if (
    previous.cycleStartedAt !== next.cycleStartedAt ||
    previous.cycleEnd !== next.cycleEnd
  )
    return false;
  if (
    BigInt(next.stateRevision) < BigInt(previous.stateRevision) ||
    BigInt(next.conditionRevision) < BigInt(previous.conditionRevision) ||
    instantMicros(next.acceptedCursorAt)! <
      instantMicros(previous.acceptedCursorAt)! ||
    instantMicros(next.evaluatedAt)! < instantMicros(previous.evaluatedAt)!
  )
    return false;
  if (
    next.evaluatedAt === previous.evaluatedAt &&
    JSON.stringify(next) !== JSON.stringify(previous)
  )
    return false;
  return true;
}

/** Unit formatting only; wallet formatting and withdrawal units remain unchanged. */
export function formatLiveMicroKrw(value: string): string {
  return formatMicroKrwText(value);
}

export function liveCapacityProgress(snapshot: MiningLiveSnapshot) {
  return presentHomeCapacityProgress({
    available: true,
    effective_capacity_micro_krw: snapshot.capacityMicroKrw,
    used_capacity_micro_krw: snapshot.usedMicroKrw,
    remaining_capacity_micro_krw: snapshot.remainingMicroKrw,
  } as MiningServerDisplay);
}
