import { ImageResponse } from "next/og";

export const alt = "Tune Companion — Shazam for Irish music, session recorder and tunebook";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fafaf8", padding: "68px 80px", color: "#171717" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30, fontWeight: 700 }}>
          <svg width="54" height="54" viewBox="0 0 100 100">
            <circle cx="17" cy="40" r="6.5" fill="#C8642A" />
            <circle cx="17" cy="60" r="6.5" fill="#C8642A" />
            <rect x="27" y="17" width="7.5" height="66" rx="3.75" fill="#1F3A2E" />
            <path d="M45.5 47 L53 76.5 L85 23.5" fill="none" stroke="#1F3A2E" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Tune Companion
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderRadius: 999, background: "#E4ECE6", color: "#1F3A2E", fontSize: 20, fontWeight: 600 }}>
          23,305 tunes from The Session
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ fontSize: 20, letterSpacing: 3.5, color: "#C8642A", textTransform: "uppercase", fontWeight: 700 }}>
          Shazam for Irish traditional music · Tunebook &amp; session recorder
        </div>
        <div style={{ fontSize: 80, lineHeight: 1.02, letterSpacing: -3.5, fontWeight: 600 }}>
          Learn the tunes. Join the session.
        </div>
        <div style={{ fontSize: 28, color: "#666761", maxWidth: 960, lineHeight: 1.38 }}>
          Name any tune playing in the room, record a full hour-long session on 5–10% battery, and turn the session report straight into your learning plan.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 36, fontSize: 22, color: "#1F3A2E", fontWeight: 600 }}>
        <span>34 MB on-device model</span>
        <span style={{ color: "#bdbcb5" }}>·</span>
        <span>5–10% battery / hr</span>
        <span style={{ color: "#bdbcb5" }}>·</span>
        <span>Automatic session setlists &amp; scores</span>
      </div>
    </div>,
    size,
  );
}
