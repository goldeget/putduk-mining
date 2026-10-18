"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
type AcknowledgedEvidence = { submissionId: string; expiresAt: string };
type EvidenceContext = {
  caseId: string;
  evidence: AcknowledgedEvidence | null;
  setEvidence: (value: AcknowledgedEvidence | null) => void;
};
const Context = createContext<EvidenceContext | null>(null);
/** Ephemeral UI hint only: the review SQL independently verifies durable ACK. */
export function KycAcknowledgedEvidence({
  caseId,
  children,
}: {
  caseId: string;
  children: ReactNode;
}) {
  const [evidence, setEvidence] = useState<AcknowledgedEvidence | null>(null);
  return (
    <Context.Provider value={{ caseId, evidence, setEvidence }}>
      {children}
    </Context.Provider>
  );
}
export function useKycAcknowledgedEvidence() {
  return useContext(Context);
}
export function acknowledgedSubmissionForCase(
  state: Pick<EvidenceContext, "caseId" | "evidence"> | null,
  caseId: string,
  now = Date.now(),
) {
  if (
    !state ||
    state.caseId !== caseId ||
    !state.evidence ||
    Date.parse(state.evidence.expiresAt) <= now ||
    !Number.isFinite(Date.parse(state.evidence.expiresAt))
  )
    return undefined;
  return state.evidence.submissionId;
}
