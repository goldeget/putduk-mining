import Link from "next/link";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import { MenuBrandSymbol } from "@/components/product/menu-brand-symbol";
import styles from "./menu-chrome.module.css";

const destinations = [
  { href: "/home", label: "홈", icon: "home" },
  { href: "/mining", label: "채굴", icon: "coins" },
  { href: "/products", label: "상품", icon: "cube" },
  { href: "/wallet", label: "지갑", icon: "wallet" },
  { href: "/menu", label: "더보기", icon: "more" },
] as const;

export function MenuHeader({ displayName }: { displayName: string }) {
  return (
    <header
      className={`product-header ${styles.header}`}
      data-menu-header="true"
    >
      <Link
        className={styles.brand}
        href="/home"
        aria-label="퍼뜩 채굴 홈"
        prefetch={false}
      >
        <MenuBrandSymbol idPrefix="menu-header-brand" />
        <strong>
          퍼뜩
          <br />
          채굴
        </strong>
        <span>
          기술이 만드는
          <br />더 가치 있는 내일
        </span>
      </Link>
      <nav className={styles.topNavigation} aria-label="더보기 주요 메뉴">
        {destinations.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={item.href === "/menu" ? "page" : undefined}
          >
            <PutdukHomeIcon name={item.icon} metallic={false} size={24} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className={styles.tools}>
        <Link href="/notifications" aria-label="알림 센터" prefetch={false}>
          <PutdukIcon name="bell" size={23} />
        </Link>
        <Link
          className={styles.account}
          href="/menu/account"
          aria-label="내 계정 보기"
          prefetch={false}
        >
          <PutdukIcon name="user" size={24} />
          <span>{displayName}</span>
          <PutdukIcon name="arrow-right" size={17} />
        </Link>
      </div>
    </header>
  );
}

export function MenuSidebar() {
  return (
    <>
      <nav
        className={`product-navigation ${styles.sideNavigation}`}
        aria-label="주요 메뉴"
      >
        {destinations.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className={item.href === "/menu" ? "is-active" : undefined}
            aria-current={item.href === "/menu" ? "page" : undefined}
          >
            <PutdukHomeIcon name={item.icon} metallic={false} size={25} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className={styles.sidebarStory}>
        <p>
          더 빠른 오늘,
          <br />더 큰 내일
        </p>
        <strong>퍼뜩 채굴</strong>
        <small>
          기술이 만드는
          <br />더 가치 있는 내일
        </small>
      </div>
    </>
  );
}
