import {
  logoutAction,
  logoutAllAction,
} from "@/app/(product)/menu/account/actions";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PageHeading } from "@/components/product/page-heading";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { requirePageUser } from "@/lib/auth/session";

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "등록됨";
  return `${name.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
}

function maskPhone(phone: string) {
  return phone.length >= 4 ? `••• •••• ${phone.slice(-4)}` : "등록됨";
}

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
    <>
      <PageHeading
        eyebrow="ACCOUNT & SECURITY"
        title="내 계정과 로그인 기기를 안전하게 관리하세요."
        lead="아이디와 복구 수단을 확인하고, 이 기기 또는 모든 기기의 세션을 종료할 수 있습니다."
      />

      {logoutFailed ? (
        <StatePanel
          tone="error"
          title="로그아웃을 완료하지 못했어요"
          description="연결 상태를 확인한 뒤 다시 시도해 주세요. 이 화면을 닫는 것만으로는 로그아웃되지 않습니다."
        />
      ) : null}

      {error || !account ? (
        <StatePanel
          tone="error"
          title="계정 정보를 불러오지 못했어요"
          description="잠시 후 다시 확인해 주세요. 로그아웃 기능은 아래에서 계속 사용할 수 있습니다."
        />
      ) : (
        <section className="account-profile" aria-label="계정 정보">
          <Surface as="article" tone="raised">
            <PutdukIcon name="user" size={24} />
            <div>
              <small>로그인 아이디</small>
              <strong>{account.login_id}</strong>
            </div>
          </Surface>
          <Surface as="article">
            <div>
              <small>이름</small>
              <strong>{account.legal_name}</strong>
            </div>
            <div>
              <small>휴대전화</small>
              <strong>{maskPhone(account.phone_e164)}</strong>
            </div>
            <div>
              <small>복구 이메일</small>
              <strong>{maskEmail(account.recovery_email)}</strong>
            </div>
          </Surface>
        </section>
      )}

      <Surface as="section" className="account-sessions">
        <div>
          <p className="eyebrow">SESSION CONTROL</p>
          <h2>로그아웃</h2>
          <p>
            공용 기기라면 모든 기기 로그아웃을 사용하고 비밀번호도 변경해
            주세요. 다른 기기의 이미 발급된 접근 토큰은 최대 1시간 동안 유효할
            수 있어요.
          </p>
        </div>
        <div>
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
    </>
  );
}
