import type { Route } from "next";
import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PageHeading } from "@/components/product/page-heading";

const menuItems: ReadonlyArray<{
  description: string;
  href: Route;
  icon: "ai" | "bell" | "shield";
  label: string;
}> = [
  {
    href: "/menu/notifications",
    icon: "bell",
    label: "알림 설정",
    description: "채굴·자산·이벤트 알림을 관리합니다.",
  },
  {
    href: "/menu/ai",
    icon: "ai",
    label: "PUTDUK AI",
    description: "허용된 정보 범위에서 설명과 분석을 제공합니다.",
  },
  {
    href: "/putduk-facts" as Route,
    icon: "shield",
    label: "신뢰 센터",
    description: "공식 사실과 운영 원칙을 확인합니다.",
  },
];

export default function MenuPage() {
  return (
    <>
      <PageHeading
        eyebrow="MORE"
        title="필요한 정보는 짧은 경로로."
        lead="계정 설정, 알림, AI와 공식 운영 정보를 한곳에서 확인합니다."
      />
      <nav className="menu-list" aria-label="추가 메뉴">
        {menuItems.map((item) => (
          <Link href={item.href} key={item.href}>
            <span className="menu-list__icon">
              <PutdukIcon name={item.icon} />
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
            <PutdukIcon name="arrow-right" size={19} />
          </Link>
        ))}
      </nav>
    </>
  );
}
