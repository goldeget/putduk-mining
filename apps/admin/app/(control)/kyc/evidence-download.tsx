"use client";
import { FeedbackMessage } from "../../../../../components/ui/feedback-message";

import { useEffect, useRef, useState } from "react";
import { useKycAcknowledgedEvidence } from "./acknowledged-evidence";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";

export function KycEvidenceDownload({
  submissionIds,
}: {
  submissionIds: string[];
}) {
  const sharedEvidence = useKycAcknowledgedEvidence();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [received, setReceived] = useState<{
    receiptId: string;
    submissionId: string;
    hash: string;
    expiresAt: string;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const token = useRef("");
  const ackToken = useRef("");
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  async function download(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(event.currentTarget);
    const submissionId = String(form.get("submissionId") ?? "");
    if (
      !submissionIds.includes(submissionId) ||
      token.current.trim().length < 16
    ) {
      setMessage("서류와 작업 확인을 다시 선택해 주세요.");
      return;
    }
    form.set("stepUpToken", token.current);
    form.delete("submissionId");
    inFlight.current = true;
    setPending(true);
    setMessage("");
    setReceived(null);
    setAcknowledged(false);
    sharedEvidence?.setEvidence(null);
    const abort = new AbortController();
    controller.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 15_000);
    let cancel!: () => void;
    const stopped = new Promise<never>((_, reject) => {
      cancel = () => reject(new DOMException("Unconfirmed", "AbortError"));
    });
    abort.signal.addEventListener("abort", cancel, { once: true });
    try {
      const receivedFile = await Promise.race([
        fetch(`/api/kyc/evidence/${submissionId}`, {
          method: "POST",
          body: form,
          signal: abort.signal,
          cache: "no-store",
        }).then(async (response) => {
          if (
            !response.ok ||
            !["application/pdf", "image/png", "image/jpeg"].includes(
              response.headers.get("content-type") ?? "",
            )
          )
            throw new Error("EVIDENCE_UNCONFIRMED");
          const result = await response.blob();
          if (!result.size || result.size > 5 * 1024 * 1024)
            throw new Error("EVIDENCE_UNCONFIRMED");
          const receiptId = response.headers.get("Kyc-Delivery-Receipt") ?? "";
          const expectedHash =
            response.headers.get("Kyc-Evidence-Sha256") ?? "";
          const expiresAt = response.headers.get("Kyc-Delivery-Expires") ?? "";
          if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              receiptId,
            ) ||
            !/^[0-9a-f]{64}$/.test(expectedHash) ||
            !Number.isFinite(Date.parse(expiresAt))
          )
            throw new Error("EVIDENCE_UNCONFIRMED");
          const digest = await crypto.subtle.digest(
            "SHA-256",
            await result.arrayBuffer(),
          );
          const hash = Array.from(new Uint8Array(digest), (value) =>
            value.toString(16).padStart(2, "0"),
          ).join("");
          if (hash !== expectedHash) throw new Error("EVIDENCE_UNCONFIRMED");
          return {
            blob: result,
            receipt: { receiptId, submissionId, hash, expiresAt },
          };
        }),
        stopped,
      ]);
      if (!alive.current || abort.signal.aborted) return;
      const blob = receivedFile.blob;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `identity-document.${blob.type === "application/pdf" ? "pdf" : blob.type === "image/png" ? "png" : "jpg"}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("서류 파일을 받았어요. 파일을 열어 내용을 확인해 주세요.");
      setReceived(receivedFile.receipt);
    } catch {
      if (alive.current)
        setMessage(
          "서류 파일을 확인하지 못했습니다. 작업 확인 후 다시 시도해 주세요.",
        );
    } finally {
      window.clearTimeout(timer);
      abort.signal.removeEventListener("abort", cancel);
      token.current = "";
      ackToken.current = "";
      inFlight.current = false;
      if (alive.current) {
        setPending(false);
        setRevision((value) => value + 1);
      }
    }
  }
  async function acknowledge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !received || acknowledged) return;
    if (ackToken.current.trim().length < 16) {
      setMessage("내용 확인 기록을 위한 작업 확인을 진행해 주세요.");
      return;
    }
    const form = new FormData(event.currentTarget);
    form.set("receiptId", received.receiptId);
    form.set("contentSha256", received.hash);
    form.set("stepUpToken", ackToken.current);
    inFlight.current = true;
    setPending(true);
    setMessage("");
    const abort = new AbortController();
    controller.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 15_000);
    let cancel!: () => void;
    const stopped = new Promise<never>((_, reject) => {
      cancel = () => reject(new DOMException("Unconfirmed", "AbortError"));
    });
    abort.signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await Promise.race([
        fetch(`/api/kyc/evidence/${received.submissionId}/acknowledge`, {
          method: "POST",
          body: form,
          signal: abort.signal,
          cache: "no-store",
        }).then(async (response) => {
          const payload: unknown = await response.json();
          if (
            !response.ok ||
            !payload ||
            typeof payload !== "object" ||
            !("data" in payload) ||
            !payload.data ||
            typeof payload.data !== "object" ||
            !("state" in payload.data) ||
            payload.data.state !== "ACKNOWLEDGED" ||
            !("receiptId" in payload.data) ||
            payload.data.receiptId !== received.receiptId ||
            !("submissionId" in payload.data) ||
            payload.data.submissionId !== received.submissionId
          )
            throw new Error("KYC_ACK_UNCONFIRMED");
          return payload;
        }),
        stopped,
      ]);
      if (result && alive.current && !abort.signal.aborted) {
        sharedEvidence?.setEvidence({
          submissionId: received.submissionId,
          expiresAt: received.expiresAt,
        });
        setAcknowledged(true);
        setMessage(
          "파일 내용을 직접 확인했다는 기록을 저장했어요. 심사 결정은 별도로 진행해 주세요.",
        );
      }
    } catch {
      if (alive.current)
        setMessage(
          "내용 확인 기록의 저장 결과를 확인하지 못했어요. 같은 기록으로 작업 확인 후 다시 시도해 주세요.",
        );
    } finally {
      window.clearTimeout(timer);
      abort.signal.removeEventListener("abort", cancel);
      ackToken.current = "";
      inFlight.current = false;
      if (alive.current) {
        setPending(false);
        setRevision((value) => value + 1);
      }
    }
  }
  if (!submissionIds.length) return null;
  return (
    <>
      <form
        className="operator-form"
        aria-label="제출 서류 원문 확인"
        onSubmit={(event) => void download(event)}
      >
        <p className="panel-note">
          담당자 확인과 열람 사유를 남긴 뒤 제출 서류를 받을 수 있습니다.
        </p>
        <fieldset
          disabled={pending}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <label className="operator-field">
            <span>확인할 서류</span>
            <select name="submissionId" required>
              {submissionIds.map((id, index) => (
                <option key={id} value={id}>
                  제출 서류 {index + 1}
                </option>
              ))}
            </select>
          </label>
          <label className="operator-field">
            <span>열람 사유</span>
            <textarea
              name="reason"
              required
              minLength={10}
              maxLength={500}
              placeholder="확인하는 이유를 10자 이상 적어 주세요."
            />
          </label>
          <label>
            <input
              type="checkbox"
              name="confirmation"
              value="VIEW_KYC_EVIDENCE"
              required
            />{" "}
            본인 확인을 위해 제출 서류를 확인합니다.
          </label>
          <StepUpTokenField
            key={revision}
            commandFamily={ADMIN_COMMAND_FAMILIES.KYC_REVIEW}
            onTokenIssued={(value) => {
              token.current = value;
            }}
            submissionPending={pending}
          />
          <button type="submit" className="button button--secondary">
            {pending ? "서류 확인 중" : "서류 받기"}
          </button>
        </fieldset>
      </form>
      {received && !acknowledged ? (
        <form
          className="operator-form"
          aria-label="서류 내용 확인 기록"
          onSubmit={(event) => void acknowledge(event)}
        >
          <p className="panel-note">
            파일을 열고 내용을 직접 확인한 뒤 기록해 주세요. 파일 수신만으로
            내용 확인이 기록되지는 않습니다. 수신 증표는 5분 동안 유효합니다.
          </p>
          <fieldset
            disabled={pending}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <label>
              <input
                type="checkbox"
                name="confirmation"
                value="CONFIRM_KYC_CONTENT_REVIEWED"
                required
              />{" "}
              받은 서류 파일을 열어 내용을 직접 확인했습니다.
            </label>
            <StepUpTokenField
              key={`ack-${revision}`}
              commandFamily={ADMIN_COMMAND_FAMILIES.KYC_REVIEW}
              onTokenIssued={(value) => {
                ackToken.current = value;
              }}
              submissionPending={pending}
            />
            <button type="submit" className="button button--secondary">
              {pending ? "확인 기록 저장 중" : "내용 확인 기록"}
            </button>
          </fieldset>
        </form>
      ) : null}
      {message ? (
        <FeedbackMessage role="status">{message}</FeedbackMessage>
      ) : null}
    </>
  );
}
