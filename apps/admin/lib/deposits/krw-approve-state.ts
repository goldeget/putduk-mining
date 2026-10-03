export const KRW_APPROVE_COPY = {
  offline: "연결이 끊겼습니다. 다시 연결된 뒤 직접 눌러 주세요.",
  submitting: "입금 반영을 서버에 보내고 있습니다.",
  confirming: "응답을 받은 뒤 입금 상태를 다시 확인하고 있습니다.",
  indeterminate:
    "결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
  confirmedAudit: "원장에 반영되었습니다. 확인 기록도 남았습니다.",
  confirmedNoAudit:
    "원장 상태는 반영으로 확인했습니다. 확인 기록은 아직 보이지 않습니다.",
  confirmedAuditUnknown:
    "원장 상태는 반영으로 확인했습니다. 확인 기록은 다시 열어 주세요.",
  payloadLocked: "처음 보낸 금액과 사유로 다시 확인해 주세요.",
  notApproved:
    "아직 반영되지 않았습니다. 같은 요청으로 다시 확인할 수 있습니다.",
  amountRejected:
    "이 금액으로는 승인되지 않았어요. 이미 다른 금액으로 처리되었습니다.",
} as const;

export type KrwApprovePhase =
  | "editing"
  | "submitting"
  | "confirming"
  | "indeterminate"
  | "error"
  | "confirmed";

export type KrwApproveState = {
  phase: KrwApprovePhase;
  logicalKey: string;
  requestStarted: boolean;
  sentPayload: string | null;
  message: string;
  auditRecorded: boolean | null;
  /** 이번 시도가 다른 금액으로 거절되면 이후 조회를 성공으로 바꾸지 않는다. */
  attemptRejected: boolean;
};

export type KrwApproveEvent =
  | { type: "submit"; online: boolean; payload: string }
  | { type: "cancel" }
  | { type: "transport_lost" }
  | { type: "definite_error"; message: string }
  | { type: "payload_mismatch" }
  | { type: "receipt" }
  | {
      type: "refreshed";
      httpStatus: number;
      status: string | null;
      audit: boolean | null;
      failed: boolean;
      approvedAmountAtomic: string | null;
      ledgerTransactionId: string | null;
      linkedLedgerTransactionId: string | null;
      logicalOperationKey: string | null;
    };

const amountPattern = /^[1-9][0-9]{0,23}$/;

export function createKrwApproveState(logicalKey: string): KrwApproveState {
  return {
    phase: "editing",
    logicalKey,
    requestStarted: false,
    sentPayload: null,
    message: "",
    auditRecorded: null,
    attemptRejected: false,
  };
}

/** 분개에 남기는 키. 승인 함수가 논리 작업 키 뒤에 붙이는 접미사와 같다. */
export function krwDepositJournalIdempotencyKey(logicalKey: string): string {
  return `${logicalKey}:ledger`;
}

function sameKey(
  state: KrwApproveState,
  patch: Partial<KrwApproveState>,
): KrwApproveState {
  return { ...state, ...patch, logicalKey: state.logicalKey };
}

function sentAmountAtomic(state: KrwApproveState): string | null {
  if (!state.sentPayload) return null;
  const cut = state.sentPayload.indexOf("|");
  if (cut <= 0) return null;
  const amount = state.sentPayload.slice(0, cut);
  return amountPattern.test(amount) ? amount : null;
}

function rejectAttempt(state: KrwApproveState): KrwApproveState {
  return sameKey(state, {
    phase: "error",
    message: KRW_APPROVE_COPY.amountRejected,
    auditRecorded: null,
    attemptRejected: true,
  });
}

type RefreshEvent = Extract<KrwApproveEvent, { type: "refreshed" }>;

function approvedAmountDiffers(
  state: KrwApproveState,
  event: RefreshEvent,
): boolean {
  const sentAmount = sentAmountAtomic(state);
  if (!sentAmount || event.failed || event.status !== "APPROVED") return false;
  if (!event.approvedAmountAtomic) return false;
  return event.approvedAmountAtomic !== sentAmount;
}

