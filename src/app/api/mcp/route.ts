import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { auth } from "@/lib/auth";
import { AUTH_ISSUER, MCP_RESOURCE, MCP_SCOPES } from "@/lib/mcp-config";
import { oauthClientName } from "@/lib/oauth-clients";
import { identifyUser } from "@/lib/user-analytics";
import { createLibresessionServer } from "@/mcp/server";

const resourceClient = oauthProviderResourceClient(auth).getActions();
// Refresh each agent user's Umami profile once per server process.
const identified = new Set<string>();

type ChallengeError = { statusCode?: number; headers?: HeadersInit; message?: string };

// Stateless: each request verifies its bearer token and gets a fresh server bound to that user.
async function handle(request: Request) {
  let payload: Awaited<ReturnType<typeof resourceClient.verifyAccessTokenRequest>>;
  try {
    payload = await resourceClient.verifyAccessTokenRequest(request, {
      verifyOptions: { audience: MCP_RESOURCE, issuer: AUTH_ISSUER },
      jwksUrl: `${AUTH_ISSUER}/jwks`,
      requiredScopes: ["tunebooks:read"],
    });
  } catch (error) {
    const challenge = error as ChallengeError;
    const status = challenge.statusCode === 403 ? 403 : 401;
    const headers = new Headers(challenge.headers);
    if (!headers.has("WWW-Authenticate")) {
      headers.set("WWW-Authenticate", `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/api/mcp", MCP_RESOURCE)}", scope="${MCP_SCOPES.join(" ")}"`);
    }
    return Response.json({ error: status === 403 ? "insufficient_scope" : "invalid_token" }, { status, headers });
  }
  if (!payload.sub) return Response.json({ error: "invalid_token" }, { status: 401 });
  const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
  const client = await oauthClientName(typeof payload.azp === "string" ? payload.azp : typeof payload.client_id === "string" ? payload.client_id : undefined);
  if (!identified.has(payload.sub)) {
    identified.add(payload.sub);
    void identifyUser(payload.sub, { mcp_client: client, uses_mcp: true }, { request, serverAgent: true });
  }
  const server = createLibresessionServer({ userId: payload.sub, canWrite: scopes.includes("tunebooks:write"), client, request });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export { handle as GET, handle as POST, handle as DELETE };
