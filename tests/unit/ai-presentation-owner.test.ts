import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/v1/ai/chat/route";
import {
  AI_PRESENTATION_OWNER_HEADER,
  matchesAiPresentationOwner,
} from "@/domain/ai/presentation-owner";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

const OWNER_A = "abcdefab-1111-4111-8111-111111111111";
const OWNER_B = "abcdefab-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVerifiedIdentity).mockResolvedValue({
    userId: OWNER_B,
    supabase: {} as SupabaseClient,
  });
  vi.mocked(getServerEnv).mockImplementation(() => {
    throw new Error("No service configured in this isolated test");
  });
});

describe("AI presentation owner consistency", () => {
  it("keeps headerless callers compatible without granting authentication", () => {
    expect(matchesAiPresentationOwner(new Headers(), OWNER_B)).toBe(true);
  });

  it("compares UUID values without allowing owner selection", () => {
    expect(
      matchesAiPresentationOwner(
        new Headers({ [AI_PRESENTATION_OWNER_HEADER]: OWNER_B.toUpperCase() }),
        OWNER_B,
      ),
    ).toBe(true);
    expect(
      matchesAiPresentationOwner(
        new Headers({ [AI_PRESENTATION_OWNER_HEADER]: OWNER_A }),
        OWNER_B,
      ),
    ).toBe(false);
  });

  it.each([
    "",
    "member",
    "null",
    `${OWNER_A}, ${OWNER_B}`,
    "00000000-0000-0000-0000-000000000000",
  ])("rejects malformed or different owner hint: %s", (value) => {
    expect(
      matchesAiPresentationOwner(
        new Headers({ [AI_PRESENTATION_OWNER_HEADER]: value }),
        OWNER_B,
      ),
    ).toBe(false);
  });

  it.each([OWNER_A, "invalid", ""])(
    "rejects stale UI before reading the question or admitting a request: %s",
    async (expectedOwner) => {
      const request = new Request("https://mining.putduk.com/api/v1/ai/chat", {
        method: "POST",
        headers: { [AI_PRESENTATION_OWNER_HEADER]: expectedOwner },
        body: JSON.stringify({ question: "내 지갑 잔액 얼마야?" }),
      });
      const text = vi.spyOn(request, "text");
      const response = await POST(request);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: {
          code: "AI_SESSION_CHANGED",
          message: "로그인 상태가 바뀌었어요. 다시 확인해 주세요.",
        },
      });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(text).not.toHaveBeenCalled();
      expect(getServerEnv).not.toHaveBeenCalled();
      expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    },
  );

  it.each([null, OWNER_B])(
    "matching/headerless requests reach the existing service gate: %s",
    async (hint) => {
      const response = await POST(
        new Request("https://mining.putduk.com/api/v1/ai/chat", {
          method: "POST",
          ...(hint
            ? { headers: { [AI_PRESENTATION_OWNER_HEADER]: hint } }
            : {}),
        }),
      );
      expect(response.status).toBe(503);
      expect(getServerEnv).toHaveBeenCalledOnce();
      expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    },
  );

  it("cannot authenticate an unsigned request with a matching owner hint", async () => {
    vi.mocked(getVerifiedIdentity).mockResolvedValue(null);
    const response = await POST(
      new Request("https://mining.putduk.com/api/v1/ai/chat", {
        method: "POST",
        headers: { [AI_PRESENTATION_OWNER_HEADER]: OWNER_B },
      }),
    );
    expect(response.status).toBe(401);
    expect(getServerEnv).not.toHaveBeenCalled();
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
