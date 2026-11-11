import { z } from "zod";

export const DEFAULT_KRW_CONTACT_MESSAGE = "1:1 상담 후 계좌 발급";
export const krwDepositSettingsSchema = z
  .object({
    mode: z.enum(["ACCOUNT", "CONTACT"]),
    bank_name: z.string().trim().max(30),
    account_number: z.string().trim().max(30),
    account_holder: z.string().trim().max(40),
    contact_message: z.string().trim().min(2).max(200),
    version: z.number().int().positive(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== "ACCOUNT") return;
    if (
      value.bank_name.length < 2 ||
      value.account_holder.length < 2 ||
      !/^[0-9][0-9-]{6,28}[0-9]$/.test(value.account_number) ||
      value.account_number.replace(/-/g, "").length < 8 ||
      value.account_number.includes("--")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "은행명·예금주·계좌번호를 확인해 주세요.",
      });
    }
  });
export type KrwDepositSettings = z.infer<typeof krwDepositSettingsSchema>;

export function depositPresentation(settings: KrwDepositSettings | null) {
  return {
    instruction:
      settings?.mode === "ACCOUNT"
        ? {
            bankName: settings.bank_name,
            accountNumber: settings.account_number,
            accountHolder: settings.account_holder,
          }
        : null,
    contactOperator: settings?.mode !== "ACCOUNT",
    contactMessage:
      settings?.mode === "CONTACT"
        ? settings.contact_message
        : DEFAULT_KRW_CONTACT_MESSAGE,
  };
}
