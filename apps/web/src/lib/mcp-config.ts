export const APP_URL = (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
export const AUTH_ISSUER = `${APP_URL}/api/auth`;
export const MCP_RESOURCE = `${APP_URL}/api/mcp`;
export const MCP_SCOPES = ["tunebooks:read", "tunebooks:write"] as const;

export const bookUrl = (id: string) => `${APP_URL}/books/${id}`;
