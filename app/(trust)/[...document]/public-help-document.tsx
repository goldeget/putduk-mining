import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  TRUST_CONTENT_VERSION,
  TRUST_LAST_UPDATED,
  type PublicFact,
  type TrustDocument,
} from "@/lib/trust/public-content";
import {
  getPublicFactDisplayValue,
  getPublicFactLabel,
  getTrustNavigationLabel,
  localizePublicWorldNames,
} from "@/lib/trust/public-presentation";

import styles from "./public-help.module.css";

type PublicHelpDocumentProps = {
  document: TrustDocument;
  facts: readonly PublicFact[];
  path: string;
  structuredData: readonly { "@type": string }[];
};

export function PublicHelpDocument({
  document,
  facts,
  path,
  structuredData,
}: PublicHelpDocumentProps) {
  return (
    <article
      className={styles.page}
      data-ui-ready={path}
      data-ui-state="loaded"
    >
      {structuredData.map((block) => (
        <script
          key={block["@type"]}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(block).replace(/</g, "\\u003c"),
          }}
        />
      ))}
      <header className={styles.intro}>
        <p className="eyebrow">{getTrustNavigationLabel(document.path)}</p>
        <h1>{document.title}</h1>
        <p className={styles.summary}>
          {localizePublicWorldNames(document.summary)}
        </p>
        <p className={styles.meta}>
          <span>안내 버전 {TRUST_CONTENT_VERSION}</span>
          <span>최근 수정일 {TRUST_LAST_UPDATED}</span>
        </p>
      </header>

      {facts.length ? (
        <section className={styles.facts} aria-labelledby="facts-heading">
          <h2 id="facts-heading" className={styles.groupLabel}>
            공식 사실
          </h2>
          <ul className={styles.factList}>
            {facts.map((fact) => (
              <li key={fact.key}>
                <span>{getPublicFactLabel(fact.key)}</span>
                <strong>{getPublicFactDisplayValue(fact)}</strong>
                <p>{fact.description}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ol className={styles.rows}>
        {document.sections.map((section) => (
          <li key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{localizePublicWorldNames(paragraph)}</p>
            ))}
            {section.items ? (
              <ul className={styles.items}>
                {section.items.map((item) => (
                  <li key={item}>{localizePublicWorldNames(item)}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>

      <aside className={styles.note}>
        <PutdukIcon name="shield" size={22} />
        <p className="eyebrow">안내 원칙</p>
        <strong>확인되지 않은 값을 운영 사실처럼 표시하지 않습니다.</strong>
        <p>
          현재 준비 상태와 실제 활성 상태를 구분하며, 변경은 버전과 적용일을
          함께 공개합니다.
        </p>
        <Link href="/verification">
          검증 원칙 보기
          <PutdukIcon name="arrow-right" size={17} />
        </Link>
      </aside>
    </article>
  );
}
