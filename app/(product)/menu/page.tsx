import type { Route } from "next";
import Link from "next/link";

import { MENU_ITEMS } from "@/app/(product)/menu/menu-items";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import { Surface } from "@/components/ui/surface";
import { requirePageUser } from "@/lib/auth/session";

export default async function MenuPage() {
  await requirePageUser("/menu");

  return (
    <div
      className={styles.menuPage}
      data-ui-ready="/menu"
      data-ui-state="loaded"
    >
      <PageHeading
        eyebrow="내 퍼뜩"
        title="내 퍼뜩"
        lead="계정, 알림, 도움말을 한곳에서 확인하세요."
      />

      <Surface as="section" className={styles.menuIntro} tone="raised">
        <span className={styles.menuIntroIcon} aria-hidden="true">
          <PutdukIcon name="menu" size={28} />
        </span>
        <span>
          <h2>필요한 기능을 짧게</h2>
          <p>자주 쓰는 계정과 도움 기능을 모았어요.</p>
        </span>
      </Surface>

      <nav className={styles.menuGrid} aria-label="내 퍼뜩 메뉴">
        {MENU_ITEMS.map((item) => (
          <Link
            className={styles.menuCard}
            href={item.href as Route}
            key={item.href}
          >
            <span className={styles.menuIcon}>
              <PutdukIcon name={item.icon} size={21} />
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
            <PutdukIcon name="arrow-right" size={19} />
          </Link>
        ))}
      </nav>
    </div>
  );
}
