import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "ADMIN", authenticated: true }));
const read = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    section: "events",
    observedAt: "2026-10-07T01:00:00Z",
    panels: [],
  }),
);
const service = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminPage: vi.fn(async () => {
    if (!state.authenticated) throw new Error("AUTH_REDIRECT");
    return { role: state.role };
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: service,
}));
vi.mock("@/lib/operations/read", () => ({ readOperationsSnapshot: read }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
import OperationsPage from "@/app/(control)/operations/[section]/page";

describe("operations page authorization precedes service reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.role = "ADMIN";
    state.authenticated = true;
  });
  it("does not create the service client for an unauthorized role", async () => {
    state.role = "CONTENT_ADMIN";
    const view = await OperationsPage({
      params: Promise.resolve({ section: "ledger" }),
    });
    expect(view).toBeDefined();
    expect(service).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("does not perform data reads before authentication", async () => {
    state.authenticated = false;
    await expect(
      OperationsPage({ params: Promise.resolve({ section: "events" }) }),
    ).rejects.toThrow("AUTH_REDIRECT");
    expect(service).not.toHaveBeenCalled();
  });
  it("only registered named sections can reach a read", async () => {
    await expect(
      OperationsPage({ params: Promise.resolve({ section: "__proto__" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(service).not.toHaveBeenCalled();
    await OperationsPage({ params: Promise.resolve({ section: "events" }) });
    expect(read).toHaveBeenCalledWith({}, "events");
  });
});
