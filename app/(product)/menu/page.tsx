import type { Route } from "next";
import Link from "next/link";

import { MENU_ITEMS } from "@/app/(product)/menu/menu-items";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ThemeControl } from "@/components/system/theme-control";
import { requirePageUser } from "@/lib/auth/session";
import { readMemberScreenFacts } from "@/lib/product/member-screen-facts";
import {
  formatJoinedOn,
  formatLocaleLabel,
  formatScreenKrw,
} from "@/lib/product/member-screen-present";

import styles from "./menu.module.css";

function MenuList({
  items,
}: {
  items: readonly (typeof MENU_ITEMS)[number][];
}) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.href}>
          <Link
            className={styles.row}
            data-emphasis={item.href === "/ai" ? "help" : undefined}
            href={item.href as Route}
          >
            <span className={styles.icon}>
              <PutdukIcon name={item.icon} size={21} />
            </span>
            <span className={styles.copy}>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
            <PutdukIcon
              className={styles.chevron}
              name="arrow-right"
              size={19}
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function MenuPage() {
  const identity = await requirePageUser("/menu");
  const facts = await readMemberScreenFacts(identity);
  const links = MENU_ITEMS.filter((item) => item.lane === "links");
  const settings = MENU_ITEMS.filter((item) => item.lane === "settings");

  return (
    <div className={styles.page} data-ui-ready="/menu" data-ui-state="loaded">
      <section className={styles.member} aria-label="내 프로필">
        <div className={styles.memberIdentity}>
          <span className={styles.memberMark} aria-hidden="true">
            <PutdukIcon name="user" size={22} />
          </span>
          <div>
            <strong>{facts.displayName}</strong>
            <p>{facts.rankName ?? "등급은 아직 없어요"}</p>
          </div>
        </div>
        <dl className={styles.memberStats}>
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
            <dd>아직 표시할 수 없어요</dd>
          </div>
        </dl>
      </section>

      <header className={styles.hero}>
        <div className={styles.heroVisual} aria-hidden="true">
          <picture>
            <source
              type="image/avif"
              srcSet="/brand/worlds/orbital-earth-960-v1.avif"
            />
            <img
              src="/brand/worlds/orbital-earth-960-v1.webp"
              alt=""
              width="960"
              height="540"
              decoding="async"
            />
          </picture>
        </div>
        <div className={styles.heroCopy}>
          <p className="eyebrow">더보기</p>
          <h1>더보기</h1>
          <p>내 정보, 알림, 고객지원을 한곳에서 확인하세요.</p>
        </div>
      </header>

      {/* 알림 설정과 퍼뜩 AI도 이 메뉴 안에 둔다. 다른 내비로 나누면 허브에서 찾지 못한다. */}
      <nav className={styles.board} aria-label="더보기 메뉴">
        <section className={styles.panel}>
          <MenuList items={links} />
        </section>
        <section className={styles.panel}>
          <div className={styles.preferences}>
            <ThemeControl />
            <p className={styles.language}>
              <span>언어</span>
              <strong>{formatLocaleLabel(facts.locale)}</strong>
            </p>
          </div>
          <MenuList items={settings} />
        </section>
      </nav>

      <aside className={styles.membership}>
        <strong>{facts.rankName ?? "등급"}</strong>
        <p>
          {facts.rankName
            ? "이 등급이 적용되어 있어요."
            : "적용된 등급이 아직 없어요."}
        </p>
      </aside>
    </div>
  );
}
