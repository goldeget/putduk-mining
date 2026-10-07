"use client";

import { useState, type ReactNode } from "react";
import styles from "./ai-partner-hero.module.css";

export function AiPartnerMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 56"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 10 21 1l16 8-18 9L3 10Z" fill="#ffe6a0" />
      <path d="M3 10v36l16 9V18L3 10Z" fill="#b98b3c" />
      <path d="m19 18 18-9v37l-18 9V18Z" fill="#f0c66c" />
      <path d="m10 14 7 4v32l-7-4V14Z" fill="#fbe7a9" />
      <path d="m24 20 7-4v26l-7 4V20Z" fill="#31240f" />
      <path d="m3 10 18-9 16 8v37l-18 9-16-9V10Z" stroke="#f8d88c" />
    </svg>
  );
}

/** The scene is decorative. It never claims provider availability or account facts. */
export function AiPartnerHero({ tools }: { tools?: ReactNode }) {
  const [mode, setMode] = useState<"responsive" | "webp" | "unavailable">(
    "responsive",
  );
  const [attempt, setAttempt] = useState(0);
  const url = (width: number, format: "avif" | "webp") =>
    `/brand/scenes/ai-partner-hero/ai-partner-hero-${width}-v1.${format}${attempt ? `?ai-art-retry=${attempt}` : ""}`;
  const widths = [480, 640, 960, 1280, 1536, 1920];
  const srcSet = (format: "avif" | "webp") =>
    widths.map((width) => `${url(width, format)} ${width}w`).join(", ");
  function failed() {
    setMode((current) => (current === "responsive" ? "webp" : "unavailable"));
  }
  return (
    <header
      className={styles.hero}
      data-ai-partner-hero
      data-ai-art-state={mode}
    >
      <div className={styles.scene} aria-hidden="true">
        {mode !== "unavailable" ? (
          <picture key={`${mode}-${attempt}`}>
            {mode === "responsive"
              ? (["avif", "webp"] as const).map((format) => (
                  <source
                    key={format}
                    type={`image/${format}`}
                    srcSet={srcSet(format)}
                    sizes="(min-width: 1280px) calc(100vw - 35rem), (min-width: 980px) calc(100vw - 16rem), 100vw"
                  />
                ))
              : null}
            <img
              src={url(1280, "webp")}
              width="1983"
              height="793"
              alt=""
              aria-hidden="true"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              onError={failed}
            />
          </picture>
        ) : null}
      </div>
      <div className={styles.copy}>
        <div className={styles.identity}>
          <AiPartnerMark />
          <h1 aria-label="퍼뜩 AI">PUTDUK AI</h1>
        </div>
        <p className={styles.lead}>
          당신의 기록을 함께 살펴보는
          <br />
          퍼뜩 AI 파트너
        </p>
        <p className={styles.description}>
          채굴부터 출금 준비까지,
          <br />
          궁금한 내용을 편하게 물어보세요.
        </p>
        <p className={styles.promise}>
          확인된 기록으로 답하고,
          <br />
          확인할 수 없는 내용은 추측하지 않아요.
        </p>
      </div>
      {tools ? <div className={styles.tools}>{tools}</div> : null}
      {mode === "unavailable" ? (
        <div className={styles.recovery} role="status">
          <p>AI 배경을 불러오지 못했어요. 대화는 계속 이용할 수 있어요.</p>
          <button
            type="button"
            onClick={() => {
              setAttempt((value) => value + 1);
              setMode("responsive");
            }}
          >
            배경 다시 불러오기
          </button>
        </div>
      ) : null}
    </header>
  );
}
