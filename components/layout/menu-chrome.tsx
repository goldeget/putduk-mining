import Link from "next/link";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import { MenuBrandSymbol } from "@/components/product/menu-brand-symbol";
import styles from "./menu-chrome.module.css";

const destinations = [
  { href: "/workroom", label: "홈", icon: "home" },
  { href: "/workroom/history", label: "참여 내역", icon: "coins" },
  { href: "/workroom/guide", label: "이용 안내", icon: "cube" },
  { href: "/workroom/cash", label: "실제 잔액", icon: "wallet" },
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
        href="/workroom"
        aria-label="WORKROOM 홈"
        prefetch={false}
      >
        <MenuBrandSymbol idPrefix="menu-header-brand" />
        <strong>
          WORKROOM
          <br />
          나만의 워크룸
        </strong>
        <span>
          나만의 공간에서
          <br />
          편리하게 관리해요
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
        <strong>WORKROOM</strong>
        <small>
          나만의 공간에서
          <br />
          편리하게 관리해요
        </small>
      </div>
    </>
  );
}
