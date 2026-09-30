import { MiningCore } from "../../../components/foundation/mining-core";
import { GuidedQuest } from "../../../components/product/guided-quest";
import { PageHeading } from "../../../components/product/page-heading";
import { Surface } from "../../../components/ui/surface";
import home from "../../../app/(product)/home/home.module.css";
import start from "../../../app/(product)/start/start.module.css";

// Production component/class hierarchy is retained; server values and command
// components are deliberately absent. This is not an authenticated route.
export function RouteMotionFixture({ kind }) {
  return (
    <main
      className="fixture-panel fixture-panel--wide"
      data-production-wrapper-replica={kind}
    >
      <p>
        회원 화면 CSS 래퍼 복제 · 합성 running props · 실제 인증/서버 흐름 아님
      </p>
      {kind === "home-motion" ? <HomeScene /> : <StartScene />}
      <div className="fixture-scroll-spacer">화면 밖 장면 정지 확인 영역</div>
    </main>
  );
}

function HomeScene() {
  return (
    <div className={home.page}>
      <header className={home.welcome}>
        <div className={home.welcomeCopy}>
          <p className="eyebrow">오늘 · 래퍼 검사</p>
          <h1 className={home.welcomeTitle}>채굴 공간의 버튼을 확인해요.</h1>
          <p className={home.welcomeLead}>
            서버 상태는 합성 props이며 금액·수량은 연결하지 않았습니다.
          </p>
        </div>
      </header>
      <section className={home.hero} aria-label="합성 채굴 상태 래퍼">
        <div className={home.summary}>
          <Surface as="article" className={home.summaryCard}>
            <span className={home.summaryLabel}>사용 가능 KRW · 미연결</span>
            <strong className={home.summaryValue}>—</strong>
            <p className={home.summaryHint}>
              실제 지갑을 읽거나 합산하지 않습니다.
            </p>
            <a className={home.summaryLink} href="#fixture-read-only">
              합성 읽기 링크
            </a>
          </Surface>
          <Surface as="article" className={home.summaryCard}>
            <span className={home.summaryLabel}>PUTDUK START · 미연결</span>
            <strong className={home.summaryValue}>—</strong>
            <div className={home.progress} aria-label="진행률 미연결">
              <span style={{ width: "0%" }} />
            </div>
            <p className={home.summaryHint}>체험 결과를 만들지 않습니다.</p>
          </Surface>
        </div>
        <Surface
          as="article"
          className={home.livingWorld}
          tone="raised"
          data-fixture-scene-panel
        >
          <div className={home.livingVisual}>
            <picture>
              <source
                type="image/avif"
                srcSet="/brand/worlds/orbital-earth-960-v1.avif"
              />
              <img
                src="/brand/worlds/orbital-earth-960-v1.webp"
                alt="우주에서 바라본 퍼뜩 채굴 월드"
                width="960"
                height="540"
                decoding="async"
              />
            </picture>
            <MiningCore running />
          </div>
          <div className={home.livingStatus}>
            <span className={home.liveStatus}>
              <i className={home.liveStatusDot} aria-hidden="true" />
              합성 진행 상태
            </span>
            <h2 className={home.livingStatusTitle}>한국 월드</h2>
            <p className={home.livingStatusLead}>
              서버 상태·정산은 이 검사에서 연결하지 않습니다.
            </p>
          </div>
        </Surface>
      </section>
    </div>
  );
}

function StartScene() {
  return (
    <div className={start.layout}>
      <GuidedQuest serverStage="ACTIVE" ownerId="protected-motion-fixture" />
      <PageHeading
        eyebrow="PUTDUK START · 래퍼 검사"
        title="채굴 공간의 버튼을 확인해요."
        lead="합성 running 상태이며 실제 체험·보상·자격과 연결하지 않습니다."
      />
      <section className={start.grid}>
        <Surface
          as="article"
          className={start.stage}
          data-quest-target="world"
          data-fixture-scene-panel
        >
          <div className={start.stageMeta} data-start-stage-meta>
            <span className={start.stageMetaLabel}>체험 · 한국</span>
            <strong className={start.stageStatus} data-start-status>
              합성 진행 상태
            </strong>
          </div>
          <div className={start.stageVisual}>
            <MiningCore running />
          </div>
          <div className={start.stageFooter} data-quest-target="progress">
            <div className={start.values}>
              <span>
                <small>무료 체험 사용량 · 미연결</small>
                <strong>—</strong>
              </span>
              <span>
                <small>체험 결과 · 미연결</small>
                <strong>—</strong>
              </span>
            </div>
            <div className={start.progress} aria-label="체험 사용량 미연결">
              <span style={{ width: "0%" }} />
            </div>
          </div>
        </Surface>
        <div className={start.stack}>
          <Surface
            as="article"
            className={start.commandCard}
            tone="raised"
            data-quest-target="action"
          >
            <p className="eyebrow">다음 행동 · 미연결</p>
            <h2>실제 명령은 실행하지 않습니다.</h2>
            <p>상태·명령 판단은 원래 서버 페이지의 책임입니다.</p>
            <button className="button button--secondary" type="button">
              검사용 읽기 버튼
            </button>
          </Surface>
          <Surface
            as="article"
            className={start.ruleCard}
            data-quest-target="boundary"
          >
            <p className="eyebrow">체험과 실제 잔액 · 래퍼 검사</p>
            <ul>
              <li>실제 지갑·체험 결과는 연결하지 않습니다.</li>
              <li>합성 running props만 사용합니다.</li>
              <li>이 화면에서 명령은 실행하지 않습니다.</li>
              <li>실제 서버 흐름의 완료 증거가 아닙니다.</li>
            </ul>
          </Surface>
        </div>
      </section>
    </div>
  );
}
