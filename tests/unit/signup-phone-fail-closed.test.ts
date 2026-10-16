import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkSignupPhoneAvailability,
  signupAction,
  type SignupActionState,
} from "@/app/signup/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

type PhoneRead = {
  data: unknown;
  error: { code?: string; message: string } | null;
};
const unavailableReads: {
  label: string;
  response?: PhoneRead;
  throws?: true;
}[] = [
  {
    label: "missing RPC code",
    response: {
      data: null,
      error: { code: "PGRST202", message: "Schema cache unavailable" },
    },
  },
  {
    label: "missing RPC message without code",
    response: {
      data: null,
      error: {
        message: "Could not find the function signup_phone_availability",
      },
    },
  },
  {
    label: "missing SQL function message",
    response: {
      data: null,
      error: { message: "Function signup_phone_availability does not exist" },
    },
  },
  {
    label: "failed read with misleading AVAILABLE data",
    response: {
      data: "AVAILABLE",
      error: { code: "57014", message: "Request timed out" },
    },
  },
  { label: "null response", response: { data: null, error: null } },
  { label: "malformed response", response: { data: true, error: null } },
  {
    label: "unexpected response object",
    response: { data: { availability: "AVAILABLE" }, error: null },
  },
  { label: "thrown read", throws: true },
];
const rpc =
  vi.fn<(name: string, args: Record<string, unknown>) => Promise<PhoneRead>>();
const signUp = vi.fn();
const previous: SignupActionState = {
  fieldErrors: {},
  message: "",
  status: "idle",
};

function signupForm(phone = "010-1234-5678") {
  const form = new FormData();
  const fields = {
    dateOfBirth: "1990-01-01",
    legalName: "테스트회원",
    loginId: "fixture_user",
    password: "Synthetic-only-password-123!",
    passwordConfirmation: "Synthetic-only-password-123!",
    phone,
    recoveryEmail: "signup-fixture@putduk.test",
    serviceTermsConsent: "on",
    privacyConsent: "on",
  };
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

function phoneRead(read: (typeof unavailableReads)[number] | PhoneRead) {
  rpc.mockImplementation(async (name) => {
    if (name === "is_login_id_available") return { data: true, error: null };
    if (name !== "signup_phone_availability") {
      throw new Error("Unexpected RPC");
    }
    if ("throws" in read && read.throws) throw new Error("Read unavailable");
    if ("response" in read && read.response) return read.response;
    if ("data" in read) return read;
    throw new Error("Missing fixture response");
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "sb_publishable_synthetic_fixture_only",
  );
  vi.mocked(createSupabaseAdminClient).mockReturnValue({
    rpc,
  } as unknown as ReturnType<typeof createSupabaseAdminClient>);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { signUp },
  } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  signUp.mockResolvedValue({
    data: { user: { id: "fixture-user", identities: [] }, session: null },
    error: null,
  });
  phoneRead({ data: "AVAILABLE", error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("signup phone checks before account creation", () => {
  it.each(unavailableReads)("checker rejects $label", async (read) => {
    phoneRead(read);
    expect(await checkSignupPhoneAvailability("010-1234-5678")).toBe("ERROR");
    expect(signUp).not.toHaveBeenCalled();
  });

  it.each(unavailableReads)(
    "final signup rejects $label without contacting Auth signUp",
    async (read) => {
      phoneRead(read);
      expect(await signupAction(previous, signupForm())).toEqual({
        fieldErrors: {},
        message:
          "휴대전화 번호를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        status: "error",
      });
      expect(signUp).not.toHaveBeenCalled();
    },
  );

  it("keeps an actual unavailable number blocked at both boundaries", async () => {
    phoneRead({ data: "UNAVAILABLE", error: null });
    expect(await checkSignupPhoneAvailability("010-1234-5678")).toBe(
      "UNAVAILABLE",
    );
    expect(await signupAction(previous, signupForm())).toMatchObject({
      status: "error",
      fieldErrors: {
        phoneE164: "이미 사용된 번호예요. 다른 번호를 입력해 주세요.",
      },
    });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects invalid phone input before any RPC or account creation", async () => {
    expect(await checkSignupPhoneAvailability("not-a-phone")).toBe("INVALID");
    expect(
      await signupAction(previous, signupForm("not-a-phone")),
    ).toMatchObject({
      status: "error",
      fieldErrors: { phoneE164: expect.any(String) },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("allows the real signup action after a successful AVAILABLE check", async () => {
    expect(await checkSignupPhoneAvailability("010-1234-5678")).toBe(
      "AVAILABLE",
    );
    const result = await signupAction(previous, signupForm());
    expect(result.status).toBe("confirmation");
    expect(signUp).toHaveBeenCalledOnce();
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "signup-fixture@putduk.test",
        options: expect.objectContaining({
          data: expect.objectContaining({ phone_e164: "+821012345678" }),
        }),
      }),
    );
    expect(rpc).toHaveBeenCalledWith("signup_phone_availability", {
      p_raw: "+821012345678",
    });
  });
});
