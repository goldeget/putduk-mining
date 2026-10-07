"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import type {
  ProductCategory,
  PublishedCatalogProduct,
} from "@/domain/products/published-catalog";
import { CatalogProduct, categoryLabels } from "./catalog-product-card";
import styles from "./published-catalog-view.module.css";

const filters = [
  "ALL",
  "KR_STOCK",
  "US_STOCK",
  "GOLD",
  "SILVER",
  "CRYPTO",
] as const;
type CatalogFilter = ProductCategory | "ALL";

/** This browse state filters public rows only; it never requests or selects an allocation. */
export function CatalogBrowse({
  products,
  heading,
  hero,
}: {
  products: PublishedCatalogProduct[];
  heading: ReactNode;
  hero: ReactNode;
}) {
  const controlId = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CatalogFilter>("ALL");
  const filtered = useMemo(() => {
    const needle = query.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
    return products.filter(
      (product) =>
        (category === "ALL" || product.category === category) &&
        (!needle ||
          [
            product.nameKo,
            product.nameEn,
            product.code,
            product.descriptionKo,
          ].some((value) =>
            value.normalize("NFKC").toLocaleLowerCase("ko-KR").includes(needle),
          )),
    );
  }, [products, query, category]);
  return (
    <div className={styles.browse}>
      <div className={styles.catalogToolbar}>
        {heading}
        <div className={styles.browseControls}>
          <label className={styles.search} htmlFor={`${controlId}-search`}>
            <span className={styles.screenReaderOnly}>상품 검색</span>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
              <circle
                cx="10.5"
                cy="10.5"
                r="7"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="m16 16 5 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              id={`${controlId}-search`}
              type="search"
              value={query}
              maxLength={120}
              placeholder="상품 이름을 검색하세요"
              aria-controls={`${controlId}-products`}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <fieldset className={styles.filters}>
            <legend className={styles.screenReaderOnly}>상품 분류</legend>
            {filters.map((filter) => (
              <label key={filter}>
                <input
                  type="radio"
                  name={`${controlId}-category`}
                  value={filter}
                  checked={category === filter}
                  aria-controls={`${controlId}-products`}
                  onChange={() => setCategory(filter)}
                />
                <span>
                  {filter === "ALL" ? "전체" : categoryLabels[filter]}
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </div>
      {hero}
      <section
        className={styles.productsSection}
        aria-label="공개 상품"
        id={`${controlId}-products`}
      >
        <header className={styles.resultsHeading}>
          <h2>공개 상품</h2>
          <p role="status" aria-live="polite">
            {filtered.length}개 상품
          </p>
        </header>
        <p className={styles.scopeNotice}>
          퍼뜩 채굴에 사용하는 상품이에요. 주식이나 투자 상품이 아니에요.
        </p>
        {filtered.length ? (
          <div className={styles.products}>
            {filtered.map((product) => (
              <CatalogProduct key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className={styles.noResults}>
            <h3>검색한 상품이 없어요</h3>
            <p>검색어를 바꾸거나 전체 분류를 선택해 주세요.</p>
          </div>
        )}
      </section>
    </div>
  );
}
