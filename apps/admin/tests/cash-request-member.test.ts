import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminPrincipal } from "@/lib/auth/principal";
const a = "00000000-0000-4000-8000-000000000001",
  b = "00000000-0000-4000-8000-000000000002";
const io = vi.hoisted(() => ({
  read: vi.fn(),
  audit: vi.fn(),
  tables: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: () => ({
    from(table: string) {
      io.tables.push(table);
      return { insert: io.audit, select: () => ({ in: io.read }) };
    },
  }),
}));
import { loadCashRequestMembers } from "@/lib/members/cash-request-members";
import { CashRequestMember } from "@/components/cash-request-member";
const principal = { userId: "operator", role: "SUPER_ADMIN" } as AdminPrincipal;
beforeEach(() => {
  io.tables = [];
  io.audit.mockReset().mockResolvedValue({ error: null });
  io.read.mockReset().mockResolvedValue({
    error: null,
    data: [
      { user_id: a, legal_name: "김회원", login_id: "member_a" },
      { user_id: b, legal_name: "이회원", login_id: "member_b" },
    ],
  });
});
describe("cash request owner identification", () => {
  it("loads deduplicated owners once and renders the matching name and login ID", async () => {
    const directory = await loadCashRequestMembers(principal, [a, a, b]);
    expect(io.read).toHaveBeenCalledOnce();
    expect(io.read).toHaveBeenCalledWith("user_id", [a, b]);
    const html = renderToStaticMarkup(
      CashRequestMember({ userId: a, directory }),
    );
    expect(html).toContain("김회원");
    expect(html).toContain("member_a");
    expect(html).not.toContain("이회원");
    expect(html).toContain(`/members?id=${a}`);
  });
  it("does not use another member's identity for a missing owner", async () => {
    io.read.mockResolvedValue({
      error: null,
      data: [{ user_id: b, legal_name: "이회원", login_id: "member_b" }],
    });
    const directory = await loadCashRequestMembers(principal, [a]);
    const html = renderToStaticMarkup(
      CashRequestMember({ userId: a, directory }),
    );
    expect(html).toContain("가입 정보 기록 없음");
    expect(html).not.toContain("이회원");
  });
  it("reports an identity lookup error rather than presenting a guessed owner", async () => {
    io.read.mockResolvedValue({ error: {}, data: null });
    const directory = await loadCashRequestMembers(principal, [a]);
    expect(
      renderToStaticMarkup(CashRequestMember({ userId: a, directory })),
    ).toContain("신청자 정보 조회 실패");
  });
  it("does not disclose identity data to lower privilege roles", async () => {
    const directory = await loadCashRequestMembers(
      { ...principal, role: "VIEWER" },
      [a],
    );
    expect(io.tables).toEqual([]);
    expect(
      renderToStaticMarkup(CashRequestMember({ userId: a, directory })),
    ).not.toContain("김회원");
  });
  it("does not read identities when the audit record cannot be saved", async () => {
    io.audit.mockResolvedValue({ error: {} });
    await loadCashRequestMembers(principal, [a]);
    expect(io.read).not.toHaveBeenCalled();
  });
});
