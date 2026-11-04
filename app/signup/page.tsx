import type { Metadata } from "next";
import { SignupForm } from "@/app/signup/signup-form";
import { WorkroomAuth } from "@/components/workroom/identity";

export const metadata: Metadata = {
  title: "회원가입",
  robots: { follow: false, index: false },
};

export default function SignupPage() {
  return (
    <WorkroomAuth signup>
      <SignupForm />
    </WorkroomAuth>
  );
}
