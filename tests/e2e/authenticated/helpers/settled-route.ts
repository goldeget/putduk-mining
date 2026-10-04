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
