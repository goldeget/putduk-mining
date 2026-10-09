import { describe, expect, it } from "vitest";

import {
  buildPutdukAiScreenContext,
  buildPutdukAiWideViewHref,
} from "@/components/product/putduk-ai-screen-context";

const PRODUCT_ID = "4d3e1c33-1086-4e59-97f8-2b06759147ce";
const EVENT_ID = "1fe5c6bf-1b1e-49b4-a8bd-c0ab925ac7ee";
const TRANSACTION_ID = "98334dc6-3cad-40de-865e-c5824b1c405b";

describe("PUTDUK AI client screen context", () => {
  it.each(["/products", "/menu/account"])(
    "includes a known app route without widening arbitrary prefixes: %s",
    (pathname) => {
      expect(buildPutdukAiScreenContext({ pathname })).toEqual({
        currentRoute: pathname,
      });
    },
  );

  it("normalizes an event detail to its safe route without exposing the slug", () => {
    expect(
      buildPutdukAiScreenContext({
        pathname: "/events/member-campaign",
        explicitContext: { selectedEvent: EVENT_ID },
      }),
    ).toEqual({ currentRoute: "/events", selectedEvent: EVENT_ID });
  });

  it.each([
    "/products/private",
    "/events/one/two",
    "/events/%2Fsecret",
    "/events/one?token=secret",
  ])(
    "does not turn an unknown path into approved screen context: %s",
    (pathname) =>
      expect(buildPutdukAiScreenContext({ pathname })).toBeUndefined(),
  );

  it("uses new route query hints without retaining a previous screen selection", () => {
    const previous = buildPutdukAiScreenContext({
      pathname: "/events/one",
      searchParams: new URLSearchParams({ selectedEvent: EVENT_ID }),
    });
    expect(previous?.selectedEvent).toBe(EVENT_ID);
    expect(
      buildPutdukAiScreenContext({
        pathname: "/wallet/withdraw",
        searchParams: new URLSearchParams({
          selectedTransaction: TRANSACTION_ID,
        }),
      }),
    ).toEqual({
      currentRoute: "/wallet/withdraw",
      selectedTransaction: TRANSACTION_ID,
    });
  });

  it("keeps only the approved route and explicitly allowlisted query fields", () => {
    const searchParams = new URLSearchParams({
      currentProduct: PRODUCT_ID,
      currentWorld: "KOREA",
      email: "person@example.com",
      returnTo: "https://outside.example/account",
      selectedEvent: EVENT_ID,
      selectedTransaction: TRANSACTION_ID,
      token: "do-not-send",
    });

    expect(
      buildPutdukAiScreenContext({
        pathname: "/menu/ai",
        searchParams,
      }),
    ).toEqual({
      currentProduct: PRODUCT_ID,
      currentRoute: "/menu/ai",
      currentWorld: "KOREA",
      selectedEvent: EVENT_ID,
      selectedTransaction: TRANSACTION_ID,
    });
  });

  it("keeps valid hints when other allowlisted values are invalid", () => {
    const searchParams = new URLSearchParams({
      currentProduct: "not-a-uuid",
      currentWorld: "MARS",
      selectedEvent: EVENT_ID,
      selectedTransaction: "not-a-uuid",
    });

    expect(
      buildPutdukAiScreenContext({ pathname: "/events", searchParams }),
    ).toEqual({
      currentRoute: "/events",
      selectedEvent: EVENT_ID,
    });
  });

  it("prefers explicitly supplied context over query hints", () => {
    const searchParams = new URLSearchParams({
      currentProduct: PRODUCT_ID,
      currentWorld: "USA",
      selectedEvent: EVENT_ID,
      selectedTransaction: TRANSACTION_ID,
    });
    const explicitProduct = "d392af89-3b68-4909-888d-83867df26d2f";
    const explicitTransaction = "ef422fb2-4ea4-4edc-9748-5f1a6e10ee96";

    expect(
      buildPutdukAiScreenContext({
        explicitContext: {
          currentProduct: explicitProduct,
          currentWorld: "GOLD",
          selectedTransaction: explicitTransaction,
        },
        pathname: "/wallet",
        searchParams,
      }),
    ).toEqual({
      currentProduct: explicitProduct,
      currentRoute: "/wallet",
      currentWorld: "GOLD",
      selectedEvent: EVENT_ID,
      selectedTransaction: explicitTransaction,
    });
  });

  it("does not fall through to a query hint when an explicit value is invalid", () => {
    const searchParams = new URLSearchParams({
      currentProduct: PRODUCT_ID,
      currentWorld: "USA",
    });

    expect(
      buildPutdukAiScreenContext({
        explicitContext: {
          currentProduct: "not-a-uuid",
          currentWorld: "MARS",
        } as never,
        pathname: "/menu/ai",
        searchParams,
      }),
    ).toEqual({ currentRoute: "/menu/ai" });
  });

  it.each([
    "/admin",
    "/wallet/history",
    "https://mining.putduk.com/wallet",
    "//outside.example/wallet",
    "/wallet?token=secret",
    "/wallet#balance",
    String.raw`\wallet`,
    "",
  ])("fails closed for an unsafe pathname: %s", (pathname) => {
    const searchParams = new URLSearchParams({
      currentProduct: PRODUCT_ID,
      currentWorld: "KOREA",
      selectedEvent: EVENT_ID,
      selectedTransaction: TRANSACTION_ID,
    });

    expect(
      buildPutdukAiScreenContext({ pathname, searchParams }),
    ).toBeUndefined();
  });

  it("reads only the approved origin and context keys, ignoring arbitrary route or identity input", () => {
    const reads: string[] = [];
    const values = new Map([
      ["currentRoute", "/admin"],
      ["email", "person@example.com"],
      ["phone", "01012345678"],
      ["returnTo", "https://outside.example/account"],
      ["token", "do-not-send"],
      ["url", "https://outside.example/private?token=secret"],
    ]);
    const searchParams = {
      get(key: string) {
        reads.push(key);
        return values.get(key) ?? null;
      },
    };

    const context = buildPutdukAiScreenContext({
      pathname: "/menu/ai",
      searchParams,
    });

    expect(context).toEqual({ currentRoute: "/menu/ai" });
    expect(reads).toEqual([
      "aiOrigin",
      "currentProduct",
      "currentWorld",
      "selectedEvent",
      "selectedTransaction",
    ]);
    expect(JSON.stringify(context)).not.toMatch(
      /admin|person@example|01012345678|outside|secret/,
    );
  });

  it("preserves the validated originating screen through wide view without copying unrelated query fields", () => {
    const context = buildPutdukAiScreenContext({
      pathname: "/wallet/withdraw",
      searchParams: new URLSearchParams({
        selectedTransaction: TRANSACTION_ID,
        email: "private@example.com",
        token: "secret",
      }),
    });
    const href = buildPutdukAiWideViewHref(context);
    const url = new URL(href, "https://mining.putduk.com");
    expect(url.pathname).toBe("/ai");
    expect(url.searchParams.get("aiOrigin")).toBe("/wallet/withdraw");
    expect(href).not.toMatch(/private|email|token|secret/);
    expect(
      buildPutdukAiScreenContext({
        pathname: "/ai",
        searchParams: url.searchParams,
      }),
    ).toEqual(context);
  });

  it.each([
    "/admin",
    "//outside.example/wallet",
    "https://outside.example/wallet",
    "/wallet?token=secret",
    "/wallet/private",
  ])("ignores unsafe wide-view origin hints: %s", (origin) => {
    expect(
      buildPutdukAiScreenContext({
        pathname: "/ai",
        searchParams: new URLSearchParams({ aiOrigin: origin }),
      }),
    ).toEqual({ currentRoute: "/ai" });
    expect(buildPutdukAiWideViewHref({ currentRoute: origin } as never)).toBe(
      "/ai",
    );
  });

  it("does not let an origin hint override the actual page after navigating away from AI", () => {
    expect(
      buildPutdukAiScreenContext({
        pathname: "/events",
        searchParams: new URLSearchParams({ aiOrigin: "/wallet" }),
      }),
    ).toEqual({ currentRoute: "/events" });
  });
});
