// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkroomChart } from "@/components/workroom/workroom-chart";
import {
  simulationValue,
  type WorkroomConfig,
} from "@/domain/workroom/contracts";

const base: WorkroomConfig = {
  instrument: "nvda",
  pattern: "wave",
  roi: 5,
  duration: 300,
  amplitude: 2,
  version: 1,
};

function parseMarkup(markup: string) {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = markup;
  return doc;
}
function documentFor(config: WorkroomConfig, progress: number) {
  return parseMarkup(
    renderToStaticMarkup(
      createElement(WorkroomChart, { config, progress, active: true }),
    ),
  );
}

describe("workroom chart presentation", () => {
  it.each([50, -50])(
    "keeps an unstarted chart at 100 without a future outcome for ROI %s",
    (roi) => {
      const doc = parseMarkup(
        renderToStaticMarkup(
          createElement(WorkroomChart, {
            config: { ...base, roi },
            progress: 1,
            active: false,
          }),
        ),
      );
      const svg = doc.querySelector("svg")!;
      expect(svg.getAttribute("data-current-value")).toBe("100");
      expect(svg.getAttribute("data-progress")).toBe("0");
      expect(doc.body.textContent).toContain("시작 대기");
      expect(doc.body.textContent).not.toMatch(/미리보기|종료 지수/);
    },
  );
  it.each([5, -5, 0])(
    "displays the exact configured endpoint for ROI %s",
    (roi) => {
      const doc = documentFor({ ...base, roi }, 1);
      const svg = doc.querySelector('[data-testid="workroom-chart"]');
      expect(svg?.getAttribute("data-current-value")).toBe(String(100 + roi));
      expect(svg?.getAttribute("aria-label")).toContain("모의 지수 차트");
      expect(svg?.getAttribute("aria-label")).toContain("실제 시세와 다릅니다");
      expect(doc.querySelector("svg")?.outerHTML).not.toMatch(/NaN|Infinity/);
    },
  );

  it("uses the authoritative display curve at a partial progress without drawing a future value as current", () => {
    const doc = documentFor(base, 0.37);
    expect(
      Number(doc.querySelector("svg")?.getAttribute("data-current-value")),
    ).toBeCloseTo(simulationValue(base, 0.37), 8);
    expect(doc.querySelector("svg")?.getAttribute("data-progress")).toBe(
      "0.37",
    );
  });

  it("colors the current loss independently of a positive configured endpoint", () => {
    const config = { ...base, amplitude: 15 };
    const doc = documentFor(config, 0.5);
    expect(simulationValue(config, 0.5)).toBeLessThan(100);
    expect(doc.querySelector("figure")?.getAttribute("data-direction")).toBe(
      "negative",
    );
  });

  it.each([-1, 2, Number.NaN])(
    "bounds invalid progress %s to a finite graph",
    (progress) => {
      const doc = documentFor(base, progress);
      const svg = doc.querySelector("svg")!;
      const actual = Number(svg.getAttribute("data-progress"));
      expect(actual).toBeGreaterThanOrEqual(0);
      expect(actual).toBeLessThanOrEqual(1);
      expect(svg.outerHTML).not.toMatch(/NaN|Infinity/);
    },
  );

  it("keeps gradient references unique when multiple chart cards are rendered", () => {
    const doc = parseMarkup(
      renderToStaticMarkup(
        createElement(
          "div",
          null,
          createElement(WorkroomChart, { config: base, progress: 0.2 }),
          createElement(WorkroomChart, {
            config: { ...base, roi: -5 },
            progress: 1,
          }),
        ),
      ),
    );
    const ids = Array.from(doc.querySelectorAll("[id]")).map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of doc.querySelectorAll("[fill],[stroke],[filter]")) {
      for (const attr of ["fill", "stroke", "filter"]) {
        const reference = e.getAttribute(attr)?.match(/^url\(#(.+)\)$/)?.[1];
        if (reference) expect(doc.getElementById(reference)).not.toBeNull();
      }
    }
  });
});
