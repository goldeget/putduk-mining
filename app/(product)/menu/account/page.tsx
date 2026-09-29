import Link from "next/link";

import {
  logoutAction,
  logoutAllAction,
} from "@/app/(product)/menu/account/actions";
import {
  maskEmail,
  maskPhone,
} from "@/app/(product)/menu/account/account-mask";
import menuStyles from "@/app/(product)/menu/menu.module.css";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PageHeading } from "@/components/product/page-heading";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { requirePageUser } from "@/lib/auth/session";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ logout?: string }>;
}) {
  const logoutFailed = (await searchParams).logout === "failed";
  const identity = await requirePageUser("/menu/account");
  const { data: account, error } = await identity.supabase
    .from("user_identity_profiles")
    .select("login_id, legal_name, phone_e164, recovery_email, created_at")
    .eq("user_id", identity.userId)
    .maybeSingle();

  return (
    <div className={menuStyles.accountPage}>
      <Link className={menuStyles.backLink} href="/menu">
        <PutdukIcon name="arrow-right" size={16} aria-hidden="true" />
        내 퍼뜩으로
      </Link>

      <PageHeading
        eyebrow="계정"
        title="내 계정"
        lead="로그인 정보와 기기 로그아웃을 관리해요."
      />

      {logoutFailed ? (
        <StatePanel
          tone="error"
          title="로그아웃을 완료하지 못했어요"
          description="연결을 확인한 뒤 다시 시도해 주세요."
          action={
            <Link className="button button--secondary" href="/menu/account">
              다시 시도
            </Link>
          }
        />
      ) : null}

      {error || !account ? (
        <StatePanel
          tone="error"
          title="계정 정보를 불러오지 못했어요"
          description="잠시 후 다시 확인해 주세요. 로그아웃은 아래에서 가능해요."
          action={
            <Link className="button button--secondary" href="/menu/account">
              다시 불러오기
            </Link>
          }
        />
      ) : (
        <section className={menuStyles.profile} aria-label="계정 정보">
          <Surface
            as="article"
            className={`${menuStyles.profileCard} ${menuStyles.profileCardPrimary}`}
            tone="raised"
          >
            <PutdukIcon name="user" size={24} />
            <div className={menuStyles.profileField}>
              <small>로그인 아이디</small>
              <strong>{account.login_id}</strong>
            </div>
          </Surface>
          <Surface as="article" className={menuStyles.profileCard}>
            <div className={menuStyles.profileField}>
              <small>이름</small>
              <strong>{account.legal_name}</strong>
            </div>
            <div className={menuStyles.profileField}>
              <small>휴대전화</small>
              <strong>{maskPhone(account.phone_e164)}</strong>
            </div>
            <div className={menuStyles.profileField}>
              <small>복구 이메일</small>
              <strong>{maskEmail(account.recovery_email)}</strong>
            </div>
          </Surface>
        </section>
      )}

      <Surface as="section" className={menuStyles.sessions} aria-label="로그아웃">
        <div className={menuStyles.sessionsCopy}>
          <p className="eyebrow">로그아웃</p>
          <h2>기기에서 나가기</h2>
          <p>
            공용 기기라면 모든 기기 로그아웃을 권해요. 다른 기기는 최대 1시간
            안에 반영될 수 있어요.
          </p>
        </div>
        <div className={menuStyles.sessionsActions}>
          <form action={logoutAction} aria-label="이 기기 로그아웃">
            <button className="button button--secondary" type="submit">
              이 기기에서 로그아웃
            </button>
          </form>
          <form action={logoutAllAction} aria-label="모든 기기 로그아웃">
            <button className="button button--danger" type="submit">
              모든 기기에서 로그아웃
            </button>
          </form>
        </div>
      </Surface>
    </div>
  );
}
