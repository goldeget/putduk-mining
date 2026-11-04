import { ImageResponse } from "next/og";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: "#0c1727",
        borderRadius: 36,
      }}
    >
      <svg width="140" height="140" viewBox="0 0 44 44">
        <path
          d="m9 15 6 15 7-12 7 12 6-15"
          fill="none"
          stroke="#73efc3"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>,
    size,
  );
}
