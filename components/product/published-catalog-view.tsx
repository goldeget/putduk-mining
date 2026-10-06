import Link from "next/link";
import type { Route } from "next";

import { GlobalPavilion } from "@/components/brand/global-pavilion";
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
    <GlobalPavilion
      className={styles.scene}
      sizes="(max-width: 767px) 100vw, (max-width: 1099px) 80vw, 65vw"
    />
  );
}

/** 분류를 설명하는 장식이다. 상품 장면·수익·실물 자산을 지정하지 않는다. */
function CategoryArtwork({
  category,
  productId,
}: {
  category: ProductCategory;
  productId: string;
}) {
  const metalId = `catalog-metal-${productId}`;
  const glassId = `catalog-glass-${productId}`;
  return (
    <span
      className={styles.productArt}
      data-category={category}
      aria-hidden="true"
    >
      <svg
        data-catalog-artwork={category}
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 320 180"
      >
        <defs>
          <linearGradient id={metalId} x1="0" y1="0" x2="1" y2="1">
            <stop className={styles.artGlint} />
            <stop className={styles.artAccent} offset="0.35" />
            <stop className={styles.artShadow} offset="0.72" />
            <stop className={styles.artAccent} offset="1" />
          </linearGradient>
          <linearGradient id={glassId} x1="0" y1="0" x2="1" y2="1">
            <stop className={styles.artGlassHighlight} />
            <stop className={styles.artGlassShadow} offset="1" />
          </linearGradient>
        </defs>
        <g className={styles.artCircuit} fill="none" stroke="currentColor">
          <path d="M16 47h44l27 16M16 75h30l33 20M304 42h-36l-29 21M304 83h-29l-24 18M20 138h39l24-15M300 140h-31l-20-13" />
          <path d="M38 24v17m241-17v13M35 153h35m204 0h-32" />
          <circle cx="60" cy="47" r="2" />
          <circle cx="268" cy="42" r="2" />
        </g>
        <ellipse
          className={styles.artGround}
          cx="160"
          cy="147"
          rx="103"
          ry="17"
        />
        {category === "KR_STOCK" ? (
          <g>
            <path
              d="m83 80 97-35 67 46v17l-97 37-67-47Z"
              fill={`url(#${metalId})`}
            />
            <path
              d="m83 80 97-35 67 46-97 37Z"
              fill={`url(#${glassId})`}
              className={styles.artOutline}
            />
            <path d="m101 81 76-27 51 35-77 28Z" fill={`url(#${metalId})`} />
            <path d="m111 81 64-23 43 30-65 24Z" fill={`url(#${glassId})`} />
            <g
              className={styles.artDetail}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m122 80 49-17 30 20-48 17Zm13-3 14 9 28-10m-28 10v8" />
              <path d="m87 85-13 5m21 1-13 5m21 1-13 5m21 1-13 5m21 1-13 5m21 1-13 5m21 1-13 5m21 1-13 5M162 128l7 7m4-11 7 7m4-11 7 7m4-11 7 7m4-11 7 7m4-11 7 7m4-11 7 7m4-11 7 7" />
            </g>
          </g>
        ) : null}
        {category === "US_STOCK" ? (
          <g>
            <path
              d="m86 73 30-12 25 16v65l-30 13-25-16Zm60-29 37-14 30 20v88l-37 15-30-20Zm68 43 25-10 20 13v47l-25 11-20-14Z"
              fill={`url(#${metalId})`}
            />
            <path
              d="m87 76 23 15v60l-23-14Zm60-28 29 19v81l-29-19Zm68 42 18 12v42l-18-12Z"
              fill={`url(#${glassId})`}
            />
            <g className={styles.artDetail} fill="none" stroke="currentColor">
              <path d="m94 87 10 7m-10 6 10 7m-10 6 10 7m50-57 15 10m-15 6 15 10m-15 6 15 10m-15 6 15 10m-15 6 15 10m54-19 8 5m-8 7 8 5m-8 7 8 5" />
              <path d="m113 89 20-8m-20 22 20-8m-20 22 20-8M181 65l24-10m-24 28 24-10m-24 28 24-10m-24 28 24-10m-24 28 24-10" />
            </g>
          </g>
        ) : null}
        {category === "GOLD" || category === "SILVER" ? (
          <g>
            <path
              d="m76 118 57-24 70 24v21l-56 25-71-25Zm101-14 46-19 37 27v22l-46 21-37-29Z"
              fill={`url(#${metalId})`}
            />
            <path
              d="m76 118 57-24 70 24-56 25Zm101-14 46-19 37 27-46 21Z"
              className={styles.artBevel}
            />
            <path
              d="m106 111 23-65 64-21 31 68-65 38Z"
              fill={`url(#${metalId})`}
              className={styles.artOutline}
            />
            <path
              d="m117 108 20-57 53-17 24 55-56 32Z"
              className={styles.artBevel}
            />
            <path
              d="m131 79 17-25 32-10 12 25-35 20Z"
              fill={`url(#${metalId})`}
            />
            <g className={styles.artDetail} fill="none" stroke="currentColor">
              <path d="m133 105 53-19m-58 9 53-19m-21 55v12l64-36V93M79 137l67 22m70-8 40-19" />
            </g>
          </g>
        ) : null}
        {category === "CRYPTO" ? (
          <g>
            <g
              className={styles.artDetail}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m91 67 39 18m61-18 37-17m-25 54 40 25m-95-9-48 18" />
              <path d="m73 43 23 12v26L73 94 50 81V55Zm178-15 20 11v23l-20 11-20-11V39Zm10 84 20 11v23l-20 11-20-11v-23ZM81 115l20 11v23l-20 11-20-11v-23Z" />
            </g>
            <path
              d="m166 37 48 27v54l-48 28-48-28V64Z"
              fill={`url(#${metalId})`}
              className={styles.artOutline}
            />
            <path
              d="m166 49 37 21v42l-37 22-37-22V70Z"
              fill={`url(#${glassId})`}
            />
            <path
              d="m166 63 24 14v27l-24 14-24-14V77Z"
              fill={`url(#${metalId})`}
            />
            <path
              d="m166 63 24 14-24 14-24-14Zm0 28v27"
              className={styles.artDetail}
              fill="none"
              stroke="currentColor"
            />
          </g>
        ) : null}
      </svg>
    </span>
  );
}

function CatalogProduct({ product }: { product: PublishedCatalogProduct }) {
  return (
    <details
      className={styles.productRow}
      data-availability={product.availability.state}
    >
      <summary>
        <CategoryArtwork category={product.category} productId={product.id} />
        <span className={styles.productCopy}>
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
            <span className={styles.disclosureMark} aria-hidden="true" />
          </span>
        </span>
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
              {hasProducts ? (
                <Link
                  className={`button button--primary ${styles.primaryAction}`}
                  href="/products/allocation"
                >
                  상품 선택
                  <PutdukIcon name="arrow-right" size={20} />
                </Link>
              ) : (
                <Link
                  className={`button button--primary ${styles.primaryAction}`}
                  href="/mining"
                >
                  채굴 보기
                  <PutdukIcon name="arrow-right" size={20} />
                </Link>
              )}
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
