import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RestrictionsPage from "@/app/(control)/restrictions/page";
import UsdtQueuePage from "@/app/(control)/withdrawals/usdt/page";

const reads = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown[]; error: unknown }>,
}));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminPage: vi.fn().mockResolvedValue({ role: "SUPER_ADMIN" }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: () => ({
    from(table: string) {
      const result = reads.tables[table] ?? { data: [], error: null };
      const query = {
        select: () => query,
        in: () => query,
        is: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return query;
    },
  }),
}));
vi.mock("@/app/(control)/restrictions/safe-mode-form", () => ({
  SafeModeForm: () => createElement("button", {}, "안전 모드 변경 테스트 표식"),
}));
vi.mock("@/app/(control)/withdrawals/usdt/forms", () => ({
  UsdtFinalizeForm: () => createElement("button", {}, "최종 반영 테스트 표식"),
  UsdtReleaseForm: () => createElement("button", {}, "보류 해제 테스트 표식"),
  UsdtSendForm: () => createElement("button", {}, "송금 테스트 표식"),
}));
beforeEach(() => {
  reads.tables = {};
});

describe("admin partial read recovery", () => {
  it("failed reads do not expose residual restriction or risk rows as current evidence", async () => {
    const error = { message: "fault-injected unavailable read" };
    reads.tables.safe_mode_controls = {
      data: [{ component: "MINING", is_paused: true }],
      error,
    };
    reads.tables.block_rules = {
      data: [
        {
          id: "stale-block",
          reason: "이전 제한 기록",
          starts_at: "2026-09-30T00:00:00Z",
        },
      ],
      error,
    };
    reads.tables.risk_flags = {
      data: [
        {
          id: "stale-risk",
          flag_code: "이전 위험 신호",
          created_at: "2026-09-30T00:00:00Z",
        },
      ],
      error,
    };
    const markup = renderToStaticMarkup(await RestrictionsPage());
    expect(markup).toContain('data-ui-state="partial"');
    expect(markup).toContain("확인 불가");
    expect(markup).not.toContain("이전 제한 기록");
    expect(markup).not.toContain("이전 위험 신호");
    expect(markup).not.toContain("제한 없음");
    expect(markup).not.toContain("위험 신호 없음");
    expect(markup).not.toContain("안전 모드 변경 테스트 표식");
  });
  it("safe mode read failure cannot say all normal or expose a change command", async () => {
    reads.tables.safe_mode_controls = {
      data: [],
      error: { message: "network" },
    };
    const markup = renderToStaticMarkup(await RestrictionsPage());
    expect(markup).toContain('data-ui-state="partial"');
    expect(markup).toContain("확인 불가");
    expect(markup).not.toContain("전부 정상");
    expect(markup).not.toContain("안전 모드 변경 테스트 표식");
  });
  it("missing crypto read is not evidence that an external transfer did not happen", async () => {
    reads.tables.withdrawal_requests = {
      data: [
        {
          id: "withdrawal-qa",
          user_id: "member-qa",
          amount_atomic: 1000,
          status: "PROCESSING",
          requested_at: "2026-09-30T00:00:00Z",
          destination_type: "USDT_ADDRESS",
          destination_snapshot: { network: "TRON" },
        },
      ],
      error: null,
    };
    reads.tables.crypto_withdrawals = {
      data: [],
      error: { message: "read failed" },
    };
    const markup = renderToStaticMarkup(await UsdtQueuePage());
    expect(markup).toContain('data-ui-state="partial"');
    expect(markup).toContain("송금 기록을 확인하지 못했습니다");
    for (const action of [
      "송금 테스트 표식",
      "최종 반영 테스트 표식",
      "보류 해제 테스트 표식",
    ])
      expect(markup).not.toContain(action);
  });
});
