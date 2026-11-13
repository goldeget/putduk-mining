"use client";
import { useState } from "react";
import { z } from "zod";
import { appEndpoint, appRequest } from "./client";
import styles from "./workroom-app.module.css";
const signed = z.object({ url: z.url() });
export function SupportPhoto({ id, admin }: { id: string; admin: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    setPending(true);
    setError("");
    try {
      const result = await appRequest(
        `${appEndpoint(admin)}/attachments?id=${id}`,
        signed,
      );
      setUrl(result.url);
    } catch {
      setError("사진을 열지 못했어요. 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={styles.photo}>
      <button type="button" disabled={pending} onClick={() => void open()}>
        {pending
          ? "사진 확인 중…"
          : url
            ? "사진 링크 새로 받기"
            : "첨부 사진 보기"}
      </button>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          사진 열기 (2분간 유효) ↗
        </a>
      ) : null}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
