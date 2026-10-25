import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "@/mcp/format";
import { registerCatalogTools } from "@/mcp/tools/catalog";
import { registerLibraryTools } from "@/mcp/tools/library";
import { registerSetTools } from "@/mcp/tools/sets";
import { registerSharingTools } from "@/mcp/tools/sharing";
import { registerTunebookTools } from "@/mcp/tools/tunebooks";

const instructions = `Libresession organises Irish and folk tunes from The Session (thesession.org) into personal tunebooks and sets.

Typical flow for "make me a tunebook of ...":
1. libresession_search_catalog with kind, tonic, mode and sort="popularity" to choose tunes. Each result has a setting_id.
2. libresession_build_tunebook with the setting_ids, grouped into sets of 2-3 tunes of the same kind where it suits a session.
3. Share the returned tunebook URL with the user.

IDs: catalog tune_id and setting_id are integers. Everything in the user's library (tunebooks, folders, sets, saved tunes, entries) uses UUIDs. Read tools return the IDs that write tools need.
Sets hold 2 or more tunes in playing order and can be reused across tunebooks. Deleting and email invitations are irreversible or outward-facing: confirm with the user first.`;

export function createLibresessionServer(context: Context) {
  const server = new McpServer({ name: "libresession-mcp-server", version: "1.0.0" }, { instructions });
  registerCatalogTools(server, context);
  registerLibraryTools(server, context);
  registerTunebookTools(server, context);
  registerSetTools(server, context);
  registerSharingTools(server, context);
  return server;
}
