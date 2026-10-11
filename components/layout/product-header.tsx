import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import { ThemeControl } from "@/components/system/theme-control";

import { WalletDesktopHeader, WalletMobileTools } from "./wallet-chrome";

import styles from "./product-shell.module.css";

const homeTopLinks = [
  { href: "/home", label: "홈", icon: "home" },
  { href: "/mining", label: "채굴", icon: "coins" },
  { href: "/products", label: "상품", icon: "cube" },
  { href: "/wallet", label: "지갑", icon: "wallet" },
  { href: "/events", label: "이벤트", icon: "gift" },
  { href: "/ai", label: "PUTDUK AI", icon: "ai" },
] as const;

const miningTopLinks = [
  { href: "/mining", label: "채굴" },
  { href: "/products", label: "상품" },
  { href: "/wallet", label: "지갑" },
  { href: "/wallet?view=history", label: "거래내역" },
  { href: "/support", label: "고객센터" },
] as const;

function MiningHeader({ displayName }: { displayName: string }) {
  return (
    <header className={styles.miningHeader} data-mining-header>
      <p className={styles.miningMotto}>
        작은 한 걸음이
        <br />더 큰 가치를 만듭니다.
      </p>
      <nav className={styles.miningTopNavigation} aria-label="채굴 주요 메뉴">
        {miningTopLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.href === "/mining" ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className={styles.miningHeaderTools}>
        <Link href="/notifications" aria-label="알림 센터">
          <PutdukIcon name="bell" size={21} />
        </Link>
        <ThemeControl />
        <Link
          className={styles.miningIdentity}
          href="/menu/account"
          aria-label="내 계정 보기"
        >
          <span className={styles.miningAvatar} aria-hidden="true">
            <PutdukIcon name="user" size={20} />
          </span>
          <span className={styles.miningIdentityName}>{displayName}님</span>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m6 9 6 6 6-6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <Link className={styles.miningMenu} href="/menu" aria-label="더보기">
          <PutdukIcon name="menu" size={23} />
        </Link>
      </div>
    </header>
  );
}

export function ProductHeader({
  displayName,
  home = false,
  mining = false,
  wallet,
}: {
  displayName: string;
  home?: boolean;
  mining?: boolean;
  wallet?: "desktop" | "mobile";
}) {
  if (wallet === "desktop")
    return <WalletDesktopHeader displayName={displayName} />;
  if (wallet === "mobile")
    return <WalletMobileTools displayName={displayName} />;
  if (mining) return <MiningHeader displayName={displayName} />;
  return (
    <header className={`product-header ${home ? styles.homeHeader : ""}`}>
      <Link
        className={`product-header__brand ${home ? styles.homeBrand : ""}`}
        href="/home"
        aria-label="퍼뜩 채굴 홈"
      >
        {home ? (
          <>
            <svg viewBox="0 0 40 56" fill="none" aria-hidden="true">
              <path d="M3 10 21 1l16 8-18 9L3 10Z" fill="#ffe6a0" />
              <path d="M3 10v36l16 9V18L3 10Z" fill="#b98b3c" />
              <path d="m19 18 18-9v37l-18 9V18Z" fill="#f0c66c" />
              <path d="m10 14 7 4v32l-7-4V14Z" fill="#fbe7a9" />
              <path d="m24 20 7-4v26l-7 4V20Z" fill="#31240f" />
              <path d="m3 10 18-9 16 8v37l-18 9-16-9V10Z" stroke="#f8d88c" />
            </svg>
            <span className={styles.homeWordmarkDark}>
              <strong>PUTDUK</strong>
              <small>
                TECHNOLOGY CREATES
                <br />A MORE VALUABLE TOMORROW
              </small>
            </span>
            <span className={styles.homeWordmarkLight}>
              <strong>퍼뜩 채굴</strong>
              <small>프리미엄 채굴 플랫폼</small>
            </span>
          </>
        ) : (
          <BrandMark title="퍼뜩 채굴" />
        )}
      </Link>
      {home ? (
        <nav className={styles.homeTopNavigation} aria-label="홈 주요 메뉴">
          {homeTopLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.href === "/home" ? "page" : undefined}
            >
              {item.icon === "ai" ? (
                <PutdukIcon name="ai" size={20} />
              ) : (
                <PutdukHomeIcon name={item.icon} size={20} metallic={false} />
              )}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="product-header__tools">
        <Link
          className="product-header__notification"
          href="/notifications"
          aria-label="알림 센터"
        >
          <PutdukIcon name="bell" size={19} />
        </Link>
        <ThemeControl />
        {home ? (
          <Link
            className={`product-header__identity ${styles.homeIdentity}`}
            href="/menu/account"
            aria-label="내 계정 보기"
          >
            <span className="product-header__avatar" aria-hidden="true">
              <PutdukIcon name="user" size={18} />
            </span>
            <span>{displayName}님</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m6 9 6 6 6-6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        ) : (
          <div className="product-header__identity">
            <span>
              <small>회원</small>
              {displayName}
            </span>
            <span className="product-header__avatar" aria-hidden="true">
              <PutdukIcon name="user" size={18} />
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
