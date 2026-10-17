import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readBoundedJsonBody } from "@/lib/api/request-body";
import { POST as chat } from "@/app/api/v1/ai/chat/route";
import { POST as feedback } from "@/app/api/v1/ai/feedback/route";
import { POST as analytics } from "@/app/api/v1/analytics/route";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

const ORIGIN = "https://mining.putduk.com";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVerifiedIdentity).mockResolvedValue({
    userId: "11111111-1111-4111-8111-111111111111",
    supabase: {} as SupabaseClient,
  });
  vi.mocked(getServerEnv).mockReturnValue({
    NEXT_PUBLIC_APP_URL: ORIGIN,
  } as ReturnType<typeof getServerEnv>);
});

function streamedRequest(
  path: string,
  chunkSize: number,
  headers: Record<string, string> = {},
) {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled === 20) controller.close();
        else {
          pulled += 1;
          controller.enqueue(new Uint8Array(chunkSize).fill(120));
        }
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, ...headers },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, state: () => ({ pulled, cancelled }) };
}

describe("API streamed payload limits", () => {
  it.each([
    ["chat", "/api/v1/ai/chat", chat, 8192],
    ["feedback", "/api/v1/ai/feedback", feedback, 2048],
    ["analytics", "/api/v1/analytics", analytics, 8192],
  ] as const)(
    "%s cancels oversized chunked bodies before database admission",
    async (_name, path, handler, limit) => {
      const probe = streamedRequest(path, limit);
      const response = await handler(probe.request as NextRequest);
      expect(response.status).toBe(413);
      expect(probe.state()).toEqual({ pulled: 2, cancelled: true });
      expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    },
  );

  it("does not read a body whose declared length exceeds the cap", async () => {
    const probe = streamedRequest("/api/v1/ai/chat", 8192, {
      "content-length": "8193",
    });
    expect((await chat(probe.request)).status).toBe(413);
    expect(probe.state()).toEqual({ pulled: 0, cancelled: true });
  });

  it.each([chat, feedback, analytics])(
    "preserves malformed JSON denial without database writes",
    async (handler) => {
      const response = await handler(
        new Request(`${ORIGIN}/api/v1/request`, {
          method: "POST",
          headers: { origin: ORIGIN },
          body: "{",
        }) as NextRequest,
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_JSON");
      expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    },
  );
});

describe("bounded JSON decoding", () => {
  it("accepts an exact byte limit and UTF-8 characters split across chunks", async () => {
    const bytes = new TextEncoder().encode('"퍼뜩"');
    const request = new Request(`${ORIGIN}/api/v1/request`, {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 2));
          controller.enqueue(bytes.slice(2));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(await readBoundedJsonBody(request, bytes.length)).toEqual({
      ok: true,
      value: "퍼뜩",
    });
  });
  it("counts bytes rather than Korean character length", async () => {
    expect(
      await readBoundedJsonBody(
        new Request(`${ORIGIN}/api`, { method: "POST", body: '"퍼뜩"' }),
        7,
      ),
    ).toEqual({ ok: false, code: "PAYLOAD_TOO_LARGE" });
  });
  it("ignores a misleading small Content-Length when enforcing streamed bytes", async () => {
    const probe = streamedRequest("/api", 8, { "content-length": "1" });
    expect(await readBoundedJsonBody(probe.request, 8)).toEqual({
      ok: false,
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(probe.state()).toEqual({ pulled: 2, cancelled: true });
  });
  it("rejects malformed UTF-8", async () => {
    const request = new Request(`${ORIGIN}/api`, {
      method: "POST",
      body: new Uint8Array([34, 255, 34]),
    });
    expect(await readBoundedJsonBody(request, 8)).toEqual({
      ok: false,
      code: "INVALID_JSON",
    });
  });
});
