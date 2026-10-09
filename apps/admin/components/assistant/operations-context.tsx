"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";

import { formatKst } from "@/app/(control)/_lib/format";
import {
  ASSISTANT_CONTEXT_TOPICS,
  ASSISTANT_EVIDENCE_LABELS,
  assistantContextReport,
  memberContextTopic,
  type AssistantContextInput,
  type AssistantContextPoint,
  type AssistantContextReport,
  type AssistantContextTopic,
} from "@/lib/assistant/context";
import {
  memberSearchResponseSchema,
  type MemberSearchResult,
} from "@/lib/members/search";
import { useOperatorDraft } from "./operator-draft-provider";
import styles from "./assistant.module.css";

const RECORD_LIFETIME_MS = 300_000;
type MemberChoice = MemberSearchResult["members"][number];

function groupedEvidence(points: AssistantContextPoint[]) {
  const groups = new Map<
    string,
    { source: AssistantContextPoint["source"]; points: AssistantContextPoint[] }
  >();
  for (const point of points) {
    const key = JSON.stringify([point.source.href, point.source.label]);
    const group = groups.get(key);
    if (group) group.points.push(point);
    else groups.set(key, { source: point.source, points: [point] });
  }
  return [...groups.values()];
}

/** Ephemeral, server-grounded explanations; never a command or provider channel. */
export function OperationsContext() {
  const session = useOperatorDraft();
  const [topic, setTopic] = useState<AssistantContextTopic>("dashboard");
  const [query, setQuery] = useState("");
  const [memberRecord, setMember] = useState<{
    value: MemberChoice;
    ticket: number;
  } | null>(null);
  const [searchRecord, setSearch] = useState<{
    value: MemberSearchResult;
    ticket: number;
  } | null>(null);
  const [reportRecord, setReport] = useState<{
    value: AssistantContextReport;
    ticket: number;
    input: AssistantContextInput;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const alive = useRef(false);
  const member =
    memberRecord?.ticket === session.epoch ? memberRecord.value : null;
  const matches =
    searchRecord?.ticket === session.epoch ? searchRecord.value : null;
  const report =
    reportRecord?.ticket === session.epoch ? reportRecord.value : null;

  function clearRead() {
    generation.current += 1;
    active.current?.abort();
    setBusy(false);
    setReport(null);
    setMessage("");
  }
  useEffect(() => {
    alive.current = true;
    function disconnected() {
      generation.current += 1;
      active.current?.abort();
      setBusy(false);
      setReport(null);
      setSearch(null);
      setMember(null);
      setMessage(
        "연결이 끊겨 조회 기록을 지웠습니다. 다시 연결한 뒤 확인해 주세요.",
      );
    }
    window.addEventListener("offline", disconnected);
    window.addEventListener("pagehide", disconnected);
    return () => {
      alive.current = false;
      generation.current += 1;
      active.current?.abort();
      window.removeEventListener("offline", disconnected);
      window.removeEventListener("pagehide", disconnected);
    };
  }, []);
  useEffect(() => {
    if (!report) return;
    const expires = Date.parse(report.observedAt) + RECORD_LIFETIME_MS;
    const timer = window.setTimeout(
      () => {
        setReport(null);
        setMessage("조회 시간이 지나 기록을 지웠습니다. 다시 확인해 주세요.");
      },
      Math.max(0, expires - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [report]);

  async function request(
    mode: "member-search" | "context",
    input: { query: string } | AssistantContextInput,
  ) {
    clearRead();
    if (!navigator.onLine) {
      setMessage("연결이 끊겼습니다. 다시 연결한 뒤 확인해 주세요.");
      return;
    }
    const version = ++generation.current;
    const ticket = session.ticket();
    const abort = new AbortController();
    active.current = abort;
    setBusy(true);
    const timeout = window.setTimeout(() => abort.abort(), 15_000);
    const current = () =>
      alive.current &&
      version === generation.current &&
      ticket === session.ticket();
    try {
      const response = await fetch(
        mode === "member-search"
          ? "/api/v1/admin/members/search"
          : "/api/v1/admin/assistant/context",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: abort.signal,
        },
      );
      const payload = await response.json();
      if (!current() || abort.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setMember(null);
          setSearch(null);
          session.clear();
        }
        setMessage(
          typeof payload?.error?.message === "string"
            ? payload.error.message
            : "기록을 확인하지 못했습니다. 다시 시도해 주세요.",
        );
        return;
      }
      if (mode === "member-search") {
        const parsed = memberSearchResponseSchema.safeParse(payload.data);
        if (!parsed.success) throw new Error("INVALID_SEARCH_RESULT");
        setSearch({ value: parsed.data, ticket });
      } else {
        const parsed = assistantContextReport.safeParse(payload.data);
        if (!parsed.success || "query" in input)
          throw new Error("INVALID_CONTEXT_RESULT");
        setReport({ value: parsed.data, ticket, input });
      }
    } catch {
      if (current())
        setMessage(
          "기록을 확인하지 못했습니다. 연결과 입력 내용을 확인한 뒤 다시 시도해 주세요.",
        );
    } finally {
      window.clearTimeout(timeout);
      if (alive.current && version === generation.current) setBusy(false);
    }
  }

  function currentInput(): AssistantContextInput | null {
    if (memberContextTopic(topic))
      return member
        ? {
            topic: topic as "member" | "wallet-ledger" | "mining",
            userId: member.userId,
          }
        : null;
    return {
      topic: topic as
        | "dashboard"
        | "deposits"
        | "withdrawals"
        | "jobs"
        | "security"
        | "audit",
    };
  }

  return (
    <section
      className={`${styles.panel} ${styles.contextPanel}`}
      aria-labelledby="assistant-context-title"
    >
      <p className={styles.eyebrow}>기록 기반 운영 안내</p>
      <h2 id="assistant-context-title">무엇부터 확인할까요?</h2>
      <p className={styles.note}>
        현재 기록과 다음 확인 순서를 함께 봅니다. 금전 처리와 승인은 기존
        화면에서 진행해요.
      </p>
      <div className={styles.form}>
        <label htmlFor="assistant-context-topic">
          확인할 업무
          <select
            id="assistant-context-topic"
            value={topic}
            onChange={(event) => {
              clearRead();
              setSearch(null);
              setTopic(event.target.value as AssistantContextTopic);
            }}
          >
            {ASSISTANT_CONTEXT_TOPICS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {memberContextTopic(topic) ? (
        <div className={styles.memberLookup}>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(null);
              setMember(null);
              void request("member-search", { query });
            }}
          >
            <label htmlFor="assistant-member-query">
              회원 이름·아이디·전화번호
              <input
                id="assistant-member-query"
                value={query}
                minLength={2}
                maxLength={80}
                required
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  clearRead();
                  setSearch(null);
                  setMember(null);
                  setQuery(event.target.value);
                }}
              />
            </label>
            <button className="ghost-button" type="submit" disabled={busy}>
              회원 찾기
            </button>
          </form>
          {matches ? (
            <div aria-live="polite">
              <p className={styles.note}>
                {matches.members.length
                  ? "마스킹된 결과에서 회원을 선택하세요."
                  : "검색 결과가 없습니다. 입력을 확인해 주세요."}
              </p>
              {matches.hasMore ? (
                <p className={styles.note}>
                  최대 20명까지 표시합니다. 검색어를 더 자세히 적어 주세요.
                </p>
              ) : null}
              <ul
                className={styles.contextChoices}
                aria-label="설명할 회원 선택"
              >
                {matches.members.map((choice) => (
                  <li key={choice.userId}>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        clearRead();
                        setSearch(null);
                        setMember({ value: choice, ticket: session.ticket() });
                      }}
                    >
                      {choice.name} · {choice.loginId ?? "아이디 확인 불가"} ·{" "}
                      {choice.phone ?? "전화번호 확인 불가"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {member ? (
            <p className={styles.note} role="status">
              선택한 회원: {member.name} ·{" "}
              {member.loginId ?? "아이디 확인 불가"} ·{" "}
              {member.phone ?? "전화번호 확인 불가"}
            </p>
          ) : (
            <p className={styles.note}>
              먼저 회원을 찾아 선택해 주세요. 회원 식별자를 직접 입력할 필요가
              없습니다.
            </p>
          )}
        </div>
      ) : null}
      <button
        className="gold-button"
        type="button"
        disabled={busy || (memberContextTopic(topic) && !member)}
        onClick={() => {
          const input = currentInput();
          if (input) void request("context", input);
        }}
      >
        기록 확인
      </button>
      {busy ? (
        <p role="status" className={styles.note}>
          현재 기록을 확인하고 있습니다.
        </p>
      ) : null}
      {message ? (
        <p role="alert" className={styles.notice}>
          {message}
        </p>
      ) : null}
      {report ? (
        <article className={styles.contextReport} aria-label="운영 기록 설명">
          <h3>{report.title}</h3>
          <p className={styles.note}>
            조회 시각 ·{" "}
            <time dateTime={report.observedAt}>
              {formatKst(report.observedAt)}
            </time>
          </p>
          <p className={styles.note}>
            조회 당시 기록입니다. 작업 전에는 해당 화면에서 현재 상태를 다시
            확인하세요.
          </p>
          {report.sections.map((section) => (
            <section
              key={section.kind}
              aria-label={ASSISTANT_EVIDENCE_LABELS[section.kind]}
            >
              <h4>{ASSISTANT_EVIDENCE_LABELS[section.kind]}</h4>
              {section.points.length ? (
                groupedEvidence(section.points).map((group) => (
                  <div
                    className={styles.contextEvidenceGroup}
                    key={JSON.stringify([
                      group.source.href,
                      group.source.label,
                    ])}
                  >
                    <ul>
                      {group.points.map((point, index) => (
                        <li key={index}>
                          <p>{point.text}</p>
                        </li>
                      ))}
                    </ul>
                    <Link
                      className={`text-link ${styles.contextSourceLink}`}
                      href={group.source.href as Route}
                    >
                      {group.source.label} →
                    </Link>
                  </div>
                ))
              ) : (
                <p className={styles.note}>
                  {section.kind === "INFERENCE"
                    ? "이번 조회에서는 추가 가능성을 판단하지 않았습니다."
                    : "이번 조회에 추가 항목이 없습니다."}
                </p>
              )}
            </section>
          ))}
          {report.choices.length ? (
            <ul
              className={styles.contextChoices}
              aria-label="자세히 확인할 신청"
            >
              {report.choices.map((choice, index) => (
                <li key={index}>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void request("context", choice.input)}
                  >
                    {choice.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            className="ghost-button"
            type="button"
            disabled={busy}
            onClick={() => {
              if (reportRecord) void request("context", reportRecord.input);
            }}
          >
            다시 확인
          </button>
        </article>
      ) : null}
    </section>
  );
}
