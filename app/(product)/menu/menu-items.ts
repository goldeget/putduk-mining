import type { Route } from "next";

import type { PutdukIconName } from "@/components/icons/putduk-icon";

export type MenuItem = {
  description: string;
  href: Route;
  icon: PutdukIconName;
  label: string;
  /** 더보기 본문 왼쪽 목록과 오른쪽 설정 목록. */
  lane: "links" | "settings";
  /** SIMPLIFIED_TRACK: demoted hubs stay deep-link only. */
  demoted?: boolean;
};

/** 더보기 허브 — thin: account, support, legal/trust; AI/events demoted. */
export const MENU_ITEMS: readonly MenuItem[] = [
  {
    href: "/menu/account" as Route,
    icon: "user",
    label: "내 정보",
    description: "로그인 정보와 기기 로그아웃을 확인해요.",
    lane: "links",
  },
  {
    href: "/notifications",
    icon: "bell",
    label: "알림",
    description: "채굴과 자산 소식을 확인해요.",
    lane: "links",
  },
  {
    href: "/menu/support" as Route,
    icon: "spark",
    label: "고객지원",
    description: "가입, 채굴, 입금과 출금 안내를 확인해요.",
    lane: "links",
  },
  {
    href: "/menu/trust" as Route,
    icon: "shield",
    label: "신뢰 센터",
    description: "공식 정보와 채굴의 기본 원칙을 확인해요.",
    lane: "links",
  },
  {
    href: "/menu/notifications" as Route,
    icon: "pulse",
    label: "알림 설정",
    description: "받고 싶은 알림만 골라 두세요.",
    lane: "settings",
  },
  {
    href: "/events",
    icon: "event",
    label: "이벤트",
    description: "진행 중인 소식을 확인해요.",
    lane: "settings",
    demoted: true,
  },
  {
    href: "/ai",
    icon: "ai",
    label: "퍼뜩 AI",
    description: "궁금한 점을 물어볼 수 있어요.",
    lane: "settings",
    demoted: true,
  },
] as const;
