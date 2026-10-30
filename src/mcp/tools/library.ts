import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getLibrary, getSavedTunes, saveCatalogSetting } from "@/lib/library";
import { createFolder, deleteFolder, deleteSavedTune, moveFolder, renameFolder } from "@/lib/library-actions";
import { folderPath } from "@/lib/folder-tree";
import { bookUrl } from "@/lib/mcp-config";
import { fail, guard, ok, page, pageShape, pagination, responseFormat, tuneLine, tuneOut, tuneShape, uuid, type Context } from "@/mcp/format";

export function registerLibraryTools(server: McpServer, context: Context) {
  const { userId } = context;

  server.registerTool("libresession_get_library", {
    title: "Get my library",
    description: "Overview of the signed-in user's Tune Companion library: folders (with paths), tunebooks (with IDs and links), reusable sets, tunebooks shared with them, and how many tunes are saved. Start here to find IDs before editing.",
    inputSchema: { response_format: responseFormat },
    outputSchema: {
      folders: z.array(z.object({ id: z.string(), name: z.string(), parent_id: z.string().nullable(), path: z.string() })),
      tunebooks: z.array(z.object({ id: z.string(), name: z.string(), emoji: z.string().nullable(), folder: z.string(), folder_id: z.string().nullable(), link_visible: z.boolean(), url: z.string() })),
      sets: z.array(z.object({ id: z.string(), name: z.string(), tunes: z.array(z.string()), tunebooks: z.array(z.string()) })),
      shared_with_me: z.array(z.object({ id: z.string(), name: z.string(), url: z.string() })),
      saved_tune_count: z.number(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ response_format }) => guard(async () => {
    const library = await getLibrary(userId);
    const data = {
      folders: library.folders.map((folder) => ({ id: folder.id, name: folder.name, parent_id: folder.parentId, path: folderPath(library.folders, folder.id) })),
      tunebooks: library.books.map((book) => ({ id: book.id, name: book.name, emoji: book.emoji, folder: folderPath(library.folders, book.folderId), folder_id: book.folderId, link_visible: book.linkVisible, url: bookUrl(book.id) })),
      sets: library.sets.map((set) => ({ id: set.id, name: set.name, tunes: set.tunes.map((tune) => tune.title), tunebooks: set.books.map((book) => book.name) })),
      shared_with_me: library.sharedBooks.map((book) => ({ id: book.id, name: book.name, url: bookUrl(book.id) })),
      saved_tune_count: library.tunes.length,
    };
    const markdown = [
      "# Library", `${data.saved_tune_count} saved tunes.`, "",
      "## Tunebooks", ...(data.tunebooks.length ? data.tunebooks.map((book) => `- ${book.emoji ?? "📘"} **${book.name}** in ${book.folder} — \`${book.id}\`${book.link_visible ? " (public link)" : ""}`) : ["None yet."]), "",
      "## Folders", ...(data.folders.length ? data.folders.map((folder) => `- ${folder.path} — \`${folder.id}\``) : ["None."]), "",
      "## Sets", ...(data.sets.length ? data.sets.map((set) => `- **${set.name}** — \`${set.id}\` (in ${set.tunebooks.join(", ") || "no tunebooks"})`) : ["None."]),
      ...(data.shared_with_me.length ? ["", "## Shared with me", ...data.shared_with_me.map((book) => `- **${book.name}** — \`${book.id}\``)] : []),
    ].join("\n");
    return ok(data, markdown, response_format);
  }));

  server.registerTool("libresession_list_saved_tunes", {
    title: "List my saved tunes",
    description: "List tunes saved in the user's library, optionally filtered by title, kind or key. Each has a saved_tune_id for adding to tunebooks and sets, plus the user's ability level (unlearned, learning, learned, mastered).",
    inputSchema: {
      query: z.string().max(100).optional().describe("Case-insensitive title fragment"),
      kind: z.string().optional().describe('Tune type, e.g. "reel", "jig"'),
      mode: z.string().optional().describe('Key and mode as stored, e.g. "Dmajor", "Adorian", or a fragment like "D" or "dorian"'),
      ability: z.enum(["unlearned", "wanted", "learning", "learned", "mastered"]).optional().describe("Only tunes at this progress level: unlearned = not assessed, wanted = want to learn, learning, learned = can play along, mastered = can lead"),
      ...pagination,
      response_format: responseFormat,
    },
    outputSchema: { tunes: z.array(tuneShape), ...pageShape },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, kind, mode, ability, limit, offset, response_format }) => guard(async () => {
    const needle = query?.trim().toLowerCase();
    const matches = (await getSavedTunes(userId)).filter((tune) => (!needle || tune.title.toLowerCase().includes(needle))
      && (!kind || tune.kind?.toLowerCase() === kind.toLowerCase())
      && (!mode || tune.mode?.toLowerCase().includes(mode.toLowerCase()))
      && (!ability || tune.practice.level === ability));
    const tunes = matches.slice(offset, offset + limit).map((tune) => tuneOut(tune));
    const meta = page(matches.length, tunes.length, offset);
    const markdown = tunes.length
      ? [`${matches.length} saved tunes match.`, "", ...tunes.map((tune) => `- ${tuneLine(tune)}`), ...(meta.has_more ? ["", `More: call again with offset=${meta.next_offset}.`] : [])].join("\n")
      : "No saved tunes match. Save tunes from the catalog with libresession_save_tunes.";
    return ok({ tunes, ...meta }, markdown, response_format);
  }));

  if (!context.canWrite) return;

  server.registerTool("libresession_save_tunes", {
    title: "Save catalog tunes",
    description: "Save The Session catalog settings into the user's library, returning a saved_tune_id for each. Saving a setting that is already saved returns its existing saved_tune_id. Most agents can skip this: libresession_build_tunebook and libresession_add_to_tunebook save settings automatically.",
    inputSchema: { setting_ids: z.array(z.number().int().positive()).min(1).max(50).describe("Catalog setting IDs from libresession_search_catalog or libresession_get_tune") },
    outputSchema: { saved: z.array(z.object({ setting_id: z.number(), saved_tune_id: z.string() })) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ setting_ids }) => guard(async () => {
    const saved = [];
    for (const settingId of [...new Set(setting_ids)]) saved.push({ setting_id: settingId, saved_tune_id: await saveCatalogSetting(userId, settingId) });
    return ok({ saved }, `Saved ${saved.length} settings:\n${saved.map((row) => `- setting ${row.setting_id} → \`${row.saved_tune_id}\``).join("\n")}`);
  }));

  server.registerTool("libresession_create_folder", {
    title: "Create a folder",
    description: "Create a folder for organising tunebooks, optionally inside another folder.",
    inputSchema: {
      name: z.string().min(1).max(80).describe("Folder name, 1-80 characters"),
      parent_id: uuid("Parent folder ID; omit for the top level").optional(),
    },
    outputSchema: { folder_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ name, parent_id }) => guard(async () => {
    const folderId = await createFolder(userId, { name, parentId: parent_id });
    return ok({ folder_id: folderId }, `Created folder **${name}** — \`${folderId}\``);
  }));

  server.registerTool("libresession_update_folder", {
    title: "Rename or move a folder",
    description: "Rename a folder and/or move it under another folder. Pass parent_id null to move it to the top level.",
    inputSchema: {
      folder_id: uuid("Folder to change"),
      name: z.string().min(1).max(80).optional().describe("New name"),
      parent_id: uuid("New parent folder ID").nullable().optional().describe("New parent folder ID, or null for the top level; omit to leave it where it is"),
    },
    outputSchema: { folder_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ folder_id, name, parent_id }) => guard(async () => {
    if (name === undefined && parent_id === undefined) return fail("Pass a new name, a parent_id, or both.");
    if (name !== undefined) await renameFolder(userId, folder_id, name);
    if (parent_id !== undefined) await moveFolder(userId, { folderId: folder_id, parentId: parent_id });
    return ok({ folder_id }, "Folder updated.");
  }));

  server.registerTool("libresession_delete_folder", {
    title: "Delete a folder",
    description: "Permanently delete a folder, its subfolders AND every tunebook inside them. Saved tunes and sets stay in the library. This cannot be undone; confirm with the user first.",
    inputSchema: { folder_id: uuid("Folder to delete") },
    outputSchema: { deleted: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ folder_id }) => guard(async () => {
    await deleteFolder(userId, folder_id);
    return ok({ deleted: true }, "Folder and its tunebooks deleted.");
  }));

  server.registerTool("libresession_delete_saved_tune", {
    title: "Delete a saved tune",
    description: "Remove a saved tune from the library and from every tunebook that contains it. Fails if the tune belongs to a set; edit the set first. Practice progress is kept. Confirm with the user first.",
    inputSchema: { saved_tune_id: uuid("Saved tune to delete") },
    outputSchema: { deleted: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ saved_tune_id }) => guard(async () => {
    await deleteSavedTune(userId, saved_tune_id);
    return ok({ deleted: true }, "Saved tune deleted.");
  }));
}
