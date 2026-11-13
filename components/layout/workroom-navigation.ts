type NavigationItem = { href: string; label: string };

const matches = (pathname: string, route: string) =>
  pathname === route || pathname.startsWith(`${route}/`);

const pageTitles: readonly (readonly [string, string])[] = [
  ["/workroom/records/legacy", "잔액 변동 상세"],
  ["/workroom/cash/deposit", "입금 신청"],
  ["/workroom/cash/withdraw", "출금 신청"],
  ["/workroom/cash", "실제 잔액 · 입출금"],
  ["/workroom/records", "입출금 기록"],
  ["/workroom/support", "1:1 문의"],
  ["/workroom/history", "참여 내역"],
  ["/workroom/points", "체험 포인트"],
  ["/workroom/guide", "이용 안내"],
  ["/workroom", "내 워크룸"],
  ["/notifications", "알림함"],
  ["/menu/notifications", "알림 설정"],
  ["/menu/account", "내 정보"],
  ["/menu/support", "고객지원"],
  ["/menu/trust", "신뢰 센터"],
  ["/menu/ai", "WORKROOM AI"],
  ["/ai", "WORKROOM AI"],
  ["/events/notices", "안내 사항"],
  ["/events", "새 소식"],
  ["/wallet", "실제 자산 · 입출금"],
];

export function workroomPageTitle(pathname: string) {
  return (
    pageTitles.find(([route]) => matches(pathname, route))?.[1] ?? "내 정보"
  );
}

const recordItems: readonly NavigationItem[] = [
  { href: "/workroom/records", label: "입출금 기록" },
  { href: "/workroom/history", label: "참여 내역" },
  { href: "/workroom/points", label: "체험 포인트" },
];
const accountItems: readonly NavigationItem[] = [
  { href: "/menu/account", label: "내 정보" },
  { href: "/menu/notifications", label: "알림 설정" },
  { href: "/workroom/guide", label: "이용 안내" },
  { href: "/workroom/support", label: "1:1 문의" },
];

export function workroomSecondaryNavigation(pathname: string) {
  const records = recordItems.some(({ href }) => matches(pathname, href));
  const account = [
    "/menu/account",
    "/menu/notifications",
    "/workroom/guide",
  ].some((route) => matches(pathname, route));
  if (!records && !account) return null;
  return {
    label: records ? "내역 종류" : "내 정보 메뉴",
    items: (records ? recordItems : accountItems).map((item) => ({
      ...item,
      current: matches(pathname, item.href),
    })),
  };
}

export function workroomPrimaryHref(pathname: string) {
  if (pathname === "/workroom") return "/workroom";
  if (matches(pathname, "/workroom/cash") || matches(pathname, "/wallet"))
    return "/workroom/cash";
  if (recordItems.some(({ href }) => matches(pathname, href)))
    return "/workroom/records";
  if (matches(pathname, "/workroom/support")) return "/workroom/support";
  if (
    matches(pathname, "/menu") ||
    matches(pathname, "/notifications") ||
    matches(pathname, "/workroom/guide") ||
    matches(pathname, "/ai") ||
    matches(pathname, "/events")
  )
    return "/menu/account";
  return null;
}
