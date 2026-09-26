import { ImageResponse } from "next/og";

export const alt = "PUTDUK MINING — 채굴의 시간을 신뢰 가능한 기록으로";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        background: "#070a0d",
        color: "#f4f7f5",
        display: "flex",
        fontFamily: "sans-serif",
        height: "100%",
        padding: "64px",
        position: "relative",
        width: "100%",
      }}
    >
      <div
        style={{
          backgroundImage:
            "linear-gradient(rgba(221,235,229,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(221,235,229,.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          display: "flex",
          inset: 0,
          position: "absolute",
        }}
      />
      <div
        style={{
          border: "1px solid rgba(221,235,229,.16)",
          borderRadius: "28px 8px 28px 8px",
          display: "flex",
          flex: 1,
          padding: "54px",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "72%",
          }}
        >
          <div
            style={{
              color: "#7ce7bd",
              display: "flex",
              fontSize: 22,
              letterSpacing: 5,
            }}
          >
            PUTDUK VIRTUAL MINING SYSTEM
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 74,
                fontWeight: 650,
                letterSpacing: -4,
              }}
            >
              채굴의 시간을,
            </div>
            <div
              style={{
                color: "#7ce7bd",
                display: "flex",
                fontSize: 74,
                fontWeight: 650,
                letterSpacing: -4,
              }}
            >
              신뢰 가능한 기록으로.
            </div>
          </div>
          <div style={{ color: "#74817c", display: "flex", fontSize: 22 }}>
            SERVER TIME · LEDGER FIRST · VERSIONED RULES
          </div>
        </div>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <div
            style={{
              alignItems: "center",
              border: "2px solid rgba(124,231,189,.5)",
              borderRadius: 999,
              display: "flex",
              height: 230,
              justifyContent: "center",
              width: 230,
            }}
          >
            <div
              style={{
                alignItems: "center",
                background: "rgba(124,231,189,.09)",
                border: "2px solid #7ce7bd",
                clipPath:
                  "polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%)",
                color: "#7ce7bd",
                display: "flex",
                fontSize: 48,
                fontWeight: 700,
                height: 138,
                justifyContent: "center",
                width: 138,
              }}
            >
              P
            </div>
          </div>
        </div>
      </div>
    </div>,
    size,
  );
}
