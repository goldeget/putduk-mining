import type { ReactNode } from "react";
import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ProductNavigation } from "@/components/navigation/product-navigation";
import { ThemeControl } from "@/components/system/theme-control";
import { ConnectivityStatus } from "@/components/system/connectivity-status";

export function ProductShell({
  children,
  displayName,
}: {
  children: ReactNode;
  displayName: string;
}) {
  return (
    <div className="product-shell">
      <ConnectivityStatus />
      <aside className="product-sidebar">
        <Link className="brand-lockup" href="/home" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </Link>
        <ProductNavigation />
        <div className="product-sidebar__principle">
          <PutdukIcon name="shield" size={18} />
          <span>
            <small>확인된 잔액</small>
            확인된 내역만 잔액에 반영됩니다
          </span>
        </div>
      </aside>
      <div className="product-workspace">
        <header className="product-header">
          <Link className="product-header__brand" href="/home">
            <BrandMark title="퍼뜩 채굴" />
          </Link>
          <div className="product-header__tools">
            <Link
              className="product-header__notification"
              href="/notifications"
              aria-label="알림 센터"
            >
              <PutdukIcon name="bell" size={19} />
            </Link>
            <ThemeControl />
            <div className="product-header__identity">
              <span>
                <small>회원</small>
                {displayName}
              </span>
              <span className="product-header__avatar" aria-hidden="true">
                <PutdukIcon name="user" size={18} />
              </span>
            </div>
          </div>
        </header>
        <main className="product-main">{children}</main>
        <ProductNavigation />
      </div>
    </div>
  );
}
