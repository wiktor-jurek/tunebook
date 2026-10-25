import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCatalogTune, searchCatalogTunes } from "@/lib/library";
import { getOftenPlayedWith } from "@/lib/sets";
import { parseSessionUrl } from "@/lib/session-url";
import { describeTune, fail, formatMode, guard, ok, page, pageShape, pagination, responseFormat, type Context } from "@/mcp/format";

const KINDS = ["reel", "jig", "slip jig", "hornpipe", "polka", "slide", "waltz", "march", "barndance", "strathspey", "mazurka", "three-two"];

const catalogTune = z.object({
  tune_id: z.number(), setting_id: z.number(), title: z.string(), kind: z.string().nullable(), meter: z.string().nullable(),
  mode: z.string().nullable(), tunebooks: z.number(), matching_settings: z.number(), source_url: z.string(),
});

export function registerCatalogTools(server: McpServer, context: Context) {
  server.registerTool("libresession_search_catalog", {
    title: "Search The Session catalog",
    description: `Search The Session's tune catalog (about 20,000 tunes). Returns one row per tune with a representative setting_id, which you can pass to libresession_build_tunebook, libresession_save_tunes or libresession_add_to_tunebook.

Filters combine with AND. Sort by popularity (the number of The Session members' tunebooks containing the tune) to find well-known session tunes, or popular ones for beginners. With no query, the tool browses by filters alone, for example kind="reel", tonic="D", sort="popularity".`,
    inputSchema: {
      query: z.string().max(100).optional().describe('Title fragment, The Session tune ID, or thesession.org tune URL. "The Kesh" also matches "Kesh, The"'),
      kind: z.string().optional().describe(`Tune type, e.g. ${KINDS.join(", ")}`),
      tonic: z.string().regex(/^[A-G][#b]?$/).optional().describe('Key note, e.g. "D", "A", "F#", "Bb"'),
      mode: z.enum(["major", "minor", "dorian", "mixolydian", "lydian", "phrygian", "locrian"]).optional().describe("Mode of the setting"),
      meter: z.string().regex(/^\d+\/\d+$/).optional().describe('Time signature, e.g. "4/4", "6/8", "9/8", "12/8", "3/4", "2/4"'),
      min_tunebooks: z.number().int().min(0).optional().describe("Only tunes in at least this many members' tunebooks (popularity floor), e.g. 500"),
      sort: z.enum(["popularity", "title"]).default("popularity").describe("popularity (default, most popular first) or title"),
      ...pagination,
      response_format: responseFormat,
    },
    outputSchema: { tunes: z.array(catalogTune), ...pageShape },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, kind, tonic, mode, meter, min_tunebooks, sort, limit, offset, response_format }) => guard(async () => {
    const { total, tunes } = await searchCatalogTunes({ query, kind, tonic, mode, meter, minTunebooks: min_tunebooks, sort, limit, offset });
    const rows = tunes.map((tune) => ({
      tune_id: tune.tuneId, setting_id: tune.settingId, title: tune.title, kind: tune.kind, meter: tune.meter, mode: tune.mode,
      tunebooks: tune.tunebooks, matching_settings: tune.matchingSettings, source_url: tune.sourceUrl,
    }));
    const meta = page(total, rows.length, offset);
    const markdown = rows.length
      ? [`Found ${total} tunes (showing ${offset + 1}-${offset + rows.length}).`, "",
        ...rows.map((tune) => `- **${tune.title}** (${describeTune(tune)}) — tune ${tune.tune_id}, setting ${tune.setting_id}, in ${tune.tunebooks} tunebooks`),
        ...(meta.has_more ? ["", `More results: call again with offset=${meta.next_offset}.`] : [])].join("\n")
      : "No tunes match. Try a shorter title fragment or fewer filters.";
    return ok({ tunes: rows, ...meta }, markdown, response_format);
  }));

  server.registerTool("libresession_get_tune", {
    title: "Get a tune's settings",
    description: "Get every setting (version) of a The Session tune, with its key, contributor and optionally its ABC notation. Also lists the tunes you most often play it with in your own sets. Use it to choose a setting_id in a particular key, or to read the music.",
    inputSchema: {
      tune: z.union([z.number().int().positive(), z.string().max(200)]).describe("The Session tune ID (e.g. 27) or a thesession.org tune URL"),
      include_abc: z.boolean().default(false).describe("Include the ABC notation of each setting (long)"),
      response_format: responseFormat,
    },
    outputSchema: {
      tune_id: z.number(), title: z.string(), kind: z.string().nullable(), tunebooks: z.number(),
      settings: z.array(z.object({ setting_id: z.number(), mode: z.string().nullable(), meter: z.string().nullable(), contributor: z.string().nullable(), source_url: z.string(), abc: z.string().optional() })),
      often_played_with: z.array(z.object({ tune_id: z.number(), set_count: z.number() })),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ tune, include_abc, response_format }) => guard(async () => {
    const tuneId = typeof tune === "number" ? tune : /^\d+$/.test(tune.trim()) ? Number(tune) : parseSessionUrl(tune.trim())?.tuneId;
    if (!tuneId) return fail("Give a numeric tune ID or a https://thesession.org/tunes/<id> URL.");
    const [{ settings, tunebooks }, pairs] = await Promise.all([getCatalogTune(tuneId), getOftenPlayedWith(context.userId, tuneId)]);
    if (!settings.length) return fail(`Tune ${tuneId} is not in the catalog. Call libresession_search_catalog to find tune IDs.`);
    const first = settings[0];
    const data = {
      tune_id: tuneId, title: first.title, kind: first.kind, tunebooks,
      settings: settings.map((setting) => ({ setting_id: setting.settingId, mode: setting.mode, meter: setting.meter, contributor: setting.contributor, source_url: setting.sourceUrl, ...(include_abc ? { abc: setting.abc } : {}) })),
      often_played_with: (pairs.rows as { tuneId: number; setCount: number }[]).map((row) => ({ tune_id: row.tuneId, set_count: row.setCount })),
    };
    const markdown = [
      `# ${first.title}`, `${describeTune(first)} — tune ${tuneId}, in ${tunebooks} tunebooks on The Session`, "", "## Settings",
      ...data.settings.map((setting) => `- Setting ${setting.setting_id}: ${formatMode(setting.mode) ?? "unknown key"}${setting.contributor ? `, by ${setting.contributor}` : ""}${setting.abc ? `\n\n\`\`\`abc\n${setting.abc}\n\`\`\`` : ""}`),
      ...(data.often_played_with.length ? ["", "## Often played with (in your sets)", ...data.often_played_with.map((row) => `- Tune ${row.tune_id} (${row.set_count} sets)`)] : []),
    ].join("\n");
    return ok(data, markdown, response_format);
  }));
}
