import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getMode } from "@/lib/mode";
import { getPassport, pluralKind } from "@/lib/passport";
import { displayTitle } from "@/lib/titles";
import { keyName } from "@/lib/notation";
import { recordingTitle } from "@/lib/recordings";
import { AccountButton } from "@/components/session-shell";
import { OpeningPhrase } from "@/components/opening-phrase";
import { SessionName } from "@/components/local-time";
import { CountUp, MonthBars, StandardsGrid, Stamps } from "@/components/passport/passport-parts";

export const metadata = { title: "Me" };

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

// Me: your passport as a player, as Flighty's passport or Polarsteps' profile. A cover that says who you are, the
// Standards (how many of the 100 tunes every session knows you can play, our scratch map), the stamps you've collected,
// your sound, where your tunes sit between the standards and the rarities, the tunes you love, and your sessions.
export default async function Me() {
  const user = await requireUser();
  const [me, { mode }] = await Promise.all([getPassport(user.id), getMode()]);
  const session = mode === "session";
  const hours = Math.round(me.sessions.minutes / 6) / 10;
  const most = Math.max(1, ...me.types.map((type) => type.total));
  const homeKey = me.keys[0];
  return <div className={`${session ? "session-screen" : "page-wrap"} passport`}>
    <section className="passport-cover">
      <div className="passport-cover-top">
        <span className="passport-avatar" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span>
        <span><span className="passport-name">{user.name}</span><span className="passport-since">Member since {MONTH_YEAR.format(new Date(user.createdAt))}</span></span>
        {session && <span className="passport-gear"><AccountButton /></span>}
      </div>
      <h1 className="passport-headline">{me.headline}</h1>
      <dl className="passport-numbers">
        <div><dt>Tunes you can play</dt><dd><CountUp value={me.repertoire.playable} /></dd></div>
        <div><dt>Sessions</dt><dd><CountUp value={me.sessions.recordings} /></dd></div>
        <div><dt>Hours at sessions</dt><dd>{hours < 10 ? <>{hours}</> : <CountUp value={Math.round(hours)} />}</dd></div>
      </dl>
    </section>

    <section className="passport-card">
      <h2>The Standards</h2>
      <p className="passport-lede">You can play <strong>{me.standards.playable}</strong> of the {me.standards.total} tunes every session knows{me.standards.learning ? `, and you're learning ${me.standards.learning} more` : ""}.</p>
      <StandardsGrid tunes={me.standards.tunes} />
      <p className="passport-key"><span data-level="mastered" /> Can lead <span data-level="learned" /> Can play <span data-level="learning" /> Learning <span data-level="unlearned" /> Saved <span /> Not yet</p>
    </section>

    <section className="passport-card">
      <h2>Stamps</h2>
      <Stamps stamps={me.stamps} />
    </section>

    {me.types.length > 0 && <section className="passport-card">
      <h2>Your sound</h2>
      {me.personas.type && <p className="passport-lede"><strong>{me.personas.type.title}.</strong> {me.personas.type.line}</p>}
      <ul className="passport-types">{me.types.slice(0, 6).map((type) => <li key={type.kind}>
        <span className="passport-type-name">{pluralKind(type.kind)}</span>
        <span className="passport-type-bar"><span style={{ width: `${100 * type.total / most}%` }} /><span className="is-playable" style={{ width: `${100 * type.playable / most}%` }} /></span>
        <span className="passport-type-count">{type.playable} of {type.total}</span>
      </li>)}</ul>
      {homeKey && <p className="passport-keys"><span className="passport-home-key">Your home key: {keyName(homeKey.mode)}</span>{me.keys.slice(1).map((key) => <span key={key.mode}>{keyName(key.mode)}</span>)}</p>}
    </section>}

    {me.popularity.bands.some((band) => band.tunes > 0) && <section className="passport-card">
      <h2>Standards or rarities</h2>
      {me.personas.popularity && <p className="passport-lede"><strong>{me.personas.popularity.title}.</strong> {me.personas.popularity.line}</p>}
      <ol className="passport-bands">{me.popularity.bands.map((band) => <li key={band.band} style={{ "--share": Math.max(...me.popularity.bands.map((b) => b.tunes)) ? band.tunes / Math.max(...me.popularity.bands.map((b) => b.tunes)) : 0 } as React.CSSProperties}>
        <span className="passport-band-fill" /><span className="passport-band-count">{band.tunes}</span><span className="passport-band-label">{band.label}</span>
      </li>)}</ol>
      {me.popularity.rarest && <p className="passport-note">Your rarest: <Link href={`/tunes/${me.popularity.rarest.id}`}>{displayTitle(me.popularity.rarest.title)}</Link></p>}
    </section>}

    {me.favourites.length > 0 && <section className="passport-card">
      <h2>Tunes you love</h2>
      <ul className="passport-favourites">{me.favourites.map((tune) => <li key={tune.id}><Link href={`/tunes/${tune.id}`} className="passport-favourite">
        <span className="passport-favourite-title">{tune.emoji ? `${tune.emoji} ` : ""}{displayTitle(tune.title)}</span>
        <span className="passport-favourite-why">{[tune.starred ? "Often played in your tunebooks" : null, tune.heard ? `Heard ${tune.heard === 1 ? "once" : `${tune.heard} times`}` : null].filter(Boolean).join(", ") || "You can lead it"}</span>
        <OpeningPhrase tune={tune} />
      </Link></li>)}</ul>
    </section>}

    <section className="passport-card">
      <h2>At sessions</h2>
      {me.sessions.recordings === 0 ? <p className="passport-lede">Record a session and it shows here: how often you go, your biggest nights, the tunes you hear most.</p> : <>
        <dl className="passport-small-numbers">
          <div><dt>Sessions</dt><dd>{me.sessions.recordings}</dd></div>
          <div><dt>Hours</dt><dd>{hours}</dd></div>
          <div><dt>Tunes heard</dt><dd>{me.sessions.tunesHeard}</dd></div>
        </dl>
        <MonthBars months={me.sessions.byMonth} />
        {me.sessions.biggestNight && <p className="passport-note">Biggest night: <Link href={`/sessions/${me.sessions.biggestNight.id}`}><SessionName iso={me.sessions.biggestNight.recordedAt} fallback={recordingTitle(new Date(me.sessions.biggestNight.recordedAt))} /></Link>, {me.sessions.biggestNight.tunes} tunes</p>}
        {me.sessions.mostHeard && <p className="passport-note">Most heard: <strong>{displayTitle(me.sessions.mostHeard.title)}</strong>, {me.sessions.mostHeard.times} times</p>}
      </>}
    </section>
  </div>;
}
