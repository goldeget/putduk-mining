"use client";

import { useActionState } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import {
  ConfirmCheckbox,
  ReasonField,
  SubmitButton,
} from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";

import { reviewKycCaseAction } from "./actions";

export function KycReviewForm({ caseId }: { caseId: string }) {
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    reviewKycCaseAction,
    null,
  );
  return (
    <form action={action} className="operator-form">
      <input name="caseId" type="hidden" value={caseId} />
      <label className="operator-field">
        <span>결과</span>
        <select name="decision" required defaultValue="IN_REVIEW">
          <option value="IN_REVIEW">검토 중으로 유지</option>
          <option value="APPROVED">승인</option>
          <option value="ON_HOLD">보류</option>
          <option value="REQUIRES_RESUBMISSION">재제출 요청</option>
          <option value="REJECTED">반려</option>
        </select>
      </label>
      <ReasonField label="결정 사유" />
      <ConfirmCheckbox
        label="문서 원문·비밀번호는 이 화면에 표시되지 않습니다."
        name="confirmation"
        value="REVIEW_KYC"
      />
      <SubmitButton>검토 결과 저장</SubmitButton>
      <QueueFlash result={result} />
    </form>
  );
}
