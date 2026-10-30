import { ImageResponse } from "next/og";
import { getBookPreview } from "@/lib/library";

export const alt = "A shared tunebook";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The card a shared book shows in group chats: its name, what is in it, and what Tune Companion offers the reader.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const preview = await getBookPreview((await params).id);
  const title = preview?.name ?? "Tune Companion";
  const counts = preview ? [`${preview.tunes} ${preview.tunes === 1 ? "tune" : "tunes"}`, ...(preview.sets ? [`${preview.sets} ${preview.sets === 1 ? "set" : "sets"}`] : [])].join(", ") : "";
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fafaf8", padding: "72px 80px", color: "#171717" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30, fontWeight: 700 }}>
        <svg width="54" height="54" viewBox="0 0 100 100"><circle cx="17" cy="40" r="6.5" fill="#C8642A" /><circle cx="17" cy="60" r="6.5" fill="#C8642A" /><rect x="27" y="17" width="7.5" height="66" rx="3.75" fill="#1F3A2E" /><path d="M45.5 47 L53 76.5 L85 23.5" fill="none" stroke="#1F3A2E" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Tune Companion
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ fontSize: 22, letterSpacing: 4, color: "#777872", textTransform: "uppercase" }}>{preview ? `Shared by ${preview.owner}` : "Shared tunebook"}</div>
        <div style={{ fontSize: title.length > 40 ? 64 : 84, lineHeight: 1.05, letterSpacing: -3 }}>{title}</div>
        {counts && <div style={{ fontSize: 30, color: "#666761" }}>{counts}</div>}
      </div>
      <div style={{ fontSize: 28, color: "#1F3A2E" }}>Read the scores, play along, and see which ones you can play.</div>
    </div>,
    size,
  );
}
