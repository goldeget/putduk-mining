"use client";
import { FeedbackMessage } from "@/components/ui/feedback-message";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cashEventParticipationReceiptSchema,
  eventParticipationReceiptSchema,
  type eventParticipationInputSchema,
} from "@/domain/events/participation";
import type { MemberCashEventTerms } from "@/domain/events/cash-terms";
import type { z } from "zod";

export function EventParticipation({
  eventId,
  revisionId,
  canJoin,
  joined,
  cashTerms,
}: {
  eventId: string;
  revisionId: string;
  canJoin: boolean;
  joined: boolean;
  cashTerms?: MemberCashEventTerms | undefined;
}) {
  const router = useRouter();
  const intent = useRef<{
    input: z.infer<typeof eventParticipationInputSchema>;
    terms: MemberCashEventTerms | undefined;
  } | null>(null);
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [done, setDone] = useState(joined);
  const [message, setMessage] = useState("");
  const [acceptedDigest, setAcceptedDigest] = useState<string | null>(null);
  const [confirmedDigest, setConfirmedDigest] = useState<string | null>(null);
  const [cashDenied, setCashDenied] = useState(false);
  const [submittedTerms, setSubmittedTerms] = useState<MemberCashEventTerms>();
  const displayedTerms = uncertain ? submittedTerms : cashTerms;
  const hasJoined = cashTerms
    ? confirmedDigest === cashTerms.cash_terms_digest
    : done || joined;
  // The server can replay an existing join after its participation window ends.
  // Recovery retains the original intent; only a new join requires canJoin.
  const canSubmit =
    !cashDenied &&
    (uncertain ||
      (canJoin &&
        (!cashTerms || acceptedDigest === cashTerms.cash_terms_digest)));
  async function join() {
    if (running.current || hasJoined || !canSubmit) return;
    if (!navigator.onLine) {
      setMessage("인터넷에 연결한 뒤 참여해 주세요.");
      return;
    }
    running.current = true;
    setPending(true);
    setMessage("참여 결과를 확인하고 있어요.");
    intent.current ??= {
      input: {
        eventId,
        revisionId,
        idempotencyKey: crypto.randomUUID(),
        ...(cashTerms ? { cashTermsDigest: cashTerms.cash_terms_digest } : {}),
      },
      terms: cashTerms,
    };
    const submitted = intent.current;
    setSubmittedTerms(submitted.terms);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/v1/events/participation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitted.input),
        signal: controller.signal,
      });
      const body = await response.json();
      if (response.status === 401) {
        setMessage("다시 로그인한 뒤 참여해 주세요.");
        setUncertain(false);
        if (submitted.terms) {
          intent.current = null;
          setAcceptedDigest(null);
        }
        return;
      }
      if (response.status === 409) {
        setMessage(
          "참여 조건이나 기간이 바뀌었어요. 화면을 새로 열어 확인해 주세요.",
        );
        setUncertain(false);
        if (submitted.terms) setCashDenied(true);
        return;
      }
      const parsed = (
        submitted.terms
          ? cashEventParticipationReceiptSchema
          : eventParticipationReceiptSchema
      ).safeParse(body?.data);
      if (
        !response.ok ||
        !parsed.success ||
        parsed.data.eventId !== submitted.input.eventId ||
        parsed.data.revisionId !== submitted.input.revisionId ||
        (submitted.terms &&
          (!("cashTermsDigest" in parsed.data) ||
            !("cashTermsVersion" in parsed.data) ||
            parsed.data.cashTermsDigest !== submitted.terms.cash_terms_digest ||
            parsed.data.cashTermsVersion !== submitted.terms.terms_version))
      )
        throw Error("UNCONFIRMED");
      setDone(true);
      // A confirmed result ends this intent. A later published policy needs
      // fresh acknowledgement and a new key; uncertain retries retain both.
      intent.current = null;
      if (submitted.terms)
        setConfirmedDigest(submitted.terms.cash_terms_digest);
      setUncertain(false);
      setMessage(
        "참여가 기록됐어요. 조건을 달성하면 이곳에서 결과를 확인할 수 있어요.",
      );
      router.refresh();
    } catch {
      setUncertain(true);
      setMessage(
        "참여 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.",
      );
    } finally {
      clearTimeout(timeout);
      running.current = false;
      setPending(false);
    }
  }
  return (
    <div>
      {displayedTerms ? (
        <section aria-label="현금 보상 참여 약관">
          <h3>현금 보상 참여 약관</h3>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {displayedTerms.terms_ko}
          </p>
          <p>
            조건 달성 시 보상{" "}
            {BigInt(displayedTerms.reward_krw).toLocaleString("ko-KR")}원
          </p>
          {!hasJoined ? (
            <label>
              <input
                type="checkbox"
                checked={acceptedDigest === displayedTerms.cash_terms_digest}
                disabled={pending || uncertain || cashDenied}
                onChange={(event) =>
                  setAcceptedDigest(
                    event.target.checked
                      ? displayedTerms.cash_terms_digest
                      : null,
                  )
                }
              />
              위 참여 약관과 보상 조건을 확인하고 동의합니다.
            </label>
          ) : null}
        </section>
      ) : null}
      <button
        className="button button--primary"
        disabled={pending || hasJoined || !canSubmit}
        onClick={() => void join()}
      >
        {pending
          ? "확인 중…"
          : hasJoined
            ? "참여 중"
            : uncertain
              ? "참여 결과 다시 확인"
              : !canJoin
                ? "참여 기간이 아니에요"
                : "이벤트 참여"}
      </button>
      {message ? (
        <FeedbackMessage role="status" aria-live="polite">
          {message}
        </FeedbackMessage>
      ) : null}
    </div>
  );
}
