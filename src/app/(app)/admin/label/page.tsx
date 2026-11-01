import { requireAdmin } from "@/lib/session";
import { FILTERS, QUEUES, type Filter, type Queue } from "@/lib/label-options";
import { Labeller } from "@/components/labeller/labeller";

export const metadata = { title: "Label recordings" };

// The labeller fills the screen over the app's chrome (globals.css .labeller): the timeline needs the width.
export default async function LabelPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const params = await searchParams;
  const queue = (params.queue && params.queue in QUEUES ? params.queue : "album") as Queue;
  const filter = (params.filter && params.filter in FILTERS ? params.filter : "unchecked") as Filter;
  return <Labeller queue={queue} filter={filter} item={params.item ?? null} />;
}
