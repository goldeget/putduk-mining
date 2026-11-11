"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { adminLocation } from "./admin-menu";

export function AdminLocation() {
  const location = adminLocation(usePathname(), useSearchParams().get("tab"));
  return (
    <div className="admin-location" aria-label="현재 운영 화면">
      <Link href="/" aria-label="운영 대시보드">
        WORKROOM
      </Link>
      <span aria-hidden="true">/</span>
      <strong>{location.label}</strong>
    </div>
  );
}
