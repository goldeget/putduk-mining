import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { Route } from "next";
import type { AdminPrincipal } from "@/lib/auth/principal";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { createAdminServiceClient } from "@/lib/supabase/service";
import { formatKst } from "@/app/(control)/_lib/format";
import styles from "./members.module.css";
import { signupSexLabel } from "../../../../../domain/identity/signup-birth";

const SIZE = 25;
export function memberDirectoryPage(value: string | undefined) {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page >= 1 && page <= 100000 ? page : 1;
}

async function auditRead(
  principal: AdminPrincipal,
  target: string,
  page?: number,
) {
  const result = await createAdminServiceClient()
    .from("audit_logs")
    .insert({
      actor_user_id: principal.userId,
      actor_role: principal.role,
      action: "MEMBER_REGISTRATION_VIEW",
      target_type: "USER",
      target_id: target,
      reason: "회원 가입 정보 운영 조회",
      request_id: randomUUID(),
      metadata: {
        surface: "member_directory",
        page,
        fields: [
          "login_id",
          "legal_name",
          "date_of_birth",
          "birth_sex_digit",
          "phone_e164",
          "recovery_email",
          "created_at",
          "signup_ip",
          "referral_code",
          "consents",
        ],
      },
    });
  return !result.error;
}

export async function MemberDirectory({
  principal,
  page,
}: {
  principal: AdminPrincipal;
  page: number;
}) {
  if (!HIGH_IMPACT_ROLES.includes(principal.role))
    return (
      <p className="panel-note">
        회원 가입 정보 전체 조회는 관리자 권한이 필요합니다. 회원 검색으로
        이동해 주세요.
      </p>
    );
  if (!(await auditRead(principal, "directory", page)))
    return (
      <p role="alert">조회 기록을 남기지 못했습니다. 다시 시도해 주세요.</p>
    );
  const db = createAdminServiceClient();
  const result = await db
    .from("user_identity_profiles")
    .select(
      "user_id,login_id,legal_name,date_of_birth,birth_sex_digit,phone_e164,recovery_email,created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("user_id", { ascending: false })
    .range((page - 1) * SIZE, page * SIZE - 1);
  if (result.error)
    return (
      <p role="alert">회원 목록을 불러오지 못했습니다. 새로고침해 주세요.</p>
    );
  const rows = result.data ?? [];
  const context = rows.length
    ? await db
        .from("member_registration_context")
        .select("user_id,signup_ip")
        .in(
          "user_id",
          rows.map((row) => row.user_id),
        )
    : { data: [], error: null };
  const addresses = new Map(
    (context.data ?? []).map((row) => [row.user_id, row.signup_ip]),
  );
  const total = result.count ?? 0;
  return (
    <section className={styles.directory} aria-label="가입 회원 목록">
      <header className={styles.directoryHead}>
        <div>
          <p className="eyebrow">전체 회원</p>
          <h2>가입 회원 {total.toLocaleString("ko-KR")}명</h2>
          <p>최근 가입순 · 한 페이지 25명</p>
        </div>
        <Link className="ghost-button" href={"/members" as Route}>
          새로고침
        </Link>
      </header>
      {context.error ? (
        <p role="alert">
          가입 IP를 불러오지 못했습니다. 다른 정보는 아래에서 확인할 수
          있습니다.
        </p>
      ) : null}
      {rows.length ? (
        <div className={styles.directoryScroll}>
          <table className={styles.directoryTable}>
            <caption className="sr-only">
              가입 회원의 아이디, 이름, 생년월일, 연락처, 복구 이메일, 가입
              일시, 가입 IP
            </caption>
            <thead>
              <tr>
                {[
                  "아이디 / 이름",
                  "생년월일",
                  "성별 / 구분 숫자",
                  "연락처",
                  "복구 이메일",
                  "가입 일시",
                  "가입 IP",
                  "상세",
                ].map((title) => (
                  <th key={title} scope="col">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id}>
                  <th scope="row">
                    <Link href={`/members?id=${row.user_id}` as Route}>
                      {row.login_id}
                    </Link>
                    <small>{row.legal_name}</small>
                  </th>
                  <td>{row.date_of_birth}</td>
                  <td>
                    {signupSexLabel(row.birth_sex_digit)}
                    {row.birth_sex_digit ? ` · ${row.birth_sex_digit}` : ""}
                  </td>
                  <td>{row.phone_e164}</td>
                  <td>{row.recovery_email}</td>
                  <td>{formatKst(row.created_at)}</td>
                  <td>
                    {context.error
                      ? "조회 실패"
                      : (addresses.get(row.user_id) ?? "기록 없음")}
                  </td>
                  <td>
                    <Link
                      className="text-link"
                      href={`/members?id=${row.user_id}` as Route}
                    >
                      가입 정보 보기
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">
          {page > 1
            ? "이 페이지에 회원이 없습니다."
            : "아직 가입한 회원이 없습니다."}
        </p>
      )}
      <nav className={styles.directoryHead} aria-label="회원 목록 페이지">
        <span>
          {page} / {Math.max(1, Math.ceil(total / SIZE))} 페이지
        </span>
        <div className="link-row">
          {page > 1 ? (
            <Link
              className="ghost-button"
              href={`/members?page=${page - 1}` as Route}
            >
              이전
            </Link>
          ) : null}
          {page * SIZE < total ? (
            <Link
              className="ghost-button"
              href={`/members?page=${page + 1}` as Route}
            >
              다음
            </Link>
          ) : null}
        </div>
      </nav>
    </section>
  );
}

export async function MemberRegistrationDetails({
  principal,
  userId,
}: {
  principal: AdminPrincipal;
  userId: string;
}) {
  if (!HIGH_IMPACT_ROLES.includes(principal.role)) return null;
  if (!(await auditRead(principal, userId)))
    return <p role="alert">가입 정보 조회 기록을 남기지 못했습니다.</p>;
  const db = createAdminServiceClient();
  const [identity, context, consents] = await Promise.all([
    db
      .from("user_identity_profiles")
      .select(
        "login_id,legal_name,date_of_birth,birth_sex_digit,phone_e164,recovery_email,created_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("member_registration_context")
      .select("signup_ip,ip_source,referral_code,workroom_acknowledged")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("user_consent_records")
      .select("consent_key,consent_version,granted,captured_at")
      .eq("user_id", userId)
      .eq("captured_via", "SIGNUP")
      .order("captured_at"),
  ]);
  const person = identity.data;
  const fields = [
    ["가입 아이디", person?.login_id],
    ["이름", person?.legal_name],
    ["생년월일", person?.date_of_birth],
    ["뒷자리 첫 숫자", person?.birth_sex_digit],
    ["성별", signupSexLabel(person?.birth_sex_digit)],
    ["연락처", person?.phone_e164],
    ["복구 이메일", person?.recovery_email],
    ["가입 일시", person?.created_at ? formatKst(person.created_at) : null],
    ["가입 IP", context.data?.signup_ip],
    ["추천인 코드", context.data?.referral_code],
    ["워크룸 안내 동의", context.data?.workroom_acknowledged ? "동의" : null],
  ];
  const consentLabels: Record<string, string> = {
    SERVICE_TERMS: "이용약관",
    PRIVACY: "개인정보 처리",
    MARKETING: "마케팅 수신",
  };
  return (
    <section
      className={styles.directory}
      aria-labelledby="registration-details-title"
    >
      <header className={styles.directoryHead}>
        <div>
          <p className="eyebrow">회원가입 원본 정보</p>
          <h2 id="registration-details-title">가입 정보</h2>
        </div>
        <Link className="text-link" href={"/members" as Route}>
          전체 회원 목록
        </Link>
      </header>
      {identity.error || context.error || consents.error ? (
        <p role="alert">
          일부 가입 정보를 불러오지 못했습니다. 조회되지 않은 값은 확인 불가로
          표시합니다.
        </p>
      ) : null}
      <dl className={styles.registrationGrid}>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {value ??
                ((label === "가입 IP" ||
                  label === "추천인 코드" ||
                  label === "워크룸 안내 동의") &&
                context.error
                  ? "확인 불가"
                  : identity.error
                    ? "확인 불가"
                    : "기록 없음")}
            </dd>
          </div>
        ))}
      </dl>
      <h3>가입 시 동의 내역</h3>
      {consents.error ? (
        <p>동의 내역 확인 불가</p>
      ) : consents.data?.length ? (
        <ul className={styles.consentList}>
          {consents.data.map((row, index) => (
            <li key={`${row.consent_key}-${index}`}>
              <strong>
                {consentLabels[row.consent_key] ?? "기타 동의"} ·{" "}
                {row.granted ? "동의" : "미동의"}
              </strong>
              <span>
                {row.consent_version} · {formatKst(row.captured_at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel-note">가입 동의 기록이 없습니다.</p>
      )}
      <p className="panel-note">
        과거에 수집하지 않은 가입 IP는 기록 없음으로 표시합니다. 비밀번호와
        인증코드는 조회할 수 없습니다.
      </p>
    </section>
  );
}
