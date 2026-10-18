"use client";

import { useActionState, useState } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import {
  bindMoneyFormSubmit,
  MoneyOfflineNote,
  MoneyOperationFields,
  useLogicalOperationKey,
} from "@/components/money-operation-form";
import {
  ConfirmCheckbox,
  ReasonField,
  SubmitButton,
  TextField,
} from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";
import { StepUpTokenField } from "@/components/step-up-token-field";
import {
  useReviewConfirmation,
  useReviewedAction,
} from "@/components/review-confirmation";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { formatKstDateTimeInput } from "@/lib/time/kst-input";

import {
  finalizeWithdrawalLedgerAction,
  recordKrwExternalSendAction,
  releaseWithdrawalHoldAction,
} from "./actions";

export function KrwBankSendForm({
  withdrawalId,
  amountKrw,
}: {
  withdrawalId: string;
  amountKrw: string;
}) {
  const review = useReviewConfirmation([
    "bankReference",
    "actualKrw",
    "sentAt",
  ]);
  const operationKey = useLogicalOperationKey("krw_send");
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const response = useReviewedAction(
    recordKrwExternalSendAction,
    review.revision,
  );
  return (
    <form
      action={response.action}
      className="operator-form"
      onReset={(event) => event.preventDefault()}
      onSubmit={(event) => bindMoneyFormSubmit(event, setOfflineNote)}
      onChange={review.onChange}
    >
      <input name="withdrawalId" type="hidden" value={withdrawalId} />
      <input {...response.revisionField} />
      <MoneyOperationFields operationKey={operationKey} />
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
        defaultValue={formatKstDateTimeInput()}
        label="송금 시각(한국 시간)"
        name="sentAt"
        type="datetime-local"
      />
      <ConfirmCheckbox
        key={`confirm-${review.revision}`}
        label="계좌로 실제 송금했고, 네트워크·거래해시는 해당 없습니다."
        name="confirmation"
        value="RECORD_KRW_SEND"
      />
      <StepUpTokenField
        key={`step-up-${review.revision}`}
        commandFamily={ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR}
      />
      <SubmitButton>계좌 송금 기록</SubmitButton>
      <MoneyOfflineNote message={offlineNote} />
      <QueueFlash result={response.result} stale={response.stale} />
    </form>
  );
}

export function FinalizeLedgerForm({ withdrawalId }: { withdrawalId: string }) {
  const operationKey = useLogicalOperationKey("krw_fin");
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    finalizeWithdrawalLedgerAction,
    null,
  );
  return (
    <form
      action={action}
      className="operator-form"
      onReset={(event) => event.preventDefault()}
      onSubmit={(event) => bindMoneyFormSubmit(event, setOfflineNote)}
    >
      <input name="withdrawalId" type="hidden" value={withdrawalId} />
      <MoneyOperationFields operationKey={operationKey} />
      <p className="panel-note">
        외부 송금은 이미 기록됐습니다. 다시 보내지 말고 원장만 확정하세요.
      </p>
      <ConfirmCheckbox
        label="원장만 확정합니다. 추가 송금은 하지 않습니다."
        name="confirmation"
        value="FINALIZE_LEDGER"
      />
      <StepUpTokenField
        commandFamily={ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR}
      />
      <SubmitButton>원장 확정</SubmitButton>
      <MoneyOfflineNote message={offlineNote} />
      <QueueFlash result={result} />
    </form>
  );
}

export function ReleaseHoldForm({ withdrawalId }: { withdrawalId: string }) {
  const rejectReview = useReviewConfirmation(["reason"]);
  const cancelReview = useReviewConfirmation(["reason"]);
  const rejectKey = useLogicalOperationKey("krw_reject");
  const cancelKey = useLogicalOperationKey("krw_cancel");
  const [rejectOffline, setRejectOffline] = useState<string | null>(null);
  const [cancelOffline, setCancelOffline] = useState<string | null>(null);
  const response = useReviewedAction(
    releaseWithdrawalHoldAction,
    `${rejectReview.revision}:${cancelReview.revision}`,
  );
  return (
    <div className="operator-form-stack">
      <form
        action={response.action}
        className="operator-form operator-form--danger"
        onReset={(event) => event.preventDefault()}
        onSubmit={(event) => bindMoneyFormSubmit(event, setRejectOffline)}
        onChange={rejectReview.onChange}
      >
        <input name="withdrawalId" type="hidden" value={withdrawalId} />
        <input {...response.revisionField} />
        <MoneyOperationFields operationKey={rejectKey} />
        <ReasonField label="거절 사유" />
        <ConfirmCheckbox
          key={`confirm-${rejectReview.revision}`}
          label="운영 거절입니다. 외부 송금 전에만 가능합니다."
          name="confirmation"
          value="REJECT_HOLD"
        />
        <StepUpTokenField
          key={`step-up-${rejectReview.revision}`}
          commandFamily={ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR}
        />
        <SubmitButton variant="danger">거절 · 보류 해제</SubmitButton>
        <MoneyOfflineNote message={rejectOffline} />
      </form>
      <form
        action={response.action}
        className="operator-form operator-form--danger"
        onReset={(event) => event.preventDefault()}
        onSubmit={(event) => bindMoneyFormSubmit(event, setCancelOffline)}
        onChange={cancelReview.onChange}
      >
        <input name="withdrawalId" type="hidden" value={withdrawalId} />
        <input {...response.revisionField} />
        <MoneyOperationFields operationKey={cancelKey} />
        <ReasonField label="취소 사유" />
        <ConfirmCheckbox
          key={`confirm-${cancelReview.revision}`}
          label="운영 취소입니다. 외부 송금 전에만 가능합니다."
          name="confirmation"
          value="CANCEL_HOLD"
        />
        <StepUpTokenField
          key={`step-up-${cancelReview.revision}`}
          commandFamily={ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR}
        />
        <SubmitButton variant="danger">취소 · 보류 해제</SubmitButton>
        <MoneyOfflineNote message={cancelOffline} />
      </form>
      <QueueFlash result={response.result} stale={response.stale} />
    </div>
  );
}
