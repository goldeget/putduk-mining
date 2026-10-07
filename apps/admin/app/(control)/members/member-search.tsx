"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";

import {
  memberSearchResponseSchema,
  type MemberSearchResult,
} from "@/lib/members/search";
import styles from "./members.module.css";

export function MemberSearch({
  initialQuery = "",
  initialError = "",
}: {
  initialQuery?: string;
  initialError?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<MemberSearchResult | null>(null);
  const [message, setMessage] = useState(initialError);
  const [pending, setPending] = useState(false);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    function offline() {
      generation.current += 1;
      active.current?.abort();
      setPending(false);
      setResult(null);
      setMessage("연결이 끊겼습니다. 다시 연결한 뒤 검색해 주세요.");
    }
    window.addEventListener("offline", offline);
    return () => {
      generation.current += 1;
      active.current?.abort();
      window.removeEventListener("offline", offline);
    };
  }, []);

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    active.current?.abort();
    const version = ++generation.current;
    setResult(null);
    setMessage("");
    if (!navigator.onLine) {
      setMessage("연결이 끊겼습니다. 다시 연결한 뒤 검색해 주세요.");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    try {
      const response = await fetch("/api/v1/admin/members/search", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (version !== generation.current) return;
      const parsed = memberSearchResponseSchema.safeParse(payload.data);
      if (!response.ok || !parsed.success) {
        setMessage(
          payload.error?.message ??
            "회원 검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.",
        );
        return;
      }
      setResult(parsed.data);
    } catch {
      if (version === generation.current && !controller.signal.aborted)
        setMessage("회원 검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (version === generation.current) setPending(false);
    }
  }

  return (
    <section aria-label="회원 찾기">
      <form
        className="member-search"
        onSubmit={(event) => void search(event)}
        aria-busy={pending}
      >
        <label htmlFor="member-query">이름·아이디·전화번호</label>
        <div>
          <input
            id="member-query"
            name="query"
            value={query}
            minLength={2}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            required
            placeholder="이름, 아이디 또는 전화번호"
            aria-describedby="member-search-help"
            onChange={(event) => {
              generation.current += 1;
              active.current?.abort();
              setPending(false);
              setQuery(event.target.value);
              setResult(null);
              setMessage("");
            }}
          />
          <button className="gold-button" disabled={pending} type="submit">
            {pending ? "찾는 중…" : "안전 조회"}
          </button>
        </div>
        <p className="panel-note" id="member-search-help">
          이름과 아이디는 일부만 적어도 됩니다. 전화번호나 회원 식별자로도 찾을
          수 있어요.
        </p>
        {message ? (
          <p className="form-error" role="alert">
            {message}
          </p>
        ) : null}
        {pending ? (
          <p className="panel-note" role="status">
            회원을 찾는 중입니다.
          </p>
        ) : null}
      </form>
      {result ? (
        <div aria-live="polite">
          <p className="panel-note" role="status">
            {result.members.length
              ? `${result.members.length}명의 회원을 찾았습니다.`
              : "검색 결과가 없습니다. 입력 내용을 다시 확인해 주세요."}
          </p>
          {result.hasMore ? (
            <p className="panel-note">
              결과가 많아 20명까지 표시합니다. 이름이나 아이디를 더 자세히 적어
              주세요.
            </p>
          ) : null}
          <ul className={styles.searchResults} aria-label="회원 검색 결과">
            {result.members.map((member) => (
              <li key={member.userId}>
                <Link href={`/members?id=${member.userId}` as Route}>
                  <strong>{member.name}</strong>
                  <dl>
                    <div>
                      <dt>아이디</dt>
                      <dd>{member.loginId ?? "확인 불가"}</dd>
                    </div>
                    <div>
                      <dt>전화번호</dt>
                      <dd>{member.phone ?? "확인 불가"}</dd>
                    </div>
                    <div>
                      <dt>회원 식별자</dt>
                      <dd>
                        <code>{member.userId.slice(0, 8)}</code>
                      </dd>
                    </div>
                  </dl>
                  <span className={`text-link ${styles.resultAction}`}>
                    회원 정보{" "}
                    <span className={styles.resultActionTail}>
                      보기 <span aria-hidden="true">→</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
