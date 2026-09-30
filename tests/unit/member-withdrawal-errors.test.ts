import { describe, expect, it } from "vitest";

import {
  isMemberFacingWithdrawalCopy,
  memberDestinationRegisterMessage,
  MEMBER_DESTINATION_REGISTER_FALLBACK,
  MEMBER_WITHDRAWAL_NETWORK_FALLBACK,
  MEMBER_WITHDRAWAL_SUBMIT_FALLBACK,
  memberWithdrawalSubmitMessage,
} from "@/components/product/member-withdrawal-errors";

describe("회원 출금 오류 허용 목록", () => {
  it("고장 주입된 PostgreSQL relation 메시지를 제출 UI에 노출하지 않는다", () => {
    const payload = {
      error: {
        code: "WITHDRAWAL_REQUEST_FAILED",
        message: "relation withdrawal_requests does not exist",
      },
    };

    const message = memberWithdrawalSubmitMessage(payload);

    expect(message).toBe(MEMBER_WITHDRAWAL_SUBMIT_FALLBACK);
    expect(message).not.toContain("withdrawal_requests");
    expect(message).not.toContain("relation");
    expect(message).not.toContain("does not exist");
  });

  it("알 수 없는 제출 오류 코드는 닫힌 기본 안내로 대체한다", () => {
    const message = memberWithdrawalSubmitMessage({
      error: {
        code: "SOME_INTERNAL_RPC_BLOB",
        message: 'column "service_role" of relation "secrets" does not exist',
      },
    });

    expect(message).toBe(MEMBER_WITHDRAWAL_SUBMIT_FALLBACK);
    expect(message).not.toContain("service_role");
    expect(message).not.toContain("secrets");
  });

  it("허용된 잔액 부족 코드만 검증 카피를 쓴다", () => {
    expect(
      memberWithdrawalSubmitMessage({
        error: {
          code: "INSUFFICIENT_AVAILABLE_BALANCE",
          message: "raw should never surface",
        },
      }),
    ).toBe("출금 가능 금액이 부족해요.");
  });

  it("목적지 등록에서도 원시 DB 메시지를 차단한다", () => {
    const message = memberDestinationRegisterMessage({
      error: {
        code: "DESTINATION_REGISTER_FAILED",
        message:
          'relation "withdrawal_destinations" does not exist\nDETAIL: schema public',
      },
    });

    expect(message).toBe(MEMBER_DESTINATION_REGISTER_FALLBACK);
    expect(message).not.toContain("withdrawal_destinations");
    expect(message).not.toContain("DETAIL");
    expect(message).not.toContain("schema");
  });

  it("목적지 등록의 알 수 없는 코드·스택 흔적을 차단한다", () => {
    const message = memberDestinationRegisterMessage({
      error: {
        code: "POSTGREST_ERROR",
        message: "Error: at Object.rpc (supabase-js)",
      },
    });

    expect(message).toBe(MEMBER_DESTINATION_REGISTER_FALLBACK);
    expect(message).not.toContain("supabase");
    expect(message).not.toContain("Object.rpc");
  });

  it("서버 message만 있고 code가 없으면 제출·등록 모두 기본 안내다", () => {
    expect(
      memberWithdrawalSubmitMessage({
        error: { message: "relation withdrawal_requests does not exist" },
      }),
    ).toBe(MEMBER_WITHDRAWAL_SUBMIT_FALLBACK);

    expect(
      memberDestinationRegisterMessage({
        error: { message: "permission denied for table wallets" },
      }),
    ).toBe(MEMBER_DESTINATION_REGISTER_FALLBACK);
  });

  it("catch용 허용 카피 판별은 원시 DB 문구를 거부한다", () => {
    expect(
      isMemberFacingWithdrawalCopy(MEMBER_WITHDRAWAL_SUBMIT_FALLBACK),
    ).toBe(true);
    expect(
      isMemberFacingWithdrawalCopy(MEMBER_DESTINATION_REGISTER_FALLBACK),
    ).toBe(true);
    expect(
      isMemberFacingWithdrawalCopy(MEMBER_WITHDRAWAL_NETWORK_FALLBACK),
    ).toBe(true);
    expect(
      isMemberFacingWithdrawalCopy(
        "relation withdrawal_requests does not exist",
      ),
    ).toBe(false);
  });
});
