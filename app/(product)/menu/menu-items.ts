import type { Route } from "next";

import type { PutdukIconName } from "@/components/icons/putduk-icon";

export type MenuItem = {
  description: string;
  href: Route;
  icon: PutdukIconName;
  label: string;
};

/** 더보기 허브. 알림과 알림 설정은 서로 다른 화면이다. */
export const MENU_ITEMS: readonly MenuItem[] = [
  {
    href: "/menu/account" as Route,
    icon: "user",
    label: "내 정보",
    description: "로그인 정보와 기기 로그아웃을 확인해요.",
  },
  {
    href: "/notifications",
    icon: "bell",
    label: "알림",
    description: "채굴·자산·이벤트 소식을 확인해요.",
  },
  {
    href: "/events",
    icon: "event",
    label: "이벤트",
    description: "진행 중인 이벤트와 참여 조건을 확인해요.",
  },
  {
    href: "/support" as Route,
    icon: "spark",
    label: "고객지원",
    description: "가입, 채굴, 입금과 출금 안내를 확인해요.",
  },
  {
    href: "/menu/notifications" as Route,
    icon: "pulse",
    label: "알림 설정",
    description: "받고 싶은 알림만 골라 두세요.",
  },
  {
    href: "/putduk-facts" as Route,
    icon: "shield",
    label: "신뢰 센터",
    description: "공식 정보와 채굴의 기본 원칙을 확인해요.",
  },
  {
    href: "/ai",
    icon: "ai",
    label: "퍼뜩 AI",
    description: "내 상태와 이용 방법을 물어보세요.",
  },
] as const;
