"use client";

import { useActionState, useEffect, useRef } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import {
  ConfirmCheckbox,
  ReasonField,
  SubmitButton,
} from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";

import { reviewKycCaseAction } from "./actions";

export function KycReviewForm({ caseId }: { caseId: string }) {
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    reviewKycCaseAction,
    null,
  );
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result && statusRef.current) {
      statusRef.current.focus();
    }
  }, [result]);

  return (
    <form
      action={action}
      aria-label="본인 확인 검토"
      className="operator-form"
      noValidate
    >
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
      <ReasonField
        label="결정 사유"
        placeholder="왜 이 결정을 했는지 10자 이상 적어 주세요."
      />
      <ConfirmCheckbox
        label="문서 원문·비밀번호·식별 번호는 이 화면에 표시되지 않습니다."
        name="confirmation"
        value="REVIEW_KYC"
      />
      <StepUpTokenField commandFamily={ADMIN_COMMAND_FAMILIES.KYC_REVIEW} />
      <SubmitButton pendingLabel="저장 중…">검토 결과 저장</SubmitButton>
      <div
        ref={statusRef}
        tabIndex={-1}
        aria-live="polite"
        className="operator-form-stack"
      >
        <QueueFlash result={result} />
        {result && !result.ok ? (
          <p className="panel-note">
            저장에 실패했습니다. 사유와 작업 확인을 점검한 뒤 다시 시도해
            주세요.
          </p>
        ) : null}
      </div>
    </form>
  );
}
