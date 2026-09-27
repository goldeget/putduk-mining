import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ThemeControl } from "@/components/system/theme-control";

const worlds = [
  { code: "KR", label: "KOREA", state: "첫 여정", tone: "korea" },
  { code: "US", label: "USA", state: "확장 월드", tone: "usa" },
  { code: "AU", label: "GOLD", state: "금빛 월드", tone: "gold" },
  { code: "AG", label: "SILVER", state: "은빛 월드", tone: "silver" },
  { code: "CX", label: "CRYPTO", state: "디지털 월드", tone: "crypto" },
] as const;

const journey = [
  {
    icon: "mining" as const,
    step: "01",
    title: "KOREA에서 첫 채굴",
    description: "PUTDUK START로 핵심 채굴 흐름을 경험합니다.",
  },
  {
    icon: "clock" as const,
    step: "02",
    title: "앱을 닫아도 이어지는 시간",
    description: "다시 접속하면 결과를 확인할 수 있어요.",
  },
  {
    icon: "wallet" as const,
    step: "03",
    title: "자격 확인 후 환영 보상",
    description: "최대 5,000원까지 출금할 수 있어요. 출금 전 본인 확인이 필요해요.",
  },
] as const;

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "PUTDUK MINING",
  alternateName: "퍼뜩 채굴",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web, PWA",
  url: "https://mining.putduk.com",
  description:
    "KOREA에서 시작해 서버 기준으로 채굴 상태와 결과를 확인하는 PUTDUK의 가상 채굴 플랫폼입니다.",
};

