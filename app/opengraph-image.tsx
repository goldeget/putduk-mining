import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

export const alt = "퍼뜩 채굴 — 작은 행동을 신뢰 가능한 기록으로";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const background = await readFile(
    path.join(process.cwd(), "public", "brand", "og", "putduk-og-base-v1.png"),
  );
  const backgroundUrl = `data:image/png;base64,${background.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        backgroundColor: "#070706",
        backgroundImage: `linear-gradient(90deg, rgba(7,7,6,.96) 0%, rgba(7,7,6,.77) 45%, rgba(7,7,6,.12) 78%), url(${backgroundUrl})`,
        backgroundPosition: "center",
        backgroundSize: "cover",
        color: "#f8f2e4",
        display: "flex",
        fontFamily: "sans-serif",
        height: "100%",
        padding: "64px 70px",
        position: "relative",
        width: "100%",
      }}
    >
      <div
        style={{
          border: "1px solid rgba(246,200,91,.38)",
          borderRadius: "34px 10px 34px 10px",
          display: "flex",
          flex: 1,
          padding: "52px",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "68%",
          }}
        >
          <div
            style={{
              color: "#f6c85b",
              display: "flex",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 6,
            }}
          >
            PUTDUK MINING
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 88,
                fontWeight: 800,
                letterSpacing: -7,
                lineHeight: 1,
              }}
            >
              퍼뜩
            </div>
            <div
              style={{
                color: "#f6c85b",
                display: "flex",
                fontSize: 54,
                fontWeight: 650,
                letterSpacing: -3,
                marginTop: 18,
              }}
            >
              지금, 더 나은 다음으로.
            </div>
          </div>
          <div
            style={{
              color: "#b8ad98",
              display: "flex",
              fontSize: 18,
              letterSpacing: 2,
            }}
          >
            확인된 기록 · 명확한 채굴 안내
          </div>
        </div>
      </div>
    </div>,
    size,
  );
}
