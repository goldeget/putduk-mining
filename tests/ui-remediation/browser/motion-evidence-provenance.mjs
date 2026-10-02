import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const files = [
  "components/foundation/mining-core.tsx",
  "components/foundation/mining-core.module.css",
  "components/product/guided-quest.tsx",
  "components/product/guided-quest.module.css",
  "components/product/page-heading.tsx",
  "components/ui/surface.tsx",
  "components/icons/putduk-icon.tsx",
  "lib/motion/ambient-runtime.ts",
  "lib/motion/motion-preference.ts",
  "lib/motion/coach-position.ts",
  "app/globals.css",
  "app/productization.css",
  "app/(product)/home/home.module.css",
  "app/(product)/start/start.module.css",
  "components/system/theme-control.tsx",
  "components/system/theme-runtime.tsx",
  "lib/design/theme.ts",
  "lib/design/theme.css",
  "tests/ui-remediation/browser/main.jsx",
  "tests/ui-remediation/browser/web-fixtures.jsx",
  "tests/ui-remediation/browser/route-motion-fixtures.jsx",
  "tests/ui-remediation/browser/fixture.css",
  "tests/ui-remediation/browser/server.mjs",
  "tests/ui-remediation/browser/safety.js",
  "assets/fonts/PretendardVariable.woff2",
  "public/brand/worlds/orbital-earth-960-v1.avif",
  "public/brand/worlds/orbital-earth-960-v1.webp",
];

export async function readMotionEvidenceSnapshot(projectRoot) {
  const hashes = {};
  for (const file of files) {
    const content = await fs.readFile(path.join(projectRoot, file));
    hashes[file] = createHash("sha256").update(content).digest("hex");
  }
  return {
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim(),
    workingSourceSha256: hashes,
  };
}
