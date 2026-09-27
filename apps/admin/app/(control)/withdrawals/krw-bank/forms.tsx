"use client";

import { useActionState } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import {
  ConfirmCheckbox,
  ReasonField,
  SubmitButton,
  TextField,
} from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";

import {
  finalizeWithdrawalLedgerAction,
  recordKrwExternalSendAction,
  releaseWithdrawalHoldAction,
} from "./actions";

function nowLocalInputValue() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function KrwBankSendForm({
  withdrawalId,
  amountKrw,
}: {
  withdrawalId: string;
  amountKrw: string;
}) {
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    recordKrwExternalSendAction,
    null,
  );
  return (
    <form action={action} className="operator-form">
      <input name="withdrawalId" type="hidden" value={withdrawalId} />
      <TextField
        label="은행 이체 참조(증빙)"
        name="bankReference"
        placeholder="이체 확인번호 또는 증빙 메모"
      />
      <TextField
        defaultValue={amountKrw}
        inputMode="numeric"
        label="실제 보낸 원화"
        name="actualKrw"
      />
      <TextField
        defaultValue={nowLocalInputValue()}
        label="송금 시각"
        name="sentAt"
        type="datetime-local"
      />
      <ConfirmCheckbox
        label="계좌로 실제 송금했고, 네트워크·거래해시는 해당 없습니다."
        name="confirmation"
        value="RECORD_KRW_SEND"
      />
      <SubmitButton>계좌 송금 기록</SubmitButton>
      <QueueFlash result={result} />
    </form>
  );
}

export function FinalizeLedgerForm({ withdrawalId }: { withdrawalId: string }) {
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    finalizeWithdrawalLedgerAction,
    null,
  );
  return (
    <form action={action} className="operator-form">
      <input name="withdrawalId" type="hidden" value={withdrawalId} />
      <p className="panel-note">
        외부 송금은 이미 기록됐습니다. 다시 보내지 말고 원장만 확정하세요.
      </p>
      <ConfirmCheckbox
        label="원장만 확정합니다. 추가 송금은 하지 않습니다."
        name="confirmation"
        value="FINALIZE_LEDGER"
      />
      <SubmitButton>원장 확정</SubmitButton>
      <QueueFlash result={result} />
    </form>
  );
}

export function ReleaseHoldForm({ withdrawalId }: { withdrawalId: string }) {
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    releaseWithdrawalHoldAction,
    null,
  );
  return (
    <div className="operator-form-stack">
      <form action={action} className="operator-form operator-form--danger">
        <input name="withdrawalId" type="hidden" value={withdrawalId} />
        <ReasonField label="거절 사유" />
        <ConfirmCheckbox
          label="운영 거절입니다. 외부 송금 전에만 가능합니다."
          name="confirmation"
          value="REJECT_HOLD"
        />
        <SubmitButton variant="danger">거절 · 보류 해제</SubmitButton>
      </form>
      <form action={action} className="operator-form operator-form--danger">
        <input name="withdrawalId" type="hidden" value={withdrawalId} />
        <ReasonField label="취소 사유" />
        <ConfirmCheckbox
          label="운영 취소입니다. 외부 송금 전에만 가능합니다."
          name="confirmation"
          value="CANCEL_HOLD"
        />
        <SubmitButton variant="danger">취소 · 보류 해제</SubmitButton>
      </form>
      <QueueFlash result={result} />
    </div>
  );
}
