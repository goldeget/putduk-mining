"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import { ReasonField, SubmitButton } from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";

import { reviewKycCaseAction } from "./actions";

const DECISIONS = [
  { value: "IN_REVIEW", label: "검토 중으로 유지" },
  { value: "APPROVED", label: "승인" },
  { value: "ON_HOLD", label: "보류" },
  { value: "REQUIRES_RESUBMISSION", label: "재제출 요청" },
  { value: "REJECTED", label: "반려" },
] as const;

export function KycReviewForm({ caseId }: { caseId: string }) {
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    reviewKycCaseAction,
    null,
  );
  // Server Action 제출 뒤 uncontrolled 필드가 초기화되어도 검토 값이 유지되게 한다.
  const [decision, setDecision] = useState<string>("IN_REVIEW");
  const [confirmed, setConfirmed] = useState(false);
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
      {/* 브라우저 checkbox name 이 Action 이후 FormData 에서 빠지지 않게 React 상태로 보낸다. */}
      {confirmed ? (
        <input name="confirmation" type="hidden" value="REVIEW_KYC" />
      ) : null}
      <label className="operator-field">
        <span>결과</span>
        <select
          name="decision"
          required
          value={decision}
          onChange={(event) => setDecision(event.target.value)}
        >
          {DECISIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <ReasonField
        label="결정 사유"
        placeholder="왜 이 결정을 했는지 10자 이상 적어 주세요."
      />
      <label className="operator-check">
        <input
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        <span>문서 원문·비밀번호·식별 번호는 이 화면에 표시되지 않습니다.</span>
      </label>
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
