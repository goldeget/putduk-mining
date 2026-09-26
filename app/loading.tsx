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
        <p className="eyebrow">LOADING SYSTEM</p>
        <h2>안전한 채굴 환경을 준비하고 있습니다.</h2>
        <Skeleton />
      </section>
    </main>
  );
}
