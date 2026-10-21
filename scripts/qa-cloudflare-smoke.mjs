import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { TARGETS, origin, requireQa } from "./qa-cloudflare-policy.mjs";
import {
  installQaCredentialRoute,
  navigateQa,
  readAccessAsset,
} from "./qa-cloudflare-network.mjs";

const assetPath = "/brand/identity/20261014/favicon/favicon-32.png";
export async function smoke(role, accessOnly = false) {
  const base = origin(role);
  const prefix = `QA_${role.toUpperCase()}_ACCESS`;
  const headers = {
    "CF-Access-Client-Id": process.env[`${prefix}_CLIENT_ID`],
    "CF-Access-Client-Secret": process.env[`${prefix}_CLIENT_SECRET`],
  };
  requireQa(
    Object.values(headers).every(Boolean),
    "Access credentials missing",
  );
  // No redirects are followed with credentials, and unauthenticated denial is checked independently.
  for (const anonymousPath of ["/login", assetPath]) {
    const anonymous = await fetch(`${base}${anonymousPath}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    const location = anonymous.headers.get("location");
    const accessRedirect =
      location &&
      (() => {
        const next = new URL(location, base);
        return (
          (next.origin === base &&
            next.pathname.startsWith("/cdn-cgi/access/")) ||
          next.hostname.endsWith(".cloudflareaccess.com")
        );
      })();
    requireQa(
      [401, 403].includes(anonymous.status) ||
        ([302, 303, 307].includes(anonymous.status) && accessRedirect),
      "anonymous request bypassed Access",
    );
    await anonymous.body?.cancel();
  }
  const bytes = await readAccessAsset(base, assetPath, headers);
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  if (accessOnly)
    return {
      anonymousAccessDenied: true,
      authenticatedAccess: "passed",
      asset: { path: assetPath, bytes: bytes.length, sha256: digest(bytes) },
    };
  const expected = readFileSync(
    resolve(TARGETS[role].directory, `public${assetPath}`),
  );
  requireQa(
    bytes.length > 0 && digest(bytes) === digest(expected),
    "asset bytes differ from candidate",
  );
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const guard = await installQaCredentialRoute(context, base, headers);
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const login = await navigateQa(page, base, "/login", headers);
    requireQa(
      login?.status() === 200 &&
        new URL(page.url()).origin === base &&
        new URL(page.url()).pathname === "/login",
      "login boundary",
    );
    requireQa(
      (await page.locator('input[type="password"]').count()) > 0,
      "login form absent",
    );
    const decoded = await page.evaluate(async (path) => {
      const img = new Image();
      img.src = path;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    }, assetPath);
    requireQa(
      decoded.width === 32 && decoded.height === 32,
      "asset decode/dimensions",
    );
    const protectedPath = role === "member" ? "/home" : "/";
    await navigateQa(page, base, protectedPath, headers);
    requireQa(
      new URL(page.url()).origin === base &&
        new URL(page.url()).pathname === "/login",
      "application session guard bypassed",
    );
    guard.assertSafe();
    return {
      anonymousAccessDenied: true,
      login: "passed",
      applicationUnauthenticatedGuard: "passed",
      asset: {
        path: assetPath,
        bytes: bytes.length,
        sha256: digest(bytes),
        ...decoded,
      },
    };
  } finally {
    await browser.close();
  }
}
