"use client";

import { ThemeControl } from "../../../components/system/theme-control";
import { ThemeRuntime } from "../../../components/system/theme-runtime";
import { themeBootstrap } from "../../../lib/design/theme";

/** Root-layout failures must keep their own document and readable fallback styles. */
export default function AdminGlobalError({
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta
          name="theme-color"
          content="#070706"
          media="(prefers-color-scheme: dark)"
        />
        <meta
          name="theme-color"
          content="#f8f4ea"
          media="(prefers-color-scheme: light)"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="admin-global-recovery">
        <ThemeRuntime />
        <style>{`
      .admin-global-recovery{margin:0;background:#070706;color:#f8f2e4;font:16px/1.6 "Malgun Gothic",system-ui,sans-serif}
      html[data-theme="light"] .admin-global-recovery{background:#f8f4ea;color:#17130d}
      .admin-global-recovery main{max-width:38rem;margin:8vh auto;padding:1.5rem;overflow-wrap:anywhere;word-break:keep-all}
      .admin-global-recovery h1{font-size:clamp(1.5rem,5vw,2rem);line-height:1.3}
      .admin-global-recovery button,.admin-global-recovery a{display:inline-block;min-height:44px;box-sizing:border-box;margin:.5rem .75rem .5rem 0;padding:.65rem 1rem;border:1px solid currentColor;border-radius:12px;font:inherit;color:inherit;background:transparent}
      .admin-global-recovery :focus-visible{outline:3px solid currentColor;outline-offset:3px}
      .admin-global-recovery .theme-control{display:flex;justify-content:flex-end;align-items:center;gap:.75rem;flex-wrap:wrap}
      .admin-global-recovery select{min-height:44px;font:inherit;border:1px solid currentColor;border-radius:8px;color:inherit;background:inherit;padding:.5rem}
      @media(prefers-color-scheme:light){html:not([data-theme]) .admin-global-recovery{background:#f8f4ea;color:#17130d}}
    `}</style>
        <main data-ui-state="error" role="alert">
          <ThemeControl />
          <p>퍼뜩 운영</p>
          <h1>운영 화면을 열지 못했습니다.</h1>
          <p>
            연결과 로그인 상태를 확인한 뒤 다시 시도해 주세요. 확인되지 않은
            작업 결과는 완료로 표시하지 않습니다.
          </p>
          <button
            type="button"
            onClick={retry ?? reset ?? (() => window.location.reload())}
          >
            다시 불러오기
          </button>
          {/* A root layout failure needs a fresh document without the failed router tree. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/login">로그인 상태 확인</a>
        </main>
      </body>
    </html>
  );
}
