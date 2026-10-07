import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import { ThemeControl } from "@/components/system/theme-control";

import styles from "./wallet-chrome.module.css";

const topLinks = [
  { href: "/home", label: "홈" },
  { href: "/mining", label: "채굴" },
  { href: "/products", label: "상품" },
  { href: "/wallet", label: "지갑" },
  { href: "/menu", label: "더보기" },
] as const;

const sidebarLinks = [
  { href: "/home", label: "대시보드", icon: "home" },
  { href: "/mining", label: "채굴", icon: "coins" },
  { href: "/products", label: "상품", icon: "cube" },
  { href: "/wallet", label: "지갑", icon: "wallet" },
  { href: "/menu/account", label: "계정 설정", icon: "account" },
] as const;

const walletLinks = [
  { href: "/wallet", label: "자산 현황" },
  { href: "/wallet/deposit", label: "입금" },
  { href: "/wallet?view=history", label: "거래내역" },
] as const;

function WalletTools({ displayName }: { displayName: string }) {
  return (
    <div className={styles.tools}>
      <Link href="/notifications" aria-label="알림 센터">
        <PutdukIcon name="bell" size={21} />
      </Link>
      <ThemeControl />
      <Link
        className={styles.identity}
        href="/menu/account"
        aria-label="내 계정 보기"
      >
        <span className={styles.avatar} aria-hidden="true">
          <PutdukIcon name="user" size={21} />
        </span>
        <span className={styles.identityName}>{displayName}님</span>
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
  );
}

export function WalletDesktopHeader({ displayName }: { displayName: string }) {
  return (
    <header className={styles.desktopHeader} data-wallet-header="desktop">
      <Link className={styles.brand} href="/home" aria-label="퍼뜩 채굴 홈">
        <WalletBrandSymbol />
        <span className={styles.wordmark}>PUTDUK MINING</span>
        <span className={styles.tagline}>
          TECHNOLOGY CREATES
          <br />A MORE VALUABLE TOMORROW
        </span>
      </Link>
      <nav className={styles.topNavigation} aria-label="지갑 주요 메뉴">
        {topLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.href === "/wallet" ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <WalletTools displayName={displayName} />
    </header>
  );
}

export function WalletMobileTools({ displayName }: { displayName: string }) {
  return (
    <div className={styles.mobileTools} data-wallet-header="mobile">
      <WalletTools displayName={displayName} />
    </div>
  );
}

export function WalletSidebar({ displayName }: { displayName: string }) {
  return (
    <>
      <Link
        className={styles.accountCard}
        href="/menu/account"
        aria-label="내 계정 정보 확인"
      >
        <span className={styles.accountIcon} aria-hidden="true">
          <PutdukIcon name="user" size={25} />
        </span>
        <span>
          <strong data-wallet-account-name title={displayName}>
            {displayName}님
          </strong>
          <small>내 계정</small>
        </span>
      </Link>
      <nav className={styles.sideNavigation} aria-label="지갑 전체 메뉴">
        <ul>
          {sidebarLinks.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item.href === "/wallet" ? "page" : undefined}
              >
                {item.icon === "account" ? (
                  <PutdukIcon name="shield" size={24} />
                ) : (
                  <PutdukHomeIcon name={item.icon} size={25} metallic={false} />
                )}
                <span>{item.label}</span>
              </Link>
              {item.href === "/wallet" ? (
                <ul
                  className={styles.walletSubnavigation}
                  aria-label="지갑 세부 메뉴"
                >
                  {walletLinks.map((wallet) => (
                    <li key={wallet.href}>
                      <Link href={wallet.href}>{wallet.label}</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.aiCard}>
        <BrandMark title="" />
        <strong>PUTDUK AI</strong>
        <p>궁금한 내용을 물어보세요.</p>
        <Link href="/ai">
          AI와 대화하기
          <PutdukIcon name="arrow-right" size={17} />
        </Link>
      </div>
    </>
  );
}

function WalletBrandSymbol() {
  return (
    <svg viewBox="0 0 40 56" fill="none" aria-hidden="true" focusable="false">
      <path d="M3 10 21 1l16 8-18 9L3 10Z" fill="#ffe6a0" />
      <path d="M3 10v36l16 9V18L3 10Z" fill="#b98b3c" />
      <path d="m19 18 18-9v37l-18 9V18Z" fill="#f0c66c" />
      <path d="m10 14 7 4v32l-7-4V14Z" fill="#fbe7a9" />
      <path d="m24 20 7-4v26l-7 4V20Z" fill="#31240f" />
      <path d="m3 10 18-9 16 8v37l-18 9-16-9V10Z" stroke="#f8d88c" />
    </svg>
  );
}
