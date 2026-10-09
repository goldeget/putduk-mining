import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/notifications/[notificationId]/read/route";

const state = vi.hoisted(() => ({
  row: null as null | Record<string, string | null>,
  selected: "",
  mutations: 0,
  filters: [] as { column: string; value: unknown; mutation: boolean }[],
}));
const id = "10000000-0000-4000-8000-000000000001";
const owner = "10000000-0000-4000-8000-000000000002";
const now = new Date("2026-10-09T01:00:00.000Z");

vi.mock("@/lib/auth/session", () => ({
  getVerifiedIdentity: async () => ({
    userId: owner,
    supabase: {
      from(table: string) {
        if (table !== "notifications") throw new Error("UNEXPECTED_TABLE");
        let mutation = false;
        const query = {
          select(fields: string) {
            if (!mutation) state.selected = fields;
            return query;
          },
          eq(column: string, value: unknown) {
            state.filters.push({ column, value, mutation });
            return query;
          },
          lte(column: string, value: unknown) {
            state.filters.push({ column, value, mutation });
            return query;
          },
          is() {
            return query;
          },
          update() {
            mutation = true;
            state.mutations++;
            return query;
          },
          async maybeSingle() {
            if (mutation) return { data: { id }, error: null };
            // Project exactly the requested fields. Deliberately return a stale
            // future row to exercise the application guard as well as SQL filters.
            const data = state.row
              ? Object.fromEntries(
                  state.selected.split(",").map((field) => {
                    const key = field.trim();
                    return [key, state.row![key]];
                  }),
                )
              : null;
            return { data, error: null };
          },
        };
        return query;
      },
    },
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  state.row = {
    id,
    read_at: null,
    expires_at: null,
    scheduled_at: now.toISOString(),
  };
  state.selected = "";
  state.mutations = 0;
  state.filters = [];
});
afterEach(() => vi.useRealTimers());

async function post() {
  return POST(
    new Request(`http://localhost/api/v1/notifications/${id}/read`, {
      method: "POST",
    }),
    {
      params: Promise.resolve({ notificationId: id }),
    },
  );
}

describe("notification read schedule boundary", () => {
  it("rejects a projected future row without setting read_at", async () => {
    state.row!.scheduled_at = "2026-10-09T01:00:00.001Z";
    expect((await post()).status).toBe(410);
    expect(state.mutations).toBe(0);
  });
  it("reads a due owner row while keeping the schedule bound on load and update", async () => {
    expect((await post()).status).toBe(200);
    expect(state.mutations).toBe(1);
    for (const mutation of [false, true]) {
      expect(state.filters).toContainEqual({
        column: "user_id",
        value: owner,
        mutation,
      });
      expect(state.filters).toContainEqual({
        column: "scheduled_at",
        value: now.toISOString(),
        mutation,
      });
    }
  });
  it("does not update an absent owner row", async () => {
    state.row = null;
    expect((await post()).status).toBe(404);
    expect(state.mutations).toBe(0);
  });
});
