import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  presentMemberLifecycle,
  presentMemberProfile,
} from "@/app/(control)/members/_lib/member-state-display";
import MembersPage from "@/app/(control)/members/page";

const readyMiningDisplay = {
  available: true,
  eligible_principal_micro_krw: "100000000000",
  tier_code: null,
  tier_activated: false,
  cycle_started_at: null,
  cycle_end: null,
  effective_capacity_micro_krw: null,
  remaining_capacity_micro_krw: null,
  used_capacity_micro_krw: null,
  speed_multiplier_bps: null,
  pending_micro_krw: "15000000000",
  retention_unconfirmed_micro_krw: "25000000000",
};
const reads = vi.hoisted(() => ({
  tables: {} as Record<
    string,
    { data: unknown; error: unknown; count?: number }
  >,
  miningDisplay: {
    data: null as unknown,
    error: null as unknown,
  },
}));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminPage: vi.fn().mockResolvedValue({ role: "SUPPORT" }),
}));
vi.mock("@/app/(control)/members/_lib/member-evidence", async () => ({
  ...(await import("@/app/(control)/members/_lib/member-evidence-labels")),
  countMemberMiningSessions: vi
    .fn()
    .mockResolvedValue({ count: 0, error: null }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: () => ({
    auth: {
      admin: {
        getUserById: () =>
          Promise.resolve({
            data: {
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                created_at: "2026-09-30T00:00:00Z",
              },
            },
            error: null,
          }),
      },
    },
    from(table: string) {
      const value = reads.tables[table] ?? { data: [], error: null, count: 0 };
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () => query,
        then: (resolve: (result: typeof value) => unknown) =>
          Promise.resolve(value).then(resolve),
      };
      return query;
    },
    rpc() {
      return Promise.resolve(reads.miningDisplay);
    },
  }),
}));
const lifecycle = {
  stage: "SIGNED_UP",
  first_funding_at: null,
  welcome_withdrawal_completed_at: null,
};
beforeEach(() => {
  reads.tables = {
    user_profiles: { data: { display_name: "테스트 회원" }, error: null },
    member_lifecycle_states: { data: lifecycle, error: null },
    money_source_summaries: {
      data: {
        user_id: "00000000-0000-4000-8000-000000000001",
        schema_version: 1,
        coverage: "COMPLETE",
        unclassified_wallet_entries: "0",
        unconnected_withdrawals: "0",
        unclassified_journals: "0",
        invalid_source_receipts: "0",
        eligible_principal_atomic: "0",
        recorded_krw_principal_deposits_atomic: "0",
        recorded_usdt_principal_credits_atomic: "0",
        recorded_bonus_atomic: "0",
        observed_at: "2026-10-03T08:30:00Z",
        capture_started_at: "2026-10-03T08:12:00Z",
      },
      error: null,
    },
  };
  reads.miningDisplay = { data: readyMiningDisplay, error: null };
});

