import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
const rpc = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword, signOut: vi.fn() },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc }),
}));

import { authenticateAction } from "@/app/login/actions";

function form(identifier: string) {
  const data = new FormData();
  data.set("identifier", identifier);
  data.set("password", "Local-password-1234");
  data.set("next", "/start");
  return data;
}

const idle = { message: "", status: "idle" } as const;

describe("login after signup without email confirmation", () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    rpc.mockReset();
  });

  it("tells a correct-password member that email confirmation is pending", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "email_not_confirmed", status: 400, message: "x" },
    });
    const result = await authenticateAction(idle, form("member@putduk.test"));
    expect(result.status).toBe("error");
    expect(result.message).toContain("이메일 확인이 아직 끝나지 않았어요");
    expect(result.message).not.toMatch(/[A-Za-z]{3,}/);
  });

  it("keeps the generic message for wrong credentials and unknown ids", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", status: 400, message: "x" },
    });
    const wrong = await authenticateAction(idle, form("member@putduk.test"));
    expect(wrong.message).toBe("로그인 정보를 확인해 주세요.");

    rpc.mockResolvedValue({ data: null, error: null });
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "email_not_confirmed", status: 400, message: "x" },
    });
    const unknown = await authenticateAction(idle, form("no_such_member"));
    expect(unknown.message).toBe("로그인 정보를 확인해 주세요.");
  });
});
