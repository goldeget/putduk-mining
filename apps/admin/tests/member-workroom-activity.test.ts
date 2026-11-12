import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminPrincipal } from "@/lib/auth/principal";
import { MemberWorkroomActivity } from "@/app/(control)/members/member-workroom-activity";
const userId = "00000000-0000-4000-8000-000000000001";
const rpc = vi.fn();
const principal = {
  role: "ADMIN",
  userId: "operator",
  adminSessionId: "app-session",
  sessionId: "auth-session",
  aal: "aal2",
  supabase: { rpc },
} as unknown as AdminPrincipal;
beforeEach(() => {
  rpc
    .mockReset()
    .mockResolvedValue({
      error: null,
      data: {
        userId,
        account: { balance: 100050, held: 0 },
        roundCount: 27,
        ledgerCount: 55,
        rounds: [
          {
            id: "round-1",
            instrument: "nvda",
            stake: 1000,
            roi: 5,
            pattern: "slow",
            duration: 300,
            startedAt: 1794441600000,
            closedAt: 1794441900000,
            returned: 1050,
            profit: 50,
          },
        ],
        ledger: [
          {
            id: "ledger-1",
            kind: "SETTLEMENT",
            amount: 1050,
            balanceAfter: 100050,
            note: "모의 회차 반환",
            roundId: "round-1",
            createdAt: 1794441900000,
          },
        ],
      },
    });
});
describe("complete per-member practice transaction history", () => {
  it("shows authoritative stake, returned amount, profit and ledger balance with independent pagination", async () => {
    const html = renderToStaticMarkup(
      await MemberWorkroomActivity({
        principal,
        userId,
        roundPage: 1,
        pointPage: 1,
      }),
    );
    for (const v of [
      "엔비디아",
      "1,000",
      "1,050",
      "+50",
      "100,050",
      "종료 반환",
      "다음 참여",
      "다음 거래",
    ])
      expect(html).toContain(v);
    expect(rpc).toHaveBeenCalledWith(
      "workroom_admin_command",
      expect.objectContaining({
        p_operation: "MEMBER_HISTORY",
        p_input: { userId, roundPage: 1, pointPage: 1 },
      }),
    );
  });
  it("does not display a different target's returned history", async () => {
    rpc.mockResolvedValue({ error: null, data: { userId: "another-member" } });
    const html = renderToStaticMarkup(
      await MemberWorkroomActivity({
        principal,
        userId,
        roundPage: 1,
        pointPage: 1,
      }),
    );
    expect(html).toContain("불러오지 못했습니다");
    expect(html).not.toContain("100,050");
  });
  it("never exposes personal activity to a viewer", async () => {
    const html = renderToStaticMarkup(
      await MemberWorkroomActivity({
        principal: { ...principal, role: "VIEWER" },
        userId,
        roundPage: 1,
        pointPage: 1,
      }),
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(html).not.toContain("엔비디아");
  });
});
