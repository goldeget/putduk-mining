import Link from "next/link";

import { ProductHeader } from "@/components/layout/product-header";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { StatePanel } from "@/components/ui/states";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import { requirePageUser } from "@/lib/auth/session";
import { readMemberScreenFacts } from "@/lib/product/member-screen-facts";

import styles from "./home.module.css";

export default async function HomePage() {
  const identity = await requirePageUser();
  if (!identity) return null;
  const facts = await readMemberScreenFacts(identity);

  const { data: accounts, error: walletError } = await identity.supabase
    .from("wallet_balance_snapshots")
    .select("currency, balance_atomic, available_balance_atomic")
    .eq("user_id", identity.userId)
    .order("currency");

  const krw = walletError
    ? undefined
    : accounts?.find((account) => account.currency === "KRW");
  const walletAmount = walletError
    ? "확인할 수 없어요"
    : formatAtomicAmount(
        String(krw?.available_balance_atomic ?? "0"),
        "KRW",
      ).replace(/ KRW$/, "원");

  // Check for active monitoring session
  const { data: activeSession, error: sessionError } = await identity.supabase
    .from("workroom_rounds")
    .select("id, instrument, stake, started_at, closed_at, snapshot")
    .eq("user_id", identity.userId)
    .is("closed_at", null)
    .limit(1)
    .maybeSingle();

  const hasActiveSession = !sessionError && activeSession != null;
  const partialFailure = Boolean(walletError || sessionError);

  return (
    <div
      className={styles.page}
      data-ui-ready="/home"
      data-ui-state={partialFailure ? "partial" : "ready"}
    >
      <section className={styles.hero} aria-label="모니터링 업무">
        <ProductHeader home displayName={facts.displayName} />
        <div className={styles.livingWorld}>
          <div className={`${styles.livingOverlay} ${styles.simplifiedHero}`}>
            <p className={styles.brandMark}>WORKROOM</p>
            <h1 className={styles.welcomeTitle}>
              모니터링 업무로
              <br />
              수익을 창출하세요.
            </h1>
            <p className={styles.welcomeLead}>
              가입 충전금으로 바로 시작할 수 있어요.
            </p>
            <p
              className={styles.heroBalance}
              data-home-amount="wallet"
              aria-label="사용 가능 잔액"
            >
              <span className={styles.heroBalanceLabel}>잔액</span>
              <strong
                data-home-long-amount={walletAmount.length > 14 || undefined}
              >
                {walletAmount}
              </strong>
            </p>
            <Link
              className={`button button--primary ${styles.heroPrimary}`}
              href={hasActiveSession ? "/workroom" : "/workroom/guide"}
              data-home-primary-cta
            >
              {hasActiveSession ? "모니터링 계속하기" : "모니터링 시작하기"}
              <PutdukIcon name="arrow-right" size={18} />
            </Link>
            {hasActiveSession ? (
              <p className={styles.heroStatus} data-running="true">
                모니터링 진행 중
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <div className={styles.dashboard}>
        {partialFailure ? (
          <StatePanel
            tone="error"
            title="일부 정보를 불러오지 못했어요"
            description="확인된 정보만 표시했어요. 잠시 후 다시 시도해 주세요."
          />
        ) : null}

        <section
          className={styles.simplifiedSecondary}
          aria-label="바로가기"
        >
          <Link className={styles.simplifiedSecondaryLink} href="/workroom">
            <span>
              <strong>모니터링</strong>
              <small>진행 중인 업무 확인</small>
            </span>
            <PutdukIcon name="arrow-right" size={16} />
          </Link>
          <Link className={styles.simplifiedSecondaryLink} href="/wallet">
            <span>
              <strong>지갑</strong>
              <small>잔액 및 내역</small>
            </span>
            <PutdukIcon name="arrow-right" size={16} />
          </Link>
          <Link
            className={styles.simplifiedSecondaryLink}
            href="/workroom/cash/deposit"
          >
            <span>
              <strong>입금</strong>
              <small>더 큰 금액으로 모니터링</small>
            </span>
            <PutdukIcon name="arrow-right" size={16} />
          </Link>
        </section>
      </div>
    </div>
  );
}
