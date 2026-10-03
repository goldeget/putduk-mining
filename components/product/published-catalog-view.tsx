import Link from "next/link";
import type { Route } from "next";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import type {
  ProductCategory,
  PublishedCatalogEvidence,
  PublishedCatalogProduct,
  PublishedCatalogRead,
  PublishedProductAvailability,
} from "@/domain/products/published-catalog";
import { buildLoginPath } from "@/lib/auth/return-path";

import styles from "./published-catalog-view.module.css";
import { RouteReloadButton } from "./route-reload-button";

const categoryLabels: Record<ProductCategory, string> = {
  KR_STOCK: "한국 주식 테마",
  US_STOCK: "미국 주식 테마",
  GOLD: "금",
  SILVER: "은",
  CRYPTO: "디지털 자산 테마",
};

const availabilityLabels: Record<
  PublishedProductAvailability["state"],
  string
> = {
  available: "제공 중",
  scheduled: "제공 예정",
  paused: "제공 중단",
  retired: "제공 종료",
  unavailable: "제공 상태 확인 필요",
};

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

function CatalogEarth() {
  return (
    <picture className={styles.scene}>
      <source
        type="image/avif"
        srcSet="/brand/worlds/orbital-earth-960-v1.avif 960w, /brand/worlds/orbital-earth-1600-v1.avif 1600w, /brand/worlds/orbital-earth-2400-v1.avif 2400w"
        sizes="(max-width: 767px) 100vw, (max-width: 1099px) 80vw, 65vw"
      />
      <source
        type="image/webp"
        srcSet="/brand/worlds/orbital-earth-960-v1.webp 960w, /brand/worlds/orbital-earth-1600-v1.webp 1600w, /brand/worlds/orbital-earth-2400-v1.webp 2400w"
        sizes="(max-width: 767px) 100vw, (max-width: 1099px) 80vw, 65vw"
      />
      <img
        src="/brand/worlds/orbital-earth-960-v1.webp"
        alt=""
        width="1600"
        height="900"
        decoding="async"
      />
    </picture>
  );
}

function CatalogProduct({ product }: { product: PublishedCatalogProduct }) {
  return (
    <details
      className={styles.productRow}
      data-availability={product.availability.state}
    >
      <summary>
        <span className={styles.category}>
          {categoryLabels[product.category]}
        </span>
        <strong className={styles.productName}>{product.nameKo}</strong>
        <span className={styles.availability}>
          {availabilityLabels[product.availability.state]}
        </span>
        <span className={styles.disclosureLabel}>
          <span className={styles.openLabel}>자세히 보기</span>
          <span className={styles.closeLabel}>접기</span>
        </span>
        <span className={styles.disclosureMark} aria-hidden="true" />
      </summary>
      <div className={styles.productDetail}>
        <p>{product.descriptionKo}</p>
        {product.availability.availableFrom ||
        product.availability.availableTo ? (
          <dl className={styles.availabilityDates}>
            {product.availability.availableFrom ? (
              <div>
                <dt>제공 시작</dt>
                <dd>
                  <time dateTime={product.availability.availableFrom}>
                    {formatDate(product.availability.availableFrom)}
                  </time>
                </dd>
              </div>
            ) : null}
            {product.availability.availableTo ? (
              <div>
                <dt>제공 종료</dt>
                <dd>
                  <time dateTime={product.availability.availableTo}>
                    {formatDate(product.availability.availableTo)}
                  </time>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </details>
  );
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
  return (
    <div
      className={styles.page}
      data-ui-ready={read.state === "unauthenticated" ? undefined : "/products"}
      data-ui-state={read.state}
      data-observed-at={read.observedAt}
    >
      <header className={styles.pageHeading}>
        <h1>상품</h1>
        <p>새로운 채굴을 만나는 곳</p>
      </header>
      {read.state === "unauthenticated" ? (
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
      ) : read.state === "error" ? (
        <section className={styles.recovery} role="alert">
          <p className={styles.eyebrow}>상품 다시 확인</p>
          <h2>상품을 불러오지 못했어요</h2>
          <p>잠시 후 다시 확인해 주세요.</p>
          <RouteReloadButton label="다시 확인" />
        </section>
      ) : (
        <>
          <section
            className={`${styles.hero} ${hasProducts ? styles.loadedHero : styles.emptyHero}`}
            aria-labelledby="catalog-hero-title"
          >
            <CatalogEarth />
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>상품 둘러보기</p>
              <h2 id="catalog-hero-title">
                {hasProducts ? (
                  "상품 둘러보기"
                ) : (
                  <>
                    <span>공개된 상품이</span>
                    <span>아직 없어요</span>
                  </>
                )}
              </h2>
              {hasProducts ? (
                <p>
                  상품 정보와 제공 상태를
                  <br />
                  차분히 살펴보세요.
                </p>
              ) : (
                <p>
                  새 상품이 공개되면
                  <br />
                  여기서 확인할 수 있어요.
                </p>
              )}
              {!hasProducts ? (
                <Link
                  className={`button button--primary ${styles.primaryAction}`}
                  href="/mining"
                >
                  채굴 보기
                  <PutdukIcon name="arrow-right" size={20} />
                </Link>
              ) : null}
            </div>
          </section>
          {hasProducts ? (
            <section className={styles.products} aria-label="공개 상품">
              <p className={styles.scopeNotice}>
                퍼뜩 채굴에 사용하는 상품이에요. 주식이나 투자 상품이 아니에요.
              </p>
              {read.products.map((product) => (
                <CatalogProduct key={product.id} product={product} />
              ))}
            </section>
          ) : null}
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
