import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { db } from "@/db";
import { sendEmail } from "@/lib/email";
import { AUTH_ISSUER, MCP_RESOURCE, MCP_SCOPES } from "@/lib/mcp-config";
import { oauthClientName } from "@/lib/oauth-clients";
import { trackServer } from "@/lib/server-analytics";
import { identifyUser } from "@/lib/user-analytics";
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
  databaseHooks: {
    user: { create: { after: async (created, ctx) => {
      trackServer("user_signed_up", { method: authMethod(ctx?.path) }, { userId: created.id, request: ctx?.request, url: "/sign-up" });
    } } },
    // Every browser sign-in creates a session; identify the person so their events carry name and email.
    session: { create: { after: async (session, ctx) => {
      const method = authMethod(ctx?.path);
      trackServer("user_signed_in", { method }, { userId: session.userId, request: ctx?.request, url: "/sign-in" });
      await identifyUser(session.userId, { last_sign_in_method: method }, { request: ctx?.request });
    } } },
  },
  hooks: {
    // CLI agents register http://localhost callbacks without application_type; RFC 8252 treats them as native apps.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/oauth2/register" || ctx.body?.application_type) return;
      const uris: unknown = ctx.body?.redirect_uris;
      if (Array.isArray(uris) && uris.length && uris.every(isLoopbackRedirect)) return { context: { body: { ...ctx.body, application_type: "native" } } };
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (!["/oauth2/register", "/oauth2/consent", "/oauth2/token"].includes(ctx.path)) return;
      const returned = ctx.context.returned as { client_id?: string } | Error | undefined;
      const outcome = returned instanceof Error ? "error" : "success";
      // Registration and token calls come from agent HTTP clients, which Umami would discard as bots.
      const context = { request: ctx.request, userId: ctx.context.session?.user.id, url: "/oauth", serverAgent: ctx.path !== "/oauth2/consent" };
      if (ctx.path === "/oauth2/register") {
        const uris: unknown[] = Array.isArray(ctx.body?.redirect_uris) ? ctx.body.redirect_uris : [];
        trackServer("oauth_client_registered", { outcome, client: ctx.body?.client_name, application_type: ctx.body?.application_type,
          redirect_hosts: uris.map((uri) => typeof uri === "string" && URL.canParse(uri) ? new URL(uri).host : "invalid").join(", ") }, context);
      } else if (ctx.path === "/oauth2/consent") {
        const clientId = new URLSearchParams(typeof ctx.body?.oauth_query === "string" ? ctx.body.oauth_query : "").get("client_id");
        trackServer("oauth_consent_decided", { outcome, accepted: ctx.body?.accept === true, client: await oauthClientName(clientId) }, context);
      } else {
        trackServer("oauth_token_issued", { outcome, grant_type: ctx.body?.grant_type, client: await oauthClientName(ctx.body?.client_id) }, context);
      }
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
      // The plugin seeds resources when auth loads; skip that during `next build`, which only imports this file.
      ...(process.env.NEXT_PHASE === "phase-production-build" ? {} : {
        resources: [{ identifier: MCP_RESOURCE, name: "Libresession MCP", allowedScopes: [...MCP_SCOPES] }],
        clientRegistrationDefaultResources: [MCP_RESOURCE],
      }),
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

function authMethod(path: string | undefined) {
  if (!path) return "unknown";
  if (path.includes("google")) return "google";
  if (path.includes("email")) return "email";
  if (path.includes("verify")) return "email_verification";
  return path.replace(/^\//, "");
}
