import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { trackServer, type EventData } from "@/lib/server-analytics";
import type { Context } from "@/mcp/format";
import { registerCatalogTools } from "@/mcp/tools/catalog";
import { registerLibraryTools } from "@/mcp/tools/library";
import { registerSetTools } from "@/mcp/tools/sets";
import { registerSharingTools } from "@/mcp/tools/sharing";
import { registerTunebookTools } from "@/mcp/tools/tunebooks";

const instructions = `Tune Companion organises Irish and folk tunes from The Session (thesession.org) into personal tunebooks and sets.

Typical flow for "make me a tunebook of ...":
1. libresession_search_catalog with kind, tonic, mode and sort="popularity" to choose tunes. Each result has a setting_id.
2. libresession_build_tunebook with the setting_ids, grouped into sets of 2-3 tunes of the same kind where it suits a session.
3. Share the returned tunebook URL with the user.

IDs: catalog tune_id and setting_id are integers. Everything in the user's library (tunebooks, folders, sets, saved tunes, entries) uses UUIDs. Read tools return the IDs that write tools need.
Sets hold 2 or more tunes in playing order and can be reused across tunebooks. Deleting and email invitations are irreversible or outward-facing: confirm with the user first.`;

// Arguments become flat event data: scalars as-is, arrays as their length plus a short preview.
function argumentData(args: unknown): EventData {
  const data: EventData = {};
  if (!args || typeof args !== "object") return data;
  for (const [key, value] of Object.entries(args)) {
    if (key === "response_format") continue;
    if (Array.isArray(value)) { data[`arg_${key}_count`] = value.length; data[`arg_${key}`] = JSON.stringify(value).slice(0, 300); }
    else if (value && typeof value === "object") data[`arg_${key}`] = JSON.stringify(value).slice(0, 300);
    else data[`arg_${key}`] = value as EventData[string];
  }
  return data;
}

// A compact summary of what the tool returned: counts, IDs, names and the first few tune titles.
function resultData(result: CallToolResult): EventData {
  const content = result.structuredContent ?? {};
  const data: EventData = {};
  for (const key of ["total", "count", "tune_count", "set_count", "book_id", "set_id", "folder_id", "name", "title", "url"]) {
    const value = content[key];
    if (typeof value === "string" || typeof value === "number") data[`result_${key}`] = value;
  }
  const tunes = (content.tunes ?? (Array.isArray(content.sections) ? content.sections.flatMap((section: { tunes?: unknown[] }) => section.tunes ?? []) : undefined)) as { title?: string }[] | undefined;
  if (Array.isArray(tunes)) data.result_titles = tunes.slice(0, 8).map((tune) => tune.title).filter(Boolean).join(" | ");
  if (result.isError) data.error = result.content.map((part) => part.type === "text" ? part.text : "").join(" ").slice(0, 300);
  return data;
}

function instrument(server: McpServer, context: Context) {
  const register = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as { registerTool: unknown }).registerTool = (name: string, config: unknown, callback: (...args: unknown[]) => Promise<CallToolResult>) =>
    register(name, config, async (...args: unknown[]) => {
      const started = Date.now();
      const input = args.length > 1 ? args[0] : undefined;
      let result: CallToolResult | undefined;
      try {
        result = await callback(...args);
        return result;
      } finally {
        trackServer("mcp_tool_called", {
          tool: name.replace(/^libresession_/, ""), outcome: !result || result.isError ? "error" : "success",
          duration_ms: Date.now() - started, client: context.client, user_agent: context.request?.headers.get("user-agent"),
          ...argumentData(input), ...(result ? resultData(result) : {}),
        }, { userId: context.userId, request: context.request, url: `/mcp/${name.replace(/^libresession_/, "")}`, serverAgent: true });
      }
    });
}

export function createTuneCompanionServer(context: Context) {
  const server = new McpServer({ name: "tune-companion-mcp-server", version: "1.0.0" }, { instructions });
  instrument(server, context);
  registerCatalogTools(server, context);
  registerLibraryTools(server, context);
  registerTunebookTools(server, context);
  registerSetTools(server, context);
  registerSharingTools(server, context);
  return server;
}
