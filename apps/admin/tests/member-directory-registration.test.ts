import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminPrincipal } from "@/lib/auth/principal";
const fixture = vi.hoisted(() => ({
  auditError: false,
  requested: [] as string[],
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: () => ({
    from(table: string) {
      fixture.requested.push(table);
      const data =
        table === "user_identity_profiles"
          ? [
              {
                user_id: "00000000-0000-4000-8000-000000000001",
                login_id: "membercheck",
                legal_name: "검증회원",
                date_of_birth: "1990-02-02",
                birth_sex_digit: "2",
                phone_e164: "+821012345678",
                recovery_email: "fixture@example.com",
                created_at: "2026-11-12T00:00:00Z",
              },
            ]
          : [
              {
                user_id: "00000000-0000-4000-8000-000000000001",
                signup_ip: null,
              },
            ];
      const result = { data, error: null, count: 1 };
      const query = {
        select: () => query,
        order: () => query,
        range: () => query,
        in: () => query,
        insert: () =>
          Promise.resolve({ error: fixture.auditError ? {} : null }),
        then: (resolve: (v: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return query;
    },
  }),
}));
import { MemberDirectory } from "@/app/(control)/members/member-directory";
beforeEach(() => {
  fixture.auditError = false;
  fixture.requested = [];
});
describe("signup details visible in member directory", () => {
  it("shows separate name, login, original birth input, first digit and domestic phone without search", async () => {
    const html = renderToStaticMarkup(
      await MemberDirectory({
        principal: { role: "SUPER_ADMIN" } as AdminPrincipal,
        page: 1,
      }),
    );
    for (const value of [
      "검증회원",
      "membercheck",
      "900202",
      "뒷자리 첫 숫자",
      "여성",
      "01012345678",
      "fixture@example.com",
      "기록 없음",
    ])
      expect(html).toContain(value);
    expect(html).not.toContain("+821012345678");
  });
  it("does not expose registration data to a viewer", async () => {
    const html = renderToStaticMarkup(
      await MemberDirectory({
        principal: { role: "VIEWER" } as AdminPrincipal,
        page: 1,
      }),
    );
    expect(html).not.toContain("검증회원");
    expect(fixture.requested).toEqual([]);
  });
  it("does not read personal records when audit recording fails", async () => {
    fixture.auditError = true;
    const html = renderToStaticMarkup(
      await MemberDirectory({
        principal: { role: "ADMIN" } as AdminPrincipal,
        page: 1,
      }),
    );
    expect(html).toContain("조회 기록을 남기지 못했습니다");
    expect(fixture.requested).toEqual(["audit_logs"]);
  });
});
