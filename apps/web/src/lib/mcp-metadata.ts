import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { auth } from "@/lib/auth";
import { AUTH_ISSUER, MCP_RESOURCE, MCP_SCOPES } from "@/lib/mcp-config";

const resourceClient = oauthProviderResourceClient(auth).getActions();

// RFC 9728 metadata telling MCP clients which authorization server issues tokens for /api/mcp.
export async function protectedResourceMetadata() {
  const metadata = await resourceClient.getProtectedResourceMetadata({
    resource: MCP_RESOURCE,
    authorization_servers: [AUTH_ISSUER],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Tune Companion",
  });
  return Response.json(metadata, { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}

export const authorizationServerMetadata = oauthProviderAuthServerMetadata(auth, { headers: { "Access-Control-Allow-Origin": "*" } });
export const openIdConfiguration = oauthProviderOpenIdConfigMetadata(auth, { headers: { "Access-Control-Allow-Origin": "*" } });
