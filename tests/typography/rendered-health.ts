import { expect, type Page } from "@playwright/test";

// Independent test authority: owner-selected identity in the versioned manifest.
export const TYPOGRAPHY_BRAND_VERSION = "2026.10.14-sprout-p-v2";

export async function assertVisibleControlsNamed(page: Page) {
  // Dialog/status/alert are not interactive controls. Decorative SVGs are not controls.
  const controls = page.locator(
    'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="spinbutton"], [role="tab"], [role="menuitem"], [role="searchbox"]',
  );
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    if (await control.isVisible()) {
      await expect(
        control,
        `Visible control ${index} needs an accessible name`,
      ).toHaveAccessibleName(/\S/);
    }
  }
}

export async function assertUniqueDocumentIds(page: Page) {
  const duplicates = await page.evaluate(() => {
    const ids = new Map<string, number>();
    for (const element of document.querySelectorAll("[id]")) {
      if (element.id) ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
    }
    return [...ids]
      .filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count }));
  });
  expect(
    duplicates,
    "Document IDs must be unique, including hidden elements",
  ).toEqual([]);
}

export async function readRenderedPresentationHealth(page: Page) {
  return page.evaluate((canonicalBrandVersion) => {
    const normalize = (family: string) =>
      family.trim().replaceAll('"', "").replaceAll("'", "");
    const projectFont = normalize(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--font-putduk")
        .split(",")[0] ?? "",
    );
    const loadedProjectFaces = Array.from(document.fonts)
      .filter(
        (face) =>
          normalize(face.family) === projectFont && face.status === "loaded",
      )
      .map((face) => ({
        family: face.family,
        status: face.status,
        weight: face.weight,
      }));
    const projectFontUrls: string[] = [];
    const inaccessibleStyleSheets: string[] = [];
    const visited = new Set<CSSStyleSheet>();
    function visitSheet(sheet: CSSStyleSheet) {
      if (visited.has(sheet)) return;
      visited.add(sheet);
      try {
        visitRules(sheet.cssRules);
      } catch {
        inaccessibleStyleSheets.push(
          sheet.href ? new URL(sheet.href, location.href).pathname : "inline",
        );
      }
    }
    function visitRules(rules: CSSRuleList) {
      for (const rule of rules) {
        if (
          rule instanceof CSSFontFaceRule &&
          normalize(rule.style.getPropertyValue("font-family")) === projectFont
        ) {
          for (const match of rule.style
            .getPropertyValue("src")
            .matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
            if (match[1])
              projectFontUrls.push(
                new URL(match[1], rule.parentStyleSheet?.href ?? location.href)
                  .href,
              );
          }
        } else if (rule instanceof CSSImportRule && rule.styleSheet)
          visitSheet(rule.styleSheet);
        else if (rule instanceof CSSGroupingRule) visitRules(rule.cssRules);
      }
    }
    for (const sheet of document.styleSheets) visitSheet(sheet);
    const nonLocalProjectFontUrls = projectFontUrls.filter((src) => {
      const url = new URL(src);
      return (
        url.origin !== location.origin ||
        !url.pathname.startsWith("/_next/static/media/") ||
        !url.pathname.endsWith(".woff2")
      );
    });
    function rendered(element: Element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }
    function inViewport(element: Element) {
      const rect = element.getBoundingClientRect();
      return (
        rendered(element) &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < innerHeight &&
        rect.left < innerWidth
      );
    }
    const failedViewportImages = Array.from(document.images)
      .filter(
        (image) =>
          inViewport(image) && (!image.complete || image.naturalWidth === 0),
      )
      .map((image) => ({
        alt: image.alt,
        src: new URL(image.currentSrc || image.src, location.href).pathname,
      }));
    const unobservedOffscreenImages = Array.from(document.images)
      .filter(
        (image) =>
          rendered(image) &&
          !inViewport(image) &&
          (!image.complete || image.naturalWidth === 0),
      )
      .map((image) => ({
        alt: image.alt,
        src: new URL(image.currentSrc || image.src, location.href).pathname,
        state: "OFFSCREEN_NOT_VERIFIED",
      }));
    const brandMarkers = Array.from(
      document.querySelectorAll('[data-putduk-brand="canonical"]'),
    ).map((element) => ({
      version: element.getAttribute("data-putduk-brand-version"),
      visible: rendered(element),
      tag: element.tagName,
    }));
    const visibleBrandPlacementsMissingCanonical = Array.from(
      document.querySelectorAll(
        'header a[aria-label="퍼뜩 채굴 홈"], header .brand-lockup, .control-rail .brand-lockup',
      ),
    )
      .filter(rendered)
      .filter(
        (element) =>
          !element.querySelector(
            `[data-putduk-brand="canonical"][data-putduk-brand-version="${canonicalBrandVersion}"]`,
          ),
      )
      .map((element) => element.className);
    return {
      projectFont,
      bodyFont: getComputedStyle(document.body).fontFamily,
      loadedProjectFaces,
      projectFontUrls,
      nonLocalProjectFontUrls,
      inaccessibleStyleSheets,
      failedViewportImages,
      unobservedOffscreenImages,
      brandMarkers,
      visibleBrandPlacementsMissingCanonical,
    };
  }, TYPOGRAPHY_BRAND_VERSION);
}
