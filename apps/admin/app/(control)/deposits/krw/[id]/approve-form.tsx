"use client";

import { useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ReasonField, TextField } from "@/components/operator-fields";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import {
  createKrwApproveState,
  reduceKrwApprove,
  type KrwApproveEvent,
} from "@/lib/deposits/krw-approve-state";
import {
  CLIENT_ONLINE_HEADER,
  createLogicalOperationKey,
} from "@/lib/money/logical-operation";

type Receipt = {
  status?: string | null;
  auditRecorded?: boolean | null;
  approvedAmountAtomic?: string | null;
  ledgerTransactionId?: string | null;
  linkedLedgerTransactionId?: string | null;
  logicalOperationKey?: string | null;
};

const amountPattern = /^[1-9][0-9]{0,23}$/;

function fieldValue(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement
  ) {
    return field.value.trim();
  }
  return "";
}

export function KrwDepositApproveForm({
  depositRequestId,
  requestedAmount,
}: {
  depositRequestId: string;
  requestedAmount: string;
}) {
  const router = useRouter();
  const [logicalKey] = useState(() => createLogicalOperationKey("krw_dep"));
  const [state, dispatch] = useReducer(
    reduceKrwApprove,
    logicalKey,
    createKrwApproveState,
  );
  const [clientMessage, setClientMessage] = useState("");
  const sent = useRef<{ amount: string; reason: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const busy = state.phase === "submitting" || state.phase === "confirming";
  const locked = state.phase === "confirmed" || state.attemptRejected;
  const submitLabel =
    state.requestStarted && state.phase !== "confirmed"
      ? "같은 요청으로 다시 확인"
      : "원화 입금 반영하기";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setClientMessage("");
    const form = event.currentTarget;
    const liveAmount = fieldValue(form, "receivedAmountAtomic");
    const liveReason = fieldValue(form, "reason");
    const amount = sent.current?.amount ?? liveAmount;
    const reason = sent.current?.reason ?? liveReason;
    if (!amountPattern.test(amount) || reason.length < 10) {
      setClientMessage("반영할 원화와 확인 사유를 다시 적어 주세요.");
      return;
    }
    if (
      !form.querySelector<HTMLInputElement>('input[name="confirmation"]')
        ?.checked
    ) {
      setClientMessage("반영 확인을 선택한 뒤 진행해 주세요.");
      return;
    }
    const payload = `${amount}|${reason}`;
    const online = navigator.onLine;
    let cursor = state;
    const apply = (nextEvent: KrwApproveEvent) => {
      cursor = reduceKrwApprove(cursor, nextEvent);
      dispatch(nextEvent);
    };
    const next = reduceKrwApprove(state, { type: "submit", online, payload });
    if (next.phase !== "submitting") {
      apply({ type: "submit", online, payload });
      return;
    }
    const token =
      form.querySelector<HTMLInputElement>('input[name="stepUpToken"]')
        ?.value ?? "";
    if (!sent.current) sent.current = { amount, reason };
    busyRef.current = true;
    apply({ type: "submit", online, payload });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/v1/admin/deposits/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": state.logicalKey,
          [CLIENT_ONLINE_HEADER]: "1",
        },
        body: JSON.stringify({
          confirmation: "APPROVE_DEPOSIT",
          depositRequestId,
          reason,
          receivedAmountAtomic: amount,
          stepUpToken: token,
        }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      if (controller.signal.aborted) {
        apply({ type: "cancel" });
        return;
      }
      // 다른 금액으로 이미 처리된 요청은 이번 시도의 끝이다.
      if (
        response.status === 409 &&
        body?.error?.code === "IDEMPOTENCY_PAYLOAD_MISMATCH"
      ) {
        apply({ type: "payload_mismatch" });
        return;
      }
      if (
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403
      ) {
        apply({
          type: "definite_error",
          message: body?.error?.message || "입금 반영을 진행하지 못했습니다.",
        });
        return;
      }
      apply({ type: "receipt" });
      let receipt: Receipt | null = null;
      let refreshFailed = true;
      try {
        const statusResponse = await fetch(
          "/api/v1/admin/deposits/krw/status",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              [CLIENT_ONLINE_HEADER]: "1",
            },
            body: JSON.stringify({
              depositRequestId,
              logicalOperationKey: state.logicalKey,
            }),
            signal: controller.signal,
          },
        );
        receipt =
          (
            (await statusResponse.json().catch(() => null)) as {
              data?: Receipt;
            } | null
          )?.data ?? null;
        refreshFailed = !statusResponse.ok || !receipt?.status;
      } catch {
        if (controller.signal.aborted) {
          apply({ type: "cancel" });
          return;
        }
      }
      apply({
        type: "refreshed",
        httpStatus: response.status,
        status: receipt?.status ?? null,
        audit: receipt?.auditRecorded ?? null,
        failed: refreshFailed,
        approvedAmountAtomic:
          typeof receipt?.approvedAmountAtomic === "string"
            ? receipt.approvedAmountAtomic
            : null,
        ledgerTransactionId:
          typeof receipt?.ledgerTransactionId === "string"
            ? receipt.ledgerTransactionId
            : null,
        linkedLedgerTransactionId:
          typeof receipt?.linkedLedgerTransactionId === "string"
            ? receipt.linkedLedgerTransactionId
            : null,
        logicalOperationKey:
          typeof receipt?.logicalOperationKey === "string"
            ? receipt.logicalOperationKey
            : null,
      });
      if (cursor.phase === "confirmed") router.refresh();
    } catch {
      if (controller.signal.aborted) apply({ type: "cancel" });
      else apply({ type: "transport_lost" });
    } finally {
      busyRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  return (
    <form className="operator-form" onSubmit={(event) => void submit(event)}>
      <p className="panel-note">
        확인은 10분 안에 한 번만 씁니다. 반영 여부는 서버 상태를 다시 읽은 뒤에
        알 수 있습니다.
      </p>
      <TextField
        defaultValue={requestedAmount}
        inputMode="numeric"
        label="반영할 원화"
        name="receivedAmountAtomic"
      />
      <ReasonField label="확인 사유" />
      <label className="operator-check">
        <input
          name="confirmation"
          required
          type="checkbox"
          value="APPROVE_DEPOSIT"
        />
        <span>계좌 입금을 확인했고, 이 금액만 원화 잔액에 반영합니다.</span>
      </label>
      <StepUpTokenField
        commandFamily={ADMIN_COMMAND_FAMILIES.DEPOSIT_APPROVE}
        submissionPending={busy}
      />
      <div className="auth-actions">
        <button className="gold-button" disabled={busy || locked} type="submit">
          {busy ? "확인 중…" : submitLabel}
        </button>
        {busy ? (
          <button
            className="ghost-button"
            onClick={() => abortRef.current?.abort()}
            type="button"
          >
            보내기 취소
          </button>
        ) : null}
      </div>
      {state.requestStarted ? (
        <p className="panel-note">
          다시 보낼 때는 처음 금액과 사유를 그대로 사용합니다.
        </p>
      ) : null}
      {clientMessage || state.message ? (
        <p
          className={
            state.phase === "confirmed"
              ? "queue-flash queue-flash--ok"
              : "queue-flash"
          }
          role="status"
        >
          {clientMessage || state.message}
        </p>
      ) : null}
    </form>
  );
}
