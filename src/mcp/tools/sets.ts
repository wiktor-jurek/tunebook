import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSetFromTunes, deleteSet, editSet, getMySets } from "@/lib/sets";
import { fail, guard, ok, uuid, type Context } from "@/mcp/format";

export function registerSetTools(server: McpServer, context: Context) {
  const { userId } = context;
  if (!context.canWrite) return;

  server.registerTool("libresession_create_set", {
    title: "Group tunes into a set",
    description: "Create a set (2-100 tunes played together, in order) inside a tunebook. Tunes not yet in the tunebook are added; individual entries for these tunes are replaced by the set, placed where the first of them was. A set belongs to its tunebook (the session it is played at); to use it elsewhere, copy it with libresession_add_to_tunebook.",
    inputSchema: {
      book_id: uuid("Tunebook to create the set in"),
      saved_tune_ids: z.array(z.uuid()).min(2).max(100).describe("Saved tune IDs in playing order"),
      name: z.string().max(80).optional().describe('Custom name; omit to name it after its tunes ("Tune A / Tune B")'),
    },
    outputSchema: { set_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ book_id, saved_tune_ids, name }) => guard(async () => {
    const setId = await createSetFromTunes(userId, book_id, saved_tune_ids, name);
    return ok({ set_id: setId }, `Created set \`${setId}\`.`);
  }));

  server.registerTool("libresession_update_set", {
    title: "Edit a set",
    description: "Change a set's tunes, their playing order and/or its name. Omitted fields stay the same; saved_tune_ids replaces the whole membership.",
    inputSchema: {
      set_id: uuid("Set to edit"),
      saved_tune_ids: z.array(z.uuid()).min(2).max(100).optional().describe("New full list of saved tune IDs in playing order"),
      name: z.string().min(1).max(80).optional().describe("New custom name"),
      use_tune_names: z.boolean().optional().describe("true to drop the custom name and name the set after its tunes"),
    },
    outputSchema: { set_id: z.string(), name: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ set_id, saved_tune_ids, name, use_tune_names }) => guard(async () => {
    if (name && use_tune_names) return fail("Pass either name or use_tune_names, not both.");
    const set = (await getMySets(userId)).find((row) => row.id === set_id);
    if (!set) return fail("Set not found. Call libresession_get_library to list your set IDs.");
    const nextName = name ?? (use_tune_names || set.autoName ? undefined : set.name);
    await editSet(userId, set_id, nextName, saved_tune_ids ?? set.tunes.map((tune) => tune.id));
    const updated = (await getMySets(userId)).find((row) => row.id === set_id)!;
    return ok({ set_id, name: updated.name }, `Set updated: **${updated.name}**.`);
  }));

  server.registerTool("libresession_delete_set", {
    title: "Delete a set",
    description: "Delete a set. In its tunebook, its tunes stay as individual entries in the same place; saved tunes are not deleted. Confirm with the user first.",
    inputSchema: { set_id: uuid("Set to delete") },
    outputSchema: { deleted: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ set_id }) => guard(async () => {
    await deleteSet(userId, set_id);
    return ok({ deleted: true }, "Set deleted; its tunes remain as individual entries.");
  }));
}
