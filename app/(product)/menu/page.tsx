import type { Route } from "next";
import Link from "next/link";

import { MENU_ITEMS } from "@/app/(product)/menu/menu-items";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { requirePageUser } from "@/lib/auth/session";

import styles from "./menu.module.css";

export default async function MenuPage() {
  await requirePageUser("/menu");

  return (
    <div className={styles.page} data-ui-ready="/menu" data-ui-state="loaded">
      <div className={styles.split}>
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

        <nav aria-label="더보기 메뉴">
          <ul className={styles.list}>
            {MENU_ITEMS.map((item) => (
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
        </nav>
      </div>
    </div>
  );
}
