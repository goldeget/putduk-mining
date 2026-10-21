import Link from "next/link";
import type { Route } from "next";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  PutdukHomeIcon,
  type PutdukHomeIconName,
} from "@/components/icons/putduk-home-icon";
import { MenuBrandSymbol } from "@/components/product/menu-brand-symbol";
import { ThemeControl } from "@/components/system/theme-control";
import styles from "./route-brand-chrome.module.css";

export type RouteChromeView = "products" | "ai" | "member";

type Destination = {
  href: Route;
  label: string;
  icon: PutdukHomeIconName;
};

const primaryDestinations = [
  { href: "/home", label: "홈", icon: "home" },
  { href: "/mining", label: "채굴", icon: "coins" },
  { href: "/products", label: "상품", icon: "cube" },
  { href: "/wallet", label: "지갑", icon: "wallet" },
  { href: "/menu", label: "더보기", icon: "more" },
] as const satisfies readonly Destination[];

function NavigationIcon({ icon }: Pick<Destination, "icon">) {
  return <PutdukHomeIcon name={icon} metallic={false} size={25} />;
}

function isActive(
  item: Destination,
  view: RouteChromeView,
  activeHref?: "/home" | "/menu",
) {
  return (
    item.href ===
    (view === "ai" ? "/ai" : view === "products" ? "/products" : activeHref)
  );
}

export function RouteBrandHeader({
  view,
  displayName,
}: {
  view: RouteChromeView;
  displayName: string;
  activeHref?: "/home" | "/menu";
}) {
  return (
    <header
      className={`product-header ${styles.header}`}
      data-route-brand-header={view}
    >
      <Link
        className={styles.brand}
        href="/home"
        aria-label="퍼뜩 채굴 홈"
        prefetch={false}
      >
        <MenuBrandSymbol idPrefix={`${view}-header-brand`} />
        <strong>
          퍼뜩 <span>채굴</span>
        </strong>
        <small>
          기술이 만드는
          <br />더 가치 있는 내일
        </small>
      </Link>
      <div className={styles.tools}>
        <ThemeControl />
        <Link href="/notifications" aria-label="알림 센터" prefetch={false}>
          <PutdukIcon name="bell" size={23} />
        </Link>
        <Link
          className={styles.account}
          href="/menu/account"
          aria-label="내 계정 보기"
          prefetch={false}
        >
          <span className={styles.avatar} aria-hidden="true">
            <PutdukIcon name="user" size={24} />
          </span>
          <span className={styles.displayName}>{displayName}</span>
          <svg
            className={styles.chevron}
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="m6 9 6 6 6-6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </Link>
      </div>
    </header>
  );
}

export function RouteBrandSidebar({
  view,
  activeHref,
}: {
  view: RouteChromeView;
  activeHref?: "/home" | "/menu";
}) {
  const destinations = primaryDestinations;
  return (
    <>
      <nav
        className={`product-navigation ${styles.sideNavigation}`}
        aria-label={
          view === "ai"
            ? "AI 전체 메뉴"
            : view === "products"
              ? "상품 전체 메뉴"
              : "주요 메뉴"
        }
      >
        {destinations.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className={
              isActive(item, view, activeHref) ? "is-active" : undefined
            }
            aria-current={isActive(item, view, activeHref) ? "page" : undefined}
          >
            <NavigationIcon icon={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className={styles.sidebarStory}>
        <p>
          기술이 만드는
          <br />더 나은 내일
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
