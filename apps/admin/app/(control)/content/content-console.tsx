"use client";

import { useEffect, useRef, useState } from "react";
import { StepUpTokenField } from "@/components/step-up-token-field";
import {
  CONTENT_CTA_ROUTES,
  contentCommandSchema,
  contentReceiptSchema,
  contentReviewSchema,
  eventContentSchema,
  noticeContentSchema,
  type ContentCommand,
  type ContentReceipt,
} from "../../../../../domain/content/contract";
import styles from "./content.module.css";

const states: Record<ContentReceipt["state"], string> = {
  DRAFT: "초안",
  PREVIEWED: "검토됨",
  APPROVED: "승인됨",
  PUBLISHED: "게시됨",
  CANCELLED: "취소됨",
  ARCHIVED: "보관됨",
};
const operations: Record<ContentCommand["operation"], string> = {
  CREATE_DRAFT: "초안 저장",
  UPDATE_DRAFT: "수정 저장",
  PREVIEW: "내용 검토",
  APPROVE: "게시 승인",
  PUBLISH: "게시",
  CANCEL: "이벤트 취소",
  ARCHIVE: "공지 보관",
};
const ctaNames: Record<string, string> = {
  "/home": "홈",
  "/start": "채굴 시작",
  "/mining": "채굴",
  "/wallet": "지갑",
  "/wallet/deposit": "입금",
  "/wallet/withdraw": "출금",
  "/products": "상품",
  "/events": "이벤트",
  "/notifications": "알림",
  "/menu": "메뉴",
  "/menu/account": "내 계정",
  "/menu/notifications": "알림 설정",
  "/support": "고객 지원",
  "/login": "로그인",
  "/about": "퍼뜩 소개",
  "/faq": "자주 묻는 질문",
  "/status": "서비스 안내",
  "/changelog": "변경 안내",
  "/": "첫 화면",
};
type Pending = { key: string; body: ContentCommand };
function localTime(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(Date.parse(value) + 9 * 3600000);
  return date.toISOString().slice(0, 16);
}
function utc(value: FormDataEntryValue | null) {
  return typeof value === "string" && value
    ? new Date(`${value}:00+09:00`).toISOString()
    : null;
}
export function ContentConsole() {
  const [kind, setKind] = useState<"EVENT" | "NOTICE">("EVENT");
  const [items, setItems] = useState<ContentReceipt[]>([]);
  const [selected, setSelected] = useState<ContentReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState(false);
  const [token, setToken] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const attempt = useRef<Pending | null>(null);
  const controller = useRef<AbortController | null>(null);
  const snapshot = selected?.snapshot as Record<string, unknown> | undefined;
  useEffect(() => () => controller.current?.abort(), []);
  async function call(path: string, data: unknown, key?: string) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const timeout = setTimeout(() => current.abort(), 20000);
    try {
      const response = await fetch(path, {
        method: "POST",
        cache: "no-store",
        signal: current.signal,
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      return { response, result };
    } finally {
      clearTimeout(timeout);
    }
  }
  async function refresh() {
    setBusy(true);
    setProblem(false);
    setMessage("");
    try {
      const { response, result } = await call("/api/content/state", {
        kind,
        contentId: null,
      });
      const parsed = contentReviewSchema.safeParse(result.data);
      if (!response.ok || !parsed.success) throw new Error("READ_FAILED");
      setItems([
        ...new Map(
          [...parsed.data.items]
            .sort((a, b) => a.revision - b.revision)
            .map((row) => [row.contentId, row]),
        ).values(),
      ]);
      setMessage(
        parsed.data.items.length
          ? "최신 안내 내용을 불러왔습니다."
          : "등록한 안내가 없습니다. 새 초안을 작성해 주세요.",
      );
    } catch {
      setProblem(true);
      setMessage(
        "안내를 불러오지 못했습니다. 연결과 권한을 확인한 뒤 다시 조회해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  function choose(item: ContentReceipt | null) {
    setSelected(item);
    setPreview((item?.snapshot as Record<string, unknown>) ?? null);
    setToken("");
    setMessage("");
    setDirty(false);
  }
  async function send(pending: Pending) {
    setBusy(true);
    setToken("");
    setProblem(false);
    setMessage("결과를 확인하고 있습니다.");
    try {
      if (!navigator.onLine) {
        setMessage("연결된 뒤 직접 다시 눌러 주세요.");
        setProblem(true);
        return;
      }
      const { response, result } = await call(
        "/api/content/command",
        pending.body,
        pending.key,
      );
      if (!response.ok) {
        if (response.status >= 500) throw new Error("UNKNOWN_RESULT");
        attempt.current = null;
        setUncertain(false);
        setProblem(true);
        setMessage(
          typeof result.error?.message === "string"
            ? result.error.message
            : "입력 내용을 확인해 주세요.",
        );
        return;
      }
      const receipt = contentReceiptSchema.safeParse(result.data?.receipt);
      const review = contentReviewSchema.safeParse(result.data?.state);
      if (!receipt.success || !review.success || result.data.confirmed !== true)
        throw new Error("UNKNOWN_RESULT");
      const latest = review.data.items
        .filter((row) => row.contentId === receipt.data.contentId)
        .sort((a, b) => b.revision - a.revision)[0];
      if (!latest) throw new Error("UNKNOWN_RESULT");
      setItems((previous) => [
        latest,
        ...previous.filter((row) => row.contentId !== latest.contentId),
      ]);
      choose(latest);
      attempt.current = null;
      setUncertain(false);
      setMessage(
        `${operations[pending.body.operation]} 결과를 확인했습니다. 현재 상태: ${states[latest.state]}`,
      );
    } catch {
      setUncertain(true);
      setProblem(true);
      setMessage(
        "결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요. 확인 전에는 새 작업을 보내지 마세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(
    form: HTMLFormElement,
    operation: ContentCommand["operation"],
  ) {
    if (busy || uncertain) return;
    const data = new FormData(form);
    const get = (name: string) => String(data.get(name) ?? "").trim();
    let payload: unknown = null;
    try {
      if (operation === "CREATE_DRAFT" || operation === "UPDATE_DRAFT") {
        const base = {
          slug: get("slug"),
          title: get("title"),
          summary: get("summary"),
          body: get("body"),
          ctaLabel: get("ctaLabel"),
          ctaRoute: get("ctaRoute"),
          audience: "MEMBERS",
          segment: "ALL_MEMBERS",
        };
        payload =
          kind === "EVENT"
            ? eventContentSchema.parse({
                ...base,
                cardTitle: get("cardTitle"),
                rewardMode: "NONE",
                participation: get("participation"),
                exclusion: get("exclusion"),
                startsAt: utc(data.get("startsAt")),
                endsAt: utc(data.get("endsAt")),
              })
            : noticeContentSchema.parse({
                ...base,
                publishedAt: utc(data.get("publishedAt")),
                expiresAt: utc(data.get("expiresAt")),
                isPinned: data.get("isPinned") === "on",
              });
      }
      const body = contentCommandSchema.parse({
        operation,
        kind,
        contentId: selected?.contentId ?? null,
        expectedRevision: selected?.revisionId ?? null,
        expectedDigest: selected?.digest ?? null,
        payload,
        reason: get("reason"),
        stepUpToken: token,
        confirmation: data.get("confirmation")
          ? "CONFIRM_LIVEOPS_CONTENT"
          : null,
      });
      const pending = { key: crypto.randomUUID(), body };
      attempt.current = pending;
      await send(pending);
    } catch {
      setProblem(true);
      setMessage(
        "필수 내용, 게시 기간, 작업 사유와 인증 앱 확인을 모두 확인해 주세요.",
      );
    }
  }
  const allowed: ContentCommand["operation"][] = !selected
    ? ["CREATE_DRAFT"]
    : dirty && ["DRAFT", "PREVIEWED", "APPROVED"].includes(selected.state)
      ? ["UPDATE_DRAFT"]
      : selected.state === "DRAFT"
        ? ["UPDATE_DRAFT", "PREVIEW"]
        : selected.state === "PREVIEWED"
          ? ["UPDATE_DRAFT", "APPROVE"]
          : selected.state === "APPROVED"
            ? ["UPDATE_DRAFT", "PUBLISH"]
            : selected.state === "PUBLISHED"
              ? [kind === "EVENT" ? "CANCEL" : "ARCHIVE"]
              : [];
  return (
    <section
      className={styles.console}
      data-ui-ready="/content"
      data-ui-state={
        busy
          ? "loading"
          : problem
            ? "error"
            : uncertain
              ? "uncertain"
              : "loaded"
      }
    >
      <header>
        <p className="eyebrow">회원 안내 관리</p>
        <h1>이벤트와 공지</h1>
        <p>
          초안을 저장하고, 내용을 검토한 뒤 승인·게시합니다. 게시되는 내용과
          기간을 먼저 확인해 주세요.
        </p>
      </header>
      <div className={styles.toolbar}>
        <label>
          안내 종류
          <select
            disabled={busy || uncertain}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as "EVENT" | "NOTICE");
              setItems([]);
              choose(null);
            }}
          >
            <option value="EVENT">이벤트</option>
            <option value="NOTICE">공지</option>
          </select>
        </label>
        <button disabled={busy} onClick={() => void refresh()}>
          안내 불러오기
        </button>
        <button disabled={busy || uncertain} onClick={() => choose(null)}>
          새 초안
        </button>
      </div>
      {message && (
        <p
          role={problem ? "alert" : "status"}
          className={problem ? styles.alert : styles.feedback}
        >
          {message}
        </p>
      )}
      {uncertain && (
        <button
          disabled={busy}
          onClick={() => attempt.current && void send(attempt.current)}
        >
          같은 요청 다시 확인
        </button>
      )}
      <div className={styles.workspace}>
        <section aria-label="등록한 안내" className={styles.list}>
          {items.map((item) => (
            <button
              key={item.contentId}
              disabled={busy || uncertain}
              aria-pressed={selected?.contentId === item.contentId}
              onClick={() => choose(item)}
            >
              <strong>
                {String((item.snapshot as Record<string, unknown>).title)}
              </strong>
              <span>{states[item.state]}</span>
            </button>
          ))}
        </section>
        <form
          key={`${kind}:${selected?.revisionId ?? "new"}`}
          className={styles.editor}
          onSubmit={(e) => {
            e.preventDefault();
            const button = (e.nativeEvent as SubmitEvent)
              .submitter as HTMLButtonElement | null;
            void submit(
              e.currentTarget,
              button?.value as ContentCommand["operation"],
            );
          }}
          onChange={(e) => {
            const data = new FormData(e.currentTarget);
            setPreview(Object.fromEntries(data));
            const name = (e.nativeEvent.target as HTMLInputElement).name;
            if (!["reason", "confirmation", "stepUpToken", ""].includes(name)) {
              setDirty(true);
              setToken("");
            }
          }}
        >
          <fieldset disabled={busy || uncertain}>
            <legend>
              {selected ? `${states[selected.state]} 안내` : "새 초안 작성"}
            </legend>
            <label>
              주소 이름
              <input
                name="slug"
                defaultValue={String(snapshot?.slug ?? "")}
                placeholder="알기 쉬운 영문 주소"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                maxLength={100}
                required
              />
            </label>
            <label>
              제목
              <input
                name="title"
                defaultValue={String(snapshot?.title ?? "")}
                maxLength={kind === "EVENT" ? 100 : 120}
                required
              />
            </label>
            {kind === "EVENT" && (
              <label>
                카드 제목
                <input
                  name="cardTitle"
                  defaultValue={String(snapshot?.cardTitle ?? "")}
                  maxLength={100}
                  required
                />
              </label>
            )}
            <label>
              짧은 안내
              <textarea
                name="summary"
                defaultValue={String(snapshot?.summary ?? "")}
                rows={2}
                maxLength={500}
                required
              />
            </label>
            <label>
              전체 안내
              <textarea
                name="body"
                defaultValue={String(snapshot?.body ?? "")}
                rows={10}
                maxLength={20000}
                required
              />
            </label>
            <div className={styles.row}>
              <label>
                버튼 이름
                <input
                  name="ctaLabel"
                  defaultValue={String(snapshot?.ctaLabel ?? "")}
                  maxLength={80}
                  required
                />
              </label>
              <label>
                이동할 화면
                <select
                  name="ctaRoute"
                  defaultValue={String(snapshot?.ctaRoute ?? "/events")}
                >
                  {CONTENT_CTA_ROUTES.map((route) => (
                    <option key={route} value={route}>
                      {ctaNames[route]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {kind === "EVENT" ? (
              <>
                <label>
                  참여 안내
                  <textarea
                    name="participation"
                    defaultValue={String(snapshot?.participation ?? "")}
                    rows={2}
                    maxLength={2000}
                    required
                  />
                </label>
                <label>
                  제외 안내
                  <textarea
                    name="exclusion"
                    defaultValue={String(snapshot?.exclusion ?? "")}
                    rows={2}
                    maxLength={2000}
                    required
                  />
                </label>
                <p>이 안내에는 금전 보상이 없습니다.</p>
                <div className={styles.row}>
                  <label>
                    시작일 (한국 시간)
                    <input
                      type="datetime-local"
                      name="startsAt"
                      defaultValue={localTime(snapshot?.startsAt)}
                    />
                  </label>
                  <label>
                    종료일 (한국 시간)
                    <input
                      type="datetime-local"
                      name="endsAt"
                      defaultValue={localTime(snapshot?.endsAt)}
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className={styles.row}>
                  <label>
                    게시일 (한국 시간)
                    <input
                      type="datetime-local"
                      name="publishedAt"
                      defaultValue={localTime(snapshot?.publishedAt)}
                    />
                  </label>
                  <label>
                    종료일 (선택)
                    <input
                      type="datetime-local"
                      name="expiresAt"
                      defaultValue={localTime(snapshot?.expiresAt)}
                    />
                  </label>
                </div>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    name="isPinned"
                    defaultChecked={snapshot?.isPinned === true}
                  />
                  상단에 표시
                </label>
              </>
            )}
            <p>대상: 전체 회원</p>
            <label>
              작업 사유
              <textarea
                name="reason"
                rows={2}
                minLength={10}
                maxLength={500}
                required
              />
            </label>
            <StepUpTokenField
              commandFamily="LIVEOPS_CONTENT"
              onTokenIssued={setToken}
              submissionPending={busy}
            />
            <label className={styles.check}>
              <input type="checkbox" name="confirmation" required />
              현재 안내와 기간을 확인했습니다.
            </label>
            <div className={styles.actions}>
              {allowed.map((operation) => (
                <button
                  key={operation}
                  type="submit"
                  value={operation}
                  disabled={!token}
                >
                  {operations[operation]}
                </button>
              ))}
            </div>
          </fieldset>
        </form>
        <section aria-label="회원 화면 미리보기" className={styles.preview}>
          <h2>회원에게 보이는 안내</h2>
          {preview ? (
            <>
              <strong>{String(preview.title ?? "")}</strong>
              <p>{String(preview.summary ?? "")}</p>
              <div className={styles.fullbody}>
                {String(preview.body ?? "")}
              </div>
              <p>{String(preview.participation ?? "")}</p>
              <p>{String(preview.exclusion ?? "")}</p>
              <span className={styles.cta}>
                {String(preview.ctaLabel ?? "")}
              </span>
            </>
          ) : (
            <p>초안을 작성하거나 안내를 선택해 주세요.</p>
          )}
          <p className={styles.note}>
            미리보기는 게시 결과가 아닙니다. 실제 게시 상태는 처리 결과에서
            확인해 주세요.
          </p>
        </section>
      </div>
    </section>
  );
}
