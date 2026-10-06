import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  activeMemberNotificationExpiryOr,
  filterActiveMemberNotifications,
} from "@/domain/notifications/member-inbox";
import { executeAiTool } from "@/lib/ai/tool-executor";

const NOW = new Date("2026-10-06T00:00:00Z");
const notifications = [
  {
    title_ko: "EXPIRED PRIVATE NOTICE",
    created_at: "2026-10-05T23:00:00Z",
    expires_at: NOW.toISOString(),
    read_at: null,
  },
  {
    title_ko: "아직 유효한 소식",
    created_at: "2026-10-05T22:00:00Z",
    expires_at: "2026-10-07T00:00:00Z",
    read_at: null,
  },
];
function notificationClient(rows = notifications) {
  const filters: string[] = [];
  const supabase = {
    from() {
      let head = false;
      let expiryFiltered = false;
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
        order() {
          return query;
        },
        limit() {
          return query;
        },
        is() {
          return query;
        },
        maybeSingle() {
          return query;
        },
        then(resolve: (value: unknown) => unknown) {
          const active = expiryFiltered
            ? filterActiveMemberNotifications(rows, NOW)
            : rows;
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
  return { supabase, filters };
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
});
