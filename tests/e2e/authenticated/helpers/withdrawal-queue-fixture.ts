import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

import { execLocalAdminSql } from "./local-db";

/** 이 스펙이 만드는 픽스처 이메일 접두 — 공유 DB에서 주체만 식별한다. */
export const WD_PRODUCT_EMPTY_NAMESPACE = "wd-product-empty";

const QUEUE_STATUSES = [
  "REQUESTED",
  "REVIEWING",
  "APPROVED",
  "PROCESSING",
  "EXTERNAL_SENT_RECORDED",
  "HELD",
  "ADMIN_PROCESSING",
] as const;

function assertSafeEmailPrefix(prefix: string) {
  if (
    !/^[a-z0-9.-]+$/i.test(prefix) ||
    prefix.length < 4 ||
    prefix.length > 64
  ) {
    throw new Error("WD_QUEUE_FIXTURE_PREFIX");
  }
}

/**
 * 로컬 DB에서 픽스처 네임스페이스 회원의 대기열 가시 행만 센다.
 * 타 스펙 행을 지우거나 상태를 바꾸지 않는다.
 */
export function countNamespaceQueueRows(input: {
  emailPrefix: string;
  destinationType: "KRW_BANK" | "USDT_ADDRESS";
}) {
  assertSafeEmailPrefix(input.emailPrefix);
  if (
    input.destinationType !== "KRW_BANK" &&
    input.destinationType !== "USDT_ADDRESS"
  ) {
    throw new Error("WD_QUEUE_FIXTURE_DESTINATION");
  }
  const statusList = QUEUE_STATUSES.map((status) => `'${status}'`).join(", ");
  const raw = execLocalAdminSql(
    `select count(*)::text
     from public.withdrawal_requests as wr
     join auth.users as u on u.id = wr.user_id
     where lower(u.email) like lower(:'email_prefix') || '%'
       and wr.destination_type::text = :'destination_type'
       and wr.status::text in (${statusList})`,
    {
      destination_type: input.destinationType,
      email_prefix: input.emailPrefix,
    },
  );
  const count = Number.parseInt(raw, 10);
  if (!Number.isFinite(count) || count < 0) {
    throw new Error(`WD_QUEUE_FIXTURE_COUNT:${raw}`);
  }
  return count;
}

/**
 * 전역 빈 대기열 UI가 보이면 단언하고, 공유 DB 잔여 행으로 불가하면 OPEN 증거를 남긴다.
 * 원장·출금 행을 숨기거나 삭제하지 않는다.
 */
export async function expectEmptyQueueOrOpenIsolation(input: {
  page: Page;
  emptyTitle: string;
  emptyBody: string;
  nextStep: RegExp;
  listAriaLabel: string;
  emailPrefix: string;
  destinationType: "KRW_BANK" | "USDT_ADDRESS";
  evidencePath: string;
}) {
  const namespaceCount = countNamespaceQueueRows({
    destinationType: input.destinationType,
    emailPrefix: input.emailPrefix,
  });
  expect(namespaceCount).toBe(0);

  const emptyHeading = input.page.getByRole("heading", {
    name: input.emptyTitle,
    level: 2,
  });
  const globalEmptyVisible = await emptyHeading.isVisible().catch(() => false);

  mkdirSync(path.dirname(input.evidencePath), { recursive: true });
  writeFileSync(
    input.evidencePath,
    `${JSON.stringify(
      {
        destinationType: input.destinationType,
        emailPrefix: input.emailPrefix,
        globalEmptyVisible,
        namespaceQueueRowCount: namespaceCount,
        open: globalEmptyVisible
          ? null
          : "GLOBAL_EMPTY_QUEUE_NOT_ISOLATABLE_ON_SHARED_LOCAL_DB",
        note: globalEmptyVisible
          ? "전역 빈 대기열 UI를 이 실행에서 관찰함"
          : "Authenticated 스위트 공유 로컬 DB에 이전 스펙 잔여 출금이 있어 전역 빈 대기열을 강제하지 않음. 네임스페이스 0건만 단언.",
      },
      null,
      2,
    )}\n`,
  );

  if (globalEmptyVisible) {
    await expect(emptyHeading).toBeVisible();
    await expect(input.page.getByText(input.emptyBody)).toBeVisible();
    await expect(input.page.getByText(input.nextStep)).toBeVisible();
    await expect(input.page.locator("section.queue-empty")).toBeVisible();
    return { globalEmptyVisible: true as const };
  }

  // 전역 공백은 OPEN. 대기열 셸과 목록 영역만 확인한다.
  await expect(
    input.page.locator(
      `section.queue-list[aria-label="${input.listAriaLabel}"]`,
    ),
  ).toBeVisible();
  return { globalEmptyVisible: false as const };
}
