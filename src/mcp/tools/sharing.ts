import { eq } from "drizzle-orm";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { APP_URL, bookUrl } from "@/lib/mcp-config";
import { getSharing, inviteToBook, removeShare, setLinkVisible } from "@/lib/sharing";
import { fail, guard, ok, responseFormat, uuid, type Context } from "@/mcp/format";

export function registerSharingTools(server: McpServer, context: Context) {
  const { userId } = context;

  server.registerTool("libresession_get_sharing", {
    title: "Get a tunebook's sharing",
    description: "Show who a tunebook you own is shared with by email, and whether anyone with the link can view it.",
    inputSchema: { book_id: uuid("Tunebook you own"), response_format: responseFormat },
    outputSchema: { book_id: z.string(), url: z.string(), link_visible: z.boolean(), emails: z.array(z.string()) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ book_id, response_format }) => guard(async () => {
    const sharing = await getSharing(userId, book_id);
    const data = { book_id, url: bookUrl(book_id), link_visible: sharing.linkVisible, emails: sharing.shares.map((share) => share.email) };
    const markdown = [`General access: ${data.link_visible ? "anyone with the link can view" : "restricted"}.`, `Link: ${data.url}`, "",
      data.emails.length ? `Shared with:\n${data.emails.map((email) => `- ${email}`).join("\n")}` : "Not shared with anyone by email."].join("\n");
    return ok(data, markdown, response_format);
  }));

  if (!context.canWrite) return;

  server.registerTool("libresession_share_tunebook", {
    title: "Share a tunebook by email",
    description: "Give someone view-only access to a tunebook you own, or remove it. Inviting SENDS A REAL EMAIL from Tune Companion to that address, so confirm the address with the user first. The person sees the book under Shared with me once they sign in with that verified email.",
    inputSchema: {
      book_id: uuid("Tunebook you own"),
      email: z.email().max(254).describe("Recipient email address"),
      action: z.enum(["invite", "remove"]).default("invite").describe("invite (default) grants access and emails them; remove revokes email access"),
    },
    outputSchema: { email: z.string(), action: z.string(), warning: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ book_id, email, action }) => guard(async () => {
    if (action === "remove") {
      await removeShare(userId, book_id, email);
      return ok({ email, action }, `Removed ${email}'s access. Anyone-with-the-link access, if enabled, still applies.`);
    }
    const [owner] = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
    if (!owner) return fail("Your account could not be found.");
    const result = await inviteToBook(owner, book_id, email, APP_URL);
    const text = !result.invited ? `${email} already has access.` : result.warning ?? `Shared with ${email} and sent them an invitation.`;
    return ok({ email, action, ...(result.warning ? { warning: result.warning } : {}) }, `${text}\nLink: ${bookUrl(book_id)}`);
  }));

  server.registerTool("libresession_set_link_visibility", {
    title: "Set a tunebook's link access",
    description: "Make a tunebook you own viewable by anyone with its link (no sign-in needed), or restrict it to you and people invited by email.",
    inputSchema: { book_id: uuid("Tunebook you own"), public: z.boolean().describe("true: anyone with the link can view; false: restricted") },
    outputSchema: { book_id: z.string(), link_visible: z.boolean(), url: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ book_id, public: linkVisible }) => guard(async () => {
    await setLinkVisible(userId, book_id, linkVisible);
    return ok({ book_id, link_visible: linkVisible, url: bookUrl(book_id) }, linkVisible ? `Anyone with the link can now view it: ${bookUrl(book_id)}` : "Access is now restricted.");
  }));
}
