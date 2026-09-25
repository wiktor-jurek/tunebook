"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AuthForm({ mode, token }: { mode: "sign-in" | "sign-up" | "forgot" | "reset"; token?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "");
    const password = String(data.get("password") || "");
    try {
      if (mode === "sign-in") {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) throw new Error(result.error.message);
        router.push("/"); router.refresh();
      } else if (mode === "sign-up") {
        const result = await authClient.signUp.email({ email, password, name: String(data.get("name") || "") });
        if (result.error) throw new Error(result.error.message);
        setMessage("Check your email for a verification link before signing in.");
      } else if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
        if (result.error) throw new Error(result.error.message);
        setMessage("If an account exists for that address, a reset link is on its way.");
      } else {
        if (!token) throw new Error("Missing reset token");
        const result = await authClient.resetPassword({ newPassword: password, token });
        if (result.error) throw new Error(result.error.message);
        setMessage("Password updated. You can now sign in.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong"); }
    finally { setBusy(false); }
  }
  const title = { "sign-in": "Welcome back", "sign-up": "Create your account", forgot: "Reset your password", reset: "Choose a new password" }[mode];
  return <main className="auth-screen"><div className="auth-card"><Link href="/" className="brand auth-brand"><span className="brand-mark">𝄞</span><span>Tunebook</span></Link><p className="eyebrow">YOUR MUSIC, IN ONE PLACE</p><h1>{title}</h1><p className="page-subtitle">Keep your tunes close and ready to play.</p>
    <form onSubmit={submit} className="auth-form">
      {mode === "sign-up" && <label className="field-label">Name<Input name="name" autoComplete="name" required /></label>}
      {mode !== "reset" && <label className="field-label">Email<Input name="email" type="email" autoComplete="email" required /></label>}
      {mode !== "forgot" && <label className="field-label">Password<Input name="password" type="password" minLength={8} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} required /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
      <Button disabled={busy} className="auth-submit">{busy ? "Working…" : mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create account" : mode === "forgot" ? "Send reset link" : "Set password"}</Button>
    </form>
    {(mode === "sign-in" || mode === "sign-up") && <><div className="auth-divider">or</div><Button variant="outline" className="auth-submit" onClick={async () => { const result = await authClient.signIn.social({ provider: "google", callbackURL: "/" }); if (result.error) setError(result.error.message || "Google sign-in failed"); }}>Continue with Google</Button></>}
    <div className="auth-links">{mode === "sign-in" ? <><Link href="/forgot-password">Forgot password?</Link><span>New here? <Link href="/sign-up">Create account</Link></span></> : <Link href="/sign-in">Back to sign in</Link>}</div>
  </div></main>;
}
