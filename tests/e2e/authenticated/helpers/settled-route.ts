import { expect, type Page } from "@playwright/test";

/**
 * Next는 직전 스트림을 hidden id="S:*" 안에 잠시 둔다.
 * 역할 로케이터는 그 복사본을 세지 않지만, CSS·텍스트 로케이터는 둘로 센다.
 * 마커가 문서 전체에서 하나일 때만 이전 라우트가 사라진 것이다.
 */
export async function expectSettledRoute(page: Page, pathname: string) {
  const route = page.locator(`[data-ui-ready=${JSON.stringify(pathname)}]`);
  await expect(route).toHaveCount(1);
  return route;
}

/** Observe global uniqueness and visibility together, without a strict-locator gap. */
export async function expectSettledVisibleRoute(page: Page, pathname: string) {
  await expect
    .poll(() =>
      page.evaluate((path) => {
        const routes = document.querySelectorAll(
          `[data-ui-ready=${JSON.stringify(path)}]`,
        );
        const visible = (element: Element): boolean => {
          const style = getComputedStyle(element);
          if (style.display === "contents") {
            return Array.from(element.childNodes).some((child) => {
              if (child instanceof Element) return visible(child);
              if (child.nodeType !== Node.TEXT_NODE) return false;
              const range = document.createRange();
              range.selectNode(child);
              const rect = range.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
          }
          if (!element.checkVisibility() || style.visibility !== "visible")
            return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        return {
          count: routes.length,
          visible: routes.length === 1 && visible(routes[0]!),
        };
      }, pathname),
    )
    .toEqual({ count: 1, visible: true });
}