export default function HomePage() {
  return (
    <main className="consumer-landing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <header className="site-header shell landing-header">
        <Link className="brand-lockup" href="/" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </Link>
        <nav className="landing-header__nav" aria-label="공개 메뉴">
          <a href="#start">PUTDUK START</a>
          <a href="#worlds">월드</a>
          <Link href="/verification">검증 원칙</Link>
        </nav>
        <div className="site-header__tools">
          <ThemeControl />
          <Link className="landing-header__login" href="/login">
            로그인
          </Link>
          <Link
            className="button button--primary landing-header__signup"
            href="/signup"
          >
            무료로 시작
          </Link>
        </div>
      </header>

      <section className="hero shell landing-hero" id="top">
        <div className="hero__copy">
          <p className="eyebrow">VIRTUAL MINING, MADE CLEAR</p>
          <h1>
            작은 시작이,
            <br />
            <span>나만의 채굴 세계</span>를 엽니다.
          </h1>
          <p className="hero__lead">
            KOREA에서 시작하는 가상 채굴입니다. 앱을 닫아도 채굴은 계속돼요.
          </p>
          <div className="hero__actions">
            <Link className="button button--primary" href="/signup">
              PUTDUK START 시작하기
              <PutdukIcon name="arrow-right" size={19} />
            </Link>
            <Link className="button button--secondary" href="/login">
              내 채굴로 돌아가기
            </Link>
          </div>
          <div className="landing-welcome-proof" role="note">
            <PutdukIcon name="shield" size={21} />
            <p>
              <strong>최대 5,000원 환영 보상</strong>
              자격 확인 후 전환되며, 첫 출금에 사전 입금은 필요하지 않습니다.
            </p>
          </div>
          <dl className="hero__facts">
            <div>
              <dt>첫 월드</dt>
              <dd>KOREA</dd>
            </div>
            <div>
              <dt>채굴 기준</dt>
              <dd>SERVER</dd>
            </div>
            <div>
              <dt>기본 지갑</dt>
              <dd>KRW</dd>
            </div>
          </dl>
        </div>

        <div className="hero__visual landing-hero__visual">
          <picture className="hero__world">
            <source
              type="image/avif"
              srcSet="/brand/worlds/orbital-earth-960-v1.avif 960w, /brand/worlds/orbital-earth-1600-v1.avif 1600w"
              sizes="(min-width: 980px) 46vw, 100vw"
            />
            <source
              type="image/webp"
              srcSet="/brand/worlds/orbital-earth-960-v1.webp 960w, /brand/worlds/orbital-earth-1600-v1.webp 1600w"
              sizes="(min-width: 980px) 46vw, 100vw"
            />
            <img
              src="/brand/worlds/orbital-earth-960-v1.webp"
              alt=""
              width="960"
              height="540"
              fetchPriority="high"
            />
          </picture>
          <div className="hero__signal">
            <span>YOUR MINING WORLD</span>
            <strong>지금, 퍼뜩.</strong>
            <p>앱을 닫아도 서버에서 이어지는 채굴 여정</p>
          </div>
          <picture className="hero__mascot">
            <source
              type="image/avif"
              srcSet="/brand/mascot/putduk-miner-384-v1.avif 384w, /brand/mascot/putduk-miner-768-v1.avif 768w"
              sizes="(min-width: 980px) 27vw, 58vw"
            />
            <source
              type="image/webp"
              srcSet="/brand/mascot/putduk-miner-384-v1.webp 384w, /brand/mascot/putduk-miner-768-v1.webp 768w"
              sizes="(min-width: 980px) 27vw, 58vw"
            />
            <img
              src="/brand/mascot/putduk-miner-384-v1.webp"
              alt="금빛 광부 헬멧과 새싹을 쓴 퍼뜩 마스코트"
              width="384"
              height="487"
              fetchPriority="high"
            />
          </picture>
          <div className="hero__index" aria-hidden="true">
            01 / KOREA
          </div>
        </div>
      </section>

      <section
        className="landing-journey shell"
        id="start"
        aria-labelledby="journey-title"
      >
        <div className="section-heading section-heading--row">
          <div>
            <p className="eyebrow">PUTDUK START</p>
            <h2 id="journey-title">첫 결과까지, 가치의 경계는 정확히.</h2>
          </div>
          <p>
            체험 값은 실제 지갑과 분리됩니다. 전환된 환영 보상만 실제 KRW가
            됩니다.
          </p>
        </div>
        <div className="landing-journey__grid">
          {journey.map((item) => (
            <article key={item.step}>
              <span>{item.step}</span>
              <PutdukIcon name={item.icon} size={26} />
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
        <div className="landing-journey__action">
          <Link className="button button--primary" href="/signup">
            내 첫 채굴 시작하기
            <PutdukIcon name="arrow-right" size={19} />
          </Link>
          <p>가입 후 KOREA 월드의 안내에 따라 시작합니다.</p>
        </div>
      </section>

      <section
        className="worlds shell landing-worlds"
        id="worlds"
        aria-labelledby="worlds-title"
      >
        <div className="section-heading section-heading--row">
          <div>
            <p className="eyebrow">FIVE MINING WORLDS</p>
            <h2 id="worlds-title">한 번의 시작, 다섯 개의 채굴 세계.</h2>
          </div>
          <p>
            KOREA에서 첫 여정을 시작하고 USA, GOLD, SILVER, CRYPTO로 나만의 채굴
            경험을 넓혀갑니다.
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

      <section className="landing-trust shell" aria-labelledby="trust-title">
        <div>
          <p className="eyebrow">TRUST &amp; VERIFICATION</p>
          <h2 id="trust-title">보이는 숫자보다, 확인 가능한 과정.</h2>
          <p>
            실제 잔액, 채굴 상태와 처리 결과는 서버에서 확인된 정보만
            표시합니다. 화면 효과가 금액이나 완료를 대신하지 않습니다.
          </p>
        </div>
        <nav aria-label="신뢰 정보">
          <Link href="/verification">검증 원칙</Link>
          <Link href="/trial">PUTDUK START 안내</Link>
          <Link href="/withdrawal">출금 안내</Link>
          <Link href="/status">서비스 상태</Link>
        </nav>
      </section>

      <footer className="site-footer shell landing-footer">
        <div className="brand-lockup brand-lockup--footer">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </div>
        <p>작은 행동이 더 나은 내일을 만듭니다.</p>
        <span>© 2026 PUTDUK</span>
      </footer>
    </main>
  );
}
