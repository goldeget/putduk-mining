import { BrandMark } from "@/components/brand/brand-mark";
import { MiningCore } from "@/components/foundation/mining-core";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { MobileNavigation } from "@/components/navigation/mobile-navigation";
import { Surface } from "@/components/ui/surface";

const principles = [
  {
    icon: "clock" as const,
    eyebrow: "SERVER TIME",
    title: "시간은 서버가 판정합니다",
    description:
      "앱을 닫아도 경과 시간은 사라지지 않고 다음 정산에 반영됩니다.",
  },
  {
    icon: "shield" as const,
    eyebrow: "LEDGER FIRST",
    title: "모든 변화는 기록을 남깁니다",
    description:
      "잔액을 임의로 덮어쓰지 않고 원장과 감사 흐름을 기준으로 처리합니다.",
  },
  {
    icon: "pulse" as const,
    eyebrow: "VERSIONED RULES",
    title: "규칙의 시간까지 보존합니다",
    description:
      "변경된 규칙은 과거에 소급하지 않고 적용 시점에 따라 구간 정산합니다.",
  },
];

const worlds = [
  { code: "KR", label: "KOREA", state: "첫 체험 월드", tone: "korea" },
  { code: "US", label: "USA", state: "V1 월드", tone: "usa" },
  { code: "AU", label: "GOLD", state: "V1 월드", tone: "gold" },
  { code: "AG", label: "SILVER", state: "V1 월드", tone: "silver" },
  { code: "CX", label: "CRYPTO", state: "V1 월드", tone: "crypto" },
];

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "PUTDUK MINING",
  alternateName: "퍼뜩 채굴",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web, PWA",
  url: "https://mining.putduk.com",
  description:
    "PUTDUK의 내부 규칙을 기반으로 운영되는 서버 권위형 가상 채굴 플랫폼입니다.",
};

export default function HomePage() {
  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <header className="site-header shell">
        <a className="brand-lockup" href="#top" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </a>
        <div className="header-status" aria-label="프로젝트 상태">
          <span />
          FOUNDATION 01
        </div>
      </header>

      <section className="hero shell" id="top">
        <div className="hero__copy">
          <p className="eyebrow">PUTDUK VIRTUAL MINING SYSTEM</p>
          <h1>
            채굴의 시간을,
            <br />
            <span>신뢰 가능한 기록</span>으로.
          </h1>
          <p className="hero__lead">
            퍼뜩 채굴은 서버 기준의 채굴·정산·원장을 하나의 흐름으로 설계합니다.
            복잡한 경제 시스템은 안쪽에 두고, 사용자는 분명한 다음 행동만
            만납니다.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href="#start">
              PUTDUK START 보기
              <PutdukIcon name="arrow-right" size={19} />
            </a>
            <a className="button button--secondary" href="#principles">
              운영 원칙
            </a>
          </div>
          <dl className="hero__facts">
            <div>
              <dt>체험 시간</dt>
              <dd>최대 24시간</dd>
            </div>
            <div>
              <dt>기본 단위</dt>
              <dd>KRW</dd>
            </div>
            <div>
              <dt>첫 월드</dt>
              <dd>KOREA</dd>
            </div>
          </dl>
        </div>

        <div className="hero__visual">
          <div className="hero__index" aria-hidden="true">
            01 / CORE
          </div>
          <MiningCore />
          <div className="visual-caption">
            <span>2.5D SYSTEM LANGUAGE</span>
            <span>REDUCED MOTION READY</span>
          </div>
        </div>
      </section>

      <section
        className="principles shell"
        id="principles"
        aria-labelledby="principles-title"
      >
        <div className="section-heading">
          <p className="eyebrow">SYSTEM PRINCIPLES</p>
          <h2 id="principles-title">보이는 경험보다 먼저, 지켜지는 원칙.</h2>
        </div>
        <div className="principle-grid">
          {principles.map((principle, index) => (
            <Surface
              as="article"
              className="principle-card"
              key={principle.eyebrow}
            >
              <div className="principle-card__topline">
                <span>0{index + 1}</span>
                <PutdukIcon name={principle.icon} />
              </div>
              <p className="eyebrow">{principle.eyebrow}</p>
              <h3>{principle.title}</h3>
              <p>{principle.description}</p>
            </Surface>
          ))}
        </div>
      </section>

      <section
        className="start-section shell"
        id="start"
        aria-labelledby="start-title"
      >
        <div className="start-panel">
          <div className="start-panel__copy">
            <p className="eyebrow">PUTDUK START / 24H</p>
            <h2 id="start-title">첫 결과까지는 짧게, 신뢰는 처음부터.</h2>
            <p>
              신규 사용자는 KOREA 월드에서 시작합니다. 체험은 사용량 100% 또는
              24시간 중 먼저 도달한 조건에서 끝나며, 실제 지갑과 완전히
              분리됩니다.
            </p>
            <ul className="start-rules">
              <li>
                <span>01</span>
                브라우저를 닫아도 서버 시간으로 계속
              </li>
              <li>
                <span>02</span>
                보상 곡선은 화면이 아닌 버전 설정으로
              </li>
              <li>
                <span>03</span>
                체험 원장과 실제 자산 원장은 완전히 분리
              </li>
            </ul>
          </div>

          <div
            className="trial-blueprint"
            aria-label="PUTDUK START 화면 설계 예시"
          >
            <div className="trial-blueprint__header">
              <div>
                <span>PUTDUK START</span>
                <strong>KOREA / TRIAL</strong>
              </div>
              <span className="trial-badge">설계 예시</span>
            </div>
            <div className="trial-blueprint__core">
              <span className="trial-blueprint__ring" aria-hidden="true" />
              <div>
                <small>무료 체험 상태</small>
                <strong>서버 연결 전</strong>
                <span>실제 수치는 서버 정산 후 표시됩니다</span>
              </div>
            </div>
            <div className="trial-blueprint__meter">
              <div>
                <span>사용량</span>
                <strong>정산 대기</strong>
              </div>
              <div className="meter-track" aria-hidden="true">
                <span />
              </div>
            </div>
            <MobileNavigation />
          </div>
        </div>
      </section>

      <section className="worlds shell" aria-labelledby="worlds-title">
        <div className="section-heading section-heading--row">
          <div>
            <p className="eyebrow">INTERNAL WORLDS</p>
            <h2 id="worlds-title">외부 시세가 아닌, PUTDUK의 규칙으로.</h2>
          </div>
          <p>
            다섯 월드는 독립된 규칙 버전과 적용 시점을 가집니다. 새 규칙은 과거
            채굴 시간에 소급 적용되지 않습니다.
          </p>
        </div>
        <div className="world-list">
          {worlds.map((world, index) => (
            <article
              className={`world-row world-row--${world.tone}`}
              key={world.label}
            >
              <span className="world-row__number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="world-row__code">{world.code}</span>
              <h3>{world.label}</h3>
              <span className="world-row__state">{world.state}</span>
            </article>
          ))}
        </div>
      </section>

      <footer className="site-footer shell">
        <div className="brand-lockup brand-lockup--footer">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING SYSTEM</small>
          </span>
        </div>
        <p>서버 권위형 채굴 · 원장 우선 자산 처리 · 버전 기반 경제 규칙</p>
        <span>FOUNDATION / 2026</span>
      </footer>
    </main>
  );
}
