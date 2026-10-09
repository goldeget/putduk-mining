import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  activeMemberNotificationExpiryOr,
  filterActiveMemberNotifications,
} from "@/domain/notifications/member-inbox";
import { executeAiTool } from "@/lib/ai/tool-executor";

const NOW = new Date("2026-10-06T00:00:00Z");
type NotificationFixture = {
  title_ko: string;
  created_at: string;
  scheduled_at: string;
  expires_at: string | null;
  read_at: string | null;
};
const notifications = [
  {
    title_ko: "EXPIRED PRIVATE NOTICE",
    created_at: "2026-10-05T23:00:00Z",
    scheduled_at: "2026-10-05T23:00:00Z",
    expires_at: NOW.toISOString(),
    read_at: null,
  },
  {
    title_ko: "아직 유효한 소식",
    created_at: "2026-10-05T22:00:00Z",
    scheduled_at: "2026-10-05T22:00:00Z",
    expires_at: "2026-10-07T00:00:00Z",
    read_at: null,
  },
];
function notificationClient(rows: NotificationFixture[] = notifications) {
  const filters: string[] = [];
  const publicationFilters: { column: string; value: string }[] = [];
  const queryOperations: string[][] = [];
  const supabase = {
    from() {
      let head = false;
      let expiryFiltered = false;
      let publicationCutoff: number | null = null;
      const operations: string[] = [];
      queryOperations.push(operations);
      const query = {
        select(_columns: string, options?: { head?: boolean }) {
          head = Boolean(options?.head);
          return query;
        },
        or(value: string) {
          filters.push(value);
          expiryFiltered = value === activeMemberNotificationExpiryOr(NOW);
          return query;
        },
        lte(column: string, value: string) {
          publicationFilters.push({ column, value });
          if (column === "scheduled_at") publicationCutoff = Date.parse(value);
          operations.push("publication");
          return query;
        },
        order() {
          operations.push("order");
          return query;
        },
        limit() {
          operations.push("limit");
          return query;
        },
        is() {
          return query;
        },
        maybeSingle() {
          return query;
        },
        then(resolve: (value: unknown) => unknown) {
          operations.push(head ? "count" : "latest");
          const unexpired = expiryFiltered
            ? filterActiveMemberNotifications(rows, NOW)
            : rows;
          const cutoff = publicationCutoff;
          const active =
            cutoff === null
              ? unexpired
              : unexpired.filter(
                  (row) => Date.parse(row.scheduled_at) <= cutoff,
                );
          return Promise.resolve(
            head
              ? {
                  count: active.filter((row) => !row.read_at).length,
                  error: null,
                }
              : { data: active[0] ?? null, error: null },
          ).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { supabase, filters, publicationFilters, queryOperations };
}
describe("AI notification inbox truth", () => {
  it("excludes expired latest and unread rows with the same server clock as the inbox", async () => {
    const { supabase, filters } = notificationClient();
    const result = await executeAiTool(supabase, "notification.recent", {
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(filters).toEqual([
      activeMemberNotificationExpiryOr(NOW),
      activeMemberNotificationExpiryOr(NOW),
    ]);
    expect(result.answer).not.toContain("EXPIRED PRIVATE NOTICE");
    expect(result.answer).toContain("아직 유효한 소식");
    expect(result.answer).toContain("1개");
  });
  it("shows no current notifications when every row is expired", async () => {
    const result = await executeAiTool(
      notificationClient(notifications.slice(0, 1)).supabase,
      "notification.recent",
      { now: NOW },
    );
    expect(result.ok).toBe(true);
    expect(result.answer).toContain("본인 알림이 없습니다");
  });
  it("excludes a newer future notice from latest and unread facts, including expiry-null rows", async () => {
    const future = {
      title_ko: "FUTURE PRIVATE NOTICE",
      created_at: "2026-10-05T23:59:59Z",
      scheduled_at: "2026-10-06T00:00:00.001Z",
      expires_at: null,
      read_at: null,
    };
    const publishedAtBoundary = {
      title_ko: "지금 공개된 소식",
      created_at: "2026-10-05T23:50:00Z",
      scheduled_at: NOW.toISOString(),
      expires_at: null,
      read_at: null,
    };
    const alreadyRead = {
      ...notifications[1],
      title_ko: "이미 읽은 공개 소식",
      read_at: "2026-10-05T23:30:00Z",
    };
    const { supabase, publicationFilters, queryOperations } =
      notificationClient([
        future,
        publishedAtBoundary,
        notifications[1],
        alreadyRead,
      ]);
    const result = await executeAiTool(supabase, "notification.recent", {
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.answer).not.toContain(future.title_ko);
    expect(result.answer).toContain(publishedAtBoundary.title_ko);
    expect(result.answer).toContain("2개");
    expect(publicationFilters).toEqual([
      { column: "scheduled_at", value: NOW.toISOString() },
      { column: "scheduled_at", value: NOW.toISOString() },
    ]);
    expect(queryOperations).toEqual([
      ["publication", "order", "limit", "latest"],
      ["publication", "count"],
    ]);
  });
  it("does not reveal a future-only title or unread count before publication", async () => {
    const { supabase, publicationFilters } = notificationClient([
      {
        title_ko: "ONLY FUTURE PRIVATE NOTICE",
        created_at: "2026-10-05T23:00:00Z",
        scheduled_at: "2026-10-06T00:00:00.001Z",
        expires_at: null,
        read_at: null,
      },
    ]);
    const result = await executeAiTool(supabase, "notification.recent", {
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.answer).toContain("본인 알림이 없습니다");
    expect(result.answer).not.toContain("ONLY FUTURE");
    expect(result.answer).not.toContain("1개");
    expect(publicationFilters).toHaveLength(2);
  });
});
