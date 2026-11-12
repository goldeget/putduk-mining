import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  ADMIN_IDLE_SECONDS,
  ADMIN_ABSOLUTE_SECONDS,
  ADMIN_STEP_UP_TTL_SECONDS,
} from "@/lib/auth/session";
describe("operator workday session policy", () => {
  it("allows a two hour idle window within a twelve hour absolute session", () => {
    expect(ADMIN_IDLE_SECONDS).toBe(7200);
    expect(ADMIN_ABSOLUTE_SECONDS).toBe(43200);
  });
  it("retains the ten minute sensitive action proof deadline", () => {
    expect(ADMIN_STEP_UP_TTL_SECONDS).toBe(600);
  });
});
