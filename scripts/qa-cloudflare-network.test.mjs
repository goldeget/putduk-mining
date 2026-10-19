import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "@playwright/test";
import { ACCOUNT, TARGETS } from "./qa-cloudflare-policy.mjs";
import {
  QA_ZONE,
  inspectQaZoneRoutes,
  installQaCredentialRoute,
  navigateQa,
  readAccessAsset,
  withQaPairPreflight,
} from "./qa-cloudflare-network.mjs";

async function fixture(handler) {
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(done);
      }),
  };
}
const headers = {
  "CF-Access-Client-Id": "fixture-client",
  "CF-Access-Client-Secret": "fixture-secret-not-real",
};

test("real browser redirect chain never sends Access credentials to an off-origin fixture", async () => {
  const external = [];
  const admitted = [];
  const other = await fixture((req, res) => {
    external.push(req.headers);
    res.end("must not reach");
  });
  const app = await fixture((req, res) => {
    admitted.push({
      path: req.url,
      secret: req.headers["cf-access-client-secret"],
    });
    if (req.url === "/start") {
      res.writeHead(302, { location: "/second" });
      res.end();
    } else if (req.url === "/second") {
      res.writeHead(302, { location: `${other.origin}/capture` });
      res.end();
    } else if (req.url === "/safe") {
      res.writeHead(302, { location: "/login" });
      res.end();
    } else {
      res.setHeader("content-type", "text/html");
      res.end('<input type="password">');
    }
  });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const guard = await installQaCredentialRoute(context, app.origin, headers);
    const page = await context.newPage();
    await assert.rejects(
      () => navigateQa(page, app.origin, "/start", headers),
      /redirect origin/,
    );
    assert.equal(
      external.length,
      0,
      "off-origin listener receives neither a request nor any credential header",
    );
    assert.equal(
      admitted.filter((r) => ["/start", "/second"].includes(r.path)).length,
      2,
    );
    assert.ok(
      admitted.every((r) => r.secret === headers["CF-Access-Client-Secret"]),
    );
    // Bypassing explicit navigation admission cannot make a browser redirect leak either.
    await assert.rejects(() =>
      page.goto(`${app.origin}/start`, { timeout: 10_000 }),
    );
    assert.throws(() => guard.assertSafe(), /blocked/);
    assert.equal(external.length, 0);
    const safeContext = await browser.newContext({ serviceWorkers: "block" });
    const safeGuard = await installQaCredentialRoute(
      safeContext,
      app.origin,
      headers,
    );
    const safePage = await safeContext.newPage();
    await navigateQa(safePage, app.origin, "/safe", headers);
    assert.equal(
      new URL(safePage.url()).pathname,
      "/login",
      "same-origin navigation retains the actual final URL",
    );
    assert.equal(await safePage.locator('input[type="password"]').count(), 1);
    safeGuard.assertSafe();
  } finally {
    await browser.close();
    await app.close();
    await other.close();
  }
});

test("both real HTTP Access probes precede mutation; either nonempty invalid token gives zero deploy calls", async () => {
  const png = readFileSync(
    new URL(
      "../public/brand/identity/20261014/favicon/favicon-32.png",
      import.meta.url,
    ),
  );
  const app = await fixture((req, res) => {
    if (req.headers["cf-access-client-secret"] !== "valid-fixture") {
      res.writeHead(403);
      res.end("denied");
      return;
    }
    res.setHeader("content-type", "image/png");
    res.end(png);
  });
  try {
    for (const invalidRole of ["member", "admin"]) {
      let deployCalls = 0;
      await assert.rejects(
        () =>
          withQaPairPreflight(
            (role) =>
              readAccessAsset(app.origin, `/${role}.png`, {
                ...headers,
                "CF-Access-Client-Secret":
                  role === invalidRole
                    ? "expired-but-nonempty"
                    : "valid-fixture",
              }),
            () => {
              deployCalls++;
            },
          ),
        /authenticated asset/,
      );
      assert.equal(deployCalls, 0);
    }
    const order = [];
    await withQaPairPreflight(
      async (role) => {
        await readAccessAsset(app.origin, `/${role}.png`, {
          ...headers,
          "CF-Access-Client-Secret": "valid-fixture",
        });
        order.push(role);
      },
      () => {
        order.push("mutation");
      },
    );
    assert.deepEqual(order, ["member", "admin", "mutation"]);
  } finally {
    await app.close();
  }
});

test("zone owner and complete fixed-zone inventory are mandatory; either QA script route is rejected", async () => {
  const goodZone = {
    success: true,
    result: { id: QA_ZONE.id, name: QA_ZONE.name, account: { id: ACCOUNT } },
  };
  const goodRoutes = {
    success: true,
    result: [
      {
        id: "retained",
        pattern: "putduk.com/legal/*",
        script: "putduk-social-auto-legal",
      },
    ],
  };
  function api(zone = goodZone, routes = goodRoutes, status = 200) {
    const calls = [];
    return {
      calls,
      fetch: async (url, options) => {
        calls.push({ url, method: options.method });
        if (url === `https://api.cloudflare.com/client/v4/zones/${QA_ZONE.id}`)
          return Response.json(zone);
        assert.equal(
          url,
          `https://api.cloudflare.com/client/v4/zones/${QA_ZONE.id}/workers/routes`,
        );
        return Response.json(routes, { status });
      },
    };
  }
  const good = api();
  const receipt = await inspectQaZoneRoutes("fixture-token", good.fetch);
  assert.equal(receipt.count, 1);
  assert.equal(good.calls.length, 2);
  assert.ok(good.calls.every((r) => r.method === "GET"));
  const foreign = api({
    ...goodZone,
    result: { ...goodZone.result, account: { id: "foreign" } },
  });
  await assert.rejects(
    () => inspectQaZoneRoutes("fixture-token", foreign.fetch),
    /zone owner/,
  );
  assert.equal(foreign.calls.length, 1);
  for (const role of ["member", "admin"]) {
    const unsafe = api(goodZone, {
      success: true,
      result: [
        {
          id: "unsafe",
          pattern: "mining.putduk.com/*",
          script: TARGETS[role].name,
        },
      ],
    });
    await assert.rejects(
      () => inspectQaZoneRoutes("fixture-token", unsafe.fetch),
      /public zone route/,
    );
  }
  for (const bad of [
    {
      ...goodRoutes,
      result_info: { page: 1, total_pages: 2, total_count: 2, count: 1 },
    },
    {
      ...goodRoutes,
      result_info: { page: 1, total_pages: 1, total_count: 2, count: 1 },
    },
    { ...goodRoutes, cursor: "more" },
    { success: false, result: [] },
    { success: true },
  ])
    await assert.rejects(() =>
      inspectQaZoneRoutes("fixture-token", api(goodZone, bad).fetch),
    );
  await assert.rejects(
    () =>
      inspectQaZoneRoutes(
        "fixture-token",
        api(goodZone, goodRoutes, 403).fetch,
      ),
    /403/,
  );
});
