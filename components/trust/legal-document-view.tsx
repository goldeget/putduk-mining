import Link from "next/link";

import type { LegalDocument } from "@/lib/trust/legal-content";
import { PUBLIC_SUPPORT_CONTACT } from "@/lib/trust/public-contact";

import styles from "./legal-document-view.module.css";

const highlightHeadings = {
  "/terms": ["PUTDUK START 체험", "입금", "출금", "AI 안내"],
  "/privacy": [
    "가입할 때 받는 정보",
    "쓰는 목적",
    "마케팅 소식",
    "AI 질문과 답변",
  ],
} as const;

export function LegalDocumentView({
  document,
  structuredData,
}: {
  document: LegalDocument;
  structuredData: readonly Record<string, unknown>[];
}) {
  const highlights = document.sections.filter((section) =>
    highlightHeadings[document.path].some(
      (heading) => heading === section.heading,
    ),
  );

  return (
    <article
      className={styles.document}
      data-ui-ready={document.path}
      data-ui-state="loaded"
    >
      {structuredData.map((block) => (
        <script
          key={String(block["@type"])}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(block).replace(/</g, "\\u003c"),
          }}
        />
      ))}
      <header className={styles.hero}>
        <p className={styles.eyebrow}>이용 안내</p>
        <h1>{document.title}</h1>
        <p>{document.summary}</p>
        <div className={styles.documentLinks} aria-label="관련 문서와 문의">
          <Link href={document.path === "/terms" ? "/privacy" : "/terms"}>
            {document.path === "/terms"
              ? "개인정보 처리방침"
              : "서비스 이용약관"}
          </Link>
          <Link href="/support">고객지원</Link>
          <a href={`mailto:${PUBLIC_SUPPORT_CONTACT.email}`}>
            {PUBLIC_SUPPORT_CONTACT.email}
          </a>
        </div>
      </header>

      <section className={styles.summary} aria-labelledby="legal-summary-title">
        <h2 id="legal-summary-title">핵심 먼저 보기</h2>
        <p className={styles.summaryNote}>
          전문을 대체하지 않는 핵심 안내예요.
        </p>
        <div className={styles.summaryGrid}>
          {highlights.map((section) => (
            <article key={section.heading}>
              <h3>{section.heading}</h3>
              {(section.body.length ? section.body : (section.items ?? [])).map(
                (text) => (
                  <p key={text}>{text}</p>
                ),
              )}
            </article>
          ))}
        </div>
      </section>

      <div className={styles.readingLayout}>
        <nav className={styles.contents} aria-label={`${document.title} 목차`}>
          <h2>이 문서에서 확인할 내용</h2>
          <ol>
            {document.sections.map((section, index) => (
              <li key={section.heading}>
                <a href={`#legal-section-${index + 1}`}>
                  <span aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className={styles.fullText} data-legal-full-text>
          {document.sections.map((section, index) => (
            <section
              key={section.heading}
              id={`legal-section-${index + 1}`}
              aria-labelledby={`legal-heading-${index + 1}`}
            >
              <p className={styles.sectionNumber} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h2 id={`legal-heading-${index + 1}`}>{section.heading}</h2>
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
            </section>
          ))}
          <footer className={styles.documentDetails}>
            <dl>
              <div>
                <dt>동의 기록 버전</dt>
                <dd>{document.consentVersion}</dd>
              </div>
            </dl>
            <p>브라우저의 인쇄 기능으로 전문을 저장할 수 있어요.</p>
            <p>가입 중 열었다면 이전 탭으로 돌아가 계속 작성할 수 있어요.</p>
          </footer>
        </div>
      </div>
    </article>
  );
}
