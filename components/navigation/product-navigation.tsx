"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/components/workroom/workroom.module.css";
const items = [
  { href: "/workroom", label: "내 워크룸", icon: "home" },
  { href: "/workroom/history", label: "참여 내역", icon: "history" },
  { href: "/workroom/points", label: "체험 포인트", icon: "points" },
  { href: "/workroom/guide", label: "이용 안내", icon: "guide" },
  { href: "/workroom/cash", label: "입출금", icon: "wallet" },
] as const;
export function ProductNavigation({
  presentation = "default",
}: { presentation?: "default" | "mining-sidebar" } = {}) {
  const pathname = usePathname();
  return (
    <nav
      className={presentation === "default" ? styles.bottomNav : styles.sideNav}
      aria-label={
        presentation === "default" ? "워크룸 빠른 메뉴" : "워크룸 전체 메뉴"
      }
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          aria-current={
            pathname === item.href ||
            (item.href === "/workroom/cash" &&
              (pathname.startsWith("/workroom/cash/") ||
                pathname.startsWith("/workroom/records")))
              ? "page"
              : undefined
          }
        >
          <span className={styles.navIcon} aria-hidden="true">
            <svg
              width="23"
              height="23"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              focusable="false"
            >
              {item.icon === "home" ? (
                <path d="m3 10 9-7 9 7v10H15v-7H9v7H3Z" />
              ) : item.icon === "history" ? (
                <>
                  <path d="m3 7 9-4 9 4-9 4Z" />
                  <path d="m3 12 9 4 9-4M3 17l9 4 9-4" />
                </>
              ) : item.icon === "points" ? (
                <>
                  <ellipse cx="12" cy="6" rx="8" ry="3" />
                  <path d="M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0v-6" />
                </>
              ) : item.icon === "wallet" ? (
                <>
                  <rect x="3" y="5" width="18" height="15" rx="2" />
                  <path d="M3 9h18m-5 5h.01" />
                </>
              ) : (
                <>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v6m0-10v.1" />
                </>
              )}
            </svg>
          </span>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
