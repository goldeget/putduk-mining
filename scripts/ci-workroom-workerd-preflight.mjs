import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const rows = [];
for (const port of [3000, 3100]) {
  const base = "http://127.0.0.1:" + port;
  const response = await fetch(base + "/__workroom_ci_runtime", {
      signal: AbortSignal.timeout(15000),
    }),
    config = await response.json();
  const keyHash = createHash("sha256")
    .update(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "")
    .digest("hex");
  if (
    !response.ok ||
    config.APP_ENV !== "test" ||
    config.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:63421" ||
    config.publicKeySha256 !== keyHash ||
    config.NEXT_PUBLIC_APP_URL !== base ||
    config.localOnly !== true
  )
    throw Error("WORKROOM_RUNTIME_ISOLATION_FAILED");
  const page = await fetch(base + "/login", {
      signal: AbortSignal.timeout(15000),
    }),
    html = await page.text(),
    csp = page.headers.get("content-security-policy");
  if (
    !page.ok ||
    html.length < 500 ||
    !csp ||
    !csp.includes("object-src 'none'") ||
    !csp.includes("127.0.0.1:63421") ||
    html.includes("osrmyjgmpdspdcwqjwuv.supabase.co") ||
    html.includes("sb_secret_")
  )
    throw Error("WORKROOM_HTML_CSP_OR_PRODUCTION_REFERENCE");
  const assets = [
    ...new Set(
      [
        ...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))(?:[?#][^"]*)?"/g),
      ].map((m) => m[1]),
    ),
  ];
  if (
    !assets.some((a) => a.endsWith(".js")) ||
    !assets.some((a) => a.endsWith(".css"))
  )
    throw Error("WORKROOM_HTML_ASSETS_MISSING");
  for (const path of [
    ...assets,
    ...(port === 3000 ? ["/workroom-icon.svg", "/sw.js"] : []),
  ]) {
    const url = new URL(path, base);
    if (url.origin !== base) continue;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) }),
      bytes = new Uint8Array(await r.arrayBuffer());
    if (
      !r.ok ||
      !bytes.length ||
      r.headers.get("content-type")?.includes("text/html")
    )
      throw Error("WORKROOM_ASSET_EMPTY_OR_FALLBACK:" + url.pathname);
    rows.push({
      port,
      path: url.pathname,
      status: r.status,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  rows.push({ port, config, csp, htmlBytes: Buffer.byteLength(html) });
}
mkdirSync("test-results/workroom-cloudflare-runtime", { recursive: true });
writeFileSync(
  "test-results/workroom-cloudflare-runtime/preflight.json",
  JSON.stringify(rows, null, 2) + "\n",
);
