import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "CONTENT_ADMIN" }));
const service = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminPage: vi.fn(async () => ({ role: state.role })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: service,
}));
import MembersPage from "@/app/(control)/members/page";

describe("new member directory authorization", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["CONTENT_ADMIN", "VIEWER"])(
    "does not enumerate member names for %s",
    async (role) => {
      state.role = role;
      const page = await MembersPage({
        searchParams: Promise.resolve({ q: "회원" }),
      });
      expect(page).toBeDefined();
      expect(service).not.toHaveBeenCalled();
    },
  );
});
