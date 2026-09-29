import type { Route } from "next";

import type { PutdukIconName } from "@/components/icons/putduk-icon";

export type MenuItem = {
  description: string;
  href: Route;
  icon: PutdukIconName;
  label: string;
};

/** 내 퍼뜩 허브 네비게이션. 알림 센터와 알림 설정을 분리한다. */
export const MENU_ITEMS: readonly MenuItem[] = [
  {
    href: "/menu/account" as Route,
    icon: "user",
    label: "계정 관리",
    description: "로그인 정보와 기기 로그아웃을 확인해요.",
  },
  {
    href: "/notifications",
    icon: "bell",
    label: "알림 센터",
    description: "채굴·자산·이벤트 소식을 확인해요.",
  },
  {
    href: "/menu/notifications" as Route,
    icon: "pulse",
    label: "알림 설정",
    description: "받고 싶은 알림만 골라 두세요.",
  },
  {
    href: "/ai",
    icon: "ai",
    label: "퍼뜩 AI",
    description: "내 상태와 이용 방법을 자연스럽게 물어보세요.",
  },
  {
    href: "/putduk-facts" as Route,
    icon: "shield",
    label: "신뢰 센터",
    description: "공식 정보와 채굴의 기본 원칙을 확인해요.",
  },
  {
    href: "/support" as Route,
    icon: "spark",
    label: "상담",
    description: "가입, 채굴, 입금과 출금 안내를 확인해요.",
  },
] as const;
