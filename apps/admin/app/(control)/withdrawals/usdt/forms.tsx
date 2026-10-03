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
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { formatKstDateTimeInput } from "@/lib/time/kst-input";

import {
  finalizeUsdtWithdrawalLedgerAction,
  recordUsdtExternalSendAction,
  releaseUsdtWithdrawalHoldAction,
} from "./actions";

export function UsdtSendForm({
  withdrawalId,
  networkHint,
}: {
  withdrawalId: string;
  networkHint?: string | undefined;
}) {
  const operationKey = useLogicalOperationKey("usdt_send");
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    recordUsdtExternalSendAction,
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
      <TextField
        defaultValue={networkHint}
        label="네트워크"
        name="network"
        placeholder="예: TRON"
      />
      <TextField
        label="거래 해시"
        name="txHash"
        placeholder="외부 송금 거래 해시"
      />
      <TextField
        inputMode="decimal"
        label="실제 보낸 USDT"
        name="actualUsdt"
        placeholder="예: 35.5"
      />
      <label className="operator-field">
        <span>환산 증빙 (사용한 경우만)</span>
        <textarea
          maxLength={1000}
          name="conversionEvidence"
          placeholder="사용한 환산 근거만. 시세 API 값은 넣지 마세요."
          rows={2}
        />
      </label>
      <TextField
        defaultValue={formatKstDateTimeInput()}
        label="송금 시각(한국 시간)"
        name="sentAt"
        type="datetime-local"
      />
      <ConfirmCheckbox
        label="KRW 잔액 기준 출금이며, 회원 USDT 잔액은 없습니다."
        name="confirmation"
        value="RECORD_USDT_SEND"
      />
      <StepUpTokenField
        commandFamily={ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR}
      />
      <SubmitButton>USDT 외부 송금 기록</SubmitButton>
      <MoneyOfflineNote message={offlineNote} />
      <QueueFlash result={result} />
    </form>
  );
}

export function UsdtFinalizeForm({ withdrawalId }: { withdrawalId: string }) {
  const operationKey = useLogicalOperationKey("usdt_fin");
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    finalizeUsdtWithdrawalLedgerAction,
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
      <p className="panel-note warn-note">
        외부 송금은 이미 기록됐습니다. 「다시 보내기」는 제공하지 않습니다.
        재시도는 원장 확정만 합니다.
      </p>
      <ConfirmCheckbox
        label="원장만 확정합니다. USDT를 다시 보내지 않습니다."
        name="confirmation"
        value="FINALIZE_LEDGER"
      />
      <StepUpTokenField
        commandFamily={ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR}
      />
      <SubmitButton>원장 확정 (재시도)</SubmitButton>
      <MoneyOfflineNote message={offlineNote} />
      <QueueFlash result={result} />
    </form>
  );
}

export function UsdtReleaseForm({ withdrawalId }: { withdrawalId: string }) {
  const rejectKey = useLogicalOperationKey("usdt_reject");
  const cancelKey = useLogicalOperationKey("usdt_cancel");
  const [rejectOffline, setRejectOffline] = useState<string | null>(null);
  const [cancelOffline, setCancelOffline] = useState<string | null>(null);
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    releaseUsdtWithdrawalHoldAction,
    null,
  );
  return (
    <div className="operator-form-stack">
      <form
        action={action}
        className="operator-form operator-form--danger"
        onReset={(event) => event.preventDefault()}
        onSubmit={(event) => bindMoneyFormSubmit(event, setRejectOffline)}
      >
        <input name="withdrawalId" type="hidden" value={withdrawalId} />
        <MoneyOperationFields operationKey={rejectKey} />
        <ReasonField label="거절 사유" />
        <ConfirmCheckbox
          label="운영 거절입니다. 외부 송금 전에만 가능합니다."
          name="confirmation"
          value="REJECT_HOLD"
        />
        <StepUpTokenField
          commandFamily={ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR}
        />
        <SubmitButton variant="danger">거절 · 보류 해제</SubmitButton>
        <MoneyOfflineNote message={rejectOffline} />
      </form>
      <form
        action={action}
        className="operator-form operator-form--danger"
        onReset={(event) => event.preventDefault()}
        onSubmit={(event) => bindMoneyFormSubmit(event, setCancelOffline)}
      >
        <input name="withdrawalId" type="hidden" value={withdrawalId} />
        <MoneyOperationFields operationKey={cancelKey} />
        <ReasonField label="취소 사유" />
        <ConfirmCheckbox
          label="운영 취소입니다. 외부 송금 전에만 가능합니다."
          name="confirmation"
          value="CANCEL_HOLD"
        />
        <StepUpTokenField
          commandFamily={ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR}
        />
        <SubmitButton variant="danger">취소 · 보류 해제</SubmitButton>
        <MoneyOfflineNote message={cancelOffline} />
      </form>
      <QueueFlash result={result} />
    </div>
  );
}
