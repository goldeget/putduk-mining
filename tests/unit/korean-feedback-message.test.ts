import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FeedbackMessage } from "@/components/ui/feedback-message";
import { StatusToast } from "@/components/ui/toast";

describe("shared Korean feedback", () => {
  it("preserves an actionable error and the field's existing live region", () => {
    const html = renderToStaticMarkup(
      createElement(
        FeedbackMessage,
        { id: "login-error", role: "alert", className: "auth-form__message" },
        "아이디와 비밀번호를 다시 확인해 주세요.",
      ),
    );
    expect(html).toContain('id="login-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-feedback-tone="danger"');
    expect(html).toContain("아이디와 비밀번호를 다시 확인해 주세요.");
    expect(html).not.toContain('aria-live="assertive" aria-live=');
  });

  it("keeps uncertain money results informational instead of claiming success", () => {
    const html = renderToStaticMarkup(
      createElement(
        FeedbackMessage,
        { role: "status" },
        "처리 결과를 확인하고 있어요. 출금 내역을 확인해 주세요.",
      ),
    );
    expect(html).toContain('data-feedback-tone="info"');
    expect(html).not.toContain('data-feedback-tone="success"');
    expect(html).not.toContain("출금이 완료");
    expect(html).toContain('role="status"');
  });

  it("does not put decoration into message text or render empty notices", () => {
    const html = renderToStaticMarkup(
      createElement(FeedbackMessage, { tone: "success" }, "저장했어요."),
    );
    expect(html).toContain('data-feedback-symbol="✅"');
    expect(html.replace(/<[^>]*>/g, "")).toBe("저장했어요.");
    expect(renderToStaticMarkup(createElement(FeedbackMessage, {}, ""))).toBe(
      "",
    );
  });

  it("keeps a toast's recovery action and urgency", () => {
    const html = renderToStaticMarkup(
      createElement(StatusToast, {
        tone: "danger",
        title: "연결을 확인해 주세요",
        description: "기존 기록은 유지돼요.",
        action: createElement("button", { type: "button" }, "다시 확인"),
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("다시 확인</button>");
  });
});
