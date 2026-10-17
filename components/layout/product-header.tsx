import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { MiningBrandSymbol } from "@/components/product/mining-brand-symbol";
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
  { href: "/menu", label: "더보기", icon: "more" },
] as const;

function MiningHeader({ displayName }: { displayName: string }) {
  return (
    <header className={styles.miningHeader} data-mining-header>
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
    <header
      className={`product-header ${home ? styles.homeHeader : ""}`}
      aria-label={home ? "퍼뜩 채굴 홈" : "회원 메뉴"}
      data-header-mode={home ? "home" : "member"}
    >
      <Link
        className={`product-header__brand ${home ? styles.homeBrand : "brand-lockup"}`}
        href="/home"
        aria-label="퍼뜩 채굴 홈"
      >
        {home ? (
          <>
            <MiningBrandSymbol />
            <span className={styles.homeWordmark}>
              <strong>퍼뜩 채굴</strong>
              <small>프리미엄 채굴 플랫폼</small>
            </span>
          </>
        ) : (
          <>
            <BrandMark title="" />
            <span>
              <strong>퍼뜩 채굴</strong>
            </span>
          </>
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
              <PutdukHomeIcon name={item.icon} size={20} metallic={false} />
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
