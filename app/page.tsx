import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { MemberEntryLink } from "@/components/layout/member-entry-link";
import { publicLanguageAlternates } from "@/lib/trust/public-discovery";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ThemeControl } from "@/components/system/theme-control";

import styles from "./public-home.module.css";

const worlds = [
  {
    code: "KR",
    label: "한국",
    state: "첫 여정",
    tone: "korea",
    scene: "korea",
    alt: "한옥과 현대 도시, 산세를 담아 상상한 퍼뜩 한국 월드",
  },
  {
    code: "US",
    label: "미국",
    state: "확장 월드",
    tone: "usa",
    scene: "usa",
    alt: "도시의 고층 건물과 다리를 담아 상상한 퍼뜩 미국 월드",
  },
  {
    code: "AU",
    label: "금",
    state: "금빛 월드",
    tone: "gold",
    scene: "gold",
    alt: "금빛 광물의 질감과 새싹을 담아 상상한 퍼뜩 금 월드",
  },
  {
    code: "AG",
    label: "은",
    state: "은빛 월드",
    tone: "silver",
    scene: "silver",
    alt: "은빛 결정과 차분한 빛을 담아 상상한 퍼뜩 은 월드",
  },
  {
    code: "CX",
    label: "디지털 자산",
    state: "디지털 월드",
    tone: "crypto",
    scene: "digital",
    alt: "투명한 연결 구조를 담아 상상한 퍼뜩 디지털 자산 월드",
  },
] as const;

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: publicLanguageAlternates("/"),
  },
};

