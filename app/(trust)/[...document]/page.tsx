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

  return (
    <article className="trust-document">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <header className="trust-document__hero">
        <div>
          <p className="eyebrow">{document.eyebrow}</p>
          <h1>{document.title}</h1>
          <p>{document.summary}</p>
        </div>
        <dl>
          <div>
            <dt>CONTENT VERSION</dt>
            <dd>{TRUST_CONTENT_VERSION}</dd>
          </div>
          <div>
            <dt>LAST UPDATED</dt>
            <dd>{TRUST_LAST_UPDATED}</dd>
          </div>
          <div>
            <dt>CANONICAL PATH</dt>
            <dd>{document.path}</dd>
          </div>
        </dl>
      </header>

      {facts.length ? (
        <section className="trust-facts" aria-labelledby="facts-heading">
          <header>
            <p className="eyebrow">VERIFIED PUBLIC DATA</p>
            <h2 id="facts-heading">공식 사실</h2>
          </header>
          <div>
            {facts.map((fact) => (
              <article key={fact.key}>
                <span>{fact.key}</span>
                <strong>{fact.value}</strong>
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
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.items ? (
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>
          ))}
        </div>
        <aside>
          <PutdukIcon name="shield" size={24} />
          <p className="eyebrow">TRUST PRINCIPLE</p>
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
