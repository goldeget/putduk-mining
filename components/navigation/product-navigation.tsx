"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/components/workroom/workroom.module.css";
const items = [
  { href: "/workroom", label: "워크룸", icon: "home" },
  { href: "/workroom/cash", label: "입출금", icon: "wallet" },
  { href: "/workroom/records", label: "내역", icon: "history" },
  { href: "/workroom/support", label: "1:1 문의", icon: "support" },
  { href: "/menu/account", label: "내 정보", icon: "account" },
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
            (item.href !== "/workroom" &&
              pathname.startsWith(`${item.href}/`)) ||
            (item.href === "/workroom/records" &&
              (pathname.startsWith("/workroom/history") ||
                pathname.startsWith("/workroom/points")))
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
              ) : item.icon === "support" ? (
                <>
                  <path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z" />
                  <path d="M8 10h8m-8 4h5" />
                </>
              ) : item.icon === "wallet" ? (
                <>
                  <rect x="3" y="5" width="18" height="15" rx="2" />
                  <path d="M3 9h18m-5 5h.01" />
                </>
              ) : (
                <>
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
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
