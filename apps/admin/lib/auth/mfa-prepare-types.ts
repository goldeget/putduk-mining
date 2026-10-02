export type AdminMfaEnrolmentPayload = {
  id: string;
  qrCode: string;
  secret: string;
};

export type AdminMfaPreparePayload =
  | {
      status: "ready";
      mode: "verify";
      factorId: string;
      enrolment: null;
      message: string;
    }
  | {
      status: "ready";
      mode: "enroll";
      factorId: string;
      enrolment: AdminMfaEnrolmentPayload;
      message: string;
    }
  | { status: "session_missing"; message: string }
  | { status: "retry"; message: string };
