import type { Route } from "next";
import Link from "next/link";

import {
  PutdukIcon,
  type PutdukIconName,
} from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import { Surface } from "@/components/ui/surface";

const menuItems: ReadonlyArray<{
  description: string;
  href: Route;
  icon: PutdukIconName;
  label: string;
}> = [
  {
    href: "/menu/account" as Route,
    icon: "user",
    label: "계정 관리",
    description: "내 계정과 로그인 기기, 로그아웃 설정을 확인합니다.",
  },
  {
    href: "/notifications",
    icon: "bell",
    label: "알림 센터",
    description: "채굴·자산·이벤트 소식과 수신 설정을 확인합니다.",
  },
  {
    href: "/ai",
    icon: "ai",
    label: "PUTDUK AI",
    description: "내 상태와 퍼뜩 이용 방법을 자연스럽게 물어봅니다.",
  },
  {
    href: "/putduk-facts" as Route,
    icon: "shield",
    label: "신뢰 센터",
    description: "공식 정보와 자산·채굴의 기본 원칙을 확인합니다.",
  },
];

export default function MenuPage() {
  return (
    <div className={styles.menuPage}>
      <PageHeading
        eyebrow="MY PUTDUK"
        title="내 퍼뜩"
        lead="계정, 알림, 도움말과 공식 안내를 한곳에서 빠르게 확인하세요."
      />

      <Surface as="section" className={styles.menuIntro} tone="raised">
        <span className={styles.menuIntroIcon} aria-hidden="true">
          <PutdukIcon name="menu" size={28} />
        </span>
        <span>
          <h2>필요한 기능을 짧고 분명하게</h2>
          <p>
            자주 확인하는 항목을 바로 찾을 수 있도록 계정과 도움 기능을
            모았습니다.
          </p>
        </span>
      </Surface>

      <nav className={styles.menuGrid} aria-label="내 퍼뜩 메뉴">
        {menuItems.map((item) => (
          <Link className={styles.menuCard} href={item.href} key={item.href}>
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
