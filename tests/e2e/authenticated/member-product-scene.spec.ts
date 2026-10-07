import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import { assertTypographyClean } from "../../typography/helpers";
import {
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import { execLocalAdminSql } from "./helpers/local-db";
import { loginAsMember } from "./helpers/member-session";
import { awaitPaintedImages } from "./helpers/painted-images";
import { assertViewportFits } from "./helpers/viewport-geometry";

/** Real native publication/credit commands; isolated local source material only. */
function publishLocalGpuFixture(operator: string, member: string) {
  const catalog = randomUUID();
  const product = randomUUID();
  execLocalAdminSql(
    `begin;
    create temporary table scene_ctx as
    select :'catalog'::uuid catalog, :'product'::uuid product, :'operator'::uuid operator,
      s.id session, s.auth_session_id, clock_timestamp()+interval '1 second' publish_at,
      null::jsonb review from public.admin_sessions s
      where s.user_id=:'operator'::uuid order by s.created_at desc limit 1;
    insert into public.product_catalog_versions(id,version,snapshot_date,methodology,source_references,content_digest,proposed_by)
    select catalog,(select max(version)+1 from public.product_catalog_versions),current_date,
      'Isolated browser illustration binding fixture; no live investment or economic publication',
      '[{"name":"Local scene verification source","url":"https://putduk.test/scene-source"}]',
      app_private.funding_engine_digest(jsonb_build_object('local_scene_catalog',catalog)),
      'LOCAL_BROWSER_TEST_ONLY' from scene_ctx;
    insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order)
    select product,catalog,(select id from public.asset_worlds where code='USA' limit 1),
      'NVDA','local-nvda-scene','US_STOCK','NVIDIA','NVIDIA',
      '실제 운영 상품이 아닌 로컬 장면 연결 검증 자료입니다.',1 from scene_ctx;
    create function pg_temp.publish_scene_step(op text) returns jsonb
    language plpgsql security invoker set search_path=pg_catalog as $$
    declare c record; token text:=gen_random_uuid()::text;
    begin
      select * into c from pg_temp.scene_ctx;
      -- The existing local fixture issues a scoped proof for the real enrolled
      -- AAL2 session. This gate tests native source binding, not the TOTP UI.
      perform public.issue_admin_step_up(c.session,c.operator,'PRODUCT_CATALOG',token,600);
      return public.manage_product_catalog(op,c.catalog,(c.review->>'revisionId')::uuid,
        coalesce(c.review->>'snapshotDigest',(public.read_product_catalog_review_state(
          c.catalog,c.operator,c.session,c.auth_session_id,'aal2')->'selected'->>'sourceDigest')),
        c.publish_at,c.operator,c.session,c.auth_session_id,'aal2',token,
        'Isolated scene binding native source verification',c.catalog::text||':'||op);
    end $$;
    do $$begin execute format('grant usage on schema %I to service_role',
      (select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
    grant select,update on scene_ctx to service_role;
    grant execute on function pg_temp.publish_scene_step(text) to service_role;
    select set_config('request.jwt.claims','{"role":"service_role"}',true);
    set local role service_role;
    update scene_ctx set review=pg_temp.publish_scene_step('PREVIEW');
    update scene_ctx set review=pg_temp.publish_scene_step('APPROVE');
    update scene_ctx set review=pg_temp.publish_scene_step('PUBLISH');
    select public.approve_deposit_request(public.create_deposit_request(:'member'::uuid,'KRW',
      (select (config->>'minimumPrincipalKrw')::bigint from app_private.economy_policy_published
        where effective_from<=clock_timestamp() and(effective_until is null or effective_until>clock_timestamp())),
      :'catalog'||':deposit'),:'operator'::uuid,
      (select (config->>'minimumPrincipalKrw')::bigint from app_private.economy_policy_published
        where effective_from<=clock_timestamp() and(effective_until is null or effective_until>clock_timestamp())),
      :'catalog'||':credit','Local confirmed principal fixture only',gen_random_uuid());
    reset role;
    select pg_sleep(greatest(0,extract(epoch from((select publish_at from scene_ctx)-clock_timestamp())))+0.001);
    set constraints all immediate;
    commit;`,
    { operator, member, catalog, product },
  );
  return { catalog, product };
}

test("L1 selected GPU art is responsive without fabricating session rewards", async ({
  page,
  browser,
}, info) => {
  const operator = await createConfirmedMember("scene-operator");
  const member = await createConfirmedMember("scene-owner");
  await grantAdminRole(operator.userId);
  await completeAdminLoginWithTotp(page, operator.email, operator.password);
  const ids = publishLocalGpuFixture(operator.userId, member.userId);
  const context = await browser.newContext({
    baseURL: `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3000"}`,
  });
  const memberPage = await context.newPage();
  try {
    await loginAsMember(memberPage, member, "/products/allocation");
    const choice = memberPage.getByRole("checkbox", {
      name: "NVIDIA",
      exact: true,
    });
    await expect(choice).toBeEnabled();
    await choice.check();
    await memberPage.getByLabel("원금 비율", { exact: false }).fill("100");
    await memberPage
      .getByRole("checkbox", { name: "상품과 배분 비율을 확인했어요." })
      .check();
    const responsePromise = memberPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/products/allocation" &&
        response.request().method() === "POST",
    );
    await memberPage
      .getByRole("button", { name: "배분 적용", exact: true })
      .click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.data.receipt.products).toEqual([
      { productId: ids.product, allocationBps: "10000" },
    ]);
    const browserHealth = {
      pageErrors: 0,
      consoleErrors: 0,
      failedAssets: 0,
      serverErrors: 0,
    };
    memberPage.on("pageerror", () => browserHealth.pageErrors++);
    memberPage.on("console", (message) => {
      if (message.type() === "error") browserHealth.consoleErrors++;
    });
    memberPage.on("requestfailed", (request) => {
      if (
        ["image", "font", "script", "stylesheet"].includes(
          request.resourceType(),
        )
      )
        browserHealth.failedAssets++;
    });
    memberPage.on("response", (response) => {
      if (
        new URL(response.url()).origin === new URL(memberPage.url()).origin &&
        response.status() >= 500
      )
        browserHealth.serverErrors++;
    });
    await memberPage.goto("/mining");
    await expect(
      memberPage.locator('[data-member-scene-binding="confirmed-allocation"]'),
    ).toHaveText("선택 상품 테마 · NVIDIA");
    const stage = memberPage.locator('[data-scene-family="AI_GPU_COMPUTE"]');
    await expect(stage).toHaveAttribute("data-scene-art", "ready");
    await expect(stage).toHaveAttribute("data-motion", "static");
    await expect(stage).toHaveAttribute("data-mining-running", "false");
    await expect(stage.locator("canvas")).toHaveCount(0);
    const records = [];
    for (const width of [320, 390, 834, 1440]) {
      await memberPage.setViewportSize({
        width,
        height: width === 834 ? 1112 : 900,
      });
      for (const theme of ["dark", "light"] as const) {
        await memberPage.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        await memberPage.getByLabel("화면 테마").first().selectOption(theme);
        await awaitPaintedImages(memberPage);
        const label = `nvda-selected-${width}-${theme}`;
        await assertViewportFits(memberPage, info, label);
        await assertTypographyClean(memberPage, label, info);
        expect(
          await memberPage
            .locator('[data-mining-value="money"]')
            .allTextContents(),
        ).not.toEqual(
          expect.arrayContaining([expect.stringMatching(/\d\.\d+원/)]),
        );
        const image = stage.locator("img");
        await expect(image).toHaveJSProperty("complete", true);
        const source = await image.evaluate(
          (element) => (element as HTMLImageElement).currentSrc,
        );
        expect(source).toContain(
          `/product-nvda-gpu-v1/product-nvda-gpu-v1-${theme}-${width < 700 ? "portrait" : "landscape"}-`,
        );
        const gpuFocusVisible = await image.evaluate((element) => {
          const image = element as HTMLImageElement;
          const bounds = image.getBoundingClientRect();
          const scale = Math.max(
            bounds.width / image.naturalWidth,
            bounds.height / image.naturalHeight,
          );
          const position = getComputedStyle(image)
            .objectPosition.split(" ")
            .map((value) => parseFloat(value) / 100);
          const landscape = image.currentSrc.includes("-landscape-");
          const x =
            bounds.left +
            (bounds.width - image.naturalWidth * scale) * position[0]! +
            image.naturalWidth * scale * (landscape ? 0.73 : 0.5);
          const y =
            bounds.top +
            (bounds.height - image.naturalHeight * scale) * position[1]! +
            image.naturalHeight * scale * 0.5;
          const hero = image
            .closest("[data-member-product-art]")!
            .getBoundingClientRect();
          return (
            x > hero.left && x < hero.right && y > hero.top && y < hero.bottom
          );
        });
        expect(
          gpuFocusVisible,
          `${label}: GPU focus remains within the unobstructed hero`,
        ).toBe(true);
        records.push({ width, theme, source: new URL(source).pathname });
        await info.attach(label, {
          body: await memberPage.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
        for (const [name, panel] of [
          [
            "capacity",
            memberPage.getByRole("region", { name: "채굴 용량", exact: true }),
          ],
          [
            "speed",
            memberPage
              .getByRole("definition")
              .filter({ hasText: /^1배$/ })
              .first(),
          ],
        ] as const) {
          await panel.evaluate((element) => {
            const main = element.closest("main")!;
            const bounds = element.getBoundingClientRect();
            main.scrollTo({
              top:
                main.scrollTop +
                bounds.top -
                main.getBoundingClientRect().top -
                (main.clientHeight - bounds.height) / 2,
              behavior: "instant",
            });
          });
          await expect(panel).toBeInViewport();
          await info.attach(`${label}-${name}-viewport`, {
            body: await memberPage.screenshot({ animations: "disabled" }),
            contentType: "image/png",
          });
        }
        await memberPage
          .getByRole("main")
          .evaluate((element) =>
            element.scrollTo({ top: 0, behavior: "instant" }),
          );
      }
    }
    await info.attach("nvda-selected-source-matrix", {
      body: JSON.stringify(records),
      contentType: "application/json",
    });
    expect(browserHealth).toEqual({
      pageErrors: 0,
      consoleErrors: 0,
      failedAssets: 0,
      serverErrors: 0,
    });
  } finally {
    await context.close();
  }
});