describe("member lifecycle and profile read truth", () => {
  it.each([null, undefined])(
    "a missing lifecycle row is unknown, not signup or an absent event (%s)",
    (data) => {
      const value = presentMemberLifecycle({ data, error: null });
      expect(value).toEqual({
        available: false,
        stage: "확인 불가",
        firstFunding: "확인 불가",
        welcomeWithdrawal: "확인 불가",
      });
    },
  );
  it("a read error wins over residual data", () => {
    expect(
      presentMemberLifecycle({
        data: lifecycle,
        error: { message: "read failed" },
      }).stage,
    ).toBe("확인 불가");
    expect(
      presentMemberProfile({
        data: { display_name: "이전 이름" },
        error: { message: "read failed" },
      }).name,
    ).toBe("이름 확인 불가");
  });
  it("explicit null dates in a confirmed row can mean no event", () => {
    expect(presentMemberLifecycle({ data: lifecycle, error: null })).toEqual({
      available: true,
      stage: "가입",
      firstFunding: "없음",
      welcomeWithdrawal: "미완료",
    });
  });
  it("unrecognized stages remain unknown rather than exposing an internal code", () => {
    expect(
      presentMemberLifecycle({
        data: { ...lifecycle, stage: "UNRECOGNIZED_STAGE" },
        error: null,
      }),
    ).toMatchObject({ available: false, stage: "확인 불가" });
  });
  it("confirmed event timestamps are formatted while missing/invalid fields remain unknown", () => {
    const value = presentMemberLifecycle({
      data: {
        stage: "FIRST_FUNDING",
        first_funding_at: "2026-09-30T00:00:00Z",
        welcome_withdrawal_completed_at: "invalid",
      },
      error: null,
    });
    expect(value.firstFunding).toContain("2026");
    expect(value.welcomeWithdrawal).toBe("확인 불가");
    expect(presentMemberLifecycle({ data: {}, error: null }).firstFunding).toBe(
      "확인 불가",
    );
  });
  it.each([null, undefined, []])(
    "an unavailable profile cannot be shown as name-unset (%s)",
    (data) => {
      expect(presentMemberProfile({ data, error: null })).toEqual({
        available: false,
        name: "이름 확인 불가",
        avatar: "?",
      });
    },
  );
  it("confirmed blank names are distinct from unknown; Korean names stay unchanged", () => {
    expect(
      presentMemberProfile({ data: { display_name: null }, error: null }).name,
    ).toBe("이름 미설정");
    expect(
      presentMemberProfile({ data: { display_name: "퍼뜩" }, error: null }),
    ).toEqual({ available: true, name: "퍼뜩", avatar: "퍼" });
  });
  it.each(["error", "missing"])(
    "the actual member page preserves unknown for lifecycle/profile %s",
    async (kind) => {
      const result =
        kind === "error"
          ? { data: null, error: { message: "read failure" } }
          : { data: null, error: null };
      reads.tables.user_profiles = result;
      reads.tables.member_lifecycle_states = result;
      const markup = renderToStaticMarkup(
        await MembersPage({
          searchParams: Promise.resolve({
            id: "00000000-0000-4000-8000-000000000001",
          }),
        }),
      );
      expect(markup).toContain('data-ui-state="partial"');
      expect(markup).toContain("이름 확인 불가");
      expect(markup).not.toContain("SIGNED_UP");
      expect(markup).not.toContain("이름 미설정");
      expect(markup).toMatch(/첫 입금<\/dt><dd>확인 불가/);
      expect(markup).toMatch(/환영 출금<\/dt><dd>확인 불가/);
    },
  );
  it("the actual member page retains confirmed no-event values", async () => {
    const markup = renderToStaticMarkup(
      await MembersPage({
        searchParams: Promise.resolve({
          id: "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
    expect(markup).toContain('data-ui-state="loaded"');
    expect(markup).toMatch(/첫 입금<\/dt><dd>없음/);
    expect(markup).toMatch(/환영 출금<\/dt><dd>미완료/);
    expect(markup).toMatch(/인정 원금<\/dt><dd>100,000원/);
    expect(markup).toMatch(/정산 전 대기 수익<\/dt><dd>15,000원/);
    expect(markup).toMatch(/아직 확정 전<\/dt><dd>25,000원/);
    expect(markup).toContain("확정된 수익이 아니에요");
    expect(markup).not.toContain("140,000원");
    expect(markup).not.toContain("115,000원");
    expect(markup).not.toContain("40,000원");
    expect(markup).toMatch(/확정 채굴 수익<\/dt><dd>확인 필요/);
    expect(markup).toMatch(/채굴 인정 원금<\/dt><dd>0원/);
    expect(markup).not.toMatch(/보너스<\/dt><dd>100,000원/);
  });
  it("the actual member page keeps missing provenance partial even when profile reads succeed", async () => {
    reads.tables.money_source_summaries = { data: null, error: null };
    const markup = renderToStaticMarkup(
      await MembersPage({
        searchParams: Promise.resolve({
          id: "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
    expect(markup).toContain('data-ui-state="partial"');
    expect(markup).toContain("자금 구분을 확인하지 못했습니다.");
    expect(markup).toMatch(/채굴 인정 원금<\/dt><dd>확인 필요/);
  });
  it("a missing mining display is not shown as zero principal or pending earnings", async () => {
    reads.miningDisplay = { data: null, error: { code: "42501" } };
    const markup = renderToStaticMarkup(
      await MembersPage({
        searchParams: Promise.resolve({
          id: "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
    expect(markup).toContain('data-ui-state="partial"');
    expect(markup).toContain("원금과 대기 수익을 확인하지 못했습니다.");
    expect(markup).toMatch(/정산 전 대기 수익<\/dt><dd>확인 필요/);
    expect(markup).toMatch(/아직 확정 전<\/dt><dd>확인 필요/);
    expect(markup).not.toMatch(/정산 전 대기 수익<\/dt><dd>0원/);
    expect(markup).not.toMatch(/아직 확정 전<\/dt><dd>0원/);
  });
  it("an empty funding subject does not invent zero earnings", async () => {
    reads.miningDisplay = {
      data: {
        ...readyMiningDisplay,
        available: false,
        eligible_principal_micro_krw: null,
        pending_micro_krw: null,
        retention_unconfirmed_micro_krw: null,
      },
      error: null,
    };
    const markup = renderToStaticMarkup(
      await MembersPage({
        searchParams: Promise.resolve({
          id: "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
    expect(markup).toContain("원금과 대기 수익은 아직 없어요.");
    expect(markup).not.toMatch(/정산 전 대기 수익<\/dt>/);
    expect(markup).not.toMatch(/아직 확정 전<\/dt>/);
    expect(markup).not.toMatch(/정산 전 대기 수익<\/dt><dd>0원/);
  });
});
