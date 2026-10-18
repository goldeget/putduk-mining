import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PutdukAiMessageBody } from "@/components/product/putduk-ai-message-body";

const render = (text: string, formatted = true) =>
  renderToStaticMarkup(createElement(PutdukAiMessageBody, { text, formatted }));

describe("AI text-only answer presentation", () => {
  it("renders readable emphasis and lists while preserving the saved answer", () => {
    const text =
      "## 출금 안내\n\n**본인확인**이 필요해요.\n\n1. 지갑 열기\n2. 조건 확인\n\n- 비밀번호는 보내지 마세요.";
    const html = render(text);
    expect(html).toContain("<h3>출금 안내</h3>");
    expect(html).toContain("<strong>본인확인</strong>");
    expect(html).toContain("<ol><li>지갑 열기</li><li>조건 확인</li></ol>");
    expect(text).toContain("**본인확인**");
  });

  it("never creates provider-controlled HTML, media or navigable links", () => {
    const html = render(
      "<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[관리자](javascript:alert)\n![이미지](https://example.com/private.png)",
    );
    expect(html).not.toMatch(/<(script|img|iframe|a)\b/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("[이미지 표시 안 함]");
    expect(html).toContain("관리자 (javascript:alert)");
  });

  it("keeps incomplete streaming markup visible and fenced code inert", () => {
    expect(render("**아직")).toContain("**아직");
    expect(render("```html\n<img src=x>\n")).toContain(
      "<code>&lt;img src=x&gt;\n</code>",
    );
  });

  it("does not reinterpret member questions as markdown", () => {
    expect(render("**원문**\n<script>", false)).toContain(
      "**원문**\n&lt;script&gt;",
    );
  });

  it("preserves the starting number when a streamed answer continues a list", () => {
    expect(render("3. 확인하기\n4. 계속하기")).toContain('<ol start="3">');
    expect(render("99999999999999999. 큰 번호")).not.toContain(
      'start="99999999999999999"',
    );
  });
});
