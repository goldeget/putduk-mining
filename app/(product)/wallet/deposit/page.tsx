import { DepositForm } from "@/components/product/deposit-form";
import { PageHeading } from "@/components/product/page-heading";
import { Surface } from "@/components/ui/surface";

export default function DepositPage() {
  return (
    <>
      <PageHeading
        eyebrow="FUNDING"
        title="입금은 요청과 확인을 분리합니다."
        lead="KRW가 기본 방식이며 USDT는 사용자가 선택할 때만 나타납니다. 어떤 방식도 요청만으로 잔액에 반영되지 않습니다."
      />
      <div className="funding-layout">
        <Surface as="section" className="funding-panel" tone="raised">
          <DepositForm />
        </Surface>
        <aside className="funding-steps">
          <p className="eyebrow">VERIFICATION FLOW</p>
          <ol>
            <li>
              <span>01</span>
              입금 요청 생성
            </li>
            <li>
              <span>02</span>
              승인된 안내 확인
            </li>
            <li>
              <span>03</span>
              운영자 검증
            </li>
            <li>
              <span>04</span>
              DEPOSIT 원장 반영
            </li>
          </ol>
        </aside>
      </div>
    </>
  );
}
