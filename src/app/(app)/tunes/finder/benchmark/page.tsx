import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { currentUser } from "@/lib/session";
import { PublicHeader } from "@/components/public-header";
import { BenchmarkClips } from "@/components/benchmark-clips";
import { BenchmarkTiming } from "@/components/benchmark-timing";
import { BANDS, ENGINES, SETS, bandRange, scoreboard, type Benchmark, type BenchmarkClip, type EngineKey, type Scoreboard } from "@/lib/finder/benchmark";
import data from "@/lib/finder/benchmark.json";

export const metadata = { title: "Tune finder benchmark", description: "Tune Companion, FolkFriend and JigRipper on the same real recordings: which names the tune, and where." };

const benchmark = data as unknown as Benchmark; // written by ml/eval/benchmark.py
const engines = ENGINES.filter((engine) => benchmark.engines[engine.key]);
const keys = engines.map((engine) => engine.key);
const name = (key: EngineKey | null) => engines.find((engine) => engine.key === key)?.name ?? "";
const pct = (x: number) => `${Math.round(100 * x)}%`;
const pValue = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);

type Scenario = { label: string; about?: string; clips: BenchmarkClip[]; board: Scoreboard };
const scenario = (label: string, clips: BenchmarkClip[], about?: string): Scenario => ({ label, about, clips, board: scoreboard(clips, keys) });

function Verdict({ board }: { board: Scoreboard }) {
  if (board.best) return <span className="bench-verdict is-decided"><span className="bench-dot" style={{ background: engines.find((e) => e.key === board.best)?.colour }} />{name(board.best)} leads <span className="bench-p">{pValue(board.p)}</span></span>;
  return <span className="bench-verdict">Too close to call{board.leader && <span className="bench-p">{name(board.leader)} ahead, {pValue(board.p)}</span>}</span>;
}

function Card({ s, wide }: { s: Scenario; wide?: boolean }) {
  return <article className={`bench-card ${wide ? "is-wide" : ""}`}>
    <header><h3>{s.label}</h3><span className="bench-n">{s.board.clips} clips</span></header>
    {s.about && <p className="bench-about">{s.about}</p>}
    <div className="bench-bars">
      {s.board.scores.map((score) => {
        const engine = engines.find((e) => e.key === score.key)!;
        const lead = s.board.leader === score.key;
        const label = `${engine.name}: ${score.right} of ${score.clips} right (${pct(score.right / score.clips)}), 95% interval ${pct(score.interval[0])} to ${pct(score.interval[1])}, top 5 ${pct(score.top5 / score.clips)}`;
        return <div className={`bench-bar ${lead ? "is-lead" : ""}`} key={score.key} tabIndex={0} aria-label={label}>
          <span className="bench-engine">{engine.name}</span>
          <span className="bench-track">
            <span className="bench-fill" style={{ width: `${(100 * score.right) / score.clips}%`, background: engine.colour }} />
            <span className="bench-whisker" style={{ left: `${100 * score.interval[0]}%`, width: `${100 * (score.interval[1] - score.interval[0])}%` }} />
          </span>
          <span className="bench-value">{pct(score.right / score.clips)}</span>
          <span className="bench-tip" aria-hidden="true"><strong>{engine.name}</strong> {score.right} of {score.clips} right<br />95% interval {pct(score.interval[0])} to {pct(score.interval[1])}, top 5 {pct(score.top5 / score.clips)}</span>
        </div>;
      })}
    </div>
    <footer><Verdict board={s.board} /></footer>
  </article>;
}

// Fewer clips than this and a rate means little: the row says so instead of showing one.
const MIN_CLIPS = 10;

function Matrix({ first, rows }: { first: string; rows: Scenario[] }) {
  return <div className="table-container">
    <table className="table bench-matrix">
      <thead><tr><th className="table-head">{first}</th>{engines.map((engine) => <th key={engine.key} className="table-head"><span className="bench-dot" style={{ background: engine.colour }} />{engine.name}</th>)}<th className="table-head table-wide">Verdict</th></tr></thead>
      <tbody>{rows.map((s) => <tr key={s.label}>
        <td className="table-cell"><span className="bench-row-label">{s.label}</span><span className="table-meta">{s.about ? `${s.about}, ` : ""}{s.board.clips} clip{s.board.clips === 1 ? "" : "s"}</span></td>
        {s.board.clips < MIN_CLIPS ? <td className="table-cell bench-empty" colSpan={engines.length + 1}>Not enough clips yet</td> : <>
          {s.board.scores.map((score) => {
            const engine = engines.find((e) => e.key === score.key)!;
            return <td key={score.key} className={`table-cell bench-cell ${s.board.best === score.key ? "is-best" : s.board.leader === score.key ? "is-lead" : ""}`}>
              <span className="bench-cell-value">{pct(score.right / score.clips)}</span>
              <span className="bench-mini"><span style={{ width: `${(100 * score.right) / score.clips}%`, background: engine.colour }} /></span>
            </td>;
          })}
          <td className="table-cell table-wide"><Verdict board={s.board} /></td>
        </>}
      </tr>)}</tbody>
    </table>
  </div>;
}

