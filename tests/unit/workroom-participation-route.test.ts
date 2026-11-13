import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rpc: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/auth/session", () => ({ requirePageUser: state.requireUser }));
vi.mock("next/navigation", () => ({ notFound: state.notFound }));
vi.mock("@/components/workroom/workroom-page", () => ({
  WorkroomPage: () => null,
}));
import Page from "../../app/(product)/workroom/history/page";
import {
  ParticipationResult,
  ParticipationResultError,
} from "../../components/workroom/participation-history";
const round = "11111111-1111-4111-8111-111111111111";
const result = {
  id: round,
  instrument: "nvda",
  stake: 1000,
  returned: 1025,
  profit: 25,
  closedAt: 1794567022000,
  status: "completed",
};
beforeEach(() => {
  vi.clearAllMocks();
  state.requireUser.mockResolvedValue({
    userId: "verified-owner",
    supabase: { rpc: state.rpc },
  });
  state.rpc.mockResolvedValue({ data: { round: result }, error: null });
});
describe("completed result route retains original owner/read boundary", () => {
  it("uses the authenticated self-scoped original read and passes through server figures", async () => {
    const element = await Page({ searchParams: Promise.resolve({ round }) });
    expect(state.requireUser).toHaveBeenCalledWith(
      `/workroom/history?round=${round}`,
    );
    expect(state.rpc).toHaveBeenCalledWith("workroom_app_member", {
      p_operation: "ROUND_READ",
      p_request_key: null,
      p_input: { roundId: round },
    });
    expect(element.type).toBe(ParticipationResult);
    expect(element.props.result).toEqual(result);
  });
  it.each(["bad-id", [round, round]])(
    "rejects an invalid or ambiguous deep link before reading private state",
    async (value) => {
      await expect(
        Page({ searchParams: Promise.resolve({ round: value }) }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
      expect(state.requireUser).not.toHaveBeenCalled();
      expect(state.rpc).not.toHaveBeenCalled();
    },
  );
  it("keeps foreign/missing rounds on the not-found path", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: { message: "WORKROOM_ROUND_NOT_FOUND" },
    });
    await expect(
      Page({ searchParams: Promise.resolve({ round }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it.each([
    { data: { round: { ...result, status: "active" } }, error: null },
    { data: null, error: { message: "UNAVAILABLE" } },
  ])(
    "shows only error and retry for active or unconfirmed results",
    async (response) => {
      state.rpc.mockResolvedValue(response);
      const element = await Page({ searchParams: Promise.resolve({ round }) });
      expect(element.type).toBe(ParticipationResultError);
      expect(element.props.retryHref).toBe(`/workroom/history?round=${round}`);
    },
  );
});
