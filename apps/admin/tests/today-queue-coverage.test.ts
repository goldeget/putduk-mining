import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTodaySnapshot } from "@/app/(control)/_lib/load-today-snapshot";

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  failed: new Set<string>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => {
          filters[field] = value;
          return query;
        },
        in: (field: string, values: unknown[]) => {
          filters[field] = values;
          return query;
        },
        or: () => query,
        order: () => query,
        limit: () => query,
        then(resolve: (value: unknown) => unknown) {
          const rows = (fixture.rows[table] ?? []).filter((row) =>
            Object.entries(filters).every(([key, value]) =>
              Array.isArray(value)
                ? value.includes(row[key])
                : row[key] === value,
            ),
          );
          return Promise.resolve(
            fixture.failed.has(table)
              ? {
                  error: { message: "read unavailable" },
                  count: null,
                  data: null,
                }
              : { error: null, count: rows.length, data: rows },
          ).then(resolve);
        },
      };
      return query;
    },
  }),
}));
beforeEach(() => {
  fixture.rows = {};
  fixture.failed.clear();
});

describe("today dashboard covers actual operator queues", () => {
  it("cannot say no work when only a canonical KRW deposit is pending", async () => {
    fixture.rows.deposit_requests = [
      { currency: "KRW", status: "AWAITING_TRANSFER" },
      { currency: "USDT", status: "REQUESTED" },
      { currency: "KRW", status: "APPROVED" },
    ];
    const snapshot = await loadTodaySnapshot();
    expect(snapshot.allQueuesEmpty).toBe(false);
    expect(snapshot.attentionTotal).toEqual({ kind: "ready", count: 1 });
    expect(
      snapshot.attention.find((item) => item.code === "KRW_DEPOSIT"),
    ).toMatchObject({
      href: "/deposits/krw",
      status: { kind: "ready", count: 1 },
    });
  });
  it.each(["KRW_BANK", "USDT_ADDRESS"])(
    "counts held, processing and sent-but-unfinalized %s withdrawals",
    async (destination_type) => {
      fixture.rows.withdrawal_requests = [
        "HELD",
        "ADMIN_PROCESSING",
        "EXTERNAL_SENT_RECORDED",
        "COMPLETED",
        "CANCELLED",
      ].map((status) => ({ destination_type, status }));
      const snapshot = await loadTodaySnapshot();
      expect(snapshot.attentionTotal).toEqual({ kind: "ready", count: 3 });
      expect(snapshot.allQueuesEmpty).toBe(false);
    },
  );
  it("keeps an unreadable KRW queue unknown instead of an empty healthy total", async () => {
    fixture.failed.add("deposit_requests");
    const snapshot = await loadTodaySnapshot();
    expect(snapshot.attentionTotal).toEqual({ kind: "unavailable" });
    expect(snapshot.allQueuesEmpty).toBe(false);
    expect(snapshot.hasUnavailable).toBe(true);
  });
  it("counts canonical USDT submissions independently from legacy deposit rows", async () => {
    fixture.rows.usdt_manual_deposits = [
      { status: "SUBMITTED" },
      { status: "CONFIRMED" },
    ];
    fixture.rows.deposit_requests = [{ currency: "USDT", status: "REQUESTED" }];
    const snapshot = await loadTodaySnapshot();
    expect(snapshot.attentionTotal).toEqual({ kind: "ready", count: 1 });
    expect(
      snapshot.attention.find((item) => item.code === "USDT_DEPOSIT")?.status,
    ).toEqual({ kind: "ready", count: 1 });
  });
});
