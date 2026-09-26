import { ImageResponse } from "next/og";

export const size = { height: 180, width: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#070a0d",
        borderRadius: 36,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "rgba(124,231,189,.1)",
          border: "5px solid #7ce7bd",
          clipPath:
            "polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%)",
          color: "#7ce7bd",
          display: "flex",
          fontFamily: "sans-serif",
          fontSize: 58,
          fontWeight: 700,
          height: 118,
          justifyContent: "center",
          width: 118,
        }}
      >
        P
      </div>
    </div>,
    size,
  );
}
