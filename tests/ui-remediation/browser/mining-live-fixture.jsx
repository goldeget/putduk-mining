import { MiningReferenceScene } from "../../../components/mining-live/mining-reference-scene";
import { MiningLiveSummary } from "../../../components/product/mining-live-summary";
import styles from "../../../app/(product)/mining/page.module.css";
import { buildFixtureSnapshot, fixtureOwner } from "./mining-live-mock";

const authConfig = {
  url: "http://127.0.0.1:1",
  publishableKey: "local-fixture-publishable-key-not-a-secret",
};
const initialSnapshot = buildFixtureSnapshot();

/**
 * Real scene, energy layer and live summary in the production page's hero and
 * rail CSS. The page shell itself (server reads, navigation) is not mounted, and
 * the display server is a synthetic local stand-in.
 */
export function MiningLiveFixture() {
  const running =
    new URLSearchParams(window.location.search).get("running") !== "0";
  return (
    <div className={styles.page} data-fixture-mining-live>
      <section className={styles.controlRoom} aria-label="현재 채굴 현황">
        <div className={styles.hero}>
          <MiningReferenceScene running={running} className={styles.artwork} />
          <div className={styles.heroScrim} aria-hidden="true" />
          <header className={styles.heroCopy}>
            <div className={styles.brand}>
              <h1>퍼뜩 채굴</h1>
            </div>
            <p>걸음이 가치예요.</p>
          </header>
        </div>
        <section className={styles.rail} aria-label="채굴 현황">
          <div className={styles.sceneCaption}>
            <h2>실제 채굴 · 채굴 중</h2>
            <p>확인된 배분으로 채굴하고 있어요.</p>
          </div>
          <section
            className={styles.capacity}
            aria-labelledby="mining-capacity-title"
          >
            <h2 id="mining-capacity-title">채굴 용량</h2>
            <MiningLiveSummary
              ownerId={fixtureOwner}
              initialSnapshot={initialSnapshot}
              authConfig={authConfig}
            />
          </section>
        </section>
      </section>
    </div>
  );
}
