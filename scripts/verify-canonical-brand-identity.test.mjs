import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasApprovedAiIdentity } from "./verify-canonical-brand-identity.mjs";

test("active chat requires the real shared WORKROOM mark while retained mascot identity remains checked", () => {
  const chat = readFileSync(
    new URL("../components/product/putduk-ai-chat.tsx", import.meta.url),
    "utf8",
  );
  const mascot = readFileSync(
    new URL("../components/product/putduk-ai-mascot.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(hasApprovedAiIdentity(chat, "putduk-ai-chat.tsx"), true);
  assert.equal(hasApprovedAiIdentity(mascot, "putduk-ai-mascot.tsx"), true);
  assert.equal(
    hasApprovedAiIdentity(
      chat.replaceAll("WorkroomMark", "BrandMark"),
      "putduk-ai-chat.tsx",
    ),
    false,
  );
  assert.equal(
    hasApprovedAiIdentity(
      chat.replaceAll(
        "@/components/workroom/workroom-mark",
        "@/components/brand/brand-mark",
      ),
      "putduk-ai-chat.tsx",
    ),
    false,
  );
  assert.equal(
    hasApprovedAiIdentity(
      'import { WorkroomMark } from "@/components/workroom/workroom-mark";',
      "putduk-ai-chat.tsx",
    ),
    false,
  );
  assert.equal(
    hasApprovedAiIdentity(
      chat + "/brand/mascot/putduk-ai-help-face-",
      "putduk-ai-chat.tsx",
    ),
    false,
  );
  assert.equal(
    hasApprovedAiIdentity(
      mascot + "/brand/identity/20261013/",
      "putduk-ai-mascot.tsx",
    ),
    false,
  );
  assert.equal(hasApprovedAiIdentity(chat, "unreviewed.tsx"), false);
});
