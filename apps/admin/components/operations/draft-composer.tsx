"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DraftKind } from "@/lib/operations/registry";
import { useOperatorDraftSignals } from "@/components/assistant/operator-draft-provider";
import styles from "./operations.module.css";

const templates: Record<
  DraftKind,
  { title: string; body: string; label: string }
> = {
  notice: {
    label: "공지 초안",
    title: "서비스 이용 안내",
    body: "안내할 내용과 적용 시간을 확인한 뒤 입력해 주세요.\n\n회원에게 필요한 다음 행동을 짧게 안내해 주세요.",
  },
  event: {
    label: "행사 안내 초안",
    title: "행사 참여 안내",
    body: "승인된 행사 이름과 기간을 확인한 뒤 입력해 주세요.\n\n참여 대상과 조건은 실제 행사 정책에서 확인해 주세요.",
  },
  reply: {
    label: "지원 답변 초안",
    title: "문의 답변",
    body: "문의해 주셔서 감사합니다.\n\n확인한 사실과 아직 확인 중인 내용을 구분해 안내해 주세요.\n다음에 확인할 방법을 짧게 알려 주세요.",
  },
};

export function DraftComposer({ kind }: { kind: DraftKind }) {
  const fieldId = useId();
  const template = templates[kind];
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const revision = useRef(0);
  const expiresAt = useRef<number | null>(null);
  const signals = useOperatorDraftSignals();
  const sessionBlocked = signals?.clearedReason === "SESSION";
  const complete = title.trim().length > 0 && body.trim().length > 0;
  useEffect(() => {
    const clear = () => {
      revision.current += 1;
      expiresAt.current = null;
      setTitle("");
      setBody("");
      setPreview(false);
      setMessage("연결이 바뀌어 초안을 지웠어요. 다시 확인해 주세요.");
    };
    window.addEventListener("offline", clear);
    window.addEventListener("pagehide", clear);
    return () => {
      revision.current += 1;
      window.removeEventListener("offline", clear);
      window.removeEventListener("pagehide", clear);
    };
  }, []);
  useEffect(() => {
    if (!title && !body) {
      expiresAt.current = null;
      return;
    }
    expiresAt.current ??= Date.now() + 5 * 60_000;
    const timer = window.setTimeout(
      () => {
        revision.current += 1;
        expiresAt.current = null;
        setTitle("");
        setBody("");
        setPreview(false);
        setMessage(
          "작성 후 5분이 지나 초안을 지웠어요. 최신 내용을 다시 확인해 주세요.",
        );
      },
      Math.max(0, expiresAt.current - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [title, body]);
  useEffect(() => {
    if (!signals?.epoch && !signals?.clearedReason) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      revision.current += 1;
      expiresAt.current = null;
      setTitle("");
      setBody("");
      setPreview(false);
      setMessage(
        signals?.clearedReason === "SESSION"
          ? "운영자 인증이 바뀌어 초안을 지웠어요. 다시 로그인해 주세요."
          : "운영 초안이 초기화되었어요. 최신 내용을 다시 확인해 주세요.",
      );
    });
    return () => {
      active = false;
    };
  }, [signals?.epoch, signals?.clearedReason]);
  const edit = () => {
    revision.current += 1;
    setPreview(false);
    setMessage(null);
  };
  async function copy() {
    if (!complete || !preview || sessionBlocked) return;
    const reviewedRevision = revision.current;
    try {
      await navigator.clipboard.writeText(`${title.trim()}\n\n${body.trim()}`);
      if (reviewedRevision !== revision.current) return;
      setMessage("초안을 복사했어요. 보내거나 게시한 것은 아니에요.");
    } catch {
      if (reviewedRevision !== revision.current) return;
      setMessage(
        "복사하지 못했어요. 미리보기의 글을 직접 선택해 복사해 주세요.",
      );
    }
  }
  return (
    <section
      className={styles.panel}
      aria-labelledby="operator-draft-title"
      data-testid="operator-writing-draft"
    >
      <p className="eyebrow">글 준비</p>
      <h2 id="operator-draft-title">{template.label}</h2>
      <p className={styles.note}>
        이 화면에서만 작성하는 초안이에요. 5분 후 지워져요. 회원에게 전송하거나
        게시하지 않아요.
      </p>
      <button
        className="ghost-button"
        type="button"
        disabled={sessionBlocked}
        onClick={() => {
          setTitle(template.title);
          setBody(template.body);
          edit();
        }}
      >
        안내 틀 불러오기
      </button>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (complete && !sessionBlocked) setPreview(true);
        }}
      >
        <div className={styles.field}>
          <label htmlFor={`${fieldId}-title`}>제목</label>
          <input
            id={`${fieldId}-title`}
            disabled={sessionBlocked}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              edit();
            }}
            required
            maxLength={100}
            autoComplete="off"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${fieldId}-body`}>내용</label>
          <textarea
            id={`${fieldId}-body`}
            disabled={sessionBlocked}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              edit();
            }}
            required
            maxLength={2000}
            rows={7}
          />
        </div>
        <p className={styles.note}>
          금액·개인정보·처리 완료 여부는 실제 기록을 확인한 뒤 직접 검토해
          주세요.
        </p>
        <div className={styles.links}>
          <button
            className="gold-button"
            type="submit"
            disabled={!complete || sessionBlocked}
          >
            초안 미리보기
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setTitle("");
              setBody("");
              edit();
            }}
          >
            초안 지우기
          </button>
        </div>
      </form>
      {preview ? (
        <article
          className={styles.preview}
          aria-label="보내기 전 초안 미리보기"
        >
          <span>아직 보내지 않은 글</span>
          <h3>{title.trim()}</h3>
          <p>{body.trim()}</p>
          <strong>
            글만 복사해요. 금전 승인이나 회원 알림은 실행되지 않아요.
          </strong>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void copy()}
          >
            검토한 초안 복사
          </button>
        </article>
      ) : null}
      {message ? (
        <p role="status" className={styles.note}>
          {message}
        </p>
      ) : null}
    </section>
  );
}
