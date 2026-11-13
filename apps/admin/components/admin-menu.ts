export const ADMIN_MENU_ITEMS = [
  { href: "/members", label: "회원 목록", group: "워크룸 운영" },
  {
    href: "/workroom?tab=config",
    label: "워크룸 · 모의 조건",
    group: "워크룸 운영",
  },
  { href: "/workroom?tab=invites", label: "추천인 코드", group: "워크룸 운영" },
  {
    href: "/workroom?tab=users",
    label: "회원·체험 포인트",
    group: "워크룸 운영",
  },
  {
    href: "/workroom?tab=audit",
    label: "워크룸 변경 기록",
    group: "워크룸 운영",
  },
  { href: "/deposits/krw", label: "원화 입금 관리", group: "입출금 관리" },
  { href: "/deposits/usdt", label: "USDT 입금 관리", group: "입출금 관리" },
  {
    href: "/withdrawals/krw-bank",
    label: "계좌 출금 관리",
    group: "입출금 관리",
  },
  { href: "/withdrawals/usdt", label: "USDT 출금 관리", group: "입출금 관리" },
  { href: "/exceptions", label: "예외 처리", group: "운영 지원" },
  { href: "/support", label: "1:1 문의함", group: "운영 지원" },
  { href: "/notifications", label: "알림함", group: "운영 지원" },
  { href: "/kyc", label: "본인 확인", group: "운영 지원" },
  { href: "/restrictions", label: "제한·안전", group: "운영 지원" },
  { href: "/ai-conversations", label: "회원 AI 기록", group: "운영 지원" },
] as const;

export function isCurrentAdminItem(
  href: string,
  pathname: string,
  tab: string | null,
) {
  const currentTab =
    tab && ["config", "invites", "users", "audit"].includes(tab)
      ? tab
      : "config";
  return href.startsWith("/workroom?")
    ? pathname === "/workroom" && currentTab === href.split("tab=")[1]
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function adminLocation(pathname: string, tab: string | null) {
  const item = ADMIN_MENU_ITEMS.find((item) =>
    isCurrentAdminItem(item.href, pathname, tab),
  );
  return item
    ? { group: item.group, label: item.label }
    : { group: "WORKROOM", label: "운영 대시보드" };
}
