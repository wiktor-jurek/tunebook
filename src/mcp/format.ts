import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BookPopularityError } from "@/lib/book-popularity";
import { LibraryError } from "@/lib/library-actions";
import { SetError } from "@/lib/sets";
import { SharingError } from "@/lib/sharing";
import { TuneEmojiError } from "@/lib/tune-emojis";
import type { TuneWithPractice } from "@/lib/tune-practice";

export type Context = { userId: string; canWrite: boolean };

export const responseFormat = z.enum(["markdown", "json"]).default("markdown")
  .describe("markdown (default) for reading; json for the full structured data");
export const uuid = (what: string) => z.uuid().describe(`${what} (UUID)`);
export const pagination = {
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum results to return (1-100, default 20)"),
  offset: z.number().int().min(0).default(0).describe("Results to skip, for paging. Use next_offset from the previous call"),
};
export const pageShape = { total: z.number(), count: z.number(), offset: z.number(), has_more: z.boolean(), next_offset: z.number().nullable() };

export function page(total: number, count: number, offset: number) {
  const hasMore = offset + count < total;
  return { total, count, offset, has_more: hasMore, next_offset: hasMore ? offset + count : null };
}

export function ok<T extends Record<string, unknown>>(data: T, markdown: string, format: "markdown" | "json" = "markdown"): CallToolResult {
  return { content: [{ type: "text", text: format === "json" ? JSON.stringify(data, null, 2) : markdown }], structuredContent: data };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}

const hints: [RegExp, string][] = [
  [/Tunebook not found|Tunebook item not found/, "Call libresession_get_library to list your tunebook IDs, or libresession_get_tunebook for entry IDs."],
  [/Tune not found|not in your library/, "Use saved tune IDs from libresession_list_saved_tunes or libresession_get_tunebook, or save catalog settings with libresession_save_tunes."],
  [/Set not found/, "Call libresession_get_library to list your set IDs."],
  [/Folder not found/, "Call libresession_get_library to list your folder IDs."],
  [/Setting not found in the catalog/, "Call libresession_search_catalog or libresession_get_tune to find a valid setting_id."],
];

// Known domain errors carry user-safe messages; anything else stays generic.
export function toolError(error: unknown): CallToolResult {
  if (error instanceof LibraryError || error instanceof SetError || error instanceof SharingError || error instanceof BookPopularityError || error instanceof TuneEmojiError
    || (error instanceof Error && error.message === "Setting not found in the catalog")) {
    const hint = hints.find(([pattern]) => pattern.test(error.message))?.[1];
    return fail(hint ? `${error.message}. ${hint}` : error.message);
  }
  console.error("MCP tool failed", error);
  return fail("The request could not be completed. Try again, or check the IDs with a read tool first.");
}

export async function guard(run: () => Promise<CallToolResult>) {
  try { return await run(); } catch (error) { return toolError(error); }
}

export const tuneShape = z.object({
  saved_tune_id: z.string(), tune_id: z.number(), setting_id: z.number(), title: z.string(),
  kind: z.string().nullable(), meter: z.string().nullable(), mode: z.string().nullable(),
  emoji: z.string(), ability: z.string().optional(), often_played: z.boolean().optional(), abc: z.string().optional(), source_url: z.string(),
});
export type TuneOut = z.infer<typeof tuneShape>;

export function tuneOut(tune: TuneWithPractice & { oftenPlayed?: boolean }, includeAbc = false): TuneOut {
  return {
    saved_tune_id: tune.id, tune_id: tune.tuneId, setting_id: tune.settingId, title: tune.title,
    kind: tune.kind, meter: tune.meter, mode: tune.mode, emoji: tune.emoji, ability: tune.practice.level,
    ...(tune.oftenPlayed !== undefined ? { often_played: tune.oftenPlayed } : {}),
    ...(includeAbc ? { abc: tune.abc } : {}), source_url: tune.sourceUrl,
  };
}

export function describeTune(tune: { title: string; kind: string | null; mode: string | null; meter?: string | null }) {
  return [tune.kind, formatMode(tune.mode), tune.meter].filter(Boolean).join(", ");
}

export function formatMode(mode: string | null) {
  return mode?.replace(/^([A-G][#b]?)(.+)$/, "$1 $2") ?? null;
}

export function tuneLine(tune: TuneOut) {
  const star = tune.often_played ? " ★" : "";
  const abc = tune.abc ? `\n\n\`\`\`abc\n${tune.abc}\n\`\`\`` : "";
  return `${tune.emoji} **${tune.title}**${star} (${describeTune(tune)}) — saved tune \`${tune.saved_tune_id}\`, setting ${tune.setting_id}${abc}`;
}
