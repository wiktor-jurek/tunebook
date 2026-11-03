"use client";

import { useEffect } from "react";
import { identifyUser, type Identity } from "@/lib/analytics";

// Tags this browser's Umami session with the signed-in account.
export function AnalyticsIdentity({ user }: { user: Identity }) {
  const { id, name, email } = user;
  useEffect(() => { identifyUser({ id, name, email }); }, [id, name, email]);
  return null;
}
