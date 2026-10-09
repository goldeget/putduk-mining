import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  processOutboxBatch,
  stopAllLeaseRenewals,
  type WorkerOutboxEnvelope,
} from "../../workers/runner.mjs";

const id = "17500000-0000-4000-8000-000000000001";
const source: WorkerOutboxEnvelope = {
  id,
  event_type: "MEMBER_PROFILE_CAPTURED.v1",
  schema_version: 1,
  aggregate_type: "user_identity_profile",
  aggregate_id: id,
  attempt_count: 1,
  payload: {
    user_id: id,
    required_consent_versions: ["TERMS-KO-2026-09-27", "PRIVACY-KO-2026-09-27"],
    marketing_granted: false,
  },
};
function fixture(event: WorkerOutboxEnvelope, rejectOriginal = false) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_outbox_events") return { data: [event], error: null };
    if (name === "complete_outbox_event" && rejectOriginal)
      return { error: { message: "MEMBER_PROFILE_CAPTURE_ORIGINAL_INVALID" } };
    return { error: null };
  });
  return { rpc, db: { rpc } as unknown as SupabaseClient };
}
afterEach(stopAllLeaseRenewals);

describe("source-verified signup profile audit ACK", () => {
  it.each([false, true])(
    "preserves captured marketing %s and delegates only to canonical completion",
    async (marketing) => {
      const { rpc, db } = fixture({
        ...source,
        payload: { ...source.payload, marketing_granted: marketing },
      });
      expect(
        await processOutboxBatch(db, {
          workerId: "profile-audit-worker",
          batchSize: 1,
        }),
      ).toEqual({
        claimed: 1,
        completed: 1,
        failed: 0,
        unsupported: 0,
      });
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "claim_outbox_events",
        "extend_outbox_event_lease",
        "complete_outbox_event",
      ]);
      expect(rpc).toHaveBeenLastCalledWith("complete_outbox_event", {
        p_event_id: id,
        p_worker_id: "profile-audit-worker",
      });
    },
  );
  it.each([
    { ...source, schema_version: 2 },
    { ...source, aggregate_id: "17500000-0000-4000-8000-000000000002" },
    { ...source, payload: { ...source.payload, marketing_granted: null } },
    { ...source, payload: { ...source.payload, originalVerified: true } },
    {
      ...source,
      payload: {
        ...source.payload,
        required_consent_versions: [
          "TERMS-KO-2026-09-27",
          "PRIVACY-KO-2026-09-27",
          "MARKETING-KO-2026-09-27",
        ],
      },
    },
  ])(
    "rejects incompatible profile envelope before canonical completion",
    async (event) => {
      const { rpc, db } = fixture(event);
      expect(
        (
          await processOutboxBatch(db, {
            workerId: "profile-audit-worker",
            batchSize: 1,
            randomUnit: 0,
          })
        ).completed,
      ).toBe(0);
      expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
        "complete_outbox_event",
      );
      expect(rpc).toHaveBeenLastCalledWith(
        "fail_outbox_event",
        expect.objectContaining({
          p_error_code: "MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID",
        }),
      );
    },
  );
  it("cannot treat a syntactically valid payload as a DB original", async () => {
    const { rpc, db } = fixture(source, true);
    expect(
      await processOutboxBatch(db, {
        workerId: "profile-audit-worker",
        batchSize: 1,
        randomUnit: 0,
      }),
    ).toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
      unsupported: 0,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "fail_outbox_event",
      expect.objectContaining({
        p_error_code: "MEMBER_PROFILE_CAPTURE_ORIGINAL_INVALID",
      }),
    );
  });
});
