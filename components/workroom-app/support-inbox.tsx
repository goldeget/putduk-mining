"use client";
import { useEffect, useRef, useState } from "react";
import {
  WorkroomAppSupportPageSchema,
  WorkroomAppThreadResultSchema,
  type Thread,
  type SupportMessage,
} from "../../lib/workroom-app/contract";
import {
  appCommand,
  appEndpoint,
  appRequest,
  dateLabel,
  inboxChanged,
  useVisibleResource,
} from "./client";
import styles from "./workroom-app.module.css";
import { SupportPhoto } from "./support-photo";
import { z } from "zod";
import { mergeSupportDetail, mergeSupportPage } from "./pagination";

const statusLabels = {
  OPEN: "접수",
  ASSIGNED: "담당 중",
  ANSWERED: "답변 완료",
  RESOLVED: "해결",
};
export function SupportInbox({
  admin = false,
  actorId,
  initialThread = null,
}: {
  admin?: boolean;
  actorId: string;
  initialThread?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initialThread);
  const [filter, setFilter] = useState("ALL");
  const [olderThreads, setOlderThreads] = useState<Thread[]>([]);
  const [olderMessages, setOlderMessages] = useState<SupportMessage[]>([]);
  const [messagesCursor, setMessagesCursor] = useState<
    string | null | undefined
  >();
  const [threadsCursor, setThreadsCursor] = useState<
    string | null | undefined
  >();
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState("");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [files, setFiles] = useState<
    { file: File; key: string; id?: string }[]
  >([]);
  const retry = useRef<{
    operation: string;
    text: string;
    thread: string | null;
    key: string;
  } | null>(null);
  const seen = useRef("");
  const endpoint = appEndpoint(admin);
  const list = useVisibleResource(
    `${endpoint}?operation=SUPPORT_READ&limit=30${admin ? `&filter=${filter}` : ""}`,
    WorkroomAppSupportPageSchema,
    mergeSupportPage,
  );
  const detail = useVisibleResource(
    selected
      ? `${endpoint}?operation=SUPPORT_READ&threadId=${selected}&limit=30`
      : null,
    WorkroomAppSupportPageSchema,
    mergeSupportDetail,
  );
  const thread = detail.data?.items[0] ?? null;
  const items = [...(list.data?.items ?? []), ...olderThreads].filter(
    (item, index, all) =>
      all.findIndex((other) => other.id === item.id) === index,
  );
  const messages = [...olderMessages, ...(thread?.messages ?? [])].filter(
    (item, index, all) =>
      all.findIndex((other) => other.id === item.id) === index,
  );
  const lastMessage = thread?.messages.at(-1);
  const refreshList = list.refresh;
  useEffect(() => {
    if (
      !thread ||
      !lastMessage ||
      document.visibilityState === "hidden" ||
      seen.current === lastMessage.id ||
      thread.unreadCount === 0
    )
      return;
    seen.current = lastMessage.id;
    void appCommand(
      admin,
      "SUPPORT_SEEN",
      { threadId: thread.id, messageId: lastMessage.id },
      crypto.randomUUID(),
      WorkroomAppThreadResultSchema,
    )
      .then(() => refreshList())
      .catch(() => {
        seen.current = "";
      });
  }, [admin, thread, lastMessage, refreshList]);
  function choose(id: string | null) {
    if (pending || paging) return;
    setSelected(id);
    setOlderMessages([]);
    setMessagesCursor(undefined);
    setPageError("");
    seen.current = "";
    setDraft("");
    setFiles([]);
    retry.current = null;
    setSendError("");
    setConfirmation("");
    const url = new URL(location.href);
    if (id) url.searchParams.set("thread", id);
    else url.searchParams.delete("thread");
    history.replaceState(null, "", url.pathname + url.search);
  }
  async function command(
    operation:
      "SUPPORT_SEND" | "SUPPORT_REPLY" | "SUPPORT_ASSIGN" | "SUPPORT_RESOLVE",
  ) {
    if (
      pending ||
      ((operation === "SUPPORT_SEND" || operation === "SUPPORT_REPLY") &&
        !draft.trim())
    )
      return;
    const old = retry.current;
    const key =
      old &&
      old.text === draft &&
      old.thread === selected &&
      old.operation === operation
        ? old.key
        : crypto.randomUUID();
    retry.current = { operation, text: draft, thread: selected, key };
    setPending(true);
    setSendError("");
    setConfirmation("");
    try {
      const input: Record<string, unknown> = selected
        ? { threadId: selected }
        : {};
      if (operation === "SUPPORT_SEND" || operation === "SUPPORT_REPLY") {
        input.body = draft.trim();
        const attachmentIds: string[] = [];
        for (const item of files) {
          if (item.id) {
            attachmentIds.push(item.id);
            continue;
          }
          const result = await appRequest(
            `${endpoint}/attachments`,
            z.object({ id: z.uuid() }),
            {
              method: "POST",
              headers: {
                "Content-Type": item.file.type,
                "Idempotency-Key": item.key,
              },
              body: item.file,
            },
          );
          attachmentIds.push(result.id);
          setFiles((previous) =>
            previous.map((photo) =>
              photo.key === item.key ? { ...photo, id: result.id } : photo,
            ),
          );
        }
        if (attachmentIds.length) input.attachmentIds = attachmentIds;
      }
      const result = await appCommand(
        admin,
        operation,
        input,
        key,
        WorkroomAppThreadResultSchema,
      );
      if (operation === "SUPPORT_SEND" || operation === "SUPPORT_REPLY") {
        setDraft("");
        setFiles([]);
      }
      retry.current = null;
      setSelected(result.thread.id);
      const url = new URL(location.href);
      url.searchParams.set("thread", result.thread.id);
      history.replaceState(null, "", url.pathname + url.search);
      setConfirmation(
        operation === "SUPPORT_RESOLVE"
          ? "해결 상태로 저장했어요."
          : operation === "SUPPORT_ASSIGN"
            ? "내 담당으로 저장했어요."
            : "메시지를 저장했어요.",
      );
      detail.refresh();
      list.refresh();
      window.dispatchEvent(new Event(inboxChanged));
    } catch (cause) {
      setSendError(
        cause instanceof Error
          ? cause.message
          : "저장 결과를 확인하지 못했어요. 다시 보내기를 눌러 주세요.",
      );
    } finally {
      setPending(false);
    }
  }
  async function more(kind: "threads" | "messages") {
    const cursor =
      kind === "threads"
        ? threadsCursor === undefined
          ? list.data?.nextCursor
          : threadsCursor
        : messagesCursor === undefined
          ? detail.data?.nextCursor
          : messagesCursor;
    if (!cursor || paging) return;
    setPaging(true);
    setPageError("");
    try {
      const result = await appRequest(
        `${endpoint}?operation=SUPPORT_READ&limit=30&cursor=${cursor}${kind === "messages" ? `&threadId=${selected}` : admin ? `&filter=${filter}` : ""}`,
        WorkroomAppSupportPageSchema,
      );
      if (kind === "threads") {
        setOlderThreads((previous) => [...previous, ...result.items]);
        setThreadsCursor(result.nextCursor);
      } else {
        setOlderMessages((previous) => [
          ...(result.items[0]?.messages ?? []),
          ...previous,
        ]);
        setMessagesCursor(result.nextCursor);
      }
    } catch {
      setPageError("이전 내용을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      setPaging(false);
    }
  }
  if (list.authorizationLost || detail.authorizationLost)
    return (
      <section className={styles.app} role="alert">
        <h1>로그인 상태를 확인해 주세요</h1>
        <p>보안을 위해 문의 내용을 닫았어요. 다시 로그인한 뒤 확인해 주세요.</p>
        <a
          href={
            admin
              ? "/login?returnTo=%2Fsupport"
              : "/login?next=%2Fworkroom%2Fsupport"
          }
        >
          로그인
        </a>
      </section>
    );
  return (
    <section
      className={styles.app}
      data-ui-ready={admin ? "/support" : "/workroom/support"}
    >
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>WORKROOM SUPPORT</span>
          <h1>{admin ? "1:1 문의함" : "1:1 문의"}</h1>
          <p>
            {admin
              ? "회원의 문의를 확인하고 답변하세요."
              : "궁금한 점을 남기면 이곳에서 답변을 확인할 수 있어요."}
          </p>
        </div>
        {!admin ? (
          <button
            className={styles.primary}
            onClick={() => choose(null)}
            disabled={pending}
          >
            새 문의
          </button>
        ) : null}
      </header>
      <div className={styles.supportGrid}>
        <aside className={styles.panel} aria-label="문의 목록">
          <div className={styles.panelHead}>
            <h2>{admin ? "회원 문의" : "내 문의"}</h2>
            <button className={styles.quiet} onClick={list.refresh}>
              새로고침
            </button>
          </div>
          {admin ? (
            <label className={styles.filter}>
              문의 보기
              <select
                value={filter}
                disabled={paging}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setOlderThreads([]);
                  setThreadsCursor(undefined);
                }}
              >
                <option value="ALL">전체</option>
                <option value="UNANSWERED">미답변</option>
                <option value="MINE">내 담당</option>
                <option value="RESOLVED">해결</option>
              </select>
            </label>
          ) : null}
          {list.error ? (
            <p role="alert" className={styles.error}>
              {list.error}
            </p>
          ) : null}
          {list.loading && !list.data ? (
            <p role="status" className={styles.empty}>
              문의 목록을 불러오는 중이에요.
            </p>
          ) : null}
          {!list.loading && !list.error && items.length === 0 ? (
            <p className={styles.empty}>
              {admin
                ? "표시할 문의가 없어요."
                : "아직 남긴 문의가 없어요. 아래에서 첫 문의를 보내세요."}
            </p>
          ) : null}
          <ul className={styles.threadList}>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  disabled={pending}
                  onClick={() => choose(item.id)}
                  aria-pressed={selected === item.id}
                >
                  <span className={styles.threadTop}>
                    <strong>
                      {admin
                        ? `${item.memberName} · ${item.memberLoginId ?? "아이디 미등록"}`
                        : `문의 ${item.id.slice(0, 8)}`}
                    </strong>
                    <span className={styles.status}>
                      {statusLabels[item.status]}
                    </span>
                  </span>
                  <time dateTime={item.updatedAt}>
                    {dateLabel(item.updatedAt)}
                  </time>
                  {item.unreadCount > 0 ? (
                    <span className={styles.unread}>
                      {item.unreadCount}개 미확인
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {(
            threadsCursor === undefined ? list.data?.nextCursor : threadsCursor
          ) ? (
            <button
              className={styles.more}
              disabled={paging}
              onClick={() => void more("threads")}
            >
              이전 문의 더 보기
            </button>
          ) : null}
        </aside>
        <div className={styles.panel} aria-label="문의 대화">
          <div className={styles.panelHead}>
            <div>
              <h2>
                {thread
                  ? admin
                    ? thread.memberName
                    : "문의 내용"
                  : selected
                    ? "문의 불러오기"
                    : admin
                      ? "문의를 선택하세요"
                      : "새 문의 작성"}
              </h2>
              {thread ? (
                <p className={styles.identity}>
                  {admin
                    ? `${thread.memberLoginId ?? "아이디 미등록"} · 회원 ${thread.memberId}`
                    : `문의 번호 ${thread.id}`}
                  <br />
                  {statusLabels[thread.status]}
                  {admin
                    ? ` · ${thread.assignedAdminId === actorId ? "내 담당" : thread.assignedAdminId ? `담당자 ${thread.assignedAdminId}` : "담당자 미지정"}`
                    : ""}
                </p>
              ) : null}
            </div>
          </div>
          {admin && thread ? (
            <div className={styles.actions}>
              <button
                className={styles.secondary}
                disabled={pending || thread.assignedAdminId === actorId}
                onClick={() => void command("SUPPORT_ASSIGN")}
              >
                내 담당으로
              </button>
              <button
                className={styles.secondary}
                disabled={pending || thread.status === "RESOLVED"}
                onClick={() => void command("SUPPORT_RESOLVE")}
              >
                해결로 표시
              </button>
            </div>
          ) : null}
          {detail.error ? (
            <p role="alert" className={styles.error}>
              {detail.error} <button onClick={detail.refresh}>다시 시도</button>
            </p>
          ) : null}
          {detail.loading && !thread && selected ? (
            <p role="status" className={styles.empty}>
              대화를 불러오는 중이에요.
            </p>
          ) : null}
          {selected && !detail.loading && !detail.error && !thread ? (
            <p role="alert" className={styles.empty}>
              이 문의를 확인할 수 없어요. 문의 목록에서 다시 선택해 주세요.
            </p>
          ) : null}
          <div
            className={styles.conversation}
            role="log"
            aria-label="문의 메시지"
            aria-live="polite"
            aria-relevant="additions"
          >
            {(
              messagesCursor === undefined
                ? detail.data?.nextCursor
                : messagesCursor
            ) ? (
              <button
                className={styles.more}
                disabled={paging}
                onClick={() => void more("messages")}
              >
                이전 메시지 더 보기
              </button>
            ) : null}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`${styles.message} ${message.senderRole === (admin ? "ADMIN" : "MEMBER") ? styles.mine : ""}`}
              >
                <span>
                  {message.senderRole === "ADMIN"
                    ? "워크룸 운영자"
                    : admin
                      ? thread?.memberName
                      : "나"}
                </span>
                <p>{message.body}</p>
                {message.attachments?.map((photo) => (
                  <SupportPhoto key={photo.id} id={photo.id} admin={admin} />
                ))}
                <time dateTime={message.createdAt}>
                  {dateLabel(message.createdAt)}
                </time>
              </article>
            ))}
            {!selected ? (
              <p className={styles.empty}>
                {admin
                  ? "목록에서 문의를 선택하면 대화가 표시돼요."
                  : "문의 내용을 적어 주세요. 계좌번호나 비밀번호는 보내지 마세요."}
              </p>
            ) : null}
          </div>
          {pageError ? (
            <p className={styles.error} role="alert">
              {pageError}
            </p>
          ) : null}
          {!admin || thread ? (
            <form
              className={styles.composer}
              onSubmit={(event) => {
                event.preventDefault();
                void command(admin ? "SUPPORT_REPLY" : "SUPPORT_SEND");
              }}
            >
              <label htmlFor="support-message">
                {admin ? "회원에게 답변" : "문의 내용"}
              </label>
              <textarea
                id="support-message"
                value={draft}
                maxLength={2000}
                rows={4}
                disabled={pending || Boolean(selected && !thread)}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setSendError("");
                  setConfirmation("");
                }}
                placeholder={
                  admin
                    ? "회원에게 보낼 답변을 입력하세요."
                    : "어떤 도움이 필요한지 알려 주세요."
                }
              />
              <label className={styles.photoPicker}>
                사진 첨부 (선택)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={pending || files.length >= 3}
                  onChange={(event) => {
                    const picked = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (
                      picked.length + files.length > 3 ||
                      picked.some(
                        (file) =>
                          !["image/jpeg", "image/png", "image/webp"].includes(
                            file.type,
                          ) ||
                          file.size > 5242880 ||
                          file.size === 0,
                      )
                    ) {
                      setSendError(
                        "사진은 JPG, PNG, WebP로 3장까지, 한 장에 5MB까지 보낼 수 있어요.",
                      );
                      return;
                    }
                    setFiles((previous) => [
                      ...previous,
                      ...picked.map((file) => ({
                        file,
                        key: crypto.randomUUID(),
                      })),
                    ]);
                    retry.current = null;
                    setSendError("");
                  }}
                />
              </label>
              {files.length ? (
                <ul className={styles.photoList}>
                  {files.map((item, index) => (
                    <li key={item.key}>
                      <span>
                        사진 {index + 1} ·{" "}
                        {(item.file.size / 1024 / 1024).toFixed(1)}MB
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`사진 ${index + 1} 첨부 취소`}
                        onClick={() => {
                          setFiles((previous) =>
                            previous.filter((photo) => photo.key !== item.key),
                          );
                          retry.current = null;
                        }}
                      >
                        취소
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className={styles.composerFoot}>
                <small>{draft.length.toLocaleString("ko-KR")} / 2,000</small>
                <button
                  className={styles.primary}
                  disabled={
                    pending || !draft.trim() || Boolean(selected && !thread)
                  }
                  type="submit"
                >
                  {pending
                    ? "저장 중…"
                    : sendError
                      ? "다시 보내기"
                      : admin
                        ? "답변 보내기"
                        : "문의 보내기"}
                </button>
              </div>
              <p className={styles.note}>
                {admin
                  ? "이 답변은 회원에게 공개됩니다."
                  : "답변은 문의함과 알림함에서 확인할 수 있어요."}
              </p>
            </form>
          ) : null}
          {sendError ? (
            <p className={styles.error} role="alert">
              {sendError}
            </p>
          ) : null}
          {confirmation ? (
            <p className={styles.confirmation} role="status">
              {confirmation}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
