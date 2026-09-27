import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";

import {
  depositStatusLabel,
  formatKst,
  formatKrw,
  shortId,
  withdrawalStatusLabel,
} from "@/app/(control)/_lib/format";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

const memberIdSchema = z.uuid();
const countText = (value: number | null, failed: boolean) =>
  failed || value === null ? "—" : value.toLocaleString("ko-KR");

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const principal = await requireAdminPage("/members");
  const { id } = await searchParams;
  const parsedId = memberIdSchema.safeParse(id);
  const db = createAdminServiceClient();
  if (!parsedId.success) {
    return (
      <>
        <section className="page-intro">
          <p className="eyebrow">MEMBER 360</p>
          <h1>회원 한 사람의 맥락을 한 화면에.</h1>
          <p>
            정확한 회원 UUID로만 조회합니다. 비밀번호와 문서 원문, 출금 목적지
            원문은 표시하지 않습니다. 가장하기도 없습니다.
          </p>
        </section>
        <form className="member-search">
          <label htmlFor="member-id">회원 UUID</label>
          <div>
            <input
              id="member-id"
              name="id"
              placeholder="00000000-0000-0000-0000-000000000000"
              required
            />
            <button className="gold-button" type="submit">
              안전 조회
            </button>
          </div>
          {id ? (
            <p className="form-error">올바른 회원 UUID를 입력해 주세요.</p>
          ) : null}
        </form>
        <section className="member-empty">
          <span>360°</span>
          <h2>조회할 회원을 선택해 주세요.</h2>
          <p>
            이름이나 전화번호로 무차별 검색하지 않습니다. 최소 권한 원칙에 따라
            정확한 식별자만 받습니다.
          </p>
        </section>
      </>
    );
  }

  const userId = parsedId.data;
  const [
    authUser,
    profile,
    lifecycle,
    trial,
    mining,
    wallet,
    deposits,
    withdrawals,
    events,
    notifications,
    ai,
    timeline,
    security,
    depositRows,
    withdrawalRows,
    riskFlags,
  ] = await Promise.all([
    db.auth.admin.getUserById(userId),
    db
      .from("user_profiles")
      .select("user_id, display_name, created_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("member_lifecycle_states")
      .select(
        "stage, stage_reached_at, first_funding_at, welcome_withdrawal_completed_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("trial_accounts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    db
      .from("mining_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    db
      .from("wallet_accounts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    db
      .from("deposit_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    db
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    db
      .from("event_participants")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    db
      .from("ai_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    db
      .from("member_timeline_events")
      .select("id, event_type, summary_code, occurred_at")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(8),
    db
      .from("security_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    db
      .from("deposit_requests")
      .select("id, status, amount_atomic, currency, requested_at")
      .eq("user_id", userId)
      .order("requested_at", { ascending: false })
      .limit(5),
    db
      .from("withdrawal_requests")
      .select(
        "id, status, amount_atomic, destination_type, requested_at, rejection_reason",
      )
      .eq("user_id", userId)
      .order("requested_at", { ascending: false })
      .limit(5),
    db
      .from("risk_flags")
      .select("id, flag_code, severity, created_at, resolved_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (authUser.error || !authUser.data.user) {
    return (
      <>
        <section className="page-intro">
          <p className="eyebrow">MEMBER 360</p>
          <h1>회원을 찾지 못했습니다.</h1>
          <p>
            식별자를 다시 확인해 주세요. 존재 여부 외의 정보는 표시하지
            않습니다.
          </p>
        </section>
        <Link className="text-link" href={"/members" as Route}>
          다시 조회
        </Link>
      </>
    );
  }

  const canReadKyc =
    principal.role === "SUPER_ADMIN" || principal.role === "ADMIN";
  let kyc: {
    status: string;
    risk_level: string;
    opened_at: string;
    decided_at: string | null;
  } | null = null;
  let kycAccessFailed = false;
  if (canReadKyc) {
    const audit = await db.from("audit_logs").insert({
      actor_user_id: principal.userId,
      actor_role: principal.role,
      action: "MEMBER_360_KYC_SUMMARY_VIEW",
      target_type: "USER",
      target_id: userId,
      reason: "Member 360에서 KYC 상태 요약 조회",
      request_id: randomUUID(),
      metadata: {
        surface: "admin_member_360",
        fields: ["status", "risk_level", "opened_at", "decided_at"],
      },
    });
    if (audit.error) kycAccessFailed = true;
    else {
      const result = await db
        .from("kyc_cases")
        .select("status, risk_level, opened_at, decided_at")
        .eq("user_id", userId)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      kycAccessFailed = Boolean(result.error);
      kyc = result.data;
    }
  }

  const modules = [
    ["PUTDUK START", trial],
    ["채굴 · 정산", mining],
    ["지갑 · 원장", wallet],
    ["입금", deposits],
    ["출금", withdrawals],
    ["이벤트", events],
    ["알림", notifications],
    ["PUTDUK AI", ai],
    ["보안 이벤트", security],
  ] as const;

  return (
    <>
      <section className="member-identity">
        <div className="member-avatar">
          {(profile.data?.display_name ?? "P").slice(0, 1)}
        </div>
        <div>
          <p className="eyebrow">MEMBER 360 · VERIFIED ID</p>
          <h1>{profile.data?.display_name ?? "이름 미설정"}</h1>
          <code>{userId}</code>
        </div>
        <div className="member-state">
          <span>현재 여정</span>
          <strong>{lifecycle.data?.stage ?? "SIGNED_UP"}</strong>
          <small>
            가입{" "}
            {new Intl.DateTimeFormat("ko-KR", {
              dateStyle: "medium",
              timeZone: "Asia/Seoul",
            }).format(new Date(authUser.data.user.created_at))}
          </small>
        </div>
      </section>

      <nav className="member-anchors" aria-label="증거 구역">
        <a href="#evidence-account">계정</a>
        <a href="#evidence-kyc">본인 확인</a>
        <a href="#evidence-money">입출금</a>
        <a href="#evidence-risk">위험</a>
        <a href="#evidence-timeline">활동</a>
      </nav>

      <section className="member-module-grid">
        {modules.map(([label, result]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{countText(result.count, Boolean(result.error))}</strong>
            <small>연결된 기록</small>
          </article>
        ))}
      </section>

      <section className="member-detail-grid">
        <article className="detail-panel" id="evidence-account">
          <header>
            <p className="eyebrow">IDENTITY & ACCESS</p>
            <h2>계정 상태</h2>
          </header>
          <dl>
            <div>
              <dt>이메일 확인</dt>
              <dd>
                {authUser.data.user.email_confirmed_at ? "완료" : "미완료"}
              </dd>
            </div>
            <div>
              <dt>최근 로그인</dt>
              <dd>
                {authUser.data.user.last_sign_in_at
                  ? formatKst(authUser.data.user.last_sign_in_at)
                  : "기록 없음"}
              </dd>
            </div>
            <div>
              <dt>계정 정지</dt>
              <dd>{authUser.data.user.banned_until ? "적용 중" : "없음"}</dd>
            </div>
            <div>
              <dt>첫 입금</dt>
              <dd>
                {lifecycle.data?.first_funding_at
                  ? formatKst(lifecycle.data.first_funding_at)
                  : "없음"}
              </dd>
            </div>
            <div>
              <dt>환영 출금</dt>
              <dd>
                {lifecycle.data?.welcome_withdrawal_completed_at
                  ? formatKst(lifecycle.data.welcome_withdrawal_completed_at)
                  : "미완료"}
              </dd>
            </div>
          </dl>
          <p className="locked-state">
            비밀번호·세션 토큰·가장하기 제어는 제공하지 않습니다.
          </p>
        </article>

        <article className="detail-panel" id="evidence-kyc">
          <header>
            <p className="eyebrow">SENSITIVE · AUDITED</p>
            <h2>본인 확인 요약</h2>
          </header>
          {!canReadKyc ? (
            <p className="locked-state">
              현재 역할에는 본인 확인 조회 권한이 없습니다.
            </p>
          ) : kycAccessFailed ? (
            <p className="locked-state">
              감사 기록을 남길 수 없어 조회를 차단했습니다.
            </p>
          ) : kyc ? (
            <dl>
              <div>
                <dt>상태</dt>
                <dd>{kyc.status}</dd>
              </div>
              <div>
                <dt>위험 수준</dt>
                <dd>{kyc.risk_level}</dd>
              </div>
              <div>
                <dt>접수</dt>
                <dd>{formatKst(kyc.opened_at)}</dd>
              </div>
            </dl>
          ) : (
            <p className="empty-state">본인 확인 접수 기록이 없습니다.</p>
          )}
          <p className="panel-note">문서 원문·바이트는 표시하지 않습니다.</p>
          <Link className="text-link" href={"/kyc" as Route}>
            본인 확인 대기열
          </Link>
        </article>

        <article className="detail-panel detail-panel--wide" id="evidence-money">
          <header>
            <p className="eyebrow">FUNDING EVIDENCE</p>
            <h2>입금 · 출금 증거</h2>
          </header>
          <div className="evidence-split">
            <div>
              <h3>최근 입금</h3>
              {depositRows.error ? (
                <p className="empty-state">입금 기록을 확인할 수 없습니다.</p>
              ) : depositRows.data?.length ? (
                <ul className="evidence-list">
                  {depositRows.data.map((row) => (
                    <li key={row.id}>
                      <strong>{depositStatusLabel(row.status)}</strong>
                      <span>{formatKrw(row.amount_atomic)}</span>
                      <time>{formatKst(row.requested_at)}</time>
                      <small>{shortId(row.id)}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">입금 기록 없음</p>
              )}
              <Link className="text-link" href={"/deposits/usdt" as Route}>
                USDT 입금 대기열
              </Link>
            </div>
            <div>
              <h3>최근 출금</h3>
              {withdrawalRows.error ? (
                <p className="empty-state">출금 기록을 확인할 수 없습니다.</p>
              ) : withdrawalRows.data?.length ? (
                <ul className="evidence-list">
                  {withdrawalRows.data.map((row) => (
                    <li key={row.id}>
                      <strong>
                        {row.destination_type === "KRW_BANK"
                          ? "계좌"
                          : row.destination_type === "USDT_ADDRESS"
                            ? "USDT"
                            : row.destination_type}{" "}
                        · {withdrawalStatusLabel(row.status)}
                      </strong>
                      <span>{formatKrw(row.amount_atomic)}</span>
                      <time>{formatKst(row.requested_at)}</time>
                      <small>{shortId(row.id)}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">출금 기록 없음</p>
              )}
              <div className="link-row">
                <Link
                  className="text-link"
                  href={"/withdrawals/krw-bank" as Route}
                >
                  계좌 출금
                </Link>
                <Link className="text-link" href={"/withdrawals/usdt" as Route}>
                  USDT 출금
                </Link>
              </div>
            </div>
          </div>
          <p className="panel-note">
            목적지 원문·전체 주소는 표시하지 않습니다. USDT 출금도 KRW 잔액
            기준입니다.
          </p>
        </article>

        <article className="detail-panel" id="evidence-risk">
          <header>
            <p className="eyebrow">RISK</p>
            <h2>위험 신호</h2>
          </header>
          {riskFlags.error ? (
            <p className="empty-state">위험 신호를 확인할 수 없습니다.</p>
          ) : riskFlags.data?.length ? (
            <ul className="evidence-list">
              {riskFlags.data.map((row) => (
                <li key={row.id}>
                  <strong>
                    {row.flag_code} · {row.severity}
                  </strong>
                  <span>{row.resolved_at ? "해소" : "열림"}</span>
                  <time>{formatKst(row.created_at)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">열린 위험 신호 없음</p>
          )}
          <Link className="text-link" href={"/restrictions" as Route}>
            제한 · 안전 모드
          </Link>
        </article>

        <article
          className="detail-panel detail-panel--wide"
          id="evidence-timeline"
        >
          <header>
            <p className="eyebrow">ACTIVITY TIMELINE</p>
            <h2>최근 활동 맥락</h2>
          </header>
          {timeline.error ? (
            <p className="empty-state">활동 기록을 확인할 수 없습니다.</p>
          ) : timeline.data?.length ? (
            <ol className="timeline">
              {timeline.data.map((entry) => (
                <li key={entry.id}>
                  <span />
                  <div>
                    <strong>{entry.event_type}</strong>
                    <p>{entry.summary_code}</p>
                  </div>
                  <time dateTime={entry.occurred_at}>
                    {formatKst(entry.occurred_at)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-state">아직 타임라인 기록이 없습니다.</p>
          )}
        </article>
      </section>
    </>
  );
}
