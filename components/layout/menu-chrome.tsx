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
      <Link className={styles.brand} href="/home" aria-label="퍼뜩 채굴 홈">
        <MenuBrandSymbol />
        <strong>
          PUTDUK
          <br />
          MINING
        </strong>
        <span>
          TECHNOLOGY CREATES
          <br />A MORE VALUABLE TOMORROW
        </span>
      </Link>
      <nav className={styles.topNavigation} aria-label="더보기 주요 메뉴">
        {destinations.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.href === "/menu" ? "page" : undefined}
          >
            <PutdukHomeIcon name={item.icon} metallic={false} size={24} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className={styles.tools}>
        <Link href="/notifications" aria-label="알림 센터">
          <PutdukIcon name="bell" size={23} />
        </Link>
        <Link
          className={styles.account}
          href="/menu/account"
          aria-label="내 계정 보기"
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
          HIGHER
          <br />
          BANDWIDTH
          <br />A BRIGHTER
          <br />
          TOMORROW
        </p>
        <strong>PUTDUK MINING</strong>
        <small>
          TECHNOLOGY CREATES
          <br />A MORE VALUABLE TOMORROW
        </small>
      </div>
    </>
  );
}
