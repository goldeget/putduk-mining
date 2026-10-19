import { createHash } from "node:crypto";
import { ACCOUNT, TARGETS, requireQa } from "./qa-cloudflare-policy.mjs";

export const QA_ZONE = Object.freeze({
  id: "c9e6c93451c3c2e107a1eca511bedaba",
  name: "putduk.com",
});

/** Fixed-zone reads only. No discovery, pagination guessing, or writes. */
export async function inspectQaZoneRoutes(token, fetchImpl = fetch) {
  requireQa(token, "route read credential missing");
  async function get(path) {
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4${path}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    requireQa(response.ok, `zone route read failed (${response.status})`);
    const data = await response.json();
    requireQa(data.success === true, "zone route API denied");
    return data;
  }
  const zone = (await get(`/zones/${QA_ZONE.id}`)).result;
  requireQa(
    zone?.id === QA_ZONE.id &&
      zone.name === QA_ZONE.name &&
      zone.account?.id === ACCOUNT,
    "zone owner identity",
  );
  const data = await get(`/zones/${QA_ZONE.id}/workers/routes`);
  requireQa(Array.isArray(data.result), "route inventory missing");
  // The pinned API endpoint is unpaginated. If pagination metadata is supplied,
  // accept only a positively complete first page, never a partial inventory.
  const info = data.result_info;
  if (info !== undefined) {
    requireQa(
      info &&
        info.page === 1 &&
        info.total_pages === 1 &&
        info.total_count === data.result.length &&
        info.count === data.result.length &&
        !info.cursor &&
        !info.cursors &&
        !info.next_page,
      "route inventory pagination incomplete",
    );
  }
  requireQa(
    !data.cursor && !data.cursors && !data.next_page,
    "route inventory continuation",
  );
  const ids = new Set();
  for (const route of data.result) {
    requireQa(
      typeof route.id === "string" &&
        route.id.length > 0 &&
        !ids.has(route.id) &&
        typeof route.pattern === "string" &&
        (route.script === undefined ||
          route.script === null ||
          typeof route.script === "string"),
      "malformed route inventory",
    );
    ids.add(route.id);
    requireQa(
      !Object.values(TARGETS).some((target) => route.script === target.name),
      "QA Worker has a public zone route",
    );
  }
  const routes = data.result
    .map(({ id, pattern, script }) => ({ id, pattern, script: script ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    zoneId: QA_ZONE.id,
    accountId: ACCOUNT,
    count: routes.length,
    sha256: createHash("sha256").update(JSON.stringify(routes)).digest("hex"),
  };
}

/** No credential override is given to route.continue: it propagates over redirects. */
export async function installQaCredentialRoute(context, base, headers) {
  let blocked = false;
  await context.route("**/*", async (route) => {
    const request = route.request();
    try {
      const url = new URL(request.url());
      requireQa(
        url.origin === base && !url.username && !url.password,
        "browser origin",
      );
      const response = await route.fetch({
        headers: { ...request.headers(), ...headers },
        maxRedirects: 0,
        timeout: 20_000,
      });
      const location = response.headers().location;
      if (response.status() >= 300 && response.status() < 400 && location) {
        const next = new URL(location, request.url());
        requireQa(
          next.origin === base && !next.username && !next.password,
          "redirect origin",
        );
        // A fulfilled redirect can bypass the handler on its next hop too.
        // Navigation redirects are admitted by navigateQa before browser.goto;
        // an unexpected browser/resource redirect must abort, even same-origin.
        requireQa(false, "unadmitted browser redirect");
      }
      // Only non-redirect responses reach the browser. Secrets remain in the
      // redirect-disabled API request and never enter browser request headers.
      await route.fulfill({ response });
    } catch {
      blocked = true;
      await route.abort("blockedbyclient");
    }
  });
  return {
    assertSafe: () =>
      requireQa(!blocked, "browser request/redirect was blocked"),
  };
}

/** Admit each navigation hop separately, then render the actual final URL. */
export async function navigateQa(page, base, path, headers) {
  let current = new URL(path, base);
  for (let hop = 0; hop < 8; hop++) {
    requireQa(
      current.origin === base && !current.username && !current.password,
      "navigation redirect origin",
    );
    const response = await page.request.get(current.href, {
      headers,
      maxRedirects: 0,
      timeout: 20_000,
    });
    const status = response.status();
    const location = response.headers().location;
    await response.dispose();
    if ([301, 302, 303, 307, 308].includes(status)) {
      requireQa(location, "navigation redirect missing location");
      current = new URL(location, current);
      continue;
    }
    requireQa(status >= 200 && status < 300, "navigation probe failed");
    return page.goto(current.href, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
  }
  throw new Error("QA_BLOCKED: navigation redirect limit");
}

/** Read only a small known PNG; reject redirects, 403s, empty/HTML and oversized bodies. */
export async function readAccessAsset(base, path, headers, fetchImpl = fetch) {
  const url = new URL(path, base);
  requireQa(
    url.origin === base && !url.username && !url.password,
    "asset origin",
  );
  const response = await fetchImpl(url.href, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  requireQa(
    response.status === 200 &&
      response.headers.get("content-type")?.split(";")[0] === "image/png",
    "authenticated asset HTTP/mime",
  );
  const reader = response.body?.getReader();
  requireQa(reader, "authenticated asset body absent");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireQa(size <= 65_536, "authenticated asset exceeds limit");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(chunks);
  requireQa(
    bytes.length >= 33 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString("ascii", 12, 16) === "IHDR" &&
      bytes.readUInt32BE(16) === 32 &&
      bytes.readUInt32BE(20) === 32,
    "authenticated asset PNG content",
  );
  return bytes;
}

/** The only mutation callback is unreachable until BOTH role preflights finish. */
export async function withQaPairPreflight(preflight, mutate) {
  const admitted = {};
  for (const role of Object.keys(TARGETS))
    admitted[role] = await preflight(role);
  return mutate(admitted);
}
