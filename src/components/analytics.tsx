"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { trackPageView } from "@/lib/analytics";

export function Analytics() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  useEffect(() => { if (ready) trackPageView(pathname); }, [pathname, ready]);
  if (process.env.NODE_ENV !== "production") return null;
  return <Script id="libresession-analytics" src="https://analytics.jurek.dev/script.js"
    strategy="afterInteractive" defer data-website-id="48e712da-7618-450e-8c2f-88ba9f613eb7"
    data-domains="libresession.com,www.libresession.com" data-auto-track="false"
    data-exclude-search="true" data-exclude-hash="true" data-do-not-track="true"
    onReady={() => setReady(true)} />;
}
