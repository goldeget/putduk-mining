import { beforeEach, describe, expect, it, vi } from "vitest";

const upstream = vi.hoisted(() => ({
  fetch: vi.fn(),
  instrumentation: vi.fn(),
}));
vi.mock("vinext/server/fetch-handler", () => ({
  default: {
    fetch: upstream.fetch,
    __ensureInstrumentation: upstream.instrumentation,
  },
}));

import landing from "@/lib/cloudflare/landing-entry";
import { classifyLandingRequest } from "@/lib/cloudflare/landing-host-policy";
import { PUBLIC_DISCOVERY_PATHS } from "@/lib/trust/public-discovery";

const assetFetch = vi.fn();
const env = { ASSETS: { fetch: assetFetch } };
const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
const request = (path: string, method = "GET") =>
  new Request(`https://putduk.com${path}`, { method });

beforeEach(() => {
  vi.clearAllMocks();
  upstream.fetch.mockImplementation(async () => new Response("official page"));
  assetFetch.mockImplementation(async () => new Response("actual asset bytes"));
});

describe("official apex host boundary", () => {
  it("serves every existing public discovery page through the real entry boundary", async () => {
    for (const path of PUBLIC_DISCOVERY_PATHS) {
      const req = request(path);
      expect(classifyLandingRequest(req)).toEqual({ kind: "page" });
      expect((await landing.fetch(req, env, ctx)).status).toBe(200);
      expect(upstream.fetch).toHaveBeenLastCalledWith(req, env, ctx);
    }
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("keeps necessary Vinext instrumentation on the default export", () => {
    expect(landing.__ensureInstrumentation).toBe(upstream.instrumentation);
  });

  it("serves generated chunks, fonts and approved public artwork directly from ASSETS", async () => {
    for (const path of [
      "/_next/static/chunks/home-123.js",
      "/_next/static/media/PretendardVariable.woff2",
      "/brand/identity/20261014/favicon/favicon.svg",
      "/brand/scenes/first-world/first-world-640-v1.avif",
      "/ranks/rank-1.webp",
      "/putduk-mining-indexnow-v1.txt",
    ]) {
      const req = request(path);
      expect(classifyLandingRequest(req)).toEqual({ kind: "asset" });
      expect(await (await landing.fetch(req, env, ctx)).text()).toBe(
        "actual asset bytes",
      );
      expect(assetFetch).toHaveBeenLastCalledWith(req);
    }
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when an allowed asset has no binding", async () => {
    const response = await landing.fetch(request("/brand/icon.svg"), {}, ctx);
    expect(response.status).toBe(404);
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it("allows only robots and sitemap as generated discovery endpoints", async () => {
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      expect(classifyLandingRequest(request(path))).toEqual({ kind: "page" });
      expect((await landing.fetch(request(path), env, ctx)).status).toBe(200);
    }
  });

  it("serves the declared public manifest for GET and HEAD without admitting sensitive routes", async () => {
    for (const method of ["GET", "HEAD"]) {
      const req = request("/manifest.webmanifest", method);
      expect(classifyLandingRequest(req)).toEqual({ kind: "page" });
      expect((await landing.fetch(req, env, ctx)).status).toBe(200);
      expect(upstream.fetch).toHaveBeenLastCalledWith(req, env, ctx);
    }
    expect(assetFetch).not.toHaveBeenCalled();
    for (const path of [
      "/manifest.webmanifest/",
      "/manifest.webmanifest/private",
      "/manifest.json",
      "/manifest%2ewebmanifest",
    ]) {
      expect(classifyLandingRequest(request(path)).kind).toBe("reject");
    }
  });

  it("redirects safe account and member pages to one fixed origin with the original query", async () => {
    for (const path of [
      "/login",
      "/signup",
      "/find-id",
      "/recover",
      "/home",
      "/start",
      "/mining",
      "/notifications",
      "/ai",
      "/wallet",
      "/wallet/deposit",
      "/menu/account",
      "/events/example",
      "/products/example",
      "/login/",
    ]) {
      const query =
        "?next=%2Fwallet%3Ftab%3Dhistory&next=https%3A%2F%2Fevil.invalid&x=%2F%2Felsewhere.invalid";
      const response = await landing.fetch(request(path + query), env, ctx);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `https://mining.putduk.com${path}${query}`,
      );
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(upstream.fetch).not.toHaveBeenCalled();
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("keeps public paths that resemble member prefixes public", () => {
    expect(classifyLandingRequest(request("/mining-rules"))).toEqual({
      kind: "page",
    });
    expect(classifyLandingRequest(request("/ai/about"))).toEqual({
      kind: "page",
    });
    expect(classifyLandingRequest(request("/ai/faq"))).toEqual({
      kind: "page",
    });
  });

  it("supports HEAD without dispatching account or member requests", async () => {
    expect((await landing.fetch(request("/", "HEAD"), env, ctx)).status).toBe(
      200,
    );
    expect(
      (await landing.fetch(request("/brand/icon.svg", "HEAD"), env, ctx))
        .status,
    ).toBe(200);
    upstream.fetch.mockClear();
    assetFetch.mockClear();
    expect(
      (await landing.fetch(request("/login", "HEAD"), env, ctx)).status,
    ).toBe(307);
    expect(upstream.fetch).not.toHaveBeenCalled();
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("never invokes Vinext or ASSETS for API, callbacks, service workers or unknown paths", async () => {
    for (const path of [
      "/api/v1/me",
      "/api/v1/public/facts",
      "/api/v1/analytics",
      "/auth/callback?code=secret",
      "/auth/update-password",
      "/sw.js",
      "/manifest.webmanifest/private",
      "/README.md",
      "/brand/README.md",
      "/_next/static/README.md",
      "/ranks/private.ts",
      "/unknown",
      "/login-elsewhere",
      "/wallet-elsewhere",
      "/_next/image?url=%2Fprivate",
    ]) {
      const response = await landing.fetch(request(path), env, ctx);
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(upstream.fetch).not.toHaveBeenCalled();
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("never forwards mutations, preflight, TRACE or CONNECT to either upstream", async () => {
    for (const method of [
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
      "TRACE",
      "CONNECT",
    ]) {
      for (const path of [
        "/",
        "/support",
        "/login",
        "/brand/icon.svg",
        "/manifest.webmanifest",
      ]) {
        const raw = {
          url: `https://putduk.com${path}`,
          method,
          headers: new Headers(),
        };
        expect(classifyLandingRequest(raw)).toEqual({
          kind: "reject",
          status: 405,
        });
        const response = await landing.fetch(raw as Request, env, ctx);
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, HEAD");
      }
    }
    expect(upstream.fetch).not.toHaveBeenCalled();
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("requires exact HTTPS apex authority and rejects spoofed Host while ignoring forwarded hosts", async () => {
    for (const url of [
      "http://putduk.com/",
      "https://www.putduk.com/",
      "https://putduk.com.evil.invalid/",
      "https://mining.putduk.com/",
      "https://admin.mining.putduk.com/",
      "https://user@putduk.com/",
      "https://putduk.com:8443/",
      "https://putduk.com:443/",
    ]) {
      const raw = { url, method: "GET", headers: new Headers() };
      expect((await landing.fetch(raw as Request, env, ctx)).status).toBe(421);
    }
    const spoofed = new Request("https://putduk.com/", {
      headers: { host: "mining.putduk.com" },
    });
    expect((await landing.fetch(spoofed, env, ctx)).status).toBe(421);
    expect(upstream.fetch).not.toHaveBeenCalled();
    const forwarded = new Request("https://putduk.com/", {
      headers: { "x-forwarded-host": "evil.invalid" },
    });
    expect(classifyLandingRequest(forwarded)).toEqual({ kind: "page" });
  });

  it("rejects raw and encoded separators, traversal, double encoding and malformed paths", async () => {
    for (const path of [
      "/%6cogin",
      "/brand/%2e%2e/api/v1/me",
      "/brand/../api/v1/me",
      "/brand/./icon.svg",
      "/brand/%252e%252e/api",
      "/brand/%2fapi",
      "/brand/%5capi",
      "/brand/\\api",
      "/brand//icon.svg",
      "//evil.invalid/login",
      "/brand/%00icon.svg",
      "/brand/%ZZ",
      "/%2e%2e/login",
      "/brand/icon.svg#fragment",
    ]) {
      const raw = {
        url: `https://putduk.com${path}`,
        method: "GET",
        headers: new Headers(),
      };
      const response = await landing.fetch(raw as Request, env, ctx);
      expect(response.status, path).toBe(400);
    }
    expect(upstream.fetch).not.toHaveBeenCalled();
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("cannot execute a sensitive route after Request URL normalization", async () => {
    const response = await landing.fetch(
      request("/brand/%2e%2e/api/v1/me"),
      env,
      ctx,
    );
    expect(response.status).toBe(404);
    expect(upstream.fetch).not.toHaveBeenCalled();
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("preserves ordinary public RSC navigation without adding private route suffixes", async () => {
    const req = new Request("https://putduk.com/faq?_rsc=public-variant", {
      headers: { RSC: "1", "Next-Router-Prefetch": "1" },
    });
    expect((await landing.fetch(req, env, ctx)).status).toBe(200);
    expect(upstream.fetch).toHaveBeenCalledExactlyOnceWith(req, env, ctx);
    expect((await landing.fetch(request("/wallet.rsc"), env, ctx)).status).toBe(
      404,
    );
  });

  it("does not dispatch malformed action or service-worker requests even on public pages", async () => {
    for (const name of ["next-action", "x-rsc-action", "service-worker"]) {
      const req = new Request("https://putduk.com/", {
        headers: {
          [name]: "script",
          cookie: "sb-fake-auth-token=not-a-real-token",
        },
      });
      const response = await landing.fetch(req, env, ctx);
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(upstream.fetch).not.toHaveBeenCalled();
    expect(assetFetch).not.toHaveBeenCalled();
  });
});
