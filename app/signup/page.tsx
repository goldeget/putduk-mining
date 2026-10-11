import type { Metadata } from "next";
import { SignupForm } from "@/app/signup/signup-form";
import { SignupExperience } from "@/components/auth/signup-experience";

export const metadata: Metadata = {
  title: "회원가입",
  robots: { follow: false, index: false },
};

export default function SignupPage() {
  return (
    <SignupExperience>
      <SignupForm />
    </SignupExperience>
  );
}
