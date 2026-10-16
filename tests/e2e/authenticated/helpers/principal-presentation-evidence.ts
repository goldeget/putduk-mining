import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

const sensitive =
  'input[name="destinationReauthPassword"],input[name="destinationReauthTotp"],input[name="accountHolder"],input[name="accountNumber"],input[name="address"]';

/** Native viewport pixels, covering the entire selected card inside the actual scrollable main. */
export async function capturePrincipalPresentation(
  page: Page,
  section: Locator,
  info: TestInfo,
  label: string,
) {
  const heading = await section.getAttribute("aria-labelledby");
  expect(heading).toBeTruthy();
  const main = page.getByRole("main");
  const bounds = await main.evaluate((root, id) => {
    const section = root.querySelector<HTMLElement>(
      `section[aria-labelledby="${id}"]`,
    );
    if (!section) throw new Error("PRINCIPAL_EVIDENCE_CARD_MISSING");
    const box = section.getBoundingClientRect();
    const viewport = root.getBoundingClientRect();
    const top = box.top - viewport.top + root.scrollTop;
    const bottom = box.bottom - viewport.top + root.scrollTop;
    const maximum = root.scrollHeight - root.clientHeight;
    return {
      top,
      bottom,
      clientHeight: root.clientHeight,
      start: Math.max(0, Math.min(top, maximum)),
      end: Math.max(0, Math.min(bottom - root.clientHeight, maximum)),
    };
  }, heading);
  expect(bounds.clientHeight).toBeGreaterThan(0);
  const step = Math.max(1, Math.floor(bounds.clientHeight * 0.75));
  // Enlarged text also reduces the actual scroll viewport. Derive a finite
  // collection size from measured bounds instead of truncating a long card.
  const panelCount = Math.ceil((bounds.end - bounds.start) / step) + 1;
  expect(Number.isSafeInteger(panelCount) && panelCount > 0).toBe(true);
  const offsets = Array.from({ length: panelCount }, (_, index) =>
    Math.min(bounds.end, bounds.start + index * step),
  );
  await writeFile(
    info.outputPath(`${label}-bounds.json`),
    JSON.stringify({ bounds, offsets }, null, 2) + "\n",
  );
  if (offsets.at(-1)! < bounds.end)
    await page.screenshot({
      path: info.outputPath(`${label}-incomplete.png`),
      animations: "disabled",
      mask: [page.locator(sensitive)],
    });
  // The full card remains required, regardless of the collection size.
  expect(offsets.at(-1)!).toBeGreaterThanOrEqual(bounds.end);
  const panels = [];
  for (const [index, top] of offsets.entries()) {
    await main.evaluate((root, top) => {
      root.scrollTo({ top, behavior: "instant" });
    }, top);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const name = `${label}-${index}.png`;
    const png = await page.screenshot({
      path: info.outputPath(name),
      animations: "disabled",
      mask: [page.locator(sensitive)],
    });
    panels.push({
      file: name,
      sha256: createHash("sha256").update(png).digest("hex"),
      scrollTop: await main.evaluate((root) => root.scrollTop),
    });
  }
  const first = panels[0]!;
  const last = panels.at(-1)!;
  expect(first.scrollTop).toBeLessThanOrEqual(bounds.top + 1);
  expect(last.scrollTop + bounds.clientHeight).toBeGreaterThanOrEqual(
    bounds.bottom - 1,
  );
  return {
    heading,
    bounds,
    panels,
    complete: true,
    nativeViewportPixels: true,
  };
}

export async function writePrincipalPresentationReport(
  info: TestInfo,
  evidence: unknown,
) {
  await writeFile(
    info.outputPath("principal-presentation-matrix.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
