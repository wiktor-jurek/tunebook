import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Analytics } from "@/components/analytics";
import { parseTheme, THEME_COLORS, THEME_COOKIE } from "@/lib/theme";
import { currentUser } from "@/lib/session";
import { getMode } from "@/lib/mode";
import { ListenTray } from "@/components/listen-tray";
import "./globals.css";

const description = "Learn the tunes, then join the session. Practice, tunebooks and a tune finder for Irish and folk music from The Session.";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.BETTER_AUTH_URL || "https://libresession.com"),
  title: { default: "Tune Companion", template: "%s | Tune Companion" },
  description,
  openGraph: { siteName: "Tune Companion", title: "Tune Companion", description, type: "website" },
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
  return <html lang="en" data-theme={theme === "system" ? undefined : theme}><body>{children}{user && <ListenTray signedIn dock={mode !== "session"} />}<Analytics /></body></html>;
}
