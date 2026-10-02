import { describe, expect, it } from "vitest";

import {
  createKrwApproveState,
  KRW_APPROVE_COPY,
  reduceKrwApprove,
} from "@/lib/deposits/krw-approve-state";
import {
  declaredClientOffline,
  parseLogicalOperationKey,
  requestDeclaredOffline,
} from "@/lib/money/logical-operation";

const key = "krw_dep_0123456789abcdef0123456789abcdef";

describe("KRW approve UX state", () => {
  it("does not confirm from a receipt alone", () => {
    const started = reduceKrwApprove(createKrwApproveState(key), {
      type: "submit",
      online: true,
      payload: "5000|계좌 입금을 확인했습니다",
    });
    const confirming = reduceKrwApprove(started, { type: "receipt" });
    expect(confirming.phase).toBe("confirming");
    expect(confirming.message).not.toContain("반영되었습니다");
    expect(confirming.logicalKey).toBe(key);
  });

  it("confirms only after a refreshed APPROVED status and keeps the logical key", () => {
    const started = reduceKrwApprove(createKrwApproveState(key), {
      type: "submit",
      online: true,
      payload: "5000|계좌 입금을 확인했습니다",
    });
    const confirmed = reduceKrwApprove(started, {
      type: "refreshed",
      httpStatus: 200,
      status: "APPROVED",
      audit: true,
      failed: false,
    });
    expect(confirmed.phase).toBe("confirmed");
    expect(confirmed.message).toBe(KRW_APPROVE_COPY.confirmedAudit);
    expect(confirmed.logicalKey).toBe(key);
    expect(confirmed.auditRecorded).toBe(true);
  });

  it("does not claim an audit row that was not reread", () => {
    const confirmed = reduceKrwApprove(createKrwApproveState(key), {
      type: "refreshed",
      httpStatus: 200,
      status: "APPROVED",
      audit: null,
      failed: false,
    });
    expect(confirmed.message).toBe(KRW_APPROVE_COPY.confirmedAuditUnknown);
  });

  it("blocks offline before send and does not start the request", () => {
    const blocked = reduceKrwApprove(createKrwApproveState(key), {
      type: "submit",
      online: false,
      payload: "5000|계좌 입금을 확인했습니다",
    });
    expect(blocked.phase).toBe("editing");
    expect(blocked.requestStarted).toBe(false);
    expect(blocked.message).toBe(KRW_APPROVE_COPY.offline);
    expect(blocked.logicalKey).toBe(key);
  });

  it("keeps the same key when the response is lost or cancelled", () => {
    const started = reduceKrwApprove(createKrwApproveState(key), {
      type: "submit",
      online: true,
      payload: "5000|계좌 입금을 확인했습니다",
    });
    expect(
      reduceKrwApprove(started, { type: "transport_lost" }).logicalKey,
    ).toBe(key);
    expect(reduceKrwApprove(started, { type: "cancel" }).phase).toBe(
      "indeterminate",
    );
    expect(
      reduceKrwApprove(started, {
        type: "submit",
        online: true,
        payload: "1|다름",
      }).message,
    ).toBe(KRW_APPROVE_COPY.payloadLocked);
  });

  it("ignores a second click while the first request is in flight", () => {
    const started = reduceKrwApprove(createKrwApproveState(key), {
      type: "submit",
      online: true,
      payload: "5000|계좌 입금을 확인했습니다",
    });
    expect(
      reduceKrwApprove(started, {
        type: "submit",
        online: true,
        payload: "5000|계좌 입금을 확인했습니다",
      }),
    ).toBe(started);
  });
});

describe("money offline and logical keys", () => {
  it("treats only an explicit offline flag as a money block", () => {
    expect(declaredClientOffline("0")).toBe(true);
    expect(declaredClientOffline("1")).toBe(false);
    expect(declaredClientOffline(null)).toBe(false);
    expect(
      requestDeclaredOffline(
        new Request("https://admin.example/approve", {
          headers: { "x-putduk-client-online": "0" },
        }),
      ),
    ).toBe(true);
    expect(parseLogicalOperationKey(key)).toBe(key);
    expect(parseLogicalOperationKey("short")).toBeNull();
  });
});
