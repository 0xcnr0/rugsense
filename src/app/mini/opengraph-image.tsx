import { ImageResponse } from "next/og";

// Embed/OG image for the Mini App (also used as the Farcaster launch-card image).
// Asset-free — system fonts only, so it can't 404 or pull a missing file.
export const size = { width: 1200, height: 800 };
export const contentType = "image/png";
export const alt = "RugSense — scored launch intelligence for Base";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0b0d12",
          color: "#e6e8eb",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 64, fontWeight: 800 }}>RugSense</div>
        <div style={{ fontSize: 40, color: "#4f8cff", marginTop: 8, fontWeight: 700 }}>
          The launch-lifecycle risk desk for Base
        </div>
        <div style={{ fontSize: 30, color: "#9aa0a6", marginTop: 28, maxWidth: 980 }}>
          Every fresh token → AVOID / WATCH / HOT, with a public, verifiable hit rate.
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 40 }}>
          <span style={{ fontSize: 26, color: "#ea3943", fontWeight: 700 }}>● AVOID</span>
          <span style={{ fontSize: 26, color: "#f5a623", fontWeight: 700 }}>● WATCH</span>
          <span style={{ fontSize: 26, color: "#16c784", fontWeight: 700 }}>● HOT</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
