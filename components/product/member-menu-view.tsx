import type { Route } from "next";
import Link from "next/link";

import { MENU_ITEMS, type MenuItem } from "@/app/(product)/menu/menu-items";
import { SemiconductorTowerScene } from "@/components/brand/semiconductor-tower-scene";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import { MenuBrandSymbol } from "@/components/product/menu-brand-symbol";
import { ThemeControl } from "@/components/system/theme-control";
import type { MemberScreenFacts } from "@/lib/product/member-screen-facts";
import {
  formatJoinedOn,
  formatLocaleLabel,
  formatScreenKrw,
} from "@/lib/product/member-screen-present";

import styles from "./member-menu-view.module.css";

const primaryDestinations = [
  "/menu/account",
  "/notifications",
  "/events",
  "/putduk-facts",
  "/support",
] as const;

function MenuLanguageIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="12" />
      <ellipse cx="16" cy="16" rx="5" ry="12" />
      <path d="M4 16h24M6 10h20M6 22h20" />
    </svg>
  );
}

function MenuSupportIcon() {
  return (
    <svg
      width="29"
      height="29"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 14v-3a8 8 0 0 1 16 0v3M19 17v1a3 3 0 0 1-3 3h-3" />
      <rect x="2" y="11" width="4" height="7" rx="2" />
      <rect x="18" y="11" width="4" height="7" rx="2" />
    </svg>
  );
}

function MenuRow({ item }: { item: MenuItem }) {
  return (
    <li>
      <Link
        className={styles.row}
        href={item.href as Route}
        aria-label={`${item.label} ${item.description}`}
        data-emphasis={item.href === "/ai" ? "help" : undefined}
      >
        <span className={styles.icon} aria-hidden="true">
          {item.href === "/events" ? (
            <PutdukHomeIcon name="gift" size={29} />
          ) : item.href === "/support" ? (
            <MenuSupportIcon />
          ) : (
            <PutdukIcon name={item.icon} size={27} />
          )}
        </span>
        <strong>{item.label}</strong>
        <small>{item.description}</small>
        <PutdukIcon className={styles.chevron} name="arrow-right" size={20} />
      </Link>
    </li>
  );
}

