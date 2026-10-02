import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AuthErrorPage from "../../app/auth/error/page";
import ForbiddenPage from "../../app/auth/forbidden/page";
import ErrorPage from "../../app/error";
import NotFound from "../../app/not-found";
import OfflinePage from "../../app/offline/page";
import { StatePanel } from "../../components/ui/states";

describe("standalone recovery page heading hierarchy", () => {
  for (const [name, component] of [
    ["expired account link", AuthErrorPage],
    ["forbidden", ForbiddenPage],
    ["not found", NotFound],
    ["offline", OfflinePage],
  ] as const) {
    it(`${name} has one primary heading in the actual rendered route`, () => {
      const markup = renderToStaticMarkup(createElement(component));
      expect(markup.match(/<h1(?:\s|>)/g)).toHaveLength(1);
      expect(markup).not.toContain("<h2>");
    });
  }

  it("root route failure has one primary heading and offers recovery", () => {
    const markup = renderToStaticMarkup(
      createElement(ErrorPage, { error: new Error("test"), reset: () => {} }),
    );
    expect(markup.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(markup).toContain("다시 시도");
  });

  it("an embedded state panel stays secondary to its page title", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "main",
        null,
        createElement("h1", null, "내 자산"),
        createElement(StatePanel, {
          title: "자산을 확인하지 못했어요",
          description: "연결을 확인한 뒤 다시 시도해 주세요.",
          tone: "error",
        }),
      ),
    );
    expect(markup.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(markup).toContain("<h2>자산을 확인하지 못했어요</h2>");
  });

  it("offline remains a distinct state and offers no confirmed balance", () => {
    const markup = renderToStaticMarkup(createElement(OfflinePage));
    expect(markup).toContain('data-ui-state="offline"');
    expect(markup).not.toContain('data-ui-state="loaded"');
    expect(markup).toContain("연결 다시 확인");
  });
});
