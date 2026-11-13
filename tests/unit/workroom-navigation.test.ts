// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemberSecondaryNavigation } from "../../components/workroom-app/member-secondary-navigation";
import {
  workroomPageTitle,
  workroomPrimaryHref,
} from "../../components/layout/workroom-navigation";

function navigation(pathname: string) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(MemberSecondaryNavigation, { pathname }),
  );
  return host;
}

describe("WORKROOM location continuity", () => {
  it.each([
    ["/menu/account", "내 정보"],
    ["/menu/notifications", "알림 설정"],
    ["/workroom/guide", "이용 안내"],
  ])(
    "keeps account navigation and current destination at %s",
    (path, label) => {
      const host = navigation(path);
      const menu = host.querySelector('nav[aria-label="내 정보 메뉴"]');
      expect(menu).not.toBeNull();
      expect(menu!.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
      expect(menu!.querySelector('a[aria-current="page"]')?.textContent).toBe(
        label,
      );
      expect(workroomPrimaryHref(path)).toBe("/menu/account");
      expect(workroomPageTitle(path)).toBe(label);
    },
  );

  it("keeps a legacy record in the record family without treating it as an account menu", () => {
    const host = navigation("/workroom/records/legacy");
    expect(host.querySelector('nav[aria-label="내역 종류"]')).not.toBeNull();
    expect(
      host.querySelector('a[aria-current="page"]')?.getAttribute("href"),
    ).toBe("/workroom/records");
    expect(workroomPageTitle("/workroom/records/legacy")).toBe(
      "잔액 변동 상세",
    );
    expect(workroomPrimaryHref("/workroom/records/legacy")).toBe(
      "/workroom/records",
    );
  });

  it("preserves primary support context and avoids a duplicated account submenu", () => {
    expect(workroomPrimaryHref("/workroom/support")).toBe("/workroom/support");
    expect(navigation("/workroom/support").querySelector("nav")).toBeNull();
    expect(workroomPageTitle("/menu/support")).toBe("고객지원");
    expect(workroomPageTitle("/notifications")).toBe("알림함");
  });
});