/** 보낸 금액과 이 논리 작업의 원장 거래가 모두 있을 때만 참이다. */
export function krwApproveReceiptMatches(
  state: KrwApproveState,
  event: RefreshEvent,
): boolean {
  const sentAmount = sentAmountAtomic(state);
  if (!sentAmount || !state.logicalKey || state.attemptRejected) return false;
  if (event.failed || event.status !== "APPROVED") return false;
  if (event.logicalOperationKey !== state.logicalKey) return false;
  if (
    !event.approvedAmountAtomic ||
    event.approvedAmountAtomic !== sentAmount
  ) {
    return false;
  }
  if (!event.ledgerTransactionId || !event.linkedLedgerTransactionId) {
    return false;
  }
  return event.ledgerTransactionId === event.linkedLedgerTransactionId;
}

function confirmedMessage(audit: boolean | null): string {
  if (audit === true) return KRW_APPROVE_COPY.confirmedAudit;
  if (audit === false) return KRW_APPROVE_COPY.confirmedNoAudit;
  return KRW_APPROVE_COPY.confirmedAuditUnknown;
}

/**
 * 성공 문구는 이번 시도의 금액과, 이 논리 작업에 연결된 원장 거래가
 * 모두 일치할 때만 고른다. 상태만 반영인 경우는 성공이 아니다.
 */
export function reduceKrwApprove(
  state: KrwApproveState,
  event: KrwApproveEvent,
): KrwApproveState {
  switch (event.type) {
    case "submit": {
      if (state.attemptRejected) return state;
      if (
        state.phase === "submitting" ||
        state.phase === "confirming" ||
        state.phase === "confirmed"
      ) {
        return state;
      }
      if (!event.online) {
        return sameKey(state, {
          phase: "editing",
          message: KRW_APPROVE_COPY.offline,
        });
      }
      if (
        state.requestStarted &&
        state.sentPayload !== null &&
        state.sentPayload !== event.payload
      ) {
        return sameKey(state, {
          phase: "error",
          message: KRW_APPROVE_COPY.payloadLocked,
        });
      }
      return sameKey(state, {
        phase: "submitting",
        requestStarted: true,
        sentPayload: state.sentPayload ?? event.payload,
        message: KRW_APPROVE_COPY.submitting,
        auditRecorded: null,
      });
    }
    case "cancel": {
      if (state.attemptRejected) return state;
      if (state.phase !== "submitting" && state.phase !== "confirming")
        return state;
      return sameKey(state, {
        phase: "indeterminate",
        message: KRW_APPROVE_COPY.indeterminate,
      });
    }
    case "transport_lost": {
      if (state.attemptRejected || state.phase === "confirmed") return state;
      return sameKey(state, {
        phase: "indeterminate",
        message: KRW_APPROVE_COPY.indeterminate,
      });
    }
    case "definite_error":
      if (state.attemptRejected) return state;
      return sameKey(state, { phase: "error", message: event.message });
    case "payload_mismatch":
      if (state.phase === "confirmed") return state;
      return rejectAttempt(state);
    case "receipt":
      if (state.attemptRejected || state.phase === "confirmed") return state;
      return sameKey(state, {
        phase: "confirming",
        message: KRW_APPROVE_COPY.confirming,
      });
    case "refreshed": {
      if (state.attemptRejected) return state;
      if (event.failed || event.status === null) {
        return sameKey(state, {
          phase: "indeterminate",
          message: KRW_APPROVE_COPY.indeterminate,
          auditRecorded: null,
        });
      }
      if (approvedAmountDiffers(state, event)) return rejectAttempt(state);
      if (krwApproveReceiptMatches(state, event)) {
        return sameKey(state, {
          phase: "confirmed",
          message: confirmedMessage(event.audit),
          auditRecorded: event.audit,
        });
      }
      if (event.status === "APPROVED") {
        return sameKey(state, {
          phase: "indeterminate",
          message: KRW_APPROVE_COPY.indeterminate,
          auditRecorded: null,
        });
      }
      if (event.httpStatus >= 500 || event.httpStatus === 0) {
        return sameKey(state, {
          phase: "indeterminate",
          message: KRW_APPROVE_COPY.indeterminate,
          auditRecorded: event.audit,
        });
      }
      return sameKey(state, {
        phase: "error",
        message: KRW_APPROVE_COPY.notApproved,
        auditRecorded: event.audit,
      });
    }
    default:
      return state;
  }
}
