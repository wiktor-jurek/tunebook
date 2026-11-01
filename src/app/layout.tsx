import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Analytics } from "@/components/analytics";
import { parseTheme, THEME_COLORS, THEME_COOKIE } from "@/lib/theme";
import { currentUser } from "@/lib/session";
import { getMode } from "@/lib/mode";
import { ListenTray } from "@/components/listen-tray";
import { NavigationProgress } from "@/components/navigation-progress";
import "./globals.css";
import { LayoutGuard } from "@/components/layout-guard";

const description = "Shazam for Irish traditional music, plus a personal tunebook and session recorder. Name any of 23,305 tunes from The Session by ear, record an hour-long pub session on 5–10% battery, and take the session report straight into your learning plan.";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.BETTER_AUTH_URL || "https://tunecompanion.com"),
  title: { default: "Tune Companion — Shazam for Irish Music, Session Recorder & Tunebook", template: "%s | Tune Companion" },
  description,
  keywords: [
    "Shazam for Irish music",
    "Shazam for trad music",
    "Irish tune finder",
    "identify Irish traditional tunes",
    "what tune is playing",
    "Irish session recorder",
    "The Session tunebook",
    "Irish trad repertoire tracker",
    "folk tune recognizer",
    "session learning plan",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    siteName: "Tune Companion",
    title: "Tune Companion — Shazam for Irish Music, Session Recorder & Tunebook",
    description,
    type: "website",
    locale: "en_IE",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tune Companion — Shazam for Irish Music, Session Recorder & Tunebook",
    description,
  },
  appleWebApp: { title: "Tune Companion", statusBarStyle: "default" },
};
export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    viewportFit: "cover",
    themeColor: theme === "system" ? [{ media: "(prefers-color-scheme: light)", color: THEME_COLORS.light }, { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark }] : THEME_COLORS[theme],
  };
}
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [cookieStore, user, { mode }] = await Promise.all([cookies(), currentUser(), getMode()]);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  // The listen tray lives here, above every page, so listening and recording carry on while moving between screens: the
  // deck at the foot of a phone, or a dock in the corner of a desktop.
  return <html lang="en" data-theme={theme === "system" ? undefined : theme}><body><Suspense><NavigationProgress /></Suspense>{children}{user && <ListenTray signedIn dock={mode !== "session"} />}<LayoutGuard mode={mode} /><Analytics /></body></html>;
}
