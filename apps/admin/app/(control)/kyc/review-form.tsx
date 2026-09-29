"use client";

import { useActionState, useRef, useState } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import {
  ConfirmCheckbox,
  ReasonField,
  SubmitButton,
} from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";

import { reviewKycCaseFromFields } from "./actions";

const DECISIONS = [
  { value: "IN_REVIEW", label: "검토 중으로 유지" },
  { value: "APPROVED", label: "승인" },
  { value: "ON_HOLD", label: "보류" },
  { value: "REQUIRES_RESUBMISSION", label: "재제출 요청" },
  { value: "REJECTED", label: "반려" },
] as const;

/**
 * ConfirmCheckbox 로 confirmation DOM 을 고정한다.
 * step-up 토큰은 부모 ref 와 FormData 를 함께 읽어 재시도 후에도 유지한다.
 */
export function KycReviewForm({ caseId }: { caseId: string }) {
  const stepUpTokenRef = useRef("");
  const [decision, setDecision] = useState<string>("IN_REVIEW");
  const [result, dispatch] = useActionState<
    CommandActionResult | null,
    FormData
  >(async (_prev, formData) => {
    const fromRef = stepUpTokenRef.current.trim();
    const fromDom = String(formData.get("stepUpToken") ?? "").trim();
    return reviewKycCaseFromFields({
      caseId,
      decision: String(formData.get("decision") ?? decision),
      reason: String(formData.get("reason") ?? ""),
      confirmation: String(formData.get("confirmation") ?? ""),
      stepUpToken: fromRef.length >= 16 ? fromRef : fromDom,
    });
  }, null);

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
      <StepUpTokenField
        commandFamily={ADMIN_COMMAND_FAMILIES.KYC_REVIEW}
        onTokenIssued={(token) => {
          stepUpTokenRef.current = token;
        }}
      />
      <SubmitButton pendingLabel="저장 중…">검토 결과 저장</SubmitButton>
      <QueueFlash result={result} />
    </form>
  );
}
