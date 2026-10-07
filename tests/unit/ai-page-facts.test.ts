import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PutdukAiPage from "@/app/(product)/menu/ai/page";
import { requirePageUser } from "@/lib/auth/session";
import { readMemberScreenFacts } from "@/lib/product/member-screen-facts";
import type { PutdukAiChatProps } from "@/components/product/putduk-ai-chat";

const capture = vi.hoisted(() => ({ props: null as PutdukAiChatProps | null }));
vi.mock("@/components/product/putduk-ai-chat", () => ({
  PutdukAiChat: (props: PutdukAiChatProps) => {
    capture.props = props;
    return createElement("div", null, props.pageTools);
  },
}));
vi.mock("@/lib/auth/session", () => ({ requirePageUser: vi.fn() }));
vi.mock("@/lib/product/member-screen-facts", () => ({
  readMemberScreenFacts: vi.fn(),
}));
vi.mock("next/link", () => ({ default: "a" }));
const identity = { userId: "verified-owner", supabase: {} };
beforeEach(() => {
  vi.clearAllMocks();
  capture.props = null;
  vi.mocked(requirePageUser).mockResolvedValue(
    identity as Awaited<ReturnType<typeof requirePageUser>>,
  );
  vi.mocked(readMemberScreenFacts).mockResolvedValue({
    availableKrwAtomic: "1234567",
    displayName: "실제 회원",
    joinedAt: null,
    locale: "ko",
    rankName: "실제 등급",
    walletUnavailable: false,
  });
});
describe("owner-bound AI page facts", () => {
  it("reads only one verified identity and labels the existing wallet amount accurately", async () => {
    const html = renderToStaticMarkup(await PutdukAiPage());
    expect(requirePageUser).toHaveBeenCalledExactlyOnceWith("/menu/ai");
    expect(readMemberScreenFacts).toHaveBeenCalledExactlyOnceWith(identity);
    expect(capture.props).toMatchObject({
      presentation: "page",
      surface: "page",
      pageFacts: {
        ownerUserId: "verified-owner",
        displayName: "실제 회원",
        rankName: "실제 등급",
        availableKrwLabel: "1,234,567원",
      },
    });
    expect(html).toContain('href="/menu"');
    expect(html).not.toMatch(/ONLINE|L5|principal|원금|54%/);
  });
  it("retains confirmed zero and never substitutes zero for missing data", async () => {
    const base = await vi
      .mocked(readMemberScreenFacts)
      .getMockImplementation()!(
      identity as Awaited<ReturnType<typeof requirePageUser>>,
    );
    vi.mocked(readMemberScreenFacts).mockResolvedValue({
      ...base,
      availableKrwAtomic: "0",
    });
    renderToStaticMarkup(await PutdukAiPage());
    expect(capture.props?.pageFacts?.availableKrwLabel).toBe("0원");
    vi.mocked(readMemberScreenFacts).mockResolvedValue({
      ...base,
      availableKrwAtomic: null,
      rankName: null,
    });
    renderToStaticMarkup(await PutdukAiPage());
    expect(capture.props?.pageFacts?.availableKrwLabel).toBe("확인할 수 없음");
    expect(capture.props?.pageFacts?.rankName).toBeNull();
    vi.mocked(readMemberScreenFacts).mockResolvedValue({
      ...base,
      availableKrwAtomic: "not-an-atomic-amount",
    });
    renderToStaticMarkup(await PutdukAiPage());
    expect(capture.props?.pageFacts?.availableKrwLabel).toBe("확인할 수 없음");
  });
  it("retains failed-wallet unknown and never reads data before auth succeeds", async () => {
    vi.mocked(readMemberScreenFacts).mockResolvedValue({
      availableKrwAtomic: "1234567",
      displayName: "실제 회원",
      joinedAt: null,
      locale: null,
      rankName: null,
      walletUnavailable: true,
    });
    renderToStaticMarkup(await PutdukAiPage());
    expect(capture.props?.pageFacts?.availableKrwLabel).toBe("확인할 수 없음");
    vi.mocked(readMemberScreenFacts).mockClear();
    vi.mocked(requirePageUser).mockRejectedValue(new Error("AUTH_REDIRECT"));
    await expect(PutdukAiPage()).rejects.toThrow("AUTH_REDIRECT");
    expect(readMemberScreenFacts).not.toHaveBeenCalled();
  });
});
