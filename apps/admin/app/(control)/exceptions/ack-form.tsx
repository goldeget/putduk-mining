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
import { useReviewConfirmation } from "@/components/review-confirmation";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";

import { acknowledgeReconciliationExceptionAction } from "./actions";

export function ExceptionAckForm({ mismatchId }: { mismatchId: string }) {
  const review = useReviewConfirmation(["result", "reason"]);
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    acknowledgeReconciliationExceptionAction,
    null,
  );

  return (
    <form
      action={action}
      aria-label="대사 예외 확인"
      className="operator-form"
      onChange={review.onChange}
    >
      <input name="mismatchId" type="hidden" value={mismatchId} />
      <label className="operator-field">
        <span>확인 결과</span>
        <select
          aria-label="확인 결과"
          defaultValue="INVESTIGATING"
          name="result"
          required
        >
          <option value="INVESTIGATING">조사 중 (증거 유지)</option>
          <option value="ACCEPTED">차이 인정 (수리 없음)</option>
          <option value="RESOLVED">조사 완료 (수리 없음)</option>
        </select>
      </label>
      <ReasonField
        label="확인 사유"
        minLength={10}
        placeholder="왜 이렇게 확인했는지 10자 이상 적어 주세요."
      />
      <ConfirmCheckbox
        key={`confirm-${review.revision}`}
        label="자동으로 원장이나 잔액을 고치지 않습니다."
        name="confirmation"
        value="ACK_EXCEPTION"
      />
      <StepUpTokenField
        key={`step-up-${review.revision}`}
        commandFamily={ADMIN_COMMAND_FAMILIES.RECONCILIATION_ACK}
      />
      <SubmitButton pendingLabel="저장 중…">예외 확인 저장</SubmitButton>
      <QueueFlash result={result} />
    </form>
  );
}
