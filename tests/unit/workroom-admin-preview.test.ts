// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkroomConfigPreview } from "../../apps/admin/app/(control)/workroom/config-preview";
import type { WorkroomAdminConfig } from "../../apps/admin/lib/workroom/types";

const config: WorkroomAdminConfig = {
  instrument: "nvda",
  pattern: "wave",
  roi: 5,
  duration: 300,
  amplitude: 2,
  version: 1,
};
function render(value: WorkroomAdminConfig) {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = renderToStaticMarkup(
    createElement(WorkroomConfigPreview, { config: value }),
  );
  return doc;
}
describe("administrator configured path preview", () => {
  it.each(["wave", "slow", "balanced"] as const)(
    "preserves the exact endpoint for %s",
    (pattern) => {
      const doc = render({ ...config, pattern });
      const chart = doc.querySelector(
        '[data-testid="admin-workroom-preview"]',
      )!;
      expect(chart.getAttribute("data-current-value")).toBe("105");
      expect(chart.getAttribute("data-end-value")).toBe("105");
      expect(chart.getAttribute("data-progress")).toBe("1");
      expect(chart.getAttribute("aria-label")).toContain(
        "실제 시세와 다릅니다",
      );
      expect(doc.body.textContent).toContain("10초 미리보기");
      expect(doc.body.textContent).toContain("300초");
    },
  );
  it.each([-50, 0, 50])(
    "uses signed ROI %s independently from amplitude",
    (roi) => {
      const doc = render({ ...config, roi, amplitude: 15 });
      expect(doc.querySelector("svg")?.getAttribute("data-current-value")).toBe(
        String(100 + roi),
      );
      expect(doc.querySelector("section")?.getAttribute("data-direction")).toBe(
        roi < 0 ? "negative" : roi > 0 ? "positive" : "neutral",
      );
    },
  );
  it.each([
    { duration: 29 },
    { duration: 30.5 },
    { duration: 86401 },
    { amplitude: Number.NaN },
    { roi: 51 },
  ])("blocks preview playback for invalid draft %j", (draft) => {
    const doc = render({ ...config, ...draft });
    expect(doc.querySelector("svg")?.outerHTML).not.toMatch(/NaN|Infinity/);
    expect(doc.querySelector('[role="status"]')?.textContent).toContain(
      "허용 범위",
    );
    expect(
      Array.from(doc.querySelectorAll("button")).every((e) => e.disabled),
    ).toBe(true);
  });
});
