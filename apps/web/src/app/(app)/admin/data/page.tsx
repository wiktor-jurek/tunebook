import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { requireAdmin } from "@/lib/session";
import { BAND_EDGES, getMlOverview } from "@/lib/ml-data";
import { BANDS, bandRange } from "@/lib/finder/benchmark";

export const metadata = { title: "Training data" };
export const dynamic = "force-dynamic";

const KINDS: Record<string, string> = {
  youtube_video: "YouTube clips", youtube_full: "Whole sessions", soundcloud_full: "SoundCloud sessions", album: "Album sections", yue: "YuE2 performances",
  app_recording: "App recordings",
};
const LABELS: Record<string, string> = {
  human: "Checked by ear", album: "Album listing", chapters: "Video chapters", description: "Video description",
  title: "Video title", prelabel: "Engine prelabel", generated: "Generated",
};
// Where each kind of source is labelled (/admin/label).
const QUEUE_OF: Record<string, string> = { album: "album", youtube_video: "youtube", youtube_full: "sessions", soundcloud_full: "sessions" };
const n = (x: number) => x.toLocaleString("en-GB");
const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "–");

function Bar({ value, max }: { value: number; max: number }) {
  return <span className="admin-bar"><span style={{ width: `${max ? (100 * value) / max : 0}%` }} /></span>;
}

