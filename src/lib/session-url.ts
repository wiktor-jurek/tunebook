export function parseSessionUrl(input: string): { tuneId: number; settingId?: number } | null {
  try {
    const url = new URL(input);
    if (!(["thesession.org", "www.thesession.org"].includes(url.hostname)) || url.protocol !== "https:") return null;
    const match = /^\/tunes\/(\d+)\/?$/.exec(url.pathname);
    if (!match) return null;
    const setting = /(?:setting|^#)(\d+)/.exec(url.hash);
    return { tuneId: Number(match[1]), settingId: setting ? Number(setting[1]) : undefined };
  } catch { return null; }
}
