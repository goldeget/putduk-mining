"use client";

import { useEffect, useRef, useState } from "react";
import {
  adminAiSearchResultSchema,
  adminAiListResultSchema,
  adminAiMessagesResultSchema,
  formatAdminAiUsd,
  type AdminAiReadInput,
  type AdminAiSearchResult,
  type AdminAiListResult,
  type AdminAiMessagesResult,
} from "../../../../../domain/ai/admin-conversation";
import styles from "./conversation.module.css";

type Message = AdminAiMessagesResult["messages"][number];
const statusLabels: Record<string, string> = {
  RECEIVED: "접수",
  RUNNING: "답변 중",
  SUCCEEDED: "완료",
  FAILED: "실패",
  CANCELLED: "취소",
};
function time(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Preserve consecutive chunks from long original messages without adding invented text. */
export function groupTranscriptChunks(messages: readonly Message[]) {
  const groups: {
    key: string;
    role: Message["authorRole"];
    text: string;
    createdAt: string;
  }[] = [];
  for (const message of messages) {
    const key = message.clientMessageId
      ? `${message.authorRole}:${message.clientMessageId}`
      : message.id;
    const previous = groups.at(-1);
    if (previous?.key === key) previous.text += message.bodyText;
    else
      groups.push({
        key,
        role: message.authorRole,
        text: message.bodyText,
        createdAt: message.createdAt,
      });
  }
  return groups;
}

export function AiConversationConsole() {
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<AdminAiSearchResult | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [list, setList] = useState<AdminAiListResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<AdminAiMessagesResult | null>(
    null,
  );
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);

  async function read(input: AdminAiReadInput): Promise<unknown | null> {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setBusy(true);
    setError("");
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/ai/conversations", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const body = await response.json();
      if (response.status === 401 || response.status === 403) {
        setMembers(null);
        setList(null);
        setUserId(null);
        setSelected(null);
      }
      if (!response.ok) throw new Error("READ_FAILED");
      if (current.current !== controller || controller.signal.aborted)
        return null;
      return body.data as unknown;
    } catch {
      if (current.current === controller) {
        setTranscript(null);
        setError(
          "대화 기록을 불러오지 못했습니다. 연결과 접속 권한을 확인한 뒤 다시 조회해 주세요.",
        );
      }
      return null;
    } finally {
      clearTimeout(timeout);
      if (current.current === controller) setBusy(false);
    }
  }
  async function search() {
    setMembers(null);
    setList(null);
    setTranscript(null);
    setSelected(null);
    setUserId(null);
    const result = adminAiSearchResultSchema.safeParse(
      await read({ operation: "SEARCH", query }),
    );
    if (result.success) setMembers(result.data);
  }
  async function loadList(id: string, more = false) {
    setUserId(id);
    setTranscript(null);
    setSelected(null);
    const input: AdminAiReadInput = {
      operation: "LIST",
      userId: id,
      limit: 25,
      ...(status
        ? {
            status: status as
              "RECEIVED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED",
          }
        : {}),
      ...(from
        ? { from: new Date(`${from}T00:00:00+09:00`).toISOString() }
        : {}),
      ...(to
        ? {
            to: new Date(
              new Date(`${to}T00:00:00+09:00`).getTime() + 86400000,
            ).toISOString(),
          }
        : {}),
      ...(more && list?.nextCursor ? { cursor: list.nextCursor } : {}),
    };
    if (!more) setList(null);
    const result = adminAiListResultSchema.safeParse(await read(input));
    if (result.success)
      setList((previous) => ({
        ...result.data,
        conversations: more
          ? [...(previous?.conversations ?? []), ...result.data.conversations]
          : result.data.conversations,
      }));
  }
  async function loadMessages(conversationId: string, more = false) {
    if (!userId) return;
    setSelected(conversationId);
    if (!more) setTranscript(null);
    const result = adminAiMessagesResultSchema.safeParse(
      await read({
        operation: "MESSAGES",
        userId,
        conversationId,
        afterPosition: more ? (transcript?.nextPosition ?? 0) : 0,
        limit: 100,
      }),
    );
    if (result.success)
      setTranscript((previous) => ({
        ...result.data,
        messages: more
          ? [...(previous?.messages ?? []), ...result.data.messages]
          : result.data.messages,
        requests: more
          ? [
              ...new Map(
                [...(previous?.requests ?? []), ...result.data.requests].map(
                  (r) => [r.requestId, r],
                ),
              ).values(),
            ]
          : result.data.requests,
      }));
  }
  return (
    <section
      className={styles.console}
      data-ui-ready="/ai-conversations"
      data-ui-state={busy ? "loading" : error ? "error" : "loaded"}
    >
      <header>
        <p className={styles.eyebrow}>회원 상담 관리</p>
        <h1>퍼뜩 AI 대화 기록</h1>
        <p>
          회원이 문의한 내용과 실제 답변을 확인합니다. 열람은 기록되며, 문의
          처리 목적에 한해 사용해 주세요.
        </p>
      </header>
      <form
        className={styles.search}
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label>
          이름·아이디·전화번호
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            minLength={2}
            maxLength={80}
            required
            autoComplete="off"
          />
        </label>
        <button type="submit" disabled={busy}>
          회원 찾기
        </button>
      </form>
      {error && (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      )}
      {busy && <p role="status">기록을 불러오는 중입니다.</p>}
      {members && (
        <section aria-label="회원 검색 결과" className={styles.members}>
          {members.members.length === 0 && (
            <p>조회한 회원이 없습니다. 검색어를 확인해 주세요.</p>
          )}
          {members.members.map((member) => (
            <button
              key={member.userId}
              type="button"
              disabled={busy}
              aria-pressed={userId === member.userId}
              onClick={() => void loadList(member.userId)}
            >
              <strong>{member.name}</strong>
              <span>
                {member.loginId} · {member.phone}
              </span>
            </button>
          ))}
          {members.hasMore && (
            <p>결과가 많습니다. 이름이나 아이디를 더 정확히 입력해 주세요.</p>
          )}
        </section>
      )}
      {userId && (
        <form
          className={styles.filters}
          onSubmit={(event) => {
            event.preventDefault();
            void loadList(userId);
          }}
        >
          <label>
            시작일
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            종료일
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label>
            답변 상태
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">전체</option>
              {Object.entries(statusLabels).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            대화 조회
          </button>
        </form>
      )}
      <div className={styles.workspace}>
        <section aria-label="대화 목록" className={styles.list}>
          {list?.conversations.length === 0 && (
            <p>이 조건에 해당하는 대화가 없습니다.</p>
          )}
          {list?.conversations.map((row) => (
            <button
              type="button"
              key={row.id}
              aria-pressed={selected === row.id}
              disabled={busy}
              onClick={() => void loadMessages(row.id)}
            >
              <strong>{row.title || "제목 없는 대화"}</strong>
              <time dateTime={row.updatedAt}>{time(row.updatedAt)}</time>
              <small>{row.id}</small>
            </button>
          ))}
          {list?.nextCursor && userId && (
            <button disabled={busy} onClick={() => void loadList(userId, true)}>
              이전 대화 더 보기
            </button>
          )}
        </section>
        <section
          aria-label="질문과 답변 전체 기록"
          className={styles.transcript}
        >
          {!selected && (
            <p>회원과 대화를 선택하면 질문과 답변을 확인할 수 있습니다.</p>
          )}
          {transcript && (
            <>
              <p className={styles.record}>
                대화 식별자 {transcript.conversationId}
              </p>
              {groupTranscriptChunks(transcript.messages).map((row, i) => (
                <article
                  key={`${row.key}:${i}`}
                  className={
                    row.role === "MEMBER" ? styles.member : styles.assistant
                  }
                >
                  <header>
                    <strong>
                      {row.role === "MEMBER" ? "회원 질문" : "퍼뜩 AI 답변"}
                    </strong>
                    <time dateTime={row.createdAt}>{time(row.createdAt)}</time>
                  </header>
                  <p>{row.text}</p>
                </article>
              ))}
              {transcript.nextPosition ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    void loadMessages(transcript.conversationId, true)
                  }
                >
                  다음 질문·답변 더 보기
                </button>
              ) : (
                <p role="status">현재 대화의 마지막 기록입니다.</p>
              )}
              <h2>답변 처리 기록</h2>
              {transcript.requests.length === 0 && (
                <p>연결된 처리 기록이 없습니다.</p>
              )}
              {transcript.requests.map((request) => (
                <details key={request.requestId}>
                  <summary>
                    {statusLabels[request.status]} ·{" "}
                    {request.provider ?? "제공처 확인 중"} ·{" "}
                    {request.model ?? "모델 확인 중"}
                  </summary>
                  <dl>
                    <dt>요청 식별자</dt>
                    <dd>{request.requestId}</dd>
                    <dt>실제 제공처</dt>
                    <dd>{request.upstreamProvider ?? "확인할 수 없음"}</dd>
                    <dt>입력·출력 사용량</dt>
                    <dd>
                      {request.inputTokens ?? "미확인"} ·{" "}
                      {request.outputTokens ?? "미확인"}
                    </dd>
                    <dt>유료 비용</dt>
                    <dd>{formatAdminAiUsd(request.providerCostNanoUsd)}</dd>
                    <dt>처리 상태</dt>
                    <dd>{statusLabels[request.status]}</dd>
                    {request.errorCode && (
                      <>
                        <dt>오류 식별자</dt>
                        <dd>{request.errorCode}</dd>
                      </>
                    )}
                  </dl>
                  {request.attempts.length > 0 && (
                    <section aria-label="제공처별 처리 시도">
                      {request.attempts.map((attempt, index) => (
                        <article key={attempt.id}>
                          <h3>
                            {index + 1}번째 처리 · {attempt.provider}
                          </h3>
                          <dl>
                            <dt>실제 모델</dt>
                            <dd>{attempt.modelKey}</dd>
                            <dt>실제 제공처</dt>
                            <dd>
                              {attempt.upstreamProvider ?? "확인할 수 없음"}
                            </dd>
                            <dt>상태</dt>
                            <dd>
                              {statusLabels[attempt.status] ?? "처리 확인 중"}
                            </dd>
                            <dt>유료 사용</dt>
                            <dd>{attempt.paid ? "유료" : "무료"}</dd>
                            <dt>실제 비용</dt>
                            <dd>
                              {formatAdminAiUsd(attempt.providerCostNanoUsd)}
                            </dd>
                            <dt>확인 대기 비용</dt>
                            <dd>
                              {formatAdminAiUsd(
                                (
                                  BigInt(attempt.reservedCostMicroUsd) * 1000n
                                ).toString(),
                              )}
                            </dd>
                            <dt>입력·출력 사용량</dt>
                            <dd>
                              {attempt.inputTokens ?? "미확인"} ·{" "}
                              {attempt.outputTokens ?? "미확인"}
                            </dd>
                          </dl>
                        </article>
                      ))}
                    </section>
                  )}
                </details>
              ))}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
