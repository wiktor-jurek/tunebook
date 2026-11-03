import { NextResponse } from "next/server";
import { adminUser } from "@/lib/session";
import { FILTERS, QUEUES, listQueue, type Filter, type Queue } from "@/lib/labels";

export async function GET(request: Request) {
  if (!(await adminUser())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const params = new URL(request.url).searchParams;
  const queue = params.get("queue") ?? "album", filter = params.get("filter") ?? "unchecked";
  if (!(queue in QUEUES) || !(filter in FILTERS)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  return NextResponse.json(await listQueue(queue as Queue, filter as Filter));
}
