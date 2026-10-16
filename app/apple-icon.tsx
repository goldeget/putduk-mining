import { ImageResponse } from "next/og";
import {
  PUTDUK_SYMBOL_PATH,
  PUTDUK_SYMBOL_VIEW_BOX,
} from "@/components/brand/putduk-symbol";

export const size = { height: 180, width: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#101a2b",
        borderRadius: 36,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <svg viewBox={PUTDUK_SYMBOL_VIEW_BOX} width="132" height="132">
        <path fill="#e8c983" fillRule="evenodd" d={PUTDUK_SYMBOL_PATH} />
      </svg>
    </div>,
    size,
  );
}