/** Presentation only. Identity, rank, dates and KRW remain server-read originals. */
export function MemberMenuView({ facts }: { facts: MemberScreenFacts }) {
  const primary = primaryDestinations
    .map((href) => MENU_ITEMS.find((item) => item.href === href))
    .filter((item): item is MenuItem => Boolean(item));
  const preferences = MENU_ITEMS.filter(
    (item) => !primaryDestinations.some((href) => href === item.href),
  );

  return (
    <div className={styles.page} data-ui-ready="/menu" data-ui-state="loaded">
      <div className={styles.backdrop} aria-hidden="true">
        <SemiconductorTowerScene
          priority
          sizes="(min-width: 980px) calc(100vw - 188px), 100vw"
        />
      </div>
      <header className={styles.hero}>
        <div className={styles.mobileTools} data-menu-mobile-tools="true">
          <Link href="/notifications" aria-label="알림 센터">
            <PutdukIcon name="bell" size={23} />
          </Link>
          <Link href="/menu/account" aria-label="내 계정 보기">
            <PutdukIcon name="user" size={24} />
          </Link>
        </div>
        <div className={styles.heroCopy}>
          <h1>더보기</h1>
          <p className={styles.tagline}>
            TECHNOLOGY CREATES
            <br />A MORE VALUABLE TOMORROW
          </p>
          <p className={styles.introduction}>
            내 정보와 소식, 필요한 도움을 한곳에서.
          </p>
        </div>
        <div className={styles.heroBrand} aria-hidden="true">
          <MenuBrandSymbol />
          <div>
            <strong>
              PUTDUK
              <br />
              MINING
            </strong>
            <span>
              더 빠른 오늘,
              <br />더 큰 내일
            </span>
          </div>
        </div>
      </header>

      <section className={styles.profile} aria-label="내 프로필">
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            <PutdukIcon name="user" size={42} />
          </span>
          <div className={styles.name}>
            <div className={styles.nameLine}>
              <strong>{facts.displayName}</strong>
              <span className={styles.rank}>
                {facts.rankName ?? "등급은 아직 없어요"}
              </span>
            </div>
            <p>더 좋은 내일을 함께 만들어 가요.</p>
          </div>
          <Link
            className={styles.profileLink}
            href="/menu/account"
            aria-label="내 정보 보기"
          >
            <span>내 정보 보기</span>
            <PutdukIcon name="arrow-right" size={22} />
          </Link>
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>가입일</dt>
            <dd>{formatJoinedOn(facts.joinedAt)}</dd>
          </div>
          <div>
            <dt>사용 가능</dt>
            <dd>
              {formatScreenKrw(
                facts.availableKrwAtomic,
                facts.walletUnavailable,
              )}
            </dd>
          </div>
          <div>
            <dt>누적 채굴</dt>
            <dd className={styles.unavailable}>아직 표시할 수 없어요</dd>
          </div>
        </dl>
        <div className={styles.profileArt} aria-hidden="true">
          <SemiconductorTowerScene sizes="(min-width: 1100px) 22vw, 1px" />
        </div>
      </section>

      <nav className={styles.board} aria-label="더보기 메뉴">
        <div className={styles.primaryColumn}>
          <section className={styles.panel} aria-label="정보와 소식">
            <ul className={styles.list}>
              {primary.map((item) => (
                <MenuRow key={item.href} item={item} />
              ))}
            </ul>
          </section>
          <aside className={`${styles.panel} ${styles.story}`}>
            <p>
              더 큰 가능성을 향해,
              <br />
              함께 나아갑니다.
            </p>
            <Link href="/putduk-facts">
              퍼뜩 알아보기
              <PutdukIcon name="arrow-right" size={18} />
            </Link>
          </aside>
        </div>
        <div className={styles.settingsColumn}>
          <section className={styles.panel} aria-label="계정과 화면 설정">
            <Link
              className={styles.security}
              href="/menu/account"
              aria-label="계정 보안 로그인 정보와 기기 로그아웃"
            >
              <span className={styles.icon} aria-hidden="true">
                <PutdukIcon name="shield" size={30} />
              </span>
              <span>
                <strong>계정 보안</strong>
                <small>로그인 정보와 기기 로그아웃을 확인해요.</small>
              </span>
              <PutdukIcon
                className={styles.chevron}
                name="arrow-right"
                size={20}
              />
            </Link>
            <div className={styles.theme}>
              <span className={styles.icon} aria-hidden="true">
                <PutdukIcon name="spark" size={29} />
              </span>
              <ThemeControl />
            </div>
          </section>
          <section className={styles.panel} aria-label="알림과 이용 설정">
            <p className={styles.language}>
              <span className={styles.icon} aria-hidden="true">
                <MenuLanguageIcon />
              </span>
              <span>언어</span>
              <strong>{formatLocaleLabel(facts.locale)}</strong>
            </p>
            <ul className={styles.list}>
              {preferences.map((item) => (
                <MenuRow key={item.href} item={item} />
              ))}
            </ul>
          </section>
          <aside
            className={`${styles.panel} ${styles.membership}`}
            aria-label="내 등급 안내"
          >
            <span className={styles.icon} aria-hidden="true">
              <PutdukIcon name="user" size={29} />
            </span>
            <div>
              <strong>{facts.rankName ?? "등급 안내"}</strong>
              <p>
                {facts.rankName
                  ? "이 등급이 적용되어 있어요."
                  : "적용된 등급이 아직 없어요."}
              </p>
            </div>
          </aside>
        </div>
      </nav>
      <footer className={styles.footer}>
        <span aria-hidden="true" />
        <strong>PUTDUK MINING</strong>
        <span aria-hidden="true" />
        <p>TECHNOLOGY CREATES A MORE VALUABLE TOMORROW</p>
      </footer>
    </div>
  );
}
