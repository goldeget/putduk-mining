import test from "node:test";
import assert from "node:assert/strict";
import { loadPackage, validatePackage, validDate } from "./validate.mjs";

const original = loadPackage();
const event = (bundle) => bundle.collections.events[0];
function rejects(code, mutate) {
  const bundle = structuredClone(original);
  mutate(bundle);
  const result = validatePackage(bundle);
  assert.equal(result.status, "FAIL");
  assert.ok(
    result.errors.some((issue) => issue.code === code),
    JSON.stringify(result.errors),
  );
}

test("complete Korean package passes only as an unpublished draft", () => {
  const result = validatePackage(original);
  assert.equal(result.status, "PASS_DRAFT_ONLY");
  assert.equal(result.counts.events, 30);
  assert.equal(result.production_allowed, false);
  assert.ok(
    result.publication_blockers.some(
      (issue) => issue.code === "POLICY_VALUE_REQUIRED",
    ),
  );
});
test("registration readiness cannot mistake draft validity for publication approval", () => {
  const result = validatePackage(original, { publication: true });
  assert.equal(result.status, "BLOCKED");
  assert.ok(
    result.publication_blockers.some(
      (issue) => issue.code === "APPROVED_CONTENT_COMMAND_REQUIRED",
    ),
  );
});
test("duplicate internal and per-table slugs are rejected", () => {
  rejects("DUPLICATE_SLUG", (b) => {
    b.collections.events[1].slug = event(b).slug;
  });
  rejects("DUPLICATE_STORAGE_SLUG", (b) => {
    b.collections.events[1].storage.slug = event(b).storage.slug;
  });
});
test("blank title/body and unknown DB fields are rejected", () => {
  rejects("EMPTY_TITLE", (b) => {
    event(b).storage.title_ko = "  ";
  });
  rejects("EMPTY_BODY", (b) => {
    event(b).metadata.body_markdown = "";
  });
  rejects("UNKNOWN_STORAGE_FIELD", (b) => {
    event(b).storage.body_markdown = "Invented column";
  });
});
test("invalid calendar dates, absent offsets and backwards windows are rejected", () => {
  assert.equal(validDate("2026-02-30T10:00:00Z"), false);
  assert.equal(validDate("2026-02-29T10:00:00Z"), false);
  assert.equal(validDate("2028-02-29T10:00:00+09:00"), true);
  assert.equal(validDate("2026-10-07T10:00:00"), false);
  assert.equal(validDate("2026-10-07T10:00:00+14:01"), false);
  rejects("INVALID_DATE", (b) => {
    event(b).storage.starts_at = "2026-02-30T10:00:00Z";
  });
  rejects("INVALID_DATE_ORDER", (b) => {
    const e = event(b);
    e.storage.starts_at = e.metadata.schedule.starts_at =
      "2026-10-08T00:00:00Z";
    e.storage.ends_at = e.metadata.schedule.ends_at = "2026-10-07T00:00:00Z";
  });
});
test("CTA, audience and notification protected-route allowlists fail closed", () => {
  rejects("MISSING_OR_UNSAFE_CTA", (b) => {
    event(b).metadata.cta.label = "";
  });
  rejects("MISSING_OR_UNSAFE_CTA", (b) => {
    event(b).metadata.cta.route = "//evil.invalid";
  });
  rejects("INVALID_AUDIENCE", (b) => {
    event(b).metadata.audience = "everyone";
  });
  rejects("NOTIFICATION_ROUTE_REJECTED", (b) => {
    b.collections.notifications[0].storage.route = "/support";
  });
});
test("unapproved rewards, numeric returns and fake approval are rejected", () => {
  rejects("UNAPPROVED_ECONOMIC_VALUE", (b) => {
    event(b).metadata.economy.values.bonus = "10000";
  });
  rejects("UNAPPROVED_NUMERIC_ECONOMICS", (b) => {
    event(b).metadata.body_markdown = "매일 10%를 지급합니다.";
  });
  rejects("UNAPPROVED_NUMERIC_ECONOMICS", (b) => {
    event(b).metadata.body_markdown = "0원 지급을 보장합니다.";
  });
  rejects("APPROVAL_NOT_VERIFIED", (b) => {
    event(b).metadata.approval.status = "APPROVED";
  });
  rejects("UNVERIFIED_ECONOMIC_APPROVAL", (b) => {
    b.collections.events[28].metadata.economy.policy_status = "APPROVED";
  });
});
test("mandatory safety copy and declared placeholders cannot disappear", () => {
  rejects("REQUIRED_PHRASE_MISSING", (b) => {
    b.collections.notices.find(
      (item) => item.slug === "notice-start-conversion",
    ).storage.body_markdown = "입금부터 해 주세요.";
  });
  rejects("VARIABLE_DECLARATION_MISMATCH", (b) => {
    event(b).metadata.body_markdown += " {{amount}}";
  });
  rejects("MALFORMED_VARIABLE", (b) => {
    event(b).metadata.body_markdown += " {{not-allowed}}";
  });
});
test("notification channels and push/in-app text must remain consistent", () => {
  rejects("PUSH_INAPP_MISMATCH", (b) => {
    b.collections.notifications[0].metadata.push.body_ko = "다른 내용";
  });
  rejects("INVALID_CHANNELS", (b) => {
    b.collections.notifications[0].metadata.channels = ["SMS"];
  });
});
test("publication state and missing FAQ categories fail closed", () => {
  rejects("DRAFT_STATUS_REQUIRED", (b) => {
    event(b).storage.status = "LIVE";
  });
  rejects("UNPUBLISHED_PACKAGE_REQUIRED", (b) => {
    event(b).storage.published_at = "2026-10-07T00:00:00Z";
  });
  rejects("FAQ_CATEGORY_MISSING", (b) => {
    b.collections.faq = b.collections.faq.filter(
      (item) => item.metadata.category !== "hold",
    );
  });
});
