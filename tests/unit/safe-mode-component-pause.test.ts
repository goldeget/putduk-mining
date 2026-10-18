import { describe, expect, it, vi } from "vitest";

import { assertComponentActive } from "@/lib/safe-mode/assert-component-active.server";
import {
  decideSafeMode,
  readSafeModeDecision,
  SAFE_MODE_MEMBER_COPY,
} from "@/lib/safe-mode/app-guard";

const NOW = new Date("2026-10-19T00:00:00.000Z");
const PAST = "2026-10-18T00:00:00.000Z";
const FUTURE = "2026-10-20T00:00:00.000Z";

function client(rows: unknown, error: unknown = null) {
  const inFn = vi.fn(async () => ({ data: rows, error }));
  const select = vi.fn(() => ({ in: inFn }));
  const from = vi.fn(() => ({ select }));
  return { from, select, inFn };
}

describe("safe mode decision (same predicate as app_private.assert_not_safe_mode)", () => {
  it("is active when nothing is paused", () => {
    expect(decideSafeMode([], "SIGNUP", NOW)).toBe("ACTIVE");
    expect(
      decideSafeMode(
        [{ component: "SIGNUP", is_paused: false, starts_at: PAST }],
        "SIGNUP",
        NOW,
      ),
    ).toBe("ACTIVE");
  });

  it.each(["SIGNUP", "AI", "NOTIFICATION"] as const)(
    "pauses %s by its own control or by GLOBAL once started",
    (component) => {
      expect(
        decideSafeMode(
          [{ component, is_paused: true, starts_at: PAST }],
          component,
          NOW,
        ),
      ).toBe("PAUSED");
      expect(
        decideSafeMode(
          [
            {
              component: "GLOBAL",
              is_paused: true,
              starts_at: NOW.toISOString(),
            },
          ],
          component,
          NOW,
        ),
      ).toBe("PAUSED");
    },
  );

  it("ignores a pause that has not started and unrelated components", () => {
    expect(
      decideSafeMode(
        [{ component: "SIGNUP", is_paused: true, starts_at: FUTURE }],
        "SIGNUP",
        NOW,
      ),
    ).toBe("ACTIVE");
    expect(
      decideSafeMode(
        [{ component: "AI", is_paused: true, starts_at: PAST }],
        "SIGNUP",
        NOW,
      ),
    ).toBe("ACTIVE");
  });

  it("never treats unreadable data as permission", () => {
    expect(decideSafeMode(null, "AI", NOW)).toBe("UNKNOWN");
    expect(decideSafeMode(undefined, "AI", NOW)).toBe("UNKNOWN");
    expect(
      decideSafeMode(
        [{ component: "AI", is_paused: "yes", starts_at: PAST }],
        "AI",
        NOW,
      ),
    ).toBe("UNKNOWN");
    expect(
      decideSafeMode(
        [{ component: "AI", is_paused: true, starts_at: "not a date" }],
        "AI",
        NOW,
      ),
    ).toBe("UNKNOWN");
    expect(decideSafeMode([], "AI", new Date("invalid"))).toBe("UNKNOWN");
    // 멈춤이 확인되면 읽을 수 없는 다른 행이 있어도 PAUSED가 우선한다.
    expect(
      decideSafeMode(
        [
          { component: "GLOBAL", is_paused: true, starts_at: PAST },
          { component: "AI", is_paused: null, starts_at: PAST },
        ],
        "AI",
        NOW,
      ),
    ).toBe("PAUSED");
  });
});

describe("server reads of safe_mode_controls", () => {
  it("reads only GLOBAL and the target component", async () => {
    const db = client([]);
    expect(await readSafeModeDecision(db, "SIGNUP", NOW)).toBe("ACTIVE");
    expect(db.from).toHaveBeenCalledWith("safe_mode_controls");
    expect(db.inFn).toHaveBeenCalledWith("component", ["GLOBAL", "SIGNUP"]);
  });

  it("returns UNKNOWN on a read error or a client that cannot read", async () => {
    expect(
      await readSafeModeDecision(client(null, { message: "x" }), "AI", NOW),
    ).toBe("UNKNOWN");
    expect(await readSafeModeDecision({}, "AI", NOW)).toBe("UNKNOWN");
    expect(
      await readSafeModeDecision(
        {
          from: () => {
            throw new Error("down");
          },
        },
        "AI",
        NOW,
      ),
    ).toBe("UNKNOWN");
  });

  it("maps decisions to the server guard result", async () => {
    expect(
      await assertComponentActive("SIGNUP", { client: client([]), now: NOW }),
    ).toEqual({ ok: true });
    expect(
      await assertComponentActive("AI", {
        client: client([{ component: "AI", is_paused: true, starts_at: PAST }]),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "PAUSED" });
    expect(
      await assertComponentActive("NOTIFICATION", {
        client: client(null, { message: "x" }),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "UNAVAILABLE" });
  });

  it("keeps member copy short and free of engineering words", () => {
    for (const copy of Object.values(SAFE_MODE_MEMBER_COPY)) {
      for (const text of [copy.paused, copy.unavailable]) {
        expect(text.length).toBeLessThanOrEqual(60);
        expect(text).not.toMatch(/safe|mode|SAFE|오류 코드|DB/);
      }
    }
  });
});
