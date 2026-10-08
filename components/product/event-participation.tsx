"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { eventParticipationReceiptSchema } from "@/domain/events/participation";

export function EventParticipation({
  eventId,
  revisionId,
  canJoin,
  joined,
}: {
  eventId: string;
  revisionId: string;
  canJoin: boolean;
  joined: boolean;
}) {
  const router = useRouter();
  const intent = useRef<string | null>(null);
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [done, setDone] = useState(joined);
  const [message, setMessage] = useState("");
  async function join() {
    if (running.current || done || !canJoin) return;
    if (!navigator.onLine) {
      setMessage("인터넷에 연결한 뒤 참여해 주세요.");
      return;
    }
    running.current = true;
    setPending(true);
    setMessage("참여 결과를 확인하고 있어요.");
    intent.current ??= crypto.randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/v1/events/participation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          revisionId,
          idempotencyKey: intent.current,
        }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (response.status === 401) {
        setMessage("다시 로그인한 뒤 참여해 주세요.");
        setUncertain(false);
        return;
      }
      if (response.status === 409) {
        setMessage(
          "참여 조건이나 기간이 바뀌었어요. 화면을 새로 열어 확인해 주세요.",
        );
        setUncertain(false);
        return;
      }
      const parsed = eventParticipationReceiptSchema.safeParse(body?.data);
      if (
        !response.ok ||
        !parsed.success ||
        parsed.data.eventId !== eventId ||
        parsed.data.revisionId !== revisionId
      )
        throw Error("UNCONFIRMED");
      setDone(true);
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
      <button
        className="button button--primary"
        disabled={pending || done || !canJoin}
        onClick={() => void join()}
      >
        {pending
          ? "확인 중…"
          : done
            ? "참여 중"
            : !canJoin
              ? "참여 기간이 아니에요"
              : uncertain
                ? "참여 결과 다시 확인"
                : "이벤트 참여"}
      </button>
      {message ? (
        <p role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
