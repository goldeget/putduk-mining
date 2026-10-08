import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeading } from "@/components/product/page-heading";
import productStyles from "@/components/product/product-experience.module.css";
import { ProductStatusPill } from "@/components/product/product-status-pill";
import { StatePanel } from "@/components/ui/states";
import {
  memberNoticeSchema,
  noticeTextBlocks,
} from "@/domain/content/member-notice";
import {
  formatNoticePublishedAt,
  isMemberVisibleNotice,
} from "@/domain/events/member-read-model";
import { requirePageUser } from "@/lib/auth/session";
import styles from "./notice.module.css";

/** New local implementation; historical complete notice UI source is unknown. */
export default async function NoticeDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) notFound();
  const path = `/events/notices/${slug}`;
  const identity = await requirePageUser(path);
  const now = new Date().toISOString();
  const { data, error } = await identity.supabase
    .from("notices")
    .select(
      "id,slug,title_ko,summary_ko,body_markdown,status,published_at,expires_at,is_pinned",
    )
    .eq("slug", slug)
    .eq("status", "PUBLISHED")
    .lte("published_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  if (error)
    return (
      <div className={productStyles.eventPage} data-ui-state="error">
        <PageHeading
          eyebrow="NOTICE"
          title="공지"
          lead="퍼뜩 채굴의 이용 안내를 확인하세요."
        />
        <StatePanel
          tone="error"
          title="공지를 불러오지 못했어요"
          description="인터넷 연결을 확인한 뒤 다시 시도해 주세요."
          action={
            <Link className="button button--secondary" href={path as Route}>
              다시 불러오기
            </Link>
          }
        />
      </div>
    );
  if (!data) notFound();
  const parsed = memberNoticeSchema.safeParse(data);
  if (!parsed.success)
    return (
      <div className={productStyles.eventPage} data-ui-state="error">
        <PageHeading
          eyebrow="NOTICE"
          title="공지"
          lead="퍼뜩 채굴의 이용 안내를 확인하세요."
        />
        <StatePanel
          tone="error"
          title="공지 내용을 확인할 수 없어요"
          description="잠시 후 다시 확인해 주세요."
          action={
            <Link
              className="button button--secondary"
              href={"/events" as Route}
            >
              목록으로
            </Link>
          }
        />
      </div>
    );
  const notice = parsed.data;
  if (!isMemberVisibleNotice(notice, now)) notFound();
  return (
    <div
      className={productStyles.eventPage}
      data-ui-ready="notice-detail"
      data-ui-state="loaded"
    >
      <PageHeading
        eyebrow="NOTICE"
        title={notice.title_ko}
        lead={notice.summary_ko}
      />
      <article className={styles.article} aria-label="공지 본문">
        <div className={styles.meta}>
          {notice.is_pinned ? (
            <ProductStatusPill label="중요" tone="info" />
          ) : null}
          <time dateTime={notice.published_at}>
            {formatNoticePublishedAt(notice.published_at)}
          </time>
        </div>
        <div className={styles.body}>
          {noticeTextBlocks(notice.body_markdown).map((block, index) =>
            block.kind === "heading" ? (
              <h2 key={index}>{block.lines[0]}</h2>
            ) : block.kind === "list" ? (
              <ul key={index}>
                {block.lines.map((line, lineIndex) => (
                  <li key={lineIndex}>{line}</li>
                ))}
              </ul>
            ) : (
              <p key={index}>{block.lines.join("\n")}</p>
            ),
          )}
        </div>
        <div className={styles.back}>
          <Link className="button button--secondary" href={"/events" as Route}>
            목록으로
          </Link>
        </div>
      </article>
    </div>
  );
}
