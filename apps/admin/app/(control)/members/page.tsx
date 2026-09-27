import { randomUUID } from "node:crypto";
import Link from "next/link";
import { z } from "zod";

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
            정확한 회원 UUID로만 조회합니다. 비밀번호와 KYC 원문, 출금 목적지
            원문은 표시하지 않습니다.
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
        <Link className="text-link" href="/members">
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
        <article className="detail-panel">
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
                  ? new Intl.DateTimeFormat("ko-KR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Seoul",
                    }).format(new Date(authUser.data.user.last_sign_in_at))
                  : "기록 없음"}
              </dd>
            </div>
            <div>
              <dt>계정 정지</dt>
              <dd>{authUser.data.user.banned_until ? "적용 중" : "없음"}</dd>
            </div>
          </dl>
        </article>
        <article className="detail-panel">
          <header>
            <p className="eyebrow">SENSITIVE · AUDITED</p>
            <h2>KYC 상태 요약</h2>
          </header>
          {!canReadKyc ? (
            <p className="locked-state">
              현재 역할에는 KYC 조회 권한이 없습니다.
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
                <dd>
                  {new Intl.DateTimeFormat("ko-KR", {
                    dateStyle: "medium",
                    timeZone: "Asia/Seoul",
                  }).format(new Date(kyc.opened_at))}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="empty-state">KYC 접수 기록이 없습니다.</p>
          )}
        </article>
        <article className="detail-panel detail-panel--wide">
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
                    {new Intl.DateTimeFormat("ko-KR", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: "Asia/Seoul",
                    }).format(new Date(entry.occurred_at))}
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