const journey = [
  {
    icon: "mining" as const,
    step: "01",
    title: "가입하고 무료 체험 시작",
    description: "무료 체험에서 채굴 흐름을 먼저 경험해요.",
  },
  {
    icon: "clock" as const,
    step: "02",
    title: "앱을 닫아도 이어지는 시간",
    description: "정해진 기간과 이용 조건 안에서 채굴이 진행돼요.",
  },
  {
    icon: "wallet" as const,
    step: "03",
    title: "자격 확인 후 환영 보상",
    description:
      "최대 5,000원까지 출금할 수 있어요. 출금 전 본인 확인이 필요해요.",
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
    "무료 체험으로 채굴을 시작하고, 내 채굴 기록과 확정된 보상을 확인하는 퍼뜩 채굴 앱입니다.",
};

export default function HomePage() {
  return (
    <main
      className={`consumer-landing ${styles.home}`}
      data-ui-ready="/"
      data-ui-state="loaded"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <header className="site-header shell landing-header">
        <Link className="brand-lockup" href="/" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>퍼뜩 채굴</strong>
            <small>PUTDUK MINING</small>
          </span>
        </Link>
        <nav className="landing-header__nav" aria-label="공개 메뉴">
          <Link href="/about">소개</Link>
          <Link href="/how-it-works">이용 방법</Link>
          <Link href="/faq">자주 묻는 질문</Link>
          <Link href="/support">고객지원</Link>
        </nav>
        <div className="site-header__tools">
          <ThemeControl />
          <MemberEntryLink className="landing-header__login" href="/login">
            로그인
          </MemberEntryLink>
          <MemberEntryLink
            className="button button--primary landing-header__signup"
            href="/signup"
          >
            무료 체험하기
          </MemberEntryLink>
        </div>
      </header>

      <nav className={styles.helpLinks} aria-label="도움말">
        <Link href="/about">소개</Link>
        <Link href="/how-it-works">이용 방법</Link>
        <Link href="/faq">자주 묻는 질문</Link>
        <Link href="/support">고객지원</Link>
      </nav>

      <section className="hero shell landing-hero" id="top">
        <div className="hero__copy">
          <p className="eyebrow">무료 체험으로 시작하는 자동채굴 앱</p>
          <h1>
            일상에 더하는 부수입,
            <br />
            <span>퍼뜩 채굴로 시작하세요.</span>
          </h1>
          <p className="hero__lead">
            앱에서 채굴을 시작하면, 화면을 꺼도 채굴이 진행돼요.
            <br />
            다시 접속해 내 채굴 기록과 확정된 보상을 확인하세요.
          </p>
        </div>

        <div className="hero__visual landing-hero__visual">
          <picture className="hero__world">
            <source
              type="image/avif"
              srcSet="/brand/scenes/first-world/first-world-640-v1.avif 640w, /brand/scenes/first-world/first-world-960-v1.avif 960w, /brand/scenes/first-world/first-world-1536-v1.avif 1536w"
              sizes="(max-width: 760px) 100vw, 92vw"
            />
            <source
              type="image/webp"
              srcSet="/brand/scenes/first-world/first-world-640-v1.webp 640w, /brand/scenes/first-world/first-world-960-v1.webp 960w, /brand/scenes/first-world/first-world-1536-v1.webp 1536w"
              sizes="(max-width: 760px) 100vw, 92vw"
            />
            <img
              src="/brand/scenes/first-world/first-world-1536-v1.webp"
              alt="금빛 새싹과 광물 섬으로 표현한 퍼뜩의 첫 채굴 월드"
              width="1536"
              height="1024"
              fetchPriority="high"
            />
          </picture>
          <div className="hero__signal">
            <span>첫 번째 채굴 여정</span>
            <strong>지금, 퍼뜩.</strong>
          </div>
        </div>

        <aside className={styles.action} aria-label="시작 안내">
          <div className={styles.heroActions}>
            <MemberEntryLink
              className={`button button--primary ${styles.start}`}
              href="/signup"
            >
              무료로 채굴 체험하기 <PutdukIcon name="arrow-right" size={20} />
            </MemberEntryLink>
            <Link className={styles.learnLink} href="/how-it-works">
              이용 방법 보기 <PutdukIcon name="arrow-right" size={18} />
            </Link>
          </div>
          <p className="ko-copy">
            채굴은 정해진 기간과 이용 조건에 따라 진행됩니다.
          </p>
          <p className="ko-copy">
            보상 전환·출금에는 본인 확인 등의 조건이 적용됩니다.
          </p>
          <MemberEntryLink className={styles.returnLink} href="/login">
            내 채굴로 돌아가기 <PutdukIcon name="arrow-right" size={16} />
          </MemberEntryLink>
        </aside>
        <div className={styles.heroFooter}>
          <span>나의 시간에, 새로운 가능성을.</span>
          <a href="#free-trial">
            아래에서 알아보기 <span aria-hidden="true">↓</span>
          </a>
        </div>
      </section>

      <aside
        className={styles.welcome}
        id="free-trial"
        aria-label="무료 체험 안내"
      >
        <div className={styles.welcomeTitle}>
          <PutdukIcon name="mining" size={26} />
          <div>
            <span>무료 체험으로 먼저 시작하세요</span>
            <strong>한국 월드 · PUTDUK START</strong>
          </div>
        </div>
        <div>
          <p>체험 목표를 채우거나 최대 24시간이 지나면 끝나요.</p>
          <p>체험 값은 실제 원화와 분리돼요.</p>
        </div>
        <Link href="/trial">
          체험 조건 보기 <PutdukIcon name="arrow-right" size={18} />
        </Link>
      </aside>

      <section
        className="landing-journey shell"
        id="start"
        aria-labelledby="journey-title"
      >
        <div className="section-heading">
          <p className="eyebrow">이용 방법</p>
          <h2 id="journey-title">무료 체험부터 보상 확인까지.</h2>
          <p className="ko-copy">
            체험 값은 실제 지갑과 분리됩니다. 전환된 환영 보상만 실제 KRW가
            됩니다.
          </p>
          <div className="landing-journey__action">
            <MemberEntryLink className="button button--primary" href="/signup">
              내 첫 채굴 시작하기
              <PutdukIcon name="arrow-right" size={19} />
            </MemberEntryLink>
            <p className="ko-copy">가입 후 무료 체험 안내에 따라 시작합니다.</p>
          </div>
        </div>
        <div
          className="landing-journey__grid"
          tabIndex={0}
          aria-label="첫 채굴 단계"
        >
          {journey.map((item) => (
            <article key={item.step}>
              <span>{item.step}</span>
              <PutdukIcon name={item.icon} size={26} />
              <h3 className="ko-heading">{item.title}</h3>
              <p className="ko-copy">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="worlds shell landing-worlds"
        id="worlds"
        aria-labelledby="worlds-title"
      >
        <div className="section-heading">
          <p className="eyebrow">채굴 월드 미리보기</p>
          <h2 id="worlds-title">퍼뜩 채굴의 장면을 만나보세요.</h2>
          <p className="ko-copy">
            아래 이미지는 채굴 테마를 보여주는 장면이에요. 이용 가능한 상품과
            조건은 승인된 카탈로그에서 확인할 수 있어요.
          </p>
        </div>
        <div className="world-list" tabIndex={0} aria-label="채굴 월드 목록">
          {worlds.map((world, index) => (
            <article
              className={`world-row world-row--${world.tone}`}
              key={world.label}
            >
              <picture
                className={styles.worldScene}
                data-world-scene={world.scene}
              >
                <source
                  type="image/avif"
                  srcSet={[320, 640, 960]
                    .map(
                      (width) =>
                        `/brand/scenes/world-collection/${world.scene}-${width}-v1.avif ${width}w`,
                    )
                    .join(", ")}
                  sizes={
                    world.scene === "digital"
                      ? "(max-width: 759px) 100vw, 20vw"
                      : "(max-width: 759px) 50vw, 20vw"
                  }
                />
                <source
                  type="image/webp"
                  srcSet={[320, 640, 960]
                    .map(
                      (width) =>
                        `/brand/scenes/world-collection/${world.scene}-${width}-v1.webp ${width}w`,
                    )
                    .join(", ")}
                  sizes={
                    world.scene === "digital"
                      ? "(max-width: 759px) 100vw, 20vw"
                      : "(max-width: 759px) 50vw, 20vw"
                  }
                />
                <img
                  src={`/brand/scenes/world-collection/${world.scene}-640-v1.webp`}
                  width={1536}
                  height={1024}
                  alt={world.alt}
                  loading="lazy"
                  decoding="async"
                />
              </picture>
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

      <aside className={styles.welcome} aria-label="환영 보상 안내">
        <div className={styles.welcomeTitle}>
          <PutdukIcon name="spark" size={26} />
          <div>
            <span>처음 만나는 퍼뜩</span>
            <strong>최대 5,000원 환영 보상</strong>
          </div>
        </div>
        <p>
          자격 확인 후 전환되며,
          <br />첫 출금에 사전 입금은 필요하지 않습니다.
        </p>
        <Link href="/trial">
          조건 자세히 보기 <PutdukIcon name="arrow-right" size={18} />
        </Link>
      </aside>

      <section className="landing-trust shell" aria-labelledby="trust-title">
        <div>
          <p className="eyebrow">보상과 출금</p>
          <h2 className="ko-heading" id="trust-title">
            확정된 보상만, 실제 원화로.
          </h2>
          <p className="ko-copy">
            환영 보상은 자격 확인 후 한 번만 전환되며, 최대 5,000원까지예요.
          </p>
          <p className="ko-copy">
            잔액, 채굴 상태와 처리 결과는 확인된 정보만 표시합니다. 화면 효과가
            금액이나 완료를 대신하지 않습니다.
          </p>
        </div>
        <nav aria-label="신뢰 정보">
          <Link className="ko-copy" href="/verification">
            검증 원칙
          </Link>
          <Link className="ko-copy" href="/trial">
            무료 체험 안내
          </Link>
          <Link className="ko-copy" href="/withdrawal">
            출금 안내
          </Link>
          <Link className="ko-copy" href="/status">
            서비스 상태
          </Link>
          <Link className="ko-copy" href="/support">
            상담 안내
          </Link>
        </nav>
      </section>

      <section className={styles.faq} aria-labelledby="landing-faq-title">
        <div>
          <p className="eyebrow">시작하기 전에</p>
          <h2 id="landing-faq-title">
            궁금한 마음까지,
            <br />
            편안하게.
          </h2>
          <Link className={styles.textLink} href="/faq">
            자주 묻는 질문 모두 보기 <PutdukIcon name="arrow-right" size={18} />
          </Link>
        </div>
        <div className={styles.questions}>
          <details>
            <summary>
              처음 시작하려면 입금해야 하나요?<span aria-hidden="true">+</span>
            </summary>
            <p>
              PUTDUK START와 자격을 충족한 첫 출금에는 사전 입금이 필요하지
              않아요. 보상 전환 전 본인 확인 등 자격을 확인합니다.
            </p>
          </details>
          <details>
            <summary>
              체험 중에 보이는 값이 바로 현금인가요?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              체험 값과 실제 원화 지갑은 별개예요. 자격 확인 후 전환된 환영
              보상만 실제 KRW가 되며, 전환은 한 번만 가능합니다.
            </p>
          </details>
          <details>
            <summary>
              앱을 계속 켜 두어야 하나요?<span aria-hidden="true">+</span>
            </summary>
            <p>
              정해진 기간과 이용 조건 안에서는 화면을 꺼도 채굴이 진행돼요. 다시
              접속하면 내 채굴 기록과 확정된 보상을 확인할 수 있어요.
            </p>
          </details>
        </div>
      </section>

      <section
        className={styles.closing}
        aria-labelledby="landing-closing-title"
      >
        <BrandMark title="" />
        <p className="eyebrow">무료 체험으로 시작하는 퍼뜩 채굴</p>
        <h2 id="landing-closing-title">
          내 첫 채굴,
          <br />
          무료 체험으로 시작하세요.
        </h2>
        <MemberEntryLink
          className={`button button--primary ${styles.start}`}
          href="/signup"
        >
          무료로 채굴 체험하기 <PutdukIcon name="arrow-right" size={20} />
        </MemberEntryLink>
        <p>보상 전환과 출금에는 본인 확인 등의 조건이 적용됩니다.</p>
      </section>

      <footer className="site-footer shell landing-footer">
        <div className="brand-lockup brand-lockup--footer">
          <BrandMark title="" />
          <span>
            <strong>퍼뜩 채굴</strong>
            <small>PUTDUK MINING</small>
          </span>
        </div>
        <p className="ko-copy">작은 행동이 더 나은 내일을 만듭니다.</p>
        <nav aria-label="약관과 설치 안내">
          <Link href="/terms">이용약관</Link>
          {" · "}
          <Link href="/privacy">개인정보 처리방침</Link>
          {" · "}
          <Link href="/support#app-install">앱 설치 안내</Link>
        </nav>
        <span>© 2026 PUTDUK</span>
      </footer>
    </main>
  );
}
