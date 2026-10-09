import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
import { PrincipalCryptoWithdrawalForm } from "@/components/product/principal-crypto-withdrawal-form";
const html = () =>
  renderToStaticMarkup(
    createElement(PrincipalCryptoWithdrawalForm, {
      ownerId: "11111111-1111-4111-8111-111111111111",
    }),
  );
describe("explicit manual-USDT principal panel", () => {
  it("initially has unchecked consent and disabled submission", () => {
    const s = html();
    expect(s).not.toContain('checked=""');
    expect(s).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(s).toContain("원금 정보를 확인하고 있어요…");
  });
  it("states KRW amount and actual manual-send receipt without a fabricated quote", () => {
    const s = html();
    expect(s).toContain("회수할 원금 (원)");
    expect(s).toContain("실제 보낸 수량은 송금 기록");
    expect(s).not.toContain("예상 USDT");
    expect(s).not.toContain("USDT 잔액");
    expect(s).not.toContain("환율");
  });
  it("collects no raw address/password or exchange credentials", () => {
    const s = html();
    expect(s).not.toContain('name="address"');
    expect(s).not.toContain("addressEncrypted");
    expect(s).not.toContain("password");
    expect(s).not.toContain("service_role");
  });
  it("has distinct accessible amount and destination labels", () => {
    const s = html();
    expect(s).toContain('for="principal-crypto-withdrawal-amount"');
    expect(s).toContain('for="principal-crypto-withdrawal-destination"');
    expect(s).toContain(
      'aria-labelledby="principal-crypto-withdrawal-heading"',
    );
  });
  it("preserves pause/age/no-retro semantics without promising held-cycle payment", () => {
    const s = html();
    expect(s).toContain("이전 기간은 보존해요");
    expect(s).toContain("보류 기간은 혜택 계산에 더하지 않아요");
    expect(s).not.toContain("유지 혜택 지급");
  });
  it("offers explicit readonly recovery separate from finance submission", () =>
    expect(html()).toContain("이전 요청 확인"));
});
