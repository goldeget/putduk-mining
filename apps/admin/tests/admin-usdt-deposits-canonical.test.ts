import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { depositStatusLabel } from "@/app/(control)/_lib/format";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("admin USDT deposit queue — canonical model", () => {
  const pageSource = readFileSync(
    join(root, "app/(control)/deposits/usdt/page.tsx"),
    "utf8",
  );
  const actionsSource = readFileSync(
    join(root, "app/(control)/deposits/usdt/actions.ts"),
    "utf8",
  );
  const formSource = readFileSync(
    join(root, "app/(control)/deposits/usdt/confirm-form.tsx"),
    "utf8",
  );

  it("reads usdt_manual_deposits and does not treat legacy tables as member truth", () => {
    expect(pageSource).toContain('.from("usdt_manual_deposits")');
    expect(pageSource).toContain('eq("status", "SUBMITTED")');
    expect(pageSource).toContain("deposit_address_snapshot");
    expect(pageSource).toContain("network_snapshot");
    expect(pageSource).toContain("sent_usdt_amount");
    expect(pageSource).toContain("tx_hash");

    expect(pageSource).not.toContain('.from("crypto_deposits")');
    expect(pageSource).not.toContain('.from("deposit_requests")');
    expect(pageSource).not.toContain("deposit_requests!");
    expect(pageSource).not.toContain("received_amount_atomic");
    expect(pageSource).not.toContain("AWAITING_TRANSFER");
  });

  it("confirms through confirm_usdt_manual_deposit with the manual deposit id", () => {
    expect(actionsSource).toMatch(/rpc\(\s*"confirm_usdt_manual_deposit"/);
    expect(actionsSource).toContain("p_deposit_id");
    expect(actionsSource).toContain("p_credited_krw");
    expect(actionsSource).not.toContain("approve_deposit_request");
    expect(actionsSource).not.toContain("p_deposit_request_id");
    expect(formSource).toContain('name="depositId"');
    expect(formSource).not.toContain("suggestedKrw");
  });

  it("does not invent REJECTED monetary transition UI", () => {
    expect(pageSource).toMatch(/이 화면에서는 입금 확인만 할 수 있습니다/);
    expect(pageSource).toMatch(/반려는 처리할 수\s+없습니다/);
    expect(pageSource).not.toContain("reject_usdt_manual_deposit");
    expect(actionsSource).not.toContain("reject_usdt");
    expect(formSource).not.toContain("REJECT");
  });

  it("keeps Korean manual-deposit copy without a user USDT balance frame", () => {
    expect(pageSource).toContain("회원 USDT 잔액은 없습니다");
    expect(pageSource).toContain("원화 입금만 반영");
    expect(pageSource).not.toMatch(/USDT 잔액\s*(확인|조회|보유)/);
    expect(pageSource).not.toContain("내 USDT");
  });

  it("labels canonical deposit statuses for operators", () => {
    expect(depositStatusLabel("SUBMITTED")).toBe("확인 대기");
    expect(depositStatusLabel("CONFIRMED")).toBe("원화 반영 완료");
    expect(depositStatusLabel("REJECTED")).toBe("반려");
  });
});
