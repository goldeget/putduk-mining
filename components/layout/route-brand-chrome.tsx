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

export type RouteChromeView = "products" | "ai";

type Destination = {
  href: Route;
  label: string;
  icon: PutdukHomeIconName | "ai" | "support";
};

const primaryDestinations = [
  { href: "/home", label: "홈", icon: "home" },
  { href: "/mining", label: "채굴", icon: "coins" },
  { href: "/products", label: "상품", icon: "cube" },
  { href: "/wallet", label: "지갑", icon: "wallet" },
  { href: "/menu", label: "더보기", icon: "more" },
] as const satisfies readonly Destination[];

const aiDestinations = [
  primaryDestinations[0],
  { href: "/ai", label: "퍼뜩 AI", icon: "ai" },
  primaryDestinations[1],
  primaryDestinations[2],
  primaryDestinations[3],
  { href: "/events", label: "이벤트", icon: "gift" },
  { href: "/support", label: "고객지원", icon: "support" },
  primaryDestinations[4],
] as const satisfies readonly Destination[];

function NavigationIcon({ icon }: Pick<Destination, "icon">) {
  if (icon === "ai") return <PutdukIcon name="ai" size={25} />;
  if (icon === "support") {
    return (
      <svg
        width="25"
        height="25"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M4 14v-3a8 8 0 0 1 16 0v3M19 17v1a3 3 0 0 1-3 3h-3" />
        <rect x="2" y="11" width="4" height="7" rx="2" />
        <rect x="18" y="11" width="4" height="7" rx="2" />
      </svg>
    );
  }
  return <PutdukHomeIcon name={icon} metallic={false} size={25} />;
}

function isActive(item: Destination, view: RouteChromeView) {
  return item.href === (view === "ai" ? "/ai" : "/products");
}

export function RouteBrandHeader({
  view,
  displayName,
}: {
  view: RouteChromeView;
  displayName: string;
}) {
  return (
    <header
      className={`product-header ${styles.header}`}
      data-route-brand-header={view}
    >
      <Link className={styles.brand} href="/home" aria-label="퍼뜩 채굴 홈">
        <MenuBrandSymbol idPrefix={`${view}-header-brand`} />
        <strong>
          PUTDUK <span>MINING</span>
        </strong>
        <small>
          TECHNOLOGY CREATES
          <br />A MORE VALUABLE TOMORROW
        </small>
      </Link>
      {view === "products" ? (
        <nav className={styles.topNavigation} aria-label="상품 주요 메뉴">
          {primaryDestinations.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item, view) ? "page" : undefined}
            >
              <NavigationIcon icon={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      ) : null}
      <div className={styles.tools}>
        <ThemeControl />
        <Link href="/notifications" aria-label="알림 센터">
          <PutdukIcon name="bell" size={23} />
        </Link>
        <Link
          className={styles.account}
          href="/menu/account"
          aria-label="내 계정 보기"
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

export function RouteBrandSidebar({ view }: { view: RouteChromeView }) {
  const destinations = view === "ai" ? aiDestinations : primaryDestinations;
  return (
    <>
      <nav
        className={`product-navigation ${styles.sideNavigation}`}
        aria-label={view === "ai" ? "AI 전체 메뉴" : "상품 전체 메뉴"}
      >
        {destinations.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isActive(item, view) ? "is-active" : undefined}
            aria-current={isActive(item, view) ? "page" : undefined}
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
        <strong>PUTDUK MINING</strong>
        <small>
          TECHNOLOGY CREATES
          <br />A MORE VALUABLE TOMORROW
        </small>
      </div>
    </>
  );
}
