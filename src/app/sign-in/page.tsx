import { AuthForm } from "@/components/auth-form";
import { authReturnPath } from "@/lib/auth-redirect";
export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <AuthForm mode="sign-in" returnTo={authReturnPath(next)} />;
}
