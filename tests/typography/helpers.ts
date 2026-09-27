import { expect, type Page, type TestInfo } from "@playwright/test";

export type TypographyTheme = "dark" | "light";

export type TypographyViewport = {
  height: number;
  label: "390" | "834" | "1440";
  width: number;
};

export const TYPOGRAPHY_VIEWPORTS: readonly TypographyViewport[] = [
  { label: "390", width: 390, height: 844 },
  { label: "834", width: 834, height: 1112 },
  { label: "1440", width: 1440, height: 1000 },
] as const;

export const TYPOGRAPHY_THEMES: readonly TypographyTheme[] = [
  "light",
  "dark",
] as const;

type KoreanBreakIssue = {
  selector: string;
  token: string;
  tops: number[];
};

type OverflowIssue = {
  clientWidth: number;
  offenders: Array<{
    left: number;
    right: number;
    selector: string;
    width: number;
  }>;
  scrollWidth: number;
};

type TypographyAudit = {
  koreanBreaks: KoreanBreakIssue[];
  overflow: OverflowIssue;
};

function evidenceName(input: {
  routeName: string;
  textScale: number;
  theme: TypographyTheme;
  viewport: TypographyViewport;
}) {
  const scale = input.textScale === 1 ? "100" : String(input.textScale * 100);
  return [
    input.routeName,
    input.viewport.label,
    input.theme,
    `text-${scale}`,
  ]
    .join("-")
    .replace(/[^a-zA-Z0-9가-힣_-]+/g, "-")
    .toLowerCase();
}

async function readTypographyAudit(page: Page): Promise<TypographyAudit> {
  return page.evaluate(() => {
    const ignoredTags = new Set([
      "CODE",
      "INPUT",
      "KBD",
      "NOSCRIPT",
      "OPTION",
      "PRE",
      "SAMP",
      "SCRIPT",
      "STYLE",
      "TEXTAREA",
    ]);

    function isVisible(element: Element) {
      if (
        element.closest("[hidden], [aria-hidden='true']") ||
        ignoredTags.has(element.tagName)
      ) {
        return false;
      }
      const style = getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function selectorFor(element: Element) {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
      for (let depth = 0; current && depth < 4; depth += 1) {
        let part = current.tagName.toLowerCase();
        const classes = Array.from(current.classList).slice(0, 2);
        if (classes.length) {
          part += classes.map((name) => `.${CSS.escape(name)}`).join("");
        } else if (current.parentElement) {
          const siblings = Array.from(current.parentElement.children).filter(
            (candidate) => candidate.tagName === current?.tagName,
          );
          if (siblings.length > 1) {
            part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    }

    const koreanBreaks: KoreanBreakIssue[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const element = node.parentElement;
          if (!element || !node.textContent?.trim() || !isVisible(element)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    let node = walker.nextNode();
    while (node && koreanBreaks.length < 30) {
      const text = node.textContent ?? "";
      const matches = text.matchAll(/[가-힣]{2,}/g);
      for (const match of matches) {
        const token = match[0];
        const start = match.index ?? 0;
        const tops: number[] = [];
        for (let index = 0; index < token.length; index += 1) {
          const range = document.createRange();
          range.setStart(node, start + index);
          range.setEnd(node, start + index + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const roundedTop = Math.round(rect.top * 2) / 2;
          if (!tops.some((top) => Math.abs(top - roundedTop) <= 1)) {
            tops.push(roundedTop);
          }
        }
        if (tops.length > 1 && node.parentElement) {
          koreanBreaks.push({
            selector: selectorFor(node.parentElement),
            token,
            tops,
          });
        }
      }
      node = walker.nextNode();
    }

    const root = document.documentElement;
    const clientWidth = root.clientWidth;
    const scrollWidth = Math.max(root.scrollWidth, document.body.scrollWidth);
    const offenders =
      scrollWidth > clientWidth + 1
        ? Array.from(document.querySelectorAll("body *"))
            .filter(isVisible)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                selector: selectorFor(element),
                width: Math.round(rect.width),
              };
            })
            .filter(
              (item) => item.left < -1 || item.right > clientWidth + 1,
            )
            .slice(0, 20)
        : [];

    return {
      koreanBreaks,
      overflow: { clientWidth, offenders, scrollWidth },
    };
  });
}

export async function installTypographyTheme(
  page: Page,
  theme: TypographyTheme,
) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.context().addInitScript((selectedTheme) => {
    try {
      localStorage.setItem("putduk-theme", selectedTheme);
      document.documentElement.dataset.theme = selectedTheme;
      document.documentElement.style.colorScheme = selectedTheme;
    } catch {
      // Storage may be unavailable before the first origin is established.
    }
  }, theme);
}

export async function auditTypographyRoute(input: {
  page: Page;
  routeName: string;
  testInfo: TestInfo;
  textScale?: number;
  theme: TypographyTheme;
  url: string;
  viewport: TypographyViewport;
}) {
  const textScale = input.textScale ?? 1;
  await input.page.setViewportSize({
    width: input.viewport.width,
    height: input.viewport.height,
  });
  await input.page.goto(input.url, { waitUntil: "networkidle" });
  await input.page.evaluate(async (scale) => {
    await document.fonts.ready;
    if (scale !== 1) {
      document.documentElement.style.fontSize = `${scale * 100}%`;
    }
  }, textScale);
  await input.page.waitForTimeout(100);

  const name = evidenceName({
    routeName: input.routeName,
    textScale,
    theme: input.theme,
    viewport: input.viewport,
  });
  const screenshot = await input.page.screenshot({ fullPage: true });
  await input.testInfo.attach(name, {
    body: screenshot,
    contentType: "image/png",
  });

  const result = await readTypographyAudit(input.page);
  expect(
    result.overflow.scrollWidth,
    `${input.routeName} ${input.viewport.label}px ${input.theme}: horizontal overflow\n${JSON.stringify(result.overflow.offenders, null, 2)}`,
  ).toBeLessThanOrEqual(result.overflow.clientWidth + 1);
  expect(
    result.koreanBreaks,
    `${input.routeName} ${input.viewport.label}px ${input.theme}: Korean token split across lines`,
  ).toEqual([]);
}
