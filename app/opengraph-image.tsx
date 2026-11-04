import { ImageResponse } from "next/og";
export const alt = "WORKROOM · 나의 흐름을 만드는 공간";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: 80,
        background: "#0c1727",
        color: "#e9f1fc",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          color: "#73efc3",
          fontSize: 30,
          letterSpacing: 8,
        }}
      >
        WORKROOM
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 64,
          fontWeight: 700,
          lineHeight: 1.3,
        }}
      >
        <span>흐름을 보고,</span>
        <span>순간을 선택하세요.</span>
      </div>
      <div style={{ display: "flex", fontSize: 23, color: "#a6b7ce" }}>
        무료 시뮬레이션 · 현금 전환 불가 연습 포인트
      </div>
    </div>,
    size,
  );
}
