import { AuthForm } from "@/components/auth-form";
import { authReturnPath } from "@/lib/auth-redirect";
export default async function SignUp({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <AuthForm mode="sign-up" returnTo={authReturnPath(next)} />;
}
