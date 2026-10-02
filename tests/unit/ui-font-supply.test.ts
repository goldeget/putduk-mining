import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";

it("licensed font bytes are pinned and supplied to both apps from the same local source", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../assets/fonts/manifest.json", import.meta.url),
      "utf8",
    ),
  ) as { font_sha256: string };
  const bytes = readFileSync(
    new URL("../../assets/fonts/PretendardVariable.woff2", import.meta.url),
  );
  expect(bytes.subarray(0, 4).toString()).toBe("wOF2");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    manifest.font_sha256,
  );
  expect(
    readFileSync(
      new URL("../../assets/fonts/OFL.txt", import.meta.url),
      "utf8",
    ),
  ).toContain("SIL OPEN FONT LICENSE Version 1.1");
  expect(
    readFileSync(new URL("../../lib/design/fonts.ts", import.meta.url), "utf8"),
  ).toContain('weight: "45 930"');
});
