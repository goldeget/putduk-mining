import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  getPublicFacts,
  getTrustDocument,
  TRUST_CONTENT_VERSION,
  TRUST_DOCUMENTS,
  TRUST_LAST_UPDATED,
} from "@/lib/workroom/public-content";
import {
  buildBreadcrumbStructuredData,
  publicLanguageAlternates,
} from "@/lib/trust/public-discovery";
import {
  getPublicFactDisplayValue,
  getPublicFactLabel,
  getTrustNavigationLabel,
  localizePublicWorldNames,
} from "@/lib/workroom/public-presentation";

import { PublicHelpDocument } from "./public-help-document";
import styles from "./trust-document.module.css";

type PageProps = {
  params: Promise<{ document: string[] }>;
};

export const dynamicParams = false;

function resolvePath(segments: string[]) {
  return `/${segments.join("/")}`;
}

export function generateStaticParams() {
  return TRUST_DOCUMENTS.map((document) => ({
    document: document.path.slice(1).split("/"),
  }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const path = resolvePath((await params).document);
  const document = getTrustDocument(path);

  if (!document) {
    return {};
  }

  return {
    title: document.title,
    description: document.summary,
    alternates: {
      canonical: document.path,
      languages: publicLanguageAlternates(document.path),
    },
    openGraph: {
      type: "article",
      title: document.title,
      description: document.summary,
      url: document.path,
      publishedTime: `${TRUST_LAST_UPDATED}T00:00:00+09:00`,
      modifiedTime: `${TRUST_LAST_UPDATED}T00:00:00+09:00`,
    },
  };
}

export default async function TrustDocumentPage({ params }: PageProps) {
  const path = resolvePath((await params).document);
  const document = getTrustDocument(path);

  if (!document) {
    notFound();
  }

  const facts = getPublicFacts(document.factKeys);
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: document.title,
      description: document.summary,
      inLanguage: "ko-KR",
      datePublished: TRUST_LAST_UPDATED,
      dateModified: TRUST_LAST_UPDATED,
      isPartOf: {
        "@type": "WebSite",
        name: "WORKROOM",
        url: "https://workroom.putduk.com",
      },
      mainEntityOfPage: `https://workroom.putduk.com${document.path}`,
    },
    buildBreadcrumbStructuredData({
      name: getTrustNavigationLabel(document.path),
      path: document.path,
    }),
  ];

  if (path === "/about" || path === "/faq" || path === "/how-it-works") {
    return (
      <PublicHelpDocument
        document={document}
        facts={facts}
        path={path}
        structuredData={structuredData}
      />
    );
  }

  return (
    <article
      className={styles.document}
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
      <header className={styles.hero}>
        <span className={styles.eyebrow}>
          {getTrustNavigationLabel(document.path)}
        </span>
        <h1>{document.title}</h1>
        <p>{localizePublicWorldNames(document.summary)}</p>
        <dl className={styles.metadata}>
          <div>
            <dt>현재 안내 버전</dt>
            <dd>{TRUST_CONTENT_VERSION}</dd>
          </div>
          <div>
            <dt>최근 수정일</dt>
            <dd>{TRUST_LAST_UPDATED}</dd>
          </div>
          {document.consentVersion ? (
            <div>
              <dt>동의 기록 버전</dt>
              <dd>{document.consentVersion}</dd>
            </div>
          ) : null}
        </dl>
      </header>
      <nav className={styles.contents} aria-label="문서 목차">
        {document.sections.map((section, index) => (
          <a key={section.heading} href={`#section-${index + 1}`}>
            {section.heading}
          </a>
        ))}
      </nav>
      {facts.length ? (
        <section className={styles.facts} aria-labelledby="facts-heading">
          <h2 id="facts-heading">확인된 서비스 정보</h2>
          <div>
            {facts.map((fact) => (
              <article key={fact.key}>
                <span>{getPublicFactLabel(fact.key)}</span>
                <strong>{getPublicFactDisplayValue(fact)}</strong>
                <p>{fact.description}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <div className={styles.body}>
        {document.sections.map((section, index) => (
          <section key={section.heading} id={`section-${index + 1}`}>
            <span className={styles.number} aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h2>{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{localizePublicWorldNames(paragraph)}</p>
              ))}
              {section.items ? (
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{localizePublicWorldNames(item)}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        ))}
      </div>
      <aside className={styles.note}>
        <PutdukIcon name="shield" size={22} />
        <div>
          <strong>안내와 기록을 함께 확인하세요.</strong>
          <p>변경된 안내는 버전과 적용일을 함께 공개합니다.</p>
        </div>
        <Link href="/verification">확인 기준 →</Link>
      </aside>
    </article>
  );
}
