import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WorkroomLoading } from "@/components/ui/workroom-loading";
import { WORKROOM_MARK } from "@/components/workroom/brand";
import AdminRootLoading from "../../apps/admin/app/loading";
import AdminMembersLoading from "../../apps/admin/app/(control)/members/loading";
import WorkroomRouteLoading from "../../app/(product)/workroom/loading";
import { SubmitButton } from "../../apps/admin/components/operator-fields";
import { AuthSubmitButton } from "@/components/auth/auth-form-feedback";

const formStatus = vi.hoisted(() => ({ pending: false }));
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormStatus: () => formStatus,
}));

const root = process.cwd();
const source = readFileSync(
  resolve(root, "components/ui/workroom-loading.tsx"),
  "utf8",
);
const css = readFileSync(
  resolve(root, "components/ui/workroom-loading.module.css"),
  "utf8",
);

describe("공통 워크룸 로딩 표현", () => {
  it("공통 운영자 버튼은 실제 폼 대기 상태에서만 표시하고 비활성화한다", () => {
    formStatus.pending = true;
    const waiting = renderToStaticMarkup(
      createElement(
        SubmitButton,
        { pendingLabel: "승인 확인 중" } as ComponentProps<typeof SubmitButton>,
        "승인",
      ),
    );
    expect(waiting).toContain('disabled=""');
    expect(waiting).toContain('aria-busy="true"');
    expect(waiting).toContain('data-workroom-loading="inline"');
    expect(waiting.match(/role="status"/g)).toHaveLength(1);
    formStatus.pending = false;
    const ready = renderToStaticMarkup(
      createElement(SubmitButton, null, "승인"),
    );
    expect(ready).not.toContain('disabled=""');
    expect(ready).not.toContain("data-workroom-loading");
    expect(ready).toContain("승인");
  });

  it("인증 버튼은 기존 대기 알림 하나와 명시된 비활성 조건을 유지한다", () => {
    formStatus.pending = true;
    const waiting = renderToStaticMarkup(
      createElement(AuthSubmitButton, {
        label: "로그인",
        pendingLabel: "확인 중",
      }),
    );
    expect(waiting.match(/role="status"/g)).toHaveLength(1);
    expect(waiting).toContain('data-workroom-loading="inline"');
    expect(waiting).toContain('disabled=""');
    formStatus.pending = false;
    const blocked = renderToStaticMarkup(
      createElement(AuthSubmitButton, {
        label: "로그인",
        pendingLabel: "확인 중",
        disabled: true,
      }),
    );
    expect(blocked).toContain('disabled=""');
    expect(blocked).not.toContain("data-workroom-loading");
    expect(blocked).toContain("로그인");
  });
  it.each(["page", "panel", "inline"] as const)(
    "%s: W와 실제 대기 안내를 하나의 정중한 상태로 알린다",
    (variant) => {
      const html = renderToStaticMarkup(
        createElement(WorkroomLoading, {
          variant,
          label: "회원 기록을 불러오고 있어요",
        }),
      );
      expect(html.match(/role="status"/g)).toHaveLength(1);
      expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
      expect(html).toContain('aria-atomic="true"');
      expect(html).toContain("회원 기록을 불러오고 있어요");
      expect(html).toContain(WORKROOM_MARK.path);
      expect(html).toContain(`stroke="${WORKROOM_MARK.stroke}"`);
      expect(html).not.toContain('role="progressbar"');
      expect(html).not.toContain("aria-valuenow");
      if (variant !== "inline") {
        expect(html).toContain('data-ui-state="loading"');
        expect(html).toContain('aria-hidden="true"');
      }
    },
  );

  it("기존 상태 영역 안에서는 중복 알림 없이 표시한다", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        { role: "status", "aria-live": "polite" },
        createElement(WorkroomLoading, {
          label: "불러오는 중",
          variant: "inline",
          announce: false,
        }),
      ),
    );
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(html).toContain("불러오는 중");
  });

  it("버튼 안의 로딩은 블록 요소 없이 버튼 이름을 유지한다", () => {
    const html = renderToStaticMarkup(
      createElement(
        "button",
        { disabled: true, "aria-busy": true },
        createElement(WorkroomLoading, {
          label: "저장 확인 중",
          variant: "inline",
          announce: false,
        }),
      ),
    );
    expect(html).toContain("저장 확인 중");
    expect(html).not.toMatch(/<(?:section|div|p|h[1-6])\b/);
    expect(html).toContain('disabled=""');
  });

  it("관리자와 회원 경계가 별도 별칭 없이 같은 표현을 렌더링한다", () => {
    for (const Loading of [
      AdminRootLoading,
      AdminMembersLoading,
      WorkroomRouteLoading,
    ]) {
      const html = renderToStaticMarkup(createElement(Loading));
      expect(html).toContain(WORKROOM_MARK.path);
      expect(html.match(/role="status"/g)).toHaveLength(1);
    }
    expect(source).not.toMatch(/from ["']@\//);
    expect(source).not.toMatch(
      /setTimeout|setInterval|useEffect|useState|fetch\(/,
    );
  });

  it("줄어든 움직임 설정은 모든 로딩 애니메이션을 중단한다", () => {
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("transition: none");
    for (const selector of [
      ".loading",
      ".halo",
      ".mark",
      ".inlineMark",
      ".dots i",
      ".summary::after",
      ".card::after",
    ]) {
      expect(reduced).toContain(selector);
    }
    expect(css).toContain("var(--text-primary");
    expect(css).toContain("var(--surface-raised");
    expect(css).toContain("minmax(0, 1fr)");
  });

  it("기존 및 새 로딩 경계에 공통 표현을 빠짐없이 연결한다", () => {
    function boundaries(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap(
        (entry) => {
          const path = resolve(directory, entry.name);
          return entry.isDirectory()
            ? boundaries(path)
            : entry.name === "loading.tsx"
              ? [path]
              : [];
        },
      );
    }
    const files = [
      ...boundaries(resolve(root, "app")),
      ...boundaries(resolve(root, "apps/admin/app")),
    ];
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).toMatch(
        /WorkroomLoading|ProductRouteLoading|WithdrawalQueueLoading/,
      );
    }
  });
});
