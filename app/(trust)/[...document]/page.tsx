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
} from "@/lib/trust/public-content";
import {
  getPublicFactDisplayValue,
  getPublicFactLabel,
  getTrustNavigationLabel,
  localizePublicWorldNames,
} from "@/lib/trust/public-presentation";

import { PublicHelpDocument } from "./public-help-document";

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
    alternates: { canonical: document.path },
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
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: document.title,
    description: document.summary,
    inLanguage: "ko-KR",
    datePublished: TRUST_LAST_UPDATED,
    dateModified: TRUST_LAST_UPDATED,
    isPartOf: {
      "@type": "WebSite",
      name: "PUTDUK MINING",
      url: "https://mining.putduk.com",
    },
    mainEntityOfPage: `https://mining.putduk.com${document.path}`,
  };

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
      className="trust-document"
      data-ui-ready={path}
      data-ui-state="loaded"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <header className="trust-document__hero">
        <div>
          <p className="eyebrow">{getTrustNavigationLabel(document.path)}</p>
          <h1>{document.title}</h1>
          <p>{localizePublicWorldNames(document.summary)}</p>
        </div>
        <dl>
          <div>
            <dt>안내 버전</dt>
            <dd>{TRUST_CONTENT_VERSION}</dd>
          </div>
          <div>
            <dt>최근 수정일</dt>
            <dd>{TRUST_LAST_UPDATED}</dd>
          </div>
          <div>
            <dt>안내 주제</dt>
            <dd>{getTrustNavigationLabel(document.path)}</dd>
          </div>
        </dl>
      </header>

      {facts.length ? (
        <section className="trust-facts" aria-labelledby="facts-heading">
          <header>
            <p className="eyebrow">확인된 서비스 정보</p>
            <h2 id="facts-heading">공식 사실</h2>
          </header>
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

      <div className="trust-document__body">
        <div>
          {document.sections.map((section, index) => (
            <section key={section.heading} id={`section-${index + 1}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
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
        <aside>
          <PutdukIcon name="shield" size={24} />
          <p className="eyebrow">안내 원칙</p>
          <strong>확인되지 않은 값을 운영 사실처럼 표시하지 않습니다.</strong>
          <p className="ko-copy">
            현재 준비 상태와 실제 활성 상태를 구분하며, 변경은 버전과 적용일을
            함께 공개합니다.
          </p>
          <Link href="/verification">
            검증 원칙 보기
            <PutdukIcon name="arrow-right" size={17} />
          </Link>
        </aside>
      </div>
    </article>
  );
}
