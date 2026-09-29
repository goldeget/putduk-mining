"use client";

import { useActionState, useState } from "react";

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

const DECISIONS = [
  { value: "IN_REVIEW", label: "검토 중으로 유지" },
  { value: "APPROVED", label: "승인" },
  { value: "ON_HOLD", label: "보류" },
  { value: "REQUIRES_RESUBMISSION", label: "재제출 요청" },
  { value: "REJECTED", label: "반려" },
] as const;

/**
 * 출금/입금 운영 폼과 동일: ConfirmCheckbox 로 confirmation DOM 을 고정하고,
 * StepUpTokenField 형제를 조건부 삽입으로 remount 하지 않는다.
 * decision 은 TextField 와 같이 상태로 유지해 Action 재시도에도 값이 남는다.
 */
export function KycReviewForm({ caseId }: { caseId: string }) {
  const [result, dispatch] = useActionState<
    CommandActionResult | null,
    FormData
  >(reviewKycCaseAction, null);
  const [decision, setDecision] = useState<string>("IN_REVIEW");

  return (
    <form
      action={dispatch}
      aria-label="본인 확인 검토"
      className="operator-form"
      noValidate
      onReset={(event) => event.preventDefault()}
    >
      <input name="caseId" type="hidden" value={caseId} />
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
      <ConfirmCheckbox
        label="문서 원문·비밀번호·식별 번호는 이 화면에 표시되지 않습니다."
        name="confirmation"
        value="REVIEW_KYC"
      />
      <StepUpTokenField commandFamily={ADMIN_COMMAND_FAMILIES.KYC_REVIEW} />
      <SubmitButton pendingLabel="저장 중…">검토 결과 저장</SubmitButton>
      <QueueFlash result={result} />
    </form>
  );
}