export default async function BenchmarkPage() {
  const user = await currentUser();
  const { clips } = benchmark;
  const sets = SETS.map((set) => scenario(set.label, clips.filter((clip) => clip.set === set.key), set.about));
  const youtube = clips.filter((clip) => clip.set === "youtube" || clip.set === "holdout");
  const instruments = [...new Set(youtube.map((clip) => clip.instrument))]
    .map((instrument) => scenario(instrument[0].toUpperCase() + instrument.slice(1), youtube.filter((clip) => clip.instrument === instrument)))
    .filter((row) => row.clips.length >= MIN_CLIPS)
    .sort((a, b) => b.clips.length - a.clips.length);
  const edges = benchmark.bandRanks ?? [];
  const bands = edges.length ? BANDS.map((label, i) => scenario(label, clips.filter((clip) => clip.popularity === i + 1), `catalogue rank ${bandRange(i + 1, edges)}`)) : [];
  const all = [...sets, ...instruments, ...bands].filter((s) => s.board.clips >= MIN_CLIPS);
  const wins = engines.map((engine) => ({ ...engine, count: all.filter((s) => s.board.best === engine.key).length }));
  const ties = all.filter((s) => !s.board.best).length;
  // The clip list shows each engine's first answer only: send the browser just their titles.
  const titles = Object.fromEntries(clips.flatMap((clip) => [clip.tuneId, ...Object.values(clip.results).map((r) => r?.top)])
    .filter((id): id is number => id != null).map((id) => [id, benchmark.tunes[id]]));

  const page = <div className="page-wrap benchmark-page">
    <nav className="page-bar"><Link className="back-link" href="/tunes/finder"><ArrowLeft size={15} /> Tune finder</Link></nav><header className="page-head"><div><h1>Benchmark</h1><p className="page-subtitle">Three tune recognisers on the same {clips.length} real recordings: which one names the tune, and where.</p></div></header>

    <div className="bench-legend">{engines.map((engine) => <span key={engine.key}><span className="bench-dot" style={{ background: engine.colour }} />{engine.name}</span>)}</div>

    <section className="bench-wins" aria-label="Scenarios won">
      {wins.map((w) => <div key={w.key}><span className="bench-dot" style={{ background: w.colour }} /><strong>{w.count}</strong><span>{w.count === 1 ? "scenario" : "scenarios"} won by {w.name}</span></div>)}
      <div><span className="bench-dot is-tie" /><strong>{ties}</strong><span>too close to call</span></div>
    </section>

    <section className="benchmark-section">
      <h2>By kind of recording</h2>
      <div className="bench-grid">
        <Card s={scenario("All recordings", clips)} wide />
        {sets.map((s) => <Card key={s.label} s={s} />)}
      </div>
    </section>

    {clips.some((clip) => Object.values(clip.results).some((r) => r?.curve)) && <section className="benchmark-section">
      <h2>How fast it locks on</h2>
      <BenchmarkTiming clips={clips} engines={engines.map(({ key, name, colour }) => ({ key, name, colour }))} prefixes={benchmark.prefixes} />
      <p className="benchmark-note">Each engine hears only the first few seconds of every clip. A line shows how many it names correctly by then; an engine has locked on once it is right and stays right with every extra second, up to 30. Tune Companion is replayed exactly as the Tune finder runs live, scoring once a second from the first second. JigRipper scores 8-second windows, so it answers from 8 s; FolkFriend answers whenever it can hear notes. The answer an app shows can come later still, as each waits until it is confident.</p>
    </section>}

    <section className="benchmark-section">
      <h2>By instrument</h2>
      <Matrix first="YouTube clips" rows={instruments} />
      <p className="benchmark-note">Top-1 accuracy. A shaded cell is a clear win: on the same clips, the leader got right significantly more than the runner-up did (exact McNemar test, p &lt; 0.05). A bold cell without shading leads, but by too little to be sure.</p>
    </section>

    {bands.length > 0 && <section className="benchmark-section">
      <h2>By popularity</h2>
      <Matrix first="Tunes" rows={bands} />
      <p className="benchmark-note">Bands follow each tune&apos;s rank on The Session by how many members&apos; tunebooks hold it, across the whole catalogue, so &quot;rare&quot; means rare. The clips so far are almost all of popular tunes, which were the easiest to find and label: these rows will fill in as rarer recordings are added.</p>
    </section>}

    <section className="benchmark-section">
      <h2>How it was measured</h2>
      <ul className="benchmark-method">
        <li>Every engine hears the same audio: the whole clip, usually 30 seconds to two minutes. An answer is right when it is the same tune on The Session, in any setting. Bars show top-1 accuracy; the thin line across each bar is its 95% interval. Hover or tap a bar for counts and top-5.</li>
        {engines.map((engine) => { const e = benchmark.engines[engine.key]!; return <li key={engine.key}><a href={engine.url} target={engine.url.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{engine.name}</a>: {e.detail}, {e.tunes.toLocaleString("en-GB")} tunes.{e.missing.length > 0 && ` ${e.missing.length} benchmark tune${e.missing.length === 1 ? " is" : "s are"} missing from its index, so it cannot name ${e.missing.length === 1 ? "it" : "them"}.`}{engine.key === "jigripper" && " It merges some duplicate tunes; naming the tune a duplicate was merged into counts as right."}{engine.key === "folkfriend" && " It is open source; its audio is upsampled to the 48 kHz it expects."}{engine.key === "jigripper" && " Replayed offline with its own published web model and front end."}</li>; })}
        <li>The clips are stored at 16 kHz, which removes the highest overtones for every engine alike. Recordings stay on YouTube; this page only links to them. Last run {new Date(benchmark.generated).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.</li>
      </ul>
    </section>

    <section className="benchmark-section">
      <h2>Every clip</h2>
      <BenchmarkClips clips={clips} tunes={titles} bands={edges.length ? BANDS : []} engines={engines.map(({ key, name }) => ({ key, name }))} />
    </section>
  </div>;
  return user ? page : <div className="landing"><PublicHeader next="/tunes/finder/benchmark" />{page}</div>;
}
