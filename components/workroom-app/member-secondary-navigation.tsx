import styles from "./workroom-app.module.css";
export function MemberSecondaryNavigation({ pathname }: { pathname: string }) {
  const records = [
    "/workroom/records",
    "/workroom/history",
    "/workroom/points",
  ];
  const items = records.some((path) => pathname.startsWith(path))
    ? [
        { href: "/workroom/records", label: "입출금 기록" },
        { href: "/workroom/history", label: "참여 내역" },
        { href: "/workroom/points", label: "체험 포인트" },
      ]
    : pathname.startsWith("/menu/account")
      ? [
          { href: "/menu/notifications", label: "알림 설정" },
          { href: "/workroom/guide", label: "이용 안내" },
          { href: "/workroom/support", label: "1:1 문의" },
        ]
      : [];
  if (!items.length) return null;
  return (
    <nav
      className={styles.secondaryNav}
      aria-label={records.includes(pathname) ? "내역 종류" : "내 정보 메뉴"}
    >
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? "page" : undefined}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
