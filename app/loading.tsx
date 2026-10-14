import { BrandMark } from "@/components/brand/brand-mark";
import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <main className="shell" aria-busy="true">
      <header className="site-header">
        <span className="brand-lockup">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </span>
      </header>
      <section className="state-panel">
        <h2>화면을 불러오고 있어요</h2>
        <Skeleton label="화면 불러오는 중" />
      </section>
    </main>
  );
}
