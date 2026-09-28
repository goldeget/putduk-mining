"use client";

import { useActionState } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import {
  ConfirmCheckbox,
  ReasonField,
  SubmitButton,
} from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";

import { acknowledgeReconciliationExceptionAction } from "./actions";

export function ExceptionAckForm({ mismatchId }: { mismatchId: string }) {
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    acknowledgeReconciliationExceptionAction,
    null,
  );
  return (
    <form action={action} className="operator-form">
      <input name="mismatchId" type="hidden" value={mismatchId} />
      <label className="operator-field">
        <span>확인 결과</span>
        <select name="result" required defaultValue="INVESTIGATING">
          <option value="INVESTIGATING">조사 중</option>
          <option value="ACCEPTED">차이 인정(수리 없음)</option>
          <option value="RESOLVED">조사 완료</option>
        </select>
      </label>
      <ReasonField label="확인 사유" />
      <ConfirmCheckbox
        label="자동으로 원장이나 잔액을 고치지 않습니다."
        name="confirmation"
        value="ACK_EXCEPTION"
      />
      <StepUpTokenField
        commandFamily={ADMIN_COMMAND_FAMILIES.RECONCILIATION_ACK}
      />
      <SubmitButton>예외 확인 저장</SubmitButton>
      <QueueFlash result={result} />
    </form>
  );
}
