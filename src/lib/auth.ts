import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { db } from "@/db";
import { sendEmail } from "@/lib/email";
import { AUTH_ISSUER, MCP_RESOURCE, MCP_SCOPES } from "@/lib/mcp-config";
import * as authSchema from "@/db/auth-schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail(user.email, "Reset your Tunebook password", `Reset your password: ${url}`);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(user.email, "Verify your Tunebook email", `Verify your email: ${url}`);
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
  },
  hooks: {
    // CLI agents register http://localhost callbacks without application_type; RFC 8252 treats them as native apps.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/oauth2/register" || ctx.body?.application_type) return;
      const uris: unknown = ctx.body?.redirect_uris;
      if (Array.isArray(uris) && uris.length && uris.every(isLoopbackRedirect)) return { context: { body: { ...ctx.body, application_type: "native" } } };
    }),
  },
  // OAuth for MCP clients. Tokens, metadata and the resource verifier must agree on one issuer.
  disabledPaths: ["/token"],
  plugins: [
    jwt({ jwt: { issuer: AUTH_ISSUER } }),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      scopes: ["openid", "profile", "email", "offline_access", ...MCP_SCOPES],
      resources: [{ identifier: MCP_RESOURCE, name: "Libresession MCP", allowedScopes: [...MCP_SCOPES] }],
      clientRegistrationDefaultResources: [MCP_RESOURCE],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
  ],
});

function isLoopbackRedirect(uri: unknown) {
  if (typeof uri !== "string" || !URL.canParse(uri)) return false;
  const url = new URL(uri);
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
