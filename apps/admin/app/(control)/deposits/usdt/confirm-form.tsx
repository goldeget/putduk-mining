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
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";

import { confirmUsdtManualDepositAction } from "./actions";

export function ConfirmUsdtDepositForm({
  depositId,
  suggestedKrw,
}: {
  depositId: string;
  suggestedKrw?: string;
}) {
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    confirmUsdtManualDepositAction,
    null,
  );

  return (
    <form action={action} className="operator-form">
      <input name="depositId" type="hidden" value={depositId} />
      <TextField
        defaultValue={suggestedKrw}
        inputMode="numeric"
        label="반영할 원화 금액"
        name="creditedKrw"
        placeholder="예: 50000"
      />
      <ReasonField label="확인 사유" />
      <ConfirmCheckbox
        label="외부 이체를 확인했고, 원화 입금만 반영합니다. 출금과는 별개입니다."
        name="confirmation"
        value="CONFIRM_USDT_DEPOSIT"
      />
      <StepUpTokenField
        commandFamily={ADMIN_COMMAND_FAMILIES.DEPOSIT_CONFIRM}
      />
      <SubmitButton pendingLabel="확인 중…">입금 확인 · 원화 반영</SubmitButton>
      <QueueFlash result={result} />
    </form>
  );
}
