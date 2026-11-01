import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export async function currentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
}

// Admin pages and APIs (training data, labelling, runs) answer 404 to everyone not listed in ADMIN_EMAILS (comma-separated).
export function isAdminEmail(email: string) {
  return (process.env.ADMIN_EMAILS ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

export async function adminUser() {
  const user = await currentUser();
  return user && isAdminEmail(user.email) ? user : null;
}

export async function requireAdmin() {
  const user = await adminUser();
  if (!user) notFound();
  return user;
}
