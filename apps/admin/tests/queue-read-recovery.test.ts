import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RestrictionsPage from "@/app/(control)/restrictions/page";
import {
  blockScopeLabel,
  blockSourceLabel,
} from "@/app/(control)/restrictions/safe-mode-policy";
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
  it("restriction scope and source do not show English codes", async () => {
    reads.tables.safe_mode_controls = { data: [], error: null };
    reads.tables.block_rules = {
      data: [
        {
          id: "block-account",
          scope: "ACCOUNT",
          source: "MANUAL",
          reason: "반복 가입",
          user_id: null,
          starts_at: "2026-10-01T00:00:00Z",
          ends_at: null,
        },
        {
          id: "block-signup",
          scope: "SIGNUP",
          source: "현장 확인",
          reason: "가입 제한",
          user_id: null,
          starts_at: "2026-10-02T00:00:00Z",
          ends_at: null,
        },
        {
          id: "block-zero",
          scope: "DEVICE",
          source: "0",
          reason: "출처 없음",
          user_id: null,
          starts_at: "2026-10-03T00:00:00Z",
          ends_at: null,
        },
      ],
      error: null,
    };
    reads.tables.risk_flags = { data: [], error: null };
    const markup = renderToStaticMarkup(await RestrictionsPage());
    expect(blockScopeLabel("ACCOUNT")).toBe("확인할 수 없어요");
    expect(blockScopeLabel("IP_CIDR")).toBe("확인할 수 없어요");
    expect(blockScopeLabel("SIGNUP")).toBe("가입");
    expect(blockScopeLabel("TRIAL")).toBe("퍼뜩 시작");
    expect(blockSourceLabel("MANUAL")).toBe("확인할 수 없어요");
    expect(blockSourceLabel("0")).toBe("확인할 수 없어요");
    expect(blockSourceLabel("현장 확인")).toBe("현장 확인");
    expect(markup).not.toContain("ACCOUNT");
    expect(markup).not.toContain("MANUAL");
    expect(markup).not.toContain("DEVICE");
    expect(markup).not.toContain("<dd>0</dd>");
    expect(markup).toContain("반복 가입");
    expect(markup).toContain("현장 확인");
    expect(markup).toContain("가입 제한");
    expect(markup).toContain("출처 없음");
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
