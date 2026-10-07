import Link from "next/link";
import type { Route } from "next";
import { SemiconductorTowerScene } from "@/components/brand/semiconductor-tower-scene";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import type {
  PublishedCatalogEvidence,
  PublishedCatalogRead,
} from "@/domain/products/published-catalog";
import { buildLoginPath } from "@/lib/auth/return-path";
import { CatalogBrowse } from "@/components/product/catalog-browse";
import { CatalogHeroScene } from "./catalog-hero-scene";
import styles from "./published-catalog-view.module.css";
import { RouteReloadButton } from "@/components/product/route-reload-button";

function formatDate(value: string, dateOnly = false) {
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    ...(!dateOnly ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
    timeZone: "Asia/Seoul",
  }).format(date);
}

function CatalogEvidence({ catalog }: { catalog: PublishedCatalogEvidence }) {
  return (
    <details className={styles.evidence}>
      <summary>공개 정보와 출처</summary>
      <dl className={styles.evidenceDates}>
        <div>
          <dt>자료 기준일</dt>
          <dd>
            <time dateTime={catalog.snapshotDate}>
              {formatDate(catalog.snapshotDate, true)}
            </time>
          </dd>
        </div>
        <div>
          <dt>승인일</dt>
          <dd>
            <time dateTime={catalog.approvedAt}>
              {formatDate(catalog.approvedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>공개일</dt>
          <dd>
            <time dateTime={catalog.publishedAt}>
              {formatDate(catalog.publishedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>안내 버전</dt>
          <dd>{catalog.version}</dd>
        </div>
      </dl>
      <ul className={styles.sources}>
        {catalog.sources.map((source, index) => (
          <li key={`${source.url}:${index}`}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.name}
              <span> (새 창)</span>
            </a>
            {source.snapshotOn ? (
              <span>
                자료 기준{" "}
                <time dateTime={source.snapshotOn}>
                  {formatDate(source.snapshotOn, true)}
                </time>
              </span>
            ) : null}
            {source.accessedOn ? (
              <span>
                확인일{" "}
                <time dateTime={source.accessedOn}>
                  {formatDate(source.accessedOn, true)}
                </time>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function PublishedCatalogView({ read }: { read: PublishedCatalogRead }) {
  const loaded = read.state === "loaded";
  const hasProducts = loaded && read.products.length > 0;
  const observedTime = formatDate(read.observedAt);
  const heading = (
    <header className={styles.pageHeading}>
      <h1>상품</h1>
      <p>새로운 채굴을 만나는 곳</p>
    </header>
  );
  const hero = (
    <section
      className={`${styles.hero}${hasProducts ? ` ${styles.loadedHero}` : ""}`}
      aria-labelledby="catalog-hero-title"
    >
      {hasProducts ? (
        <div className={styles.heroVisual}>
          <CatalogHeroScene
            className={styles.scene}
            priority
            sizes="(min-width: 980px) 80vw, 100vw"
          />
        </div>
      ) : (
        <SemiconductorTowerScene
          className={styles.scene}
          priority
          sizes="(min-width: 980px) 80vw, 100vw"
        />
      )}
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>상품 둘러보기</p>
        <h2 id="catalog-hero-title">
          {hasProducts ? (
            <>
              <span>기술이 만드는</span> <span>더 나은 내일</span>
            </>
          ) : (
            <>
              <span>공개된 상품이</span>
              <span>아직 없어요</span>
            </>
          )}
        </h2>
        <p>
          {hasProducts ? (
            <>공개된 정보와 제공 상태를 살펴보고 선택하세요.</>
          ) : (
            <>
              새 상품이 공개되면
              <br />
              여기서 확인할 수 있어요.
            </>
          )}
        </p>
        <Link
          className={`button button--primary ${styles.primaryAction}`}
          href={hasProducts ? "/products/allocation" : "/mining"}
        >
          {hasProducts ? "상품 선택" : "채굴 보기"}
          <PutdukIcon name="arrow-right" size={20} />
        </Link>
      </div>
    </section>
  );
  return (
    <div
      className={styles.page}
      data-ui-ready={read.state === "unauthenticated" ? undefined : "/products"}
      data-ui-state={read.state}
      data-observed-at={read.observedAt}
    >
      {read.state === "unauthenticated" ? (
        <>
          {heading}
          <section className={styles.recovery}>
            <h2>로그인이 필요해요</h2>
            <p>로그인한 뒤 상품을 확인해 주세요.</p>
            <Link
              className="button button--primary"
              href={buildLoginPath("/products") as Route}
            >
              로그인
            </Link>
          </section>
        </>
      ) : read.state === "error" ? (
        <>
          {heading}
          <section className={styles.recovery} role="alert">
            <p className={styles.eyebrow}>상품 다시 확인</p>
            <h2>상품을 불러오지 못했어요</h2>
            <p>잠시 후 다시 확인해 주세요.</p>
            <RouteReloadButton label="다시 확인" />
          </section>
        </>
      ) : (
        <>
          {hasProducts ? (
            <CatalogBrowse
              products={read.products}
              heading={heading}
              hero={hero}
            />
          ) : (
            <>
              {heading}
              {hero}
            </>
          )}
          {loaded ? <CatalogEvidence catalog={read.catalog} /> : null}
        </>
      )}
      {read.state !== "unauthenticated" && observedTime ? (
        <footer className={styles.observation}>
          <span>확인한 시각</span>
          <time dateTime={read.observedAt}>{observedTime} KST</time>
        </footer>
      ) : null}
    </div>
  );
}

export function PublishedCatalogLoading() {
  return (
    <div className={styles.page} data-ui-state="loading" aria-busy="true">
      <header className={styles.pageHeading}>
        <h1>상품</h1>
      </header>
      <p className={styles.loadingLabel} role="status">
        상품을 확인하고 있어요.
      </p>
      <div className={styles.loadingScene} aria-hidden="true" />
      <div className={styles.loadingLines} aria-hidden="true">
        <span />
        <span />
      </div>
    </div>
  );
}
