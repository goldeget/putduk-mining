import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemberDirectory } from "@/components/members/member-directory";

const userId = "00000000-0000-4000-8000-000000000001";
describe("beginner member selection", () => {
  it("offers a name and joined time with the exact member in the link, not a UUID input", () => {
    const html = renderToStaticMarkup(
      createElement(MemberDirectory, {
        members: [
          { userId, name: "테스트 회원", joinedAt: "2026-10-07T01:00:00Z" },
        ],
        unavailable: false,
        query: "",
        invalidReference: false,
      }),
    );
    expect(html).toContain("테스트 회원");
    expect(html).toContain(`/members?id=${userId}`);
    expect(html).not.toContain("회원 식별자");
    expect(html).not.toContain(`>${userId}<`);
  });
  it("never turns read denial into no members", () => {
    const html = renderToStaticMarkup(
      createElement(MemberDirectory, {
        members: [],
        unavailable: true,
        query: "",
        invalidReference: false,
      }),
    );
    expect(html).toContain("회원 목록을 확인하지 못했어요");
    expect(html).not.toContain("조회된 회원이 없어요");
  });
});
