// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PrincipalMoney } from "@/components/product/principal-money";

describe("principal money presentation", () => {
  it("preserves exact large integer text through DOM grouping and copy", () => {
    const html = renderToStaticMarkup(
      createElement(PrincipalMoney, { atomic: "9007199254740993123456789" }),
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(root.textContent).toBe("9,007,199,254,740,993,123,456,789 KRW");
  });

  it("preserves the sign and zero without adding hidden separators", () => {
    for (const [atomic, expected] of [
      ["-1001", "-1,001 KRW"],
      ["0", "0 KRW"],
    ]) {
      const root = document.createElement("div");
      root.innerHTML = renderToStaticMarkup(
        createElement(PrincipalMoney, { atomic: atomic! }),
      );
      expect(root.textContent).toBe(expected);
    }
  });
});
