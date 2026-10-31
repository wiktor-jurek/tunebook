import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { updateBookPopularity } from "@/lib/book-popularity";
import { getBook, saveCatalogSetting, type BookSection } from "@/lib/library";
import { addToBook, createBook, deleteBook, moveBook, renameBook, setBookEmoji } from "@/lib/library-actions";
import { bookUrl } from "@/lib/mcp-config";
import { changeEntry, copySet, createSetFromTunes, reorderBook } from "@/lib/sets";
import { fail, guard, ok, responseFormat, toolError, tuneLine, tuneOut, tuneShape, uuid, type Context } from "@/mcp/format";

const sectionShape = z.object({
  entry_id: z.string(), kind: z.enum(["tune", "set"]), set_id: z.string().optional(), name: z.string().optional(), tunes: z.array(tuneShape),
});
const tuneRef = z.object({
  saved_tune_id: uuid("A tune already in your library").optional(),
  setting_id: z.number().int().positive().optional().describe("A catalog setting ID; it is saved to your library automatically"),
}).refine((ref) => (ref.saved_tune_id ? 1 : 0) + (ref.setting_id ? 1 : 0) === 1, "Give exactly one of saved_tune_id or setting_id");

function sectionsOut(sections: BookSection[], includeAbc: boolean) {
  return sections.map((section) => section.kind === "tune"
    ? { entry_id: section.entryId, kind: "tune" as const, tunes: [tuneOut(section.tune, includeAbc)] }
    : { entry_id: section.entryId, kind: "set" as const, set_id: section.setId, name: section.name, tunes: section.tunes.map((tune) => tuneOut(tune, includeAbc)) });
}

async function savedTuneId(userId: string, ref: { saved_tune_id?: string; setting_id?: number }) {
  return ref.saved_tune_id ?? saveCatalogSetting(userId, ref.setting_id!);
}

