import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const version = "2026.10.14-sprout-p-v2";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const required = [
  "/brand/logo/putduk-sprout-p-master.svg",
  "/brand/logo/putduk-ai-symbol.svg",
  "/brand/logo/putduk-sprout-p-monochrome.svg",
  "/brand/logo/putduk-sprout-p-gold.png",
  "/brand/logo/putduk-sprout-p-gold.webp",
  ...["dark", "light"].flatMap((theme) => [
    `/brand/logo/putduk-logo-lockup-${theme}.svg`,
    `/brand/symbol/putduk-symbol-${theme}.svg`,
    `/brand/wordmark/putduk-wordmark-${theme}.svg`,
    `/brand/favicon/favicon-${theme}-512.png`,
    ...[192, 512].map((size) => `/brand/pwa/putduk-pwa-${theme}-${size}.png`),
  ]),
  ...[16, 32, 48].map((size) => `/brand/favicon/favicon-${size}.png`),
  "/brand/favicon/favicon.svg",
  "/brand/favicon/favicon.ico",
  "/brand/pwa/putduk-pwa-maskable-512.png",
  "/brand/notification/putduk-notification-badge-96.png",
].map((name) => name.replace("/brand/", "/brand/identity/20261014/"));

/** Validate shared identity, not the approval status of unrelated historical art. */
export async function verifyCanonicalBrandIdentity(root) {
  const failures = [];
  try {
    const manifest = JSON.parse(
      await readFile(
        path.join(root, "public/brand/identity.manifest.json"),
        "utf8",
      ),
    );
    const identity = manifest.brandIdentity;
    const shared = await readFile(
      path.join(root, "components/brand/putduk-symbol.ts"),
      "utf8",
    );
    const geometry = shared.match(/PUTDUK_SYMBOL_PATH\s*=\s*"([^"]+)"/)?.[1];
    if (
      !geometry ||
      identity?.geometryPath !== geometry ||
      identity.version !== version ||
      identity.sourceType !== "original-native-svg"
    )
      failures.push("canonical brand geometry/version mismatch");
    for (const name of required) {
      const matches = manifest.assets.filter((row) => row.path === name);
      if (matches.length !== 1 || matches[0].brandIdentityVersion !== version) {
        failures.push(`canonical identity manifest entry mismatch: ${name}`);
        continue;
      }
      const bytes = await readFile(path.join(root, "public", name.slice(1)));
      if (
        matches[0].sha256 !== digest(bytes) ||
        matches[0].bytes !== bytes.length
      )
        failures.push(`canonical identity asset changed: ${name}`);
      if (name.endsWith(".svg")) {
        const svg = bytes.toString("utf8");
        if (
          !svg.includes(`d="${geometry}"`) ||
          !svg.includes(`data-putduk-brand-version="${version}"`)
        )
          failures.push(`canonical SVG geometry missing: ${name}`);
        if (
          /\bid\s*=|<image\b|<text\b|(?:https?:)?\/\/[^"\s]+\.(?:png|jpg|webp)/.test(
            svg,
          )
        )
          failures.push(
            `canonical SVG has duplicate-ID or external-font/image dependency: ${name}`,
          );
      }
    }
    if (
      identity.geometryMaster !==
      "/brand/identity/20261014/logo/putduk-sprout-p-master.svg"
    ) {
      failures.push("canonical master path rejected");
      return failures;
    }
    const master = await readFile(
      path.join(root, "public", identity.geometryMaster.slice(1)),
    );
    if (digest(master) !== identity.geometryMasterSha256)
      failures.push("canonical geometry master changed");
    if (manifest.adminPublicCopies?.length !== 4)
      failures.push("four current admin favicon delivery copies required");
    for (const row of manifest.adminPublicCopies ?? []) {
      if (
        !row.path.startsWith("apps/admin/public/brand/identity/20261014/") ||
        row.path.includes("..") ||
        row.path.includes("\\")
      ) {
        failures.push("admin identity copy path rejected");
        continue;
      }
      const bytes = await readFile(path.join(root, row.path));
      const member = manifest.assets.find(
        (asset) => asset.path === row.memberPath,
      );
      if (
        !member ||
        digest(bytes) !== member.sha256 ||
        digest(bytes) !== row.sha256 ||
        bytes.length !== row.bytes
      )
        failures.push(`admin/member identity copy mismatch: ${row.path}`);
    }
    for (const name of ["putduk-ai-mascot.tsx", "putduk-ai-chat.tsx"]) {
      const source = await readFile(
        path.join(root, "components/product", name),
        "utf8",
      );
      if (
        source.includes("/brand/mascot/putduk-ai-help-face-") ||
        source.includes("/brand/identity/20261013/") ||
        !source.includes("BrandMark")
      )
        failures.push(`current AI entry must use canonical identity: ${name}`);
    }
    const previousPath = identity.historicalIdentity?.manifest;
    if (
      previousPath !==
      "docs/design/generated-masters/sprout-p-v2-20261014/previous-identity.manifest.json"
    ) {
      failures.push("previous identity preservation manifest missing");
    } else {
      const previous = JSON.parse(
        await readFile(path.join(root, previousPath), "utf8"),
      );
      for (const row of previous.assets ?? []) {
        if (!row.path.startsWith("/brand/identity/20261013/")) {
          failures.push("previous identity preservation path rejected");
          continue;
        }
        const bytes = await readFile(
          path.join(root, "public", row.path.slice(1)),
        );
        if (digest(bytes) !== row.sha256 || bytes.length !== row.bytes)
          failures.push(`previous identity asset changed: ${row.path}`);
      }
      for (const row of previous.adminPublicCopies ?? []) {
        if (
          !row.path.startsWith("apps/admin/public/brand/identity/20261013/")
        ) {
          failures.push("previous admin identity preservation path rejected");
          continue;
        }
        const bytes = await readFile(path.join(root, row.path));
        if (digest(bytes) !== row.sha256 || bytes.length !== row.bytes)
          failures.push(`previous admin identity changed: ${row.path}`);
      }
    }
    const font = await readFile(
      path.join(root, "assets/fonts/PretendardVariable.woff2"),
    );
    if (
      identity.wordmarkTypography?.copy !== "퍼뜩 채굴" ||
      identity.wordmarkTypography?.sourceWeight !== 750 ||
      identity.wordmarkTypography?.fontSha256 !== digest(font)
    )
      failures.push("reviewed Korean wordmark outline provenance mismatch");
  } catch (error) {
    failures.push(
      `canonical identity unreadable: ${error.code ?? "INVALID_CONTRACT"}`,
    );
  }
  return failures;
}
