import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
import { PrincipalWithdrawalForm } from "@/components/product/principal-withdrawal-form";
const html = () =>
  renderToStaticMarkup(
    createElement(PrincipalWithdrawalForm, {
      ownerId: "11111111-1111-4111-8111-111111111111",
    }),
  );
describe("explicit principal confirmation panel", () => {
  it("starts loading with unchecked consent and disabled finance submission", () => {
    const value = html();
    expect(value).toContain("원금 정보를 확인하고 있어요…");
    expect(value).not.toContain('checked=""');
    expect(value).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });
  it("states pause/preserved age/prospective resumption without promising held-cycle payout", () => {
    const value = html();
    expect(value).toContain("이전 기간은 보존해요");
    expect(value).toContain("보류 기간은 혜택 계산에 더하지 않아요");
    expect(value).not.toContain("유지 혜택 지급");
  });
  it("does not collect new bank material/password/service authority in principal form", () => {
    const value = html();
    expect(value).not.toContain("accountNumber");
    expect(value).not.toContain("password");
    expect(value).not.toContain("service_role");
  });
  it("offers manual previous-request read rather than automatic finance", () => {
    expect(html()).toContain("이전 요청 확인");
  });
});
