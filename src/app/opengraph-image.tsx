import { ImageResponse } from "next/og";

// The link preview says what the landing page says: the promise, the line under it, and the microphone.
export const alt = "Tune Companion: listen to the session, learn the tunes, play them back";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30, background: "#fafaf8", color: "#171717" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontWeight: 700 }}>
        <svg width="50" height="50" viewBox="0 0 100 100">
          <circle cx="17" cy="40" r="6.5" fill="#C8642A" />
          <circle cx="17" cy="60" r="6.5" fill="#C8642A" />
          <rect x="27" y="17" width="7.5" height="66" rx="3.75" fill="#1F3A2E" />
          <path d="M45.5 47 L53 76.5 L85 23.5" fill="none" stroke="#1F3A2E" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Tune Companion
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: 74, lineHeight: 1.04, letterSpacing: -3.5, fontWeight: 650 }}><span>Listen to the session.</span><span>Learn the tunes. Play them back.</span></div>
      <div style={{ display: "flex", fontSize: 32, color: "#666761", textAlign: "center", maxWidth: 920, lineHeight: 1.35 }}>
        Upload or record a session to automatically build its tunebook, practise with real backing tracks, and track every tune in your repertoire.
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 120, height: 120, borderRadius: 60, background: "#1F3A2E", marginTop: 6 }}>
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="13" rx="3" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <path d="M12 19v3" />
        </svg>
      </div>
    </div>,
    size,
  );
}
