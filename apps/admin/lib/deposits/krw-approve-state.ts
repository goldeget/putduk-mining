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
};

export type KrwApproveEvent =
  | { type: "submit"; online: boolean; payload: string }
  | { type: "cancel" }
  | { type: "transport_lost" }
  | { type: "definite_error"; message: string }
  | { type: "receipt" }
  | {
      type: "refreshed";
      httpStatus: number;
      status: string | null;
      audit: boolean | null;
      failed: boolean;
    };

export function createKrwApproveState(logicalKey: string): KrwApproveState {
  return {
    phase: "editing",
    logicalKey,
    requestStarted: false,
    sentPayload: null,
    message: "",
    auditRecorded: null,
  };
}

function sameKey(
  state: KrwApproveState,
  patch: Partial<KrwApproveState>,
): KrwApproveState {
  return { ...state, ...patch, logicalKey: state.logicalKey };
}

/** 성공 문구는 상태 재조회가 APPROVED일 때만 고른다. */
export function reduceKrwApprove(
  state: KrwApproveState,
  event: KrwApproveEvent,
): KrwApproveState {
  switch (event.type) {
    case "submit": {
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
      if (state.phase !== "submitting" && state.phase !== "confirming")
        return state;
      return sameKey(state, {
        phase: "indeterminate",
        message: KRW_APPROVE_COPY.indeterminate,
      });
    }
    case "transport_lost": {
      if (state.phase === "confirmed") return state;
      return sameKey(state, {
        phase: "indeterminate",
        message: KRW_APPROVE_COPY.indeterminate,
      });
    }
    case "definite_error":
      return sameKey(state, { phase: "error", message: event.message });
    case "receipt":
      if (state.phase === "confirmed") return state;
      return sameKey(state, {
        phase: "confirming",
        message: KRW_APPROVE_COPY.confirming,
      });
    case "refreshed": {
      if (event.failed || event.status === null) {
        return sameKey(state, {
          phase: "indeterminate",
          message: KRW_APPROVE_COPY.indeterminate,
          auditRecorded: null,
        });
      }
      if (event.status === "APPROVED") {
        const message =
          event.audit === true
            ? KRW_APPROVE_COPY.confirmedAudit
            : event.audit === false
              ? KRW_APPROVE_COPY.confirmedNoAudit
              : KRW_APPROVE_COPY.confirmedAuditUnknown;
        return sameKey(state, {
          phase: "confirmed",
          message,
          auditRecorded: event.audit,
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
