import { CatalogMaterialArtwork } from "@/components/brand/catalog-material-artwork";
import { GoldCategoryArtwork } from "@/components/brand/gold-category-artwork";
import type {
  ProductCategory,
  PublishedCatalogProduct,
  PublishedProductAvailability,
} from "@/domain/products/published-catalog";
import styles from "./published-catalog-view.module.css";

export const categoryLabels: Record<ProductCategory, string> = {
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

export function CatalogProduct({
  product,
}: {
  product: PublishedCatalogProduct;
}) {
  return (
    <details
      className={styles.productRow}
      data-availability={product.availability.state}
    >
      <summary>
        <span className={styles.productCopy}>
          <span className={styles.category}>
            {categoryLabels[product.category]}
          </span>
          <strong className={styles.productName}>{product.nameKo}</strong>
          <span className={styles.productEnglish}>{product.nameEn}</span>
        </span>
        {product.category === "GOLD" ? (
          <span
            className={styles.productArt}
            data-category="GOLD"
            data-catalog-artwork="GOLD"
            aria-hidden="true"
          >
            <GoldCategoryArtwork sizes="(min-width: 980px) 220px, (min-width: 720px) 33vw, 33vw" />
          </span>
        ) : (
          <span
            className={styles.productArt}
            data-category={product.category}
            data-catalog-artwork={product.category}
            aria-hidden="true"
          >
            <CatalogMaterialArtwork category={product.category} />
          </span>
        )}
        <span className={styles.cardFooter}>
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
