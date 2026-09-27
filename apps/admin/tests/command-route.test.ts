import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/v1/admin/deposits/approve/route";
import { requireAdminCommand } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

vi.mock("@/lib/auth/principal", () => ({ requireAdminCommand: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: vi.fn(),
}));

const authorize = vi.mocked(requireAdminCommand);
const service = vi.mocked(createAdminServiceClient);

describe("direct admin command protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 before creating a service client for an unauthenticated request", async () => {
    authorize.mockResolvedValue({
      ok: false,
      status: 401,
      code: "UNAUTHENTICATED",
    });
    const response = await POST(
      new Request(
        "https://admin.mining.putduk.com/api/v1/admin/deposits/approve",
        {
          method: "POST",
        },
      ),
    );
    expect(response.status).toBe(401);
    expect(service).not.toHaveBeenCalled();
  });

  it("returns 403 before parsing command input for a normal user or stale step-up", async () => {
    authorize.mockResolvedValue({
      ok: false,
      status: 403,
      code: "ROLE_REQUIRED",
    });
    const response = await POST(
      new Request(
        "https://admin.mining.putduk.com/api/v1/admin/deposits/approve",
        {
          method: "POST",
          body: "not-json",
        },
      ),
    );
    expect(response.status).toBe(403);
    expect(service).not.toHaveBeenCalled();
  });
});