export default async function AdminData() {
  await requireAdmin();
  const data = await getMlOverview();
  const real = data.inventory.filter((row) => row.kind !== "yue");
  const yue = data.inventory.find((row) => row.kind === "yue");
  const checked = data.labels.reduce((sum, row) => sum + row.yes, 0);
  const unverified = data.labels.reduce((sum, row) => sum + row.unverified, 0);
  const roles = Object.fromEntries(data.roles.map((row) => [row.role, row.tunes]));
  const heard = data.coverage.reduce((sum, row) => sum + row.real, 0);
  const active = data.harvest.filter((day) => day.searches || day.found).reverse();
  const maxSearches = Math.max(1, ...data.harvest.map((day) => day.searches));
  const maxFound = Math.max(1, ...data.harvest.map((day) => day.found));

  return <div className="page-wrap admin-page">
    <header className="page-head"><div><p className="eyebrow">Admin</p><h1>Training data</h1><p className="page-subtitle">Everything the tune finder learns from and is tested on: where it came from, how much is checked, and what each tune may be used for.</p></div><Link className={buttonVariants()} href="/admin/label">Label recordings</Link></header>

    <section className="admin-tiles">
      <div><strong>{n(real.reduce((sum, row) => sum + row.segments, 0))}</strong><span>real recordings labelled, {real.reduce((sum, row) => sum + row.hours, 0).toFixed(1)} hours</span></div>
      <div><strong>{n(heard)}</strong><span>tunes heard really played</span></div>
      <div><strong>{n(checked)}</strong><span>labels checked by ear; {n(unverified)} not yet</span></div>
      <div><strong>{n(data.labelledThisWeek)}</strong><span>labelled in the last 7 days</span></div>
      <div><strong>{yue ? n(yue.segments) : "0"}</strong><span>YuE2 performances, {yue ? n(Math.round(yue.hours)) : 0} hours</span></div>
    </section>

    <section className="benchmark-section">
      <h2>Sources</h2>
      <div className="table-container"><table className="table admin-table">
        <thead><tr><th className="table-head">Kind</th><th className="table-head">Sources</th><th className="table-head">Audio in the bucket</th><th className="table-head">Segments</th><th className="table-head">Hours</th></tr></thead>
        <tbody>{data.inventory.map((row) => <tr key={row.kind}>
          <td className="table-cell">{KINDS[row.kind] ?? row.kind}</td><td className="table-cell">{n(row.sources)}</td>
          <td className="table-cell">{pct(row.stored, row.sources)} <span className="table-muted">({n(row.stored)})</span></td>
          <td className="table-cell">{n(row.segments)}</td><td className="table-cell">{row.hours.toFixed(1)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="benchmark-section">
      <h2>Labels</h2>
      <div className="table-container"><table className="table admin-table">
        <thead><tr><th className="table-head">Kind</th><th className="table-head">Labelled from</th><th className="table-head">Checked right</th><th className="table-head">Rejected</th><th className="table-head">Not checked</th><th className="table-head">Set, not yet split</th></tr></thead>
        <tbody>{data.labels.map((row) => <tr key={`${row.kind}-${row.labelSource}`}>
          <td className="table-cell">{KINDS[row.kind] ?? row.kind}</td><td className="table-cell">{LABELS[row.labelSource] ?? row.labelSource}</td>
          <td className="table-cell">{n(row.yes)}</td><td className="table-cell">{n(row.no)}</td>
          <td className="table-cell">{QUEUE_OF[row.kind] && row.unverified ? <Link href={`/admin/label?queue=${QUEUE_OF[row.kind]}&filter=unchecked`}>{n(row.unverified)}</Link> : n(row.unverified)}</td>
          <td className="table-cell">{QUEUE_OF[row.kind] && row.sets ? <Link href={`/admin/label?queue=${QUEUE_OF[row.kind]}&filter=set`}>{n(row.sets)}</Link> : n(row.sets)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="benchmark-section">
      <h2>Coverage by popularity</h2>
      <div className="table-container"><table className="table admin-table">
        <thead><tr><th className="table-head">Tunes</th><th className="table-head">In the catalogue</th><th className="table-head">Heard really played</th><th className="table-head">for training / testing</th><th className="table-head">With YuE2 audio</th></tr></thead>
        <tbody>{data.coverage.map((row) => <tr key={row.band}>
          <td className="table-cell"><span className="bench-row-label">{BANDS[row.band - 1]}</span><span className="table-meta">catalogue rank {bandRange(row.band, BAND_EDGES)}</span></td>
          <td className="table-cell">{n(row.tunes)}</td>
          <td className="table-cell">{pct(row.real, row.tunes)} <span className="table-muted">({n(row.real)})</span><Bar value={row.real} max={row.tunes} /></td>
          <td className="table-cell">{n(row.realTrain)} / {n(row.realEval)}</td>
          <td className="table-cell">{pct(row.yue, row.tunes)}<Bar value={row.yue} max={row.tunes} /></td>
        </tr>)}</tbody>
      </table></div>
      <p className="benchmark-note">Tunes in the benchmark are split for good: {n(roles.train ?? 0)} whose real recordings may be trained on, {n(roles.eval ?? 0)} kept for testing only. Every other tune&apos;s real recordings are training data.</p>
    </section>

    <section className="benchmark-section">
      <h2>Collecting, last 14 days</h2>
      <div className="table-container"><table className="table admin-table">
        <thead><tr><th className="table-head">Day</th><th className="table-head">YouTube searches</th><th className="table-head">Album sections found</th></tr></thead>
        <tbody>{active.map((day) => <tr key={day.day}>
          <td className="table-cell table-muted">{new Date(day.day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</td>
          <td className="table-cell">{n(day.searches)}<Bar value={day.searches} max={maxSearches} /></td>
          <td className="table-cell">{n(day.found)}<Bar value={day.found} max={maxFound} /></td>
        </tr>)}</tbody>
      </table></div>
      <p className="benchmark-note">{active.length ? `Days with no collecting are left out; ${14 - active.length} of the last 14 were quiet.` : "Nothing collected in the last 14 days."}</p>
    </section>

    <section className="benchmark-section">
      <h2>Datasets</h2>
      {data.datasets.length ? <div className="table-container"><table className="table admin-table">
        <thead><tr><th className="table-head">Name</th><th className="table-head">For</th><th className="table-head">Segments</th><th className="table-head">Tunes</th><th className="table-head">Leak check</th><th className="table-head">Made</th></tr></thead>
        <tbody>{data.datasets.map((set) => <tr key={set.id}>
          <td className="table-cell">{set.name}</td><td className="table-cell">{set.purpose}</td><td className="table-cell">{n(set.segments)}</td><td className="table-cell">{n(set.tunes)}</td>
          <td className={`table-cell ${set.leaked ? "admin-bad" : "admin-good"}`}>{set.leaked ? `${set.leaked} test tunes inside` : "Clean"}</td>
          <td className="table-cell table-muted">{new Date(set.createdAt).toLocaleDateString("en-GB")}</td>
        </tr>)}</tbody>
      </table></div> : <p className="muted">No datasets yet. Training starts using frozen, leak-checked datasets once classifier.py snapshots them.</p>}
    </section>
  </div>;
}
