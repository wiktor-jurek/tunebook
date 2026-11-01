import { NextResponse } from "next/server";
import { z } from "zod";
import { adminUser } from "@/lib/session";
import { LabelError, QUEUES, getGroup, saveGroup, type Queue } from "@/lib/labels";

const queue = z.enum(Object.keys(QUEUES) as [Queue, ...Queue[]]);
const input = z.object({
  queue,
  segments: z.array(z.object({ startS: z.number().min(0), endS: z.number().min(0), tuneId: z.number().int().positive().nullable() }).strict()).min(1).max(40),
  verdict: z.enum(["yes", "no", "set"]),
  tags: z.object({ instruments: z.array(z.string().max(40)).max(20), ensemble: z.string().max(40).nullable(), setting: z.string().max(40).nullable() }).strict(),
  notes: z.string().max(2000),
}).strict();

export async function GET(request: Request, context: { params: Promise<{ group: string }> }) {
  if (!(await adminUser())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { group } = await context.params;
  const parsed = queue.safeParse(new URL(request.url).searchParams.get("queue"));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const detail = await getGroup(decodeURIComponent(group), parsed.data);
  return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PUT(request: Request, context: { params: Promise<{ group: string }> }) {
  if (!(await adminUser())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { group } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { queue: name, ...save } = parsed.data;
  try {
    return NextResponse.json({ key: await saveGroup(decodeURIComponent(group), name, save) });
  } catch (error) {
    if (error instanceof LabelError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Could not save the label" }, { status: 500 });
  }
}
