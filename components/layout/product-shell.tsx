import type { ReactNode } from "react";
import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ProductNavigation } from "@/components/navigation/product-navigation";

export function ProductShell({
  children,
  displayName,
}: {
  children: ReactNode;
  displayName: string;
}) {
  return (
    <div className="product-shell">
      <aside className="product-sidebar">
        <Link className="brand-lockup" href="/start" aria-label="퍼뜩 채굴 홈">
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
            <small>LEDGER FIRST</small>
            모든 자산 변화는 기록됩니다
          </span>
        </div>
      </aside>
      <div className="product-workspace">
        <header className="product-header">
          <Link className="product-header__brand" href="/start">
            <BrandMark title="퍼뜩 채굴" />
          </Link>
          <div className="product-header__identity">
            <span>
              <small>MEMBER</small>
              {displayName}
            </span>
            <span className="product-header__avatar" aria-hidden="true">
              <PutdukIcon name="user" size={18} />
            </span>
          </div>
        </header>
        <main className="product-main">{children}</main>
        <ProductNavigation />
      </div>
    </div>
  );
}
