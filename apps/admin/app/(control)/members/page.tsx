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

import {
  anyMemberCountFailed,
  countMemberMiningSessions,
  memberCountLabel,
} from "./_lib/member-evidence";
import styles from "./members.module.css";
import {
  presentMemberLifecycle,
  presentMemberProfile,
} from "./_lib/member-state-display";
import {
  presentAdminMiningFunding,
  resolveMiningServerDisplayRead,
} from "./_lib/mining-funding-display";
import { presentMemberMoneySources } from "./_lib/money-source-display";
import {
  ADDITIONAL_REVIEW_RECORD_LABEL,
  memberRiskSeverityLabel,
  memberTimelineEventLabel,
  memberTimelineSummaryLabel,
} from "../_lib/member-record-labels";

const memberIdSchema = z.uuid();

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
      <div
        className={styles.membersPage}
        data-ui-ready="/members"
        data-ui-state={id ? "error" : "empty"}
      >
        <section className="page-intro">
          <p className="eyebrow">회원 한눈에</p>
          <h1>회원 한 사람의 맥락</h1>
          <p>
            정확한 회원 식별자로만 조회합니다. 비밀번호·문서 원문·출금 목적지
            원문은 보이지 않습니다.
          </p>
        </section>
        <form className="member-search" method="get" action="/members">
          <label htmlFor="member-id">회원 식별자</label>
          <div>
            <input
              id="member-id"
              name="id"
              defaultValue={id ?? ""}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <button className="gold-button" type="submit">
              안전 조회
            </button>
          </div>
          {id ? (
            <p className="form-error" role="alert">
              올바른 회원 식별자를 입력해 주세요.
            </p>
          ) : null}
        </form>
        <section className="member-empty">
          <span aria-hidden="true">360°</span>
          <h2>조회할 회원을 선택하세요.</h2>
          <p>
            이름이나 전화번호로 검색하지 않습니다. 정확한 식별자만 받습니다.
          </p>
        </section>
      </div>
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
    moneySources,
    miningFunding,
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
    countMemberMiningSessions(db, userId),
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
    db
      .from("money_source_summaries")
      .select(
        "user_id,schema_version,coverage,unclassified_wallet_entries,unconnected_withdrawals,unclassified_journals,invalid_source_receipts,eligible_principal_atomic,recorded_krw_principal_deposits_atomic,recorded_usdt_principal_credits_atomic,recorded_bonus_atomic,observed_at,capture_started_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    db.rpc("read_own_mining_server_display", { p_user_id: userId }),
  ]);

  const authError = authUser.error as {
    status?: number;
    code?: string;
    message?: string;
  } | null;
  const userMissing =
    !authUser.data.user &&
    (!authError ||
      authError.status === 404 ||
      authError.code === "user_not_found" ||
      /user not found/i.test(authError.message ?? ""));
  if (authError || !authUser.data.user) {
    return (
      <div
        className={styles.membersPage}
        data-ui-ready="/members"
        data-ui-state={userMissing ? "empty" : "error"}
      >
        <section className="page-intro">
          <p className="eyebrow">회원 한눈에</p>
          <h1>
            {userMissing
              ? "회원을 찾지 못했습니다."
              : "회원 정보를 확인하지 못했습니다."}
          </h1>
          <p>
            식별자를 다시 확인해 주세요. 존재 여부 외의 정보는 표시하지
            않습니다.
          </p>
        </section>
        <div className={styles.lookupActions}>
          <Link className="text-link" href={"/members" as Route}>
            다시 조회
          </Link>
        </div>
      </div>
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
      reason: "회원 한눈보기에서 본인 확인 상태 요약 조회",
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
    ["체험 시작", trial],
    ["채굴 · 정산", mining],
    ["지갑 · 거래", wallet],
    ["입금", deposits],
    ["출금", withdrawals],
    ["이벤트", events],
    ["알림", notifications],
    ["운영 도우미", ai],
    ["보안 이벤트", security],
  ] as const;

  // event_participants·notifications는 service_role SELECT가 아직 없다.
  // 항상 배너를 띄우지 않고, 권한 있는 모듈 실패만 복구 안내한다.
  const countFailed = anyMemberCountFailed([
    trial,
    mining,
    wallet,
    deposits,
    withdrawals,
    ai,
    security,
  ]);
  const evidenceFailed = Boolean(
    timeline.error ||
    depositRows.error ||
    withdrawalRows.error ||
    riskFlags.error ||
    profile.error ||
    lifecycle.error,
  );
  const lifecycleDisplay = presentMemberLifecycle(lifecycle);
  const profileDisplay = presentMemberProfile(profile);
  const moneyDisplay = presentMemberMoneySources(moneySources, userId);
  const principalLots =
    miningFunding.error || miningFunding.data == null
      ? await db
          .from("funding_principal_lots")
          .select("id")
          .eq("user_id", userId)
          .limit(1)
      : null;
  const fundingDisplay = presentAdminMiningFunding(
    resolveMiningServerDisplayRead(miningFunding, principalLots),
  );

  return (
    <div
      className={styles.membersPage}
      data-ui-ready="/members"
      data-ui-state={
        countFailed ||
        evidenceFailed ||
        kycAccessFailed ||
        !lifecycleDisplay.available ||
        !profileDisplay.available ||
        !moneyDisplay.available ||
        !moneyDisplay.complete ||
        fundingDisplay.state === "unavailable"
          ? "partial"
          : "loaded"
      }
    >
      <section className="member-identity">
        <div className="member-avatar">{profileDisplay.avatar}</div>
        <div>
          <p className="eyebrow">회원 한눈에 · 확인된 식별자</p>
          <h1>{profileDisplay.name}</h1>
          <code>{userId}</code>
        </div>
        <div className="member-state">
          <span>현재 여정</span>
          <strong>{lifecycleDisplay.stage}</strong>
          <small>
            가입{" "}
            {new Intl.DateTimeFormat("ko-KR", {
              dateStyle: "medium",
              timeZone: "Asia/Seoul",
            }).format(new Date(authUser.data.user.created_at))}
          </small>
        </div>
      </section>

      {countFailed ||
      evidenceFailed ||
      !lifecycleDisplay.available ||
      !profileDisplay.available ? (
        <p className={styles.partialAlert} role="alert">
          일부 운영 증거를 불러오지 못했습니다. 숫자는 0으로 바꾸지 않습니다.{" "}
          <Link href={`/members?id=${userId}` as Route}>다시 불러오기</Link>
        </p>
      ) : null}

      <nav className="member-anchors" aria-label="증거 구역">
        <a href="#evidence-account">계정</a>
        <a href="#evidence-kyc">본인 확인</a>
        <a href="#evidence-money">입출금</a>
        <a href="#evidence-money-sources">원금 · 수익</a>
        <a href="#evidence-risk">위험</a>
        <a href="#evidence-timeline">활동</a>
      </nav>

      <section className="member-module-grid">
        {modules.map(([label, result]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{memberCountLabel(result)}</strong>
            <small>연결된 기록</small>
          </article>
        ))}
      </section>

      <section className="member-detail-grid">
        <article
          className="detail-panel detail-panel--wide"
          id="evidence-money-sources"
        >
          <header>
            <p className="eyebrow">원금 · 채굴 수익 · 보너스</p>
            <h2>자금 구분</h2>
          </header>
          {!moneyDisplay.available ? (
            <p className={styles.partialAlert} role="status">
              자금 구분을 확인하지 못했습니다. 다시 불러와 주세요.
            </p>
          ) : !moneyDisplay.complete ? (
            <p className={styles.partialAlert} role="status">
              거래의 자금 출처를 확인해야 합니다. 채굴 인정 원금은 아직 확정하지
              않았어요.
            </p>
          ) : null}
          <dl className={styles.sourceStats}>
            {moneyDisplay.rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>원금과 대기 수익</h3>
          {fundingDisplay.state === "empty" ? (
            <p className="panel-note">원금과 대기 수익은 아직 없어요.</p>
          ) : (
            <>
              {fundingDisplay.state === "unavailable" ? (
                <p className={styles.partialAlert} role="status">
                  원금과 대기 수익을 확인하지 못했습니다. 다시 불러와 주세요.
                </p>
              ) : null}
              <dl className={styles.sourceStats}>
                {fundingDisplay.rows.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                    {row.tone === "unconfirmed" ? (
                      <p className="panel-note">확정된 수익이 아니에요.</p>
                    ) : null}
                  </div>
                ))}
              </dl>
            </>
          )}
          <p className="panel-note">
            대기 수익과 아직 확정 전 금액은 원금에 포함하지 않아요.
          </p>
          <h3>등급 · 용량 · 속도</h3>
          {fundingDisplay.miningRows.length === 0 ? (
            <p className="panel-note">등급과 용량, 속도는 아직 없어요.</p>
          ) : (
            <dl className={styles.sourceStats}>
              {fundingDisplay.miningRows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="panel-note">용량과 속도는 원금이 아니에요.</p>
          <h3>채굴 주기</h3>
          {fundingDisplay.cycleRows.length === 0 ? (
            <p className="panel-note">채굴 주기는 아직 없어요.</p>
          ) : (
            <dl className={styles.sourceStats}>
              {fundingDisplay.cycleRows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="panel-note">주기는 원금이 아니에요.</p>
          <p className="panel-note">
            채굴 수익과 보너스는 원금에 포함하지 않아요.
          </p>
          {moneyDisplay.available && !moneyDisplay.complete ? (
            <div className={styles.recordedSources}>
              <h3>기록 시작 이후 확인된 입금</h3>
              <dl>
                <div>
                  <dt>원화 원금 입금</dt>
                  <dd>{moneyDisplay.recordedKrwDeposits}</dd>
                </div>
                <div>
                  <dt>USDT 환산 원금</dt>
                  <dd>{moneyDisplay.recordedUsdtCredits}</dd>
                </div>
              </dl>
              <p className="panel-note">
                이 금액은 전체 누적 입금과 다를 수 있어요.
              </p>
            </div>
          ) : null}
          {moneyDisplay.observedAt ? (
            <p className="panel-note">
              조회 시각 · {formatKst(moneyDisplay.observedAt)}
            </p>
          ) : null}
          <Link className="text-link" href={`/members?id=${userId}` as Route}>
            다시 불러오기
          </Link>
        </article>
        <article className="detail-panel" id="evidence-account">
          <header>
            <p className="eyebrow">계정</p>
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
              <dd>{lifecycleDisplay.firstFunding}</dd>
            </div>
            <div>
              <dt>환영 출금</dt>
              <dd>{lifecycleDisplay.welcomeWithdrawal}</dd>
            </div>
          </dl>
          <p className="locked-state">
            비밀번호·세션 토큰·가장하기 제어는 제공하지 않습니다.
          </p>
        </article>

        <article className="detail-panel" id="evidence-kyc">
          <header>
            <p className="eyebrow">민 · 감사 기록</p>
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

        <article
          className="detail-panel detail-panel--wide"
          id="evidence-money"
        >
          <header>
            <p className="eyebrow">입출금 증거</p>
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
            <p className="eyebrow">위험</p>
            <h2>위험 신호</h2>
          </header>
          {riskFlags.error ? (
            <p className="empty-state">위험 신호를 확인할 수 없습니다.</p>
          ) : riskFlags.data?.length ? (
            <ul className="evidence-list">
              {riskFlags.data.map((row) => (
                <li key={row.id}>
                  <strong>
                    {ADDITIONAL_REVIEW_RECORD_LABEL} ·{" "}
                    {memberRiskSeverityLabel(row.severity)}
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
            <p className="eyebrow">활동</p>
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
                    <strong>
                      {memberTimelineEventLabel(entry.event_type)}
                    </strong>
                    <p>{memberTimelineSummaryLabel(entry.summary_code)}</p>
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
    </div>
  );
}
