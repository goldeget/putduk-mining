"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FeedbackMessage } from "@/components/ui/feedback-message";
import { Surface } from "@/components/ui/surface";
export function BirthDigitCompletion({ dateOfBirth }: { dateOfBirth: string }) {
  const router = useRouter();
  const [digit, setDigit] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  return (
    <Surface
      as="section"
      id="birth-digit-completion"
      aria-labelledby="birth-digit-title"
    >
      <p className="eyebrow">가입 정보 보완</p>
      <h2 id="birth-digit-title">뒷자리 첫 숫자를 등록해 주세요</h2>
      <p>
        등록된 생년월일은 {dateOfBirth}입니다. 뒷자리 전체가 아닌 첫 숫자 한
        자리만 입력해 주세요.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || done) return;
          setPending(true);
          setMessage("");
          try {
            const response = await fetch("/api/v1/me/birth-digit", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ digit }),
            });
            const payload = await response.json();
            if (!response.ok || payload.data?.completed !== true)
              throw Error(
                payload.error?.message || "저장 결과를 확인하지 못했습니다.",
              );
            setDone(true);
            setMessage("입력하신 숫자를 저장했습니다.");
            router.refresh();
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "연결을 확인해 주세요.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <label htmlFor="missing-birth-digit">뒷자리 첫 숫자</label>
        <input
          id="missing-birth-digit"
          name="birthSexDigit"
          inputMode="numeric"
          autoComplete="off"
          pattern="[1-8]"
          maxLength={1}
          required
          value={digit}
          disabled={pending || done}
          onChange={(e) =>
            setDigit(e.target.value.replace(/\D/g, "").slice(0, 1))
          }
          style={{
            maxWidth: 120,
            minHeight: 48,
            fontSize: 24,
            margin: "12px 16px 12px 0",
          }}
        />
        <button
          type="submit"
          className="button button--primary"
          disabled={pending || done || !/^[1-8]$/.test(digit)}
        >
          {pending ? "저장 중…" : done ? "등록 완료" : "숫자 등록"}
        </button>
        <p>저장한 숫자는 임의로 변경할 수 없으니 입력값을 확인해 주세요.</p>
        <FeedbackMessage
          role={done ? "status" : "alert"}
          tone={done ? "success" : "danger"}
        >
          {message}
        </FeedbackMessage>
      </form>
    </Surface>
  );
}
