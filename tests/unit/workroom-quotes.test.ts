import { describe, expect, it, vi } from "vitest";
import { createWorkroomQuoteReader } from "@/lib/workroom/quotes";
describe("reference quotes remain separate from practice settlement", () => {
  it("keeps ten dated fallback records on provider failure and coalesces parallel reads", async () => {
    const fetcher = vi.fn(async () => {
      throw Error("offline");
    });
    const read = createWorkroomQuoteReader(fetcher);
    const [a, b] = await Promise.all([read(), read()]);
    expect(Object.keys(a.quotes)).toHaveLength(10);
    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(
      Object.values(a.quotes).every((q) => q.isFallback && q.asOf && q.source),
    ).toBe(true);
    await read();
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it("calculates FX reference cross rates with explicit 100 JPY units", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("ecb.europa.eu"))
        return new Response(
          "<Cube time='2026-11-04'><Cube currency='KRW' rate='1600'/><Cube currency='USD' rate='1.1'/><Cube currency='CNY' rate='8'/><Cube currency='JPY' rate='160'/></Cube>",
        );
      throw Error("offline");
    });
    const q = (await createWorkroomQuoteReader(fetcher)()).quotes;
    expect(q.jpy?.price).toBe(1000);
    expect(q.jpy?.unit).toBe("100 JPY");
    expect(q.jpy?.isFallback).toBe(false);
    expect(q.usd?.price).toBe(1454.55);
    expect(q.ndx?.currency).toBe("POINT");
  });
});