export function registerTunebookTools(server: McpServer, context: Context) {
  const { userId } = context;

  server.registerTool("libresession_get_tunebook", {
    title: "Get a tunebook",
    description: "Get a tunebook's contents in playing order: individual tunes and sets, each with the entry_id used to reorder or remove it, saved_tune_ids, keys, often-played stars (★) and optionally ABC notation. Works for your own tunebooks and ones shared with you.",
    inputSchema: {
      book_id: uuid("Tunebook ID"),
      include_abc: z.boolean().default(false).describe("Include ABC notation for every tune (long)"),
      response_format: responseFormat,
    },
    outputSchema: {
      id: z.string(), name: z.string(), emoji: z.string().nullable(), url: z.string(), owned: z.boolean(), link_visible: z.boolean(),
      sections: z.array(sectionShape), tune_count: z.number(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ book_id, include_abc, response_format }) => guard(async () => {
    const result = await getBook(userId, book_id);
    if (!result) return fail("Tunebook not found. Call libresession_get_library to list tunebook IDs.");
    const { book, sections, tunes } = result;
    const data = {
      id: book.id, name: book.name, emoji: book.emoji, url: bookUrl(book.id), owned: book.userId === userId, link_visible: book.linkVisible,
      sections: sectionsOut(sections, include_abc), tune_count: tunes.length,
    };
    const markdown = [
      `# ${book.emoji ?? "📘"} ${book.name}`, `${data.tune_count} tunes · ${data.url}${data.owned ? "" : " · shared with you (read-only)"}`, "",
      ...(data.sections.length ? data.sections.map((section, index) => section.kind === "tune"
        ? `${index + 1}. ${tuneLine(section.tunes[0])} — entry \`${section.entry_id}\``
        : [`${index + 1}. Set **${section.name}** — entry \`${section.entry_id}\`, set \`${section.set_id}\``, ...section.tunes.map((tune) => `   - ${tuneLine(tune)}`)].join("\n"))
        : ["This tunebook is empty."]),
    ].join("\n");
    return ok(data, markdown, response_format);
  }));

  if (!context.canWrite) return;

  server.registerTool("libresession_build_tunebook", {
    title: "Build a tunebook",
    description: `Create a complete tunebook in one call: makes the tunebook, saves each catalog setting to the library, adds the tunes in order and groups sections with 2+ tunes into named sets. Use libresession_search_catalog first to pick setting_ids.

Each section is either one tune or a set (2-10 tunes played together, in order). Example: sections=[{setting_ids:[1,2,3], set_name:"Morning reels"}, {setting_ids:[4]}].`,
    inputSchema: {
      name: z.string().min(1).max(80).describe("Tunebook name, 1-80 characters"),
      emoji: z.string().max(32).optional().describe("One emoji for the tunebook icon"),
      folder_id: uuid("Folder to put it in; omit for the top level").optional(),
      sections: z.array(z.object({
        setting_ids: z.array(z.number().int().positive()).min(1).max(10).describe("Catalog setting IDs in playing order"),
        set_name: z.string().max(80).optional().describe("Name for a set of 2+ tunes; omit to name it after its tunes"),
      })).min(1).max(100).describe("Tunebook contents in order"),
    },
    outputSchema: { book_id: z.string(), url: z.string(), tune_count: z.number(), set_count: z.number() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ name, emoji, folder_id, sections }) => guard(async () => {
    const all = sections.flatMap((section) => section.setting_ids);
    if (new Set(all).size !== all.length) return fail("Each setting_id can appear only once in a tunebook.");
    const bookId = await createBook(userId, { name, emoji, folderId: folder_id });
    let sets = 0;
    try {
      for (const section of sections) {
        const ids = [];
        for (const settingId of section.setting_ids) ids.push(await saveCatalogSetting(userId, settingId));
        if (ids.length > 1) { await createSetFromTunes(userId, bookId, ids, section.set_name); sets++; }
        else await addToBook(userId, { bookId, tuneId: ids[0] });
      }
    } catch (error) {
      // Report the partial book so the agent can fix or delete it rather than create a duplicate.
      const reason = (toolError(error).content[0] as { text: string }).text.replace(/^Error: /, "");
      return fail(`Tunebook ${bookId} was created but stopped partway: ${reason} Inspect it with libresession_get_tunebook, then continue with libresession_add_to_tunebook or remove it with libresession_delete_tunebook.`);
    }
    return ok({ book_id: bookId, url: bookUrl(bookId), tune_count: all.length, set_count: sets },
      `Created **${name}** with ${all.length} tunes in ${sections.length} sections (${sets} sets).\nID \`${bookId}\` · ${bookUrl(bookId)}`);
  }));

  server.registerTool("libresession_create_tunebook", {
    title: "Create an empty tunebook",
    description: "Create an empty tunebook. To create one with contents in a single step, use libresession_build_tunebook instead.",
    inputSchema: {
      name: z.string().min(1).max(80).describe("Tunebook name, 1-80 characters"),
      emoji: z.string().max(32).optional().describe("One emoji for the icon"),
      folder_id: uuid("Folder to put it in; omit for the top level").optional(),
    },
    outputSchema: { book_id: z.string(), url: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ name, emoji, folder_id }) => guard(async () => {
    const bookId = await createBook(userId, { name, emoji, folderId: folder_id });
    return ok({ book_id: bookId, url: bookUrl(bookId) }, `Created **${name}** — \`${bookId}\` · ${bookUrl(bookId)}`);
  }));

  server.registerTool("libresession_update_tunebook", {
    title: "Rename, re-icon or move a tunebook",
    description: "Change a tunebook's name, emoji icon (null clears it) and/or folder (null moves it to the top level). Omitted fields stay the same.",
    inputSchema: {
      book_id: uuid("Tunebook to change"),
      name: z.string().min(1).max(80).optional().describe("New name"),
      emoji: z.string().max(32).nullable().optional().describe("New emoji, or null to clear"),
      folder_id: uuid("Folder").nullable().optional().describe("Destination folder ID, or null for the top level"),
    },
    outputSchema: { book_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ book_id, name, emoji, folder_id }) => guard(async () => {
    if (name === undefined && emoji === undefined && folder_id === undefined) return fail("Pass at least one of name, emoji or folder_id.");
    if (name !== undefined) await renameBook(userId, { bookId: book_id, name, ...(emoji !== undefined ? { emoji } : {}) });
    else if (emoji !== undefined) await setBookEmoji(userId, book_id, emoji);
    if (folder_id !== undefined) await moveBook(userId, { bookId: book_id, folderId: folder_id });
    return ok({ book_id }, "Tunebook updated.");
  }));

  server.registerTool("libresession_add_to_tunebook", {
    title: "Add tunes or sets to a tunebook",
    description: "Append tunes and/or existing sets to the end of a tunebook, in the order given. Tunes can be saved tunes or catalog setting IDs (saved automatically). A tune already in the book as an individual entry is not duplicated. Adding a set absorbs individual entries of its tunes.",
    inputSchema: {
      book_id: uuid("Tunebook to add to"),
      tunes: z.array(tuneRef).max(100).default([]).describe("Tunes to append, each {saved_tune_id} or {setting_id}"),
      set_ids: z.array(z.uuid()).max(50).default([]).describe("Set IDs from other tunebooks (from libresession_get_library) to copy in; each copy is a new set of its own"),
    },
    outputSchema: { added_tunes: z.array(z.string()), added_sets: z.array(z.string()) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ book_id, tunes, set_ids }) => guard(async () => {
    if (!tunes.length && !set_ids.length) return fail("Pass at least one tune or set_id.");
    const added = [];
    for (const ref of tunes) {
      const tuneId = await savedTuneId(userId, ref);
      await addToBook(userId, { bookId: book_id, tuneId });
      added.push(tuneId);
    }
    const copies = [];
    for (const setId of set_ids) copies.push(await copySet(userId, book_id, setId));
    return ok({ added_tunes: added, added_sets: copies }, `Added ${added.length} tunes and ${set_ids.length} sets. Call libresession_get_tunebook to see the new order.`);
  }));

  server.registerTool("libresession_reorder_tunebook", {
    title: "Reorder a tunebook",
    description: "Set the full playing order of a tunebook's entries. Pass every entry_id from libresession_get_tunebook exactly once, in the new order. Sets move as one entry; reorder tunes inside a set with libresession_update_set.",
    inputSchema: { book_id: uuid("Tunebook to reorder"), entry_ids: z.array(z.uuid()).min(1).max(500).describe("All entry IDs in the new order") },
    outputSchema: { book_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ book_id, entry_ids }) => guard(async () => {
    await reorderBook(userId, book_id, entry_ids);
    return ok({ book_id }, "Tunebook reordered.");
  }));

  server.registerTool("libresession_remove_from_tunebook", {
    title: "Remove an entry from a tunebook",
    description: "Remove one entry (a tune or a whole set) from a tunebook. The tune or set stays in the library and in other tunebooks. To split a set back into individual tunes instead, use libresession_ungroup_set.",
    inputSchema: { book_id: uuid("Tunebook"), entry_id: uuid("Entry to remove, from libresession_get_tunebook") },
    outputSchema: { removed: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ book_id, entry_id }) => guard(async () => {
    await changeEntry(userId, book_id, entry_id, "remove");
    return ok({ removed: true }, "Entry removed from the tunebook.");
  }));

  server.registerTool("libresession_ungroup_set", {
    title: "Ungroup a set in a tunebook",
    description: "Replace a set entry in one tunebook with its tunes as individual entries, in the same place. The set itself stays available in the library and in other tunebooks.",
    inputSchema: { book_id: uuid("Tunebook"), entry_id: uuid("The set's entry ID, from libresession_get_tunebook") },
    outputSchema: { book_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ book_id, entry_id }) => guard(async () => {
    await changeEntry(userId, book_id, entry_id, "ungroup");
    return ok({ book_id }, "Set ungrouped in this tunebook.");
  }));

  server.registerTool("libresession_set_often_played", {
    title: "Star a tune as often played",
    description: "Mark or unmark a tune in a tunebook as often played in the session (★). The star belongs to that tunebook and covers every setting of the tune.",
    inputSchema: {
      book_id: uuid("Tunebook"),
      saved_tune_id: uuid("A tune in the tunebook"),
      often_played: z.boolean().describe("true to star, false to unstar"),
    },
    outputSchema: { tune_id: z.number(), often_played: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ book_id, saved_tune_id, often_played }) => guard(async () => {
    const result = await updateBookPopularity(userId, book_id, saved_tune_id, often_played);
    return ok({ tune_id: result.tuneId, often_played: result.oftenPlayed }, often_played ? "Starred as often played." : "Star removed.");
  }));

  server.registerTool("libresession_delete_tunebook", {
    title: "Delete a tunebook",
    description: "Permanently delete a tunebook, its often-played stars and its sharing settings. Saved tunes and sets stay in the library. This cannot be undone; confirm with the user first.",
    inputSchema: { book_id: uuid("Tunebook to delete") },
    outputSchema: { deleted: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ book_id }) => guard(async () => {
    await deleteBook(userId, book_id);
    return ok({ deleted: true }, "Tunebook deleted.");
  }));
}
